import { fetchGatewaySessions, summarizeSessionsByAgent } from "@/lib/gateway-sessions";
import { getFriendlyModelName } from "@/lib/model-metadata";
import { gatewayCall } from "@/lib/openclaw";

type GatewayConfigGet = {
  parsed?: Record<string, unknown>;
  resolved?: Record<string, unknown>;
  hash?: string;
};

export type ChatBootstrapAgent = {
  id: string;
  name: string;
  emoji: string;
  model: string;
  isDefault: boolean;
  workspace: string;
  sessionCount: number;
  lastActive: number | null;
};

export type ChatBootstrapModel = {
  key: string;
  name: string;
};

export type ChatBootstrapResponse = {
  agents: ChatBootstrapAgent[];
  models: ChatBootstrapModel[];
  warnings?: string[];
  degraded?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizeModelConfig(modelValue: unknown): { primary: string; fallbacks: string[] } {
  if (typeof modelValue === "string") {
    return { primary: modelValue.trim(), fallbacks: [] };
  }
  if (!isRecord(modelValue)) {
    return { primary: "", fallbacks: [] };
  }
  return {
    primary:
      typeof modelValue.primary === "string" ? modelValue.primary.trim() : "",
    fallbacks: Array.isArray(modelValue.fallbacks)
      ? modelValue.fallbacks.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
  };
}

function mergeAgentEntries(
  parsedEntry: Record<string, unknown> | undefined,
  resolvedEntry: Record<string, unknown> | undefined
): Record<string, unknown> {
  const parsedIdentity = isRecord(parsedEntry?.identity) ? parsedEntry.identity : {};
  const resolvedIdentity = isRecord(resolvedEntry?.identity)
    ? resolvedEntry.identity
    : {};
  return {
    ...(parsedEntry || {}),
    ...(resolvedEntry || {}),
    identity: {
      ...parsedIdentity,
      ...resolvedIdentity,
    },
  };
}

function latestModelByAgent(
  sessions: Awaited<ReturnType<typeof fetchGatewaySessions>>
): Map<string, string> {
  const out = new Map<string, string>();
  for (const session of sessions) {
    if (!session.agentId) continue;
    if (out.has(session.agentId)) continue;
    if (!session.fullModel || session.fullModel === "unknown") continue;
    out.set(session.agentId, session.fullModel);
  }
  return out;
}

export async function buildChatBootstrap(): Promise<ChatBootstrapResponse> {
  const warnings: string[] = [];

  let parsedConfig: Record<string, unknown> = {};
  let resolvedConfig: Record<string, unknown> = {};
  try {
    const configData = await gatewayCall<GatewayConfigGet>(
      "config.get",
      undefined,
      10000
    );
    parsedConfig = isRecord(configData.parsed) ? configData.parsed : {};
    resolvedConfig = isRecord(configData.resolved) ? configData.resolved : {};
  } catch (error) {
    warnings.push(`config.get unavailable: ${String(error)}`);
  }

  let sessions = [] as Awaited<ReturnType<typeof fetchGatewaySessions>>;
  try {
    sessions = await fetchGatewaySessions(10000);
  } catch (error) {
    warnings.push(`sessions.list unavailable: ${String(error)}`);
  }

  const sessionsByAgent = summarizeSessionsByAgent(sessions);
  const liveModelMap = latestModelByAgent(sessions);

  const parsedAgentsBlock = isRecord(parsedConfig.agents) ? parsedConfig.agents : {};
  const resolvedAgentsBlock = isRecord(resolvedConfig.agents)
    ? resolvedConfig.agents
    : {};
  const parsedDefaults = isRecord(parsedAgentsBlock.defaults)
    ? parsedAgentsBlock.defaults
    : {};
  const resolvedDefaults = isRecord(resolvedAgentsBlock.defaults)
    ? resolvedAgentsBlock.defaults
    : {};

  const defaultsModel = normalizeModelConfig(
    resolvedDefaults.model ?? parsedDefaults.model
  );
  const defaultWorkspace =
    typeof resolvedDefaults.workspace === "string"
      ? resolvedDefaults.workspace.trim()
      : typeof parsedDefaults.workspace === "string"
        ? parsedDefaults.workspace.trim()
        : "";

  const parsedList = Array.isArray(parsedAgentsBlock.list)
    ? (parsedAgentsBlock.list as Record<string, unknown>[])
    : [];
  const resolvedList = Array.isArray(resolvedAgentsBlock.list)
    ? (resolvedAgentsBlock.list as Record<string, unknown>[])
    : [];

  const parsedById = new Map<string, Record<string, unknown>>();
  const resolvedById = new Map<string, Record<string, unknown>>();
  const agentIds = new Set<string>();

  for (const row of parsedList) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    parsedById.set(id, row);
    agentIds.add(id);
  }
  for (const row of resolvedList) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    resolvedById.set(id, row);
    agentIds.add(id);
  }
  for (const agentId of sessionsByAgent.keys()) {
    if (agentId) agentIds.add(agentId);
  }
  if (agentIds.size === 0) agentIds.add("main");

  const resolvedDefaultAgentId =
    resolvedList.find((row) => Boolean(row.isDefault))?.id ||
    parsedList.find((row) => Boolean(row.isDefault))?.id ||
    (agentIds.has("main") ? "main" : [...agentIds][0]);

  const agents = [...agentIds]
    .map((id) => {
      const merged = mergeAgentEntries(parsedById.get(id), resolvedById.get(id));
      const identity = isRecord(merged.identity) ? merged.identity : {};
      const modelConfig = normalizeModelConfig(merged.model);
      const sessionSummary = sessionsByAgent.get(id);
      const liveModel = liveModelMap.get(id);
      const model =
        modelConfig.primary ||
        defaultsModel.primary ||
        liveModel ||
        "unknown";

      return {
        id,
        name:
          (typeof identity.name === "string" && identity.name.trim()) ||
          (typeof merged.name === "string" && merged.name.trim()) ||
          id,
        emoji:
          (typeof identity.emoji === "string" && identity.emoji.trim()) || "🤖",
        model,
        isDefault: Boolean(merged.isDefault) || id === resolvedDefaultAgentId,
        workspace:
          (typeof merged.workspace === "string" && merged.workspace.trim()) ||
          defaultWorkspace,
        sessionCount: sessionSummary?.sessionCount || 0,
        lastActive:
          sessionSummary && sessionSummary.lastActive > 0
            ? sessionSummary.lastActive
            : null,
      } satisfies ChatBootstrapAgent;
    })
    .sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.id.localeCompare(b.id);
    });

  const modelKeys = uniqueStrings([
    defaultsModel.primary,
    ...defaultsModel.fallbacks,
    ...normalizeAllowedModelList(parsedDefaults.models),
    ...agents.map((agent) => agent.model),
    ...[...liveModelMap.values()],
  ]).filter((key) => key !== "unknown");

  const models = modelKeys
    .map((key) => ({
      key,
      name: getFriendlyModelName(key),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    agents,
    models,
    warnings: warnings.length > 0 ? warnings : undefined,
    degraded: warnings.length > 0,
  };
}
