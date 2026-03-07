"use client";

import { useEffect, useState, useCallback, useRef, useMemo, useSyncExternalStore } from "react";
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
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import {
  getTimeFormatServerSnapshot,
  getTimeFormatSnapshot,
  subscribeTimeFormatPreference,
  withTimeFormat,
  type TimeFormatPreference,
} from "@/lib/time-format-preference";

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
    iconClass: "text-stone-500 dark:text-stone-400",
    rowClass: "border-l-2 border-transparent",
    messageClass: "text-stone-800 dark:text-stone-200",
  },
};

function sourceClass(source: string): string {
  switch (source) {
    case "ws":
      return "text-sky-700 dark:text-sky-300";
    case "cron":
      return "text-amber-700 dark:text-amber-300";
    case "telegram":
      return "text-sky-700 dark:text-sky-300";
    case "tools":
      return "text-teal-700 dark:text-teal-300";
    case "skills-remote":
      return "text-orange-700 dark:text-orange-300";
    case "agent":
      return "text-emerald-700 dark:text-emerald-300";
    case "system":
      return "text-rose-700 dark:text-rose-300";
    default:
      return "text-stone-600 dark:text-[#c7d0d9]";
  }
}

function formatLogTime(time: string, timeFormat: TimeFormatPreference): string {
  if (!time) return "";
  try {
    const d = new Date(time);
    return d.toLocaleTimeString(
      "en-US",
      withTimeFormat({ hour: "2-digit", minute: "2-digit", second: "2-digit" }, timeFormat),
    );
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
  const timeFormat = useSyncExternalStore(
    subscribeTimeFormatPreference,
    getTimeFormatSnapshot,
    getTimeFormatServerSnapshot,
  );
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [stats, setStats] = useState<LogStats>({ info: 0, warn: 0, error: 0 });
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [limit, setLimit] = useState(200);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Debounce search: only update debouncedSearch 300ms after the user stops typing
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (sourceFilter) params.set("source", sourceFilter);
      if (levelFilter) params.set("level", levelFilter);
      const res = await fetch(`/api/logs?${params}`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      setEntries(data.entries || []);
      setSources(data.sources || []);
      setStats(data.stats || { info: 0, warn: 0, error: 0 });
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [limit, debouncedSearch, sourceFilter, levelFilter]);

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
    setDebouncedSearch("");
    setSourceFilter("");
    setLevelFilter("");
  }, []);

  const hasFilters = search || sourceFilter || levelFilter;

  // Reversed entries for terminal display (oldest at top, newest at bottom)
  const displayEntries = useMemo(
    () => [...entries].reverse(),
    [entries]
  );

  const downloadLogs = useCallback(() => {
    const blob = new Blob([JSON.stringify(displayEntries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openclaw-logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayEntries]);

  return (
    <SectionLayout>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Terminal className="h-5 w-5 text-stone-700 dark:text-stone-200" />
            Logs
          </span>
        }
        description="Live gateway and agent logs with filtering, tailing, and quick source inspection."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-stone-600 dark:bg-[#171a1d] dark:text-[#c7d0d9]">
              {stats.info} info
              </span>
            {stats.warn > 0 && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                {stats.warn} warn
                </span>
            )}
            {stats.error > 0 && (
                <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
                {stats.error} err
                </span>
            )}
            </div>
            <button
              type="button"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                autoRefresh
                  ? "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "border-stone-200 bg-white text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-[#c7d0d9] dark:hover:bg-[#1e2227] dark:hover:text-[#f5f7fa]"
              )}
            >
              {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {autoRefresh ? "Live" : "Paused"}
            </button>
            <button
              type="button"
              onClick={fetchLogs}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-[#c7d0d9] dark:hover:bg-[#1e2227] dark:hover:text-[#f5f7fa]"
              title="Refresh now"
            >
              {loading ? (
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                </span>
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                showFilters || hasFilters
                  ? "border-stone-900 bg-stone-900 text-white dark:border-stone-200 dark:bg-stone-100 dark:text-stone-900"
                  : "border-stone-200 bg-white text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-[#c7d0d9] dark:hover:bg-[#1e2227] dark:hover:text-[#f5f7fa]"
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              Filters
              {hasFilters && (
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  showFilters || hasFilters
                    ? "bg-white/20 text-white dark:bg-stone-900/15 dark:text-stone-900"
                    : "bg-stone-100 text-stone-600"
                )}>
                  Active
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={downloadLogs}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-[#c7d0d9] dark:hover:bg-[#1e2227] dark:hover:text-[#f5f7fa]"
              title="Download logs as JSON"
              aria-label="Download logs as JSON"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          </div>
        }
      />

      <SectionBody width="wide" padding="regular" innerClassName="space-y-4">
        {showFilters && (
          <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-[#2c343d] dark:bg-[#171a1d]">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Filters</p>
                <p className="text-xs text-stone-500 dark:text-stone-400">Narrow logs by search, source, level, or history depth.</p>
              </div>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-medium text-stone-500 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-stone-400 dark:hover:text-[#f5f7fa]"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 dark:border-[#2c343d] dark:bg-stone-900/70">
              <Search className="h-3.5 w-3.5 text-stone-400 dark:text-[#8d98a5]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search logs..."
                className="w-44 bg-transparent text-sm text-stone-700 outline-none placeholder:text-stone-400 dark:text-stone-200 dark:placeholder:text-stone-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="text-stone-400 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-[#8d98a5] dark:hover:text-stone-200"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Source filter */}
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 outline-none dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-stone-200"
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
                    "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    levelFilter === level
                      ? level === "error"
                        ? "border-red-200 bg-red-100 text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300"
                      : level === "warn"
                          ? "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                          : "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300"
                      : "border-stone-200 bg-stone-50 text-stone-500 hover:text-stone-900 dark:border-[#2c343d] dark:bg-stone-900/70 dark:text-stone-400 dark:hover:text-[#f5f7fa]"
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
              className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 outline-none dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-stone-200"
            >
              <option value="100">100 lines</option>
              <option value="200">200 lines</option>
              <option value="500">500 lines</option>
              <option value="1000">1000 lines</option>
            </select>
          </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm dark:border-[#2c343d] dark:bg-[#171a1d]">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="max-h-[calc(100vh-18rem)] overflow-y-auto bg-white font-mono text-xs leading-relaxed dark:bg-stone-900"
          >
        {loading && entries.length === 0 ? (
          <LoadingState label="Loading logs..." className="py-12" />
        ) : displayEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-stone-400 dark:text-[#8d98a5]">
            <Terminal className="h-6 w-6" />
            <span className="text-sm font-medium">No log entries found</span>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-medium text-emerald-700 hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-300 dark:hover:text-emerald-200"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="px-2 py-2">
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
                      <div className="h-px flex-1 bg-stone-200 dark:bg-stone-700" />
                      <span className="text-xs font-medium text-stone-400 dark:text-[#8d98a5]">
                        {formatLogDate(entry.time)}
                      </span>
                      <div className="h-px flex-1 bg-stone-200 dark:bg-stone-700" />
                    </div>
                  )}
                    <div
                      className={cn(
                        "group flex items-start gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/70",
                        style.rowClass
                      )}
                    >
                    <span className="w-16 shrink-0 text-stone-400 dark:text-[#8d98a5]">
                      {formatLogTime(entry.time, timeFormat)}
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
                      {highlightMessage(entry.message, debouncedSearch)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-stone-200 bg-stone-50 px-4 py-2 dark:border-[#2c343d] dark:bg-[#171a1d]">
        <span className="text-xs text-stone-500 dark:text-stone-400">
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-stone-600 dark:bg-stone-900 dark:text-[#c7d0d9] dark:hover:bg-[#1e2227] dark:hover:text-[#f5f7fa]"
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
        </div>
      </SectionBody>
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
      <mark className="rounded bg-amber-100 px-0.5 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200">
        {message.slice(idx, idx + search.length)}
      </mark>
      {message.slice(idx + search.length)}
    </>
  );
}
