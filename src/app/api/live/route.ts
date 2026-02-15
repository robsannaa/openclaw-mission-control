import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { getOpenClawHome, getGatewayUrl, getGatewayPort } from "@/lib/paths";

const OPENCLAW_HOME = getOpenClawHome();

async function readJsonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function tailLines(path: string, n: number): Promise<string[]> {
  try {
    const content = await readFile(path, "utf-8");
    return content.trim().split("\n").filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}

async function checkGatewayHealth(): Promise<{
  status: string;
  latencyMs: number;
}> {
  const start = Date.now();
  try {
    const gwUrl = await getGatewayUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${gwUrl}/`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { status: res.ok ? "online" : "degraded", latencyMs: Date.now() - start };
  } catch {
    return { status: "offline", latencyMs: Date.now() - start };
  }
}

type CronJobLive = {
  id: string;
  name: string;
  enabled: boolean;
  lastStatus: string;
  lastRunAtMs: number | null;
  nextRunAtMs: number | null;
  lastDurationMs: number | null;
  consecutiveErrors: number;
  lastError: string | null;
  scheduleDisplay: string;
};

type CronRunEntry = {
  ts: number;
  jobId: string;
  action: string;
  status: string;
  summary?: string;
  durationMs?: number;
  error?: string;
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [gateway, cronData, logs, cronRuns, agents] = await Promise.all([
      checkGatewayHealth(),
      readCronJobs(),
      tailLines(join(OPENCLAW_HOME, "logs", "gateway.log"), 40),
      readRecentCronRuns(),
      readAgentSessions(),
    ]);

    // Parse gateway logs into structured entries
    const logEntries = logs.map((line) => {
      const match = line.match(
        /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[([^\]]+)\]\s+(.*)/
      );
      if (match) {
        return { time: match[1], source: match[2], message: match[3] };
      }
      return { time: "", source: "unknown", message: line };
    }).reverse(); // newest first

    // Read config metadata
    const config = await readJsonSafe<Record<string, unknown>>(
      join(OPENCLAW_HOME, "openclaw.json"),
      {}
    );
    const meta = (config.meta || {}) as Record<string, unknown>;

    const gwPort = await getGatewayPort();

    return NextResponse.json({
      timestamp: Date.now(),
      gateway: {
        ...gateway,
        port: gwPort,
        version: (meta.lastTouchedVersion as string) || "unknown",
      },
      cron: cronData,
      cronRuns,
      agents,
      logEntries: logEntries.slice(0, 30),
    });
  } catch (err) {
    console.error("Live API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function readCronJobs(): Promise<{
  jobs: CronJobLive[];
  stats: { total: number; ok: number; error: number };
}> {
  const data = await readJsonSafe<{ jobs?: Record<string, unknown>[] }>(
    join(OPENCLAW_HOME, "cron", "jobs.json"),
    { jobs: [] }
  );
  const jobs: CronJobLive[] = (data.jobs || []).map((j: Record<string, unknown>) => {
    const schedule = (j.schedule || {}) as Record<string, unknown>;
    const state = (j.state || {}) as Record<string, unknown>;
    let scheduleDisplay = "";
    if (schedule.kind === "cron" && schedule.expr) {
      scheduleDisplay = `${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ""}`;
    } else if (schedule.kind === "every" && schedule.everyMs) {
      const mins = Math.round((schedule.everyMs as number) / 60000);
      scheduleDisplay = mins < 60 ? `Every ${mins}m` : `Every ${Math.round(mins / 60)}h`;
    }
    return {
      id: j.id as string,
      name: j.name as string,
      enabled: j.enabled as boolean,
      lastStatus: (state.lastStatus as string) || "unknown",
      lastRunAtMs: (state.lastRunAtMs as number) || null,
      nextRunAtMs: (state.nextRunAtMs as number) || null,
      lastDurationMs: (state.lastDurationMs as number) || null,
      consecutiveErrors: (state.consecutiveErrors as number) || 0,
      lastError: (state.lastError as string) || null,
      scheduleDisplay,
    };
  });
  return {
    jobs,
    stats: {
      total: jobs.length,
      ok: jobs.filter((j) => j.lastStatus === "ok").length,
      error: jobs.filter((j) => j.lastStatus === "error").length,
    },
  };
}

async function readRecentCronRuns(): Promise<CronRunEntry[]> {
  const runsDir = join(OPENCLAW_HOME, "cron", "runs");
  const all: CronRunEntry[] = [];
  try {
    const files = await readdir(runsDir);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const lines = await tailLines(join(runsDir, file), 5);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as CronRunEntry;
          all.push(entry);
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* runs dir may not exist */ }
  all.sort((a, b) => b.ts - a.ts);
  return all.slice(0, 15);
}

async function readAgentSessions(): Promise<
  { id: string; sessionCount: number; totalTokens: number; lastActivity: number }[]
> {
  const agentsDir = join(OPENCLAW_HOME, "agents");
  const result: { id: string; sessionCount: number; totalTokens: number; lastActivity: number }[] = [];
  try {
    const agents = await readdir(agentsDir, { withFileTypes: true });
    for (const agent of agents) {
      if (!agent.isDirectory()) continue;
      const sessionsPath = join(agentsDir, agent.name, "sessions", "sessions.json");
      try {
        const data = JSON.parse(await readFile(sessionsPath, "utf-8")) as Record<string, Record<string, unknown>>;
        let totalTokens = 0;
        let lastActivity = 0;
        for (const s of Object.values(data)) {
          totalTokens += (s.totalTokens as number) || 0;
          const u = (s.updatedAt as number) || 0;
          if (u > lastActivity) lastActivity = u;
        }
        result.push({
          id: agent.name,
          sessionCount: Object.keys(data).length,
          totalTokens,
          lastActivity,
        });
      } catch { /* skip */ }
    }
  } catch { /* agents dir may not exist */ }
  return result;
}
