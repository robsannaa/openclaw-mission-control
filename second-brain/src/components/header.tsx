"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SearchModal } from "./search-modal";
import { PairingNotifications } from "./pairing-notifications";
import { ThemeToggle } from "./theme-toggle";

/* ── Types ──────────────────────────────────────── */

type AgentInfo = {
  id: string;
  name: string;
  model: string;
};

type CommandState = "idle" | "sending" | "success" | "error";

/* ── Quick Command Popover ──────────────────────── */

function QuickCommandPopover({ onClose }: { onClose: () => void }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<CommandState>("idle");
  const [response, setResponse] = useState("");
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fetch agents
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        const list = (data.agents || data || []) as AgentInfo[];
        setAgents(list);
        if (list.length > 0) setSelectedAgent(list[0].id);
      })
      .catch(() => {});
  }, []);

  // Focus input on open
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const send = useCallback(async () => {
    if (!prompt.trim() || !selectedAgent || state === "sending") return;
    setState("sending");
    setResponse("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: selectedAgent,
          messages: [
            {
              role: "user",
              id: crypto.randomUUID(),
              parts: [{ type: "text", text: prompt.trim() }],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      setResponse(text.slice(0, 500) + (text.length > 500 ? "…" : ""));
      setState("success");
    } catch (err) {
      setResponse(String(err));
      setState("error");
    }
  }, [prompt, selectedAgent, state]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  const currentAgent = agents.find((a) => a.id === selectedAgent);

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full z-50 mt-2 w-[420px] overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-900/95 shadow-2xl backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-[12px] font-medium text-zinc-300">
            Quick Command
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-zinc-600 transition-colors hover:text-zinc-400"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Agent selector */}
      <div className="border-b border-white/[0.06] px-3 py-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowAgentPicker(!showAgentPicker)}
            className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
          >
            <span className="text-[11px] text-zinc-500">Agent:</span>
            <span className="flex-1 truncate text-[12px] font-medium text-zinc-300">
              {currentAgent?.name || currentAgent?.id || "Select agent..."}
            </span>
            {currentAgent?.model && (
              <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-600">
                {currentAgent.model.split("/").pop()}
              </span>
            )}
            <ChevronDown className="h-3 w-3 shrink-0 text-zinc-600" />
          </button>

          {showAgentPicker && agents.length > 0 && (
            <div className="absolute left-0 top-full z-10 mt-1 w-full overflow-hidden rounded-lg border border-white/[0.08] bg-zinc-900/98 py-1 shadow-lg">
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSelectedAgent(a.id);
                    setShowAgentPicker(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-violet-500/10",
                    a.id === selectedAgent && "bg-violet-500/5"
                  )}
                >
                  <span className="text-[12px] font-medium text-zinc-300">
                    {a.name || a.id}
                  </span>
                  {a.model && (
                    <span className="ml-auto text-[10px] text-zinc-600">
                      {a.model.split("/").pop()}
                    </span>
                  )}
                  {a.id === selectedAgent && (
                    <Check className="h-3 w-3 shrink-0 text-violet-400" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="px-3 py-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a quick command for the agent..."
            rows={2}
            disabled={state === "sending"}
            className="flex-1 resize-none rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/30 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={send}
            disabled={!prompt.trim() || !selectedAgent || state === "sending"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
          >
            {state === "sending" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-zinc-700">
            Enter to send · Shift+Enter for newline
          </span>
          {state === "sending" && (
            <span className="flex items-center gap-1 text-[10px] text-violet-400">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Agent thinking...
            </span>
          )}
        </div>
      </div>

      {/* Response */}
      {(state === "success" || state === "error") && response && (
        <div
          className={cn(
            "border-t border-white/[0.06] px-3 py-2",
            state === "error" && "bg-red-500/[0.03]"
          )}
        >
          <div className="mb-1 flex items-center gap-1">
            {state === "success" ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-3 w-3 text-red-400" />
            )}
            <span
              className={cn(
                "text-[10px] font-medium",
                state === "success" ? "text-emerald-400" : "text-red-400"
              )}
            >
              {state === "success" ? "Agent responded" : "Error"}
            </span>
          </div>
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">
            {response}
          </p>
          {state === "success" && (
            <button
              type="button"
              onClick={() => {
                setPrompt("");
                setResponse("");
                setState("idle");
                inputRef.current?.focus();
              }}
              className="mt-1.5 text-[10px] text-violet-400 transition-colors hover:text-violet-300"
            >
              Send another →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Pause/Resume Gateway ───────────────────────── */

function usePauseState() {
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(async () => {
    setBusy(true);
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

/* ── Header ─────────────────────────────────────── */

export function Header() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const { paused, busy: pauseBusy, toggle: togglePause } = usePauseState();

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
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-sidebar/80 px-5 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🦞</span>
          <h1 className="text-sm font-semibold text-zinc-100">
            Mission Control
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-zinc-900/60 px-3 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search</span>
            <kbd className="ml-1 rounded border border-white/[0.08] bg-zinc-800/50 px-1.5 py-0.5 text-[10px] text-zinc-500">
              ⌘K
            </kbd>
          </button>

          {/* Pause / Resume */}
          <button
            type="button"
            onClick={togglePause}
            disabled={pauseBusy}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors disabled:opacity-50",
              paused
                ? "border-amber-500/20 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                : "border-white/[0.08] bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60"
            )}
          >
            {paused ? (
              <Play className="h-3.5 w-3.5" />
            ) : (
              <Pause className="h-3.5 w-3.5" />
            )}
            <span>{paused ? "Resume" : "Pause"}</span>
          </button>

          {/* Pairing Notifications */}
          <PairingNotifications />

          {/* Quick Command */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setCmdOpen(!cmdOpen)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors",
                cmdOpen
                  ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                  : "border-white/[0.08] bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60"
              )}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Quick Command</span>
            </button>

            {cmdOpen && (
              <QuickCommandPopover onClose={() => setCmdOpen(false)} />
            )}
          </div>

          {/* Theme Toggle */}
          <ThemeToggle />
        </div>
      </header>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
