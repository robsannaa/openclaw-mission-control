import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { fetchGatewaySessions } from "@/lib/gateway-sessions";
import type { NormalizedGatewaySession } from "@/lib/gateway-sessions";
import {
  evaluateUsageAlertRules,
  getProviderCapabilities,
  normalizeTimeline,
  readUsageAlertState,
  type UsageAlertRule,
  writeUsageAlertState,
} from "@/lib/usage-alerts";

export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function findRuleIndex(rules: UsageAlertRule[], ruleId: string): number {
  return rules.findIndex((rule) => rule.id === ruleId);
}

async function buildStatusPayload(emitAlerts: boolean) {
  const { state, warning } = await readUsageAlertState();
  let sessions: NormalizedGatewaySession[] = [];
  let degraded = false;
  let sessionsWarning: string | undefined;
  try {
    sessions = await fetchGatewaySessions(12000);
  } catch (err) {
    degraded = true;
    sessionsWarning = `Failed to read live sessions: ${String(err)}`;
  }

  const { evaluations, alerts, nextLastTriggeredByRule, changed } = evaluateUsageAlertRules({
    rules: state.rules,
    sessions,
    now: Date.now(),
    lastTriggeredByRule: state.lastTriggeredByRule,
    emitAlerts: emitAlerts && state.monitorEnabled && !degraded,
  });

  if (emitAlerts && changed) {
    state.lastTriggeredByRule = nextLastTriggeredByRule;
    state.updatedAt = Date.now();
    await writeUsageAlertState(state);
  }

  const warnings = [warning, sessionsWarning].filter(Boolean) as string[];

  return NextResponse.json({
    ok: true,
    monitorEnabled: state.monitorEnabled,
    rules: state.rules,
    evaluations,
    alerts: emitAlerts ? alerts : [],
    providerCapabilities: getProviderCapabilities(),
    warning: warnings.length ? warnings.join(" | ") : undefined,
    degraded,
    timestamp: Date.now(),
  });
}

export async function GET() {
  const { state, warning } = await readUsageAlertState();
  return NextResponse.json({
    ok: true,
    monitorEnabled: state.monitorEnabled,
    rules: state.rules,
    providerCapabilities: getProviderCapabilities(),
    warning: warning || undefined,
    timestamp: Date.now(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "").trim().toLowerCase();

    if (action === "status") {
      return await buildStatusPayload(false);
    }
    if (action === "check") {
      return await buildStatusPayload(true);
    }

    const { state } = await readUsageAlertState();

    if (action === "set-monitor") {
      state.monitorEnabled = Boolean(body.monitorEnabled);
      state.updatedAt = Date.now();
      await writeUsageAlertState(state);
      return NextResponse.json({ ok: true, monitorEnabled: state.monitorEnabled });
    }

    if (action === "create") {
      const fullModel = String(body.fullModel || "").trim();
      const timeline = normalizeTimeline(body.timeline);
      const tokenLimit = toPositiveInt(body.tokenLimit);
      if (!fullModel) return badRequest("Model is required.");
      if (!timeline) return badRequest("Timeline must be one of: last1h, last24h, last7d.");
      if (!tokenLimit) return badRequest("Token limit must be a positive number.");

      const duplicate = state.rules.some(
        (rule) =>
          rule.fullModel === fullModel &&
          rule.timeline === timeline &&
          rule.tokenLimit === tokenLimit,
      );
      if (duplicate) {
        return badRequest("An identical alarm rule already exists.");
      }

      const now = Date.now();
      state.rules.push({
        id: randomUUID(),
        fullModel,
        timeline,
        tokenLimit,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      state.updatedAt = now;
      await writeUsageAlertState(state);
      return NextResponse.json({ ok: true, rules: state.rules, monitorEnabled: state.monitorEnabled });
    }

    if (action === "update") {
      const ruleId = String(body.ruleId || "").trim();
      if (!ruleId) return badRequest("ruleId is required.");
      const idx = findRuleIndex(state.rules, ruleId);
      if (idx < 0) return badRequest("Rule not found.");

      const timeline = body.timeline === undefined ? null : normalizeTimeline(body.timeline);
      if (body.timeline !== undefined && !timeline) {
        return badRequest("Timeline must be one of: last1h, last24h, last7d.");
      }
      const tokenLimit = body.tokenLimit === undefined ? null : toPositiveInt(body.tokenLimit);
      if (body.tokenLimit !== undefined && !tokenLimit) {
        return badRequest("Token limit must be a positive number.");
      }
      const fullModel =
        body.fullModel === undefined ? null : String(body.fullModel || "").trim();
      if (body.fullModel !== undefined && !fullModel) {
        return badRequest("Model must be a non-empty string.");
      }

      const prev = state.rules[idx];
      state.rules[idx] = {
        ...prev,
        fullModel: fullModel ?? prev.fullModel,
        timeline: timeline ?? prev.timeline,
        tokenLimit: tokenLimit ?? prev.tokenLimit,
        enabled: body.enabled === undefined ? prev.enabled : Boolean(body.enabled),
        updatedAt: Date.now(),
      };
      state.updatedAt = Date.now();
      await writeUsageAlertState(state);
      return NextResponse.json({ ok: true, rules: state.rules, monitorEnabled: state.monitorEnabled });
    }

    if (action === "toggle") {
      const ruleId = String(body.ruleId || "").trim();
      if (!ruleId) return badRequest("ruleId is required.");
      const idx = findRuleIndex(state.rules, ruleId);
      if (idx < 0) return badRequest("Rule not found.");
      const enabled = Boolean(body.enabled);
      state.rules[idx] = {
        ...state.rules[idx],
        enabled,
        updatedAt: Date.now(),
      };
      state.updatedAt = Date.now();
      await writeUsageAlertState(state);
      return NextResponse.json({ ok: true, rules: state.rules, monitorEnabled: state.monitorEnabled });
    }

    if (action === "delete") {
      const ruleId = String(body.ruleId || "").trim();
      if (!ruleId) return badRequest("ruleId is required.");
      const before = state.rules.length;
      state.rules = state.rules.filter((rule) => rule.id !== ruleId);
      if (state.rules.length === before) return badRequest("Rule not found.");
      delete state.lastTriggeredByRule[ruleId];
      state.updatedAt = Date.now();
      await writeUsageAlertState(state);
      return NextResponse.json({ ok: true, rules: state.rules, monitorEnabled: state.monitorEnabled });
    }

    return badRequest(`Unknown action: ${action}`);
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
