"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ListChecks,
  Clock,
  MessageSquare,
  Radio,
  Brain,
  FolderOpen,
  Settings,
  Wrench,
  MessageCircle,
  Terminal,
  SquareTerminal,
  RefreshCw,
  Power,
  Cpu,
  Volume2,
  Database,
  Users,
  BarChart3,
  Menu,
  X,
} from "lucide-react";
import { getChatUnreadCount, subscribeChatStore } from "@/lib/chat-store";

const navItems: {
  section: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  dividerAfter?: boolean;
}[] = [
  { section: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { section: "agents", label: "Agents", icon: Users },
  { section: "chat", label: "Chat", icon: MessageCircle, dividerAfter: true },
  { section: "tasks", label: "Tasks", icon: ListChecks },
  { section: "cron", label: "Cron Jobs", icon: Clock, dividerAfter: true },
  { section: "sessions", label: "Sessions", icon: MessageSquare },
  { section: "system", label: "System", icon: Radio },
  { section: "skills", label: "Skills", icon: Wrench, dividerAfter: true },
  { section: "memory", label: "Memory", icon: Brain },
  { section: "docs", label: "Docs", icon: FolderOpen },
  { section: "vectors", label: "Vector DB", icon: Database, dividerAfter: true },
  { section: "models", label: "Models", icon: Cpu },
  { section: "usage", label: "Usage", icon: BarChart3 },
  { section: "audio", label: "Audio & Voice", icon: Volume2 },
  { section: "terminal", label: "Terminal", icon: SquareTerminal, dividerAfter: true },
  { section: "logs", label: "Logs", icon: Terminal },
  { section: "config", label: "Config", icon: Settings },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const searchParams = useSearchParams();
  const section = searchParams.get("section") || "dashboard";

  // Subscribe to chat unread count reactively
  const chatUnread = useSyncExternalStore(
    subscribeChatStore,
    getChatUnreadCount,
    () => 0 // SSR fallback
  );

  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 pt-4 overflow-y-auto">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = section === item.section;
        const showBadge = item.section === "chat" && chatUnread > 0;
        return (
          <div key={item.section}>
            <Link
              href={`/?section=${item.section}`}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                isActive
                  ? "bg-violet-600/20 text-violet-700 dark:text-violet-300"
                  : "text-muted-foreground dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-200"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">
                  {chatUnread > 9 ? "9+" : chatUnread}
                </span>
              )}
            </Link>
            {item.dividerAfter && (
              <div className="my-2 border-t border-border" />
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* ── Gateway status + restart badge ─────────────── */

type GatewayStatus = "online" | "degraded" | "offline" | "loading";

const STATUS_COLORS: Record<GatewayStatus, string> = {
  online: "bg-emerald-400",
  degraded: "bg-amber-400",
  offline: "bg-red-500",
  loading: "bg-zinc-500 animate-pulse",
};

const STATUS_RING: Record<GatewayStatus, string> = {
  online: "ring-emerald-400/30",
  degraded: "ring-amber-400/30",
  offline: "ring-red-500/30",
  loading: "ring-muted-foreground/30",
};

const STATUS_LABELS: Record<GatewayStatus, string> = {
  online: "Online",
  degraded: "Degraded",
  offline: "Offline",
  loading: "Checking...",
};

function GatewayBadge() {
  const [status, setStatus] = useState<GatewayStatus>("loading");
  const [restarting, setRestarting] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    let active = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let fastPollCount = 0;

    const poll = () => {
      fetch("/api/gateway")
        .then((r) => r.json())
        .then((data) => {
          if (!active) return;
          const newStatus = data.status as GatewayStatus;
          setStatus(newStatus);
          // If we were fast-polling and gateway is back online, revert to normal
          if (fastPollCount > 0 && newStatus === "online") {
            fastPollCount = 0;
            switchToNormalPoll();
          }
        })
        .catch(() => { if (active) setStatus("offline"); });
    };

    const switchToNormalPoll = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(poll, 10000);
    };

    const switchToFastPoll = () => {
      if (intervalId) clearInterval(intervalId);
      fastPollCount = 1;
      intervalId = setInterval(() => {
        fastPollCount++;
        if (fastPollCount > 30) switchToNormalPoll();
        else poll();
      }, 2000);
    };

    const handleRestarting = () => {
      if (active) {
        setStatus("loading");
        setRestarting(true);
        switchToFastPoll();
        setTimeout(poll, 1500);
        setTimeout(() => { if (active) setRestarting(false); }, 5000);
      }
    };

    window.addEventListener("gateway-restarting", handleRestarting);
    poll();
    intervalId = setInterval(poll, 10000);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener("gateway-restarting", handleRestarting);
    };
  }, []);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    setShowMenu(false);
    // Notify both header and sidebar status badges
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gateway-restarting"));
    }
    try {
      await fetch("/api/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
    } catch {
      // ignore
    }
  }, []);

  const handleStop = useCallback(async () => {
    setShowMenu(false);
    // Notify both header and sidebar status badges
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gateway-restarting"));
    }
    try {
      await fetch("/api/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowMenu(!showMenu)}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-zinc-800/40"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/5 dark:bg-zinc-800/80 text-lg">
          🦞
        </div>
        <div className="flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-2 w-2 rounded-full ring-2",
                STATUS_COLORS[status],
                STATUS_RING[status]
              )}
            />
            <span className="text-[11px] font-medium text-muted-foreground dark:text-zinc-400">
              Gateway
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground dark:text-zinc-600">
            {restarting ? "Restarting..." : STATUS_LABELS[status]}
          </span>
        </div>
      </button>

      {showMenu && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-xl backdrop-blur-sm">
          <button
            type="button"
            onClick={handleRestart}
            disabled={restarting}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground",
                restarting && "animate-spin"
              )}
            />
            Restart Gateway
          </button>
          <button
            type="button"
            onClick={handleStop}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <Power className="h-3.5 w-3.5" />
            Stop Gateway
          </button>
          <div className="mx-2 my-1 h-px bg-border" />
          <div className="px-3 py-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px]",
                status === "online" ? "text-emerald-400" : status === "degraded" ? "text-amber-400" : "text-red-400"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  STATUS_COLORS[status]
                )}
              />
              {STATUS_LABELS[status]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Close on escape
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  return (
    <>
      {/* Mobile hamburger — visible only on small screens */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-50 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-sidebar text-foreground shadow-sm md:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — always visible on desktop, slide-in drawer on mobile */}
      <aside
        className={cn(
          "flex h-full w-[200px] shrink-0 flex-col border-r border-border bg-sidebar transition-transform duration-200 ease-in-out",
          // Desktop: always visible
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-xl",
          mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"
        )}
      >
        {/* Mobile close button */}
        <div className="flex items-center justify-end px-3 pt-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <Suspense fallback={<div className="flex-1" />}>
          <SidebarNav onNavigate={closeMobile} />
        </Suspense>
        <div className="border-t border-border">
          <GatewayBadge />
        </div>
      </aside>
    </>
  );
}

export { Sidebar as AppSidebar };
