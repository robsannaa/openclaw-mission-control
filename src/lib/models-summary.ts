import { readFile } from "fs/promises";
import { join } from "path";
import { fetchGatewaySessions } from "@/lib/gateway-sessions";
import { getFriendlyModelName } from "@/lib/model-metadata";
import { gatewayCallWithRetry } from "@/lib/gateway-config";
import { getOpenClawHome } from "@/lib/paths";

const OPENCLAW_HOME = getOpenClawHome();

export type ModelInfo = {
  key: string;
  name: string;
  input: string;
  contextWindow: number;
  local: boolean;
  available: boolean;
  tags: string[];
  missing: boolean;
};

export type ModelStatus = {
  defaultModel: string;
  resolvedDefault: string;
  fallbacks: string[];
  imageModel: string;
  imageFallbacks: string[];
  aliases: Record<string, string>;
  allowed: string[];
  auth?: {
    providers?: Array<{
      provider: string;
      effective?: {
        kind?: string;
        detail?: string;
      } | null;
    }>;
    oauth?: {
      providers?: Array<{
        provider: string;
        status?: string;
        remainingMs?: number;
      }>;
    };
  };
};

export type ModelsCatalogProvider = {
  provider: string;
  config: Record<string, unknown>;
};

export type ModelsCatalogConfig = {
  mode: string;
  providers: ModelsCatalogProvider[];
};

export type DefaultsModelConfig = {
  primary: string;
  fallbacks: string[];
};

export type HeartbeatConfig = {
  every: string;
  model: string;
};

export type LiveModelInfo = {
  fullModel: string | null;
  model: string | null;
  provider: string | null;
  updatedAt: number | null;
  sessionKey: string | null;
};

export type AgentModelInfo = {
  id: string;
  name: string;
  modelPrimary: string | null;
  modelFallbacks: string[] | null;
  usesDefaults: boolean;
  subagents: string[];
  parentId: string | null;
};

export type AgentRuntimeStatus = {
  defaultModel: string;
  resolvedDefault: string;
  fallbacks: string[];
};

export type ModelConfiguredSummary = {
  key: string;
  name: string;
  available: boolean;
  local: boolean;
  source: "config" | "session" | "metadata";
};

export type ModelsSummaryResponse = {
  status: ModelStatus;
  defaults: DefaultsModelConfig | null;
  allowedConfigured: string[];
  configuredProviders: string[];
  configuredModels: ModelConfiguredSummary[];
  heartbeat: HeartbeatConfig | null;
  models: ModelInfo[];
  agents: AgentModelInfo[];
  agentStatuses: Record<string, AgentRuntimeStatus>;
  liveModels: Record<string, LiveModelInfo>;
  configHash: string | null;
  modelsCatalogConfig: ModelsCatalogConfig;
  warnings?: string[];
  warning?: string;
  degraded?: boolean;
};

type ParsedProviderProfile = {
  provider: string;
  mode: string | null;
};

type ParsedConfigSnapshot = {
  defaultsModel: DefaultsModelConfig | null;
  allowedModels: string[];
  modelsCatalogConfig: ModelsCatalogConfig;
  configuredModels: string[];
  configuredProviders: string[];
  authProfiles: ParsedProviderProfile[];
  agents: AgentModelInfo[];
  heartbeat: HeartbeatConfig | null;
  configHash: string | null;
};

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
    ? modelValue.fallbacks.map((value) => String(value)).filter(Boolean)
    : [];
  return { primary, fallbacks };
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

