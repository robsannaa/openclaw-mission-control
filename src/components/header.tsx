"use client";

import {
  Suspense,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Pause,
  Play,
  Zap,
  Send,
  ChevronDown,
  Check,
  AlertTriangle,
  Loader2,
  X,
  Wifi,
  WifiOff,
  Activity,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SearchModal } from "./search-modal";
import { PairingNotifications } from "./pairing-notifications";
import { ThemeToggle } from "./theme-toggle";
import { chatStore, type ChatMessage } from "@/lib/chat-store";
import {
  notifyGatewayRestarting as notifyGatewayRestartingStore,
  useGatewayStatusStore,
  type GatewayHealth,
  type GatewayStatus,
} from "@/lib/gateway-status-store";

/* ── Types ──────────────────────────────────────── */

type AgentInfo = {
  id: string;
  name: string;
  model: string;
};

/* ── Agent Chat Panel (persistent, global state) ── */

function useChatState() {
  return useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getSnapshot);
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-md rounded-2xl rounded-tr-sm bg-violet-600/90 px-3.5 py-2 text-xs leading-relaxed text-white shadow-sm">
          <p className="whitespace-pre-wrap break-words">{msg.text}</p>
          <p className="mt-1 text-right text-xs text-white/40">{formatTime(msg.timestamp)}</p>
        </div>
      </div>
    );
  }
  if (msg.role === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-md rounded-2xl rounded-tl-sm border border-red-500/20 bg-red-500/10 px-3.5 py-2 text-xs leading-relaxed text-red-300 shadow-sm">
          <div className="mb-1 flex items-center gap-1 text-xs font-medium text-red-400">
            <AlertTriangle className="h-3 w-3" />Error
          </div>
          <p className="whitespace-pre-wrap break-words">{msg.text}</p>
          <p className="mt-1 text-xs text-red-400/40">{formatTime(msg.timestamp)}</p>
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="flex justify-start">
      <div className="max-w-md rounded-2xl rounded-tl-sm border border-foreground/10 bg-foreground/5 px-3.5 py-2 text-xs leading-relaxed text-foreground/80 shadow-sm">
        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        <p className="mt-1 text-xs text-muted-foreground/30">{formatTime(msg.timestamp)}</p>
      </div>
    </div>
  );
}

