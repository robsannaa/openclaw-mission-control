"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Search,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Info,
  Filter,
  ArrowDown,
  Pause,
  Play,
  Terminal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";

type LogEntry = {
  line: number;
  time: string;
  timeMs: number;
  source: string;
  level: "info" | "warn" | "error";
  message: string;
  raw: string;
};

type LogStats = { info: number; warn: number; error: number };

const LEVEL_STYLES: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
    rowClass: string;
    messageClass: string;
  }
> = {
  error: {
    icon: AlertCircle,
    iconClass: "text-red-600 dark:text-red-400",
    rowClass: "border-l-2 border-red-500/45 bg-red-500/10 dark:bg-red-500/5",
    messageClass: "text-red-700 dark:text-red-300/90",
  },
  warn: {
    icon: AlertTriangle,
    iconClass: "text-amber-700 dark:text-amber-400",
    rowClass: "border-l-2 border-amber-500/45 bg-amber-500/10 dark:bg-amber-500/5",
    messageClass: "text-amber-800 dark:text-amber-300/75",
  },
  info: {
    icon: Info,
    iconClass: "text-slate-600 dark:text-muted-foreground",
    rowClass: "border-l-2 border-transparent",
    messageClass: "text-foreground/90 dark:text-muted-foreground",
  },
};

function sourceClass(source: string): string {
  switch (source) {
    case "ws":
      return "text-blue-700 dark:text-blue-300/70";
    case "cron":
      return "text-amber-700 dark:text-amber-300/70";
    case "telegram":
      return "text-cyan-700 dark:text-cyan-300/70";
    case "tools":
      return "text-violet-700 dark:text-violet-300/70";
    case "skills-remote":
      return "text-orange-700 dark:text-orange-300/75";
    case "agent":
      return "text-emerald-700 dark:text-emerald-300/70";
    case "system":
      return "text-rose-700 dark:text-rose-300/75";
    default:
      return "text-foreground/70 dark:text-muted-foreground";
  }
}

function formatLogTime(time: string): string {
  if (!time) return "";
  try {
    const d = new Date(time);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return time;
  }
}

