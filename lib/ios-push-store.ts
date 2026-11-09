import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { getAgentDir } from "./omp/paths";

export interface IOSPushDevice {
  id: string;
  owner: string;
  token: string;
  environment: "development" | "production";
  updated: number;
}
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function withDB<T>(action: (db: Database) => T): T {
  const directory = join(getAgentDir(), "omp-web");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "ios-push.db");
  closeSync(openSync(path, "a", 0o600));
  chmodSync(path, 0o600);
  const db = new Database(path);
  try {
    db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, owner TEXT NOT NULL, token TEXT NOT NULL, environment TEXT NOT NULL, updated INTEGER NOT NULL)");
    db.query("DELETE FROM devices WHERE updated < ?").run(Date.now() - MAX_AGE);
    return action(db);
  } finally { db.close(); }
}

export function listIOSDevices(): IOSPushDevice[] {
  return withDB((db) => db.query("SELECT * FROM devices ORDER BY updated DESC").all() as IOSPushDevice[]);
}
export function saveIOSDevice(device: IOSPushDevice): void {
  withDB((db) => db.transaction(() => {
    db.query("DELETE FROM devices WHERE token=? AND environment=? AND id<>?").run(device.token, device.environment, device.id);
    db.query("INSERT INTO devices VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, token=excluded.token, environment=excluded.environment, updated=excluded.updated")
      .run(device.id, device.owner, device.token, device.environment, device.updated);
    db.exec("DELETE FROM devices WHERE id NOT IN (SELECT id FROM devices ORDER BY updated DESC LIMIT 50)");
  })());
}
export function removeIOSDevice(id: string, owner: string): void {
  withDB((db) => db.query("DELETE FROM devices WHERE id=? AND owner=?").run(id, owner));
}
export function invalidateIOSDevice(device: IOSPushDevice): void {
  // A rejected old token must not delete a newly rotated registration.
  withDB((db) => db.query("DELETE FROM devices WHERE id=? AND token=? AND environment=? AND updated=?").run(device.id, device.token, device.environment, device.updated));
}
