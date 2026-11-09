import { statSync } from "fs";
import { invalidateModelsCache, loadModelsWithCache, withModelRuntimeError, withSafeModelLoadFailure, type ModelsData } from "@/lib/models-cache";
import { disposeUtilityRpc, runUtilityCommand, type OmpModel } from "@/lib/omp/rpc-utility";
import { getModelsConfigPath } from "@/lib/omp/paths";
import { readDisabledProviders } from "@/lib/omp/model-roles";
import { readAnthropicSlowMode } from "@/lib/omp/settings-config";
import { resolveHostOrError } from "@/lib/api-utils";
import { withRemoteModelRuntime } from "@/lib/hosts/model-runtime";

// Each host's OMP model registry (auth + models.yml) is global, not per-cwd.
// Remote cache entries are keyed by host; this key is only for main's registry.
// The legacy ?cwd= parameter no longer affects the result.
const MODELS_CACHE_KEY = "global";

declare global {
  var __ompModelsConfigFingerprint: string | undefined;
}

function refreshModelsIfConfigChanged(): void {
  const path = getModelsConfigPath();
  let fingerprint = `${path}:missing`;
  try {
    const stat = statSync(path);
    fingerprint = `${path}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  } catch {
    // A missing models file is a valid state; the fingerprint still detects
    // its later creation.
  }

  const previous = globalThis.__ompModelsConfigFingerprint;
  globalThis.__ompModelsConfigFingerprint = fingerprint;
  if (previous !== undefined && previous !== fingerprint) {
    // The utility process reads models.yml once at startup. External edits
    // therefore need the same invalidation as the web editor's PUT route.
    invalidateModelsCache();
    disposeUtilityRpc();
  }
}

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

// "off" is always a valid selector; the concrete efforts come from the model's
// baked thinking metadata (omp: getSupportedEfforts = reasoning ? efforts : []).
function thinkingLevelsFor(model: OmpModel): string[] {
  if (!model.reasoning) return ["off"];
  return ["off", ...(model.thinking?.efforts ?? [])];
}

// OMP's /fast maps to a priority service tier. These are the provider families
// OMP currently resolves for that control (ModelControls.setFastMode).
function supportsFastMode(model: OmpModel): boolean {
  // Codex discovers tiers per model. Match OMP's own priority gate: a
  // nonempty advertised list must include priority; absent/empty is unreported.
  if (model.provider === "openai-codex") {
    return !model.serviceTiers?.length || model.serviceTiers.includes("priority");
  }
  return model.provider === "anthropic" || model.provider === "openai" || model.provider === "google";
}

// Copy of omp's AgentSession#slowModeTarget for the composer's Slow toggle
// before omp runs: Claude low priority on `anthropic`, else the flex tier of
// the OpenAI/Google service-tier families. Live get_state wins once omp runs.
// ponytail: provider-only; OpenRouter's openai/google ids need omp's model identity.
const SLOW_MODE_PROVIDERS: Record<string, true> = { anthropic: true, openai: true, "openai-codex": true, google: true, "google-vertex": true };

async function loadModels(runCommand = runUtilityCommand, disabledProviders = readDisabledProviders()): Promise<ModelsData> {
  const availableResponse = await runCommand<{ models?: unknown }>(
    { type: "get_available_models" },
    120_000,
  );
  const available = Array.isArray(availableResponse.models)
    ? availableResponse.models
        .filter((model): model is OmpModel => (
          typeof model === "object" && model !== null
          && typeof (model as OmpModel).id === "string"
          && typeof (model as OmpModel).provider === "string"
        ))
        .map((model) => ({
          ...model,
          name: typeof model.name === "string" && model.name.trim().length > 0 ? model.name : model.id,
        }))
    : [];

  const nameMap = new Map<string, string>();
  const thinkingLevels: Record<string, string[]> = {};
  const modelList = available
    .map((m) => ({ id: m.id, name: m.name, provider: m.provider, thinkingLevels: thinkingLevelsFor(m), supportsFastMode: supportsFastMode(m), supportsSlowMode: SLOW_MODE_PROVIDERS[m.provider] === true, contextWindow: m.contextWindow ?? undefined, maxTokens: m.maxTokens ?? undefined }))
    .sort(compareModelEntries);
  const loginResponse = await runCommand<{ providers?: unknown }>(
    { type: "get_login_providers" },
    30_000,
  );
  const loginProviders = Array.isArray(loginResponse.providers)
    ? loginResponse.providers.filter((provider): provider is { id: string; name: string; authenticated: boolean } => (
      typeof provider === "object" && provider !== null
      && typeof (provider as { id?: unknown }).id === "string"
      && typeof (provider as { name?: unknown }).name === "string"
      && typeof (provider as { authenticated?: unknown }).authenticated === "boolean"
    ))
    : [];
  const connectedProviders = loginProviders
    .filter((provider) => provider.authenticated)
    .map((provider) => ({ id: provider.id, name: provider.name, disabled: disabledProviders.has(provider.id) }));
  for (const m of available) {
    const key = `${m.provider}:${m.id}`;
    nameMap.set(key, m.name);
    thinkingLevels[key] = thinkingLevelsFor(m);
  }

  // omp resolves the default model at session start; a --no-session utility
  // process reports it via get_state.
  let defaultModel: { provider: string; modelId: string } | null = null;
  try {
    const state = await runCommand<{ model?: { provider?: string; id?: string } }>(
      { type: "get_state" },
      30_000,
    );
    const provider = state.model?.provider;
    const modelId = state.model?.id;
    if (provider && modelId && available.some((m) => m.provider === provider && m.id === modelId)) {
      defaultModel = { provider, modelId };
    }
  } catch {
    // Default model is cosmetic — the models list is still useful without it.
  }

  return withModelRuntimeError(
    { models: Object.fromEntries(nameMap), modelList, defaultModel, thinkingLevels, connectedProviders },
    undefined,
  );
}

const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
};

export async function GET(request?: Request) {
  const hostId = request ? new URL(request.url).searchParams.get("hostId") : null;
  if (hostId && hostId !== "local") {
    const target = resolveHostOrError(hostId);
    if ("response" in target) return target.response;
    try {
      // A remote catalog is scoped to that host, not main's credentials or
      // models.yml. Existing daemon builds already support a fresh RPC runtime.
      return Response.json(await loadModelsWithCache(`host:${target.host.id}`, () =>
        withRemoteModelRuntime(target.host, (run) => loadModels(run, new Set()))));
    } catch {
      return Response.json(withSafeModelLoadFailure(EMPTY_MODELS));
    }
  }
  refreshModelsIfConfigChanged();
  // Outside the cache: `/slow` on a Claude model rewrites config.yml.
  const anthropicSlowMode = readAnthropicSlowMode();
  try {
    return Response.json({ ...await loadModelsWithCache(MODELS_CACHE_KEY, () => loadModels()), anthropicSlowMode });
  } catch {
    return Response.json({ ...withSafeModelLoadFailure(EMPTY_MODELS), anthropicSlowMode });
  }
}