export function AgentChatPanel() {
  const chat = useChatState();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [prompt, setPrompt] = useState("");
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Mount a dedicated portal root as the last child of body so the panel is always viewport-fixed
  useEffect(() => {
    const el = document.createElement("div");
    el.id = "agent-chat-portal-root";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    setPortalRoot(el);
    return () => {
      if (document.body.contains(el)) document.body.removeChild(el);
    };
  }, []);

  // Fetch agents once
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        const list = (data.agents || data || []) as AgentInfo[];
        setAgents(list);
        if (list.length > 0 && !chat.agentId) {
          chatStore.setAgent(list[0].id);
        }
      })
      .catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Request notification permission on first open
  useEffect(() => {
    if (chat.open) {
      chatStore.requestNotificationPermission();
    }
  }, [chat.open]);

  // Focus input when panel opens
  useEffect(() => {
    if (chat.open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [chat.open]);

  // Scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.open]);

  // Close on Escape
  useEffect(() => {
    if (!chat.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") chatStore.close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [chat.open]);

  // Close on click outside
  useEffect(() => {
    if (!chat.open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Don't close if clicking the Ping Agent button (it has its own toggle)
        const target = e.target as HTMLElement;
        if (target.closest("[data-chat-toggle]")) return;
        chatStore.close();
      }
    };
    // Use setTimeout to avoid closing immediately on the same click that opened it
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", handler); };
  }, [chat.open]);

  const handleSend = useCallback(() => {
    if (!prompt.trim() || chat.sending) return;
    chatStore.send(prompt.trim());
    setPrompt("");
  }, [prompt, chat.sending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const currentAgent = agents.find((a) => a.id === chat.agentId);

  if (!chat.open || !portalRoot) return null;

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Agent Chat"
      style={{
        position: "fixed",
        right: 16,
        top: 56,
        zIndex: 99999,
      }}
      className="flex max-h-screen w-full max-w-md flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-card/95 shadow-2xl backdrop-blur-md animate-in slide-in-from-top-2 fade-in duration-200"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15">
            <MessageSquare className="h-3.5 w-3.5 text-violet-400" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground/80">Agent Chat</p>
            <p className="text-xs text-muted-foreground/50">
              {chat.messages.length} messages
              {chat.sending && " · typing..."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {chat.messages.length > 0 && (
            <button
              type="button"
              onClick={() => chatStore.clearMessages()}
              className="rounded-md p-1.5 text-muted-foreground/40 transition hover:bg-muted/60 hover:text-muted-foreground"
              title="Clear chat"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => chatStore.close()}
            className="rounded-md p-1.5 text-muted-foreground/40 transition hover:bg-muted/60 hover:text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Agent selector */}
      <div className="shrink-0 border-b border-foreground/10 px-4 py-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowAgentPicker(!showAgentPicker)}
            className="flex w-full items-center gap-2 rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-1.5 text-left transition-colors hover:bg-foreground/5"
          >
            <span className="text-xs text-muted-foreground">Agent:</span>
            <span className="flex-1 truncate text-xs font-medium text-foreground/70">
              {currentAgent?.name || currentAgent?.id || "Select agent..."}
            </span>
            {currentAgent?.model && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground/60">
                {currentAgent.model.split("/").pop()}
              </span>
            )}
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          </button>

          {showAgentPicker && agents.length > 0 && (
            <div className="absolute left-0 top-full z-10 mt-1 w-full overflow-hidden rounded-lg border border-foreground/10 bg-card py-1 shadow-lg">
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    chatStore.setAgent(a.id);
                    setShowAgentPicker(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-violet-500/10",
                    a.id === chat.agentId && "bg-violet-500/5"
                  )}
                >
                  <span className="text-xs font-medium text-foreground/70">
                    {a.name || a.id}
                  </span>
                  {a.model && (
                    <span className="ml-auto text-xs text-muted-foreground/60">
                      {a.model.split("/").pop()}
                    </span>
                  )}
                  {a.id === chat.agentId && (
                    <Check className="h-3 w-3 shrink-0 text-violet-400" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {chat.messages.length === 0 && !chat.sending && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10">
              <Zap className="h-6 w-6 text-violet-400/60" />
            </div>
            <p className="text-sm font-medium text-foreground/50">Send a message</p>
            <p className="max-w-xs text-xs text-muted-foreground/40">
              Chat with your agents. History is kept while the app is open.
            </p>
          </div>
        )}
        {chat.messages.map((msg) => (
          <ChatBubble key={msg.id} msg={msg} />
        ))}
        {chat.sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-foreground/10 bg-foreground/5 px-3.5 py-2.5 shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
              <span className="text-xs text-muted-foreground/60">Agent is thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-foreground/10 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message your agent..."
            rows={1}
            disabled={chat.sending || !chat.agentId}
            className="flex-1 resize-none rounded-xl border border-foreground/10 bg-foreground/5 px-3.5 py-2 text-xs text-foreground/90 placeholder:text-muted-foreground/40 focus:border-violet-500/30 focus:outline-none disabled:opacity-50"
            style={{ maxHeight: "80px" }}
            onInput={(e) => {
              const ta = e.target as HTMLTextAreaElement;
              ta.style.height = "auto";
              ta.style.height = Math.min(ta.scrollHeight, 80) + "px";
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!prompt.trim() || !chat.agentId || chat.sending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
          >
            {chat.sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground/30">
          Enter to send · Shift+Enter for newline · Esc to close
        </p>
      </div>
    </div>
  );

  return createPortal(panel, portalRoot);
}

/* ── Pause/Resume Gateway ───────────────────────── */

function usePauseState() {
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(async () => {
    setBusy(true);
    // Immediately notify the status badge to switch to "loading" and fast-poll
    notifyGatewayRestarting();
    try {
      if (paused) {
        await fetch("/api/gateway", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restart" }),
        });
      } else {
        await fetch("/api/gateway", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop" }),
        });
      }
      setPaused(!paused);
    } catch {
      // ignore
    }
    setBusy(false);
  }, [paused]);

  return { paused, busy, toggle };
}

/* ── Gateway Status Hook ───────────────────────── */

/**
 * Dispatch this event from anywhere (e.g. restart-announcement-bar)
 * to tell the status poller to immediately re-check and enter fast-poll mode.
 */
export function notifyGatewayRestarting() {
  notifyGatewayRestartingStore();
}

function useGatewayStatus() {
  const { status, health } = useGatewayStatusStore();
  return { status, health };
}

/* ── Gateway Status Badge ──────────────────────── */

function GatewayStatusBadge({
  status,
  health,
}: {
  status: GatewayStatus;
  health: GatewayHealth | null;
}) {
  const [showPopover, setShowPopover] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    setShowPopover(true);
  }, []);

  const handleLeave = useCallback(() => {
    hideTimeout.current = setTimeout(() => setShowPopover(false), 200);
  }, []);

  // Extract useful details from health
  const details = useMemo(() => {
    if (!health) return null;
    const gw = health.gateway as Record<string, unknown> | undefined;
    const rawChannels = health.channels;
    const rawAgents = health.agents;
    const version = (gw?.version as string) || null;
    const mode = (gw?.mode as string) || null;
    const port = (gw?.port as number) || 18789;
    const uptime = gw?.uptimeMs as number | undefined;

    // channels/agents may be arrays, objects, or missing — handle all cases
    const channelsArr = Array.isArray(rawChannels) ? rawChannels : [];
    const agentsArr = Array.isArray(rawAgents)
      ? rawAgents
      : rawAgents && typeof rawAgents === "object"
        ? Object.values(rawAgents)
        : [];

    const channelCount = channelsArr.length;
    const activeChannels = channelsArr.filter(
      (c: Record<string, unknown>) => c.connected || c.enabled
    ).length;
    const agentCount = agentsArr.length;

    let uptimeStr: string | null = null;
    if (uptime && uptime > 0) {
      const hours = Math.floor(uptime / 3_600_000);
      const mins = Math.floor((uptime % 3_600_000) / 60_000);
      uptimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }

    return { version, mode, port, uptimeStr, channelCount, activeChannels, agentCount };
  }, [health]);

  const statusConfig = {
    online: {
      dot: "bg-emerald-400",
      ping: true,
      text: "text-emerald-500 dark:text-emerald-400",
      label: "Online",
      bg: "bg-emerald-500/10 border-emerald-500/20",
      icon: Wifi,
    },
    degraded: {
      dot: "bg-amber-400",
      ping: false,
      text: "text-amber-500 dark:text-amber-400",
      label: "Degraded",
      bg: "bg-amber-500/10 border-amber-500/20",
      icon: Activity,
    },
    offline: {
      dot: "bg-red-400",
      ping: false,
      text: "text-red-500 dark:text-red-400",
      label: "Offline",
      bg: "bg-red-500/10 border-red-500/20",
      icon: WifiOff,
    },
    loading: {
      dot: "bg-zinc-400 animate-pulse",
      ping: false,
      text: "text-muted-foreground",
      label: "Checking…",
      bg: "bg-foreground/5 border-foreground/10",
      icon: Loader2,
    },
  };

  const cfg = statusConfig[status];
  const Icon = cfg.icon;

  return (
    <div
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div
        className={cn(
          "flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors",
          cfg.bg
        )}
      >
        {/* Dot */}
        <span className="relative flex h-2 w-2">
          {cfg.ping && (
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-50",
                cfg.dot
              )}
            />
          )}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              cfg.dot
            )}
          />
        </span>
        {/* Label */}
        <span className={cn("text-xs font-medium", cfg.text)}>
          {cfg.label}
        </span>
      </div>

      {/* Popover */}
      {showPopover && (
        <div className="absolute z-50 left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-foreground/10 bg-card/95 shadow-2xl backdrop-blur-sm">
          {/* Header */}
          <div className={cn("flex items-center gap-2.5 px-3.5 py-3 border-b border-foreground/10", cfg.bg)}>
            <Icon className={cn("h-3.5 w-3.5", cfg.text, status === "loading" && "animate-spin")} />
            <div>
              <p className={cn("text-xs font-semibold", cfg.text)}>
                Gateway {cfg.label}
              </p>
              <p className="text-xs text-muted-foreground">
                {status === "offline"
                  ? "Cannot reach gateway process"
                  : status === "degraded"
                    ? "Some services may be unavailable"
                    : status === "loading"
                      ? "Checking gateway health…"
                      : "All systems operational"}
              </p>
            </div>
          </div>

          {/* Details */}
          {details && status !== "loading" && (
            <div className="space-y-0 divide-y divide-foreground/5 px-3.5 py-1">
              {details.uptimeStr && (
                <DetailRow label="Uptime" value={details.uptimeStr} />
              )}
              {details.version && (
                <DetailRow label="Version" value={details.version} />
              )}
              <DetailRow label="Port" value={String(details.port)} />
              {details.mode && (
                <DetailRow label="Mode" value={details.mode} />
              )}
              {details.agentCount > 0 && (
                <DetailRow
                  label="Agents"
                  value={`${details.agentCount} configured`}
                />
              )}
              {details.channelCount > 0 && (
                <DetailRow
                  label="Channels"
                  value={`${details.activeChannels} / ${details.channelCount} active`}
                />
              )}
            </div>
          )}

          {/* Error info */}
          {!!health?.error && (
            <div className="border-t border-foreground/10 px-3.5 py-2.5">
              <p className="text-xs leading-relaxed text-red-400">
                {String(health.error)}
              </p>
            </div>
          )}

          {/* Footer hint */}
          <div className="border-t border-foreground/10 px-3.5 py-2">
            <p className="text-xs text-muted-foreground/50">
              Polling every 12s · Click Pause above to stop gateway
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground/60">{label}</span>
      <span className="text-xs font-medium text-foreground/70">{value}</span>
    </div>
  );
}

/* ── Header ─────────────────────────────────────── */

export function Header() {
  const [searchOpen, setSearchOpen] = useState(false);
  const chat = useChatState();
  const { paused, busy: pauseBusy, toggle: togglePause } = usePauseState();
  const { status: gwStatus, health: gwHealth } = useGatewayStatus();

  // Global Cmd+K / Ctrl+K shortcut
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setSearchOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-sidebar/80 px-3 md:px-5 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 pl-10 md:pl-0">
          <span className="text-xs">🦞</span>
          <h1 className="text-sm font-semibold text-foreground">
            Mission Control
          </h1>
          <GatewayStatusBadge status={gwStatus} health={gwHealth} />
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          {/* ── Actions ── */}

          {/* Ping Agent (opens persistent chat panel) */}
          <button
            type="button"
            data-chat-toggle
            onClick={() => chatStore.toggle()}
            className={cn(
              "relative flex h-8 items-center gap-1.5 rounded-lg border px-2 md:px-3 text-xs transition-colors",
              chat.open
                ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                : "border-foreground/10 bg-card text-muted-foreground hover:bg-muted/80"
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Ping Agent</span>
            {chat.unread > 0 && !chat.open && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-xs font-bold text-white shadow-lg">
                {chat.unread}
              </span>
            )}
            {chat.sending && !chat.open && (
              <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
            )}
          </button>

          {/* Search */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-8 items-center gap-2 rounded-lg border border-foreground/10 bg-card px-2 md:px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground/70"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="ml-1 hidden rounded border border-foreground/10 bg-muted/70 px-1.5 py-0.5 text-xs text-muted-foreground sm:inline">
              ⌘K
            </kbd>
          </button>

          {/* ── divider ── */}
          <div className="hidden h-5 w-px bg-foreground/10 sm:block" />

          {/* ── System controls ── */}

          {/* Pause / Resume */}
          <button
            type="button"
            onClick={togglePause}
            disabled={pauseBusy}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border px-2 md:px-3 text-xs transition-colors disabled:opacity-50",
              paused
                ? "border-amber-500/20 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                : "border-foreground/10 bg-card text-muted-foreground hover:bg-muted/80"
            )}
          >
            {paused ? (
              <Play className="h-3.5 w-3.5" />
            ) : (
              <Pause className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{paused ? "Resume" : "Pause"}</span>
          </button>

          {/* Pairing Notifications */}
          <PairingNotifications />

          {/* ── divider ── */}
          <div className="hidden h-5 w-px bg-foreground/10 sm:block" />

          {/* ── Settings ── */}

          {/* Theme Toggle */}
          <ThemeToggle />
        </div>
      </header>

      <Suspense fallback={null}>
        <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      </Suspense>
    </>
  );
}
