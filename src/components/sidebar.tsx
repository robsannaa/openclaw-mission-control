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
  CalendarDays,
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
  Users2,
  BarChart3,
  Menu,
  X,
  Shield,
  Package,
  ChevronRight,
  ChevronLeft,
  Waypoints,
  Globe,
  KeyRound,
  Search,
  Heart,
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
  { section: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { section: "chat", label: "Chat", icon: MessageCircle, href: "/chat" },
  { section: "channels", label: "Channels", icon: Radio, href: "/channels" },
  { section: "agents", label: "Agents", icon: Users, href: "/agents" },
  { section: "agents", label: "Subagents", icon: Users2, href: "/agents?tab=subagents", tab: "subagents", isSubItem: true, dividerAfter: true },
  { section: "tasks", label: "Tasks", icon: ListChecks, href: "/tasks" },
  { section: "sessions", label: "Sessions", icon: MessageSquare, href: "/sessions" },
  { section: "cron", label: "Cron Jobs", icon: Clock, href: "/cron" },
  { section: "heartbeat", label: "Heartbeat", icon: Heart, href: "/heartbeat", isSubItem: true },
  { section: "calendar", label: "Calendar", icon: CalendarDays, comingSoon: true, href: "/calendar" },
  { section: "memory", label: "Memory", icon: Brain, href: "/memory" },
  { section: "docs", label: "Documents", icon: FolderOpen, href: "/documents" },
  { section: "vectors", label: "Vector DB", icon: Database, dividerAfter: true, href: "/vectors" },
  { section: "skills", label: "Skills", icon: Wrench, href: "/skills" },
  { section: "skills", label: "ClawHub", icon: Package, href: "/skills?tab=clawhub", tab: "clawhub", isSubItem: true },
  { section: "models", label: "Models", icon: Cpu, href: "/models" },
  { section: "accounts", label: "Accounts & Keys", icon: KeyRound, href: "/accounts" },
  { section: "audio", label: "Audio & Voice", icon: Volume2, href: "/audio" },
  { section: "browser", label: "Browser Relay", icon: Globe, href: "/browser" },
  { section: "search", label: "Web Search", icon: Search, href: "/search" },
  { section: "tailscale", label: "Tailscale", icon: Waypoints, href: "/tailscale" },
  { section: "permissions", label: "Permissions", icon: Shield, dividerAfter: true, href: "/permissions" },
  { section: "usage", label: "Usage", icon: BarChart3, href: "/usage" },
  { section: "terminal", label: "Terminal", icon: SquareTerminal, href: "/terminal" },
  { section: "logs", label: "Logs", icon: Terminal, href: "/logs" },
  { section: "config", label: "Config", icon: Settings, href: "/config" },
];

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";

function deriveSectionFromPath(pathname: string): string | null {
  if (!pathname || pathname === "/") return null;
  if (pathname.startsWith("/skills/")) return "skills";
  const first = pathname.split("/").filter(Boolean)[0] || "";
  const aliases: Record<string, string> = {
    system: "channels",
    documents: "docs",
    memories: "memory",
    settings: "config",
  };
  if (aliases[first]) return aliases[first];
  const known = new Set([
    "dashboard",
    "chat",
    "agents",
    "tasks",
    "sessions",
    "cron",
    "heartbeat",
    "channels",
    "memory",
    "docs",
    "vectors",
    "skills",
    "models",
    "accounts",
    "audio",
    "browser",
    "search",
    "tailscale",
    "permissions",
    "usage",
    "terminal",
    "logs",
    "config",
    "calendar",
  ]);
  return known.has(first) ? first : null;
}

function SidebarNav({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const sectionFromPath = deriveSectionFromPath(pathname);
  const sectionFromQuery = searchParams.get("section") || "dashboard";
  const tabFromQuery = (searchParams.get("tab") || "").toLowerCase();
  const isSkillDetailRoute = pathname.startsWith("/skills/");
  const section = isSkillDetailRoute
    ? "skills"
    : sectionFromPath || sectionFromQuery;
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
    <nav className={cn("flex flex-1 flex-col gap-0.5 overflow-y-auto pt-4", collapsed ? "px-2" : "px-3")}>
      {navItems.map((item) => {
        const isSkillsParent = item.section === "skills" && item.label === "Skills";
        const isAgentsParent = item.section === "agents" && item.label === "Agents";
        if (collapsed && item.isSubItem) return null;
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
          "flex items-center gap-2.5 rounded-md py-1.5 text-xs font-medium transition-colors",
          collapsed ? "justify-center px-2" : "px-2.5",
          item.isSubItem && !collapsed && "ml-6 py-1 text-xs",
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
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="shrink-0 whitespace-nowrap rounded-full border border-violet-500/20 bg-violet-500/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-400/90">
                      Soon
                    </span>
                  </>
                )}
              </span>
            ) : (
              (isSkillsParent || isAgentsParent) && !collapsed ? (
                <div className={linkClass}>
                  <Link
                    href={item.href || `/${item.section}`}
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
                  href={item.href || `/${item.section}`}
                  onClick={onNavigate}
                  className={linkClass}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="relative inline-flex shrink-0">
                    <Icon className="h-3.5 w-3.5" />
                    {collapsed && showBadge && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-violet-600" title={`${chatUnread} unread`} aria-hidden />
                    )}
                  </span>
                  {!collapsed && <span className="flex-1">{item.label}</span>}
                  {!collapsed && showBadge && (
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

function GatewayBadge({ collapsed }: { collapsed?: boolean }) {
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
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-zinc-800/40",
          collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
        )}
      >
        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/30 dark:bg-white/10 border border-white/20 dark:border-white/10 text-sm shadow-sm">
          🦞
          {collapsed && (
            <div
              className={cn(
                "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-sidebar",
                STATUS_COLORS[status],
                STATUS_RING[status]
              )}
            />
          )}
        </div>
        {!collapsed && (
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
        )}
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
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

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
          "flex h-full shrink-0 flex-col border-r border-white/20 dark:border-white/10 bg-white/50 dark:bg-white/[0.06] backdrop-blur-md transition-[width,transform] duration-200 ease-in-out",
          collapsed ? "w-14 md:w-14" : "w-56 md:w-56",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-xl",
          mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"
        )}
      >
        {/* Mobile close button */}
        <div className={cn("flex items-center pt-3 md:hidden", collapsed ? "justify-center px-2" : "justify-end px-3")}>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <Suspense fallback={<div className="flex-1" />}>
          <SidebarNav onNavigate={closeMobile} collapsed={collapsed} />
        </Suspense>
        <div className="border-t border-border">
          <GatewayBadge collapsed={collapsed} />
        </div>
        {/* Collapse / expand toggle — desktop only */}
        <div className={cn("hidden border-t border-border md:block", collapsed ? "px-2 py-2" : "px-3 py-2")}>
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              "flex w-full items-center rounded-lg py-1.5 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-zinc-800/40",
              collapsed ? "justify-center px-0" : "gap-2 px-2"
            )}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span className="text-xs font-medium">Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

export { Sidebar as AppSidebar };
