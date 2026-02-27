"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { requestRestart } from "@/lib/restart-store";
import {
  CheckCircle, XCircle, Search, RefreshCw,
  AlertTriangle, X, Check, Download,
  Settings2, Package, Cpu,
  FileText, Terminal, Globe, Wrench, ArrowLeft,
  Info, CircleStop, Play, Copy, Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import { ApiWarningBadge } from "@/components/ui/api-warning-badge";

/* ── Types ──────────────────────────────────────── */

type Missing = { bins: string[]; anyBins: string[]; env: string[]; config: string[]; os: string[] };
type InstallOption = { id: string; kind: string; label: string; bins?: string[] };

type Skill = {
  name: string; description: string; emoji: string; eligible: boolean;
  disabled: boolean; blockedByAllowlist: boolean; source: string;
  bundled: boolean; homepage?: string; missing: Missing;
  always?: boolean;
};

type ClawHubItem = {
  slug: string;
  displayName?: string;
  summary?: string;
  version?: string;
  /** Catalog latest version (for "installed" view); in "all" view, version is the catalog latest */
  latestVersion?: string;
  score?: number;
  developer?: string;
  downloads?: number;
  installsCurrent?: number;
  stars?: number;
  updatedAt?: number;
};

type SkillDetail = Skill & {
  filePath: string; baseDir: string; skillKey: string; always: boolean;
  requirements: Missing; install: InstallOption[];
  configChecks: unknown[]; skillMd?: string | null;
  skillConfig?: Record<string, unknown> | null;
};

type Summary = { total: number; eligible: number; disabled: number; blocked: number; missingRequirements: number };
type Toast = { msg: string; type: "success" | "error" };
type AvailabilityState = "ready" | "needs-setup" | "blocked" | "unavailable";
type SkillOrigin = "bundled" | "workspace" | "shared" | "other";
type SkillsFilter = "all" | "eligible" | "unavailable" | "bundled" | "workspace";
type AgentOption = { id: string; name: string };
type SkillTestResult = {
  ok: boolean;
  skillName: string;
  agentId: string;
  message: string;
  cliCommand: string;
  output: string;
  durationMs: number;
};

const SKILL_ORIGIN_META: Record<SkillOrigin, { title: string; description: string }> = {
  bundled: {
    title: "Bundled Skills",
    description: "Built into your OpenClaw install. Toggle controls policy only; runtime still depends on requirements.",
  },
  workspace: {
    title: "Workspace Skills",
    description: "Installed for this workspace (typically via ClawHub).",
  },
  shared: {
    title: "Shared Local Skills",
    description: "Loaded from local shared skill directories (for example ~/.openclaw/skills).",
  },
  other: {
    title: "Other Sources",
    description: "Custom or external skill sources.",
  },
};

const SKILL_ORIGIN_ORDER: SkillOrigin[] = ["bundled", "workspace", "shared", "other"];

/* ── Helpers ────────────────────────────────────── */

function hasMissing(m: Missing): boolean {
  return m.bins.length > 0 || m.anyBins.length > 0 || m.env.length > 0 || m.config.length > 0 || m.os.length > 0;
}

function missingCount(m: Missing): number {
  return m.bins.length + m.anyBins.length + m.env.length + m.config.length + m.os.length;
}

function getAvailability(skill: Pick<Skill, "eligible" | "missing" | "blockedByAllowlist">): {
  state: AvailabilityState;
  label: string;
  badgeClass: string;
} {
  if (skill.blockedByAllowlist) {
    return {
      state: "blocked",
      label: "Blocked",
      badgeClass: "border-red-500/30 bg-red-500/10 text-red-300",
    };
  }
  if (skill.eligible) {
    return {
      state: "ready",
      label: "Ready",
      badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    };
  }
  if (hasMissing(skill.missing)) {
    return {
      state: "needs-setup",
      label: "Needs setup",
      badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    };
  }
  return {
    state: "unavailable",
    label: "Unavailable",
    badgeClass: "border-zinc-500/30 bg-zinc-500/10 text-muted-foreground",
  };
}

function getSkillOrigin(skill: Pick<Skill, "source" | "bundled">): SkillOrigin {
  const source = (skill.source || "").toLowerCase();
  if (skill.bundled || source.includes("bundled")) return "bundled";
  if (source.includes("workspace")) return "workspace";
  if (source.includes("managed") || source.includes("local") || source.includes(".openclaw/skills")) return "shared";
  return "other";
}

function sourceLabel(source: string, bundled?: boolean): string {
  const normalized = (source || "").toLowerCase();
  if (bundled || normalized.includes("bundled")) return "Bundled • Built-in";
  if (normalized.includes("workspace")) return "Workspace • Installed";
  if (normalized.includes("managed") || normalized.includes("local")) return "Shared • Local";
  return `Custom • ${source}`;
}

function sourceColor(source: string): string {
  const normalized = (source || "").toLowerCase();
  if (normalized.includes("bundled")) return "bg-sky-500/10 text-sky-400 border-sky-500/20";
  if (normalized.includes("workspace")) return "bg-violet-500/10 text-violet-400 border-violet-500/20";
  if (normalized.includes("managed") || normalized.includes("local")) return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
  return "bg-zinc-500/10 text-muted-foreground border-zinc-500/20";
}

function sourceHint(source: string): string {
  const normalized = (source || "").toLowerCase();
  if (normalized.includes("bundled")) {
    return "Bundled with OpenClaw. Enabling only allows usage; dependencies/config still decide runtime readiness.";
  }
  if (normalized.includes("workspace")) {
    return "Installed in your workspace (usually via ClawHub).";
  }
  if (normalized.includes("managed") || normalized.includes("local")) {
    return "Installed in a shared local skills directory.";
  }
  return "Custom source.";
}

function runtimeMessage(skill: Skill, availability: ReturnType<typeof getAvailability>, missingTotal: number): string {
  if (skill.disabled) return "Disabled in config. Agent will not attempt to use this skill.";
  if (availability.state === "ready") return "Enabled and ready to use now.";
  if (availability.state === "blocked") return "Enabled, but blocked by allowlist policy.";
  if (availability.state === "needs-setup") {
    return `Enabled, waiting for ${missingTotal} requirement${missingTotal === 1 ? "" : "s"} to pass.`;
  }
  return "Enabled, but runtime checks are not passing yet.";
}

/* ── Toast ──────────────────────────────────────── */

function ToastBar({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className={cn("fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-xl backdrop-blur-sm", toast.type === "success" ? "border-emerald-500/30 bg-emerald-950/80 text-emerald-300" : "border-red-500/30 bg-red-950/80 text-red-300")}>
      <div className="flex items-center gap-2">{toast.type === "success" ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{toast.msg}</div>
    </div>
  );
}

/* ── Toggle Switch ──────────────────────────────── */

function ToggleSwitch({ checked, onChange, disabled, size = "md", color }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: "sm" | "md"; color?: "green" | "amber" | "default" }) {
  const w = size === "sm" ? "w-8" : "w-10";
  const h = size === "sm" ? "h-4" : "h-5";
  const dot = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const translate = size === "sm" ? "translate-x-3.5" : "translate-x-4";
  const checkedColor = color === "amber" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        w, h,
        checked ? checkedColor : "bg-foreground/20"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
          dot,
          checked ? translate : "translate-x-0"
        )}
      />
    </button>
  );
}

