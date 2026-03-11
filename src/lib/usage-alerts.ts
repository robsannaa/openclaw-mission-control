import { randomUUID } from "crypto";
import {
  ensureUsageDb,
  sqliteValue,
  usageDbGetMeta,
  usageDbQuery,
  usageDbSetMeta,
  usageDbTransaction,
} from "@/lib/usage-db";
import type {
  UsageAlertFiringRecord,
  UsageAlertKind,
  UsageAlertRuleRecord,
  UsageAlertScopeType,
  UsageAlertTimeline,
} from "@/lib/usage-types";

export type UsageAlertProviderCapability = {
  provider: string;
  providerUsageApiKnown: boolean;
  docsUrl: string | null;
  note: string;
};

export type UsageAlertEvaluationStatus = "ok" | "no-data";

export type UsageAlertEvaluation = {
  ruleId: string;
  kind: UsageAlertKind;
  scopeType: UsageAlertScopeType;
  scopeValue: string | null;
  timeline: UsageAlertTimeline;
  thresholdValue: number;
  observedValue: number;
  status: UsageAlertEvaluationStatus;
  reason: string | null;
  exceeded: boolean;
  windowStart: number;
  windowEnd: number;
};

export type UsageAlertCreateInput = {
  kind: UsageAlertKind;
  scopeType: UsageAlertScopeType;
  scopeValue: string | null;
  timeline: UsageAlertTimeline;
  thresholdValue: number;
  deliveryMode?: string;
  deliveryChannel?: string | null;
  deliveryTo?: string | null;
  bestEffort?: boolean;
};

const PROVIDER_CAPABILITIES: Record<string, UsageAlertProviderCapability> = {
  openrouter: {
    provider: "openrouter",
    providerUsageApiKnown: true,
    docsUrl: "https://openrouter.ai/docs/api-reference/analytics/get-activity",
    note: "Provider billing can be read via OpenRouter activity and credits endpoints.",
  },
  anthropic: {
    provider: "anthropic",
    providerUsageApiKnown: true,
    docsUrl: "https://docs.anthropic.com/en/api/data-usage-cost-api",
    note: "Anthropic org admins can expose usage and cost reports.",
  },
  openai: {
    provider: "openai",
    providerUsageApiKnown: true,
    docsUrl: "https://platform.openai.com/docs/api-reference/usage/costs",
    note: "OpenAI org billing should come from organization usage/cost endpoints.",
  },
  synthetic: {
    provider: "synthetic",
    providerUsageApiKnown: false,
    docsUrl: "https://synthetic.new/",
    note: "Synthetic usage is currently treated as local telemetry estimate only in Mission Control.",
  },
  requesty: {
    provider: "requesty",
    providerUsageApiKnown: false,
    docsUrl: "https://synthetic.new/",
    note: "Requesty/Synthetic billing is currently treated as local telemetry estimate only in Mission Control.",
  },
  google: {
    provider: "google",
    providerUsageApiKnown: false,
    docsUrl: "https://ai.google.dev/pricing",
    note: "Google AI Studio has no billing API — costs are estimated from local token telemetry.",
  },
  groq: {
    provider: "groq",
    providerUsageApiKnown: false,
    docsUrl: "https://console.groq.com/docs/overview",
    note: "Groq has no billing API — costs are estimated from local token telemetry.",
  },
  mistral: {
    provider: "mistral",
    providerUsageApiKnown: false,
    docsUrl: "https://docs.mistral.ai/api/",
    note: "Mistral has no confirmed public billing API — costs are estimated from local token telemetry. The collector will attempt /v1/usage and fall back gracefully.",
  },
  minimax: {
    provider: "minimax",
    providerUsageApiKnown: false,
    docsUrl: "https://docs.openclaw.ai/concepts/usage-tracking",
    note: "OpenClaw can track usage locally, but Mission Control treats billing as estimate only.",
  },
  zai: {
    provider: "zai",
    providerUsageApiKnown: false,
    docsUrl: "https://docs.openclaw.ai/concepts/usage-tracking",
    note: "OpenClaw can track usage locally, but Mission Control treats billing as estimate only.",
  },
  unknown: {
    provider: "unknown",
    providerUsageApiKnown: false,
    docsUrl: null,
    note: "Mission Control falls back to local telemetry when provider billing truth is unavailable.",
  },
};

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function timelineBounds(now: number, timeline: UsageAlertTimeline): { start: number; end: number } {
  if (timeline === "last1h") return { start: now - 60 * 60 * 1000, end: now };
  if (timeline === "last24h") return { start: now - 24 * 60 * 60 * 1000, end: now };
  if (timeline === "last7d") return { start: now - 7 * 24 * 60 * 60 * 1000, end: now };
  if (timeline === "todayUtc") {
    const date = new Date(now);
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return { start, end: now };
  }
  const date = new Date(now);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  return { start, end: now };
}

