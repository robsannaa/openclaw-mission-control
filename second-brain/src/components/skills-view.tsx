"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  CheckCircle, XCircle, ExternalLink, Search, RefreshCw,
  AlertTriangle, ChevronRight, X, Loader2, Check, Download,
  Settings2, ToggleLeft, ToggleRight, Package, Shield, Cpu,
  FileText, Terminal, FolderOpen, Globe, Wrench, ArrowLeft,
  Zap, Info, Power,
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
  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
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

/* ── Skill Card (list view) ─────────────────────── */

function SkillCard({ skill, onClick }: { skill: Skill; onClick: () => void }) {
  const missing = hasMissing(skill.missing);
  return (
    <button type="button" onClick={onClick} className={cn("w-full rounded-xl border p-3.5 text-left transition-all hover:scale-[1.01]", skill.eligible ? "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]" : "border-white/[0.04] bg-white/[0.01] opacity-70 hover:opacity-100 hover:border-white/[0.08]")}>
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none mt-0.5">{skill.emoji || "\u26A1"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-zinc-200">{skill.name}</p>
            {skill.eligible ? <CheckCircle className="h-3 w-3 shrink-0 text-emerald-500" /> : <XCircle className="h-3 w-3 shrink-0 text-zinc-600" />}
            {skill.disabled && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[8px] text-zinc-500">DISABLED</span>}
            {skill.always && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[8px] text-amber-400">ALWAYS</span>}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.5] text-zinc-500">{skill.description}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className={cn("rounded border px-1.5 py-0.5 text-[9px] font-medium", sourceColor(skill.source))}>{sourceLabel(skill.source)}</span>
            {missing && <span className="flex items-center gap-0.5 text-[9px] text-amber-400"><AlertTriangle className="h-2.5 w-2.5" />{skill.missing.bins.length + skill.missing.env.length + skill.missing.config.length} missing</span>}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-700 mt-1" />
      </div>
    </button>
  );
}

/* ── Skill Detail Panel ─────────────────────────── */

function SkillDetailPanel({ name, onBack, onAction }: { name: string; onBack: () => void; onAction: (msg: string) => void }) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showMd, setShowMd] = useState(false);

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
  if (!detail) return <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">Skill not found</div>;

  const missing = hasMissing(detail.missing);
  const hasReqs = hasMissing(detail.requirements);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Back + header */}
      <div className="shrink-0 border-b border-white/[0.06] px-6 py-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 mb-3"><ArrowLeft className="h-3.5 w-3.5" />Back to Skills</button>
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-3xl">{detail.emoji || "\u26A1"}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-[20px] font-semibold text-zinc-100">{detail.name}</h1>
              {detail.eligible ? <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300"><CheckCircle className="h-3 w-3" />Ready</span> : <span className="flex items-center gap-1 rounded-full bg-zinc-700/50 px-2.5 py-0.5 text-[10px] font-semibold text-zinc-400"><XCircle className="h-3 w-3" />Not ready</span>}
              {detail.disabled && <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-red-400">Disabled</span>}
              {detail.always && <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300">Always active</span>}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{detail.description}</p>
            <div className="mt-2 flex items-center gap-3 text-[11px]">
              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", sourceColor(detail.source))}>{sourceLabel(detail.source)}</span>
              {detail.homepage && <a href={detail.homepage} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-violet-400 hover:underline"><Globe className="h-3 w-3" />Homepage</a>}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Actions bar */}
        <div className="flex flex-wrap items-center gap-2">
          {detail.disabled ? (
            <button onClick={() => doAction("enable-skill", { name: detail.name })} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[12px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              {busy === "enable-skill" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ToggleRight className="h-3.5 w-3.5" />}Enable Skill
            </button>
          ) : (
            <button onClick={() => doAction("disable-skill", { name: detail.name })} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-4 py-2 text-[12px] font-medium text-red-400 hover:bg-red-500/[0.12] disabled:opacity-50">
              {busy === "disable-skill" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ToggleLeft className="h-3.5 w-3.5" />}Disable Skill
            </button>
          )}
          {detail.skillMd && (
            <button onClick={() => setShowMd(!showMd)} className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-2 text-[12px] font-medium text-zinc-300 hover:bg-white/[0.1]">
              <FileText className="h-3.5 w-3.5" />{showMd ? "Hide" : "View"} SKILL.md
            </button>
          )}
        </div>

        {/* Requirements section */}
        {hasReqs && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200"><Package className="h-4 w-4 text-amber-400" />Requirements</h3>
            <div className="space-y-2">
              {detail.requirements.bins.length > 0 && (
                <div className="flex items-start gap-3">
                  <Terminal className="h-4 w-4 shrink-0 text-zinc-500 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-zinc-400">CLI tools required</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.bins.map((b) => {
                      const isMissing = detail.missing.bins.includes(b);
                      return (<span key={b} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-mono", isMissing ? "border-red-500/20 bg-red-500/[0.06] text-red-400" : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{b}</span>);
                    })}</div>
                  </div>
                </div>
              )}
              {detail.requirements.env.length > 0 && (
                <div className="flex items-start gap-3">
                  <Settings2 className="h-4 w-4 shrink-0 text-zinc-500 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-zinc-400">Environment variables</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.env.map((e) => {
                      const isMissing = detail.missing.env.includes(e);
                      return (<span key={e} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-mono", isMissing ? "border-red-500/20 bg-red-500/[0.06] text-red-400" : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{e}</span>);
                    })}</div>
                  </div>
                </div>
              )}
              {detail.requirements.config.length > 0 && (
                <div className="flex items-start gap-3">
                  <Wrench className="h-4 w-4 shrink-0 text-zinc-500 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-zinc-400">Config keys</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{detail.requirements.config.map((c) => {
                      const isMissing = detail.missing.config.includes(c);
                      return (<span key={c} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]", isMissing ? "border-red-500/20 bg-red-500/[0.06] text-red-400" : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400")}>{isMissing ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}{c}</span>);
                    })}</div>
                  </div>
                </div>
              )}
              {detail.requirements.os.length > 0 && (
                <div className="flex items-start gap-3">
                  <Cpu className="h-4 w-4 shrink-0 text-zinc-500 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-zinc-400">Operating system</p>
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
            <div className="space-y-2">{detail.install.map((inst) => (
              <div key={inst.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/20 px-4 py-3">
                <div>
                  <p className="text-[12px] font-medium text-zinc-200">{inst.label}</p>
                  <p className="text-[10px] text-zinc-500">Method: {inst.kind}{inst.bins ? " \u2022 Installs: " + inst.bins.join(", ") : ""}</p>
                </div>
                {inst.kind === "brew" && inst.bins && inst.bins.length > 0 && (
                  <button onClick={() => doAction("install-brew", { package: inst.bins![0] })} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
                    {busy === "install-brew" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}Install
                  </button>
                )}
                {inst.kind !== "brew" && (
                  <span className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-500">Manual</span>
                )}
              </div>
            ))}</div>
          </div>
        )}

        {/* All good */}
        {!missing && detail.eligible && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
            <p className="flex items-center gap-2 text-[13px] font-medium text-emerald-300"><CheckCircle className="h-4 w-4" />All requirements met — this skill is active and available to your agents.</p>
          </div>
        )}

        {/* Skill config */}
        {detail.skillConfig && Object.keys(detail.skillConfig).length > 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200"><Settings2 className="h-4 w-4 text-zinc-400" />Configuration</h3>
            <p className="text-[11px] text-zinc-500">Current tool config for <code className="rounded bg-white/[0.06] px-1 text-zinc-400">tools.{detail.skillKey || detail.name}</code></p>
            <pre className="rounded-lg bg-black/30 p-3 text-[11px] text-zinc-400 overflow-auto max-h-[300px]">{JSON.stringify(detail.skillConfig, null, 2)}</pre>
          </div>
        )}

        {/* File info */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200"><Info className="h-4 w-4 text-zinc-400" />Details</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2"><p className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">Skill Key</p><p className="text-[12px] font-mono text-zinc-300 mt-0.5">{detail.skillKey || detail.name}</p></div>
            <div className="rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2"><p className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">Source</p><p className="text-[12px] text-zinc-300 mt-0.5">{detail.source}</p></div>
            <div className="col-span-2 rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2"><p className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">File Path</p><p className="text-[11px] font-mono text-zinc-400 mt-0.5 break-all">{detail.filePath}</p></div>
            <div className="col-span-2 rounded-lg border border-white/[0.04] bg-black/20 px-3 py-2"><p className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">Base Directory</p><p className="text-[11px] font-mono text-zinc-400 mt-0.5 break-all">{detail.baseDir}</p></div>
          </div>
        </div>

        {/* SKILL.md content */}
        {showMd && detail.skillMd && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200"><FileText className="h-4 w-4 text-zinc-400" />SKILL.md</h3>
              <button onClick={() => setShowMd(false)} className="rounded p-1 text-zinc-500 hover:text-zinc-300"><X className="h-3.5 w-3.5" /></button>
            </div>
            <pre className="max-h-[500px] overflow-auto rounded-lg bg-black/30 p-4 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap break-words">{detail.skillMd}</pre>
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

  useEffect(() => { fetchAll(); }, [fetchAll]);

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
    setToast({ msg, type: msg.startsWith("Error") ? "error" : "success" });
    fetchAll(); // Refresh list after action
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
      <div className="shrink-0 px-6 pt-5 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[18px] font-semibold text-zinc-100 flex items-center gap-2"><Wrench className="h-5 w-5 text-violet-400" />Skills</h2>
            <p className="text-[12px] text-zinc-500 mt-0.5">Browse, install, and configure OpenClaw skills. Click any skill for details.</p>
          </div>
          <button type="button" onClick={fetchAll} className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800/60"><RefreshCw className="h-3 w-3" />Refresh</button>
        </div>

        {/* Summary */}
        {summary && (
          <div className="grid grid-cols-5 gap-2">
            <SumCard value={summary.total} label="Total" color="text-zinc-200" />
            <SumCard value={summary.eligible} label="Ready" color="text-emerald-400" border="border-emerald-500/20" bg="bg-emerald-500/5" />
            <SumCard value={summary.missingRequirements} label="Missing Deps" color="text-amber-400" border="border-amber-500/20" bg="bg-amber-500/5" />
            <SumCard value={installedCount} label="Installed" color="text-violet-400" border="border-violet-500/20" bg="bg-violet-500/5" />
            <SumCard value={summary.disabled} label="Disabled" color="text-red-400" border="border-red-500/20" bg="bg-red-500/5" />
          </div>
        )}

        {/* Search + filter */}
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-zinc-600" />
            <input placeholder="Search skills..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-zinc-600 text-zinc-300" />
            {search && <button onClick={() => setSearch("")} className="text-zinc-600 hover:text-zinc-400"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="flex gap-1">{(["all", "eligible", "missing", "installed"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors", filter === f ? "bg-violet-500/15 text-violet-300" : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-400")}>
              {f === "all" ? "All" : f === "eligible" ? "Ready" : f === "missing" ? "Missing" : "Installed"}
            </button>
          ))}</div>
        </div>
      </div>

      {/* Skills grid */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => <SkillCard key={s.name} skill={s} onClick={() => setSelectedSkill(s.name)} />)}
        </div>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <Search className="h-8 w-8 text-zinc-700 mb-3" />
            <p className="text-[13px] text-zinc-500">No skills match your search</p>
            <p className="text-[11px] text-zinc-600 mt-1">Try different keywords or change the filter.</p>
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
    <div className={cn("rounded-lg border px-3 py-2", border || "border-white/[0.06]", bg || "bg-white/[0.02]")}>
      <p className={cn("text-lg font-semibold", color)}>{value}</p>
      <p className="text-[10px] text-zinc-500">{label}</p>
    </div>
  );
}
