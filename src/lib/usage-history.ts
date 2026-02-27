/**
 * CSV-backed persistent usage history.
 *
 * File: $OPENCLAW_HOME/mission-control/usage-history.csv (append-only)
 *
 * Dedup on write: only appends when a session's totalTokens has increased.
 * Dedup on read: keeps highest-token row per sessionId for aggregates.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { getOpenClawHome } from "@/lib/paths";
import { estimateCostUsd } from "@/lib/model-metadata";
import type { NormalizedGatewaySession } from "@/lib/gateway-sessions";

const CSV_HEADER =
  "timestamp,sessionId,agentId,fullModel,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens,contextTokens,thinkingLevel,totalTokensFresh,estimatedCostUsd";

export type UsageHistoryRow = {
  timestamp: string;
  sessionId: string;
  agentId: string;
  fullModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  contextTokens: number;
  thinkingLevel: string;
  totalTokensFresh: boolean;
  estimatedCostUsd: number | null;
};

export type HistoricalAggregate = {
  byModel: Record<
    string,
    { totalTokens: number; estimatedCostUsd: number; sessions: number }
  >;
  byAgent: Record<
    string,
    { totalTokens: number; estimatedCostUsd: number; sessions: number }
  >;
  costTimeSeries: { ts: number; costUsd: number; tokens: number }[];
  totalEstimatedUsd: number;
  totalTokens: number;
  rowCount: number;
};

function csvPath(): string {
  return join(getOpenClawHome(), "mission-control", "usage-history.csv");
}

function escapeField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsvLine(row: UsageHistoryRow): string {
  return [
    row.timestamp,
    escapeField(row.sessionId),
    escapeField(row.agentId),
    escapeField(row.fullModel),
    String(row.inputTokens),
    String(row.outputTokens),
    String(row.cacheReadTokens),
    String(row.cacheWriteTokens),
    String(row.totalTokens),
    String(row.contextTokens),
    escapeField(row.thinkingLevel),
    row.totalTokensFresh ? "true" : "false",
    row.estimatedCostUsd != null ? row.estimatedCostUsd.toFixed(6) : "",
  ].join(",");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function lineToRow(fields: string[]): UsageHistoryRow | null {
  if (fields.length < 13) return null;
  const totalTokens = Number(fields[8]);
  if (!Number.isFinite(totalTokens)) return null;
  return {
    timestamp: fields[0],
    sessionId: fields[1],
    agentId: fields[2],
    fullModel: fields[3],
    inputTokens: Number(fields[4]) || 0,
    outputTokens: Number(fields[5]) || 0,
    cacheReadTokens: Number(fields[6]) || 0,
    cacheWriteTokens: Number(fields[7]) || 0,
    totalTokens,
    contextTokens: Number(fields[9]) || 0,
    thinkingLevel: fields[10],
    totalTokensFresh: fields[11] === "true",
    estimatedCostUsd: fields[12] ? Number(fields[12]) || null : null,
  };
}

/**
 * Read all rows from the CSV file.
 */
