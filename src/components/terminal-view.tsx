"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  Terminal as TerminalIcon,
  Plus,
  X,
  Maximize2,
  Minimize2,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ── */

type TabInfo = {
  id: string;
  label: string;
  alive: boolean;
};

/* ── TerminalPane: single xterm.js instance connected to a backend session ── */

function TerminalPane({
  sessionId,
  visible,
  onDied,
}: {
  sessionId: string;
  visible: boolean;
  onDied: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<unknown>(null);
  const fitRef = useRef<unknown>(null);
  const sseRef = useRef<AbortController | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || initRef.current) return;
    initRef.current = true;

    let disposed = false;

    (async () => {
      // Dynamic import to avoid SSR issues
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
        lineHeight: 1.35,
        letterSpacing: 0,
        theme: {
          background: "#0c0c0c",
          foreground: "#d4d4d8",
          cursor: "#a78bfa",
          cursorAccent: "#0c0c0c",
          selectionBackground: "#7c3aed40",
          selectionForeground: "#ffffff",
          black: "#09090b",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#d4d4d8",
          brightBlack: "#52525b",
          brightRed: "#f87171",
          brightGreen: "#4ade80",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
          brightWhite: "#fafafa",
        },
        scrollback: 10000,
        convertEol: false,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(containerRef.current);

      // Fit and focus after DOM is ready
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch { /* */ }
        term.focus();
      });

      // Also focus on click anywhere in the container
      containerRef.current.addEventListener("click", () => term.focus());

      termRef.current = term;
      fitRef.current = fitAddon;

      // ── Connect SSE for output ──
      const abortController = new AbortController();
      sseRef.current = abortController;

      try {
        const res = await fetch(
          `/api/terminal?action=stream&session=${sessionId}`,
          { signal: abortController.signal }
        );
        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let partial = "";

        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            partial += decoder.decode(value, { stream: true });
            const lines = partial.split("\n");
            partial = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const msg = JSON.parse(line.slice(6));
                if (msg.type === "output") {
                  term.write(msg.text);
                } else if (msg.type === "status" && !msg.alive) {
                  onDied();
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        };

        pump().catch(() => {
          // Connection closed
        });
      } catch {
        // Aborted or failed
      }

      // ── Send keystrokes to backend ──
      let inputBuffer = "";
      let inputTimer: ReturnType<typeof setTimeout> | null = null;

      const flushInput = () => {
        if (!inputBuffer) return;
        const data = inputBuffer;
        inputBuffer = "";
        fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "input", session: sessionId, data }),
        }).catch(() => {});
      };

      term.onData((data: string) => {
        inputBuffer += data;
        // Flush immediately for Enter, Ctrl+C, etc. or batch with tiny delay
        if (data === "\r" || data === "\x03" || data === "\x04" || data.length > 1) {
          if (inputTimer) clearTimeout(inputTimer);
          inputTimer = null;
          flushInput();
        } else {
          if (inputTimer) clearTimeout(inputTimer);
          inputTimer = setTimeout(flushInput, 5);
        }
      });

      // ── Resize observer ──
      const observer = new ResizeObserver(() => {
        try { fitAddon.fit(); } catch { /* */ }
      });
      observer.observe(containerRef.current);

      // Store cleanup
      const cleanup = () => {
        disposed = true;
        observer.disconnect();
        abortController.abort();
        term.dispose();
      };
      (containerRef.current as unknown as Record<string, unknown>).__cleanup = cleanup;
    })();

    return () => {
      const el = containerRef.current as unknown as Record<string, unknown> | null;
      if (el?.__cleanup && typeof el.__cleanup === "function") {
        el.__cleanup();
      }
      sseRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Re-fit and re-focus when visibility changes
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        if (fitRef.current) {
          const f = fitRef.current as { fit: () => void };
          try { f.fit(); } catch { /* */ }
        }
        if (termRef.current) {
          const t = termRef.current as { focus: () => void };
          try { t.focus(); } catch { /* */ }
        }
      });
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute inset-0",
        visible ? "block" : "hidden"
      )}
      style={{ backgroundColor: "#0c0c0c", padding: "4px" }}
    />
  );
}

/* ── Main TerminalView ── */

export function TerminalView() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Create first session on mount
  useEffect(() => {
    createTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createTab = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      const data = await res.json();
      if (data.ok && data.session) {
        const newTab: TabInfo = {
          id: data.session,
          label: `Terminal ${tabs.length + 1}`,
          alive: true,
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveTab(data.session);
      }
    } catch {
      // ignore
    }
    setCreating(false);
  }, [tabs.length]);

  const closeTab = useCallback(
    async (id: string) => {
      // Kill session
      fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", session: id }),
      }).catch(() => {});

      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeTab === id && next.length > 0) {
          setActiveTab(next[next.length - 1].id);
        }
        return next;
      });
    },
    [activeTab]
  );

  const clearTerminal = useCallback(() => {
    // Send clear command
    if (!activeTab) return;
    fetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "input",
        session: activeTab,
        data: "clear\r",
      }),
    }).catch(() => {});
  }, [activeTab]);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden",
        fullscreen
          ? "fixed inset-0 z-50 bg-background"
          : "flex-1"
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border bg-card/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-5 w-5 text-violet-500" />
          <h2 className="text-sm font-semibold">Terminal</h2>
          <span className="text-[10px] text-muted-foreground rounded-full bg-muted px-2 py-0.5">
            {tabs.length} session{tabs.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={clearTerminal}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Clear terminal"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setFullscreen(!fullscreen)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex items-center gap-0 border-b border-border bg-[#0c0c0c] overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "group flex items-center gap-1.5 border-r border-zinc-800 px-3 py-1.5 text-[12px] font-medium cursor-pointer transition-colors",
              activeTab === tab.id
                ? "bg-[#1a1a1a] text-zinc-200"
                : "bg-[#0c0c0c] text-zinc-500 hover:text-zinc-300 hover:bg-[#151515]"
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            <TerminalIcon className="h-3 w-3 shrink-0" />
            <span className="whitespace-nowrap">{tab.label}</span>
            {!tab.alive && (
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" title="Session ended" />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="ml-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-700"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={createTab}
          disabled={creating}
          className="flex items-center gap-1 px-3 py-1.5 text-[12px] text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
          title="New terminal"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* ── Terminal panes ── */}
      <div className="flex-1 min-h-0 relative bg-[#0c0c0c]">
        {tabs.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <TerminalIcon className="mx-auto h-10 w-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500 mb-3">No active terminals</p>
              <button
                type="button"
                onClick={createTab}
                disabled={creating}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Open Terminal"}
              </button>
            </div>
          </div>
        )}

        {tabs.map((tab) => (
          <TerminalPane
            key={tab.id}
            sessionId={tab.id}
            visible={activeTab === tab.id}
            onDied={() =>
              setTabs((prev) =>
                prev.map((t) =>
                  t.id === tab.id ? { ...t, alive: false } : t
                )
              )
            }
          />
        ))}
      </div>
    </div>
  );
}