function formatLogDate(time: string): string {
  if (!time) return "";
  try {
    const d = new Date(time);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function LogsView() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [stats, setStats] = useState<LogStats>({ info: 0, warn: 0, error: 0 });
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [limit, setLimit] = useState(200);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (search) params.set("search", search);
      if (sourceFilter) params.set("source", sourceFilter);
      if (levelFilter) params.set("level", levelFilter);
      const res = await fetch(`/api/logs?${params}`);
      const data = await res.json();
      setEntries(data.entries || []);
      setSources(data.sources || []);
      setStats(data.stats || { info: 0, warn: 0, error: 0 });
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [limit, search, sourceFilter, levelFilter]);

  // Initial fetch + auto-refresh
  useEffect(() => {
    queueMicrotask(() => fetchLogs());
    if (autoRefresh) {
      timerRef.current = setInterval(() => {
        if (document.visibilityState === "visible") {
          void fetchLogs();
        }
      }, 3000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchLogs, autoRefresh]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setSourceFilter("");
    setLevelFilter("");
  }, []);

  const hasFilters = search || sourceFilter || levelFilter;

  // Reversed entries for terminal display (oldest at top, newest at bottom)
  const displayEntries = useMemo(
    () => [...entries].reverse(),
    [entries]
  );

  return (
    <SectionLayout>
      {/* ── Toolbar ──────────────────────────────── */}
      <div className="shrink-0 border-b border-foreground/10 bg-card/60">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground/90">Live Logs</h2>

          {/* Stats badges */}
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-muted/80 px-2 py-0.5 text-xs text-muted-foreground">
              {stats.info} info
            </span>
            {stats.warn > 0 && (
              <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                {stats.warn} warn
              </span>
            )}
            {stats.error > 0 && (
              <span className="rounded bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
                {stats.error} err
              </span>
            )}
          </div>

          <div className="flex-1" />

          {/* Auto-refresh toggle */}
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
              autoRefresh
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : "border-foreground/10 bg-muted/60 text-muted-foreground"
            )}
          >
            {autoRefresh ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {autoRefresh ? "Live" : "Paused"}
          </button>

          {/* Refresh button */}
          <button
            type="button"
            onClick={fetchLogs}
            className="rounded-md border border-foreground/10 bg-muted/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/70"
            title="Refresh now"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>

          {/* Filter toggle */}
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
              showFilters || hasFilters
                ? "border-violet-500/20 bg-violet-500/10 text-violet-400"
                : "border-foreground/10 bg-muted/60 text-muted-foreground hover:text-foreground/70"
            )}
          >
            <Filter className="h-3 w-3" />
            Filters
            {hasFilters && (
              <span className="ml-0.5 rounded-full bg-violet-500/30 px-1 text-xs">
                !
              </span>
            )}
          </button>
        </div>

        {/* ── Filter bar ──────────────────────────── */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 border-t border-foreground/5 px-4 py-2">
            {/* Search */}
            <div className="flex items-center gap-1.5 rounded-md border border-foreground/10 bg-card px-2 py-1">
              <Search className="h-3 w-3 text-muted-foreground/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search logs..."
                className="w-40 bg-transparent text-xs text-foreground/70 outline-none placeholder:text-muted-foreground/60"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="text-muted-foreground/60 hover:text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Source filter */}
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-md border border-foreground/10 bg-card px-2 py-1 text-xs text-foreground/70 outline-none"
            >
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  [{s}]
                </option>
              ))}
            </select>

            {/* Level filter */}
            <div className="flex items-center gap-1">
              {(["info", "warn", "error"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() =>
                    setLevelFilter(levelFilter === level ? "" : level)
                  }
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
                    levelFilter === level
                      ? level === "error"
                        ? "border-red-500/30 bg-red-500/15 text-red-400"
                        : level === "warn"
                          ? "border-amber-500/30 bg-amber-500/15 text-amber-400"
                          : "border-blue-500/30 bg-blue-500/15 text-blue-300"
                      : "border-foreground/10 bg-muted/60 text-muted-foreground hover:text-muted-foreground"
                  )}
                >
                  {level}
                </button>
              ))}
            </div>

            {/* Limit */}
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value, 10))}
              className="rounded-md border border-foreground/10 bg-card px-2 py-1 text-xs text-foreground/70 outline-none"
            >
              <option value="100">100 lines</option>
              <option value="200">200 lines</option>
              <option value="500">500 lines</option>
              <option value="1000">1000 lines</option>
            </select>

            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-muted-foreground hover:text-foreground/70"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Terminal output ────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-background font-mono text-xs leading-relaxed"
      >
        {loading && entries.length === 0 ? (
          <LoadingState label="Loading logs..." className="py-12" />
        ) : displayEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground/60">
            <Terminal className="h-6 w-6" />
            <span className="text-sm">No log entries found</span>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-violet-400 hover:text-violet-300"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="px-2 py-1">
            {displayEntries.map((entry, i) => {
              const style = LEVEL_STYLES[entry.level] || LEVEL_STYLES.info;
              const LevelIcon = style.icon;
              // Show date separator
              const prevEntry = i > 0 ? displayEntries[i - 1] : null;
              const showDate =
                i === 0 ||
                (entry.time &&
                  prevEntry?.time &&
                  formatLogDate(entry.time) !== formatLogDate(prevEntry.time));

              return (
                <div key={`${entry.time}-${entry.line}-${i}`}>
                  {showDate && entry.time && (
                    <div className="my-1 flex items-center gap-2 px-2 py-0.5">
                      <div className="h-px flex-1 bg-foreground/5" />
                      <span className="text-xs text-muted-foreground/60">
                        {formatLogDate(entry.time)}
                      </span>
                      <div className="h-px flex-1 bg-foreground/5" />
                    </div>
                  )}
                    <div
                      className={cn(
                        "group flex items-start gap-2 rounded px-2 py-0.5 transition-colors hover:bg-muted/50",
                        style.rowClass
                      )}
                    >
                    <span className="w-16 shrink-0 text-foreground/45 dark:text-muted-foreground/60">
                      {formatLogTime(entry.time)}
                    </span>
                    <LevelIcon
                      className={cn("mt-0.5 h-3 w-3 shrink-0", style.iconClass)}
                    />
                    <span
                      className={cn(
                        "w-24 shrink-0 truncate font-semibold",
                        sourceClass(entry.source)
                      )}
                    >
                      [{entry.source}]
                    </span>
                    <span
                      className={cn(
                        "flex-1 break-all whitespace-pre-wrap",
                        style.messageClass
                      )}
                    >
                      {highlightMessage(entry.message, search)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Bottom bar ─────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-t border-foreground/10 bg-card/60 px-4 py-1.5">
        <span className="text-xs text-muted-foreground/60">
          {displayEntries.length} entries
          {hasFilters && " (filtered)"}
        </span>
        <div className="flex items-center gap-2">
          {!autoScroll && (
            <button
              type="button"
              onClick={() => {
                setAutoScroll(true);
                scrollRef.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: "smooth",
                });
              }}
              className="flex items-center gap-1 rounded bg-violet-500/10 px-2 py-0.5 text-xs text-violet-400 transition-colors hover:bg-violet-500/20"
            >
              <ArrowDown className="h-3 w-3" />
              Scroll to bottom
            </button>
          )}
          {autoRefresh && (
            <span className="flex items-center gap-1 text-xs text-emerald-500/60">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Auto-refresh 3s
            </span>
          )}
        </div>
      </div>
    </SectionLayout>
  );
}

/** Highlight search matches in log messages */
function highlightMessage(message: string, search: string): React.ReactNode {
  if (!search) return message;
  const idx = message.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return message;
  return (
    <>
      {message.slice(0, idx)}
      <mark className="rounded bg-violet-500/20 px-0.5 text-violet-900 dark:bg-violet-500/30 dark:text-violet-200">
        {message.slice(idx, idx + search.length)}
      </mark>
      {message.slice(idx + search.length)}
    </>
  );
}
