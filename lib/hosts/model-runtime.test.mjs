import assert from "node:assert/strict";
import test from "node:test";
import { withRemoteModelRuntime } from "./model-runtime.ts";

function fixture({ joined = false, fail = false } = {}) {
  let onLine, onExit;
  const calls = { spawn: [], commands: [], killed: 0, closed: 0 };
  const transport = {
    id: "remote-model-query", hostOwnedLifecycle: true,
    onLine(fn) { onLine = fn; }, onStderr() {}, onExit(fn) { onExit = fn; },
    write(line, callback) {
      const command = JSON.parse(line);
      calls.commands.push(command.type);
      callback();
      queueMicrotask(() => onLine(JSON.stringify({
        type: "response", id: command.id, command: command.type,
        success: !fail, ...(fail ? { error: "query failed" } : { data: { models: [{ id: "remote-model" }] } }),
      })));
    },
    endInput() { throw new Error("shared lifecycle uses explicit stop"); },
    killTree() { calls.killed++; queueMicrotask(() => onExit(0, "SIGTERM")); },
    close() { calls.closed++; },
  };
  const host = {
    workspaceOps: { home: async () => ({ ok: true, value: { home: "/remote/home" } }) },
    async spawnRpc(request) {
      calls.spawn.push(request);
      return { transport, cwd: request.cwd, joined };
    },
  };
  return { host, calls };
}

test("reads models on the remote host and stops only its fresh query runtime", async () => {
  const { host, calls } = fixture();
  const result = await withRemoteModelRuntime(host, (run) => run({ type: "get_available_models" }));
  assert.deepEqual(result, { models: [{ id: "remote-model" }] });
  assert.deepEqual(calls.spawn, [{ cwd: "/remote/home", recordedCwd: null, sessionFile: "", advisor: false }]);
  assert.deepEqual(calls.commands, ["get_available_models"]);
  assert.equal(calls.killed, 1);
});

test("cleans up its runtime when the model query fails", async () => {
  const { host, calls } = fixture({ fail: true });
  await assert.rejects(withRemoteModelRuntime(host, (run) => run({ type: "get_available_models" })), /query failed/);
  assert.equal(calls.killed, 1);
});

test("never kills a session it unexpectedly joined", async () => {
  const { host, calls } = fixture({ joined: true });
  await assert.rejects(withRemoteModelRuntime(host, async () => null), /existing session/);
  assert.equal(calls.killed, 0);
  assert.equal(calls.closed, 1);
});
