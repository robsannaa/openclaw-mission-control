"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useCallback, useSyncExternalStore, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Activity,
  LayoutDashboard,
  ListChecks,
  Clock,
  Calendar,
  MessageSquare,
  Radio,
  Brain,
  FolderOpen,
  Settings,
  Wrench,
  MessageCircle,
  Terminal,
  SquareTerminal,
  Cpu,
  Volume2,
  Database,
  Users,
  Users2,
  BarChart3,
  Menu,
  X,
  ShieldCheck,
  Package,
  ChevronRight,
  ChevronLeft,
  Waypoints,
  Globe,
  KeyRound,
  Search,
  Heart,
  Settings2,
  Webhook,
  Stethoscope,
  HelpCircle,
  Puzzle,
} from "lucide-react";
import { getChatUnreadCount, subscribeChatStore } from "@/lib/chat-store";

type NavItem = {
  section: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  tab?: string;
  isSubItem?: boolean;
  comingSoon?: boolean;
  group?: string;
};

const isAgentbayHosting = process.env.NEXT_PUBLIC_AGENTBAY_HOSTED === "true";

const navItems: NavItem[] = [
  // ── Overview ──
  { group: "Overview", section: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { section: "activity", label: "Activity", icon: Activity, href: "/activity" },
  { section: "usage", label: "Usage", icon: BarChart3, href: "/usage" },
  // ── Agents ──
  { group: "Agents", section: "agents", label: "Agents", icon: Users, href: "/agents" },
  { section: "agents", label: "Subagents", icon: Users2, href: "/agents?tab=subagents", tab: "subagents", isSubItem: true },
  { section: "chat", label: "Chat", icon: MessageCircle, href: "/chat" },
  { section: "channels", label: "Channels", icon: Radio, href: "/channels" },
  { section: "sessions", label: "Sessions", icon: MessageSquare, href: "/sessions" },
  // ── Work ──
  { group: "Work", section: "tasks", label: "Tasks", icon: ListChecks, href: "/tasks" },
  { section: "calendar", label: "Calendar", icon: Calendar, href: "/calendar" },
  { section: "calendar", label: "Providers", icon: Settings2, href: "/calendar/providers", tab: "providers", isSubItem: true },
  { section: "integrations", label: "Integrations", icon: Puzzle, href: "/integrations" },
  { section: "cron", label: "Cron Jobs", icon: Clock, href: "/cron" },
  { section: "cron", label: "Heartbeat", icon: Heart, href: "/heartbeat", tab: "heartbeat", isSubItem: true },
  { section: "skills", label: "Skills", icon: Wrench, href: "/skills" },
  { section: "skills", label: "ClawHub", icon: Package, href: "/skills?tab=clawhub", tab: "clawhub", isSubItem: true },
  // ── Knowledge ──
  { group: "Knowledge", section: "memory", label: "Memory", icon: Brain, href: "/memory" },
  { section: "docs", label: "Documents", icon: FolderOpen, href: "/documents" },
  { section: "vectors", label: "Vector DB", icon: Database, href: "/vectors" },
  // ── Configure ──
  { group: "Configure", section: "models", label: "Models", icon: Cpu, href: "/models" },
  { section: "accounts", label: "API Keys", icon: KeyRound, href: "/accounts" },
  { section: "security", label: "Security", icon: ShieldCheck, href: "/security" },
  { section: "hooks", label: "Hooks", icon: Webhook, href: "/hooks" },
  { section: "settings", label: "Preferences", icon: Settings2, href: "/settings" },
  // ── System ──
  { group: "System", section: "doctor", label: "Doctor", icon: Stethoscope, href: "/doctor" },
  { section: "terminal", label: "Terminal", icon: SquareTerminal, href: "/terminal" },
  { section: "logs", label: "Logs", icon: Terminal, href: "/logs" },
  { section: "browser", label: "Browser Relay", icon: Globe, href: "/browser" },
  { section: "audio", label: "Audio & Voice", icon: Volume2, href: "/audio" },
  { section: "search", label: "Web Search", icon: Search, href: "/search" },
  ...(!isAgentbayHosting ? [{ section: "tailscale", label: "Tailscale", icon: Waypoints, href: "/tailscale" } as NavItem] : []),
  { section: "config", label: "Config", icon: Settings, href: "/config" },
  ...(isAgentbayHosting ? [{ section: "help" as const, label: "Help & Support", icon: HelpCircle, href: "/help" } as NavItem] : []),
];

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";
const SIDEBAR_WIDTH_KEY = "sidebar_width";
const SIDEBAR_DEFAULT_WIDTH = 288;
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 420;

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function deriveSectionFromPath(pathname: string): string | null {
  if (!pathname || pathname === "/") return null;
  if (pathname.startsWith("/skills/")) return "skills";
  const first = pathname.split("/").filter(Boolean)[0] || "";
  const aliases: Record<string, string> = {
    system: "channels",
    documents: "docs",
    memories: "memory",
    permissions: "security",
    heartbeat: "cron",
  };
  if (aliases[first]) return aliases[first];
  const known = new Set([
    "dashboard",
    "chat",
    "agents",
    "tasks",
    "calendar",
    "integrations",
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
    "security",
    "permissions",
    "hooks",
    "doctor",
    "usage",
    "terminal",
    "logs",
    "config",
    "settings",
    "activity",
    "help",
  ]);
  return known.has(first) ? first : null;
}

function deriveTabFromPath(pathname: string): string | null {
  if (!pathname || pathname === "/") return null;
  const parts = pathname.split("/").filter(Boolean);
  const first = parts[0] || "";
  if (first === "heartbeat") return "heartbeat";
  if (first === "calendar" && parts[1] === "providers") return "providers";
  return null;
}

function SidebarNav({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const sectionFromPath = deriveSectionFromPath(pathname);
  const sectionFromQuery = searchParams.get("section") || "dashboard";
  const tabFromQuery = (searchParams.get("tab") || "").toLowerCase();
  const tabFromPath = deriveTabFromPath(pathname);
  const isSkillDetailRoute = pathname.startsWith("/skills/");
  const section = isSkillDetailRoute
    ? "skills"
    : sectionFromPath || sectionFromQuery;
  const tab = isSkillDetailRoute ? "skills" : (tabFromPath ?? tabFromQuery);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const [cronExpanded, setCronExpanded] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const isClawHubActive = section === "skills" && tab === "clawhub";
  const showSkillsChildren = isClawHubActive ? true : skillsExpanded;
  const isSubagentsActive = section === "agents" && tab === "subagents";
  const showAgentsChildren = isSubagentsActive ? true : agentsExpanded;
  const isHeartbeatActive = section === "cron" && tab === "heartbeat";
  const showCronChildren = isHeartbeatActive ? true : cronExpanded;
  const isCalendarProvidersActive = section === "calendar" && tab === "providers";
  const showCalendarChildren = isCalendarProvidersActive ? true : calendarExpanded;

  // Subscribe to chat unread count reactively
  const chatUnread = useSyncExternalStore(
    subscribeChatStore,
    getChatUnreadCount,
    () => 0 // SSR fallback
  );

  return (
    <nav className={cn("flex flex-1 flex-col gap-0.5 overflow-y-auto pt-2", collapsed ? "px-2" : "px-3")}>
      {navItems.map((item, index) => {
        const isSkillsParent = item.section === "skills" && item.label === "Skills";
        const isAgentsParent = item.section === "agents" && item.label === "Agents";
        const isCronParent = item.section === "cron" && item.label === "Cron Jobs";
        const isCalendarParent = item.section === "calendar" && item.label === "Calendar";
        if (collapsed && item.isSubItem) return null;
        if (item.isSubItem && item.section === "skills" && !showSkillsChildren) return null;
        if (item.isSubItem && item.section === "agents" && !showAgentsChildren) return null;
        if (item.isSubItem && item.section === "cron" && !showCronChildren) return null;
        if (item.isSubItem && item.section === "calendar" && !showCalendarChildren) return null;

        // Group header
        const previousGroup = index > 0 ? navItems[index - 1]?.group : undefined;
        const showGroupHeader = item.group && item.group !== previousGroup;

        const Icon = item.icon;
        const isActive =
          !item.comingSoon &&
          section === item.section &&
          (item.tab ? tab === item.tab : item.section !== "skills" || tab !== "clawhub");
        const showBadge = item.section === "chat" && chatUnread > 0;
        const isDisabled = item.comingSoon;
        const linkClass = cn(
          "group relative flex items-center gap-2.5 rounded-md py-1.5 text-sm font-medium transition-colors duration-150",
          collapsed ? "justify-center px-2" : "px-2.5",
          item.isSubItem && !collapsed && "ml-6 py-1 text-xs",
          isDisabled
            ? "cursor-not-allowed opacity-50 text-stone-400 dark:text-stone-500"
            : isActive
              ? "bg-stone-100 text-stone-900 font-semibold dark:bg-[#171b1f] dark:text-[#f5f7fa]"
              : "text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-[#a8b0ba] dark:hover:bg-[#171b1f] dark:hover:text-[#f5f7fa]"
        );
        return (
          <div key={`${item.section}:${item.label}`}>
            {showGroupHeader && !collapsed && (
              <div className="mb-1.5 mt-4 first:mt-0 px-2.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400 dark:text-stone-500">
                {item.group}
              </div>
            )}
            {showGroupHeader && collapsed && (
              <div className="my-2 mx-1 border-t border-stone-200 dark:border-[#23282e]" />
            )}
            {isDisabled ? (
              <span className={linkClass} aria-disabled>
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Soon
                    </span>
                  </>
                )}
              </span>
            ) : (
              (isSkillsParent || isAgentsParent || isCronParent || isCalendarParent) && !collapsed ? (
                <div className={linkClass}>
                  <Link
                    href={item.href || `/${item.section}`}
                    onClick={onNavigate}
                    className="flex min-w-0 flex-1 items-center gap-2.5"
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
                        } else if (isAgentsParent) {
                          setAgentsExpanded((prev) => !prev);
                        } else if (isCalendarParent) {
                          setCalendarExpanded((prev) => !prev);
                        } else {
                          setCronExpanded((prev) => !prev);
                        }
                    }}
                    className="rounded-md p-0.5 text-foreground/60 transition-colors hover:text-foreground"
                    aria-label={
                      isSkillsParent
                        ? (showSkillsChildren ? "Collapse skills submenu" : "Expand skills submenu")
                        : isAgentsParent
                          ? (showAgentsChildren ? "Collapse agents submenu" : "Expand agents submenu")
                          : isCalendarParent
                            ? (showCalendarChildren ? "Collapse calendar submenu" : "Expand calendar submenu")
                            : (showCronChildren ? "Collapse cron submenu" : "Expand cron submenu")
                    }
                  >
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 shrink-0 transition-transform duration-200",
                        (isSkillsParent ? showSkillsChildren : isAgentsParent ? showAgentsChildren : isCalendarParent ? showCalendarChildren : showCronChildren) && "rotate-90"
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
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-stone-900 ring-2 ring-sidebar dark:bg-stone-100" title={`${chatUnread} unread`} aria-hidden />
                  )}
                </span>
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {!collapsed && showBadge && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-stone-900 px-1.5 text-xs font-bold text-white shadow-sm dark:bg-stone-100 dark:text-stone-900">
                      {chatUnread > 9 ? "9+" : chatUnread}
                    </span>
                  )}
                </Link>
              )
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
    const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampSidebarWidth(raw) : SIDEBAR_DEFAULT_WIDTH;
  });
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

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
  const versionLabel = process.env.NEXT_PUBLIC_APP_VERSION
    ? (process.env.NEXT_PUBLIC_APP_VERSION.startsWith("v")
        ? process.env.NEXT_PUBLIC_APP_VERSION
        : `v${process.env.NEXT_PUBLIC_APP_VERSION}`)
    : "v0";

  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  useEffect(() => {
    if (collapsed) return;
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth, collapsed]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const active = resizeStateRef.current;
      if (!active) return;
      const nextWidth = clampSidebarWidth(active.startWidth + (event.clientX - active.startX));
      setSidebarWidth(nextWidth);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };

    const handlePointerUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    resizeStateRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [collapsed, sidebarWidth]);

  const expandedWidthStyle = collapsed
    ? undefined
    : {
        width: `${sidebarWidth}px`,
        minWidth: `${sidebarWidth}px`,
      };

  return (
    <>
      {/* Mobile hamburger — visible only on small screens */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-50 flex h-9 w-9 items-center justify-center rounded-lg glass-strong text-foreground md:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — always visible on desktop, slide-in drawer on mobile */}
      <aside
        style={expandedWidthStyle}
        className={cn(
          "relative flex h-full shrink-0 flex-col transition-[width,transform] duration-200 ease-in-out",
          "border-r border-stone-200 bg-stone-50 dark:border-[#23282e] dark:bg-[#0d0f12]",
          collapsed ? "w-14 md:w-14" : "w-72 md:w-72",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-2xl",
          mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"
        )}
      >
        {/* Mobile close button */}
        <div className={cn("flex items-center pt-3 md:hidden", collapsed ? "justify-center px-2" : "justify-end px-3")}>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={cn("shrink-0", collapsed ? "px-2 pb-2" : "px-3 pb-3 pt-3")}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-base shadow-sm ring-1 ring-stone-200 dark:bg-[#171a1d] dark:ring-[#2c343d]">
                🦞
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-base shadow-sm ring-1 ring-stone-200 dark:bg-[#171a1d] dark:ring-[#2c343d]">
                  🦞
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold tracking-tight text-stone-900 dark:text-[#f5f7fa]">
                      Mission Control
                    </span>
                    <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-500 dark:bg-[#171a1d] dark:text-[#7a8591]">
                      {versionLabel}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <Suspense fallback={<div className="flex-1" />}>
          <SidebarNav onNavigate={closeMobile} collapsed={collapsed} />
        </Suspense>
        {/* Collapse / expand toggle — desktop only */}
        <div className={cn("hidden border-t border-stone-200 dark:border-[#23282e] md:block", collapsed ? "px-2 py-2" : "px-3 py-2")}>
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              "flex w-full items-center rounded-md py-1.5 text-stone-400 transition-colors duration-150 hover:bg-stone-100 hover:text-stone-700 dark:text-[#7a8591] dark:hover:bg-[#171b1f] dark:hover:text-[#d6dce3]",
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
        {!collapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={startResize}
            className="absolute inset-y-0 right-0 hidden w-2 -translate-x-1/2 cursor-col-resize md:block"
          >
            <div className="mx-auto h-full w-px bg-transparent transition-colors hover:bg-stone-300 dark:hover:bg-[#3d4752]" />
          </div>
        )}
      </aside>
    </>
  );
}

export { Sidebar as AppSidebar };
