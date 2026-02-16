"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { requestRestart } from "@/lib/restart-store";
import {
  CheckCircle, XCircle, Search, RefreshCw,
  AlertTriangle, X, Loader2, Check, Download,
  Settings2, Package, Cpu,
  FileText, Terminal, Globe, Wrench, ArrowLeft,
  Info, CircleStop,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  score?: number;
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
    <div className={cn("fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-[13px] font-medium shadow-xl backdrop-blur-sm", toast.type === "success" ? "border-emerald-500/30 bg-emerald-950/80 text-emerald-300" : "border-red-500/30 bg-red-950/80 text-red-300")}>
      <div className="flex items-center gap-2">{toast.type === "success" ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{toast.msg}</div>
    </div>
  );
}

/* ── Toggle Switch ──────────────────────────────── */

function ToggleSwitch({ checked, onChange, disabled, size = "md", color }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: "sm" | "md"; color?: "green" | "amber" | "default" }) {
  const w = size === "sm" ? "w-8" : "w-10";
  const h = size === "sm" ? "h-[18px]" : "h-[22px]";
  const dot = size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]";
  const translate = size === "sm" ? "translate-x-[14px]" : "translate-x-[18px]";
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
    <div className="flex flex-col overflow-hidden rounded-xl border border-foreground/[0.08] bg-[#0d1117]">
      {/* Terminal header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.03] px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-500/80" />
            <div className="h-3 w-3 rounded-full bg-amber-500/80" />
            <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
          </div>
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-white/40" />
            <span className="text-[12px] font-medium text-white/60">
              {kind} install {pkg}
            </span>
          </div>
          {running && (
            <span className="flex items-center gap-1.5 text-[10px] text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Running {formatElapsed(elapsed)}
            </span>
          )}
          {!running && exitCode !== null && (
            <span className={cn("text-[10px] font-medium", exitCode === 0 ? "text-emerald-400" : "text-red-400")}>
              {exitCode === 0 ? "Done" : `Failed (${exitCode})`} — {formatElapsed(elapsed)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {running && (
            <button
              type="button"
              onClick={handleAbort}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-red-400 transition hover:bg-red-500/10"
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
        className="max-h-[350px] min-h-[200px] overflow-y-auto p-4 font-mono text-[12px] leading-5"
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
          <span className="inline-block h-4 w-[7px] animate-pulse bg-white/60" />
        )}
      </div>
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
      className={cn("w-full cursor-pointer rounded-xl border p-3.5 text-left transition-all hover:scale-[1.01]", skill.disabled ? "border-foreground/[0.04] bg-foreground/[0.01] opacity-60 hover:opacity-90" : availability.state === "ready" ? "border-foreground/[0.06] bg-foreground/[0.02] hover:border-foreground/[0.12]" : "border-foreground/[0.04] bg-foreground/[0.01] opacity-75 hover:opacity-100 hover:border-foreground/[0.08]")}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none mt-0.5">{skill.emoji || "\u26A1"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("text-[13px] font-semibold", skill.disabled ? "text-foreground/50 line-through" : "text-foreground/90")}>{skill.name}</p>
            {skill.disabled ? (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[8px] font-medium text-red-400/80">DISABLED</span>
            ) : availability.state === "ready" ? (
              <CheckCircle className="h-3 w-3 shrink-0 text-emerald-500" />
            ) : availability.state === "blocked" ? (
              <XCircle className="h-3 w-3 shrink-0 text-red-400/80" />
            ) : (
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400/70" />
            )}
            {skill.always && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[8px] text-amber-400">ALWAYS</span>}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.5] text-muted-foreground">{skill.description}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className={cn("rounded border px-1.5 py-0.5 text-[9px] font-medium", sourceColor(skill.source))}>{sourceLabel(skill.source, skill.bundled)}</span>
            <span className={cn("rounded border px-1.5 py-0.5 text-[9px] font-medium", availability.badgeClass)}>{availability.label}</span>
            {!skill.disabled && missing && <span className="text-[9px] text-muted-foreground/80">{missingTotal} requirement{missingTotal === 1 ? "" : "s"} missing</span>}
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 mt-0.5">
          {toggling ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <ToggleSwitch
              checked={!skill.disabled}
              onChange={(enabled) => onToggle(enabled)}
              size="sm"
              color={status.toggleColor}
            />
          )}
          <span className={cn("text-[8px] font-medium", status.color)}>
            {status.label}
          </span>
          <span className="text-[8px] text-muted-foreground/60">Config</span>
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

  if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-violet-400" /></div>;
  if (!detail) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">Skill not found</div>;

  const missing = hasMissing(detail.missing);
  const missingTotal = missingCount(detail.missing);
  const availability = getAvailability(detail);
  const hasReqs = hasMissing(detail.requirements);
  const runtime = runtimeMessage(detail, availability, missingTotal);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Back + header */}
      <div className="shrink-0 border-b border-foreground/[0.06] px-4 md:px-6 py-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground/70 mb-3"><ArrowLeft className="h-3.5 w-3.5" />Back to Skills</button>
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-3xl">{detail.emoji || "\u26A1"}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-[20px] font-semibold text-foreground">{detail.name}</h1>
              {availability.state === "ready" ? <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300"><CheckCircle className="h-3 w-3" />Ready</span> : availability.state === "blocked" ? <span className="flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-red-300"><XCircle className="h-3 w-3" />Blocked</span> : availability.state === "needs-setup" ? <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300"><AlertTriangle className="h-3 w-3" />Needs setup</span> : <span className="flex items-center gap-1 rounded-full bg-zinc-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground"><XCircle className="h-3 w-3" />Unavailable</span>}
              {detail.disabled && <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-red-400">Disabled</span>}
              {detail.always && <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300">Always active</span>}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{detail.description}</p>
            <div className="mt-2 flex items-center gap-3 text-[11px]">
              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", sourceColor(detail.source))}>{sourceLabel(detail.source, detail.bundled)}</span>
              {detail.homepage && <a href={detail.homepage} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-violet-400 hover:underline"><Globe className="h-3 w-3" />Homepage</a>}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground/70">{sourceHint(detail.source)}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-5">
        {/* Actions bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-2.5">
            <div className="flex items-center gap-2">
              {(busy === "enable-skill" || busy === "disable-skill") ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <ToggleSwitch
                  checked={!detail.disabled}
                  onChange={(enabled) => doAction(enabled ? "enable-skill" : "disable-skill", { name: detail.name })}
                  disabled={busy !== null}
                  color={detail.disabled ? "default" : "green"}
                />
              )}
              <div>
                <p className={cn("text-[12px] font-medium", detail.disabled ? "text-muted-foreground" : "text-emerald-400")}>
                  {detail.disabled ? "Policy: Disabled" : "Policy: Enabled"}
                </p>
                <p className="text-[10px] text-muted-foreground/60">
                  {detail.disabled
                    ? "skills.entries.<skill>.enabled = false"
                    : "skills.entries.<skill>.enabled = true"}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Runtime</p>
            <p className={cn("mt-0.5 text-[12px] font-medium", availability.state === "ready" ? "text-emerald-400" : availability.state === "blocked" ? "text-red-400" : availability.state === "needs-setup" ? "text-amber-400" : "text-muted-foreground")}>{availability.label}</p>
            <p className="mt-1 text-[10px] text-muted-foreground/65">{runtime}</p>
          </div>
          {detail.skillMd && (
            <button onClick={() => setShowMd(!showMd)} className="flex items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-3 py-2 text-[12px] font-medium text-foreground/70 hover:bg-foreground/[0.1]">
              <FileText className="h-3.5 w-3.5" />{showMd ? "Hide" : "View"} SKILL.md
            </button>
          )}
        </div>

        {/* Requirements section */}
        {hasReqs && (
          <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground/90"><Package className="h-4 w-4 text-amber-400" />Requirements</h3>
            <div className="space-y-2">
              {detail.requirements.bins.length > 0 && (
                <div className="flex items-start gap-3">
                  <Terminal className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">CLI tools required</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.bins.map((b) => {
                      const isMissing = detail.missing.bins.includes(b);
                      return (<span key={b} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-mono", isMissing ? "border-red-500/20 bg-red-500/[0.06] text-red-400" : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{b}</span>);
                    })}</div>
                  </div>
                </div>
              )}
              {detail.requirements.env.length > 0 && (
                <div className="flex items-start gap-3">
                  <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">Environment variables</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.env.map((e) => {
                      const isMissing = detail.missing.env.includes(e);
                      return (<span key={e} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-mono", isMissing ? "border-red-500/20 bg-red-500/[0.06] text-red-400" : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{e}</span>);
                    })}</div>
                  </div>
                </div>
              )}
              {detail.requirements.config.length > 0 && (
                <div className="flex items-start gap-3">
                  <Wrench className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">Config keys</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.config.map((c) => {
                      const isMissing = detail.missing.config.includes(c);
                      return (<span key={c} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]", isMissing ? "border-red-500/20 bg-red-500/[0.06] text-red-400" : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{c}</span>);
                    })}</div>
                  </div>
                </div>
              )}
              {detail.requirements.os.length > 0 && (
                <div className="flex items-start gap-3">
                  <Cpu className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">Operating system</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.os.map((o) => {
                      const isMissing = detail.missing.os.includes(o);
                      return (<span key={o} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]", isMissing ? "border-red-500/20 bg-red-500/[0.06] text-red-400" : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{o}</span>);
                    })}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Install options */}
        {missing && detail.install.length > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-amber-300"><Download className="h-4 w-4" />Install Missing Dependencies</h3>
            <div className="space-y-2">{detail.install.map((inst) => {
              const supportedKinds = ["brew", "npm", "pip"];
              const canInstall = supportedKinds.includes(inst.kind) && inst.bins && inst.bins.length > 0;
              return (
                <div key={inst.id} className="flex items-center justify-between rounded-lg border border-foreground/[0.06] bg-muted/50 px-4 py-3">
                  <div>
                    <p className="text-[12px] font-medium text-foreground/90">{inst.label}</p>
                    <p className="text-[10px] text-muted-foreground">Method: {inst.kind}{inst.bins ? " \u2022 Installs: " + inst.bins.join(", ") : ""}</p>
                  </div>
                  {canInstall ? (
                    <button
                      onClick={() => setInstallTerminal({ kind: inst.kind, pkg: inst.bins![0], label: inst.label })}
                      disabled={installTerminal !== null}
                      className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      <Terminal className="h-3 w-3" />Install
                    </button>
                  ) : (
                    <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">Manual</span>
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
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
            <p className="flex items-center gap-2 text-[13px] font-medium text-emerald-300"><CheckCircle className="h-4 w-4" />All requirements met — this skill is active and available to your agents.</p>
          </div>
        )}

        {/* Skill config */}
        {detail.skillConfig && Object.keys(detail.skillConfig).length > 0 && (
          <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 space-y-2">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground/90"><Settings2 className="h-4 w-4 text-muted-foreground" />Configuration</h3>
            <p className="text-[11px] text-muted-foreground">Current tool config for <code className="rounded bg-foreground/[0.06] px-1 text-muted-foreground">tools.{detail.skillKey || detail.name}</code></p>
            <pre className="rounded-lg bg-muted p-3 text-[11px] text-muted-foreground overflow-auto max-h-[300px]">{JSON.stringify(detail.skillConfig, null, 2)}</pre>
          </div>
        )}

        {/* File info */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 space-y-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground/90"><Info className="h-4 w-4 text-muted-foreground" />Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-foreground/[0.04] bg-muted/50 px-3 py-2"><p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60">Skill Key</p><p className="text-[12px] font-mono text-foreground/70 mt-0.5">{detail.skillKey || detail.name}</p></div>
            <div className="rounded-lg border border-foreground/[0.04] bg-muted/50 px-3 py-2"><p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60">Source</p><p className="text-[12px] text-foreground/70 mt-0.5">{detail.source}</p></div>
            <div className="col-span-2 rounded-lg border border-foreground/[0.04] bg-muted/50 px-3 py-2"><p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60">File Path</p><p className="text-[11px] font-mono text-muted-foreground mt-0.5 break-all">{detail.filePath}</p></div>
            <div className="col-span-2 rounded-lg border border-foreground/[0.04] bg-muted/50 px-3 py-2"><p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60">Base Directory</p><p className="text-[11px] font-mono text-muted-foreground mt-0.5 break-all">{detail.baseDir}</p></div>
          </div>
        </div>

        {/* SKILL.md content */}
        {showMd && detail.skillMd && (
          <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground/90"><FileText className="h-4 w-4 text-muted-foreground" />SKILL.md</h3>
              <button onClick={() => setShowMd(false)} className="rounded p-1 text-muted-foreground hover:text-foreground/70"><X className="h-3.5 w-3.5" /></button>
            </div>
            <pre className="max-h-[500px] overflow-auto rounded-lg bg-muted p-4 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">{detail.skillMd}</pre>
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
  const [loading, setLoading] = useState(true);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const fetchInstalled = useCallback(async () => {
    try {
      const res = await fetch("/api/skills/clawhub?action=list");
      const data = await res.json();
      const map: Record<string, string> = {};
      for (const row of data.items || []) {
        const slug = String((row as { slug?: string }).slug || "");
        const version = String((row as { version?: string }).version || "");
        if (slug) map[slug] = version;
      }
      setInstalled(map);
    } catch {
      setInstalled({});
    }
  }, []);

  const fetchExplore = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/skills/clawhub?action=explore&limit=28&sort=trending");
      const data = await res.json();
      const normalized: ClawHubItem[] = (data.items || []).map((item: {
        slug?: string;
        displayName?: string;
        summary?: string;
        latestVersion?: { version?: string };
        stats?: { downloads?: number; installsCurrent?: number; stars?: number };
        updatedAt?: number;
      }) => ({
        slug: String(item.slug || ""),
        displayName: item.displayName || undefined,
        summary: item.summary || "",
        version: item.latestVersion?.version || "latest",
        downloads: item.stats?.downloads || 0,
        installsCurrent: item.stats?.installsCurrent || 0,
        stars: item.stats?.stars || 0,
        updatedAt: item.updatedAt,
      })).filter((item: ClawHubItem) => item.slug);
      setItems(normalized);
    } catch {
      setItems([]);
    }
    setLoading(false);
  }, []);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setMode("search");
    try {
      const res = await fetch(`/api/skills/clawhub?action=search&q=${encodeURIComponent(query)}&limit=28`);
      const data = await res.json();
      const normalized: ClawHubItem[] = (data.items || []).map((item: {
        slug?: string;
        version?: string;
        summary?: string;
        score?: number;
      }) => ({
        slug: String(item.slug || ""),
        version: item.version || "latest",
        summary: item.summary || "",
        score: typeof item.score === "number" ? item.score : undefined,
      })).filter((item: ClawHubItem) => item.slug);
      setItems(normalized);
    } catch {
      setItems([]);
    }
    setLoading(false);
  }, [query]);

  const installSkill = useCallback(async (slug: string, version?: string) => {
    setBusySlug(slug);
    try {
      const res = await fetch("/api/skills/clawhub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", slug, version }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        onAction(`Error: ${data.error || "install failed"}`);
      } else {
        onAction(`Installed ${slug}`);
        await fetchInstalled();
        await onInstalled(slug);
      }
    } catch (err) {
      onAction(`Error: ${String(err)}`);
    }
    setBusySlug(null);
  }, [fetchInstalled, onAction, onInstalled]);

  const updateSkill = useCallback(async (slug: string) => {
    setBusySlug(slug);
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
  }, [fetchInstalled, onAction, onInstalled]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchInstalled();
      void fetchExplore();
    });
  }, [fetchExplore, fetchInstalled]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden px-4 md:px-6 pb-6">
      <div className="mb-4 rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] px-4 py-3">
        <p className="text-[12px] text-muted-foreground/85">
          Bundled skills ship with OpenClaw. ClawHub installs workspace skills into <code className="rounded bg-foreground/[0.06] px-1">workspace/skills</code>.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-foreground/[0.08] bg-muted/50 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          <input
            placeholder="Search ClawHub skills..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60 text-foreground/70"
          />
        </div>
        <button type="button" onClick={() => void runSearch()} className="rounded-lg border border-foreground/[0.08] px-3 py-2 text-[11px] text-muted-foreground hover:bg-muted/80">
          Search
        </button>
        <button type="button" onClick={() => { setMode("trending"); void fetchExplore(); }} className="rounded-lg border border-foreground/[0.08] px-3 py-2 text-[11px] text-muted-foreground hover:bg-muted/80">
          Trending
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground/70">
        <p>{mode === "search" ? `Search results (${items.length})` : `Trending skills (${items.length})`}</p>
        <p>{Object.keys(installed).length} installed via ClawHub</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-violet-400" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] px-4 py-8 text-center text-[12px] text-muted-foreground/70">
            No skills found.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {items.map((item) => {
              const installedVersion = installed[item.slug];
              const isInstalled = Boolean(installedVersion);
              const isBusy = busySlug === item.slug;
              return (
                <div key={item.slug} className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-foreground/90">{item.displayName || item.slug}</p>
                      <p className="truncate text-[10px] text-muted-foreground/60">{item.slug}</p>
                    </div>
                    <span className={cn("rounded border px-1.5 py-0.5 text-[9px] font-medium", isInstalled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-foreground/[0.08] bg-muted/70 text-muted-foreground")}>
                      {isInstalled ? `Installed ${installedVersion}` : `v${item.version || "latest"}`}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[11px] leading-[1.45] text-muted-foreground">{item.summary || "No summary available."}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
                      {typeof item.score === "number" && <span>score {item.score.toFixed(3)}</span>}
                      {typeof item.downloads === "number" && <span>{item.downloads} downloads</span>}
                      {typeof item.stars === "number" && <span>{item.stars} stars</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isInstalled && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void updateSkill(item.slug)}
                          className="rounded-md border border-foreground/[0.08] px-2.5 py-1 text-[10px] text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
                        >
                          {isBusy ? "Working..." : "Update"}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void installSkill(item.slug, item.version)}
                        className="rounded-md bg-violet-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                      >
                        {isBusy ? "Working..." : isInstalled ? "Reinstall" : "Install"}
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

export function SkillsView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SkillsFilter>("all");
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null);
  const tab: "skills" | "clawhub" =
    (searchParams.get("tab") || "").toLowerCase() === "clawhub" ? "clawhub" : "skills";

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, checkRes] = await Promise.all([
        fetch("/api/skills").then((r) => r.json()),
        fetch("/api/skills?action=check").then((r) => r.json()),
      ]);
      setSkills(listRes.skills || []);
      setSummary(checkRes.summary || null);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { queueMicrotask(() => fetchAll()); }, [fetchAll]);

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
    params.set("section", "skills");
    if (next === "clawhub") params.set("tab", "clawhub");
    else params.delete("tab");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>;

  // Detail view
  if (selectedSkill) {
    return (
      <>
        <SkillDetailPanel name={selectedSkill} onBack={() => setSelectedSkill(null)} onAction={handleAction} />
        {toast && <ToastBar toast={toast} onDone={() => setToast(null)} />}
      </>
    );
  }

  const bundledCount = skills.filter((s) => getSkillOrigin(s) === "bundled").length;
  const workspaceCount = skills.filter((s) => getSkillOrigin(s) === "workspace").length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 md:px-6 pt-5 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[18px] font-semibold text-foreground flex items-center gap-2"><Wrench className="h-5 w-5 text-violet-400" />Skills</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">Browse, install, and configure OpenClaw skills. Click any skill for details.</p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">Skills are grouped by origin (Bundled vs Workspace vs Shared Local). Configured state and runtime availability are shown separately.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-foreground/[0.08] bg-muted/50 p-1">
              <button
                type="button"
                onClick={() => switchTab("skills")}
                className={cn("rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors", tab === "skills" ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:text-foreground/80")}
              >
                Local Skills
              </button>
              <button
                type="button"
                onClick={() => switchTab("clawhub")}
                className={cn("rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors", tab === "clawhub" ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:text-foreground/80")}
              >
                ClawHub
              </button>
            </div>
            <button type="button" onClick={fetchAll} className="flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/80"><RefreshCw className="h-3 w-3" />Refresh</button>
          </div>
        </div>

        {/* Summary */}
        {tab === "skills" && summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <SumCard value={summary.total} label="Total" color="text-foreground/90" />
            <SumCard value={summary.eligible} label="Ready" color="text-emerald-400" border="border-emerald-500/20" bg="bg-emerald-500/5" />
            <SumCard value={bundledCount} label="Bundled" color="text-sky-400" border="border-sky-500/20" bg="bg-sky-500/5" />
            <SumCard value={workspaceCount} label="Workspace" color="text-violet-400" border="border-violet-500/20" bg="bg-violet-500/5" />
            <SumCard value={summary.missingRequirements} label="Missing Deps" color="text-amber-400" border="border-amber-500/20" bg="bg-amber-500/5" />
            <SumCard value={summary.disabled} label="Disabled" color="text-red-400" border="border-red-500/20" bg="bg-red-500/5" />
          </div>
        )}

        {/* Search + filter */}
        {tab === "skills" && <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-foreground/[0.08] bg-muted/50 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            <input placeholder="Search skills..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60 text-foreground/70" />
            {search && <button onClick={() => setSearch("")} className="text-muted-foreground/60 hover:text-muted-foreground"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="flex gap-1">{(["all", "eligible", "unavailable", "bundled", "workspace"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors", filter === f ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:bg-muted/80 hover:text-muted-foreground")}>
              {f === "all" ? "All" : f === "eligible" ? "Ready" : f === "unavailable" ? "Unavailable" : f === "bundled" ? "Bundled" : "Workspace"}
            </button>
          ))}</div>
        </div>}
      </div>

      {tab === "skills" && <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-6">
        <div className="space-y-5">
          {grouped.map((section) => (
            <section key={section.origin} className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] p-3.5">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-foreground/[0.05] pb-3">
                <div>
                  <h3 className="text-[13px] font-semibold text-foreground/90">{section.title} <span className="text-muted-foreground/60">({section.skills.length})</span></h3>
                  <p className="mt-1 text-[11px] text-muted-foreground/75">{section.description}</p>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">{section.ready} ready</span>
                  <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">{section.needsSetup} needs setup</span>
                  <span className="rounded border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 text-red-300">{section.disabled} configured off</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {section.skills.map((s) => (
                  <SkillCard
                    key={s.name}
                    skill={s}
                    onClick={() => setSelectedSkill(s.name)}
                    onToggle={(enabled) => handleToggleSkill(s.name, enabled)}
                    toggling={togglingSkill === s.name}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <Search className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-[13px] text-muted-foreground">No skills match your search</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">Try different keywords or change the filter.</p>
          </div>
        )}
      </div>}

      {tab === "clawhub" && (
        <ClawHubPanel
          onAction={handleAction}
          onInstalled={handleClawHubInstalled}
        />
      )}
      {toast && <ToastBar toast={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

/* ── Summary Card ───────────────────────────────── */

function SumCard({ value, label, color, border, bg }: { value: number; label: string; color: string; border?: string; bg?: string }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2", border || "border-foreground/[0.06]", bg || "bg-foreground/[0.02]")}>
      <p className={cn("text-lg font-semibold", color)}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
