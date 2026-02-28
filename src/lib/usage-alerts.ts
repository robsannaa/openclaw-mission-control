import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { getOpenClawHome } from "@/lib/paths";
import type { NormalizedGatewaySession } from "@/lib/gateway-sessions";

export type UsageAlertTimeline = "last1h" | "last24h" | "last7d";

export type UsageAlertRule = {
  id: string;
  fullModel: string;
  timeline: UsageAlertTimeline;
  tokenLimit: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type UsageAlertTrigger = {
  windowKey: string;
  triggeredAt: number;
  observedTokens: number;
};

export type UsageAlertState = {
  version: 1;
  monitorEnabled: boolean;
  rules: UsageAlertRule[];
  lastTriggeredByRule: Record<string, UsageAlertTrigger>;
  updatedAt: number;
};

export type UsageAlertEvaluationStatus = "ok" | "no-model-data" | "no-data-in-window";

export type UsageAlertEvaluation = {
  ruleId: string;
  status: UsageAlertEvaluationStatus;
  reason: string | null;
  provider: string;
  fullModel: string;
  timeline: UsageAlertTimeline;
  tokenLimit: number;
  observedTokens: number;
  totalModelTokens: number;
  sampleSessions: number;
  staleSessions: number;
  exceeded: boolean;
  windowStart: number;
  windowEnd: number;
};

export type UsageAlertEvent = {
  id: string;
  ruleId: string;
  provider: string;
  fullModel: string;
  timeline: UsageAlertTimeline;
  tokenLimit: number;
  observedTokens: number;
  windowStart: number;
  windowEnd: number;
  message: string;
};

export type UsageAlertProviderCapability = {
  provider: string;
  providerUsageApiKnown: boolean;
  docsUrl: string | null;
  note: string;
};

const ALERTS_FILE_PATH = join(getOpenClawHome(), "mission-control", "usage-alerts.json");

const TIMELINE_WINDOW_MS: Record<UsageAlertTimeline, number> = {
  last1h: 60 * 60 * 1000,
  last24h: 24 * 60 * 60 * 1000,
  last7d: 7 * 24 * 60 * 60 * 1000,
};

const TIMELINE_LABELS: Record<UsageAlertTimeline, string> = {
  last1h: "last 1 hour",
  last24h: "last 24 hours",
  last7d: "last 7 days",
};

const PROVIDER_CAPABILITIES: Record<string, UsageAlertProviderCapability> = {
  openrouter: {
    provider: "openrouter",
    providerUsageApiKnown: true,
    docsUrl: "https://openrouter.ai/docs/api-reference/limits",
    note: "OpenRouter exposes key usage/limits endpoints (management key for full key management).",
  },
  anthropic: {
    provider: "anthropic",
    providerUsageApiKnown: true,
    docsUrl: "https://docs.anthropic.com/en/api/data-usage-cost-api",
    note: "Anthropic provides Usage & Cost APIs for org admins.",
  },
  openai: {
    provider: "openai",
    providerUsageApiKnown: true,
    docsUrl: "https://help.openai.com/en/articles/8554956-understanding-your-api-usage",
    note: "OpenAI has organization usage endpoints with admin/org access.",
  },
  google: {
    provider: "google",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "No stable public model-level usage endpoint is currently documented for this workflow.",
  },
  groq: {
    provider: "groq",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "No stable public model-level usage endpoint is currently documented for this workflow.",
  },
  xai: {
    provider: "xai",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "No stable public model-level usage endpoint is currently documented for this workflow.",
  },
  mistral: {
    provider: "mistral",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "No stable public model-level usage endpoint is currently documented for this workflow.",
  },
  cerebras: {
    provider: "cerebras",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "No stable public model-level usage endpoint is currently documented for this workflow.",
  },
  huggingface: {
    provider: "huggingface",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "No stable public model-level usage endpoint is currently documented for this workflow.",
  },
  minimax: {
    provider: "minimax",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "No stable public model-level usage endpoint is currently documented for this workflow.",
  },
  zai: {
    provider: "zai",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "No stable public model-level usage endpoint is currently documented for this workflow.",
  },
  ollama: {
    provider: "ollama",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "Local models do not expose provider billing APIs; Mission Control uses session telemetry.",
  },
  lmstudio: {
    provider: "lmstudio",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "Local models do not expose provider billing APIs; Mission Control uses session telemetry.",
  },
  unknown: {
    provider: "unknown",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "Provider capability is unknown; Mission Control uses session telemetry.",
  },
};

function defaultState(): UsageAlertState {
  return {
    version: 1,
    monitorEnabled: true,
    rules: [],
    lastTriggeredByRule: {},
    updatedAt: Date.now(),
  };
}

function toPositiveInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function normalizeTimeline(value: unknown): UsageAlertTimeline | null {
  const raw = String(value || "").trim();
  if (raw === "last1h" || raw === "last24h" || raw === "last7d") return raw;
  return null;
}

function normalizeRule(raw: unknown): UsageAlertRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id || "").trim();
  const fullModel = String(row.fullModel || "").trim();
  const timeline = normalizeTimeline(row.timeline);
  const tokenLimit = toPositiveInt(row.tokenLimit, 0);
  const createdAt = toPositiveInt(row.createdAt, Date.now());
  const updatedAt = toPositiveInt(row.updatedAt, Date.now());
  if (!id || !fullModel || !timeline || tokenLimit <= 0) return null;
  return {
    id,
    fullModel,
    timeline,
    tokenLimit,
    enabled: toBoolean(row.enabled, true),
    createdAt,
    updatedAt,
  };
}

