"use client";

import { useState, useCallback } from "react";
import {
  Clock,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  Filter,
  Activity,
  Radio,
  Terminal,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import { useSmartPoll } from "@/hooks/use-smart-poll";

/* ── types ────────────────────────────────────────── */

type ActivityEvent = {
  id: string;
  type: "cron" | "session" | "log" | "system";
  timestamp: number;
  title: string;
  detail?: string;
  status?: "ok" | "error" | "info" | "warning";
  source?: string;
};

type FilterType = "all" | "cron" | "session" | "log" | "system";

/* ── helpers ──────────────────────────────────────── */

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ── sub-components ───────────────────────────────── */

const TYPE_CONFIG: Record<
  ActivityEvent["type"],
  {
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
    dotClass: string;
    label: string;
  }
> = {
  cron: {
    icon: Clock,
    iconClass: "text-amber-600 dark:text-amber-400",
    dotClass: "bg-amber-500",
    label: "Cron",
  },
  session: {
    icon: Zap,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    dotClass: "bg-emerald-500",
    label: "Session",
  },
  log: {
    icon: Terminal,
    iconClass: "text-stone-500 dark:text-stone-400",
    dotClass: "bg-stone-400 dark:bg-stone-500",
    label: "Log",
  },
  system: {
    icon: Radio,
    iconClass: "text-sky-600 dark:text-sky-400",
    dotClass: "bg-sky-500",
    label: "System",
  },
};

const STATUS_CONFIG: Record<
  NonNullable<ActivityEvent["status"]>,
  {
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
    dotClass: string;
    borderClass: string;
  }
> = {
  ok: {
    icon: CheckCircle,
    iconClass: "text-emerald-500 dark:text-emerald-400",
    dotClass: "bg-emerald-500",
    borderClass: "border-l-emerald-400 dark:border-l-emerald-500/70",
  },
  error: {
    icon: AlertCircle,
    iconClass: "text-red-500 dark:text-red-400",
    dotClass: "bg-red-500",
    borderClass: "border-l-red-400 dark:border-l-red-500/70",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-amber-500 dark:text-amber-400",
    dotClass: "bg-amber-500",
    borderClass: "border-l-amber-400 dark:border-l-amber-500/70",
  },
  info: {
    icon: Info,
    iconClass: "text-sky-500 dark:text-sky-400",
    dotClass: "bg-sky-500",
    borderClass: "border-l-sky-400 dark:border-l-sky-500/70",
  },
};

const FILTER_PILLS: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cron", label: "Cron" },
  { key: "session", label: "Sessions" },
  { key: "system", label: "System" },
];

function EventCard({ event }: { event: ActivityEvent }) {
  const typeConf = TYPE_CONFIG[event.type];
  const statusConf = event.status ? STATUS_CONFIG[event.status] : null;
  const TypeIcon = typeConf.icon;

  return (
    <div
      className={cn(
        "rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-[#2c343d] dark:bg-[#171a1d]",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Type icon column */}
        <div className="mt-0.5 flex shrink-0 flex-col items-center gap-1.5">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg",
              "bg-stone-100 dark:bg-[#20252a]",
            )}
          >
            <TypeIcon className={cn("h-3.5 w-3.5", typeConf.iconClass)} />
          </div>
          {/* Type dot */}
          <span className={cn("h-1.5 w-1.5 rounded-full", typeConf.dotClass)} />
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 truncate text-sm font-semibold text-stone-900 dark:text-[#f5f7fa]">
              {event.title}
            </p>

            <div className="flex shrink-0 items-center gap-2">
              {/* Status dot + icon */}
              {statusConf && (
                <span
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                    event.status === "ok" &&
                      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
                    event.status === "error" &&
                      "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
                    event.status === "warning" &&
                      "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
                    event.status === "info" &&
                      "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", statusConf.dotClass)} />
                  {event.status}
                </span>
              )}

              {/* Relative time */}
              <span className="text-xs text-stone-500 dark:text-[#8d98a5]">
                {timeAgo(event.timestamp)}
              </span>
            </div>
          </div>

          {/* Detail line */}
          {event.detail && (
            <p className="mt-1 text-xs text-stone-500 dark:text-[#8d98a5] line-clamp-2">
              {event.detail}
            </p>
          )}

          {/* Source badge */}
          {event.source && (
            <p className="mt-1.5 text-xs font-medium text-stone-400 dark:text-[#7a8591]">
              {event.source}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── main component ───────────────────────────────── */

export function ActivityView() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store" });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json() as ActivityEvent[];
      // Sort newest-first before storing
      const sorted = (Array.isArray(data) ? data : []).slice().sort((a, b) => b.timestamp - a.timestamp);
      setEvents(sorted);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useSmartPoll(fetchActivity, { intervalMs: 8000 });

  const filtered =
    activeFilter === "all" ? events : events.filter((e) => e.type === activeFilter);

  if (loading) {
    return (
      <SectionLayout>
        <LoadingState label="Loading activity..." />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout>
      <SectionHeader
        title="Activity"
        description="What's been happening across your agents, cron jobs, and system"
        bordered
        actions={
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void fetchActivity();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-[#c7d0d9] dark:hover:bg-[#20252a] dark:hover:text-[#f5f7fa]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        }
      />

      <SectionBody>
        {/* Filter pills */}
        <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="Filter activity by type">
          <Filter className="h-3.5 w-3.5 shrink-0 text-stone-400 dark:text-[#8d98a5]" />
          {FILTER_PILLS.map((pill) => (
            <button
              key={pill.key}
              type="button"
              aria-pressed={activeFilter === pill.key}
              onClick={() => setActiveFilter(pill.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                activeFilter === pill.key
                  ? "bg-stone-900 text-white dark:bg-[#f5f7fa] dark:text-[#101214]"
                  : "border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-900 dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-[#c7d0d9] dark:hover:bg-[#20252a] dark:hover:text-[#f5f7fa]",
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {/* Timeline */}
        {filtered.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-stone-100 dark:bg-[#20252a]">
              <Activity className="h-6 w-6 text-stone-400 dark:text-[#8d98a5]" />
            </div>
            <p className="text-sm font-medium text-stone-500 dark:text-[#8d98a5]">
              {activeFilter === "all"
                ? "No recent activity"
                : `No ${activeFilter} events — try a different filter`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </SectionBody>
    </SectionLayout>
  );
}
