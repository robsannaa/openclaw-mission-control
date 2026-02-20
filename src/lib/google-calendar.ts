/**
 * Google Calendar via OAuth 2.0 + Calendar API.
 * No gog dependency. User connects once in the UI; we store refresh token and fetch events.
 */

import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { getOpenClawHome } from "@/lib/paths";

const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

function getTokenPath(): string {
  return join(getOpenClawHome(), "calendar-oauth.json");
}

export type OAuthTokens = {
  refresh_token: string;
  access_token?: string;
  expiry_ms?: number;
};

export async function getStoredTokens(): Promise<OAuthTokens | null> {
  try {
    const raw = await readFile(getTokenPath(), "utf-8");
    const data = JSON.parse(raw) as OAuthTokens;
    return data?.refresh_token ? data : null;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: OAuthTokens): Promise<void> {
  const dir = getOpenClawHome();
  await mkdir(dir, { recursive: true });
  await writeFile(getTokenPath(), JSON.stringify(tokens, null, 2), "utf-8");
}

function getClientId(): string | null {
  return process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() || null;
}

function getClientSecret(): string | null {
  return process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() || null;
}

/** Build redirect_uri for OAuth callback. Call from a request so we know the origin. */
export function getRedirectUri(requestOrigin?: string): string {
  const base = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() || requestOrigin || "http://localhost:3000";
  return base.replace(/\/$/, "") + "/api/calendar/oauth/callback";
}

/** URL to send the user to for Google sign-in. */
export function getAuthUrl(redirectUri: string): string | null {
  const clientId = getClientId();
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchange authorization code for tokens. */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET must be set");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    refresh_token?: string;
    access_token: string;
    expires_in: number;
  };
  const refresh = data.refresh_token;
  if (!refresh) throw new Error("No refresh_token in response");
  const expiry = data.expires_in
    ? Date.now() + data.expires_in * 1000
    : undefined;
  return {
    refresh_token: refresh,
    access_token: data.access_token,
    expiry_ms: expiry,
  };
}

/** Get a valid access token (use cached or refresh). */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await getStoredTokens();
  if (!tokens) return null;
  const now = Date.now();
  if (tokens.access_token && tokens.expiry_ms && tokens.expiry_ms > now + 60_000) {
    return tokens.access_token;
  }
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret) return null;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiry = data.expires_in ? Date.now() + data.expires_in * 1000 : undefined;
  await saveTokens({
    ...tokens,
    access_token: data.access_token,
    expiry_ms: expiry,
  });
  return data.access_token;
}

export type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
};

export type NormalizedEvent = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  calendarName: string;
  location?: string;
  notes?: string;
};

/** Fetch events from primary calendar for the next N days. */
export async function fetchCalendarEvents(
  accessToken: string,
  days: number
): Promise<NormalizedEvent[]> {
  const now = new Date();
  const timeMin = now.toISOString();
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  const timeMax = end.toISOString();
  const url = `${CALENDAR_API}/calendars/primary/events?` + new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  }).toString();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar API error: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { items?: GoogleCalendarEvent[] };
  const items = data.items || [];
  const nowMs = now.getTime();
  const cutoffMs = end.getTime();
  const out: NormalizedEvent[] = [];
  for (const item of items) {
    const allDay = Boolean(item.start?.date && !item.start?.dateTime);
    const startMs = allDay
      ? new Date(item.start!.date!).getTime()
      : new Date(item.start?.dateTime ?? 0).getTime();
    const endMs = allDay
      ? new Date(item.end?.date ?? item.start!.date!).getTime()
      : new Date(item.end?.dateTime ?? 0).getTime();
    if (isNaN(startMs) || startMs < nowMs || startMs > cutoffMs) continue;
    out.push({
      id: item.id ?? crypto.randomUUID(),
      title: item.summary ?? "(No title)",
      startMs,
      endMs: isNaN(endMs) || endMs === 0 ? startMs + 3_600_000 : endMs,
      allDay,
      calendarName: "Google Calendar",
      location: item.location || undefined,
      notes: item.description || undefined,
    });
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

/** True if OAuth app is configured (client id + secret). */
export function isOAuthConfigured(): boolean {
  return Boolean(getClientId() && getClientSecret());
}