function canonicalAllowedModelKey(value: unknown): string {
  const key = String(value || "").trim();
  if (!key) return "";
  const parts = key.split("/");
  if (parts.length >= 3 && parts[0] && parts[0] === parts[1]) {
    return `${parts[0]}/${parts.slice(2).join("/")}`;
  }
  return key;
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

function normalizeProviderConfigMap(value: unknown): ModelsCatalogProvider[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .map(([provider, config]) => ({
      provider,
      config: isRecord(config) ? { ...config } : {},
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
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

function parseAuthProfiles(value: unknown): ParsedProviderProfile[] {
  if (!isRecord(value)) return [];
  const out: ParsedProviderProfile[] = [];
  for (const profile of Object.values(value)) {
    if (!isRecord(profile)) continue;
    const provider = String(profile.provider || "").trim();
    if (!provider) continue;
    const mode = typeof profile.mode === "string" ? profile.mode : null;
    out.push({ provider, mode });
  }
  return out;
}

function parseHeartbeat(value: unknown): HeartbeatConfig | null {
  if (!isRecord(value)) return null;
  const every = typeof value.every === "string" ? value.every : "";
  const model = typeof value.model === "string" ? value.model : "";
  if (!every && !model) return null;
  return { every, model };
}

function parseAgentsList(listValue: unknown): AgentModelInfo[] {
  const entries = Array.isArray(listValue) ? listValue : [];
  const baseAgents: AgentModelInfo[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const id = String(entry.id || "").trim();
    if (!id) continue;
    const modelValue = entry.model;
    const usesDefaults = modelValue == null;
    let modelPrimary: string | null = null;
    let modelFallbacks: string[] | null = null;
    if (typeof modelValue === "string") {
      modelPrimary = modelValue;
    } else if (isRecord(modelValue)) {
      modelPrimary =
        typeof modelValue.primary === "string" ? modelValue.primary : null;
      modelFallbacks = Array.isArray(modelValue.fallbacks)
        ? modelValue.fallbacks.map((value) => String(value)).filter(Boolean)
        : [];
    }
    const subagentsBlock = isRecord(entry.subagents) ? entry.subagents : null;
    const subagents = Array.isArray(subagentsBlock?.allowAgents)
      ? subagentsBlock.allowAgents.map((value) => String(value)).filter(Boolean)
      : [];
    baseAgents.push({
      id,
      name: String(entry.name || id),
      modelPrimary,
      modelFallbacks,
      usesDefaults,
      subagents,
      parentId: null,
    });
  }

  const parentById: Record<string, string> = {};
  for (const agent of baseAgents) {
    for (const childId of agent.subagents) {
      if (!parentById[childId]) {
        parentById[childId] = agent.id;
      }
    }
  }
  return baseAgents.map((agent) => ({
    ...agent,
    parentId: parentById[agent.id] || null,
  }));
}

function buildConfiguredModels(
  defaultsModel: DefaultsModelConfig | null,
  allowedModels: string[],
  agents: AgentModelInfo[],
  heartbeat: HeartbeatConfig | null
): string[] {
  const configuredModelSet = new Set<string>();
  if (defaultsModel?.primary) configuredModelSet.add(defaultsModel.primary);
  for (const fallback of defaultsModel?.fallbacks || []) {
    configuredModelSet.add(fallback);
  }
  for (const allowed of allowedModels) configuredModelSet.add(allowed);
  if (heartbeat?.model) configuredModelSet.add(heartbeat.model);
  for (const agent of agents) {
    for (const modelRef of collectModelRefsFromValue({
      primary: agent.modelPrimary,
      fallbacks: agent.modelFallbacks || [],
    })) {
      configuredModelSet.add(modelRef);
    }
  }
  return [...configuredModelSet].sort((a, b) => a.localeCompare(b));
}

function buildConfiguredProviders(
  configuredModels: string[],
  authProfiles: ParsedProviderProfile[],
  modelsCatalogConfig: ModelsCatalogConfig
): string[] {
  const providerSet = new Set<string>();
  for (const modelKey of configuredModels) {
    providerSet.add(providerFromModelKey(modelKey));
  }
  for (const profile of authProfiles) {
    providerSet.add(profile.provider);
  }
  for (const row of modelsCatalogConfig.providers) {
    providerSet.add(row.provider);
  }
  providerSet.delete("custom");
  return [...providerSet].sort((a, b) => a.localeCompare(b));
}

function parseParsedConfigSnapshot(
  parsed: Record<string, unknown>,
  resolved?: Record<string, unknown>,
  configHash?: string | null
): ParsedConfigSnapshot {
  const parsedAgents = isRecord(parsed.agents) ? parsed.agents : {};
  const resolvedAgents = isRecord(resolved?.agents) ? resolved?.agents : {};
  const parsedDefaults = isRecord(parsedAgents.defaults) ? parsedAgents.defaults : {};
  const resolvedDefaults = isRecord(resolvedAgents.defaults)
    ? resolvedAgents.defaults
    : {};
  const defaultsModel = normalizeModelConfig(
    resolvedDefaults.model ?? parsedDefaults.model
  );
  const normalizedDefaults = defaultsModel.primary ? defaultsModel : null;
  const agents = parseAgentsList(parsedAgents.list);
  const allowedModels = normalizeAllowedModelList(parsedDefaults.models);
  const parsedModels = isRecord(parsed.models) ? parsed.models : {};
  const rawMode =
    typeof parsedModels.mode === "string"
      ? parsedModels.mode.trim().toLowerCase()
      : "";
  const modelsCatalogConfig: ModelsCatalogConfig = {
    mode: rawMode === "replace" ? "replace" : "merge",
    providers: normalizeProviderConfigMap(parsedModels.providers),
  };
  const authBlock = isRecord(parsed.auth) ? parsed.auth : {};
  const authProfiles = parseAuthProfiles(authBlock.profiles);
  const heartbeat = parseHeartbeat(parsedDefaults.heartbeat);
  const configuredModels = buildConfiguredModels(
    normalizedDefaults,
    allowedModels,
    agents,
    heartbeat
  );
  const configuredProviders = buildConfiguredProviders(
    configuredModels,
    authProfiles,
    modelsCatalogConfig
  );

  return {
    defaultsModel: normalizedDefaults,
    allowedModels,
    modelsCatalogConfig,
    configuredModels,
    configuredProviders,
    authProfiles,
    agents,
    heartbeat,
    configHash: configHash || null,
  };
}

async function readConfigFileSnapshot(): Promise<ParsedConfigSnapshot | null> {
  try {
    const raw = await readFile(join(OPENCLAW_HOME, "openclaw.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parseParsedConfigSnapshot(parsed);
  } catch {
    return null;
  }
}

function mergeSnapshots(
  gateway: ParsedConfigSnapshot | null,
  file: ParsedConfigSnapshot | null
): ParsedConfigSnapshot | null {
  if (!gateway && !file) return null;
  if (!gateway) return file;
  if (!file) return gateway;

  const defaultsModel = gateway.defaultsModel || file.defaultsModel;
  const allowedModels =
    gateway.allowedModels.length > 0 ? gateway.allowedModels : file.allowedModels;
  const modelsCatalogConfig =
    file.modelsCatalogConfig.providers.length > 0 || file.modelsCatalogConfig.mode !== "merge"
      ? file.modelsCatalogConfig
      : gateway.modelsCatalogConfig;
  const authProfiles =
    gateway.authProfiles.length > 0 ? gateway.authProfiles : file.authProfiles;
  const agents = gateway.agents.length > 0 ? gateway.agents : file.agents;
  const heartbeat = gateway.heartbeat || file.heartbeat;
  const configuredModels = uniqueStrings([
    ...gateway.configuredModels,
    ...file.configuredModels,
  ]).sort((a, b) => a.localeCompare(b));
  const configuredProviders = uniqueStrings([
    ...gateway.configuredProviders,
    ...file.configuredProviders,
  ]).sort((a, b) => a.localeCompare(b));

  return {
    defaultsModel,
    allowedModels,
    modelsCatalogConfig,
    configuredModels,
    configuredProviders,
    authProfiles,
    agents,
    heartbeat,
    configHash: gateway.configHash || file.configHash,
  };
}

async function readLiveModels(agentIds: string[]): Promise<Record<string, LiveModelInfo>> {
  const out: Record<string, LiveModelInfo> = {};
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
  return out;
}

function buildModelInfoRows(
  keys: string[]
): { models: ModelInfo[]; configuredModels: ModelConfiguredSummary[] } {
  const models = keys.map((key) => {
    const provider = providerFromModelKey(key);
    const local = localProvider(provider);
    return {
      key,
      name: getFriendlyModelName(key),
      input: "",
      contextWindow: 0,
      local,
      available: true,
      tags: ["configured"],
      missing: false,
    } satisfies ModelInfo;
  });
  const configuredModels = models.map((model) => ({
    key: model.key,
    name: model.name,
    available: model.available,
    local: model.local,
    source: "config" as const,
  }));
  return { models, configuredModels };
}

function buildAgentStatuses(
  agents: AgentModelInfo[],
  defaults: DefaultsModelConfig | null
): Record<string, AgentRuntimeStatus> {
  const out: Record<string, AgentRuntimeStatus> = {};
  for (const agent of agents) {
    const primary = agent.modelPrimary || defaults?.primary || "";
    const fallbacks =
      agent.modelFallbacks != null ? agent.modelFallbacks : defaults?.fallbacks || [];
    out[agent.id] = {
      defaultModel: primary,
      resolvedDefault: primary,
      fallbacks,
    };
  }
  return out;
}

function buildAuthSummary(
  configuredProviders: string[],
  authProfiles: ParsedProviderProfile[],
  liveModels: Record<string, LiveModelInfo>,
  configuredModels: string[]
): NonNullable<ModelStatus["auth"]> {
  const providerModes = new Map<string, string>();
  for (const profile of authProfiles) {
    if (!providerModes.has(profile.provider)) {
      providerModes.set(profile.provider, profile.mode || "config");
    }
  }

  const localProviders = new Set<string>();
  for (const modelKey of configuredModels) {
    const provider = providerFromModelKey(modelKey);
    if (localProvider(provider)) localProviders.add(provider);
  }
  for (const live of Object.values(liveModels)) {
    if (live.provider && localProvider(live.provider)) {
      localProviders.add(live.provider);
    }
  }

  const providers = uniqueStrings([
    ...configuredProviders,
    ...authProfiles.map((profile) => profile.provider),
    ...localProviders,
  ]).map((provider) => {
    const mode = providerModes.get(provider) || null;
    const local = localProviders.has(provider);
    return {
      provider,
      effective: local
        ? { kind: "local", detail: "discovered locally" }
        : mode
          ? { kind: mode, detail: "configured in auth profiles" }
          : null,
    };
  });

  const oauthProviders = uniqueStrings(
    authProfiles
      .filter((profile) => profile.mode === "oauth")
      .map((profile) => profile.provider)
  ).map((provider) => ({
    provider,
    status: "static",
  }));

  return {
    providers,
    oauth: { providers: oauthProviders },
  };
}

export async function buildModelsSummary(): Promise<ModelsSummaryResponse> {
  const warnings: string[] = [];
  let gatewaySnapshot: ParsedConfigSnapshot | null = null;
  let fileSnapshot: ParsedConfigSnapshot | null = null;

  try {
    const configData = await gatewayCallWithRetry<Record<string, unknown>>(
      "config.get",
      undefined,
      10000
    );
    const parsed = isRecord(configData.parsed) ? configData.parsed : {};
    const resolved = isRecord(configData.resolved) ? configData.resolved : {};
    gatewaySnapshot = parseParsedConfigSnapshot(
      parsed,
      resolved,
      typeof configData.hash === "string" ? configData.hash : null
    );
  } catch (error) {
    warnings.push(`config.get unavailable: ${String(error)}`);
  }

  try {
    fileSnapshot = await readConfigFileSnapshot();
  } catch (error) {
    warnings.push(`openclaw.json unavailable: ${String(error)}`);
  }

  const snapshot = mergeSnapshots(gatewaySnapshot, fileSnapshot);
  const defaults = snapshot?.defaultsModel || null;
  const allowedConfigured = snapshot?.allowedModels || [];
  const configuredProviders = snapshot?.configuredProviders || [];
  const modelsCatalogConfig = snapshot?.modelsCatalogConfig || {
    mode: "merge",
    providers: [],
  };
  const agents = snapshot?.agents || [];
  const heartbeat = snapshot?.heartbeat || null;

  let liveModels: Record<string, LiveModelInfo> = {};
  try {
    liveModels = await readLiveModels(agents.map((agent) => agent.id));
  } catch (error) {
    warnings.push(`sessions.list unavailable: ${String(error)}`);
  }

  const liveKeys = Object.values(liveModels)
    .map((entry) => entry.fullModel || "")
    .filter(Boolean);
  const modelKeys = uniqueStrings([
    ...(snapshot?.configuredModels || []),
    ...liveKeys,
  ]).sort((a, b) => a.localeCompare(b));
  const { models, configuredModels } = buildModelInfoRows(modelKeys);
  const defaultsPrimary =
    defaults?.primary ||
    (modelKeys.length > 0 ? modelKeys[0] : "");
  const status: ModelStatus = {
    defaultModel: defaultsPrimary,
    resolvedDefault: defaultsPrimary,
    fallbacks: defaults?.fallbacks || [],
    imageModel: "",
    imageFallbacks: [],
    aliases: {},
    allowed: allowedConfigured,
    auth: buildAuthSummary(
      configuredProviders,
      snapshot?.authProfiles || [],
      liveModels,
      modelKeys
    ),
  };

  return {
    status,
    defaults,
    allowedConfigured,
    configuredProviders,
    configuredModels: configuredModels.map((entry) => ({
      ...entry,
      source: liveKeys.includes(entry.key) && !(snapshot?.configuredModels || []).includes(entry.key)
        ? "session"
        : entry.source,
    })),
    heartbeat,
    models,
    agents,
    agentStatuses: buildAgentStatuses(agents, defaults),
    liveModels,
    configHash: snapshot?.configHash || null,
    modelsCatalogConfig,
    warnings: warnings.length > 0 ? warnings : undefined,
    warning: warnings.length > 0 ? warnings.join(" | ") : undefined,
    degraded: warnings.length > 0,
  };
}