export async function readUsageHistory(): Promise<UsageHistoryRow[]> {
  const path = csvPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  // Skip header
  const rows: UsageHistoryRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row = lineToRow(fields);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Deduplicated append-only write. Only appends sessions whose
 * totalTokens has increased since their last snapshot in the CSV.
 */
export async function appendSessionSnapshots(
  sessions: NormalizedGatewaySession[],
): Promise<number> {
  if (!sessions.length) return 0;

  const path = csvPath();

  // Read existing rows to build dedup map: sessionId -> max totalTokens
  const existing = await readUsageHistory();
  const maxTokens = new Map<string, number>();
  for (const row of existing) {
    const prev = maxTokens.get(row.sessionId) ?? 0;
    if (row.totalTokens > prev) maxTokens.set(row.sessionId, row.totalTokens);
  }

  // Filter: only sessions with increased tokens
  const now = new Date().toISOString();
  const newLines: string[] = [];
  for (const s of sessions) {
    const prevMax = maxTokens.get(s.sessionId) ?? 0;
    if (s.totalTokens <= prevMax || s.totalTokens <= 0) continue;
    const cost = estimateCostUsd(
      s.fullModel,
      s.inputTokens,
      s.outputTokens,
      s.cacheReadTokens,
      s.cacheWriteTokens,
    );
    const row: UsageHistoryRow = {
      timestamp: now,
      sessionId: s.sessionId,
      agentId: s.agentId || "unknown",
      fullModel: s.fullModel,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      cacheReadTokens: s.cacheReadTokens,
      cacheWriteTokens: s.cacheWriteTokens,
      totalTokens: s.totalTokens,
      contextTokens: s.contextTokens,
      thinkingLevel: s.thinkingLevel || "",
      totalTokensFresh: s.totalTokensFresh,
      estimatedCostUsd: cost,
    };
    newLines.push(rowToCsvLine(row));
  }

  if (!newLines.length) return 0;

  // Ensure directory exists
  await mkdir(dirname(path), { recursive: true });

  // If file doesn't exist yet, write header first
  const needsHeader = existing.length === 0;
  const content =
    (needsHeader ? CSV_HEADER + "\n" : "") + newLines.join("\n") + "\n";
  await writeFile(path, content, { flag: "a" });

  return newLines.length;
}

/**
 * Aggregate history with deduplication (keep highest-token row per sessionId).
 * Returns per-model, per-agent breakdowns and an hourly cost time series.
 */
export async function aggregateHistory(): Promise<HistoricalAggregate> {
  const rows = await readUsageHistory();

  // Dedup: keep highest-token row per sessionId
  const best = new Map<string, UsageHistoryRow>();
  for (const row of rows) {
    const prev = best.get(row.sessionId);
    if (!prev || row.totalTokens > prev.totalTokens) {
      best.set(row.sessionId, row);
    }
  }

  const deduped = Array.from(best.values());

  const byModel: HistoricalAggregate["byModel"] = {};
  const byAgent: HistoricalAggregate["byAgent"] = {};
  let totalEstimatedUsd = 0;
  let totalTokens = 0;

  // Hourly buckets for cost time series
  const hourBuckets = new Map<number, { costUsd: number; tokens: number }>();

  for (const row of deduped) {
    const cost = row.estimatedCostUsd ?? 0;
    totalEstimatedUsd += cost;
    totalTokens += row.totalTokens;

    // By model
    if (!byModel[row.fullModel]) {
      byModel[row.fullModel] = { totalTokens: 0, estimatedCostUsd: 0, sessions: 0 };
    }
    byModel[row.fullModel].totalTokens += row.totalTokens;
    byModel[row.fullModel].estimatedCostUsd += cost;
    byModel[row.fullModel].sessions += 1;

    // By agent
    if (!byAgent[row.agentId]) {
      byAgent[row.agentId] = { totalTokens: 0, estimatedCostUsd: 0, sessions: 0 };
    }
    byAgent[row.agentId].totalTokens += row.totalTokens;
    byAgent[row.agentId].estimatedCostUsd += cost;
    byAgent[row.agentId].sessions += 1;

    // Hourly bucket from timestamp
    const ts = new Date(row.timestamp).getTime();
    if (Number.isFinite(ts)) {
      const hourKey = Math.floor(ts / 3_600_000) * 3_600_000;
      const bucket = hourBuckets.get(hourKey) || { costUsd: 0, tokens: 0 };
      bucket.costUsd += cost;
      bucket.tokens += row.totalTokens;
      hourBuckets.set(hourKey, bucket);
    }
  }

  // Sort time series chronologically
  const costTimeSeries = Array.from(hourBuckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, data]) => ({ ts, ...data }));

  return {
    byModel,
    byAgent,
    costTimeSeries,
    totalEstimatedUsd,
    totalTokens,
    rowCount: rows.length,
  };
}