/* ── Install Terminal ───────────────────────────── */

type TermLine = { text: string; stream: "stdout" | "stderr" | "system" };

function InstallTerminal({
  kind,
  pkg,
  label,
  onDone,
  onClose,
}: {
  kind: string;
  pkg: string;
  label: string;
  onDone: (ok: boolean) => void;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<TermLine[]>([]);
  const [running, setRunning] = useState(true);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTime = useRef(Date.now());

  // Elapsed timer
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 200);
    return () => clearInterval(iv);
  }, [running]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // Stream install
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    setLines([{ text: `Installing ${label}...\n`, stream: "system" }]);
    setRunning(true);
    setExitCode(null);
    startTime.current = Date.now();

    (async () => {
      try {
        const res = await fetch("/api/skills/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, package: pkg }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const err = await res.text();
          setLines((p) => [...p, { text: `Error: ${err}\n`, stream: "stderr" }]);
          setRunning(false);
          setExitCode(1);
          onDone(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const line = part.replace(/^data: /, "").trim();
            if (!line) continue;
            try {
              const ev = JSON.parse(line) as { type: string; text?: string; code?: number };
              if (ev.type === "stdout") {
                setLines((p) => [...p, { text: ev.text || "", stream: "stdout" }]);
              } else if (ev.type === "stderr") {
                setLines((p) => [...p, { text: ev.text || "", stream: "stderr" }]);
              } else if (ev.type === "exit") {
                const code = ev.code ?? 1;
                setExitCode(code);
                setRunning(false);
                const ok = code === 0;
                setLines((p) => [
                  ...p,
                  {
                    text: ok
                      ? `\n\u2705 Installed successfully (exit 0)\n`
                      : `\n\u274C Process exited with code ${code}\n`,
                    stream: "system",
                  },
                ]);
                onDone(ok);
              } else if (ev.type === "error") {
                setLines((p) => [...p, { text: `Error: ${ev.text}\n`, stream: "stderr" }]);
                setRunning(false);
                setExitCode(1);
                onDone(false);
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setLines((p) => [...p, { text: `Connection error: ${String(err)}\n`, stream: "stderr" }]);
          setRunning(false);
          setExitCode(1);
          onDone(false);
        }
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, pkg]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setLines((p) => [...p, { text: "\n\u26A0\uFE0F Installation cancelled by user\n", stream: "system" }]);
  }, []);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-foreground/10 bg-zinc-950">
      {/* Terminal header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-500/80" />
            <div className="h-3 w-3 rounded-full bg-amber-500/80" />
            <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
          </div>
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-white/40" />
            <span className="text-xs font-medium text-white/60">
              {kind} install {pkg}
            </span>
          </div>
          {running && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Running {formatElapsed(elapsed)}
            </span>
          )}
          {!running && exitCode !== null && (
            <span className={cn("text-xs font-medium", exitCode === 0 ? "text-emerald-400" : "text-red-400")}>
              {exitCode === 0 ? "Done" : `Failed (${exitCode})`} — {formatElapsed(elapsed)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {running && (
            <button
              type="button"
              onClick={handleAbort}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-400 transition hover:bg-red-500/10"
            >
              <CircleStop className="h-3 w-3" />
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div
        ref={scrollRef}
        className="max-h-80 min-h-48 overflow-y-auto p-4 font-mono text-xs leading-5"
      >
        {lines.map((line, i) => (
          <span
            key={i}
            className={cn(
              "whitespace-pre-wrap break-all",
              line.stream === "stderr"
                ? "text-red-400/90"
                : line.stream === "system"
                  ? "text-cyan-400/90 font-semibold"
                  : "text-white/75"
            )}
          >
            {line.text}
          </span>
        ))}
        {running && (
          <span className="inline-block h-4 w-1.5 animate-pulse bg-white/60" />
        )}
      </div>
    </div>
  );
}

/* ── Skill Playground ───────────────────────────── */

function SkillPlayground({ skillName }: { skillName: string }) {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState("main");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SkillTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const commandMessage = useMemo(() => {
    const prompt = input.trim();
    return prompt ? `/skill ${skillName} ${prompt}` : `/skill ${skillName}`;
  }, [input, skillName]);

  const commandPreview = useMemo(() => {
    return `openclaw agent --agent ${agentId} --message ${JSON.stringify(commandMessage)}`;
  }, [agentId, commandMessage]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        const data = await res.json();
        if (!mounted) return;
        const rows = Array.isArray(data?.agents) ? data.agents : [];
        const options: AgentOption[] = rows
          .map((row: { id?: string; name?: string }) => ({
            id: String(row?.id || "").trim(),
            name: String(row?.name || row?.id || "").trim(),
          }))
          .filter((row: AgentOption) => row.id.length > 0);
        if (options.length === 0) {
          setAgents([{ id: "main", name: "main" }]);
          setAgentId("main");
          return;
        }
        setAgents(options);
        if (!options.some((opt) => opt.id === "main")) {
          setAgentId(options[0].id);
        }
      } catch {
        if (!mounted) return;
        setAgents([{ id: "main", name: "main" }]);
        setAgentId("main");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const runTest = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillName,
          agentId,
          input: input.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        const message = String(data?.error || "Skill test failed");
        setError(message);
        return;
      }
      setResult(data as SkillTestResult);
    } catch (err) {
      const message = String(err);
      setError(message);
    } finally {
      setRunning(false);
    }
  }, [agentId, input, skillName]);

  const copyCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(commandPreview);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [commandPreview]);

  return (
    <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
          <Terminal className="h-4 w-4 text-cyan-400" />
          Skill Playground
        </h3>
        <span className="rounded border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-xs font-medium text-cyan-300">
          Browser test runner
        </span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Runs this skill through OpenClaw with the slash command path. Use this to validate behavior without leaving Mission Control.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 md:min-w-48 md:max-w-48">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/75">Agent</span>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={running}
            className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-2 text-xs text-foreground/90 outline-none transition-colors focus:border-cyan-500/40 disabled:opacity-50"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.id})
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 md:min-w-48 md:max-w-48">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/75">Input (optional)</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="example: list my currently playing songs"
            disabled={running}
            className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs text-foreground/90 outline-none transition-colors focus:border-cyan-500/40 disabled:opacity-50"
          />
        </label>
      </div>

      <div className="rounded-lg border border-foreground/10 bg-foreground/5 p-2.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">Command preview</p>
        <div className="mt-1 flex items-start gap-2">
          <code className="min-w-0 flex-1 break-all rounded bg-foreground/5 px-2 py-1 text-xs text-foreground/80">
            {commandPreview}
          </code>
          <button
            type="button"
            onClick={() => void copyCommand()}
            className="inline-flex items-center gap-1 rounded-md border border-foreground/10 bg-foreground/5 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/10"
          >
            <Copy className="h-3 w-3" />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-60"
        >
          {running ? (
            <span className="inline-flex items-center gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
            </span>
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {running ? "Running..." : "Run Skill Test"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground/80">
            <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
              completed
            </span>
            <span>agent: {result.agentId}</span>
            <span>duration: {(result.durationMs / 1000).toFixed(1)}s</span>
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg border border-foreground/10 bg-zinc-950 p-3 text-xs leading-relaxed text-cyan-100 whitespace-pre-wrap break-words">
            {result.output || "(no output)"}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Skill Card (list view) ─────────────────────── */

function skillStatus(skill: Skill): { label: string; color: string; toggleColor: "green" | "amber" | "default" } {
  if (skill.disabled) return { label: "Configured off", color: "text-muted-foreground/60", toggleColor: "default" };
  return { label: "Configured on", color: "text-emerald-400", toggleColor: "green" };
}

function SkillCard({ skill, onClick, onToggle, toggling }: { skill: Skill; onClick: () => void; onToggle: (enabled: boolean) => void; toggling?: boolean }) {
  const missing = hasMissing(skill.missing);
  const missingTotal = missingCount(skill.missing);
  const availability = getAvailability(skill);
  const status = skillStatus(skill);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={cn("w-full cursor-pointer rounded-xl border p-3.5 text-left transition-all hover:scale-105", skill.disabled ? "border-foreground/5 bg-foreground/5 opacity-60 hover:opacity-90" : availability.state === "ready" ? "border-foreground/10 bg-foreground/5 hover:border-foreground/15" : "border-foreground/5 bg-foreground/5 opacity-75 hover:opacity-100 hover:border-foreground/10")}
    >
      <div className="flex items-start gap-3">
        <span className="text-sm leading-none mt-0.5">{skill.emoji || "\u26A1"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("text-xs font-semibold", skill.disabled ? "text-foreground/50 line-through" : "text-foreground/90")}>{skill.name}</p>
            {skill.disabled ? (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-medium text-red-400/80">DISABLED</span>
            ) : availability.state === "ready" ? (
              <CheckCircle className="h-3 w-3 shrink-0 text-emerald-500" />
            ) : availability.state === "blocked" ? (
              <XCircle className="h-3 w-3 shrink-0 text-red-400/80" />
            ) : (
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400/70" />
            )}
            {skill.always && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-400">ALWAYS</span>}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground break-words">{skill.description}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className={cn("rounded border px-1.5 py-0.5 text-xs font-medium", sourceColor(skill.source))}>{sourceLabel(skill.source, skill.bundled)}</span>
            <span className={cn("rounded border px-1.5 py-0.5 text-xs font-medium", availability.badgeClass)}>{availability.label}</span>
            {!skill.disabled && missing && <span className="text-xs text-muted-foreground/80">{missingTotal} requirement{missingTotal === 1 ? "" : "s"} missing</span>}
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 mt-0.5">
          {toggling ? (
            <span className="inline-flex items-center gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </span>
          ) : (
            <ToggleSwitch
              checked={!skill.disabled}
              onChange={(enabled) => onToggle(enabled)}
              size="sm"
              color={status.toggleColor}
            />
          )}
          <span className={cn("text-xs font-medium", status.color)}>
            {status.label}
          </span>
          <span className="text-xs text-muted-foreground/60">Config</span>
        </div>
      </div>
    </div>
  );
}

/* ── Skill Detail Panel ─────────────────────────── */

function SkillDetailPanel({ name, onBack, onAction }: { name: string; onBack: () => void; onAction: (msg: string) => void }) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showMd, setShowMd] = useState(false);
  const [installTerminal, setInstallTerminal] = useState<{ kind: string; pkg: string; label: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/skills?action=info&name=" + encodeURIComponent(name))
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [name]);

  const doAction = useCallback(async (action: string, params: Record<string, unknown>) => {
    setBusy(action);
    try {
      const res = await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }) });
      const d = await res.json();
      if (d.ok) { onAction(action + " succeeded"); } else { onAction("Error: " + (d.error || "failed")); }
    } catch (err) { onAction("Error: " + String(err)); }
    finally { setBusy(null); }
    // Refresh detail
    try {
      const res = await fetch("/api/skills?action=info&name=" + encodeURIComponent(name));
      const d = await res.json();
      setDetail(d);
    } catch { /* ignore */ }
  }, [name, onAction]);

  if (loading) return <LoadingState label="Loading skill..." />;
  if (!detail) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">Skill not found</div>;

  const missing = hasMissing(detail.missing);
  const missingTotal = missingCount(detail.missing);
  const availability = getAvailability(detail);
  const hasReqs = hasMissing(detail.requirements);
  const runtime = runtimeMessage(detail, availability, missingTotal);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Back + header */}
      <div className="shrink-0 border-b border-foreground/10 px-4 md:px-6 py-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground/70 mb-3"><ArrowLeft className="h-3.5 w-3.5" />Back to Skills</button>
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-xl">{detail.emoji || "\u26A1"}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-semibold text-foreground">{detail.name}</h1>
              {availability.state === "ready" ? <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300"><CheckCircle className="h-3 w-3" />Ready</span> : availability.state === "blocked" ? <span className="flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-300"><XCircle className="h-3 w-3" />Blocked</span> : availability.state === "needs-setup" ? <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-300"><AlertTriangle className="h-3 w-3" />Needs setup</span> : <span className="flex items-center gap-1 rounded-full bg-zinc-500/20 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"><XCircle className="h-3 w-3" />Unavailable</span>}
              {detail.disabled && <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-400">Disabled</span>}
              {detail.always && <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-300">Always active</span>}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail.description}</p>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className={cn("rounded border px-1.5 py-0.5 text-xs font-medium", sourceColor(detail.source))}>{sourceLabel(detail.source, detail.bundled)}</span>
              {detail.homepage && <a href={detail.homepage} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-violet-400 hover:underline"><Globe className="h-3 w-3" />Homepage</a>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground/70">{sourceHint(detail.source)}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-5">
        {/* Actions bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-2.5">
            <div className="flex items-center gap-2">
              {(busy === "enable-skill" || busy === "disable-skill") ? (
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                </span>
              ) : (
                <ToggleSwitch
                  checked={!detail.disabled}
                  onChange={(enabled) => doAction(enabled ? "enable-skill" : "disable-skill", { name: detail.name })}
                  disabled={busy !== null}
                  color={detail.disabled ? "default" : "green"}
                />
              )}
              <div>
                <p className={cn("text-xs font-medium", detail.disabled ? "text-muted-foreground" : "text-emerald-400")}>
                  {detail.disabled ? "Policy: Disabled" : "Policy: Enabled"}
                </p>
                <p className="text-xs text-muted-foreground/60">
                  {detail.disabled
                    ? "skills.entries.<skill>.enabled = false"
                    : "skills.entries.<skill>.enabled = true"}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground/60">Runtime</p>
            <p className={cn("mt-0.5 text-xs font-medium", availability.state === "ready" ? "text-emerald-400" : availability.state === "blocked" ? "text-red-400" : availability.state === "needs-setup" ? "text-amber-400" : "text-muted-foreground")}>{availability.label}</p>
            <p className="mt-1 text-xs text-muted-foreground/70">{runtime}</p>
          </div>
          {detail.skillMd && (
            <button onClick={() => setShowMd(!showMd)} className="flex items-center gap-1.5 rounded-lg bg-foreground/10 px-3 py-2 text-xs font-medium text-foreground/70 hover:bg-foreground/10">
              <FileText className="h-3.5 w-3.5" />{showMd ? "Hide" : "View"} SKILL.md
            </button>
          )}
        </div>

        <SkillPlayground skillName={detail.name} />

        {/* Requirements section */}
        {hasReqs && (
          <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground/90"><Package className="h-4 w-4 text-amber-400" />Requirements</h3>
            <div className="space-y-2">
              {detail.requirements.bins.length > 0 && (
                <div className="flex items-start gap-3">
                  <Terminal className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">CLI tools required</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.bins.map((b) => {
                      const isMissing = detail.missing.bins.includes(b);
                      return (<span key={b} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-mono", isMissing ? "border-red-500/20 bg-red-500/10 text-red-400" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{b}</span>);
                    })}</div>
                  </div>
                </div>
              )}
              {detail.requirements.env.length > 0 && (
                <div className="flex items-start gap-3">
                  <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Environment variables</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.env.map((e) => {
                      const isMissing = detail.missing.env.includes(e);
                      return (<span key={e} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-mono", isMissing ? "border-red-500/20 bg-red-500/10 text-red-400" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{e}</span>);
                    })}</div>
                  </div>
                </div>
              )}
              {detail.requirements.config.length > 0 && (
                <div className="flex items-start gap-3">
                  <Wrench className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Config keys</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.config.map((c) => {
                      const isMissing = detail.missing.config.includes(c);
                      return (<span key={c} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-xs", isMissing ? "border-red-500/20 bg-red-500/10 text-red-400" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{c}</span>);
                    })}</div>
                  </div>
                </div>
              )}
              {detail.requirements.os.length > 0 && (
                <div className="flex items-start gap-3">
                  <Cpu className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Operating system</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.os.map((o) => {
                      const isMissing = detail.missing.os.includes(o);
                      return (<span key={o} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-xs", isMissing ? "border-red-500/20 bg-red-500/10 text-red-400" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{o}</span>);
                    })}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Install options */}
        {missing && detail.install.length > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-amber-300"><Download className="h-4 w-4" />Install Missing Dependencies</h3>
            <div className="space-y-2">{detail.install.map((inst) => {
              const supportedKinds = ["brew", "npm", "pip"];
              const canInstall = supportedKinds.includes(inst.kind) && inst.bins && inst.bins.length > 0;
              return (
                <div key={inst.id} className="flex items-center justify-between rounded-lg border border-foreground/10 bg-muted/50 px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-foreground/90">{inst.label}</p>
                    <p className="text-xs text-muted-foreground">Method: {inst.kind}{inst.bins ? " \u2022 Installs: " + inst.bins.join(", ") : ""}</p>
                  </div>
                  {canInstall ? (
                    <button
                      onClick={() => setInstallTerminal({ kind: inst.kind, pkg: inst.bins![0], label: inst.label })}
                      disabled={installTerminal !== null}
                      className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      <Terminal className="h-3 w-3" />Install
                    </button>
                  ) : (
                    <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">Manual</span>
                  )}
                </div>
              );
            })}</div>
          </div>
        )}

        {/* Install terminal */}
        {installTerminal && (
          <InstallTerminal
            kind={installTerminal.kind}
            pkg={installTerminal.pkg}
            label={installTerminal.label}
            onDone={(ok) => {
              if (ok) {
                onAction(`${installTerminal.pkg} installed successfully`);
                // Refresh skill detail
                fetch("/api/skills?action=info&name=" + encodeURIComponent(name))
                  .then((r) => r.json())
                  .then((d) => setDetail(d))
                  .catch(() => {});
              }
            }}
            onClose={() => setInstallTerminal(null)}
          />
        )}

        {/* All good */}
        {!missing && detail.eligible && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-300"><CheckCircle className="h-4 w-4" />All requirements met — this skill is active and available to your agents.</p>
          </div>
        )}

        {/* Skill config */}
        {detail.skillConfig && Object.keys(detail.skillConfig).length > 0 && (
          <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4 space-y-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground/90"><Settings2 className="h-4 w-4 text-muted-foreground" />Configuration</h3>
            <p className="text-xs text-muted-foreground">Current tool config for <code className="rounded bg-foreground/10 px-1 text-muted-foreground">tools.{detail.skillKey || detail.name}</code></p>
            <pre className="rounded-lg bg-muted p-3 text-xs text-muted-foreground overflow-auto max-h-72">{JSON.stringify(detail.skillConfig, null, 2)}</pre>
          </div>
        )}

        {/* File info */}
        <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4 space-y-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground/90"><Info className="h-4 w-4 text-muted-foreground" />Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-foreground/5 bg-muted/50 px-3 py-2"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Skill Key</p><p className="text-xs font-mono text-foreground/70 mt-0.5">{detail.skillKey || detail.name}</p></div>
            <div className="rounded-lg border border-foreground/5 bg-muted/50 px-3 py-2"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Source</p><p className="text-xs text-foreground/70 mt-0.5">{detail.source}</p></div>
            <div className="col-span-2 rounded-lg border border-foreground/5 bg-muted/50 px-3 py-2"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">File Path</p><p className="text-xs font-mono text-muted-foreground mt-0.5 break-all">{detail.filePath}</p></div>
            <div className="col-span-2 rounded-lg border border-foreground/5 bg-muted/50 px-3 py-2"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Base Directory</p><p className="text-xs font-mono text-muted-foreground mt-0.5 break-all">{detail.baseDir}</p></div>
          </div>
        </div>

        {/* SKILL.md content */}
        {showMd && detail.skillMd && (
          <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground/90"><FileText className="h-4 w-4 text-muted-foreground" />SKILL.md</h3>
              <button onClick={() => setShowMd(false)} className="rounded p-1 text-muted-foreground hover:text-foreground/70"><X className="h-3.5 w-3.5" /></button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">{detail.skillMd}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function ClawHubPanel({
  onAction,
  onInstalled,
}: {
  onAction: (msg: string) => void;
  onInstalled: (slug: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ClawHubItem[]>([]);
  const [installed, setInstalled] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"trending" | "search">("trending");
  const [viewFilter, setViewFilter] = useState<"all" | "installed">("all");
  const [sortBy, setSortBy] = useState<"trending" | "stars" | "downloads" | "name">("trending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"install" | "update" | "uninstall" | null>(null);

  const displayedItems: ClawHubItem[] = viewFilter === "installed"
    ? Object.entries(installed).map(([slug, version]) => {
        const fromCatalog = items.find((i) => i.slug === slug);
        return {
          slug,
          version,
          latestVersion: fromCatalog?.version,
          summary: fromCatalog?.summary ?? "",
          displayName: fromCatalog?.displayName,
          developer: fromCatalog?.developer,
          stars: fromCatalog?.stars,
          downloads: fromCatalog?.downloads,
        };
      })
    : items;

  const sortedItems = useMemo(() => {
    if (sortBy === "trending") return [...displayedItems];
    return [...displayedItems].sort((a, b) => {
      if (sortBy === "stars") return (b.stars ?? 0) - (a.stars ?? 0);
      if (sortBy === "downloads") return (b.downloads ?? 0) - (a.downloads ?? 0);
      if (sortBy === "name") return (a.displayName || a.slug).localeCompare(b.displayName || b.slug, undefined, { sensitivity: "base" });
      return 0;
    });
  }, [displayedItems, sortBy]);

  const fetchInstalled = useCallback(async () => {
    try {
      const res = await fetch("/api/skills/clawhub?action=list");
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(String(data?.error || `HTTP ${res.status}`));
      }
      const map: Record<string, string> = {};
      for (const row of data.items || []) {
        const slug = String((row as { slug?: string }).slug || "");
        const version = String((row as { version?: string }).version || "");
        if (slug) map[slug] = version;
      }
      setInstalled(map);
      setError(null);
    } catch (err) {
      setInstalled({});
      setError(String(err));
    }
  }, []);

  const fetchExplore = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/skills/clawhub?action=explore&limit=28&sort=trending");
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(String(data?.error || `HTTP ${res.status}`));
      }
      const normalized: ClawHubItem[] = (data.items || []).map((item: {
        slug?: string;
        displayName?: string;
        summary?: string;
        latestVersion?: { version?: string };
        stats?: { downloads?: number; installsCurrent?: number; stars?: number };
        updatedAt?: number;
        developer?: string;
        author?: string;
      }) => ({
        slug: String(item.slug || ""),
        displayName: item.displayName || undefined,
        summary: item.summary || "",
        version: item.latestVersion?.version || "latest",
        developer: (item.developer ?? item.author) || undefined,
        downloads: item.stats?.downloads || 0,
        installsCurrent: item.stats?.installsCurrent || 0,
        stars: item.stats?.stars || 0,
        updatedAt: item.updatedAt,
      })).filter((item: ClawHubItem) => item.slug);
      setItems(normalized);
      setError(null);
    } catch (err) {
      setItems([]);
      setError(String(err));
    }
    setLoading(false);
  }, []);

  const runSearch = useCallback(async (searchQuery?: string) => {
    const q = (searchQuery ?? query).trim();
    if (!q) return;
    setLoading(true);
    setMode("search");
    try {
      const res = await fetch(`/api/skills/clawhub?action=search&q=${encodeURIComponent(q)}&limit=28`);
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(String(data?.error || `HTTP ${res.status}`));
      }
      const normalized: ClawHubItem[] = (data.items || []).map((item: {
        slug?: string;
        version?: string;
        summary?: string;
        score?: number;
        developer?: string;
        author?: string;
        displayName?: string;
      }) => ({
        slug: String(item.slug || ""),
        displayName: item.displayName || undefined,
        version: item.version || "latest",
        summary: item.summary || "",
        score: typeof item.score === "number" ? item.score : undefined,
        developer: (item.developer ?? item.author) || undefined,
      })).filter((item: ClawHubItem) => item.slug);
      setItems(normalized);
      setError(null);
    } catch (err) {
      setItems([]);
      setError(String(err));
    }
    setLoading(false);
  }, [query]);

  const installSkill = useCallback(async (slug: string, version?: string, force = false) => {
    setBusySlug(slug);
    setBusyAction("install");
    try {
      const res = await fetch("/api/skills/clawhub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", slug, version, force }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const errMsg = String(data?.error || "install failed");
        const isSuspicious = /suspicious|Use --force/i.test(errMsg);
        if (isSuspicious && !force && window.confirm("This skill is flagged as suspicious by VirusTotal (e.g. risky patterns). Install anyway? Review the skill code after installing.")) {
          setBusySlug(null);
          setBusyAction(null);
          return void installSkill(slug, version, true);
        }
        onAction(`Error: ${errMsg}`);
      } else {
        onAction(`Installed ${slug}`);
        await fetchInstalled();
        await onInstalled(slug);
      }
    } catch (err) {
      onAction(`Error: ${String(err)}`);
    }
    setBusySlug(null);
    setBusyAction(null);
  }, [fetchInstalled, onAction, onInstalled]);

  const updateSkill = useCallback(async (slug: string) => {
    setBusySlug(slug);
    setBusyAction("update");
    try {
      const res = await fetch("/api/skills/clawhub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", slug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        onAction(`Error: ${data.error || "update failed"}`);
      } else {
        onAction(`Updated ${slug}`);
        await fetchInstalled();
        await onInstalled(slug);
      }
    } catch (err) {
      onAction(`Error: ${String(err)}`);
    }
    setBusySlug(null);
    setBusyAction(null);
  }, [fetchInstalled, onAction, onInstalled]);

  const uninstallSkill = useCallback(async (slug: string) => {
    if (!window.confirm(`Delete "${slug}" from workspace skills?`)) {
      return;
    }
    setBusySlug(slug);
    setBusyAction("uninstall");
    try {
      const res = await fetch("/api/skills/clawhub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "uninstall", slug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        onAction(`Error: ${data.error || "delete failed"}`);
      } else {
        onAction(`Deleted ${slug}`);
        await fetchInstalled();
        await onInstalled(slug);
      }
    } catch (err) {
      onAction(`Error: ${String(err)}`);
    }
    setBusySlug(null);
    setBusyAction(null);
  }, [fetchInstalled, onAction, onInstalled]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchInstalled();
      void fetchExplore();
    });
  }, [fetchExplore, fetchInstalled]);

  // Search as you type (debounced); clear input -> show trending again
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setMode("trending");
      void fetchExplore();
      return;
    }
    setMode("search");
    const t = setTimeout(() => {
      void runSearch(trimmed);
    }, 350);
    return () => clearTimeout(t);
  }, [query, runSearch, fetchExplore]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-foreground/10 bg-muted/40 px-2.5 py-1.5 min-w-44">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <input
            placeholder="Search skills..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 text-foreground/80"
          />
        </div>
        <button type="button" onClick={() => { setMode("trending"); void fetchExplore(); }} className={cn("rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors", mode === "trending" && !query ? "bg-foreground/10 text-foreground/80" : "text-muted-foreground hover:bg-muted/60")}>
          Trending
        </button>
        <div className="flex rounded-md border border-foreground/10 p-0.5">
          <button type="button" onClick={() => setViewFilter("all")} className={cn("rounded px-2 py-1 text-sm font-medium transition-colors", viewFilter === "all" ? "bg-foreground/10 text-foreground/80" : "text-muted-foreground hover:text-foreground/70")}>
            All
          </button>
          <button type="button" onClick={() => setViewFilter("installed")} className={cn("rounded px-2 py-1 text-sm font-medium transition-colors", viewFilter === "installed" ? "bg-foreground/10 text-foreground/80" : "text-muted-foreground hover:text-foreground/70")}>
            Installed ({Object.keys(installed).length})
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground/60 shrink-0">Sort:</span>
          <div className="flex rounded-md border border-foreground/10 p-0.5">
            {(["trending", "stars", "downloads", "name"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSortBy(s)} className={cn("rounded px-2 py-1 text-xs font-medium transition-colors", sortBy === s ? "bg-foreground/10 text-foreground/80" : "text-muted-foreground hover:text-foreground/70")}>
                {s === "trending" ? "Trending" : s === "stars" ? "Stars" : s === "downloads" ? "Downloads" : "Name"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          {error}
        </div>
      )}

      <div>
        {loading && viewFilter === "all" ? (
          <div className="flex items-center justify-center py-12">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
            </span>
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="rounded-lg border border-foreground/10 bg-foreground/5 px-4 py-6 text-center text-xs text-muted-foreground/70">
            {viewFilter === "installed" ? "No ClawHub skills installed yet. Use Trending or search, then Install." : "No skills found."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {sortedItems.map((item) => {
              const installedVersion = installed[item.slug];
              const isInstalled = Boolean(installedVersion);
              const catalogVersion = item.latestVersion ?? item.version;
              const hasUpdate = isInstalled && catalogVersion && catalogVersion !== installedVersion;
              const isBusy = busySlug === item.slug;
              const installLabel = isBusy && busyAction === "install" ? "Installing..." : isBusy && busyAction === "update" ? "Updating..." : isBusy && busyAction === "uninstall" ? "Deleting..." : isInstalled ? "Reinstall" : "Install";
              return (
                <div
                  key={item.slug}
                  className="rounded-xl border border-white/20 dark:border-white/10 p-2.5 shadow-sm backdrop-blur-md bg-white/70 dark:bg-white/10"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{item.displayName || item.slug}</p>
                      {item.developer && (
                        <p className="mt-0.5 text-xs text-muted-foreground/80 truncate" title={item.developer}>
                          by {item.developer}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs leading-snug text-foreground/80 dark:text-foreground/90 break-words">
                        {item.summary || item.slug}
                      </p>
                    </div>
                    <span className={cn("shrink-0 rounded border px-1 py-0.5 text-xs font-medium leading-none", isInstalled ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-foreground/10 text-muted-foreground")}>
                      {isInstalled ? installedVersion : `v${item.version || "latest"}`}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {viewFilter === "all" && typeof item.stars === "number" && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
                        <Star className="h-3 w-3 fill-amber-500/80 text-amber-500/80 shrink-0" />
                        {item.stars}
                      </span>
                    )}
                    <div className="flex flex-1 justify-end gap-1">
                      {isInstalled && hasUpdate && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void updateSkill(item.slug)}
                          className="rounded border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 dark:hover:bg-amber-500/20 disabled:opacity-50"
                        >
                          {isBusy && busyAction === "update" ? "…" : "Update"}
                        </button>
                      )}
                      {isInstalled && (
                        <button type="button" disabled={isBusy} onClick={() => void uninstallSkill(item.slug)} className="rounded border border-red-500/20 px-2 py-0.5 text-xs text-red-500/90 hover:bg-red-500/10 disabled:opacity-50">
                          Delete
                        </button>
                      )}
                      <button type="button" disabled={isBusy} onClick={() => void installSkill(item.slug, item.version)} className="rounded bg-violet-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50">
                        {installLabel}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main SkillsView ────────────────────────────── */

export function SkillsView({ initialSkillName = null }: { initialSkillName?: string | null } = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SkillsFilter>("all");
  const [selectedSkill, setSelectedSkill] = useState<string | null>(initialSkillName);
  const [toast, setToast] = useState<Toast | null>(null);
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [apiDegraded, setApiDegraded] = useState(false);
  const tab: "skills" | "clawhub" =
    (searchParams.get("tab") || "").toLowerCase() === "clawhub" ? "clawhub" : "skills";

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setApiWarning(null);
    setApiDegraded(false);
    try {
      const [listRes, checkRes] = await Promise.all([
        fetch("/api/skills"),
        fetch("/api/skills?action=check"),
      ]);
      const listData = (await listRes.json()) as {
        skills?: Skill[];
        warning?: unknown;
        degraded?: unknown;
      };
      const checkData = (await checkRes.json()) as {
        summary?: Summary | null;
        warning?: unknown;
        degraded?: unknown;
      };

      const warnings = [listData.warning, checkData.warning]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim());
      setApiWarning(warnings.length > 0 ? warnings.join(" | ") : null);
      setApiDegraded(Boolean(listData.degraded) || Boolean(checkData.degraded));

      setSkills(listData.skills || []);
      setSummary(checkData.summary || null);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    setSelectedSkill(initialSkillName);
  }, [initialSkillName]);

  useEffect(() => {
    if (selectedSkill) {
      setLoading(false);
      return;
    }
    if (tab === "clawhub") {
      setLoading(false);
      return;
    }
    queueMicrotask(() => {
      void fetchAll();
    });
  }, [fetchAll, selectedSkill, tab]);

  const filtered = useMemo(() => skills.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false;
    }
    if (filter === "eligible") return s.eligible;
    if (filter === "unavailable") return !s.eligible || s.blockedByAllowlist;
    if (filter === "workspace") return getSkillOrigin(s) === "workspace";
    if (filter === "bundled") return getSkillOrigin(s) === "bundled";
    return true;
  }), [skills, search, filter]);

  const grouped = useMemo(() => {
    const buckets: Record<SkillOrigin, Skill[]> = {
      bundled: [],
      workspace: [],
      shared: [],
      other: [],
    };
    for (const skill of filtered) {
      buckets[getSkillOrigin(skill)].push(skill);
    }
    return SKILL_ORIGIN_ORDER.map((origin) => {
      const sectionSkills = buckets[origin];
      return {
        origin,
        title: SKILL_ORIGIN_META[origin].title,
        description: SKILL_ORIGIN_META[origin].description,
        skills: sectionSkills,
        ready: sectionSkills.filter((skill) => getAvailability(skill).state === "ready").length,
        needsSetup: sectionSkills.filter((skill) => getAvailability(skill).state === "needs-setup").length,
        disabled: sectionSkills.filter((skill) => skill.disabled).length,
      };
    }).filter((section) => section.skills.length > 0);
  }, [filtered]);

  const handleAction = useCallback((msg: string) => {
    const isError = msg.startsWith("Error");
    setToast({ msg, type: isError ? "error" : "success" });
    if (!isError) requestRestart("Skill configuration was updated.");
    fetchAll(); // Refresh list after action
  }, [fetchAll]);

  const handleToggleSkill = useCallback(async (skillName: string, enabled: boolean) => {
    setTogglingSkill(skillName);
    try {
      const action = enabled ? "enable-skill" : "disable-skill";
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name: skillName }),
      });
      const d = await res.json();
      if (d.ok) {
        // Optimistic update for instant feedback
        setSkills((prev) => prev.map((s) => s.name === skillName ? { ...s, disabled: !enabled } : s));
        setToast({ msg: `${skillName} ${enabled ? "enabled" : "disabled"}`, type: "success" });
        requestRestart("Skill configuration was updated.");
        fetchAll();
      } else {
        setToast({ msg: "Error: " + (d.error || "failed"), type: "error" });
      }
    } catch (err) {
      setToast({ msg: "Error: " + String(err), type: "error" });
    }
    setTogglingSkill(null);
  }, [fetchAll]);

  const handleClawHubInstalled = useCallback(async (slug: string) => {
    try {
      const listRes = await fetch("/api/skills").then((r) => r.json());
      const latest = (listRes.skills || []) as Skill[];
      setSkills(latest);
      const match = latest.find((s) => s.name === slug);
      if (match?.disabled) {
        await fetch("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "enable-skill", name: slug }),
        });
      }
      await fetchAll();
      requestRestart("Skill catalog was updated.");
    } catch {
      await fetchAll();
    }
  }, [fetchAll]);

  const switchTab = useCallback((next: "skills" | "clawhub") => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("section");
    if (next === "clawhub") params.set("tab", "clawhub");
    else params.delete("tab");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  // Detail view
  if (selectedSkill) {
    return (
      <>
        <SkillDetailPanel
          name={selectedSkill}
          onBack={() => {
            if (initialSkillName) {
              router.push("/skills");
              return;
            }
            setSelectedSkill(null);
          }}
          onAction={handleAction}
        />
        {toast && <ToastBar toast={toast} onDone={() => setToast(null)} />}
      </>
    );
  }

  if (loading) return <LoadingState label="Loading skills..." size="lg" />;

  const workspaceCount = skills.filter((s) => getSkillOrigin(s) === "workspace").length;

  return (
    <SectionLayout>
      <SectionHeader
        className="py-2 md:py-3"
        title={
          <span className="flex items-center gap-2 text-xs">
            <Wrench className="h-5 w-5 text-violet-400" />
            Skills
          </span>
        }
        description="Browse, install, and configure skills. Click any skill for details."
        descriptionClassName="text-sm text-muted-foreground"
        meta={null}
        actions={
          <div className="flex items-center gap-2">
            <ApiWarningBadge warning={apiWarning} degraded={apiDegraded} />
            <div className="inline-flex rounded-lg border border-foreground/10 bg-muted/50 p-1">
              <button
                type="button"
                onClick={() => switchTab("skills")}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", tab === "skills" ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:text-foreground/80")}
              >
                Local Skills
              </button>
              <button
                type="button"
                onClick={() => switchTab("clawhub")}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", tab === "clawhub" ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:text-foreground/80")}
              >
                ClawHub
              </button>
            </div>
            <button type="button" onClick={fetchAll} className="flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80"><RefreshCw className="h-3 w-3" />Refresh</button>
          </div>
        }
      />

      {tab === "skills" && (
        <SectionBody width="wide" padding="compact" innerClassName="space-y-4">
          {/* Summary + search in one scrollable area with the list */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <SumCard value={summary.total} label="Total" color="text-foreground/80" />
              <SumCard value={summary.eligible} label="Ready" color="text-emerald-600 dark:text-emerald-400" border="border-emerald-500/15" bg="bg-emerald-500/5" />
              <SumCard value={workspaceCount} label="Workspace" color="text-violet-600 dark:text-violet-400" border="border-violet-500/15" bg="bg-violet-500/5" />
              <SumCard value={summary.disabled} label="Disabled" color="text-muted-foreground" border="border-foreground/10" bg="bg-foreground/5" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-foreground/10 bg-muted/40 px-2.5 py-1.5 min-w-44">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              <input placeholder="Search skills..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 text-foreground/80" />
              {search && <button onClick={() => setSearch("")} className="text-muted-foreground/50 hover:text-muted-foreground"><X className="h-3.5 w-3.5" /></button>}
            </div>
            <div className="flex gap-1">{(["all", "eligible", "unavailable", "bundled", "workspace"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded-md px-2 py-1 text-xs font-medium transition-colors", filter === f ? "bg-foreground/10 text-foreground/80" : "text-muted-foreground hover:bg-muted/60")}>
                {f === "all" ? "All" : f === "eligible" ? "Ready" : f === "unavailable" ? "Unavailable" : f === "bundled" ? "Bundled" : "Workspace"}
              </button>
            ))}</div>
          </div>
          <div className="space-y-4">
          {grouped.map((section) => (
            <section key={section.origin} className="rounded-lg border border-foreground/10 bg-foreground/5 p-3">
              <h3 className="text-xs font-medium text-foreground/80 border-b border-foreground/5 pb-2">
                {section.title} <span className="text-muted-foreground/60 font-normal">({section.skills.length})</span>
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {section.skills.map((s) => (
                  <SkillCard
                    key={s.name}
                    skill={s}
                    onClick={() => router.push(`/skills/${encodeURIComponent(s.name)}`)}
                    onToggle={(enabled) => handleToggleSkill(s.name, enabled)}
                    toggling={togglingSkill === s.name}
                  />
                ))}
              </div>
            </section>
          ))}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12">
              <Search className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No skills match your search</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Try different keywords or change the filter.</p>
            </div>
          )}
          </div>
        </SectionBody>
      )}

      {tab === "clawhub" && (
        <SectionBody width="wide" padding="compact" innerClassName="pb-6">
          <ClawHubPanel
            onAction={handleAction}
            onInstalled={handleClawHubInstalled}
          />
        </SectionBody>
      )}
      {toast && <ToastBar toast={toast} onDone={() => setToast(null)} />}
    </SectionLayout>
  );
}

/* ── Summary Card ───────────────────────────────── */

function SumCard({ value, label, color, border, bg }: { value: number; label: string; color: string; border?: string; bg?: string }) {
  return (
    <div className={cn("rounded-lg border px-2.5 py-1.5", border || "border-foreground/10", bg || "bg-foreground/5")}>
      <p className={cn("text-xs font-semibold leading-tight", color)}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}