function timelineKey(now: number, timeline: UsageAlertTimeline): string {
  if (timeline === "todayUtc") {
    const d = new Date(now).toISOString().slice(0, 10);
    return `${timeline}:${d}`;
  }
  if (timeline === "monthUtc") {
    const d = new Date(now);
    return `${timeline}:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const width =
    timeline === "last1h"
      ? 60 * 60 * 1000
      : timeline === "last24h"
        ? 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;
  return `${timeline}:${Math.floor(now / width)}`;
}

function formatObserved(kind: UsageAlertKind, observedValue: number): string {
  return kind === "token-usage"
    ? `${Math.round(observedValue).toLocaleString("en-US")} tokens`
    : `$${observedValue.toFixed(2)}`;
}

function formatThreshold(kind: UsageAlertKind, thresholdValue: number): string {
  return kind === "token-usage"
    ? `${Math.round(thresholdValue).toLocaleString("en-US")} tokens`
    : `$${thresholdValue.toFixed(2)}`;
}

export function normalizeTimeline(value: unknown): UsageAlertTimeline | null {
  const raw = String(value || "").trim();
  return raw === "last1h" ||
    raw === "last24h" ||
    raw === "last7d" ||
    raw === "todayUtc" ||
    raw === "monthUtc"
    ? raw
    : null;
}

export function normalizeAlertKind(value: unknown): UsageAlertKind | null {
  const raw = String(value || "").trim();
  return raw === "token-usage" || raw === "estimated-spend" || raw === "provider-spend"
    ? raw
    : null;
}

export function normalizeScopeType(value: unknown): UsageAlertScopeType | null {
  const raw = String(value || "").trim();
  return raw === "model" || raw === "provider" || raw === "global" ? raw : null;
}

export function getProviderCapabilities(): Record<string, UsageAlertProviderCapability> {
  return PROVIDER_CAPABILITIES;
}

export function getProviderCapability(provider: string): UsageAlertProviderCapability {
  return PROVIDER_CAPABILITIES[String(provider || "").trim().toLowerCase()] || PROVIDER_CAPABILITIES.unknown;
}

export async function readAlertMonitorEnabled(): Promise<boolean> {
  const raw = await usageDbGetMeta("alerts.monitor_enabled");
  return raw == null ? true : raw === "1";
}

export async function setAlertMonitorEnabled(enabled: boolean): Promise<void> {
  await usageDbSetMeta("alerts.monitor_enabled", enabled ? "1" : "0");
}

export async function listUsageAlertRules(): Promise<UsageAlertRuleRecord[]> {
  await ensureUsageDb();
  const rows = await usageDbQuery<{
    id?: string;
    kind?: UsageAlertKind;
    scope_type?: UsageAlertScopeType;
    scope_value?: string | null;
    timeline?: UsageAlertTimeline;
    threshold_type?: "gte";
    threshold_value?: number;
    delivery_mode?: string;
    delivery_channel?: string | null;
    delivery_to?: string | null;
    best_effort?: number | boolean;
    enabled?: number | boolean;
    cooldown_window_key?: string | null;
    created_at_ms?: number;
    updated_at_ms?: number;
  }>(
    "SELECT * FROM alert_rules ORDER BY created_at_ms DESC;",
  );
  return rows
    .map((row) => {
      const id = String(row.id || "").trim();
      if (!id) return null;
      return {
        id,
        kind: (row.kind || "token-usage") as UsageAlertKind,
        scopeType: (row.scope_type || "global") as UsageAlertScopeType,
        scopeValue: row.scope_value == null ? null : String(row.scope_value),
        timeline: (row.timeline || "last24h") as UsageAlertTimeline,
        thresholdType: "gte" as const,
        thresholdValue: Number(row.threshold_value || 0),
        deliveryMode: String(row.delivery_mode || "none"),
        deliveryChannel: row.delivery_channel == null ? null : String(row.delivery_channel),
        deliveryTo: row.delivery_to == null ? null : String(row.delivery_to),
        bestEffort: toBool(row.best_effort),
        enabled: toBool(row.enabled),
        cooldownWindowKey: row.cooldown_window_key == null ? null : String(row.cooldown_window_key),
        createdAt: Number(row.created_at_ms || 0),
        updatedAt: Number(row.updated_at_ms || 0),
      };
    })
    .filter((rule): rule is UsageAlertRuleRecord => rule !== null);
}

export async function createUsageAlertRule(input: UsageAlertCreateInput): Promise<UsageAlertRuleRecord> {
  await ensureUsageDb();
  const now = Date.now();
  const rule: UsageAlertRuleRecord = {
    id: randomUUID(),
    kind: input.kind,
    scopeType: input.scopeType,
    scopeValue: input.scopeValue,
    timeline: input.timeline,
    thresholdType: "gte",
    thresholdValue: input.thresholdValue,
    deliveryMode: input.deliveryMode || "none",
    deliveryChannel: input.deliveryChannel ?? null,
    deliveryTo: input.deliveryTo ?? null,
    bestEffort: Boolean(input.bestEffort),
    enabled: true,
    cooldownWindowKey: null,
    createdAt: now,
    updatedAt: now,
  };
  await usageDbTransaction([
    [
      "INSERT INTO alert_rules (",
      "id, kind, scope_type, scope_value, timeline, threshold_type, threshold_value,",
      "delivery_mode, delivery_channel, delivery_to, best_effort, enabled, cooldown_window_key, created_at_ms, updated_at_ms",
      ") VALUES (",
      [
        sqliteValue(rule.id),
        sqliteValue(rule.kind),
        sqliteValue(rule.scopeType),
        rule.scopeValue ? sqliteValue(rule.scopeValue) : "NULL",
        sqliteValue(rule.timeline),
        sqliteValue("gte"),
        rule.thresholdValue,
        sqliteValue(rule.deliveryMode),
        rule.deliveryChannel ? sqliteValue(rule.deliveryChannel) : "NULL",
        rule.deliveryTo ? sqliteValue(rule.deliveryTo) : "NULL",
        rule.bestEffort ? 1 : 0,
        1,
        "NULL",
        now,
        now,
      ].join(", "),
      ");",
    ].join(" "),
  ]);
  return rule;
}

export async function updateUsageAlertRule(
  ruleId: string,
  patch: Partial<UsageAlertCreateInput & { enabled: boolean }>,
): Promise<void> {
  const updates: string[] = [`updated_at_ms = ${Date.now()}`];
  if (patch.kind) updates.push(`kind = ${sqliteValue(patch.kind)}`);
  if (patch.scopeType) updates.push(`scope_type = ${sqliteValue(patch.scopeType)}`);
  if (patch.scopeValue !== undefined) {
    updates.push(`scope_value = ${patch.scopeValue ? sqliteValue(patch.scopeValue) : "NULL"}`);
  }
  if (patch.timeline) updates.push(`timeline = ${sqliteValue(patch.timeline)}`);
  if (patch.thresholdValue !== undefined) updates.push(`threshold_value = ${patch.thresholdValue}`);
  if (patch.deliveryMode !== undefined) updates.push(`delivery_mode = ${sqliteValue(patch.deliveryMode || "none")}`);
  if (patch.deliveryChannel !== undefined) {
    updates.push(`delivery_channel = ${patch.deliveryChannel ? sqliteValue(patch.deliveryChannel) : "NULL"}`);
  }
  if (patch.deliveryTo !== undefined) {
    updates.push(`delivery_to = ${patch.deliveryTo ? sqliteValue(patch.deliveryTo) : "NULL"}`);
  }
  if (patch.bestEffort !== undefined) updates.push(`best_effort = ${patch.bestEffort ? 1 : 0}`);
  if (patch.enabled !== undefined) updates.push(`enabled = ${patch.enabled ? 1 : 0}`);
  if (updates.length === 1) return;
  await usageDbTransaction([
    `UPDATE alert_rules SET ${updates.join(", ")} WHERE id = ${sqliteValue(ruleId)};`,
  ]);
}

export async function deleteUsageAlertRule(ruleId: string): Promise<void> {
  await usageDbTransaction([
    `DELETE FROM alert_rules WHERE id = ${sqliteValue(ruleId)};`,
  ]);
}

async function queryObservedValue(rule: UsageAlertRuleRecord, now: number): Promise<number> {
  const bounds = timelineBounds(now, rule.timeline);
  const filters = [`observed_at_ms >= ${bounds.start}`, `observed_at_ms <= ${bounds.end}`];
  if (rule.scopeType === "model" && rule.scopeValue) {
    filters.push(`full_model = ${sqliteValue(rule.scopeValue)}`);
  } else if (rule.scopeType === "provider" && rule.scopeValue) {
    filters.push(`provider = ${sqliteValue(rule.scopeValue)}`);
  }

  if (rule.kind === "token-usage" || rule.kind === "estimated-spend") {
    const valueColumn = rule.kind === "token-usage" ? "SUM(total_tokens_delta)" : "SUM(estimated_cost_usd)";
    const rows = await usageDbQuery<{ value?: number }>(
      `SELECT ${valueColumn} AS value FROM usage_events WHERE ${filters.join(" AND ")};`,
    );
    return Number(rows[0]?.value || 0);
  }

  const providerFilters = [`bucket_start_ms >= ${bounds.start}`, `bucket_start_ms <= ${bounds.end}`];
  if (rule.scopeType === "model" && rule.scopeValue) {
    providerFilters.push(`full_model = ${sqliteValue(rule.scopeValue)}`);
  } else if (rule.scopeType === "provider" && rule.scopeValue) {
    providerFilters.push(`provider = ${sqliteValue(rule.scopeValue)}`);
  }
  const rows = await usageDbQuery<{ value?: number }>(
    `SELECT SUM(spend_usd) AS value FROM provider_billing_buckets WHERE ${providerFilters.join(" AND ")};`,
  );
  return Number(rows[0]?.value || 0);
}

export async function previewUsageAlerts(now = Date.now()): Promise<UsageAlertEvaluation[]> {
  await ensureUsageDb();
  const rules = await listUsageAlertRules();
  const evaluations: UsageAlertEvaluation[] = [];
  for (const rule of rules) {
    const bounds = timelineBounds(now, rule.timeline);
    const observedValue = await queryObservedValue(rule, now);
    evaluations.push({
      ruleId: rule.id,
      kind: rule.kind,
      scopeType: rule.scopeType,
      scopeValue: rule.scopeValue,
      timeline: rule.timeline,
      thresholdValue: rule.thresholdValue,
      observedValue,
      status: observedValue > 0 ? "ok" : "no-data",
      reason: observedValue > 0 ? null : "No matching usage data in the selected window.",
      exceeded: rule.enabled && observedValue >= rule.thresholdValue,
      windowStart: bounds.start,
      windowEnd: bounds.end,
    });
  }
  return evaluations;
}

export async function evaluateAndStoreUsageAlerts(now = Date.now()): Promise<{
  evaluations: UsageAlertEvaluation[];
  firings: UsageAlertFiringRecord[];
}> {
  await ensureUsageDb();
  const monitorEnabled = await readAlertMonitorEnabled();
  const rules = await listUsageAlertRules();
  const evaluations: UsageAlertEvaluation[] = [];
  const statements: string[] = [];
  const firings: UsageAlertFiringRecord[] = [];

  for (const rule of rules) {
    const bounds = timelineBounds(now, rule.timeline);
    const observedValue = await queryObservedValue(rule, now);
    const exceeded = rule.enabled && monitorEnabled && observedValue >= rule.thresholdValue;
    const evaluation: UsageAlertEvaluation = {
      ruleId: rule.id,
      kind: rule.kind,
      scopeType: rule.scopeType,
      scopeValue: rule.scopeValue,
      timeline: rule.timeline,
      thresholdValue: rule.thresholdValue,
      observedValue,
      status: observedValue > 0 ? "ok" : "no-data",
      reason: observedValue > 0 ? null : "No matching usage data in the selected window.",
      exceeded,
      windowStart: bounds.start,
      windowEnd: bounds.end,
    };
    evaluations.push(evaluation);
    if (!exceeded) continue;
    const windowKey = timelineKey(now, rule.timeline);
    const message = [
      "Usage alert triggered:",
      `${rule.kind} ${rule.scopeType}${rule.scopeValue ? ` ${rule.scopeValue}` : ""}`,
      `${formatObserved(rule.kind, observedValue)} vs ${formatThreshold(rule.kind, rule.thresholdValue)}`,
    ].join(" ");
    statements.push(
      [
        "INSERT OR IGNORE INTO alert_firings (",
        "id, rule_id, window_key, observed_value, message, fired_at_ms, delivery_status, delivery_error",
        ") VALUES (",
        [
          sqliteValue(randomUUID()),
          sqliteValue(rule.id),
          sqliteValue(windowKey),
          observedValue,
          sqliteValue(message),
          now,
          sqliteValue("pending"),
          "NULL",
        ].join(", "),
        ");",
      ].join(" "),
      `UPDATE alert_rules SET cooldown_window_key = ${sqliteValue(windowKey)}, updated_at_ms = ${now} WHERE id = ${sqliteValue(rule.id)};`,
    );
    firings.push({
      id: "",
      ruleId: rule.id,
      windowKey,
      observedValue,
      message,
      firedAt: now,
      deliveryStatus: "pending",
      deliveryError: null,
    });
  }

  if (statements.length > 0) {
    await usageDbTransaction(statements);
  }
  await usageDbSetMeta("alerts.last_evaluated_ms", String(now));
  return {
    evaluations,
    firings: await listRecentAlertFirings(20),
  };
}

export async function listRecentAlertFirings(limit = 20): Promise<UsageAlertFiringRecord[]> {
  await ensureUsageDb();
  const rows = await usageDbQuery<{
    id?: string;
    rule_id?: string;
    window_key?: string;
    observed_value?: number;
    message?: string;
    fired_at_ms?: number;
    delivery_status?: "pending" | "sent" | "failed";
    delivery_error?: string | null;
  }>(
    `SELECT * FROM alert_firings ORDER BY fired_at_ms DESC LIMIT ${Math.max(1, Math.min(limit, 100))};`,
  );
  return rows
    .map((row) => {
      const id = String(row.id || "").trim();
      const ruleId = String(row.rule_id || "").trim();
      if (!id || !ruleId) return null;
      return {
        id,
        ruleId,
        windowKey: String(row.window_key || ""),
        observedValue: Number(row.observed_value || 0),
        message: String(row.message || ""),
        firedAt: Number(row.fired_at_ms || 0),
        deliveryStatus: (row.delivery_status || "pending") as "pending" | "sent" | "failed",
        deliveryError: row.delivery_error == null ? null : String(row.delivery_error),
      };
    })
    .filter((firing): firing is UsageAlertFiringRecord => firing !== null);
}

export async function pollPendingAlertFirings(limit = 20): Promise<UsageAlertFiringRecord[]> {
  const pending = await usageDbQuery<{
    id?: string;
    rule_id?: string;
    window_key?: string;
    observed_value?: number;
    message?: string;
    fired_at_ms?: number;
    delivery_status?: "pending" | "sent" | "failed";
    delivery_error?: string | null;
  }>(
    `SELECT * FROM alert_firings WHERE delivery_status = 'pending' ORDER BY fired_at_ms ASC LIMIT ${Math.max(1, Math.min(limit, 50))};`,
  );
  const validPending = pending.filter(
    (row) => String(row.id || "").trim().length > 0 && String(row.rule_id || "").trim().length > 0,
  );
  if (validPending.length === 0) return [];
  const ids = validPending.map((row) => sqliteValue(String(row.id || "").trim())).join(", ");
  await usageDbTransaction([
    `UPDATE alert_firings SET delivery_status = 'sent' WHERE id IN (${ids});`,
  ]);
  return validPending.map((row) => ({
    id: String(row.id || "").trim(),
    ruleId: String(row.rule_id || "").trim(),
    windowKey: String(row.window_key || ""),
    observedValue: Number(row.observed_value || 0),
    message: String(row.message || ""),
    firedAt: Number(row.fired_at_ms || 0),
    deliveryStatus: "sent",
    deliveryError: row.delivery_error == null ? null : String(row.delivery_error),
  }));
}

export async function readAlertRuntimeStatus(): Promise<{
  monitorEnabled: boolean;
  lastEvaluatedMs: number | null;
}> {
  const lastRaw = await usageDbGetMeta("alerts.last_evaluated_ms");
  return {
    monitorEnabled: await readAlertMonitorEnabled(),
    lastEvaluatedMs: lastRaw ? Number(lastRaw) || null : null,
  };
}
