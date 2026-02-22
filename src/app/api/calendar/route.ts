import { NextRequest, NextResponse } from "next/server";
import {
  fetchCalendarEventsViaGog,
  GogCalendarError,
} from "@/lib/gog-calendar";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 90_000;

let calendarCache: {
  key: string;
  data: CalendarResponse;
  expiresAt: number;
} | null = null;

export type CalendarEvent = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  calendarName: string;
  source: "google";
  location?: string;
  notes?: string;
};

export type CalendarResponse = {
  events: CalendarEvent[];
  sources: { google: boolean };
  errors: { google?: string };
  /** Verbose debug info when gog command fails (command, exitCode, stderr, stdout). */
  errorDebug?: { command: string; exitCode: number | null; stderr: string; stdout: string };
  /** Raw stdout from the last gog calendar events command (for debugging). */
  rawOutput?: string;
  /** When true, UI should show gog setup instructions (run gog auth add ...). */
  needsAuth?: boolean;
  /** When true, gog needs GOG_KEYRING_PASSWORD in env to read tokens (no TTY). */
  needsKeyringPassphrase?: boolean;
};

function toCalendarEvent(
  e: {
    id: string;
    title: string;
    startMs: number;
    endMs: number;
    allDay: boolean;
    calendarName: string;
    location?: string;
    notes?: string;
  }
): CalendarEvent {
  return { ...e, source: "google" };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(
    Math.max(parseInt(searchParams.get("days") || "14", 10), 1),
    60
  );
  const account = searchParams.get("account")?.trim() || undefined;
  const skipCache = searchParams.get("refresh") === "1";
  const cacheKey = `${days}:${account ?? ""}`;

  const now = Date.now();
  if (
    !skipCache &&
    calendarCache &&
    calendarCache.key === cacheKey &&
    calendarCache.expiresAt > now
  ) {
    return NextResponse.json(calendarCache.data);
  }

  const result: CalendarResponse = {
    events: [],
    sources: { google: false },
    errors: {},
  };

  try {
    const { events, rawStdout } = await fetchCalendarEventsViaGog(days, account);
    result.events = events.map(toCalendarEvent);
    result.sources.google = true;
    result.rawOutput = rawStdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.google = msg;
    if (err instanceof GogCalendarError) {
      if (err.code === "needs_auth") result.needsAuth = true;
      if (err.debugInfo) {
        result.errorDebug = err.debugInfo;
        result.rawOutput = err.debugInfo.stdout || err.debugInfo.stderr;
      }
    }
    if (
      msg.includes("GOG_KEYRING_PASSWORD") ||
      msg.includes("no TTY available for keyring")
    ) {
      result.needsKeyringPassphrase = true;
    }
  }

  // Only cache successful responses so Refresh after fixing auth re-runs gog
  if (!result.errors.google) {
    calendarCache = { key: cacheKey, data: result, expiresAt: now + CACHE_TTL_MS };
  }
  return NextResponse.json(result);
}
