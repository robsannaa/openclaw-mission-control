"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useCallback, useSyncExternalStore, useRef } from "react";
import {
  setAutoRestartOnChanges,
  subscribeAutoRestartPreference,
  getAutoRestartSnapshot,
  getAutoRestartServerSnapshot,
} from "@/lib/auto-restart-preference";
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
  Shield,
  Package,
  ChevronRight,
  Waypoints,
  Globe,
  KeyRound,
  Search,
} from "lucide-react";
import { getChatUnreadCount, subscribeChatStore } from "@/lib/chat-store";
import {
  notifyGatewayRestarting,
  useGatewayStatusStore,
  type GatewayStatus,
} from "@/lib/gateway-status-store";

const navItems: {
  section: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  tab?: string;
  isSubItem?: boolean;
  dividerAfter?: boolean;
  comingSoon?: boolean;
}[] = [
  { section: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { section: "chat", label: "Chat", icon: MessageCircle },
  { section: "channels", label: "Channels", icon: Radio },
  { section: "agents", label: "Agents", icon: Users },
  { section: "agents", label: "Subagents", icon: ChevronRight, href: "/?section=agents&tab=subagents", tab: "subagents", isSubItem: true, dividerAfter: true },
  { section: "tasks", label: "Tasks", icon: ListChecks },
  { section: "sessions", label: "Sessions", icon: MessageSquare },
  { section: "cron", label: "Cron Jobs", icon: Clock },
  { section: "memory", label: "Memory", icon: Brain },
  { section: "docs", label: "Docs", icon: FolderOpen },
  { section: "vectors", label: "Vector DB", icon: Database, dividerAfter: true },
  { section: "skills", label: "Skills", icon: Wrench },
  { section: "skills", label: "ClawHub", icon: Package, href: "/?section=skills&tab=clawhub", tab: "clawhub", isSubItem: true },
  { section: "models", label: "Models", icon: Cpu },
  { section: "accounts", label: "Accounts & Keys", icon: KeyRound },
  { section: "audio", label: "Audio & Voice", icon: Volume2 },
  { section: "browser", label: "Browser Relay", icon: Globe },
  { section: "search", label: "Web Search", icon: Search },
  { section: "tailscale", label: "Tailscale", icon: Waypoints },
  { section: "permissions", label: "Permissions", icon: Shield, dividerAfter: true },
  { section: "usage", label: "Usage", icon: BarChart3 },
  { section: "terminal", label: "Terminal", icon: SquareTerminal },
  { section: "logs", label: "Logs", icon: Terminal },
  { section: "config", label: "Config", icon: Settings },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const sectionFromQuery = searchParams.get("section") || "dashboard";
  const tabFromQuery = (searchParams.get("tab") || "").toLowerCase();
  const isSkillDetailRoute = pathname.startsWith("/skills/");
  const section = isSkillDetailRoute ? "skills" : sectionFromQuery;
  const tab = isSkillDetailRoute ? "skills" : tabFromQuery;
  const [skillsExpanded, setSkillsExpanded] = useState(true);
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const isClawHubActive = section === "skills" && tab === "clawhub";
  const showSkillsChildren = isClawHubActive ? true : skillsExpanded;
  const isSubagentsActive = section === "agents" && tab === "subagents";
  const showAgentsChildren = isSubagentsActive ? true : agentsExpanded;

  // Subscribe to chat unread count reactively
  const chatUnread = useSyncExternalStore(
    subscribeChatStore,
    getChatUnreadCount,
    () => 0 // SSR fallback
  );

  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 pt-4 overflow-y-auto">
      {navItems.map((item) => {
        const isSkillsParent = item.section === "skills" && item.label === "Skills";
        const isAgentsParent = item.section === "agents" && item.label === "Agents";
        if (item.isSubItem && item.section === "skills" && !showSkillsChildren) return null;
        if (item.isSubItem && item.section === "agents" && !showAgentsChildren) return null;

        const Icon = item.icon;
        const isActive =
          !item.comingSoon &&
          section === item.section &&
          (item.tab ? tab === item.tab : item.section !== "skills" || tab !== "clawhub");
        const showBadge = item.section === "chat" && chatUnread > 0;
        const isDisabled = item.comingSoon;
        const linkClass = cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
          item.isSubItem && "ml-6 py-1 text-xs",
          isDisabled
            ? "cursor-not-allowed opacity-60 text-muted-foreground dark:text-zinc-500"
            : isActive
              ? "bg-violet-600/20 text-violet-700 dark:text-violet-300"
              : "text-muted-foreground dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-zinc-200"
        );
        return (
          <div key={`${item.section}:${item.label}`}>
            {isDisabled ? (
              <span className={linkClass} aria-disabled>
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{item.label}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  Coming soon
                </span>
              </span>
            ) : (
              (isSkillsParent || isAgentsParent) ? (
                <div className={linkClass}>
                  <Link
                    href={item.href || `/?section=${item.section}`}
                    onClick={onNavigate}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isSkillsParent) {
                        setSkillsExpanded((prev) => !prev);
                      } else {
                        setAgentsExpanded((prev) => !prev);
                      }
                    }}
                    className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground/90"
                    aria-label={
                      isSkillsParent
                        ? (showSkillsChildren ? "Collapse skills submenu" : "Expand skills submenu")
                        : (showAgentsChildren ? "Collapse agents submenu" : "Expand agents submenu")
                    }
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        (isSkillsParent ? showSkillsChildren : showAgentsChildren) && "rotate-90"
                      )}
                    />
                  </button>
                </div>
              ) : (
                <Link
                  href={item.href || `/?section=${item.section}`}
                  onClick={onNavigate}
                  className={linkClass}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {showBadge && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1.5 text-xs font-bold text-white">
                      {chatUnread > 9 ? "9+" : chatUnread}
                    </span>
                  )}
                </Link>
              )
            )}
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
  const { status, restarting } = useGatewayStatusStore();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const autoRestartOnChanges = useSyncExternalStore(
    subscribeAutoRestartPreference,
    getAutoRestartSnapshot,
    getAutoRestartServerSnapshot,
  );

  useEffect(() => {
    if (!showMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowMenu(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showMenu]);

  const handleRestart = useCallback(async () => {
    setShowMenu(false);
    notifyGatewayRestarting();
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
    notifyGatewayRestarting();
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
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setShowMenu(!showMenu)}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-black/5 dark:hover:bg-zinc-800/40"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-black/5 dark:bg-zinc-800/80 text-sm">
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
            <span className="text-xs font-medium text-muted-foreground dark:text-zinc-400">
              Gateway
            </span>
          </div>
          <span className="text-xs text-muted-foreground dark:text-zinc-600">
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
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
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
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <Power className="h-3.5 w-3.5" />
            Stop Gateway
          </button>
          <div className="mx-2 my-1 h-px bg-border" />
          <label className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground/80">
            <span>Auto-restart on changes</span>
            <button
              type="button"
              role="switch"
              aria-checked={autoRestartOnChanges}
              onClick={(e) => {
                e.preventDefault();
                setAutoRestartOnChanges(!autoRestartOnChanges);
              }}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                autoRestartOnChanges ? "bg-violet-500" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform",
                  autoRestartOnChanges ? "left-4" : "left-0.5"
                )}
              />
            </button>
          </label>
          <div className="mx-2 my-1 h-px bg-border" />
          <div className="px-3 py-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs",
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
          "flex h-full w-48 shrink-0 flex-col border-r border-border bg-sidebar transition-transform duration-200 ease-in-out",
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
