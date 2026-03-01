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
import { SectionLayout } from "@/components/section-layout";

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
  const cleanupRef = useRef<(() => void) | null>(null);
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || initRef.current) return;
    initRef.current = true;

    let disposed = false;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        disableStdin: false,
        fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
        lineHeight: 1.35,
        letterSpacing: 0,
        theme: {
          background: "#0c0c0c",
          foreground: "#d4d4d8",
          cursor: "#c87941",
          cursorAccent: "#0c0c0c",
          selectionBackground: "#c8794140",
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
        convertEol: true,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(containerRef.current);

      termRef.current = term;
      fitRef.current = fitAddon;

      // Fit after DOM settles
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch { /* */ }
        term.focus();
      });

      // Focus on click
      const clickHandler = () => term.focus();
      containerRef.current.addEventListener("click", clickHandler);

      // ── Send keystrokes to backend ──
      let inputBuffer = "";

      const flushInput = () => {
        if (!inputBuffer) return;
        const raw = inputBuffer;
        inputBuffer = "";
        fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "input", session: sessionId, data: raw }),
        }).catch(() => {});
      };

      term.onData((data: string) => {
        inputBuffer += data;
        if (data === "\r" || data === "\x03" || data === "\x04" || data.length > 1) {
          if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
          inputTimerRef.current = null;
          flushInput();
        } else {
          if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
          inputTimerRef.current = setTimeout(flushInput, 5);
        }
      });

      // ── Connect SSE for output ──
      const abortController = new AbortController();

      try {
        const res = await fetch(
          `/api/terminal?action=stream&session=${sessionId}`,
          { signal: abortController.signal },
        );
        if (!res.ok || !res.body) {
          term.writeln("\r\n\x1b[31m[Failed to connect terminal stream]\x1b[0m");
          onDied();
          return;
        }
        const reader = res.body.getReader();
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
              if (line.startsWith(":")) continue; // SSE comment (heartbeat)
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

        pump().catch(() => { /* connection closed */ });
      } catch {
        // Aborted or failed
      }

      // ── Resize observer with debounce ──
      const sendResize = () => {
        fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "resize",
            session: sessionId,
            cols: term.cols,
            rows: term.rows,
          }),
        }).catch(() => {});
      };

      const observer = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch { return; }
        // Debounce resize API calls
        if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(sendResize, 100);
      });
      observer.observe(containerRef.current);

      cleanupRef.current = () => {
        disposed = true;
        observer.disconnect();
        abortController.abort();
        if (inputTimerRef.current) {
          clearTimeout(inputTimerRef.current);
          inputTimerRef.current = null;
        }
        if (resizeTimerRef.current) {
          clearTimeout(resizeTimerRef.current);
          resizeTimerRef.current = null;
        }
        containerRef.current?.removeEventListener("click", clickHandler);
        term.dispose();
      };
    })();

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (inputTimerRef.current) {
        clearTimeout(inputTimerRef.current);
        inputTimerRef.current = null;
      }
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
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
        "absolute inset-0 bg-[#0c0c0c] p-1",
        visible ? "block" : "hidden",
      )}
    />
  );
}

/* ── Main TerminalView ── */

export function TerminalView() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const createdInitialRef = useRef(false);
  const tabCounterRef = useRef(1);

  const createTab = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", cols: 80, rows: 24 }),
      });
      const data = await res.json();
      if (data.ok && data.session) {
        const newTab: TabInfo = {
          id: data.session,
          label: `Terminal ${tabCounterRef.current++}`,
          alive: true,
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveTab(data.session);
      }
    } catch {
      // ignore
    }
    setCreating(false);
  }, []);

  // Create first session on mount
  useEffect(() => {
    if (createdInitialRef.current) return;
    createdInitialRef.current = true;
    const timer = setTimeout(() => { void createTab(); }, 0);
    return () => clearTimeout(timer);
  }, [createTab]);

  const closeTab = useCallback(
    async (id: string) => {
      fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", session: id }),
      }).catch(() => {});

      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeTab === id && next.length > 0) {
          setActiveTab(next[next.length - 1].id);
        } else if (next.length === 0) {
          setActiveTab("");
        }
        return next;
      });
    },
    [activeTab],
  );

  const clearTerminal = useCallback(() => {
    if (!activeTab) return;
    fetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "input", session: activeTab, data: "clear\r" }),
    }).catch(() => {});
  }, [activeTab]);

  return (
    <SectionLayout
      className={cn(fullscreen && "fixed inset-0 z-50 bg-background")}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border bg-card/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-5 w-5 text-[var(--accent-brand-text)]" />
          <h2 className="text-xs font-semibold">Terminal</h2>
          <span className="text-xs text-muted-foreground rounded-full bg-muted px-2 py-0.5">
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
              "group flex items-center gap-1.5 border-r border-zinc-800 px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors",
              activeTab === tab.id
                ? "bg-zinc-900 text-zinc-200"
                : "bg-[#0c0c0c] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900",
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
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
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
              <TerminalIcon className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground/60 mb-3">No active terminals</p>
              <button
                type="button"
                onClick={createTab}
                disabled={creating}
                className="rounded-xl bg-primary px-5 py-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
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
                  t.id === tab.id ? { ...t, alive: false } : t,
                ),
              )
            }
          />
        ))}
      </div>
    </SectionLayout>
  );
}
