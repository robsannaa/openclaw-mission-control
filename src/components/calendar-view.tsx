"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarDays, MapPin, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import type { CalendarEvent, CalendarResponse } from "@/app/api/calendar/route";

// --- Helpers ---

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function groupByDay(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = new Date(event.startMs).toLocaleDateString("en-CA");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(event);
  }
  return Array.from(map.entries());
}

function dayLabel(dateKey: string): string {
  const d = new Date(dateKey + "T12:00:00");
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const todayKey = today.toLocaleDateString("en-CA");
  const tomorrowKey = tomorrow.toLocaleDateString("en-CA");
  if (dateKey === todayKey) return "Today";
  if (dateKey === tomorrowKey) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function dayFull(dateKey: string): string {
  const d = new Date(dateKey + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// --- Sub-components ---

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2.5 text-xs">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      <div>
        <span className="font-medium text-amber-300/90">Google Calendar</span>
        <p className="mt-0.5 font-mono text-muted-foreground/70">{message.slice(0, 300)}</p>
      </div>
    </div>
  );
}

function ConnectPanel({ authUrl }: { authUrl: string }) {
  return (
    <div className="mb-6 rounded-xl border border-foreground/10 bg-muted/30 p-6 text-center">
      <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
      <p className="mb-4 text-sm text-foreground/80">
        Connect your Google account to see calendar events here.
      </p>
      <a
        href={authUrl}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        Connect Google Calendar
      </a>
    </div>
  );
}

function EventCard({ event }: { event: CalendarEvent }) {
  const timeLabel = event.allDay
    ? "All day"
    : fmtTime(event.startMs) + (event.endMs ? " – " + fmtTime(event.endMs) : "");

  return (
    <div className="rounded-lg border border-foreground/5 bg-muted/40 px-3 py-2.5 text-xs transition-colors hover:bg-muted/60">
      <div className="flex items-start gap-2.5">
        <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span className="min-w-0 truncate font-medium text-foreground/90">{event.title}</span>
            <span className="ml-auto shrink-0 whitespace-nowrap text-muted-foreground/60">
              {timeLabel}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-muted/80 px-1.5 py-0.5 text-muted-foreground/70">
              {event.calendarName}
            </span>
            {event.location && (
              <span className="flex items-center gap-1 text-muted-foreground/60">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{event.location}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayGroup({ dateKey, events }: { dateKey: string; events: CalendarEvent[] }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-foreground/70">{dayLabel(dateKey)}</span>
        <span className="text-xs text-muted-foreground/50">{dayFull(dateKey)}</span>
        <div className="flex-1 border-t border-border/40" />
        <span className="text-xs text-muted-foreground/40">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-1.5">
        {events.map((e) => (
          <EventCard key={`${e.source}:${e.id}`} event={e} />
        ))}
      </div>
    </div>
  );
}

// --- Main view ---

export function CalendarView() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(14);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true);
      try {
        const q = `days=${days}${isManual ? "&refresh=1" : ""}`;
        const res = await fetch(`/api/calendar?${q}`, { cache: "no-store" });
        const json = (await res.json()) as CalendarResponse;
        setData(json);
      } catch (err) {
        console.error("Calendar fetch error:", err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [days]
  );

  useEffect(() => {
    setLoading(true);
    void load();
    intervalRef.current = setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const grouped = data ? groupByDay(data.events) : [];
  const needsAuth = data?.needsAuth && data?.authUrl;

  return (
    <SectionLayout>
      <SectionHeader
        title="Calendar"
        description={`Upcoming events · next ${days} days`}
        actions={
          <div className="flex items-center gap-2">
            {data && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    data.sources.google ? "bg-emerald-400" : "bg-red-500/70"
                  )}
                />
                Google
              </div>
            )}
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-md border border-foreground/10 bg-muted/60 px-2 py-1.5 text-xs text-foreground/70 outline-none focus:border-foreground/20"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-md border border-foreground/10 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              Refresh
            </button>
          </div>
        }
      />

      <SectionBody>
        {loading ? (
          <LoadingState label="Loading calendar…" />
        ) : (
          <>
            {data?.errors.google && !needsAuth && (
              <>
                <ErrorBanner message={data.errors.google} />
                {data.errors.google.includes("not configured") && (
                  <div className="mb-4 rounded-lg border border-foreground/10 bg-muted/30 p-3 text-xs text-muted-foreground/80">
                    <p className="font-medium text-foreground/90 mb-1">Setup</p>
                    <p>Add <code className="rounded bg-muted px-1">GOOGLE_CALENDAR_CLIENT_ID</code> and <code className="rounded bg-muted px-1">GOOGLE_CALENDAR_CLIENT_SECRET</code> to <code className="rounded bg-muted px-1">.env</code>. Create OAuth 2.0 credentials in Google Cloud Console → APIs & Services → Credentials (Desktop app or Web application with redirect URI <code className="rounded bg-muted px-1">http://localhost:3000/api/calendar/oauth/callback</code>). Enable the Google Calendar API for the project.</p>
                    <p className="mt-2">
                      <a href="/api/calendar/debug" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground/70">Check configuration</a>
                    </p>
                  </div>
                )}
              </>
            )}

            {needsAuth && data.authUrl && <ConnectPanel authUrl={data.authUrl} />}

            {data?.sources.google && grouped.length > 0 && (
              <div className="mb-4 flex items-center gap-4 text-xs text-muted-foreground/50">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                Google Calendar
              </div>
            )}

            {grouped.map(([dateKey, events]) => (
              <DayGroup key={dateKey} dateKey={dateKey} events={events} />
            ))}

            {grouped.length === 0 && !loading && !needsAuth && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground/50">
                <CalendarDays className="h-8 w-8 opacity-40" />
                <p>No events in the next {days} days</p>
              </div>
            )}
          </>
        )}
      </SectionBody>
    </SectionLayout>
  );
}
