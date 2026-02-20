import { NextRequest, NextResponse } from "next/server";
import {
  getAccessToken,
  fetchCalendarEvents,
  isOAuthConfigured,
  getAuthUrl,
  getRedirectUri,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 90_000;

let calendarCache: { key: number; data: CalendarResponse; expiresAt: number } | null = null;

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
  /** When true, UI should show "Connect Google Calendar" linking to authUrl */
  needsAuth?: boolean;
  /** URL to start OAuth (only when needsAuth and OAuth is configured) */
  authUrl?: string;
};

function toCalendarEvent(e: { id: string; title: string; startMs: number; endMs: number; allDay: boolean; calendarName: string; location?: string; notes?: string }): CalendarEvent {
  return { ...e, source: "google" };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "14", 10), 1), 60);
  const skipCache = searchParams.get("refresh") === "1";

  const now = Date.now();
  if (!skipCache && calendarCache && calendarCache.key === days && calendarCache.expiresAt > now) {
    return NextResponse.json(calendarCache.data);
  }

  const result: CalendarResponse = {
    events: [],
    sources: { google: false },
    errors: {},
  };

  const origin =
    request.headers.get("origin") ||
    (typeof request.url === "string" ? new URL(request.url).origin : "") ||
    "";
  const redirectUri = getRedirectUri(origin);

  if (!isOAuthConfigured()) {
    result.errors.google = "Google Calendar OAuth not configured. Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET in .env.";
    return NextResponse.json(result);
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    result.needsAuth = true;
    result.authUrl = getAuthUrl(redirectUri) ?? undefined;
    calendarCache = { key: days, data: result, expiresAt: now + CACHE_TTL_MS };
    return NextResponse.json(result);
  }

  try {
    const events = await fetchCalendarEvents(accessToken, days);
    result.events = events.map(toCalendarEvent);
    result.sources.google = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.google = msg;
    if (msg.includes("401") || msg.includes("invalid_grant") || msg.includes("Token has been expired")) {
      result.needsAuth = true;
      result.authUrl = getAuthUrl(redirectUri) ?? undefined;
    }
  }

  calendarCache = { key: days, data: result, expiresAt: now + CACHE_TTL_MS };
  return NextResponse.json(result);
}
