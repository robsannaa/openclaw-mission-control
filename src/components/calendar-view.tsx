"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, MapPin, RefreshCw, CheckCircle, XCircle } from "lucide-react";
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

function ErrorBanner({
  message,
  errorDebug,
}: {
  message: string;
  errorDebug?: { command: string; exitCode: number | null; stderr: string; stdout: string };
}) {
  const [showDebug, setShowDebug] = useState(false);
  const [copied, setCopied] = useState(false);
  const debugText = errorDebug
    ? [
        `Command: ${errorDebug.command}`,
        `Exit code: ${errorDebug.exitCode ?? "—"}`,
        "Stderr:",
        errorDebug.stderr || "(empty)",
        "Stdout:",
        errorDebug.stdout || "(empty)",
      ].join("\n")
    : "";

  const copyDebug = () => {
    if (!debugText) return;
    void navigator.clipboard.writeText(`Error: ${message}\n\n${debugText}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mb-3 rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2.5 text-xs">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <span className="font-medium text-amber-300/90">Google Calendar</span>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground/80">
            {message}
          </pre>
          {errorDebug && (
            <>
              <button
                type="button"
                onClick={() => setShowDebug((v) => !v)}
                className="mt-2 text-amber-400/90 underline hover:text-amber-300"
              >
                {showDebug ? "Hide" : "Show"} debug details
              </button>
              {showDebug && (
                <div className="mt-2 space-y-1 rounded border border-amber-500/20 bg-black/20 p-2 font-mono text-[11px]">
                  <p className="text-foreground/70">Command: {errorDebug.command}</p>
                  <p className="text-foreground/70">Exit code: {String(errorDebug.exitCode ?? "—")}</p>
                  {errorDebug.stderr ? (
                    <div>
                      <span className="text-amber-400/80">stderr:</span>
                      <pre className="mt-0.5 overflow-auto whitespace-pre-wrap break-all text-muted-foreground/80">
                        {errorDebug.stderr}
                      </pre>
                    </div>
                  ) : null}
                  {errorDebug.stdout ? (
                    <div>
                      <span className="text-amber-400/80">stdout:</span>
                      <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-all text-muted-foreground/80">
                        {errorDebug.stdout}
                      </pre>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={copyDebug}
                    className="mt-1 rounded border border-foreground/20 px-2 py-1 text-muted-foreground hover:bg-foreground/10"
                  >
                    {copied ? "Copied" : "Copy full error"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KeyringPassphrasePanel() {
  return (
    <div className="mb-6 rounded-xl border border-violet-500/20 bg-violet-500/5 p-6">
      <p className="mb-3 text-sm font-medium text-foreground/90">
        Keyring passphrase required
      </p>
      <div className="mb-4 space-y-2 text-sm text-foreground/80">
        <p>
          gog stores your Google tokens in an <strong>encrypted keyring</strong> (keychain on macOS, file-based on Linux and Windows). When you run gog in a terminal, it can prompt for the passphrase. When this app runs gog there is no terminal, so gog cannot ask for it.
        </p>
        <p>
          Set the same passphrase you use for <code className="rounded bg-muted px-1">gog auth list</code> in your environment. This works the same on <strong>macOS, Linux (e.g. VPS), and Windows</strong>:
        </p>
      </div>
      <div className="rounded-lg bg-black/20 p-3 font-mono text-xs text-foreground/90">
        GOG_KEYRING_PASSWORD=your_passphrase
      </div>
      <p className="mt-3 text-sm text-muted-foreground/70">
        Add that line to your project <code className="rounded bg-muted px-1">.env</code> (or export it in the shell that starts the app), then restart the app and click Refresh.
      </p>
      <p className="mt-2 text-xs text-muted-foreground/60">
        If you disabled keychain (e.g. gog configured to not use it), you may not need a passphrase—calendar should work without it.
      </p>
    </div>
  );
}

const GOG_ACCOUNT_STORAGE_KEY = "calendar_gog_account";

function GogSetupPanel({
  isMultipleAccounts,
  onAccountChosen,
  selectedAccount,
  googleError,
  errorDebug,
}: {
  isMultipleAccounts?: boolean;
  onAccountChosen: (account: string) => void;
  selectedAccount?: string;
  googleError?: string;
  errorDebug?: { command: string; exitCode: number | null; stderr: string; stdout: string };
}) {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [showGogOutput, setShowGogOutput] = useState(false);

  useEffect(() => {
    if (!isMultipleAccounts) return;
    let cancelled = false;
    queueMicrotask(() => {
      setAccountsLoading(true);
      fetch("/api/calendar/accounts", { cache: "no-store" })
        .then((r) => r.json())
        .then((body: { accounts?: string[] }) => {
          if (cancelled) return;
          const list = body.accounts ?? [];
          setAccounts(list);
          if (list.length > 0) setSelected(list[0]);
        })
        .finally(() => {
          if (!cancelled) setAccountsLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [isMultipleAccounts]);

  const handleUseAccount = () => {
    const account = accounts.length > 0 ? selected : manualEmail.trim();
    if (!account) return;
    try {
      localStorage.setItem(GOG_ACCOUNT_STORAGE_KEY, account);
    } catch {
      /* ignore */
    }
    onAccountChosen(account);
  };

  const needsCalendarAuth =
    googleError?.includes("No auth for calendar") && selectedAccount;
  const authEmail = selectedAccount ?? "you@email.com";

  if (!isMultipleAccounts) {
    return (
      <div className="mb-6 rounded-xl border border-foreground/10 bg-muted/30 p-6">
        <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
        {needsCalendarAuth ? (
          <>
            <p className="mb-3 text-sm font-medium text-amber-200/90 text-center">
              This account isn’t authorized for calendar
            </p>
            <p className="mb-3 text-sm text-foreground/80 text-center">
              Run this in your terminal (browser will open to sign in):
            </p>
            <p className="mb-3 text-center text-xs text-muted-foreground/80">
              Already added calendar for this account? Click <strong>Refresh</strong> above to try again.
            </p>
          </>
        ) : (
          <p className="mb-3 text-sm text-foreground/80 text-center">
            Calendar uses <strong>gog</strong> (Google CLI). Authenticate once in your terminal:
          </p>
        )}
        <div className="mx-auto max-w-md space-y-2 rounded-lg bg-black/20 p-4 font-mono text-xs">
          <p className="text-muted-foreground/80"># Add calendar access for this account</p>
          <p className="text-foreground/90">gog auth add {authEmail} --services calendar</p>
        </div>
        {errorDebug && (
          <div className="mx-auto mt-4 max-w-md">
            <button
              type="button"
              onClick={() => setShowGogOutput((v) => !v)}
              className="text-xs text-muted-foreground underline hover:text-foreground/80"
            >
              {showGogOutput ? "Hide" : "Show"} what gog returned (stderr/stdout)
            </button>
            {showGogOutput && (
              <div className="mt-2 rounded-lg border border-foreground/10 bg-black/20 p-3 font-mono text-[11px]">
                <p className="text-muted-foreground/70">Command: {errorDebug.command}</p>
                <p className="text-muted-foreground/70">Exit code: {String(errorDebug.exitCode ?? "—")}</p>
                {errorDebug.stderr ? (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-amber-200/90">
                    {errorDebug.stderr}
                  </pre>
                ) : null}
                {errorDebug.stdout ? (
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-muted-foreground/80">
                    {errorDebug.stdout}
                  </pre>
                ) : null}
              </div>
            )}
          </div>
        )}
        <div className="mx-auto mt-4 max-w-md rounded-lg border border-foreground/10 bg-muted/20 p-3 text-xs text-muted-foreground/80">
          <p className="font-medium text-foreground/80 mb-1">Keyring & env (macOS, Linux, Windows)</p>
          <p>
            gog stores tokens in an encrypted keyring. When this app runs gog there’s no terminal to type the passphrase, so you may need <code className="rounded bg-muted px-1">GOG_KEYRING_PASSWORD=your_passphrase</code> in <code className="rounded bg-muted px-1">.env</code> (same passphrase as <code className="rounded bg-muted px-1">gog auth list</code>). If you disabled keychain, you can often skip this—calendar works without it.
          </p>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground/70">
          <a href="https://clawhub.ai/steipete/gog" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground/80">gog</a>
          {" · "}
          <a href="/api/calendar/debug" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground/80">Check configuration</a>
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-foreground/10 bg-muted/30 p-6">
      <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
      <p className="mb-4 text-sm font-medium text-foreground/90 text-center">
        You have more than one gog account. Choose which to use for calendar:
      </p>
      {accountsLoading ? (
        <p className="text-center text-xs text-muted-foreground/60">Loading accounts…</p>
      ) : accounts.length > 0 ? (
        <div className="mx-auto max-w-md space-y-3">
          <p className="text-xs text-muted-foreground/70 text-center">
            Pick the account to use for calendar:
          </p>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full rounded-lg border border-foreground/15 bg-muted/50 px-3 py-2 text-sm text-foreground/90 outline-none focus:border-foreground/30"
          >
            {accounts.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleUseAccount}
            className="w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            Use this account
          </button>
        </div>
      ) : (
        <div className="mx-auto max-w-md space-y-3">
          <p className="text-xs text-muted-foreground/70 text-center">
            No gog accounts found. Add one in terminal: <code className="rounded bg-muted px-1">gog auth add you@email.com --services calendar</code>. Or enter the email if you already added it:
          </p>
          <input
            type="email"
            value={manualEmail}
            onChange={(e) => setManualEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-foreground/15 bg-muted/50 px-3 py-2 text-sm text-foreground/90 placeholder:text-muted-foreground/50 outline-none focus:border-foreground/30"
          />
          <button
            type="button"
            onClick={handleUseAccount}
            disabled={!manualEmail.trim()}
            className="w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50 disabled:pointer-events-none"
          >
            Use this account
          </button>
        </div>
      )}
      <p className="mt-4 text-center text-xs text-muted-foreground/70">
        <a href="/api/calendar/debug" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground/80">Check configuration</a>
      </p>
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
  const isToday = dateKey === new Date().toLocaleDateString("en-CA");
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div
        className={cn(
          "flex items-center gap-4 border-b border-border/50 px-4 py-3",
          isToday ? "bg-violet-500/10 border-violet-500/20" : "bg-muted/20"
        )}
      >
        <span
          className={cn(
            "text-2xl font-bold tabular-nums text-foreground",
            isToday && "text-violet-600 dark:text-violet-400"
          )}
        >
          {new Date(dateKey + "T12:00:00").getDate()}
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">{dayLabel(dateKey)}</p>
          <p className="text-xs text-muted-foreground">{dayFull(dateKey)}</p>
        </div>
        <div className="ml-auto rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </div>
      </div>
      <div className="divide-y divide-border/40">
        {events.map((e) => (
          <div key={`${e.source}:${e.id}`} className="px-4 py-2">
            <EventCard event={e} />
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Month grid (premium calendar UI) ---

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getCalendarGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDay = first.getDay();
  const daysInMonth = last.getDate();
  const weeks: (Date | null)[][] = [];
  let week: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) week.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(new Date(year, month, d));
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function MonthGridView({
  events,
  year,
  month,
}: {
  events: CalendarEvent[];
  year: number;
  month: number;
}) {
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = new Date(e.startMs).toLocaleDateString("en-CA");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.startMs - b.startMs);
    return map;
  }, [events]);

  const grid = useMemo(() => getCalendarGrid(year, month), [year, month]);
  const todayKey = new Date().toLocaleDateString("en-CA");

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-lg shadow-black/5 dark:shadow-none dark:border-white/10">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30">
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={label}
            className={cn(
              "py-3 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground",
              (i === 0 || i === 6) && "text-muted-foreground/70"
            )}
          >
            {label.slice(0, 3)}
          </div>
        ))}
      </div>
      {/* Weeks */}
      {grid.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-border/40 last:border-b-0">
          {week.map((date, di) => {
            const dateKey = date ? date.toLocaleDateString("en-CA") : "";
            const dayEvents = dateKey ? eventsByDay.get(dateKey) ?? [] : [];
            const isToday = dateKey === todayKey;
            const isCurrentMonth = date !== null;
            const isWeekend = date !== null && (date.getDay() === 0 || date.getDay() === 6);
            return (
              <div
                key={di}
                className={cn(
                  "min-h-[120px] border-r border-border/40 last:border-r-0 p-2 transition-colors",
                  isCurrentMonth
                    ? "bg-card hover:bg-muted/20"
                    : "bg-muted/10",
                  isWeekend && isCurrentMonth && "bg-muted/5"
                )}
              >
                {date && (
                  <>
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors",
                          isToday
                            ? "bg-violet-500 text-white shadow-md shadow-violet-500/30 ring-2 ring-violet-400/50"
                            : "text-foreground/90"
                        )}
                      >
                        {date.getDate()}
                      </span>
                      {dayEvents.length > 0 && (
                        <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                          {dayEvents.length}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {dayEvents.slice(0, 4).map((e) => (
                        <div
                          key={e.id}
                          className="group rounded-lg border-l-2 border-violet-400 bg-violet-500/8 px-2 py-1.5 text-xs transition-colors hover:bg-violet-500/15 hover:border-violet-500"
                          title={e.title + (e.allDay ? " (all day)" : ` ${fmtTime(e.startMs)}`)}
                        >
                          <span className="block truncate font-medium text-foreground/95 group-hover:text-foreground">
                            {e.title}
                          </span>
                          {!e.allDay && (
                            <span className="text-[10px] text-muted-foreground">
                              {fmtTime(e.startMs)}
                            </span>
                          )}
                        </div>
                      ))}
                      {dayEvents.length > 4 && (
                        <button
                          type="button"
                          className="w-full rounded-md py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        >
                          +{dayEvents.length - 4} more
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// --- Week view (one week, prev/next) ---

function getWeekStart(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

function getWeekDates(weekStart: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    out.push(d);
  }
  return out;
}

function WeekGridView({
  events,
  weekStart,
}: {
  events: CalendarEvent[];
  weekStart: Date;
}) {
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = new Date(e.startMs).toLocaleDateString("en-CA");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.startMs - b.startMs);
    return map;
  }, [events]);
  const todayKey = new Date().toLocaleDateString("en-CA");

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-lg shadow-black/5 dark:shadow-none dark:border-white/10">
      <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30">
        {weekDates.map((d) => {
          const dateKey = d.toLocaleDateString("en-CA");
          const isToday = dateKey === todayKey;
          return (
            <div
              key={dateKey}
              className={cn(
                "border-r border-border/40 py-3 text-center last:border-r-0",
                isToday && "bg-violet-500/10"
              )}
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {d.toLocaleDateString("en-US", { weekday: "short" })}
              </p>
              <span
                className={cn(
                  "mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                  isToday
                    ? "bg-violet-500 text-white shadow-md shadow-violet-500/30"
                    : "text-foreground/90"
                )}
              >
                {d.getDate()}
              </span>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {d.toLocaleDateString("en-US", { month: "short" })}
              </p>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-7">
        {weekDates.map((d) => {
          const dateKey = d.toLocaleDateString("en-CA");
          const dayEvents = eventsByDay.get(dateKey) ?? [];
          const isToday = dateKey === todayKey;
          return (
            <div
              key={dateKey}
              className={cn(
                "min-h-[140px] border-r border-border/40 p-2 last:border-r-0",
                isToday && "bg-violet-500/5"
              )}
            >
              <div className="space-y-1.5">
                {dayEvents.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-muted-foreground/50">No events</p>
                ) : (
                  dayEvents.map((e) => (
                    <div
                      key={e.id}
                      className="group rounded-lg border-l-2 border-violet-400 bg-violet-500/8 px-2 py-1.5 text-xs transition-colors hover:bg-violet-500/15"
                      title={e.title + (e.allDay ? " (all day)" : ` ${fmtTime(e.startMs)}`)}
                    >
                      <span className="block truncate font-medium text-foreground/95">{e.title}</span>
                      {!e.allDay && (
                        <span className="text-[10px] text-muted-foreground">{fmtTime(e.startMs)}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Day view (single day, prev/next) ---

function DaySingleView({ events, dateKey }: { events: CalendarEvent[]; dateKey: string }) {
  return <DayGroup dateKey={dateKey} events={events} />;
}

// --- Main view ---

function getStoredGogAccount(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(GOG_ACCOUNT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function CalendarView() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(14);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [viewMode, setViewMode] = useState<"month" | "week" | "day" | "list">("month");
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [viewDate, setViewDate] = useState(() => new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [flashMessage, setFlashMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const calendarConnected = searchParams.get("calendar_connected");
  const calendarError = searchParams.get("calendar_error");

  useEffect(() => {
    setSelectedAccount(getStoredGogAccount());
  }, []);

  useEffect(() => {
    if (calendarConnected) {
      setFlashMessage({ type: "success", text: "Google Calendar connected. Refreshing…" });
      const params = new URLSearchParams(searchParams.toString());
      params.delete("calendar_connected");
      const qs = params.toString();
      const path = window.location.pathname || "/";
      window.history.replaceState(null, "", qs ? `${path}?${qs}` : path);
    }
    if (calendarError) {
      setFlashMessage({ type: "error", text: decodeURIComponent(calendarError) });
      const params = new URLSearchParams(searchParams.toString());
      params.delete("calendar_error");
      const qs = params.toString();
      const path = window.location.pathname || "/";
      window.history.replaceState(null, "", qs ? `${path}?${qs}` : path);
    }
  }, [calendarConnected, calendarError, searchParams]);

  useEffect(() => {
    if (!flashMessage) return;
    const t = setTimeout(() => setFlashMessage(null), 8000);
    return () => clearTimeout(t);
  }, [flashMessage]);

  const load = useCallback(
    async (isManual = false, account?: string) => {
      if (isManual) setRefreshing(true);
      const acc = account ?? selectedAccount;
      try {
        const params = new URLSearchParams();
        params.set("days", String(days));
        if (isManual) params.set("refresh", "1");
        if (acc) params.set("account", acc);
        const res = await fetch(`/api/calendar?${params.toString()}`, { cache: "no-store" });
        const json = (await res.json()) as CalendarResponse;
        setData(json);
      } catch (err) {
        console.error("Calendar fetch error:", err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [days, selectedAccount]
  );

  const handleAccountChosen = useCallback(
    (account: string) => {
      setSelectedAccount(account);
      setShowAccountPicker(false);
      void load(true, account);
    },
    [load]
  );

  useEffect(() => {
    setLoading(true);
    void load();
    intervalRef.current = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, 5 * 60 * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const grouped = data ? groupByDay(data.events) : [];
  const needsAuth = data?.needsAuth;
  const needsKeyringPassphrase = data?.needsKeyringPassphrase;

  const weekStart = useMemo(() => getWeekStart(viewDate), [viewDate]);
  const weekEnd = useMemo(() => {
    const e = new Date(weekStart);
    e.setDate(e.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
  }, [weekStart]);
  const viewDateKey = viewDate.toLocaleDateString("en-CA");
  const eventsForWeek = useMemo(() => {
    if (!data?.events) return [];
    const startMs = weekStart.getTime();
    const endMs = weekEnd.getTime();
    return (data.events ?? []).filter((e) => e.startMs >= startMs && e.startMs <= endMs);
  }, [data?.events, weekStart, weekEnd]);
  const eventsForDay = useMemo(() => {
    if (!data?.events) return [];
    const startOfDay = new Date(viewDateKey + "T00:00:00").getTime();
    const endOfDay = new Date(viewDateKey + "T23:59:59.999").getTime();
    return (data.events ?? []).filter((e) => e.startMs >= startOfDay && e.startMs <= endOfDay);
  }, [data?.events, viewDateKey]);

  return (
    <SectionLayout>
      <SectionHeader
        title="Calendar"
        description={`Upcoming events · next ${days} days`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAccountPicker((v) => !v)}
              className="rounded-md border border-foreground/10 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
            >
              {selectedAccount ? `Account: ${selectedAccount.replace(/(.{2}).*(@.*)/, "$1…$2")}` : "Choose account"}
            </button>
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
            <div className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setViewMode("month")}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3",
                  viewMode === "month"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Month
              </button>
              <button
                type="button"
                onClick={() => setViewMode("week")}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3",
                  viewMode === "week"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Week
              </button>
              <button
                type="button"
                onClick={() => setViewMode("day")}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3",
                  viewMode === "day"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Day
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3",
                  viewMode === "list"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                List
              </button>
            </div>
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
        {flashMessage && (
          <div
            className={cn(
              "mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
              flashMessage.type === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                : "border-amber-500/20 bg-amber-500/10 text-amber-200"
            )}
          >
            {flashMessage.type === "success" ? (
              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <span className="min-w-0 flex-1">{flashMessage.text}</span>
          </div>
        )}
        {loading ? (
          <LoadingState label="Loading calendar…" />
        ) : (
          <>
            {data?.errors.google && !needsAuth && (
              <ErrorBanner message={data.errors.google} errorDebug={data.errorDebug} />
            )}

            {needsKeyringPassphrase && <KeyringPassphrasePanel />}

            {(needsAuth || showAccountPicker) && (
              <GogSetupPanel
                isMultipleAccounts={
                  showAccountPicker ||
                  Boolean(
                    data?.errors?.google?.includes("missing --account") ||
                    data?.errors?.google?.includes("multiple")
                  )
                }
                onAccountChosen={handleAccountChosen}
                selectedAccount={selectedAccount || undefined}
                googleError={data?.errors?.google}
                errorDebug={data?.errorDebug}
              />
            )}

            {data?.sources.google && grouped.length > 0 && (
              <div className="mb-4 flex items-center gap-4 text-xs text-muted-foreground/50">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                Google Calendar
              </div>
            )}

            {viewMode === "month" && data && (
              <div className="mb-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/80">
                      Calendar · Month
                    </p>
                    <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                      {viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Previous month"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMonth(new Date())}
                      className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-600 transition-colors hover:bg-violet-500/20 dark:text-violet-400"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Next month"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <MonthGridView
                  events={data.events ?? []}
                  year={viewMonth.getFullYear()}
                  month={viewMonth.getMonth()}
                />
              </div>
            )}

            {viewMode === "week" && data && (
              <div className="mb-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/80">
                      Calendar · Week
                    </p>
                    <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                      {weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
                      {weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setViewDate((d) => new Date(d.getTime() - 7 * 24 * 60 * 60 * 1000))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Previous week"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewDate(new Date())}
                      className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-600 transition-colors hover:bg-violet-500/20 dark:text-violet-400"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewDate((d) => new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Next week"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <WeekGridView events={eventsForWeek} weekStart={weekStart} />
              </div>
            )}

            {viewMode === "day" && data && (
              <div className="mb-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/80">
                      Calendar · Day
                    </p>
                    <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                      {viewDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setViewDate((d) => new Date(d.getTime() - 24 * 60 * 60 * 1000))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Previous day"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewDate(new Date())}
                      className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-600 transition-colors hover:bg-violet-500/20 dark:text-violet-400"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewDate((d) => new Date(d.getTime() + 24 * 60 * 60 * 1000))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Next day"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <DaySingleView dateKey={viewDateKey} events={eventsForDay} />
              </div>
            )}

            {viewMode === "list" && (
              <div className="mb-6">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/80">
                  Calendar · Day list
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                  Next {days} days
                </h2>
              </div>
            )}
            {viewMode === "list" && grouped.map(([dateKey, events]) => (
              <DayGroup key={dateKey} dateKey={dateKey} events={events} />
            ))}

            {grouped.length === 0 && !loading && !needsAuth && viewMode !== "week" && viewMode !== "day" && (
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