function normalizeTrigger(raw: unknown): UsageAlertTrigger | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const windowKey = String(row.windowKey || "").trim();
  const triggeredAt = toPositiveInt(row.triggeredAt, 0);
  const observedTokens = toPositiveInt(row.observedTokens, 0);
  if (!windowKey || triggeredAt <= 0) return null;
  return { windowKey, triggeredAt, observedTokens };
}

function normalizeState(raw: unknown): UsageAlertState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultState();
  const obj = raw as Record<string, unknown>;
  const rules = Array.isArray(obj.rules)
    ? obj.rules.map(normalizeRule).filter((v): v is UsageAlertRule => Boolean(v))
    : [];
  const lastTriggeredByRuleInput = obj.lastTriggeredByRule;
  const lastTriggeredByRule: Record<string, UsageAlertTrigger> = {};
  if (lastTriggeredByRuleInput && typeof lastTriggeredByRuleInput === "object" && !Array.isArray(lastTriggeredByRuleInput)) {
    for (const [ruleId, triggerRaw] of Object.entries(lastTriggeredByRuleInput)) {
      const parsed = normalizeTrigger(triggerRaw);
      if (parsed) lastTriggeredByRule[ruleId] = parsed;
    }
  }
  const activeRuleIds = new Set(rules.map((rule) => rule.id));
  for (const ruleId of Object.keys(lastTriggeredByRule)) {
    if (!activeRuleIds.has(ruleId)) delete lastTriggeredByRule[ruleId];
  }
  return {
    version: 1,
    monitorEnabled: toBoolean(obj.monitorEnabled, true),
    rules,
    lastTriggeredByRule,
    updatedAt: toPositiveInt(obj.updatedAt, Date.now()),
  };
}

function isNoEntryError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err) {
    return (err as { code?: unknown }).code === "ENOENT";
  }
  const msg = String(err || "").toLowerCase();
  return msg.includes("no such file");
}

export async function readUsageAlertState(): Promise<{ state: UsageAlertState; warning?: string }> {
  try {
    const raw = await readFile(ALERTS_FILE_PATH, "utf-8");
    return { state: normalizeState(JSON.parse(raw)) };
  } catch (err) {
    if (isNoEntryError(err)) return { state: defaultState() };
    return {
      state: defaultState(),
      warning: `Usage alarm settings could not be loaded: ${String(err)}`,
    };
  }
}

