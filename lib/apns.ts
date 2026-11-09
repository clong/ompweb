import { createHash, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:http2";
import type { NotificationEvent } from "./notification-events";
import { invalidateIOSDevice, listIOSDevices, type IOSPushDevice } from "./ios-push-store";

const TOPIC = "network.clong.ompweb.ios";
const RETRY_DELAYS = [2_000, 10_000, 30_000];
type Result = { ok: true } | { ok: false; error: string; retryable?: boolean; invalid?: boolean };
let jwtCache: { identity: string; token: string; at: number } | undefined;

export function apnsConfigured(): boolean {
  return Boolean(process.env.OMP_WEB_APNS_KEY_FILE && /^[A-Z0-9]{10}$/.test(process.env.OMP_WEB_APNS_KEY_ID ?? "") && /^[A-Z0-9]{10}$/.test(process.env.OMP_WEB_APNS_TEAM_ID ?? ""));
}
export function makeAPNsJWT(privateKey: string, keyId: string, teamId: string, now: number): string {
  const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${json({ alg: "ES256", kid: keyId })}.${json({ iss: teamId, iat: Math.floor(now / 1000) })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${unsigned}.${signature}`;
}
function providerToken(): string {
  const { OMP_WEB_APNS_KEY_FILE: file, OMP_WEB_APNS_KEY_ID: key, OMP_WEB_APNS_TEAM_ID: team } = process.env;
  if (!apnsConfigured()) throw new Error("APNs is not configured");
  const identity = `${file}:${key}:${team}`;
  if (!jwtCache || jwtCache.identity !== identity || Date.now() - jwtCache.at > 50 * 60 * 1000) {
    const now = Date.now();
    jwtCache = { identity, at: now, token: makeAPNsJWT(readFileSync(file!, "utf8"), key!, team!, now) };
  }
  return jwtCache.token;
}

export function apnsPayload(event: NotificationEvent) {
  const bodies: Record<NotificationEvent["type"], string> = {
    completed: "A session has finished. Tap to open it.",
    input: "A session needs your input. Tap to respond.",
    error: "A session encountered an error. Tap to review it.",
    modelSwitch: "A session changed models.",
    test: "Background notifications are working on this iPhone.",
  };
  // Keep session names, questions and model output off Apple's servers and the lock screen.
  return { aps: { alert: { title: "ompweb", body: bodies[event.type] }, sound: "default", "thread-id": event.sessionId || "ompweb-test" }, sessionId: event.sessionId, eventType: event.type };
}

export async function sendAPNs(device: IOSPushDevice, event: NotificationEvent): Promise<Result> {
  if (!apnsConfigured()) return { ok: false, error: "Apple push is not configured on this server" };
  let token: string;
  try { token = providerToken(); } catch { return { ok: false, error: "Unable to load the Apple push signing key" }; }
  const endpoint = device.environment === "development" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const payload = JSON.stringify(apnsPayload(event));
  return new Promise((resolve) => {
    const client = connect(endpoint);
    let finished = false;
    const done = (result: Result) => {
      if (finished) return;
      finished = true; clearTimeout(timeout); client.destroy(); resolve(result);
    };
    const timeout = setTimeout(() => done({ ok: false, error: "Apple push request timed out", retryable: true }), 10_000);
    client.on("error", () => done({ ok: false, error: "Apple push connection failed", retryable: true }));
    client.once("connect", () => {
      try {
      const request = client.request({
        ":method": "POST", ":path": `/3/device/${device.token}`,
        authorization: `bearer ${token}`, "apns-topic": TOPIC, "apns-push-type": "alert", "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
        "apns-collapse-id": createHash("sha256").update(`${event.sessionId}:${event.type}`).digest("hex"),
        "content-type": "application/json",
      });
      let status = 0; let body = "";
      request.on("response", (headers) => { status = Number(headers[":status"]); });
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { if (body.length < 2048) body += chunk; });
      request.on("error", () => done({ ok: false, error: "Apple push request failed", retryable: true }));
      request.on("end", () => {
        if (status === 200) return done({ ok: true });
        let reason = "Unknown";
        try { const parsed = JSON.parse(body); if (typeof parsed.reason === "string" && /^[A-Za-z]+$/.test(parsed.reason)) reason = parsed.reason; } catch { /* no provider body */ }
        const invalid = status === 410 || ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(reason);
        if (invalid) { try { invalidateIOSDevice(device); } catch { /* try on next event */ } }
        done({ ok: false, error: `Apple push rejected the request (${status}: ${reason})`, invalid, retryable: status === 429 || status >= 500 });
      });
      request.end(payload);
      } catch { done({ ok: false, error: "Apple push request could not start", retryable: true }); }
    });
  });
}

export async function publishIOSNotification(event: NotificationEvent): Promise<void> {
  if (!apnsConfigured() || !["completed", "input", "error"].includes(event.type)) return;
  await Promise.all(listIOSDevices().map(async (device) => {
    for (let attempt = 0; ; attempt++) {
      const result = await sendAPNs(device, event);
      if (result.ok) return;
      if (!result.retryable || attempt >= RETRY_DELAYS.length) {
        console.warn("[ios-push]", result.error); return;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
      if (!listIOSDevices().some((current) => current.id === device.id && current.token === device.token && current.environment === device.environment)) return;
    }
  }));
}
