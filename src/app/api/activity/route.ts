import { NextRequest, NextResponse } from "next/server";
import { readdir, stat, open, readFile } from "fs/promises";
import { join } from "path";
import { getOpenClawHome } from "@/lib/paths";
import { fetchGatewaySessions } from "@/lib/gateway-sessions";

export const dynamic = "force-dynamic";

// ── Types ────────────────────────────────────────────────────────────────────

type ActivityEventType = "cron" | "session" | "log" | "system";
type ActivityEventStatus = "ok" | "error" | "info" | "warning";

type ActivityEvent = {
  id: string;
  type: ActivityEventType;
  timestamp: number;
  title: string;
  detail?: string;
  status?: ActivityEventStatus;
  source?: string;
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

// ── File helpers ─────────────────────────────────────────────────────────────

async function tailLines(path: string, n: number): Promise<string[]> {
  try {
    const maxBytes = 256 * 1024;
    const s = await stat(path);
    if (s.size <= 0) return [];

    let content: string;
    if (s.size > maxBytes) {
      const fh = await open(path, "r");
      try {
        const buf = Buffer.alloc(maxBytes);
        await fh.read(buf, 0, maxBytes, s.size - maxBytes);
        content = buf.toString("utf-8");
      } finally {
        await fh.close();
      }
      // Drop the partial first line that results from reading a tail chunk.
      const firstNewline = content.indexOf("\n");
      if (firstNewline !== -1) content = content.slice(firstNewline + 1);
    } else {
      content = await readFile(path, "utf-8");
    }

    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-n);
  } catch {
    return [];
  }
}

// ── Aggregation helpers ──────────────────────────────────────────────────────

async function aggregateCronEvents(): Promise<ActivityEvent[]> {
  const home = getOpenClawHome();
  const runsDir = join(home, "cron", "runs");
  const events: ActivityEvent[] = [];

  try {
    const files = await readdir(runsDir);
    const runFiles = files.filter((f) => f.endsWith(".jsonl"));

    const tails = await Promise.all(
      runFiles.map((f) => tailLines(join(runsDir, f), 20))
    );

    for (const lines of tails) {
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as CronRunEntry;

          // Require a valid numeric timestamp and a jobId to proceed.
          if (!entry.ts || typeof entry.ts !== "number" || !entry.jobId) {
            continue;
          }

          const isError =
            entry.status === "error" ||
            entry.status === "failed" ||
            Boolean(entry.error);

          const detail = entry.error || entry.summary || undefined;

          events.push({
            id: `cron-${entry.jobId}-${entry.ts}`,
            type: "cron",
            timestamp: entry.ts,
            title: `Cron: ${entry.jobId} — ${entry.action}`,
            detail,
            status: isError ? "error" : "ok",
            source: entry.jobId,
          });
        } catch {
          // Skip malformed JSONL lines.
        }
      }
    }
  } catch {
    // The runs directory may not exist yet — return an empty list.
  }

  return events;
}

async function aggregateLogEvents(): Promise<ActivityEvent[]> {
  const home = getOpenClawHome();
  const logPath = join(home, "logs", "gateway.log");
  const lines = await tailLines(logPath, 50);
  const events: ActivityEvent[] = [];

  // Only surface warn / error lines.
  const errorPattern = /\[warn\]|\[error\]|error/i;

  for (const line of lines) {
    if (!errorPattern.test(line)) continue;

    // Parse: TIMESTAMP [SOURCE] MESSAGE
    // Example: 2026-03-03T12:00:00.000Z [gateway] error: something went wrong
    const match = line.match(/^(\S+)\s+\[([^\]]+)\]\s+(.*)/);

    let rawTimestamp: string;
    let source: string;
    let message: string;

    if (match) {
      rawTimestamp = match[1];
      source = match[2];
      message = match[3];
    } else {
      // Unrecognized format — surface the whole line under an unknown source.
      rawTimestamp = new Date().toISOString();
      source = "unknown";
      message = line;
    }

    const ts = new Date(rawTimestamp).getTime();
    const timestamp = Number.isFinite(ts) && ts > 0 ? ts : Date.now();

    const isWarning = /\[warn\]/i.test(line);
    const status: ActivityEventStatus = isWarning ? "warning" : "error";

    events.push({
      id: `log-${source}-${timestamp}-${events.length}`,
      type: "log",
      timestamp,
      title: `${source}: ${message}`,
      status,
      source,
    });
  }

  return events;
}

async function aggregateSessionEvents(): Promise<ActivityEvent[]> {
  const events: ActivityEvent[] = [];

  try {
    const sessions = await fetchGatewaySessions(5000);

    for (const session of sessions) {
      const key = session.key || session.sessionId || "unknown";
      const totalTokens = session.totalTokens ?? 0;
      const model = session.model || "unknown";
      const timestamp = session.updatedAt || Date.now();

      events.push({
        id: `session-${session.sessionId || key}-${timestamp}`,
        type: "session",
        timestamp,
        title: `Session active: ${key}`,
        detail: `${totalTokens} tokens · ${model}`,
        status: "info",
        source: key,
      });
    }
  } catch {
    // Gateway may be offline — return an empty list rather than failing the
    // entire activity response.
  }

  return events;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type") as ActivityEventType | null;

    // Gather all sources in parallel.
    const [cronEvents, logEvents, sessionEvents] = await Promise.all([
      aggregateCronEvents(),
      aggregateLogEvents(),
      aggregateSessionEvents(),
    ]);

    let events: ActivityEvent[] = [
      ...cronEvents,
      ...logEvents,
      ...sessionEvents,
    ];

    // Apply optional type filter.
    if (typeFilter) {
      events = events.filter((e) => e.type === typeFilter);
    }

    // Sort newest-first and cap at 50.
    events.sort((a, b) => b.timestamp - a.timestamp);
    events = events.slice(0, 50);

    return NextResponse.json(events);
  } catch (err) {
    console.error("Activity API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
