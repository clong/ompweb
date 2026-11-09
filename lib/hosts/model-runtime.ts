import type { Host } from "./host";
import { RpcProcess } from "../omp/rpc-process";
import type { runUtilityCommand } from "../omp/rpc-utility";

/** Read a host's model registry over its existing link, without sharing or
 * changing a user's session. The fresh runtime is stopped after the query. */
export async function withRemoteModelRuntime<T>(
  host: Host,
  read: (run: typeof runUtilityCommand) => Promise<T>,
): Promise<T> {
  const home = await host.workspaceOps.home();
  if (!home.ok) throw new Error("The host's home directory is unavailable");
  const spawned = await host.spawnRpc({
    cwd: home.value.home,
    recordedCwd: null,
    sessionFile: "",
    advisor: false,
  });
  if (spawned.joined) {
    // A catalog lookup must never stop a process another session owns.
    spawned.transport.close?.();
    throw new Error("The model lookup unexpectedly joined an existing session");
  }
  const proc = new RpcProcess({
    cwd: spawned.cwd,
    transport: spawned.transport,
    ...(spawned.transport.hostOwnedLifecycle ? { adopted: { protocolVersion: 2 as const } } : {}),
  });
  try {
    const ready = await proc.waitReady(60_000);
    if (!spawned.transport.hostOwnedLifecycle) await proc.negotiateProtocol(ready, 30_000);
    proc.release();
    return await read(<R>(command: { type: string; [key: string]: unknown }, timeoutMs = 60_000) =>
      proc.sendCommand<R>(command, timeoutMs));
  } finally {
    // This is a fresh, empty runtime, not membership in a user's session.
    await proc.dispose(1_000, true);
  }
}
