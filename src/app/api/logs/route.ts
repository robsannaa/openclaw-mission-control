import { NextRequest, NextResponse } from "next/server";
import { open, readFile, stat } from "fs/promises";
import { join } from "path";
import { getOpenClawHome } from "@/lib/paths";

const OPENCLAW_HOME = getOpenClawHome();
const LOGS_DIR = join(OPENCLAW_HOME, "logs");

type LogEntry = {
  line: number;
  time: string;
  timeMs: number; // UTC millis for correct sorting
  source: string;
  level: "info" | "warn" | "error";
  message: string;
  raw: string;
};

/**
 * GET /api/logs - Returns parsed log entries from gateway logs.
 *
 * Query params:
 *   type=gateway|error|all (default: all)
 *   limit=N (default: 200, max: 1000)
 *   search=text (filter by text content)
 *   source=ws|cron|telegram|... (filter by source tag)
 *   level=info|warn|error (filter by level)
 */
export const dynamic = "force-dynamic";

// Full structured line: timestamp [source] message
const STRUCTURED_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))\s+\[([^\]]+)\]\s+(.*)/;

// Timestamp-only line (no [source]): timestamp message
const TS_ONLY_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))\s+(.*)/;

/** Parse an ISO timestamp to UTC millis. Returns 0 on failure. */
function tsToMs(ts: string): number {
  if (!ts) return 0;
  try {
    const ms = new Date(ts).getTime();
    return isNaN(ms) ? 0 : ms;
  } catch {
    return 0;
  }
}

/**
 * Parse raw log lines into structured entries.
 * Handles:
 *   1. Structured lines: `TIMESTAMP [SOURCE] MESSAGE`
 *   2. Timestamp-only lines: `TIMESTAMP MESSAGE` (no source tag)
 *   3. Continuation lines: no timestamp — appended to previous entry
 */
function parseLines(
  lines: string[],
  fileLevel: "info" | "error"
): LogEntry[] {
  const entries: LogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;

    // Try structured: TIMESTAMP [source] message
    const structMatch = raw.match(STRUCTURED_RE);
    if (structMatch) {
      const time = structMatch[1];
      const source = structMatch[2];
      const message = structMatch[3];
      const level = detectLevel(message, fileLevel);
      entries.push({
        line: i,
        time,
        timeMs: tsToMs(time),
        source,
        level,
        message,
        raw,
      });
      continue;
    }

    // Try timestamp-only: TIMESTAMP message (no [source] tag)
    const tsMatch = raw.match(TS_ONLY_RE);
    if (tsMatch) {
      const time = tsMatch[1];
      const message = tsMatch[2];
      const level = detectLevel(message, fileLevel);
      // Infer source: error log lines without tags are system-level;
      // gateway.log lines without tags are agent output
      const source = fileLevel === "error" ? "system" : "agent";
      entries.push({
        line: i,
        time,
        timeMs: tsToMs(time),
        source,
        level,
        message,
        raw,
      });
      continue;
    }

    // Continuation line: append to previous entry
    if (entries.length > 0) {
      const prev = entries[entries.length - 1];
      prev.message += "\n" + raw;
      prev.raw += "\n" + raw;
    }
    // else: orphan continuation before any entry — skip
  }

  return entries;
}

function detectLevel(
  message: string,
  fileLevel: "info" | "error"
): "info" | "warn" | "error" {
  if (fileLevel === "error") return "error";
  if (/\berror\b|failed|INVALID_REQUEST/i.test(message)) return "error";
  if (/\u2717|\u2718|errorCode=/.test(message)) return "error";
  if (/\bwarn\b|warning|timeout|timed out|skipped/i.test(message))
    return "warn";
  return "info";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "all";
  const limit = Math.min(
    parseInt(searchParams.get("limit") || "200", 10),
    1000
  );
  const searchFilter = searchParams.get("search")?.toLowerCase() || "";
  const sourceFilter = searchParams.get("source")?.toLowerCase() || "";
  const levelFilter = searchParams.get("level") || "";

  try {
    const files: { path: string; level: "info" | "error" }[] = [];
    if (type === "gateway" || type === "all") {
      files.push({ path: join(LOGS_DIR, "gateway.log"), level: "info" });
    }
    if (type === "error" || type === "all") {
      files.push({
        path: join(LOGS_DIR, "gateway.err.log"),
        level: "error",
      });
    }

    const fileResults = await Promise.all(
      files.map(async (file) => {
        try {
          const s = await stat(file.path);

          // Read last portion of file (max 500KB to keep response fast)
          const maxBytes = 512 * 1024;
          let content: string;
          if (s.size > maxBytes) {
            const fh = await open(file.path, "r");
            try {
              const buf = Buffer.alloc(maxBytes);
              await fh.read(buf, 0, maxBytes, s.size - maxBytes);
              content = buf.toString("utf-8");
            } finally {
              await fh.close();
            }
            // Drop first partial line
            const firstNewline = content.indexOf("\n");
            if (firstNewline !== -1) {
              content = content.slice(firstNewline + 1);
            }
          } else {
            content = await readFile(file.path, "utf-8");
          }

          const lines = content.split("\n");
          return {
            path: file.path,
            size: s.size,
            entries: parseLines(lines, file.level),
          };
        } catch {
          return {
            path: file.path,
            size: 0,
            entries: [] as LogEntry[],
          };
        }
      })
    );

    const allEntries: LogEntry[] = [];
    const fileSizes: Record<string, number> = {};
    const sourceSet = new Set<string>();
    const stats = { info: 0, warn: 0, error: 0 };
    for (const result of fileResults) {
      if (result.size > 0) {
        fileSizes[result.path] = result.size;
      }
      for (const entry of result.entries) {
        allEntries.push(entry);
        if (entry.source) sourceSet.add(entry.source);
        stats[entry.level] += 1;
      }
    }

    // Sort by UTC time descending (newest first)
    allEntries.sort((a, b) => b.timeMs - a.timeMs);

    const hasFilters = Boolean(searchFilter || sourceFilter || levelFilter);
    const filtered = hasFilters
      ? allEntries.filter((e) => {
        if (searchFilter) {
          const searchHit =
            e.message.toLowerCase().includes(searchFilter) ||
            e.source.toLowerCase().includes(searchFilter) ||
            e.raw.toLowerCase().includes(searchFilter);
          if (!searchHit) return false;
        }
        if (sourceFilter && !e.source.toLowerCase().includes(sourceFilter)) return false;
        if (levelFilter && e.level !== levelFilter) return false;
        return true;
      })
      : allEntries;

    // Collect unique sources for the filter UI
    const sources = Array.from(sourceSet).sort();

    return NextResponse.json({
      entries: filtered.slice(0, limit),
      total: filtered.length,
      sources,
      fileSizes,
      stats,
    });
  } catch (err) {
    console.error("Logs API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
