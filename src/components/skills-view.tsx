"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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

type SkillDetail = Skill & {
  filePath: string; baseDir: string; skillKey: string; always: boolean;
  requirements: Missing; install: InstallOption[];
  configChecks: unknown[]; skillMd?: string | null;
  skillConfig?: Record<string, unknown> | null;
};

type Summary = { total: number; eligible: number; disabled: number; blocked: number; missingRequirements: number };
type Toast = { msg: string; type: "success" | "error" };

/* ── Helpers ────────────────────────────────────── */

function hasMissing(m: Missing): boolean {
  return m.bins.length > 0 || m.anyBins.length > 0 || m.env.length > 0 || m.config.length > 0 || m.os.length > 0;
}

function sourceLabel(source: string): string {
  if (source === "openclaw-bundled") return "Bundled";
  if (source === "openclaw-workspace") return "Installed";
  return source;
}

function sourceColor(source: string): string {
  if (source === "openclaw-bundled") return "bg-sky-500/10 text-sky-400 border-sky-500/20";
  if (source === "openclaw-workspace") return "bg-violet-500/10 text-violet-400 border-violet-500/20";
  return "bg-zinc-500/10 text-muted-foreground border-zinc-500/20";
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
  if (skill.disabled) return { label: "Disabled", color: "text-muted-foreground/50", toggleColor: "default" };
  if (skill.eligible) return { label: "Active", color: "text-emerald-400", toggleColor: "green" };
  if (hasMissing(skill.missing)) return { label: "Not ready", color: "text-amber-400/80", toggleColor: "amber" };
  return { label: "Inactive", color: "text-muted-foreground/60", toggleColor: "default" };
}

function SkillCard({ skill, onClick, onToggle, toggling }: { skill: Skill; onClick: () => void; onToggle: (enabled: boolean) => void; toggling?: boolean }) {
  const missing = hasMissing(skill.missing);
  const status = skillStatus(skill);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={cn("w-full cursor-pointer rounded-xl border p-3.5 text-left transition-all hover:scale-[1.01]", skill.disabled ? "border-foreground/[0.04] bg-foreground/[0.01] opacity-60 hover:opacity-90" : skill.eligible ? "border-foreground/[0.06] bg-foreground/[0.02] hover:border-foreground/[0.12]" : "border-foreground/[0.04] bg-foreground/[0.01] opacity-70 hover:opacity-100 hover:border-foreground/[0.08]")}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none mt-0.5">{skill.emoji || "\u26A1"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("text-[13px] font-semibold", skill.disabled ? "text-foreground/50 line-through" : "text-foreground/90")}>{skill.name}</p>
            {skill.disabled ? (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[8px] font-medium text-red-400/80">DISABLED</span>
            ) : skill.eligible ? (
              <CheckCircle className="h-3 w-3 shrink-0 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400/70" />
            )}
            {skill.always && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[8px] text-amber-400">ALWAYS</span>}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.5] text-muted-foreground">{skill.description}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className={cn("rounded border px-1.5 py-0.5 text-[9px] font-medium", sourceColor(skill.source))}>{sourceLabel(skill.source)}</span>
            {!skill.disabled && missing && (
              <span className="flex items-center gap-0.5 text-[9px] text-amber-400">
                <AlertTriangle className="h-2.5 w-2.5" />
                {skill.missing.bins.length + skill.missing.env.length + skill.missing.config.length} missing
              </span>
            )}
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
  const hasReqs = hasMissing(detail.requirements);

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
              {detail.eligible ? <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300"><CheckCircle className="h-3 w-3" />Ready</span> : <span className="flex items-center gap-1 rounded-full bg-muted/70 px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground"><XCircle className="h-3 w-3" />Not ready</span>}
              {detail.disabled && <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-red-400">Disabled</span>}
              {detail.always && <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300">Always active</span>}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{detail.description}</p>
            <div className="mt-2 flex items-center gap-3 text-[11px]">
              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", sourceColor(detail.source))}>{sourceLabel(detail.source)}</span>
              {detail.homepage && <a href={detail.homepage} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-violet-400 hover:underline"><Globe className="h-3 w-3" />Homepage</a>}
            </div>
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
                  color={detail.disabled ? "default" : detail.eligible ? "green" : "amber"}
                />
              )}
              <div>
                <p className={cn("text-[12px] font-medium", detail.disabled ? "text-muted-foreground" : detail.eligible ? "text-emerald-400" : "text-amber-400")}>
                  {detail.disabled ? "Disabled" : detail.eligible ? "Active" : "Not ready"}
                </p>
                <p className="text-[10px] text-muted-foreground/60">
                  {detail.disabled
                    ? "Skill won\u2019t be used by agents"
                    : detail.eligible
                      ? "All requirements met \u2014 skill is available to agents"
                      : "Enabled but missing dependencies \u2014 install them below"}
                </p>
              </div>
            </div>
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

/* ── Main SkillsView ────────────────────────────── */

export function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "eligible" | "missing" | "installed">("all");
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null);

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
    if (filter === "missing") return !s.eligible;
    if (filter === "installed") return s.source === "openclaw-workspace";
    return true;
  }), [skills, search, filter]);

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

  const installedCount = skills.filter((s) => s.source === "openclaw-workspace").length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 md:px-6 pt-5 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[18px] font-semibold text-foreground flex items-center gap-2"><Wrench className="h-5 w-5 text-violet-400" />Skills</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">Browse, install, and configure OpenClaw skills. Click any skill for details.</p>
          </div>
          <button type="button" onClick={fetchAll} className="flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/80"><RefreshCw className="h-3 w-3" />Refresh</button>
        </div>

        {/* Summary */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <SumCard value={summary.total} label="Total" color="text-foreground/90" />
            <SumCard value={summary.eligible} label="Ready" color="text-emerald-400" border="border-emerald-500/20" bg="bg-emerald-500/5" />
            <SumCard value={summary.missingRequirements} label="Missing Deps" color="text-amber-400" border="border-amber-500/20" bg="bg-amber-500/5" />
            <SumCard value={installedCount} label="Installed" color="text-violet-400" border="border-violet-500/20" bg="bg-violet-500/5" />
            <SumCard value={summary.disabled} label="Disabled" color="text-red-400" border="border-red-500/20" bg="bg-red-500/5" />
          </div>
        )}

        {/* Search + filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-foreground/[0.08] bg-muted/50 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            <input placeholder="Search skills..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60 text-foreground/70" />
            {search && <button onClick={() => setSearch("")} className="text-muted-foreground/60 hover:text-muted-foreground"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="flex gap-1">{(["all", "eligible", "missing", "installed"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors", filter === f ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:bg-muted/80 hover:text-muted-foreground")}>
              {f === "all" ? "All" : f === "eligible" ? "Ready" : f === "missing" ? "Missing" : "Installed"}
            </button>
          ))}</div>
        </div>
      </div>

      {/* Skills grid */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-6">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <SkillCard
              key={s.name}
              skill={s}
              onClick={() => setSelectedSkill(s.name)}
              onToggle={(enabled) => handleToggleSkill(s.name, enabled)}
              toggling={togglingSkill === s.name}
            />
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <Search className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-[13px] text-muted-foreground">No skills match your search</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">Try different keywords or change the filter.</p>
          </div>
        )}
      </div>
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
