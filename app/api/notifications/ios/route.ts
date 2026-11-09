import { createHash } from "node:crypto";
import { apnsConfigured, sendAPNs } from "@/lib/apns";
import { listIOSDevices, removeIOSDevice, saveIOSDevice } from "@/lib/ios-push-store";
import { requestOwner } from "@/lib/web-auth";
import { isRecord } from "@/lib/type-guards";

const owner = (request: Request) => createHash("sha256").update(requestOwner(request)).digest("hex");
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{20,80}$/.test(value);
export async function GET() { return Response.json({ configured: apnsConfigured() }); }

/** All methods pass the server's authenticated request/Origin gate. No token is returned. */
export async function PUT(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !validId(body.deviceId) || typeof body.token !== "string" || !/^[a-f0-9]{32,512}$/i.test(body.token) || !["development", "production"].includes(String(body.environment))) {
    return Response.json({ error: "Invalid iOS device registration" }, { status: 400 });
  }
  if (!apnsConfigured()) return Response.json({ error: "Apple push is not configured on this server" }, { status: 503 });
  saveIOSDevice({ id: body.deviceId, owner: owner(request), token: body.token.toLowerCase(), environment: body.environment as "development" | "production", updated: Date.now() });
  return Response.json({ registered: true });
}
export async function DELETE(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !validId(body.deviceId)) return Response.json({ error: "Invalid device" }, { status: 400 });
  removeIOSDevice(body.deviceId, owner(request));
  return new Response(null, { status: 204 });
}
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !validId(body.deviceId)) return Response.json({ error: "Invalid device" }, { status: 400 });
  const device = listIOSDevices().find((candidate) => candidate.id === body.deviceId && candidate.owner === owner(request));
  if (!device) return Response.json({ error: "Enable notifications on this device first" }, { status: 404 });
  const result = await sendAPNs(device, { type: "test", sessionId: "", sessionName: null });
  return result.ok ? new Response(null, { status: 204 }) : Response.json({ error: result.error }, { status: 502 });
}