export async function writeUsageAlertState(state: UsageAlertState): Promise<void> {
  const payload: UsageAlertState = {
    version: 1,
    monitorEnabled: state.monitorEnabled,
    rules: state.rules,
    lastTriggeredByRule: state.lastTriggeredByRule,
    updatedAt: Date.now(),
  };
  await mkdir(dirname(ALERTS_FILE_PATH), { recursive: true });
  await writeFile(ALERTS_FILE_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

export function modelProvider(fullModel: string): string {
  const provider = String(fullModel || "").split("/")[0]?.trim().toLowerCase();
  return provider || "unknown";
}

function timelineWindowStart(now: number, timeline: UsageAlertTimeline): number {
  return now - TIMELINE_WINDOW_MS[timeline];
}

function shortModel(fullModel: string): string {
  return fullModel.split("/").pop() || fullModel;
}

function formatInt(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString("en-US");
}

function timelineWindowKey(now: number, timeline: UsageAlertTimeline): string {
  const width = TIMELINE_WINDOW_MS[timeline];
  return `${timeline}:${Math.floor(now / width)}`;
}

export function getProviderCapabilities(): Record<string, UsageAlertProviderCapability> {
  return PROVIDER_CAPABILITIES;
}

export function getProviderCapability(provider: string): UsageAlertProviderCapability {
  const key = String(provider || "").trim().toLowerCase();
  return PROVIDER_CAPABILITIES[key] || PROVIDER_CAPABILITIES.unknown;
}

export function evaluateUsageAlertRules(params: {
  rules: UsageAlertRule[];
  sessions: NormalizedGatewaySession[];
  now: number;
  lastTriggeredByRule: Record<string, UsageAlertTrigger>;
  emitAlerts: boolean;
}): {
  evaluations: UsageAlertEvaluation[];
  alerts: UsageAlertEvent[];
  nextLastTriggeredByRule: Record<string, UsageAlertTrigger>;
  changed: boolean;
} {
  const { rules, sessions, now, lastTriggeredByRule, emitAlerts } = params;
  const evaluations: UsageAlertEvaluation[] = [];
  const alerts: UsageAlertEvent[] = [];
  const nextLastTriggeredByRule: Record<string, UsageAlertTrigger> = {
    ...lastTriggeredByRule,
  };
  let changed = false;

  for (const rule of rules) {
    const provider = modelProvider(rule.fullModel);
    const allModelSessions = sessions.filter((s) => s.fullModel === rule.fullModel);
    const totalModelTokens = allModelSessions.reduce((sum, s) => sum + s.totalTokens, 0);
    const windowStart = timelineWindowStart(now, rule.timeline);
    const windowEnd = now;
    const inWindow = allModelSessions.filter(
      (s) => s.updatedAt > 0 && s.updatedAt >= windowStart && s.updatedAt <= now,
    );
    const observedTokens = inWindow.reduce((sum, s) => sum + s.totalTokens, 0);
    const staleSessions = inWindow.filter((s) => !s.totalTokensFresh).length;

    let status: UsageAlertEvaluationStatus = "ok";
    let reason: string | null = null;
    if (allModelSessions.length === 0) {
      status = "no-model-data";
      reason = "No usage data is available yet for this model.";
    } else if (inWindow.length === 0) {
      status = "no-data-in-window";
      reason = `No session activity for this model in ${TIMELINE_LABELS[rule.timeline]}.`;
    }

    const exceeded = status === "ok" && observedTokens >= rule.tokenLimit;

    evaluations.push({
      ruleId: rule.id,
      status,
      reason,
      provider,
      fullModel: rule.fullModel,
      timeline: rule.timeline,
      tokenLimit: rule.tokenLimit,
      observedTokens,
      totalModelTokens,
      sampleSessions: inWindow.length,
      staleSessions,
      exceeded,
      windowStart,
      windowEnd,
    });

    if (!emitAlerts || !rule.enabled || !exceeded) continue;

    const windowKey = timelineWindowKey(now, rule.timeline);
    const previous = nextLastTriggeredByRule[rule.id];
    if (previous?.windowKey === windowKey) continue;

    nextLastTriggeredByRule[rule.id] = {
      windowKey,
      triggeredAt: now,
      observedTokens,
    };
    changed = true;
    alerts.push({
      id: `${rule.id}:${windowKey}`,
      ruleId: rule.id,
      provider,
      fullModel: rule.fullModel,
      timeline: rule.timeline,
      tokenLimit: rule.tokenLimit,
      observedTokens,
      windowStart,
      windowEnd,
      message:
        `Token alarm triggered for ${shortModel(rule.fullModel)}: ` +
        `${formatInt(observedTokens)} tokens in ${TIMELINE_LABELS[rule.timeline]} ` +
        `(limit ${formatInt(rule.tokenLimit)}).`,
    });
  }

  const activeIds = new Set(rules.map((rule) => rule.id));
  for (const ruleId of Object.keys(nextLastTriggeredByRule)) {
    if (!activeIds.has(ruleId)) {
      delete nextLastTriggeredByRule[ruleId];
      changed = true;
    }
  }

  return { evaluations, alerts, nextLastTriggeredByRule, changed };
}

