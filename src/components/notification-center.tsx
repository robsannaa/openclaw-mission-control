"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, CheckCircle, Clock, AlertCircle, AlertTriangle, Info, Zap, Terminal, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSmartPoll } from "@/hooks/use-smart-poll";

type NotificationEvent = {
  id: string;
  type: "cron" | "session" | "log" | "system";
  timestamp: number;
  title: string;
  detail?: string;
  status?: "ok" | "error" | "info" | "warning";
  source?: string;
};

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

const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  ok: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  cron: Clock,
  session: Zap,
  log: Terminal,
  system: Radio,
};

const TYPE_ROUTE: Record<string, string> = {
  cron: "/cron",
  session: "/sessions",
  log: "/logs",
  system: "/activity",
};

export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [lastSeenTs, setLastSeenTs] = useState(() => {
    if (typeof window === "undefined") return 0;
    const stored = localStorage.getItem("notif_last_seen");
    return stored ? Number(stored) : 0;
  });
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as NotificationEvent[];
      // Only show actionable events (errors, warnings, and cron failures)
      const actionable = (Array.isArray(data) ? data : []).filter(
        (e) => e.status === "error" || e.status === "warning"
      );
      setEvents(actionable.slice(0, 20));
    } catch {
      /* ignore */
    }
  }, []);

  useSmartPoll(fetchNotifications, { intervalMs: 15_000 });

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const unreadCount = events.filter((e) => e.timestamp > lastSeenTs).length;

  const markAllRead = useCallback(() => {
    const now = Date.now();
    setLastSeenTs(now);
    try {
      localStorage.setItem("notif_last_seen", String(now));
    } catch { /* ignore */ }
  }, []);

  const handleOpen = () => {
    setOpen(!open);
  };

  const handleItemClick = (event: NotificationEvent) => {
    const route = TYPE_ROUTE[event.type] || "/activity";
    setOpen(false);
    router.push(route);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-[#a8b0ba] dark:hover:bg-[#20252a] dark:hover:text-[#f5f7fa]",
          open && "bg-stone-100 text-stone-700 dark:bg-[#20252a] dark:text-[#f5f7fa]",
        )}
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-lg">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl dark:border-[#2c343d] dark:bg-[#171a1d] animate-in slide-in-from-top-1 fade-in duration-150">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-[#2c343d]">
            <p className="text-sm font-semibold text-stone-900 dark:text-[#f5f7fa]">
              Notifications
            </p>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-[#8d98a5] dark:hover:bg-[#20252a] dark:hover:text-[#f5f7fa]"
                >
                  <CheckCheck className="h-3 w-3" />
                  Mark read
                </button>
              )}
              <span className="text-xs text-stone-500 dark:text-[#8d98a5]">
                {events.length} alert{events.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Events */}
          <div className="max-h-80 overflow-y-auto overscroll-contain" role="list" aria-label="Alert notifications" aria-live="polite">
            {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <Bell className="h-5 w-5 text-stone-300 dark:text-[#4a5260]" />
                <p className="text-xs text-stone-500 dark:text-[#8d98a5]">
                  No alerts — everything looks good
                </p>
              </div>
            ) : (
              events.map((event) => {
                const isUnread = event.timestamp > lastSeenTs;
                const Icon = STATUS_ICON[event.status || "info"] || Info;
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => handleItemClick(event)}
                    className={cn(
                      "flex w-full gap-3 border-b border-stone-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-stone-50 dark:border-[#1e2228] dark:hover:bg-[#1a1f25]",
                      isUnread && "bg-stone-50 dark:bg-[#151920]",
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                        event.status === "error"
                          ? "bg-red-100 dark:bg-red-500/10"
                          : event.status === "warning"
                            ? "bg-amber-100 dark:bg-amber-500/10"
                            : "bg-stone-100 dark:bg-[#20252a]",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-3 w-3",
                          event.status === "error"
                            ? "text-red-500 dark:text-red-400"
                            : event.status === "warning"
                              ? "text-amber-500 dark:text-amber-400"
                              : "text-stone-400 dark:text-[#8d98a5]",
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-stone-900 dark:text-[#f5f7fa]">
                        {event.title}
                      </p>
                      {event.detail && (
                        <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-[#8d98a5]">
                          {event.detail}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-xs text-stone-400 dark:text-[#7a8591]">
                          {timeAgo(event.timestamp)}
                        </p>
                        <span className="text-xs text-stone-300 dark:text-[#4a5260]">
                          {TYPE_ROUTE[event.type]?.slice(1) || "activity"}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
