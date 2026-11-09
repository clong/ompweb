import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "omp-apns-"));
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const file = join(directory, "test.p8");
writeFileSync(file, pem, { mode: 0o600 });
Object.assign(process.env, { PI_CODING_AGENT_DIR: directory, OMP_WEB_APNS_KEY_FILE: file, OMP_WEB_APNS_KEY_ID: "ABCDEFGHIJ", OMP_WEB_APNS_TEAM_ID: "0123456789" });
let response = { status: 200, reason: undefined };
let sent;
mock.module("node:http2", () => ({ connect(endpoint) {
  const client = new EventEmitter();
  client.destroy = () => {};
  client.request = (headers) => {
    const request = new EventEmitter(); request.setEncoding = () => {};
    request.end = (body) => {
      sent = { endpoint, headers, payload: JSON.parse(body) };
      queueMicrotask(() => { request.emit("response", { ":status": response.status }); request.emit("data", JSON.stringify({ reason: response.reason })); request.emit("end"); });
    };
    return request;
  };
  queueMicrotask(() => client.emit("connect"));
  return client;
} }));
const apns = await import("./apns.ts");
const store = await import("./ios-push-store.ts");
const route = await import("../app/api/notifications/ios/route.ts");
const device = () => ({ id: "11111111-2222-3333-4444-555555555555", owner: "owner", token: "a".repeat(64), environment: "development", updated: Date.now() });
const event = { type: "input", sessionId: "session-1", sessionName: "private project", detail: "secret question" };
beforeEach(() => { response = { status: 200 }; sent = undefined; for (const entry of store.listIOSDevices()) store.removeIOSDevice(entry.id, entry.owner); });
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("provider JWT is a verifiable ES256 signature with correct issuer, key ID and time", () => {
  const jwt = apns.makeAPNsJWT(pem, "ABCDEFGHIJ", "0123456789", 1_700_000_000_000);
  const [header, claims, signature] = jwt.split(".");
  expect(JSON.parse(Buffer.from(header, "base64url"))).toEqual({ alg: "ES256", kid: "ABCDEFGHIJ" });
  expect(JSON.parse(Buffer.from(claims, "base64url"))).toEqual({ iss: "0123456789", iat: 1_700_000_000 });
  expect(verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
});
test("sandbox request carries alert headers and generic payload without session content", async () => {
  expect(await apns.sendAPNs(device(), event)).toEqual({ ok: true });
  expect(sent.endpoint).toBe("https://api.sandbox.push.apple.com");
  expect(sent.headers["apns-topic"]).toBe("network.clong.ompweb.ios");
  expect(sent.headers["apns-push-type"]).toBe("alert");
  expect(sent.headers["apns-collapse-id"].length).toBeLessThanOrEqual(64);
  expect(sent.payload.sessionId).toBe("session-1");
  expect(JSON.stringify(sent.payload)).not.toContain("private project");
  expect(JSON.stringify(sent.payload)).not.toContain("secret question");
});
test("production tokens go to the production endpoint", async () => {
  await apns.sendAPNs({ ...device(), environment: "production" }, event);
  expect(sent.endpoint).toBe("https://api.push.apple.com");
});
test("APNs expired token removes only the matching registration", async () => {
  const original = device(); store.saveIOSDevice(original); response = { status: 410, reason: "Unregistered" };
  expect((await apns.sendAPNs(original, event)).invalid).toBe(true);
  expect(store.listIOSDevices()).toHaveLength(0);
  store.saveIOSDevice({ ...device(), token: "b".repeat(64) });
  await apns.sendAPNs(device(), event);
  expect(store.listIOSDevices()[0].token).toBe("b".repeat(64));
});
test("a late invalidation preserves a refreshed registration with the same token", () => {
  const old = device(); store.saveIOSDevice(old);
  store.saveIOSDevice({ ...old, updated: old.updated + 1 });
  store.invalidateIOSDevice(old);
  expect(store.listIOSDevices()).toHaveLength(1);
});
test("missing provider configuration rejects registration without storing a token", async () => {
  const keyFile = process.env.OMP_WEB_APNS_KEY_FILE;
  delete process.env.OMP_WEB_APNS_KEY_FILE;
  try {
    expect((await route.PUT(request("PUT", { deviceId: device().id, token: device().token, environment: "development" }))).status).toBe(503);
    expect(store.listIOSDevices()).toHaveLength(0);
  } finally { process.env.OMP_WEB_APNS_KEY_FILE = keyFile; }
});
test("retryable provider failures retain registration; authentication failures do not retry", async () => {
  store.saveIOSDevice(device()); response = { status: 503, reason: "ServiceUnavailable" };
  expect((await apns.sendAPNs(device(), event)).retryable).toBe(true);
  expect(store.listIOSDevices()).toHaveLength(1);
  response = { status: 403, reason: "InvalidProviderToken" };
  expect((await apns.sendAPNs(device(), event)).retryable).toBe(false);
});
test("store deduplicates tokens, enforces owner removal, expires registrations and uses private permissions", () => {
  store.saveIOSDevice(device());
  store.removeIOSDevice(device().id, "another owner"); expect(store.listIOSDevices()).toHaveLength(1);
  store.saveIOSDevice({ ...device(), id: "second-id" }); expect(store.listIOSDevices()).toHaveLength(1);
  store.saveIOSDevice({ ...device(), updated: 0 }); expect(store.listIOSDevices()).toHaveLength(0);
  expect(statSync(join(directory, "omp-web", "ios-push.db")).mode & 0o777).toBe(0o600);
});
const request = (method, body, cookie = "session-a") => new Request("https://ompweb.clong.network/api/notifications/ios", { method, headers: { Cookie: `omp_web_session=${cookie}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
test("registration rejects malformed tokens and does not disclose tokens", async () => {
  expect((await route.PUT(request("PUT", { deviceId: device().id, token: "../bad", environment: "development" }))).status).toBe(400);
  const response = await route.PUT(request("PUT", { deviceId: device().id, token: device().token, environment: "development" }));
  expect(await response.json()).toEqual({ registered: true });
  expect((await route.POST(request("POST", { deviceId: device().id }, "different-session"))).status).toBe(404);
  await route.DELETE(request("DELETE", { deviceId: device().id }, "different-session")); expect(store.listIOSDevices()).toHaveLength(1);
  await route.DELETE(request("DELETE", { deviceId: device().id })); expect(store.listIOSDevices()).toHaveLength(0);
});
