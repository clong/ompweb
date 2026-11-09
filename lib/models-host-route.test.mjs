import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "bun:test";
import { invalidateModelsCache } from "./models-cache.ts";

const queries = [];
mock.module("@/lib/api-utils", () => ({
  resolveHostOrError(id) {
    if (id === "missing") return { response: Response.json({ code: "host_not_found" }, { status: 404 }) };
    if (id === "offline") return { response: Response.json({ hostOffline: true }, { status: 503 }) };
    return { host: { id } };
  },
}));
mock.module("@/lib/hosts/model-runtime", () => ({
  async withRemoteModelRuntime(host, read) {
    queries.push(host.id);
    return read(async (command) => {
      if (host.id === "broken") throw new Error("private provider detail");
      if (command.type === "get_available_models" && host.id === "codex") return { models: [
        { id: "advertised", name: "Advertised", provider: "openai-codex", serviceTiers: ["priority"] },
        { id: "unreported", name: "Unreported", provider: "openai-codex", serviceTiers: [] },
        { id: "excluded", name: "Excluded", provider: "openai-codex", serviceTiers: ["flex"] },
      ] };
      if (command.type === "get_available_models") return { models: [{
        id: host.id + "-model", provider: "remote", name: host.id,
        reasoning: true, thinking: { efforts: ["low", "high"] }, apiKey: "must-not-leak",
      }] };
      if (command.type === "get_login_providers") return { providers: [] };
      return { model: { id: host.id + "-model", provider: "remote" } };
    });
  },
}));
mock.module("@/lib/omp/rpc-utility", () => ({
  runUtilityCommand() { throw new Error("local OMP is not installed"); },
  disposeUtilityRpc() {},
}));
mock.module("@/lib/omp/model-roles", () => ({
  readDisabledProviders() { throw new Error("remote requests must not read main's model configuration"); },
}));
const { GET } = await import("../app/api/models/route.ts");
const get = (id) => GET(new Request("https://portal.test/api/models?hostId=" + id));

test("returns and caches each host's own catalog without local OMP or credentials", async () => {
  invalidateModelsCache(); queries.length = 0;
  const first = await (await get("first")).json();
  const second = await (await get("second")).json();
  assert.equal(first.modelList[0].id, "first-model");
  assert.equal(second.modelList[0].id, "second-model");
  assert.deepEqual(first.defaultModel, { provider: "remote", modelId: "first-model" });
  assert.deepEqual(first.thinkingLevels["remote:first-model"], ["off", "low", "high"]);
  assert.equal(first.modelError, undefined);
  assert.ok(!JSON.stringify(first).includes("must-not-leak"));
  await get("first");
  assert.deepEqual(queries, ["first", "second"]);
});

test("an unavailable or unknown remote host never falls back to main", async () => {
  assert.equal((await get("missing")).status, 404);
  assert.equal((await get("offline")).status, 503);
});

test("Fast eligibility for Codex models follows OMP's discovered priority gate", async () => {
  const result = await (await get("codex")).json();
  const supported = Object.fromEntries(result.modelList.map((model) => [model.id, model.supportsFastMode]));
  assert.deepEqual(supported, { advertised: true, excluded: false, unreported: true });
});

test("remote failures expose the safe message without provider details", async () => {
  const result = await (await get("broken")).json();
  assert.match(result.modelError, /Model list is temporarily unavailable/);
  assert.ok(!JSON.stringify(result).includes("private provider detail"));
});
