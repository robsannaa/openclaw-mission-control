import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { runCliJson, runCli, gatewayCall } from "@/lib/openclaw";
import { getOpenClawHome } from "@/lib/paths";
import { fetchGatewaySessions } from "@/lib/gateway-sessions";
import { buildModelsSummary } from "@/lib/models-summary";
import {
  buildProviderCredentialPatch,
  PROVIDER_ENV_KEYS,
  validateProviderToken,
} from "@/lib/provider-auth";
import {
  gatewayCallWithRetry as _gatewayCallWithRetry,
  patchConfig,
  fetchConfig,
  isGatewayTransientError as _isGatewayTransientError,
} from "@/lib/gateway-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const OPENCLAW_HOME = getOpenClawHome();
const MODELS_ALL_CACHE_TTL_MS = 30_000;

let modelsAllCache:
  | {
      expiresAt: number;
      payload: Record<string, unknown>;
    }
  | null = null;

type ModelInfo = {
  key: string;
  name: string;
  input: string;
  contextWindow: number;
  local: boolean;
  available: boolean;
  tags: string[];
  missing: boolean;
};

type ModelStatus = {
  defaultModel: string;
  resolvedDefault: string;
  fallbacks: string[];
  imageModel: string;
  imageFallbacks: string[];
  aliases: Record<string, string>;
  allowed: string[];
};

type ModelsCatalogProvider = {
  provider: string;
  config: Record<string, unknown>;
};

type ModelsCatalogConfig = {
  mode: string;
  providers: ModelsCatalogProvider[];
};

type ConfigFileSnapshot = {
  defaultsModel: DefaultsModelConfig | null;
  allowedModels: string[];
  modelsCatalogConfig: ModelsCatalogConfig;
  configuredModels: string[];
  configuredProviders: string[];
  authProviders: string[];
};

type LiveModelInfo = {
  fullModel: string | null;
  model: string | null;
  provider: string | null;
  updatedAt: number | null;
  sessionKey: string | null;
};

type ParsedAgentModelConfig = {
  usesDefaults: boolean;
  primary: string | null;
  fallbacks: string[] | null;
};

type DefaultsModelConfig = {
  primary: string;
  fallbacks: string[];
};

type AgentRuntimeStatus = {
  defaultModel: string;
  resolvedDefault: string;
  fallbacks: string[];
};

type DefaultsMatchSnapshot = {
  gateway: DefaultsModelConfig | null;
  file: DefaultsModelConfig | null;
};

type AllowedModelsMatchSnapshot = {
  gateway: string[] | null;
  file: string[] | null;
};

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const VERIFY_TIMEOUT_MS = 7000;
const VERIFY_INTERVAL_MS = 300;

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers || {}),
    },
  });
}

