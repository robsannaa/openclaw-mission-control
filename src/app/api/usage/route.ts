import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { getOpenClawHome } from "@/lib/paths";
import { runCliJson } from "@/lib/openclaw";
import { fetchGatewaySessions } from "@/lib/gateway-sessions";
import type { NormalizedGatewaySession } from "@/lib/gateway-sessions";
import { estimateCostUsd } from "@/lib/model-metadata";
import { fetchOpenRouterPricing } from "@/lib/openrouter-pricing";
import { appendSessionSnapshots, aggregateHistory } from "@/lib/usage-history";

const OPENCLAW_HOME = getOpenClawHome();
export const dynamic = "force-dynamic";

/* ── Types ──────────────────────────────────────── */

type SessionEntry = {
  key: string;
  kind: string;
  updatedAt: number;
  ageMs: number;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalTokensFresh: boolean;
  model: string;
  fullModel: string;
  contextTokens: number;
  thinkingLevel?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  percentUsed?: number;
  remainingTokens?: number;
  estimatedCostUsd: number | null;
};

type ModelStatusData = {
  defaultModel: string;
  resolvedDefault: string;
  fallbacks: string[];
  imageModel: string;
  imageFallbacks: string[];
  aliases: Record<string, string>;
  allowed: string[];
  auth?: {
    providers: {
      provider: string;
      effective: { kind: string; detail: string };
      profiles: { count: number; oauth: number; token: number; apiKey: number };
    }[];
  };
};

type Period = "last1h" | "last24h" | "last7d" | "allTime";

type ActivityPoint = {
  ts: number;
  input: number;
  output: number;
  total: number;
  sessions: number;
};

type SessionWithAgent = SessionEntry & { agentId: string };

type DiagnosticsSource = {
  ok: boolean;
  error: string | null;
};

type MissingPricingModel = {
  model: string;
  sessions: number;
  totalTokens: number;
};

type UsageDiagnostics = {
  sources: {
    gateway: DiagnosticsSource;
    usageHistoryWrite: DiagnosticsSource;
    historical: DiagnosticsSource;
    modelStatus: DiagnosticsSource;
    agentDirectory: DiagnosticsSource;
    sessionStorage: DiagnosticsSource & { failedAgents: string[] };
  };
  pricing: {
    coveredSessions: number;
    uncoveredSessions: number;
    coveragePct: number;
    uncoveredModels: MissingPricingModel[];
  };
  warnings: string[];
};

async function readJsonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function buildActivitySeries(
  sessions: SessionWithAgent[],
  now: number
): Record<Period, ActivityPoint[]> {
  const buildFixed = (windowMs: number, binMs: number): ActivityPoint[] => {
    const bins = Math.max(1, Math.ceil(windowMs / binMs));
    const start = now - bins * binMs;
    const points: ActivityPoint[] = Array.from({ length: bins }, (_, i) => ({
      ts: start + i * binMs,
      input: 0,
      output: 0,
      total: 0,
      sessions: 0,
    }));
    for (const s of sessions) {
      if (!s.updatedAt || s.updatedAt < start || s.updatedAt > now) continue;
      const idx = Math.floor((s.updatedAt - start) / binMs);
      if (idx < 0 || idx >= points.length) continue;
      points[idx].input += s.inputTokens;
      points[idx].output += s.outputTokens;
      points[idx].total += s.totalTokens;
      points[idx].sessions += 1;
    }
    return points;
  };

  const validTimestamps = sessions
    .map((s) => s.updatedAt)
    .filter((t): t is number => Number.isFinite(t) && t > 0);
  const earliest = validTimestamps.length ? Math.min(...validTimestamps) : now - 24 * 3600_000;
  const spanMs = Math.max(now - earliest, 3600_000);
  const targetBins = 30;
  const rawBinMs = Math.ceil(spanMs / targetBins);
  const binFloor = 15 * 60_000;
  const dynamicBinMs = Math.max(binFloor, Math.ceil(rawBinMs / binFloor) * binFloor);
  const dynamicWindowMs = dynamicBinMs * targetBins;

  return {
    last1h: buildFixed(3600_000, 5 * 60_000),
    last24h: buildFixed(24 * 3600_000, 3600_000),
    last7d: buildFixed(7 * 24 * 3600_000, 6 * 3600_000),
    allTime: buildFixed(dynamicWindowMs, dynamicBinMs),
  };
}

function getErrorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 280);
  return String(err).slice(0, 280);
}

/* ── GET /api/usage ──────────────────────────────── */

export async function GET() {
  try {
    // 1. Config for agents list
    const configPath = join(OPENCLAW_HOME, "openclaw.json");
    const config = await readJsonSafe<Record<string, unknown>>(configPath, {});
    const agentsConfig = (config.agents || {}) as Record<string, unknown>;
    const defaults = (agentsConfig.defaults || {}) as Record<string, unknown>;
    const configList = (agentsConfig.list || []) as Record<string, unknown>[];
    const defaultModelCfg = defaults.model as Record<string, unknown> | undefined;
    const defaultPrimary = (defaultModelCfg?.primary as string) || "unknown";
    const defaultFallbacks = (defaultModelCfg?.fallbacks as string[]) || [];
    const diagnostics: UsageDiagnostics = {
      sources: {
        gateway: { ok: true, error: null },
        usageHistoryWrite: { ok: true, error: null },
        historical: { ok: true, error: null },
        modelStatus: { ok: true, error: null },
        agentDirectory: { ok: true, error: null },
        sessionStorage: { ok: true, error: null, failedAgents: [] },
      },
      pricing: {
        coveredSessions: 0,
        uncoveredSessions: 0,
        coveragePct: 100,
        uncoveredModels: [],
      },
      warnings: [],
    };

    // Collect all agent IDs
    const agentIds: string[] = [];
    for (const c of configList) {
      if (c.id) agentIds.push(c.id as string);
    }
    try {
      const dirs = await readdir(join(OPENCLAW_HOME, "agents"), { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && !agentIds.includes(d.name)) agentIds.push(d.name);
      }
    } catch (err) {
      if (getErrorCode(err) !== "ENOENT") {
        diagnostics.sources.agentDirectory.ok = false;
        diagnostics.sources.agentDirectory.error = errorMessage(err);
        diagnostics.warnings.push("Agent directory scan failed; agent totals may be incomplete.");
      }
    }

    // 2. Read sessions from gateway source of truth
    const allSessions: SessionWithAgent[] = [];
    let liveSessions: NormalizedGatewaySession[] = [];
    try {
      liveSessions = await fetchGatewaySessions(12000);
    } catch (err) {
      diagnostics.sources.gateway.ok = false;
      diagnostics.sources.gateway.error = errorMessage(err);
      diagnostics.warnings.push("Live gateway sessions are unavailable; live usage may be incomplete.");
    }

    try {
      await appendSessionSnapshots(liveSessions);
    } catch (err) {
      diagnostics.sources.usageHistoryWrite.ok = false;
      diagnostics.sources.usageHistoryWrite.error = errorMessage(err);
      diagnostics.warnings.push("Failed to persist usage snapshots; historical trend may lag.");
    }
    // Fetch dynamic OpenRouter pricing as fallback for models not in static metadata
    const dynamicPricing = await fetchOpenRouterPricing();

    const missingPricingModels = new Map<string, MissingPricingModel>();
    let missingPricingSessions = 0;

    for (const s of liveSessions) {
      const cost = estimateCostUsd(
        s.fullModel,
        s.inputTokens,
        s.outputTokens,
        s.cacheReadTokens,
        s.cacheWriteTokens,
        dynamicPricing,
      );
      if (cost == null) {
        missingPricingSessions += 1;
        const prev = missingPricingModels.get(s.fullModel) || {
          model: s.fullModel,
          sessions: 0,
          totalTokens: 0,
        };
        prev.sessions += 1;
        prev.totalTokens += s.totalTokens;
        missingPricingModels.set(s.fullModel, prev);
      }
      allSessions.push({
        key: s.key,
        kind: s.kind,
        updatedAt: s.updatedAt,
        ageMs: s.ageMs,
        sessionId: s.sessionId,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheReadTokens: s.cacheReadTokens,
        cacheWriteTokens: s.cacheWriteTokens,
        totalTokens: s.totalTokens,
        totalTokensFresh: s.totalTokensFresh,
        model: s.model,
        fullModel: s.fullModel,
        contextTokens: s.contextTokens,
        thinkingLevel: s.thinkingLevel,
        systemSent: s.systemSent,
        abortedLastRun: s.abortedLastRun,
        percentUsed: s.contextTokens
          ? Math.round((s.totalTokens / Math.max(1, s.contextTokens)) * 100)
          : undefined,
        remainingTokens: s.contextTokens
          ? s.contextTokens - s.totalTokens
          : undefined,
        estimatedCostUsd: cost,
        agentId: s.agentId || "unknown",
      });
    }

    // 3. Sort by updatedAt desc
    allSessions.sort((a, b) => b.updatedAt - a.updatedAt);

    // 4. Aggregate stats
    // By model
    const byModel: Record<string, {
      model: string;
      fullModel: string;
      sessions: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalTokens: number;
      contextTokens: number;
      agents: Set<string>;
      lastUsed: number;
      avgPercentUsed: number;
      estimatedCostUsd: number | null;
    }> = {};

    // By agent
    const byAgent: Record<string, {
      agentId: string;
      sessions: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalTokens: number;
      contextTokens: number;
      models: Set<string>;
      lastUsed: number;
      estimatedCostUsd: number | null;
    }> = {};

    // Time buckets (last 24h, 7d, 30d, all time)
    const now = Date.now();
    const buckets = {
      last1h: { input: 0, output: 0, total: 0, sessions: 0 },
      last24h: { input: 0, output: 0, total: 0, sessions: 0 },
      last7d: { input: 0, output: 0, total: 0, sessions: 0 },
      allTime: { input: 0, output: 0, total: 0, sessions: 0 },
    };

    let grandTotalInput = 0;
    let grandTotalOutput = 0;
    let grandTotalTokens = 0;
    let grandTotalCacheRead = 0;
    let grandTotalCacheWrite = 0;
    let grandTotalCostUsd = 0;
    let staleSessions = 0;
    let peakSession: (SessionEntry & { agentId: string }) | null = null;

    for (const s of allSessions) {
      grandTotalInput += s.inputTokens;
      grandTotalOutput += s.outputTokens;
      grandTotalTokens += s.totalTokens;
      grandTotalCacheRead += s.cacheReadTokens;
      grandTotalCacheWrite += s.cacheWriteTokens;
      if (s.estimatedCostUsd != null) grandTotalCostUsd += s.estimatedCostUsd;
      if (!s.totalTokensFresh) staleSessions += 1;

      // Peak session
      if (!peakSession || s.totalTokens > peakSession.totalTokens) {
        peakSession = s;
      }

      // Time buckets
      const age = now - s.updatedAt;
      buckets.allTime.input += s.inputTokens;
      buckets.allTime.output += s.outputTokens;
      buckets.allTime.total += s.totalTokens;
      buckets.allTime.sessions += 1;
      if (age < 7 * 86400_000) {
        buckets.last7d.input += s.inputTokens;
        buckets.last7d.output += s.outputTokens;
        buckets.last7d.total += s.totalTokens;
        buckets.last7d.sessions += 1;
      }
      if (age < 86400_000) {
        buckets.last24h.input += s.inputTokens;
        buckets.last24h.output += s.outputTokens;
        buckets.last24h.total += s.totalTokens;
        buckets.last24h.sessions += 1;
      }
      if (age < 3600_000) {
        buckets.last1h.input += s.inputTokens;
        buckets.last1h.output += s.outputTokens;
        buckets.last1h.total += s.totalTokens;
        buckets.last1h.sessions += 1;
      }

      // By model
      if (!byModel[s.model]) {
        byModel[s.model] = {
          model: s.model,
          fullModel: s.fullModel,
          sessions: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
          contextTokens: 0,
          agents: new Set(),
          lastUsed: 0,
          avgPercentUsed: 0,
          estimatedCostUsd: null,
        };
      }
      const bm = byModel[s.model];
      bm.sessions += 1;
      bm.inputTokens += s.inputTokens;
      bm.outputTokens += s.outputTokens;
      bm.cacheReadTokens += s.cacheReadTokens;
      bm.cacheWriteTokens += s.cacheWriteTokens;
      bm.totalTokens += s.totalTokens;
      bm.contextTokens = Math.max(bm.contextTokens, s.contextTokens);
      bm.agents.add(s.agentId);
      bm.lastUsed = Math.max(bm.lastUsed, s.updatedAt);
      if (s.estimatedCostUsd != null) {
        bm.estimatedCostUsd = (bm.estimatedCostUsd ?? 0) + s.estimatedCostUsd;
      }

      // By agent
      if (!byAgent[s.agentId]) {
        byAgent[s.agentId] = {
          agentId: s.agentId,
          sessions: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
          contextTokens: 0,
          models: new Set(),
          lastUsed: 0,
          estimatedCostUsd: null,
        };
      }
      const ba = byAgent[s.agentId];
      ba.sessions += 1;
      ba.inputTokens += s.inputTokens;
      ba.outputTokens += s.outputTokens;
      ba.cacheReadTokens += s.cacheReadTokens;
      ba.cacheWriteTokens += s.cacheWriteTokens;
      ba.totalTokens += s.totalTokens;
      ba.contextTokens = Math.max(ba.contextTokens, s.contextTokens);
      ba.models.add(s.model);
      ba.lastUsed = Math.max(ba.lastUsed, s.updatedAt);
      if (s.estimatedCostUsd != null) {
        ba.estimatedCostUsd = (ba.estimatedCostUsd ?? 0) + s.estimatedCostUsd;
      }
    }

    // Compute avg percent for models
    for (const m of Object.values(byModel)) {
      if (m.contextTokens > 0 && m.sessions > 0) {
        m.avgPercentUsed = Math.round((m.totalTokens / m.sessions) / m.contextTokens * 100);
      }
    }

    // 5. Model config (primary/fallbacks/aliases/auth)
    let modelStatus: ModelStatusData | null = null;
    try {
      modelStatus = await runCliJson<ModelStatusData>(["models", "status"], 10000);
    } catch (err) {
      diagnostics.sources.modelStatus.ok = false;
      diagnostics.sources.modelStatus.error = errorMessage(err);
      diagnostics.warnings.push("Model routing metadata is unavailable right now.");
    }

    // Per-agent model configs
    const agentModels: { agentId: string; primary: string; fallbacks: string[] }[] = [];
    for (const cfg of configList) {
      const id = cfg.id as string;
      if (!id) continue;
      const agentModelCfg = cfg.model as Record<string, unknown> | undefined;
      const primary = (agentModelCfg?.primary as string) || defaultPrimary;
      const fallbacks = (agentModelCfg?.fallbacks as string[]) || defaultFallbacks;
      agentModels.push({ agentId: id, primary, fallbacks });
    }

    // 6. Session log size per agent
    const sessionFileSizes: { agentId: string; sizeBytes: number; fileCount: number }[] = [];
    for (const agentId of agentIds) {
      const sessDir = join(OPENCLAW_HOME, "agents", agentId, "sessions");
      try {
        const files = await readdir(sessDir);
        let totalSize = 0;
        let count = 0;
        for (const f of files) {
          if (f.endsWith(".jsonl") && !f.includes(".deleted")) {
            const st = await stat(join(sessDir, f));
            totalSize += st.size;
            count += 1;
          }
        }
        sessionFileSizes.push({ agentId, sizeBytes: totalSize, fileCount: count });
      } catch (err) {
        if (getErrorCode(err) === "ENOENT") continue;
        diagnostics.sources.sessionStorage.ok = false;
        if (!diagnostics.sources.sessionStorage.error) {
          diagnostics.sources.sessionStorage.error = errorMessage(err);
        }
        diagnostics.sources.sessionStorage.failedAgents.push(agentId);
      }
    }
    if (!diagnostics.sources.sessionStorage.ok) {
      diagnostics.warnings.push(
        `Session storage metrics failed for ${diagnostics.sources.sessionStorage.failedAgents.length} agent(s).`,
      );
    }

    // Convert Sets to arrays for JSON
    const modelBreakdown = Object.values(byModel)
      .map((m) => ({
        ...m,
        agents: Array.from(m.agents),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    const agentBreakdown = Object.values(byAgent)
      .map((a) => ({
        ...a,
        models: Array.from(a.models),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    const activitySeries = buildActivitySeries(allSessions, now);

    // Per-model activity series for Token Flow filter (all vs specific model)
    const activitySeriesByModel: Record<string, Record<Period, ActivityPoint[]>> = {};
    for (const modelKey of Object.keys(byModel)) {
      const sessionsForModel = allSessions.filter((s) => s.model === modelKey);
      activitySeriesByModel[modelKey] = buildActivitySeries(sessionsForModel, now);
    }

    // Load historical aggregates (never blocks if CSV missing)
    let historical = null;
    try {
      historical = await aggregateHistory();
    } catch (err) {
      diagnostics.sources.historical.ok = false;
      diagnostics.sources.historical.error = errorMessage(err);
      diagnostics.warnings.push("Historical usage aggregation failed; trend charts may be missing.");
    }
    const uncoveredModels = Array.from(missingPricingModels.values())
      .sort((a, b) => b.sessions - a.sessions);
    const coveredSessions = allSessions.length - missingPricingSessions;
    diagnostics.pricing = {
      coveredSessions,
      uncoveredSessions: missingPricingSessions,
      coveragePct: allSessions.length
        ? Math.round((coveredSessions / allSessions.length) * 100)
        : 100,
      uncoveredModels,
    };
    if (missingPricingSessions > 0) {
      diagnostics.warnings.push(
        `${missingPricingSessions} session(s) are excluded from cost because pricing metadata is missing.`,
      );
    }

    return NextResponse.json({
      totals: {
        sessions: allSessions.length,
        inputTokens: grandTotalInput,
        outputTokens: grandTotalOutput,
        totalTokens: grandTotalTokens,
        models: Object.keys(byModel).length,
        agents: agentIds.length,
        staleSessions,
      },
      liveCost: {
        totalEstimatedUsd: grandTotalCostUsd,
        totalCacheReadTokens: grandTotalCacheRead,
        totalCacheWriteTokens: grandTotalCacheWrite,
      },
      buckets,
      activitySeries,
      activitySeriesByModel,
      modelBreakdown,
      agentBreakdown,
      sessions: allSessions.slice(0, 50), // top 50 most recent
      peakSession: peakSession
        ? {
            sessionId: peakSession.sessionId,
            key: peakSession.key,
            agentId: peakSession.agentId,
            model: peakSession.model,
            totalTokens: peakSession.totalTokens,
            contextTokens: peakSession.contextTokens,
            percentUsed: peakSession.percentUsed,
          }
        : null,
      modelConfig: modelStatus
        ? {
            primary: modelStatus.defaultModel,
            fallbacks: modelStatus.fallbacks,
            imageModel: modelStatus.imageModel,
            aliases: modelStatus.aliases,
            allowed: modelStatus.allowed,
            authProviders: (modelStatus.auth?.providers || []).map((p) => ({
              provider: p.provider,
              authKind: p.effective.kind,
              profiles: p.profiles.count,
            })),
          }
        : null,
      agentModels,
      sessionFileSizes,
      historical,
      diagnostics,
    });
  } catch (err) {
    console.error("Usage API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
