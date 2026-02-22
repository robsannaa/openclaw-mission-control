/**
 * Google Calendar via gog CLI (https://clawhub.ai/steipete/gog).
 * Auth is done once in the terminal: gog auth add your@email.com --services calendar
 */

import { homedir } from "os";
import { getGogBin, getGogKeyringDir } from "@/lib/paths";
import { runGogCaptureBoth } from "@/lib/gog-cli";

export type GogNormalizedEvent = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  calendarName: string;
  location?: string;
  notes?: string;
};

/** Flexible shape for gog JSON (Google API–like or gog-specific). */
type GogEventItem = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string } | string;
  end?: { dateTime?: string; date?: string } | string;
  location?: string;
  description?: string;
  calendarName?: string;
};

type GogEventsOutput = {
  events?: GogEventItem[];
  items?: GogEventItem[];
};

function parseStartMs(item: GogEventItem): number {
  const s = item.start;
  if (!s) return 0;
  if (typeof s === "string") return new Date(s).getTime();
  if (s.date) return new Date(s.date).getTime();
  if (s.dateTime) return new Date(s.dateTime).getTime();
  return 0;
}

function parseEndMs(item: GogEventItem): number {
  const e = item.end;
  if (!e) return 0;
  if (typeof e === "string") return new Date(e).getTime();
  if (e.date) return new Date(e.date).getTime();
  if (e.dateTime) return new Date(e.dateTime).getTime();
  return parseStartMs(item) + 3_600_000;
}

function isAllDay(item: GogEventItem): boolean {
  const s = item.start;
  if (!s) return false;
  if (typeof s === "object" && s.date && !s.dateTime) return true;
  return false;
}

/**
 * Fetch calendar events using the gog CLI.
 * Requires: gog installed and at least one account authed for calendar
 * (e.g. gog auth add you@email.com --services calendar).
 * @param account - If set, use this gog account (overrides GOG_ACCOUNT env for this call).
 */
export type FetchCalendarResult = {
  events: GogNormalizedEvent[];
  rawStdout: string;
};

export async function fetchCalendarEventsViaGog(
  days: number,
  account?: string
): Promise<FetchCalendarResult> {
  const args = [
    "calendar",
    "events",
    "primary",
    ...(account ? ["--account", account] : []),
    "--json",
    "--no-input",
    `--days=${Math.min(Math.max(days, 1), 60)}`,
    "--max=250",
  ];
  const bin = await getGogBin();
  const command = [bin, ...args].join(" ");
  // Run gog with same env as CLI: HOME and keyring path so it finds your tokens
  const envOverrides: Record<string, string> = {
    HOME: process.env.HOME || homedir(),
    GOG_KEYRING_DIR: getGogKeyringDir(),
  };
  if (account) envOverrides.GOG_ACCOUNT = account;
  let stdout: string;
  try {
    const { stdout: out, stderr, code } = await runGogCaptureBoth(args, 15_000, {
      envOverrides,
    });
    stdout = out;
    if (code !== 0) {
      const msg = [stderr, out].filter(Boolean).join("\n").trim() || `gog exited with code ${code}`;
      const debugInfo: GogCalendarError["debugInfo"] = {
        command,
        exitCode: code,
        stderr: stderr.slice(0, 2000),
        stdout: out.slice(0, 2000),
      };
      if (
        msg.includes("missing --account") ||
        msg.includes("No auth for calendar") ||
        msg.includes("ENOENT")
      ) {
        throw new GogCalendarError(msg, "needs_auth", debugInfo);
      }
      throw new GogCalendarError(msg, "error", debugInfo);
    }
  } catch (err) {
    if (err instanceof GogCalendarError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("missing --account") ||
      msg.includes("No auth for calendar") ||
      msg.includes("ENOENT")
    ) {
      throw new GogCalendarError(msg, "needs_auth", { command, exitCode: null, stderr: "", stdout: msg });
    }
    throw new GogCalendarError(msg, "error", { command, exitCode: null, stderr: "", stdout: msg });
  }

  const trimmed = stdout.trim();
  if (!trimmed) return { events: [], rawStdout: stdout };

  let data: GogEventsOutput;
  try {
    data = JSON.parse(trimmed) as GogEventsOutput;
  } catch {
    throw new GogCalendarError("Invalid JSON from gog", "error", {
      command,
      exitCode: 0,
      stderr: "",
      stdout: trimmed.slice(0, 500),
    });
  }

  const items = data.events ?? data.items ?? [];
  const nowMs = Date.now();
  const startOfWindowMs = nowMs - 24 * 60 * 60 * 1000;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  const cutoffMs = endDate.getTime();
  const out: GogNormalizedEvent[] = [];

  for (const item of items) {
    const startMs = parseStartMs(item);
    const endMs = parseEndMs(item);
    if (isNaN(startMs)) continue;
    const effectiveEndMs = isNaN(endMs) || endMs === 0 ? startMs + 3_600_000 : endMs;
    if (startMs > cutoffMs || effectiveEndMs < startOfWindowMs) continue;
    out.push({
      id: item.id ?? crypto.randomUUID(),
      title: item.summary ?? "(No title)",
      startMs,
      endMs: effectiveEndMs,
      allDay: isAllDay(item),
      calendarName: item.calendarName ?? "Google Calendar",
      location: item.location || undefined,
      notes: item.description || undefined,
    });
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return { events: out, rawStdout: stdout };
}

export type GogCalendarDebugInfo = {
  command: string;
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

export class GogCalendarError extends Error {
  constructor(
    message: string,
    public readonly code: "needs_auth" | "error",
    public readonly debugInfo?: GogCalendarDebugInfo
  ) {
    super(message);
    this.name = "GogCalendarError";
  }
}

/** Check if gog is available (installed and runnable). */
export async function isGogAvailable(): Promise<boolean> {
  try {
    await getGogBin();
    return true;
  } catch {
    return false;
  }
}