function invalidateModelsAllCache() {
  modelsAllCache = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeModelConfig(modelValue: unknown): DefaultsModelConfig {
  if (typeof modelValue === "string") {
    return { primary: modelValue, fallbacks: [] };
  }
  if (!isRecord(modelValue)) {
    return { primary: "", fallbacks: [] };
  }
  const primary =
    typeof modelValue.primary === "string" ? modelValue.primary : "";
  const fallbacks = Array.isArray(modelValue.fallbacks)
    ? modelValue.fallbacks.map((f) => String(f))
    : [];
  return { primary, fallbacks };
}

function fallbackModelStatus(
  defaultsModel: DefaultsModelConfig | null,
  models: ModelInfo[]
): ModelStatus {
  const allowed = models.map((m) => String(m.key || "")).filter(Boolean);
  const primary =
    defaultsModel?.primary ||
    (allowed.length > 0 ? allowed[0] : "unknown");
  return {
    defaultModel: primary,
    resolvedDefault: primary,
    fallbacks: defaultsModel?.fallbacks || [],
    imageModel: "",
    imageFallbacks: [],
    aliases: {},
    allowed,
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function equalStringSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  if (aSet.size !== a.length) return false;
  for (const value of b) {
    if (!aSet.has(value)) return false;
  }
  return true;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const key = String(entry || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function canonicalAllowedModelKey(value: unknown): string {
  const key = String(value || "").trim();
  if (!key) return "";
  // Normalize duplicated-provider keys (e.g. openrouter/openrouter/auto).
  const parts = key.split("/");
  if (parts.length >= 3 && parts[0] && parts[0] === parts[1]) {
    return `${parts[0]}/${parts.slice(2).join("/")}`;
  }
  return key;
}

function normalizeProviderId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function providerConfigPath(provider: string): string {
  const escaped = provider.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `models.providers["${escaped}"]`;
}

function normalizeProviderConfigMap(
  value: unknown
): ModelsCatalogProvider[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .map(([provider, config]) => ({
      provider,
      config: isRecord(config) ? { ...(config as Record<string, unknown>) } : {},
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

function normalizeAllowedModelList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.keys(value)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const key = canonicalAllowedModelKey(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function providerFromModelKey(modelKey: string): string {
  if (!modelKey.includes("/")) return "custom";
  return modelKey.split("/")[0] || "custom";
}

function localProvider(provider: string): boolean {
  return provider === "ollama" || provider === "vllm" || provider === "lmstudio";
}

function collectModelRefsFromValue(value: unknown): string[] {
  const cfg = normalizeModelConfig(value);
  return uniqueStrings([cfg.primary, ...cfg.fallbacks]);
}

async function readConfigFileSnapshot(): Promise<ConfigFileSnapshot | null> {
  try {
    const configPath = join(OPENCLAW_HOME, "openclaw.json");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const agents = isRecord(parsed.agents) ? parsed.agents : null;
    const defaults = agents && isRecord(agents.defaults) ? agents.defaults : null;
    const list = agents && Array.isArray(agents.list) ? agents.list : [];
    const defaultsModel = defaults ? normalizeModelConfig(defaults.model) : null;
    const allowedModels = defaults ? normalizeAllowedModelList(defaults.models) : [];

    const modelsBlock = isRecord(parsed.models) ? parsed.models : null;
    const rawMode = modelsBlock && typeof modelsBlock.mode === "string"
      ? modelsBlock.mode.trim().toLowerCase()
      : "";
    const modelsCatalogConfig: ModelsCatalogConfig = {
      mode: rawMode === "replace" ? "replace" : "merge",
      providers: normalizeProviderConfigMap(modelsBlock?.providers),
    };

    const authBlock = isRecord(parsed.auth) ? parsed.auth : null;
    const profiles = authBlock && isRecord(authBlock.profiles) ? authBlock.profiles : null;
    const authProviders = profiles
      ? uniqueStrings(
          Object.values(profiles).map((profile) => {
            if (!isRecord(profile)) return "";
            return typeof profile.provider === "string" ? profile.provider : "";
          }),
        )
      : [];

    const configuredModelSet = new Set<string>();
    if (defaultsModel?.primary) configuredModelSet.add(defaultsModel.primary);
    for (const fallback of defaultsModel?.fallbacks || []) configuredModelSet.add(fallback);
    for (const allowed of allowedModels) configuredModelSet.add(allowed);
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      for (const modelRef of collectModelRefsFromValue(entry.model)) {
        configuredModelSet.add(modelRef);
      }
    }
    const configuredModels = [...configuredModelSet];

    const providerSet = new Set<string>();
    for (const modelKey of configuredModels) providerSet.add(providerFromModelKey(modelKey));
    for (const provider of authProviders) providerSet.add(provider);
    for (const row of modelsCatalogConfig.providers) providerSet.add(row.provider);
    providerSet.delete("custom");
    const configuredProviders = [...providerSet].sort((a, b) => a.localeCompare(b));

    return {
      defaultsModel: defaultsModel?.primary ? defaultsModel : null,
      allowedModels,
      modelsCatalogConfig,
      configuredModels: configuredModels.sort((a, b) => a.localeCompare(b)),
      configuredProviders,
      authProviders,
    };
  } catch {
    return null;
  }
}

function normalizeHttpBaseUrl(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  const trimmed = withScheme.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

async function readConfiguredOllamaBaseUrlFromFile(): Promise<string> {
  try {
    const configPath = join(OPENCLAW_HOME, "openclaw.json");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const models = isRecord(parsed.models) ? parsed.models : null;
    const providers = models && isRecord(models.providers) ? models.providers : null;
    const ollama = providers && isRecord(providers.ollama) ? providers.ollama : null;
    if (!ollama) return "";
    const base =
      (typeof ollama.baseUrl === "string" && ollama.baseUrl) ||
      (typeof ollama.baseURL === "string" && ollama.baseURL) ||
      (typeof ollama.url === "string" && ollama.url) ||
      "";
    return normalizeHttpBaseUrl(base);
  } catch {
    return "";
  }
}

function parseOllamaTagsPayload(payload: unknown): ModelInfo[] {
  const body = isRecord(payload) ? payload : null;
  const rows = body && Array.isArray(body.models) ? body.models : [];
  const out: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const rawName =
      (typeof row.name === "string" && row.name) ||
      (typeof row.model === "string" && row.model) ||
      "";
    const modelName = String(rawName).trim();
    if (!modelName) continue;
    const key = `ollama/${modelName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      name: `Ollama: ${modelName}`,
      input: "text",
      contextWindow: 0,
      local: true,
      available: true,
      tags: ["local"],
      missing: false,
    });
  }
  return out;
}

async function fetchOllamaTagsAtBase(baseUrl: string, timeoutMs: number): Promise<ModelInfo[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return [];
    return parseOllamaTagsPayload(await res.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function mergeModelRows(primary: ModelInfo[], extra: ModelInfo[]): ModelInfo[] {
  const out: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const row of [...primary, ...extra]) {
    const key = String(row.key || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function readOllamaLocalModels(timeoutMs = 1200): Promise<ModelInfo[]> {
  const configuredBase = await readConfiguredOllamaBaseUrlFromFile();
  const candidates = uniqueStrings([
    normalizeHttpBaseUrl(process.env.OLLAMA_BASE_URL),
    configuredBase,
    "http://127.0.0.1:11434",
    "http://localhost:11434",
  ]);

  let firstReachable: ModelInfo[] | null = null;
  for (const base of candidates) {
    const models = await fetchOllamaTagsAtBase(base, timeoutMs);
    if (models.length > 0) {
      return models;
    }
    if (firstReachable === null) {
      firstReachable = models;
    }
  }
  return firstReachable || [];
}

function buildAllowedModelsPatchValue(
  expectedModels: string[],
  currentRaw: unknown
): string[] | Record<string, Record<string, unknown>> {
  if (Array.isArray(currentRaw)) {
    return [...expectedModels];
  }

  const existing = isRecord(currentRaw)
    ? (currentRaw as Record<string, unknown>)
    : null;
  const next: Record<string, Record<string, unknown>> = {};

  for (const key of expectedModels) {
    let preserved: Record<string, unknown> | null = null;
    if (existing) {
      const exact = existing[key];
      if (isRecord(exact)) {
        preserved = { ...exact };
      } else {
        for (const [rawKey, rawValue] of Object.entries(existing)) {
          if (canonicalAllowedModelKey(rawKey) !== key) continue;
          if (isRecord(rawValue)) {
            preserved = { ...rawValue };
          }
          break;
        }
      }
    }
    next[key] = preserved ?? {};
  }

  return next;
}

async function writeDefaultsAllowedModels(
  expectedModels: string[],
  currentRaw: unknown
): Promise<void> {
  const patchValue = buildAllowedModelsPatchValue(expectedModels, currentRaw);
  await runCli(
    [
      "config",
      "set",
      "--strict-json",
      "agents.defaults.models",
      JSON.stringify(patchValue),
    ],
    15000
  );
}

// gatewayCallWithRetry, applyConfigPatchWithRetry, isGatewayTransientError
// imported from @/lib/gateway-config as _gatewayCallWithRetry, patchConfig, _isGatewayTransientError
const gatewayCallWithRetry = _gatewayCallWithRetry;
const isGatewayTransientError = _isGatewayTransientError;
async function applyConfigPatchWithRetry(
  rawPatch: Record<string, unknown>,
  maxAttempts = 8,
): Promise<void> {
  return patchConfig(rawPatch, { maxAttempts });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMatch<T>(
  read: () => Promise<T>,
  match: (snapshot: T) => boolean,
  timeoutMs = VERIFY_TIMEOUT_MS,
  intervalMs = VERIFY_INTERVAL_MS
): Promise<{ matched: boolean; snapshot: T | null }> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null = null;
  while (Date.now() <= deadline) {
    try {
      last = await read();
      if (match(last)) {
        return { matched: true, snapshot: last };
      }
    } catch {
      // retry until timeout
    }
    await sleep(intervalMs);
  }
  return { matched: false, snapshot: last };
}

// (inline gatewayCallWithRetry / applyConfigPatchWithRetry / isGatewayTransientError removed — using shared lib)

async function readDefaultsModelConfig(): Promise<DefaultsModelConfig | null> {
  try {
    const configData = await gatewayCallWithRetry<Record<string, unknown>>(
      "config.get",
      undefined,
      10000
    );
    const parsed = (configData.parsed || {}) as Record<string, unknown>;
    const agents = (parsed.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    return normalizeModelConfig(defaults.model);
  } catch {
    return null;
  }
}

type HeartbeatConfig = { every: string; model: string };

async function readDefaultsHeartbeat(): Promise<HeartbeatConfig | null> {
  try {
    const configData = await gatewayCallWithRetry<Record<string, unknown>>(
      "config.get",
      undefined,
      10000
    );
    const parsed = (configData.parsed || {}) as Record<string, unknown>;
    const agents = (parsed.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    const hb = defaults.heartbeat;
    if (hb && typeof hb === "object" && !Array.isArray(hb)) {
      const h = hb as Record<string, unknown>;
      return {
        every: typeof h.every === "string" ? h.every : "",
        model: typeof h.model === "string" ? h.model : "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function readDefaultsModelConfigFromFile(): Promise<DefaultsModelConfig | null> {
  try {
    const raw = await readFile(join(OPENCLAW_HOME, "openclaw.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const agents = (parsed.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    return normalizeModelConfig(defaults.model);
  } catch {
    return null;
  }
}

async function readDefaultsAllowedModels(): Promise<string[] | null> {
  try {
    const configData = await gatewayCallWithRetry<Record<string, unknown>>(
      "config.get",
      undefined,
      10000
    );
    const parsed = (configData.parsed || {}) as Record<string, unknown>;
    const agents = (parsed.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    return normalizeAllowedModelList(defaults.models);
  } catch {
    return null;
  }
}

async function readDefaultsAllowedModelsFromFile(): Promise<string[] | null> {
  try {
    const raw = await readFile(join(OPENCLAW_HOME, "openclaw.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const agents = (parsed.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    return normalizeAllowedModelList(defaults.models);
  } catch {
    return null;
  }
}

async function readDefaultsAllowedModelsRaw(): Promise<unknown | null> {
  try {
    const configData = await gatewayCallWithRetry<Record<string, unknown>>(
      "config.get",
      undefined,
      10000
    );
    const parsed = (configData.parsed || {}) as Record<string, unknown>;
    const agents = (parsed.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    return defaults.models ?? null;
  } catch {
    return null;
  }
}

async function waitForPersistedAllowedModels(
  expected: string[]
): Promise<{ matched: boolean; snapshot: AllowedModelsMatchSnapshot | null }> {
  return waitForMatch<AllowedModelsMatchSnapshot>(
    async () => {
      const [gateway, file] = await Promise.all([
        readDefaultsAllowedModels(),
        readDefaultsAllowedModelsFromFile(),
      ]);
      return { gateway, file };
    },
    (snapshot) =>
      Boolean(snapshot.gateway) &&
      Boolean(snapshot.file) &&
      equalStringSets(snapshot.gateway!, expected) &&
      equalStringSets(snapshot.file!, expected)
  );
}

async function patchDefaultsModelConfig(
  primary: string,
  fallbacks: string[]
): Promise<void> {
  await applyConfigPatchWithRetry({
    agents: {
      defaults: {
        model: { primary, fallbacks },
      },
    },
  });
}

async function waitForPersistedDefaults(
  expectedPrimary: string,
  expectedFallbacks: string[]
): Promise<{ matched: boolean; snapshot: DefaultsMatchSnapshot | null }> {
  return waitForMatch<DefaultsMatchSnapshot>(
    async () => {
      const [gateway, file] = await Promise.all([
        readDefaultsModelConfig(),
        readDefaultsModelConfigFromFile(),
      ]);
      return { gateway, file };
    },
    (snapshot) =>
      Boolean(snapshot.gateway) &&
      Boolean(snapshot.file) &&
      snapshot.gateway!.primary === expectedPrimary &&
      snapshot.file!.primary === expectedPrimary &&
      arraysEqual(snapshot.gateway!.fallbacks, expectedFallbacks) &&
      arraysEqual(snapshot.file!.fallbacks, expectedFallbacks)
  );
}

async function readParsedAgentModelConfig(
  agentId: string
): Promise<ParsedAgentModelConfig | null> {
  try {
    const configData = await gatewayCallWithRetry<Record<string, unknown>>(
      "config.get",
      undefined,
      10000
    );
    const parsed = (configData.parsed || {}) as Record<string, unknown>;
    const agents = (parsed.agents || {}) as Record<string, unknown>;
    const list = ((agents.list || []) as Record<string, unknown>[]);
    const agent = list.find((a) => a.id === agentId);
    if (!agent) return null;
    const model = agent.model as
      | string
      | { primary?: string; fallbacks?: string[] }
      | undefined;
    if (typeof model === "string") {
      return { usesDefaults: false, primary: model, fallbacks: null };
    }
    if (model && isRecord(model)) {
      const primary = typeof model.primary === "string" ? model.primary : null;
      const fallbacks = Array.isArray(model.fallbacks)
        ? model.fallbacks.map((f) => String(f))
        : [];
      return { usesDefaults: false, primary, fallbacks };
    }
    return { usesDefaults: true, primary: null, fallbacks: null };
  } catch {
    return null;
  }
}

async function readLiveModels(agentIds: string[]): Promise<Record<string, LiveModelInfo>> {
  const out: Record<string, LiveModelInfo> = {};
  try {
    const ids = new Set(agentIds.filter(Boolean));
    const sessions = await fetchGatewaySessions(10000);
    for (const session of sessions) {
      if (!session.agentId) continue;
      if (ids.size > 0 && !ids.has(session.agentId)) continue;
      const prev = out[session.agentId];
      if (prev && (prev.updatedAt || 0) >= session.updatedAt) continue;
      out[session.agentId] = {
        fullModel: session.fullModel || null,
        model: session.model || null,
        provider: session.modelProvider || null,
        updatedAt: session.updatedAt || null,
        sessionKey: session.key || null,
      };
    }
  } catch {
    // ignore
  }
  return out;
}

/**
 * GET /api/models - Returns model configuration and available models.
 *
 * Query params:
 *   scope=status  - fast summary for first paint (default)
 *   scope=details - full runtime/CLI-backed details for advanced controls
 *   scope=summary - alias for fast summary
 *   scope=configured - configured models only
 *   scope=all - all 700+ available models (for the model picker)
 *   agent=<id> - get per-agent model config
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "status";
  const agentId = searchParams.get("agent");
  const forceRefresh = searchParams.get("refresh") === "1";

  try {
    if (scope === "status" || scope === "summary") {
      const summary = await buildModelsSummary();
      return jsonNoStore(summary);
    }

    if (scope === "details") {
      // Use buildModelsSummary() for status and models list (replaces CLI calls)
      let status: ModelStatus | null = null;
      let statusWarning: string | null = null;
      let listModels: ModelInfo[] = [];
      let listWarning: string | null = null;
      try {
        const summary = await buildModelsSummary();
        status = summary.status;
        listModels = summary.models;
        if (summary.warning) statusWarning = summary.warning;
      } catch (err) {
        statusWarning = String(err);
      }
      const fileSnapshot = await readConfigFileSnapshot();

      // Get per-agent configs from gateway (non-critical — gracefully degrade)
      let defaultsModel: DefaultsModelConfig | null = null;
      let parsedAllowedModels: string[] = [];
      let modelsCatalogConfig: ModelsCatalogConfig = {
        mode: "merge",
        providers: [],
      };
      let agentsList: {
        id: string;
        name: string;
        modelPrimary: string | null;
        modelFallbacks: string[] | null;
        usesDefaults: boolean;
        subagents: string[];
        parentId: string | null;
      }[] = [];
      let configHash: string | null = null;
      let defaultsHeartbeat: { every: string; model: string } | null = null;
      try {
        const configData = await gatewayCallWithRetry<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        configHash = (configData.hash as string) || null;
        // config.get returns { resolved: { agents: { defaults, list } }, parsed: {...}, hash: "..." }
        const parsed = (configData.parsed || {}) as Record<string, unknown>;
        const resolved = (configData.resolved || {}) as Record<string, unknown>;
        const agentsBlock = (resolved.agents || {}) as Record<string, unknown>;
        const parsedDefaultsAgents = (parsed.agents || {}) as Record<string, unknown>;
        const parsedModelsBlock = (parsed.models || {}) as Record<string, unknown>;
        const parsedDefaultsBlock = (parsedDefaultsAgents.defaults || {}) as Record<string, unknown>;
        const resolvedDefaultsBlock = (agentsBlock.defaults || {}) as Record<string, unknown>;
        const resolvedDefaultsModel = normalizeModelConfig(resolvedDefaultsBlock.model);
        const parsedDefaultsModel = normalizeModelConfig(parsedDefaultsBlock.model);
        defaultsModel = resolvedDefaultsModel.primary
          ? resolvedDefaultsModel
          : parsedDefaultsModel.primary
            ? parsedDefaultsModel
            : null;
        const hb = parsedDefaultsBlock.heartbeat;
        parsedAllowedModels = normalizeAllowedModelList(parsedDefaultsBlock.models);
        const rawMode =
          typeof parsedModelsBlock.mode === "string"
            ? parsedModelsBlock.mode.trim().toLowerCase()
            : "";
        modelsCatalogConfig = {
          mode: rawMode === "replace" ? "replace" : "merge",
          providers: normalizeProviderConfigMap(parsedModelsBlock.providers),
        };
        if (hb && typeof hb === "object" && !Array.isArray(hb)) {
          const h = hb as Record<string, unknown>;
          defaultsHeartbeat = {
            every: typeof h.every === "string" ? h.every : "",
            model: typeof h.model === "string" ? h.model : "",
          };
        }
        const entries = (agentsBlock.list || []) as Record<string, unknown>[];
        const parsedAgents = entries.map((a) => {
          const agentModel = a.model as
            | string
            | { primary?: string; fallbacks?: string[] }
            | undefined;
          const subagentsBlock = (a.subagents || {}) as Record<string, unknown>;
          const subagents = Array.isArray(subagentsBlock.allowAgents)
            ? (subagentsBlock.allowAgents as string[])
            : [];
          let primary: string | null = null;
          let fallbacks: string[] | null = null;
          if (typeof agentModel === "string") {
            primary = agentModel;
          } else if (agentModel && typeof agentModel === "object") {
            primary = agentModel.primary || null;
            fallbacks = agentModel.fallbacks || null;
          }
          return {
            id: a.id as string,
            name: (a.name as string) || (a.id as string),
            modelPrimary: primary,
            modelFallbacks: fallbacks,
            usesDefaults: !agentModel,
            subagents,
          };
        });
        const parentById: Record<string, string> = {};
        for (const agent of parsedAgents) {
          for (const childId of agent.subagents) {
            if (!parentById[childId]) {
              parentById[childId] = agent.id;
            }
          }
        }
        agentsList = parsedAgents.map((agent) => ({
          ...agent,
          parentId: parentById[agent.id] || null,
        }));
      } catch (gwErr) {
        console.warn("Models API: gateway config.get unavailable, continuing without agent configs:", gwErr);
      }

      if (!defaultsModel && fileSnapshot?.defaultsModel) {
        defaultsModel = fileSnapshot.defaultsModel;
      }
      if (parsedAllowedModels.length === 0 && fileSnapshot?.allowedModels.length) {
        parsedAllowedModels = fileSnapshot.allowedModels;
      }
      // The file is the source of truth for models.providers because
      // set-provider-config / remove-provider-config write via CLI
      // (which correctly replaces/deletes values). The gateway's in-memory
      // config may lag behind until restart, so always prefer the file.
      if (fileSnapshot?.modelsCatalogConfig) {
        modelsCatalogConfig = fileSnapshot.modelsCatalogConfig;
      }
      if (listModels.length === 0 && fileSnapshot?.configuredModels.length) {
        listModels = fileSnapshot.configuredModels.map((key) => {
          const provider = providerFromModelKey(key);
          return {
            key,
            name: key,
            input: "",
            contextWindow: 0,
            local: localProvider(provider),
            available: true,
            tags: ["configured"],
            missing: false,
          } satisfies ModelInfo;
        });
      }

      // Read last actually-used model per agent from sessions metadata.
      const liveModels = await readLiveModels(agentsList.map((a) => a.id));
      // Derive per-agent statuses from config data (replaces N CLI subprocess calls)
      const agentStatuses: Record<string, AgentRuntimeStatus> = {};
      for (const agent of agentsList) {
        const agentPrimary = agent.modelPrimary || defaultsModel?.primary || "";
        const agentFallbacks = agent.modelFallbacks != null
          ? agent.modelFallbacks
          : defaultsModel?.fallbacks || [];
        agentStatuses[agent.id] = {
          defaultModel: agentPrimary,
          resolvedDefault: agentPrimary,
          fallbacks: agentFallbacks,
        };
      }
      const statusForResponse = status
        ? defaultsModel
          ? {
              ...status,
              defaultModel: defaultsModel.primary || status.defaultModel,
              fallbacks: defaultsModel.fallbacks,
            }
          : status
        : fallbackModelStatus(defaultsModel, listModels);

      const warning = [statusWarning, listWarning].filter(Boolean).join(" | ");

      return jsonNoStore({
        status: statusForResponse,
        defaults: defaultsModel,
        allowedConfigured: parsedAllowedModels,
        configuredProviders: fileSnapshot?.configuredProviders || [],
        heartbeat: defaultsHeartbeat,
        models: listModels,
        agents: agentsList,
        agentStatuses,
        liveModels,
        configHash,
        modelsCatalogConfig,
        warning: warning || undefined,
      });
    }

    if (scope === "all") {
      if (!forceRefresh && modelsAllCache && modelsAllCache.expiresAt > Date.now()) {
        return jsonNoStore(modelsAllCache.payload);
      }
      const fileSnapshot = await readConfigFileSnapshot();
      // Fetch models and auth status in parallel
      const [listResult, statusData, ollamaModels] = await Promise.all([
        runCliJson<{ count: number; models: ModelInfo[] }>(
          ["models", "list", "--all"],
          15000
        ).catch((err) => ({ error: String(err) })),
        runCliJson<Record<string, unknown>>(["models", "status"], 10000).catch(
          () => null
        ),
        readOllamaLocalModels(),
      ]);

      const listError = "error" in listResult ? listResult.error : null;
      const listModels =
        "models" in listResult && Array.isArray(listResult.models)
          ? listResult.models
          : [];
      // Extract auth providers from status
      const auth = (statusData?.auth || {}) as Record<string, unknown>;
      const authProviders = (
        (auth.providers || []) as Array<{
          provider: string;
          effective?: { kind: string; detail: string };
        }>
      ).map((p) => ({
        provider: p.provider,
        authenticated: !!p.effective,
        authKind: p.effective?.kind || null,
      }));
      for (const provider of fileSnapshot?.authProviders || []) {
        if (authProviders.some((entry) => entry.provider === provider)) continue;
        authProviders.push({
          provider,
          authenticated: true,
          authKind: "config",
        });
      }

      // Extract OAuth status
      const oauthBlock = (auth.oauth || {}) as Record<string, unknown>;
      const oauthProfiles = (
        (oauthBlock.profiles || []) as Array<{
          provider: string;
          status: string;
          remainingMs?: number;
        }>
      ).map((p) => ({
        provider: p.provider,
        status: p.status,
        remainingMs: p.remainingMs,
      }));

      const fallbackAllowed = Array.isArray(statusData?.allowed)
        ? (statusData?.allowed as unknown[]).map((m) => String(m)).filter(Boolean)
        : [];
      const fallbackRefs = uniqueStrings([
        ...fallbackAllowed,
        ...(fileSnapshot?.configuredModels || []),
      ]);
      const fallbackModels: ModelInfo[] = fallbackRefs.map((key) => {
        const provider = providerFromModelKey(key);
        const hasConfiguredAuth = authProviders.some((entry) => entry.provider === provider);
        return {
          key,
          name: key,
          input: "",
          contextWindow: 0,
          local: localProvider(provider),
          available: localProvider(provider) || hasConfiguredAuth,
          tags: [],
          missing: false,
        };
      });
      const catalogModels = mergeModelRows(listModels, ollamaModels);
      const models = mergeModelRows(catalogModels, fallbackModels);
      const count = models.length;
      const hasOllamaConfigured = Boolean(
        process.env.OLLAMA_BASE_URL ||
          authProviders.some((entry) => entry.provider === "ollama") ||
          fallbackRefs.some((key) => key.startsWith("ollama/")) ||
          (fileSnapshot?.configuredProviders || []).includes("ollama")
      );
      const hasOllamaCatalog = models.some((entry) => entry.key.startsWith("ollama/"));
      const ollamaWarning =
        hasOllamaConfigured && !hasOllamaCatalog
          ? "Ollama is configured but no local tool-capable models were discovered. In OpenClaw, Ollama auto-discovery only includes models that support tool calling."
          : null;
      const warning = [listError, ollamaWarning].filter(Boolean).join(" | ");
      const payload = {
        count,
        models,
        authProviders,
        oauthProfiles,
        warning: warning || undefined,
      };
      modelsAllCache = {
        expiresAt: Date.now() + MODELS_ALL_CACHE_TTL_MS,
        payload,
      };
      return jsonNoStore(payload);
    }

    // scope=configured
    if (!agentId) {
      const summary = await buildModelsSummary();
      return jsonNoStore({
        models: summary.models,
        warning: summary.warning,
        degraded: summary.degraded,
      });
    }

    const fileSnapshot = await readConfigFileSnapshot();
    const args = ["models", "list"];
    if (agentId) args.push("--agent", agentId);
    try {
      const [listResult, statusData, ollamaModels] = await Promise.all([
        runCliJson<{ models: ModelInfo[] }>(args, 10000).catch((err) => ({
          error: String(err),
        })),
        runCliJson<Record<string, unknown>>(
          agentId ? ["models", "status", "--agent", agentId] : ["models", "status"],
          10000,
        ).catch(() => null),
        readOllamaLocalModels(),
      ]);

      const listWarning = "error" in listResult ? listResult.error : null;
      const listModels =
        "models" in listResult && Array.isArray(listResult.models)
          ? mergeModelRows(listResult.models, ollamaModels)
          : ollamaModels;

      const authProviders = uniqueStrings([
        ...((((statusData?.auth as { providers?: Array<{ provider?: string }> } | undefined))?.providers || [])
          .map((entry) => String(entry?.provider || "").trim())
          .filter(Boolean)),
        ...(fileSnapshot?.authProviders || []),
      ]);

      const configuredRefs = uniqueStrings([
        ...((Array.isArray(statusData?.allowed) ? statusData.allowed : []).map((value) =>
          String(value || "").trim(),
        )),
        ...(fileSnapshot?.configuredModels || []),
      ]);
      const fallbackModels: ModelInfo[] = configuredRefs.map((key) => {
        const provider = providerFromModelKey(key);
        const hasConfiguredAuth = authProviders.includes(provider);
        return {
          key,
          name: key,
          input: "",
          contextWindow: 0,
          local: localProvider(provider),
          available: localProvider(provider) || hasConfiguredAuth,
          tags: ["configured"],
          missing: false,
        };
      });

      const models = mergeModelRows(listModels, fallbackModels);
      return jsonNoStore({
        models,
        warning: listWarning || undefined,
      });
    } catch (err) {
      return jsonNoStore({
        models: [],
        warning: String(err),
      });
    }
  } catch (err) {
    console.error("Models API GET error:", err);
    return jsonNoStore({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/models - Apply model changes.
 *
 * Body:
 *   { action: "set-primary", model: "provider/model" }
 *   { action: "set-fallbacks", fallbacks: ["model1", "model2"] }
 *   { action: "add-fallback", model: "provider/model" }
 *   { action: "remove-fallback", model: "provider/model" }
 *   { action: "reorder", primary: "...", fallbacks: [...] }
 *   { action: "set-agent-model", agentId: "...", primary: "...", fallbacks: [...] | null }
 *   { action: "reset-agent-model", agentId: "..." }  // remove per-agent override
 *   { action: "set-alias", alias: "...", model: "..." }
 *   { action: "remove-alias", alias: "..." }
 *   { action: "set-heartbeat", model?: "...", every?: "..." }  // agents.defaults.heartbeat
 *   { action: "set-allowed-models", models: ["provider/model", ...] }
 *   { action: "add-allowed-model", model: "provider/model" }
 *   { action: "remove-allowed-model", model: "provider/model" }
 *   { action: "set-image-model", model: "provider/model" }
 *   { action: "set-image-fallbacks", fallbacks: ["provider/model", ...] }
 *   { action: "add-image-fallback", model: "provider/model" }
 *   { action: "remove-image-fallback", model: "provider/model" }
 *   { action: "clear-image-fallbacks" }
 *   { action: "set-models-mode", mode: "merge" | "replace" }
 *   { action: "set-provider-config", provider: "...", config: {...} }
 *   { action: "remove-provider-config", provider: "..." }
 *   { action: "get-auth-order", agentId: "...", provider: "..." }
 *   { action: "set-auth-order", agentId: "...", provider: "...", profileIds: ["provider:id", ...] }
 *   { action: "clear-auth-order", agentId: "...", provider: "..." }
 *   { action: "scan-models", provider?: "...", noProbe?: boolean }
 *   { action: "auth-provider", provider: "...", token: "..." }  // paste API key/token for a provider
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;
    invalidateModelsAllCache();

    switch (action) {
      case "set-primary": {
        const desiredPrimary = String(body.model || "");
        if (!desiredPrimary) {
          return jsonNoStore(
            { error: "Model is required" },
            { status: 400 }
          );
        }
        const defaults = await readDefaultsModelConfig();
        if (!defaults) {
          return jsonNoStore(
            { error: "Failed to read defaults model config" },
            { status: 500 }
          );
        }
        const nextFallbacks = defaults.fallbacks.filter((f) => f !== desiredPrimary);
        await patchDefaultsModelConfig(desiredPrimary, nextFallbacks);
        const verified = await waitForPersistedDefaults(desiredPrimary, nextFallbacks);
        if (!verified.matched) {
          return jsonNoStore(
            {
              error: `Model change could not be verified for defaults primary (${desiredPrimary})`,
              observed: verified.snapshot,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ ok: true, action, model: desiredPrimary });
      }

      case "add-fallback": {
        const fallbackModel = String(body.model || "");
        if (!fallbackModel) {
          return jsonNoStore(
            { error: "Fallback model is required" },
            { status: 400 }
          );
        }
        const defaults = await readDefaultsModelConfig();
        if (!defaults) {
          return jsonNoStore(
            { error: "Failed to read defaults model config" },
            { status: 500 }
          );
        }
        const nextFallbacks = defaults.fallbacks.includes(fallbackModel)
          ? defaults.fallbacks
          : [...defaults.fallbacks, fallbackModel];
        await patchDefaultsModelConfig(defaults.primary, nextFallbacks);
        const verified = await waitForPersistedDefaults(defaults.primary, nextFallbacks);
        if (!verified.matched) {
          return jsonNoStore(
            {
              error: `Fallback add could not be verified (${fallbackModel})`,
              observed: verified.snapshot,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ ok: true, action, model: fallbackModel });
      }

      case "remove-fallback": {
        const fallbackModel = String(body.model || "");
        if (!fallbackModel) {
          return jsonNoStore(
            { error: "Fallback model is required" },
            { status: 400 }
          );
        }
        const defaults = await readDefaultsModelConfig();
        if (!defaults) {
          return jsonNoStore(
            { error: "Failed to read defaults model config" },
            { status: 500 }
          );
        }
        const nextFallbacks = defaults.fallbacks.filter((f) => f !== fallbackModel);
        await patchDefaultsModelConfig(defaults.primary, nextFallbacks);
        const verified = await waitForPersistedDefaults(defaults.primary, nextFallbacks);
        if (!verified.matched) {
          return jsonNoStore(
            {
              error: `Fallback removal could not be verified (${fallbackModel})`,
              observed: verified.snapshot,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ ok: true, action, model: fallbackModel });
      }

      case "set-fallbacks": {
        const defaults = await readDefaultsModelConfig();
        if (!defaults) {
          return jsonNoStore(
            { error: "Failed to read defaults model config" },
            { status: 500 }
          );
        }
        const expectedFallbacks = Array.isArray(body.fallbacks)
          ? body.fallbacks.map((f: unknown) => String(f))
          : [];
        await patchDefaultsModelConfig(defaults.primary, expectedFallbacks);
        const verified = await waitForPersistedDefaults(
          defaults.primary,
          expectedFallbacks
        );
        if (!verified.matched) {
          return jsonNoStore(
            {
              error: "Fallback list update could not be verified",
              expectedFallbacks,
              observed: verified.snapshot,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ ok: true, action, fallbacks: body.fallbacks });
      }

      case "reorder": {
        const expectedPrimary = (body.primary as string) || "";
        if (!expectedPrimary) {
          return jsonNoStore(
            { error: "Primary model is required" },
            { status: 400 }
          );
        }
        const expectedFallbacks = Array.isArray(body.fallbacks)
          ? body.fallbacks.map((f: unknown) => String(f))
          : [];
        await patchDefaultsModelConfig(expectedPrimary, expectedFallbacks);
        const verified = await waitForPersistedDefaults(
          expectedPrimary,
          expectedFallbacks
        );
        if (!verified.matched) {
          return jsonNoStore(
            {
              error: "Model reorder could not be verified",
              expectedPrimary,
              expectedFallbacks,
              observed: verified.snapshot,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({
          ok: true,
          action,
          primary: body.primary,
          fallbacks: body.fallbacks,
        });
      }

      case "set-agent-model": {
        // Use config.patch to set per-agent model
        const configData = await gatewayCallWithRetry<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        const parsed = (configData.parsed || {}) as Record<string, unknown>;
        const agents = (parsed.agents || {}) as Record<string, unknown>;
        const list = ((agents.list || []) as Record<string, unknown>[]);
        const agentIdx = list.findIndex((a) => a.id === body.agentId);
        if (agentIdx === -1) {
          return NextResponse.json(
            { error: `Agent ${body.agentId} not found` },
            { status: 404 }
          );
        }

        // Build the model value
        const modelValue =
          body.fallbacks != null
            ? { primary: body.primary, fallbacks: body.fallbacks }
            : body.primary;

        // Patch just this agent's model
        await applyConfigPatchWithRetry({
          agents: {
            list: list.map((a, i) =>
              i === agentIdx ? { ...a, model: modelValue } : a
            ),
          },
        });
        const expectedPrimary = body.primary as string;
        const expectedFallbacks =
          body.fallbacks != null && Array.isArray(body.fallbacks)
            ? body.fallbacks.map((f: unknown) => String(f))
            : null;
        const verified = await waitForMatch(
          () => readParsedAgentModelConfig(String(body.agentId)),
          (cfg) => {
            if (!cfg) return false;
            if (cfg.usesDefaults) return false;
            if (cfg.primary !== expectedPrimary) return false;
            if (expectedFallbacks == null) {
              return cfg.fallbacks === null;
            }
            if (
              expectedFallbacks &&
              !arraysEqual(cfg.fallbacks || [], expectedFallbacks)
            ) {
              return false;
            }
            return true;
          }
        );
        if (!verified.matched) {
          return jsonNoStore(
            {
              error: `Agent model update could not be verified for ${body.agentId}`,
              expectedPrimary,
              expectedFallbacks,
              observed: verified.snapshot,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({
          ok: true,
          action,
          agentId: body.agentId,
          model: modelValue,
        });
      }

      case "reset-agent-model": {
        // Remove per-agent model override (inherit defaults)
        const configData2 = await gatewayCallWithRetry<Record<string, unknown>>(
          "config.get",
          undefined,
          10000
        );
        const parsed2 = (configData2.parsed || {}) as Record<string, unknown>;
        const agents2 = (parsed2.agents || {}) as Record<string, unknown>;
        const list2 = ((agents2.list || []) as Record<string, unknown>[]);
        const agentIdx = list2.findIndex((a) => a.id === body.agentId);
        if (agentIdx === -1) {
          return NextResponse.json(
            { error: `Agent ${body.agentId} not found` },
            { status: 404 }
          );
        }

        const updatedList = list2.map((a, i) => {
          if (i !== agentIdx) return a;
          const rest = { ...a };
          delete rest.model;
          return rest;
        });

        await applyConfigPatchWithRetry({ agents: { list: updatedList } });
        const verified = await waitForMatch(
          () => readParsedAgentModelConfig(String(body.agentId)),
          (cfg) => Boolean(cfg) && cfg!.usesDefaults
        );
        if (!verified.matched) {
          return jsonNoStore(
            {
              error: `Agent reset-to-default could not be verified for ${body.agentId}`,
              observed: verified.snapshot,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ ok: true, action, agentId: body.agentId });
      }

      case "set-alias": {
        const alias = String(body.alias || "").trim();
        const target = String(body.model || "").trim();
        if (!alias || !target) {
          return jsonNoStore({ error: "alias and model are required" }, { status: 400 });
        }
        await applyConfigPatchWithRetry({
          agents: { defaults: { aliases: { [alias]: target } } },
        });
        return NextResponse.json({
          ok: true,
          action,
          alias,
          model: target,
        });
      }

      case "remove-alias": {
        const alias = String(body.alias || "").trim();
        if (!alias) {
          return jsonNoStore({ error: "alias is required" }, { status: 400 });
        }
        // Set to null to remove via config.patch deep merge
        await applyConfigPatchWithRetry({
          agents: { defaults: { aliases: { [alias]: null } } },
        });
        return NextResponse.json({ ok: true, action, alias });
      }

      case "set-heartbeat": {
        const current = await readDefaultsHeartbeat();
        const next: HeartbeatConfig = {
          every: current?.every ?? "1h",
          model: current?.model ?? "",
        };
        if (body.model !== undefined && body.model !== null) {
          next.model = String(body.model);
        }
        if (body.every !== undefined && body.every !== null) {
          next.every = String(body.every);
        }
        await applyConfigPatchWithRetry({
          agents: { defaults: { heartbeat: next } },
        });
        return NextResponse.json({
          ok: true,
          action,
          heartbeat: next,
        });
      }

      case "set-allowed-models": {
        const expectedModels = normalizeAllowedModelList(body.models);
        const currentRaw = await readDefaultsAllowedModelsRaw();
        await writeDefaultsAllowedModels(expectedModels, currentRaw);
        const verified = await waitForPersistedAllowedModels(expectedModels);
        if (!verified.matched) {
          return jsonNoStore(
            {
              error: "Allowed models update could not be verified",
              expectedModels,
              observed: verified.snapshot,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ ok: true, action, models: expectedModels });
      }

      case "add-allowed-model": {
        const nextModel = canonicalAllowedModelKey(body.model);
        if (!nextModel) {
          return jsonNoStore(
            { error: "Model is required" },
            { status: 400 }
          );
        }
        const current = await readDefaultsAllowedModels();
        if (!current) {
          return jsonNoStore(
            { error: "Failed to read current allowed models" },
            { status: 500 }
          );
        }
        const expectedModels = current.includes(nextModel)
          ? current
          : [...current, nextModel];
        const currentRaw = await readDefaultsAllowedModelsRaw();
        await writeDefaultsAllowedModels(expectedModels, currentRaw);
        const verified = await waitForPersistedAllowedModels(expectedModels);
        if (!verified.matched) {
          return jsonNoStore(
            {
              error: `Allowed model add could not be verified (${nextModel})`,
              expectedModels,
              observed: verified.snapshot,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ ok: true, action, model: nextModel });
      }

      case "remove-allowed-model": {
        const model = canonicalAllowedModelKey(body.model);
        if (!model) {
          return jsonNoStore(
            { error: "Model is required" },
            { status: 400 }
          );
        }
        const current = await readDefaultsAllowedModels();
        if (!current) {
          return jsonNoStore(
            { error: "Failed to read current allowed models" },
            { status: 500 }
          );
        }
        const expectedModels = current.filter(
          (entry) => canonicalAllowedModelKey(entry) !== model
        );
        const currentRaw = await readDefaultsAllowedModelsRaw();
        await writeDefaultsAllowedModels(expectedModels, currentRaw);
        const verified = await waitForPersistedAllowedModels(expectedModels);
        if (!verified.matched) {
          return jsonNoStore(
            {
              error: `Allowed model removal could not be verified (${model})`,
              expectedModels,
              observed: verified.snapshot,
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ ok: true, action, model });
      }

      case "set-image-model": {
        const model = String(body.model || "").trim();
        if (!model) {
          return jsonNoStore(
            { error: "Image model is required" },
            { status: 400 }
          );
        }
        await applyConfigPatchWithRetry({
          agents: { defaults: { imageModel: model } },
        });
        return NextResponse.json({ ok: true, action, model });
      }

      case "set-image-fallbacks": {
        const fallbacks = normalizeAllowedModelList(body.fallbacks);
        await applyConfigPatchWithRetry({
          agents: { defaults: { imageFallbacks: fallbacks } },
        });
        return NextResponse.json({ ok: true, action, fallbacks });
      }

      case "add-image-fallback": {
        const model = canonicalAllowedModelKey(body.model);
        if (!model) {
          return jsonNoStore(
            { error: "Image fallback model is required" },
            { status: 400 }
          );
        }
        // Fetch current list, append, then patch
        const cfgForAdd = await fetchConfig(10000);
        const parsedAgentsAdd = isRecord(cfgForAdd.parsed.agents) ? cfgForAdd.parsed.agents : {};
        const parsedDefaultsAdd = isRecord(parsedAgentsAdd.defaults) ? parsedAgentsAdd.defaults : {};
        const currentFallbacksAdd = Array.isArray(parsedDefaultsAdd.imageFallbacks)
          ? parsedDefaultsAdd.imageFallbacks.map((f: unknown) => String(f))
          : [];
        if (!currentFallbacksAdd.includes(model)) {
          currentFallbacksAdd.push(model);
        }
        await applyConfigPatchWithRetry({
          agents: { defaults: { imageFallbacks: currentFallbacksAdd } },
        });
        return NextResponse.json({ ok: true, action, model });
      }

      case "remove-image-fallback": {
        const model = canonicalAllowedModelKey(body.model);
        if (!model) {
          return jsonNoStore(
            { error: "Image fallback model is required" },
            { status: 400 }
          );
        }
        // Fetch current list, filter, then patch
        const cfgForRm = await fetchConfig(10000);
        const parsedAgentsRm = isRecord(cfgForRm.parsed.agents) ? cfgForRm.parsed.agents : {};
        const parsedDefaultsRm = isRecord(parsedAgentsRm.defaults) ? parsedAgentsRm.defaults : {};
        const currentFallbacksRm = Array.isArray(parsedDefaultsRm.imageFallbacks)
          ? parsedDefaultsRm.imageFallbacks.map((f: unknown) => String(f)).filter((f: string) => f !== model)
          : [];
        await applyConfigPatchWithRetry({
          agents: { defaults: { imageFallbacks: currentFallbacksRm } },
        });
        return NextResponse.json({ ok: true, action, model });
      }

      case "clear-image-fallbacks": {
        await applyConfigPatchWithRetry({
          agents: { defaults: { imageFallbacks: [] } },
        });
        return NextResponse.json({ ok: true, action });
      }

      case "set-models-mode": {
        const mode = String(body.mode || "").trim().toLowerCase();
        if (mode !== "merge" && mode !== "replace") {
          return jsonNoStore(
            { error: "mode must be either \"merge\" or \"replace\"" },
            { status: 400 }
          );
        }
        await applyConfigPatchWithRetry({ models: { mode } });
        return NextResponse.json({ ok: true, action, mode });
      }

      case "set-provider-config": {
        const provider = normalizeProviderId(body.provider);
        if (!provider) {
          return jsonNoStore(
            { error: "Provider id is required" },
            { status: 400 }
          );
        }
        if (!isRecord(body.config)) {
          return jsonNoStore(
            { error: "config must be a JSON object" },
            { status: 400 }
          );
        }
        // config.patch deep-merges, which keeps stale keys the user removed.
        // To do a full replacement: read current providers, replace the entry,
        // and patch the whole providers block.
        const providerConfig = body.config as Record<string, unknown>;
        const cfgForSet = await fetchConfig(10000);
        const parsedModelsSet = isRecord(cfgForSet.parsed.models) ? cfgForSet.parsed.models : {};
        const currentProviders = isRecord(parsedModelsSet.providers)
          ? { ...(parsedModelsSet.providers as Record<string, unknown>) }
          : {};
        currentProviders[provider] = providerConfig;
        await applyConfigPatchWithRetry({ models: { providers: currentProviders } });
        return NextResponse.json({ ok: true, action, provider });
      }

      case "remove-provider-config": {
        const provider = normalizeProviderId(body.provider);
        if (!provider) {
          return jsonNoStore(
            { error: "Provider id is required" },
            { status: 400 }
          );
        }
        // Read current providers, remove the entry, and patch the whole block.
        const cfgForRm = await fetchConfig(10000);
        const parsedModelsRm = isRecord(cfgForRm.parsed.models) ? cfgForRm.parsed.models : {};
        const currentProvidersRm = isRecord(parsedModelsRm.providers)
          ? { ...(parsedModelsRm.providers as Record<string, unknown>) }
          : {};
        delete currentProvidersRm[provider];
        await applyConfigPatchWithRetry({ models: { providers: currentProvidersRm } });
        return NextResponse.json({ ok: true, action, provider });
      }

      case "get-auth-order": {
        const agentId = String(body.agentId || "main").trim() || "main";
        const provider = String(body.provider || "").trim();
        if (!provider) {
          return jsonNoStore(
            { error: "Provider is required" },
            { status: 400 }
          );
        }
        // Extract auth order from config
        const cfgAuth = await fetchConfig(10000);
        const parsedAuth = isRecord(cfgAuth.parsed.auth) ? cfgAuth.parsed.auth : {};
        const profiles = isRecord(parsedAuth.profiles) ? parsedAuth.profiles : {};
        // Filter profiles for the given provider
        const providerProfiles = Object.entries(profiles)
          .filter(([, profile]) => isRecord(profile) && String(profile.provider || "") === provider)
          .map(([id, profile]) => ({
            id,
            ...(isRecord(profile) ? profile : {}),
          }));
        // Check for agent-specific auth order
        const parsedAgentsAuth = isRecord(cfgAuth.parsed.agents) ? cfgAuth.parsed.agents : {};
        const agentListAuth = Array.isArray(parsedAgentsAuth.list) ? parsedAgentsAuth.list : [];
        const agentEntry = agentListAuth.find(
          (a: unknown) => isRecord(a) && String(a.id || "") === agentId
        ) as Record<string, unknown> | undefined;
        const agentAuthOrder = agentEntry && isRecord(agentEntry.authOrder)
          ? agentEntry.authOrder
          : {};
        const orderForProvider = Array.isArray(agentAuthOrder[provider])
          ? (agentAuthOrder[provider] as string[])
          : null;

        return NextResponse.json({
          ok: true,
          action,
          authOrder: {
            agentId,
            provider,
            profiles: providerProfiles,
            order: orderForProvider,
          },
        });
      }

      case "set-auth-order": {
        const agentId = String(body.agentId || "main").trim() || "main";
        const provider = String(body.provider || "").trim();
        const profileIds = normalizeStringList(body.profileIds);
        if (!provider) {
          return jsonNoStore(
            { error: "Provider is required" },
            { status: 400 }
          );
        }
        if (profileIds.length === 0) {
          return jsonNoStore(
            { error: "At least one auth profile id is required" },
            { status: 400 }
          );
        }
        // Set auth order on the agent's config entry
        const cfgForAuthSet = await fetchConfig(10000);
        const parsedAgentsSet = isRecord(cfgForAuthSet.parsed.agents) ? cfgForAuthSet.parsed.agents : {};
        const agentListSet = Array.isArray(parsedAgentsSet.list) ? [...parsedAgentsSet.list] : [];
        const agentIdxSet = agentListSet.findIndex(
          (a: unknown) => isRecord(a) && String(a.id || "") === agentId
        );
        if (agentIdxSet >= 0) {
          const entry = { ...(agentListSet[agentIdxSet] as Record<string, unknown>) };
          const existingOrder = isRecord(entry.authOrder) ? { ...entry.authOrder } : {};
          existingOrder[provider] = profileIds;
          entry.authOrder = existingOrder;
          agentListSet[agentIdxSet] = entry;
        } else {
          agentListSet.push({ id: agentId, authOrder: { [provider]: profileIds } });
        }
        await applyConfigPatchWithRetry({ agents: { list: agentListSet } });
        return NextResponse.json({
          ok: true,
          action,
          agentId,
          provider,
          profileIds,
        });
      }

      case "clear-auth-order": {
        const agentId = String(body.agentId || "main").trim() || "main";
        const provider = String(body.provider || "").trim();
        if (!provider) {
          return jsonNoStore(
            { error: "Provider is required" },
            { status: 400 }
          );
        }
        // Clear auth order for the provider on this agent
        const cfgForAuthClear = await fetchConfig(10000);
        const parsedAgentsClear = isRecord(cfgForAuthClear.parsed.agents) ? cfgForAuthClear.parsed.agents : {};
        const agentListClear = Array.isArray(parsedAgentsClear.list) ? [...parsedAgentsClear.list] : [];
        const agentIdxClear = agentListClear.findIndex(
          (a: unknown) => isRecord(a) && String(a.id || "") === agentId
        );
        if (agentIdxClear >= 0) {
          const entry = { ...(agentListClear[agentIdxClear] as Record<string, unknown>) };
          const existingOrder = isRecord(entry.authOrder) ? { ...entry.authOrder } : {};
          delete existingOrder[provider];
          entry.authOrder = existingOrder;
          agentListClear[agentIdxClear] = entry;
          await applyConfigPatchWithRetry({ agents: { list: agentListClear } });
        }
        return NextResponse.json({ ok: true, action, agentId, provider });
      }

      case "scan-models": {
        const provider = String(body.provider || "").trim();
        const noProbe = body.noProbe === true;
        const args = ["models", "scan", "--no-input", "--yes"];
        if (provider) args.push("--provider", provider);
        if (noProbe) args.push("--no-probe");
        const result = await runCliJson<Record<string, unknown>>(args, 60000);
        return NextResponse.json({ ok: true, action, result });
      }

      case "auth-provider": {
        // Paste an API key / token for a provider
        const provider = String(body.provider || "").trim().toLowerCase();
        const token = String(body.token || "").trim();
        if (!provider || !token) {
          return NextResponse.json(
            { error: "Both provider and token are required" },
            { status: 400 }
          );
        }
        try {
          const validation = await validateProviderToken(provider, token);
          if (!validation.ok) {
            return NextResponse.json(
              { error: validation.error || `Failed to validate ${provider}` },
              { status: 400 }
            );
          }

          const envKey = PROVIDER_ENV_KEYS[provider];
          if (envKey) {
            await applyConfigPatchWithRetry(buildProviderCredentialPatch(provider, token));
            return NextResponse.json({
              ok: true,
              action,
              provider,
              method: "env",
              validated: true,
            });
          }

          await runCli(
            ["models", "auth", "paste-token", "--provider", provider],
            15000,
            token
          );
          return NextResponse.json({ ok: true, action, provider, method: "cli" });
        } catch (authErr) {
          return NextResponse.json(
            { error: `Failed to authenticate ${provider}: ${authErr}` },
            { status: 500 }
          );
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Models API POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
