"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  BarChart3,
  Zap,
  ArrowUp,
  ArrowDown,
  Cpu,
  Clock,
  Users,
  MessageSquare,
  TrendingUp,
  Activity,
  Gauge,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Layers,
  HardDrive,
  Shield,
  Key,
  Hash,
  Target,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── types ─────────────────────────────────────── */

type Bucket = { input: number; output: number; total: number; sessions: number };

type ModelBreakdown = {
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  agents: string[];
  lastUsed: number;
  avgPercentUsed: number;
};

type AgentBreakdown = {
  agentId: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  models: string[];
  lastUsed: number;
};

type SessionEntry = {
  key: string;
  kind: string;
  updatedAt: number;
  ageMs: number;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  contextTokens: number;
  percentUsed?: number;
  remainingTokens?: number;
  agentId: string;
  thinkingLevel?: string;
};

type AuthProvider = { provider: string; authKind: string; profiles: number };

type UsageData = {
  totals: {
    sessions: number; inputTokens: number; outputTokens: number;
    totalTokens: number; models: number; agents: number;
  };
  buckets: { last1h: Bucket; last24h: Bucket; last7d: Bucket; allTime: Bucket };
  modelBreakdown: ModelBreakdown[];
  agentBreakdown: AgentBreakdown[];
  sessions: SessionEntry[];
  peakSession: {
    sessionId: string; key: string; agentId: string; model: string;
    totalTokens: number; contextTokens: number; percentUsed?: number;
  } | null;
  modelConfig: {
    primary: string; fallbacks: string[]; imageModel: string;
    aliases: Record<string, string>; allowed: string[];
    authProviders: AuthProvider[];
  } | null;
  agentModels: { agentId: string; primary: string; fallbacks: string[] }[];
  sessionFileSizes: { agentId: string; sizeBytes: number; fileCount: number }[];
};

/* ── helpers ───────────────────────────────────── */

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + "K";
  return (n / 1_000_000).toFixed(2) + "M";
}

function fmtTokensLong(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function fmtAgo(ms: number): string {
  if (!ms) return "Never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h ago";
  return Math.floor(diff / 86_400_000) + "d ago";
}

function shortModel(m: string): string {
  return m.split("/").pop() || m;
}

function tokenRatio(input: number, output: number) {
  const sum = input + output;
  if (sum === 0) return { inPct: 50, outPct: 50 };
  return { inPct: Math.round((input / sum) * 100), outPct: Math.round((output / sum) * 100) };
}

const MODEL_COLORS: Record<string, string> = {
  "gpt-5.3-codex": "from-emerald-500 to-teal-600",
  "claude-sonnet-4-5": "from-orange-500 to-amber-600",
  "claude-opus-4-6": "from-red-500 to-pink-600",
  "MiniMax-M2.5": "from-pink-500 to-rose-600",
};

function modelColor(m: string): string {
  return MODEL_COLORS[shortModel(m)] || "from-zinc-500 to-zinc-600";
}

/* ── small components ──────────────────────────── */

function TokenBar({ input, output, total, maxTotal }: {
  input: number; output: number; total: number; maxTotal: number;
}) {
  const widthPct = maxTotal > 0 ? Math.max((total / maxTotal) * 100, 2) : 0;
  const { inPct, outPct } = tokenRatio(input, output);
  return (
    <div className="h-3 overflow-hidden rounded-full bg-white/[0.04]">
      <div className="flex h-full transition-all duration-500" style={{ width: widthPct + "%" }}>
        <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400" style={{ width: inPct + "%" }} title={"Input: " + fmtTokensLong(input)} />
        <div className="h-full bg-gradient-to-r from-violet-500 to-violet-400" style={{ width: outPct + "%" }} title={"Output: " + fmtTokensLong(output)} />
      </div>
    </div>
  );
}

function ContextGauge({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const color = pct > 80 ? "text-red-400" : pct > 50 ? "text-amber-400" : "text-emerald-400";
  const barColor = pct > 80 ? "from-red-500 to-red-400" : pct > 50 ? "from-amber-500 to-amber-400" : "from-emerald-500 to-emerald-400";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-zinc-600">Context Window</span>
        <span className={cn("font-mono font-semibold", color)}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", barColor)} style={{ width: pct + "%" }} />
      </div>
      <div className="flex items-center justify-between text-[9px] text-zinc-700">
        <span>{fmtTokens(used)} used</span>
        <span>{fmtTokens(total)} max</span>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-zinc-900/60 p-4">
      <div className="flex items-center gap-2.5">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", accent || "bg-white/[0.04]")}>{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-zinc-600">{label}</p>
          <p className="text-lg font-bold text-zinc-100">{value}</p>
          {sub && <p className="text-[10px] text-zinc-600">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

/* ── Model Card ────────────────────────────────── */

function ModelCard({ m, maxTokens, isPrimary, isFallback, rank }: {
  m: ModelBreakdown; maxTokens: number; isPrimary: boolean; isFallback: boolean; rank: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { inPct, outPct } = tokenRatio(m.inputTokens, m.outputTokens);
  const shareOfTotal = maxTokens > 0 ? ((m.totalTokens / maxTokens) * 100).toFixed(1) : "0";

  return (
    <div className={cn("rounded-xl border transition-all", isPrimary ? "border-violet-500/20 bg-violet-500/[0.03]" : "border-white/[0.06] bg-zinc-900/50")}>
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-3 p-4 text-left">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-xs font-bold text-white", modelColor(m.model))}>#{rank}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-zinc-200">{shortModel(m.model)}</p>
            {isPrimary && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] font-semibold text-violet-400">PRIMARY</span>}
            {isFallback && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-400">FALLBACK</span>}
          </div>
          <p className="text-[10px] text-zinc-600">{m.sessions} sessions &bull; {m.agents.length} agent{m.agents.length !== 1 ? "s" : ""} &bull; Last used {fmtAgo(m.lastUsed)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-zinc-200">{fmtTokens(m.totalTokens)}</p>
          <p className="text-[10px] text-zinc-600">{shareOfTotal}% of total</p>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-zinc-600" /> : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />}
      </button>
      {expanded && (
        <div className="border-t border-white/[0.04] p-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-white/[0.03] p-3 text-center">
              <div className="flex items-center justify-center gap-1"><ArrowDown className="h-3 w-3 text-blue-400" /><p className="text-[10px] text-zinc-500">Input</p></div>
              <p className="mt-1 text-base font-bold text-blue-400">{fmtTokens(m.inputTokens)}</p>
              <p className="text-[9px] text-zinc-700">{fmtTokensLong(m.inputTokens)}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] p-3 text-center">
              <div className="flex items-center justify-center gap-1"><ArrowUp className="h-3 w-3 text-violet-400" /><p className="text-[10px] text-zinc-500">Output</p></div>
              <p className="mt-1 text-base font-bold text-violet-400">{fmtTokens(m.outputTokens)}</p>
              <p className="text-[9px] text-zinc-700">{fmtTokensLong(m.outputTokens)}</p>
            </div>
            <div className="rounded-lg bg-white/[0.03] p-3 text-center">
              <div className="flex items-center justify-center gap-1"><Gauge className="h-3 w-3 text-emerald-400" /><p className="text-[10px] text-zinc-500">Avg Context</p></div>
              <p className="mt-1 text-base font-bold text-emerald-400">{m.avgPercentUsed}%</p>
              <p className="text-[9px] text-zinc-700">of {fmtTokens(m.contextTokens)} window</p>
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10px] text-zinc-600">Input / Output ratio</p>
            <div className="flex h-4 overflow-hidden rounded-full">
              <div className="flex items-center justify-center bg-blue-500/80 text-[9px] font-semibold text-white" style={{ width: inPct + "%" }}>{inPct}%</div>
              <div className="flex items-center justify-center bg-violet-500/80 text-[9px] font-semibold text-white" style={{ width: outPct + "%" }}>{outPct}%</div>
            </div>
            <div className="mt-1 flex justify-between text-[9px]">
              <span className="text-blue-400">Input ({inPct}%)</span>
              <span className="text-violet-400">Output ({outPct}%)</span>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Used by Agents</p>
            <div className="flex flex-wrap gap-1.5">
              {m.agents.map((a) => <span key={a} className="rounded-md bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-zinc-300">{a}</span>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Session Row ───────────────────────────────── */

function SessionRow({ s }: { s: SessionEntry }) {
  const pct = s.contextTokens > 0 ? Math.round((s.totalTokens / s.contextTokens) * 100) : 0;
  const color = pct > 80 ? "text-red-400" : pct > 50 ? "text-amber-400" : "text-emerald-400";
  const barColor = pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500";
  const isCron = s.key.includes(":cron:");
  const sessionLabel = s.key.replace(/^agent:[^:]+:/, "").replace(/:run:.*$/, "").replace(/^cron:/, "Cron: ").replace(/^main$/, "Main conversation").slice(0, 50);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-zinc-900/30 px-3 py-2.5">
      <span className="shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500">{s.agentId}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-zinc-300">
          {sessionLabel}
          {isCron && <span className="ml-1.5 rounded bg-blue-500/10 px-1 py-0.5 text-[8px] text-blue-400">CRON</span>}
        </p>
        <p className="text-[9px] text-zinc-600">{shortModel(s.model)} &bull; {fmtAgo(s.updatedAt)}{s.thinkingLevel ? " \u00b7 think:" + s.thinkingLevel : ""}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[11px] font-semibold text-zinc-300">{fmtTokens(s.totalTokens)}</p>
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06]">
            <div className={cn("h-full rounded-full", barColor)} style={{ width: pct + "%" }} />
          </div>
          <span className={cn("text-[9px] font-mono", color)}>{pct}%</span>
        </div>
      </div>
    </div>
  );
}

/* ── Period ─────────────────────────────────────── */

type Period = "last1h" | "last24h" | "last7d" | "allTime";
const PERIOD_LABELS: Record<Period, string> = { last1h: "1H", last24h: "24H", last7d: "7D", allTime: "All" };
const PERIOD_FULL: Record<Period, string> = { last1h: "Last Hour", last24h: "Last 24h", last7d: "Last 7 Days", allTime: "All Time" };

/* ── Main Export ───────────────────────────────── */

export function UsageView() {
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("allTime");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (!res.ok) throw new Error("HTTP " + res.status);
      setData(await res.json());
      setError(null);
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const activeBucket = useMemo(() => data ? data.buckets[period] : null, [data, period]);

  if (loading) return <div className="flex flex-1 items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-zinc-600" /></div>;

  if (error || !data) return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
      <AlertCircle className="h-8 w-8 text-red-400" />
      <p className="text-sm">Failed to load usage data</p>
      <button type="button" onClick={fetchData} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10">Retry</button>
    </div>
  );

  const { totals, modelBreakdown, agentBreakdown, sessions, peakSession, modelConfig, agentModels, sessionFileSizes } = data;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600">
            <BarChart3 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">Usage & Analytics</h1>
            <p className="text-xs text-zinc-600">Token consumption, model performance, session analytics</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/[0.06] bg-zinc-900/60">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <button key={p} type="button" onClick={() => setPeriod(p)} className={cn("px-3 py-1.5 text-[11px] font-medium transition-colors first:rounded-l-lg last:rounded-r-lg", period === p ? "bg-violet-500/15 text-violet-400" : "text-zinc-500 hover:text-zinc-300")}>{PERIOD_LABELS[p]}</button>
            ))}
          </div>
          <button type="button" onClick={() => { setLoading(true); fetchData(); }} className="rounded-lg border border-white/[0.06] bg-zinc-900/60 p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-6 p-6">

          {/* Hero Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard icon={<Zap className="h-4 w-4 text-amber-400" />} label="Total Tokens" value={fmtTokens(activeBucket?.total || 0)} sub={fmtTokensLong(activeBucket?.total || 0)} accent="bg-amber-500/10" />
            <StatCard icon={<ArrowDown className="h-4 w-4 text-blue-400" />} label="Input Tokens" value={fmtTokens(activeBucket?.input || 0)} sub={tokenRatio(activeBucket?.input || 0, activeBucket?.output || 0).inPct + "% of I/O"} accent="bg-blue-500/10" />
            <StatCard icon={<ArrowUp className="h-4 w-4 text-violet-400" />} label="Output Tokens" value={fmtTokens(activeBucket?.output || 0)} sub={tokenRatio(activeBucket?.input || 0, activeBucket?.output || 0).outPct + "% of I/O"} accent="bg-violet-500/10" />
            <StatCard icon={<MessageSquare className="h-4 w-4 text-emerald-400" />} label="Sessions" value={String(activeBucket?.sessions || 0)} sub={"of " + totals.sessions + " total"} accent="bg-emerald-500/10" />
            <StatCard icon={<Cpu className="h-4 w-4 text-pink-400" />} label="Models" value={String(totals.models)} sub={modelConfig?.primary ? shortModel(modelConfig.primary) : ""} accent="bg-pink-500/10" />
            <StatCard icon={<Users className="h-4 w-4 text-cyan-400" />} label="Agents" value={String(totals.agents)} sub="across all workspaces" accent="bg-cyan-500/10" />
          </div>

          {/* Time Buckets */}
          <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-200"><TrendingUp className="h-4 w-4 text-emerald-400" />Token Flow Over Time</h2>
            <div className="grid grid-cols-4 gap-4">
              {(["last1h", "last24h", "last7d", "allTime"] as Period[]).map((p) => {
                const b = data.buckets[p];
                const isActive = period === p;
                return (
                  <button key={p} type="button" onClick={() => setPeriod(p)} className={cn("rounded-xl border p-4 text-left transition-all", isActive ? "border-violet-500/30 bg-violet-500/[0.05]" : "border-white/[0.04] bg-white/[0.02] hover:border-white/[0.08]")}>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">{PERIOD_FULL[p]}</p>
                    <p className="mt-1 text-xl font-bold text-zinc-100">{fmtTokens(b.total)}</p>
                    <div className="mt-2"><TokenBar input={b.input} output={b.output} total={b.total} maxTotal={data.buckets.allTime.total} /></div>
                    <p className="mt-2 text-[10px] text-zinc-600">{b.sessions} session{b.sessions !== 1 ? "s" : ""}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model Breakdown + Config */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Layers className="h-4 w-4 text-violet-400" />Model Breakdown
                <span className="ml-auto text-[10px] font-normal text-zinc-600">
                  <span className="mr-3 inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> Input</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-violet-500" /> Output</span>
                </span>
              </h2>
              {modelBreakdown.length === 0 ? <p className="text-sm text-zinc-600">No model usage data yet</p> :
                modelBreakdown.map((m, i) => (
                  <ModelCard key={m.model} m={m} maxTokens={totals.totalTokens} isPrimary={modelConfig?.primary === m.model || shortModel(modelConfig?.primary || "") === m.model} isFallback={(modelConfig?.fallbacks || []).some((f) => f === m.model || shortModel(f) === m.model)} rank={i + 1} />
                ))}
            </div>

            {/* Config Panel */}
            <div className="space-y-4">
              {modelConfig && (
                <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4">
                  <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-zinc-300"><Target className="h-3.5 w-3.5 text-violet-400" />Model Stack</h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg bg-violet-500/[0.08] px-3 py-2">
                      <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[8px] font-bold text-violet-400">1</span>
                      <code className="text-[11px] font-medium text-violet-300">{shortModel(modelConfig.primary)}</code>
                      <span className="ml-auto text-[9px] text-violet-500">primary</span>
                    </div>
                    {modelConfig.fallbacks.map((f, i) => (
                      <div key={f} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                        <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[8px] font-bold text-zinc-500">{i + 2}</span>
                        <code className="text-[11px] text-zinc-400">{shortModel(f)}</code>
                        <span className="ml-auto text-[9px] text-zinc-600">fallback</span>
                      </div>
                    ))}
                    {modelConfig.imageModel && (
                      <div className="mt-1 flex items-center gap-2 rounded-lg border border-dashed border-white/[0.06] px-3 py-2">
                        <span className="text-[9px] text-zinc-600">Image:</span>
                        <code className="text-[11px] text-zinc-400">{shortModel(modelConfig.imageModel)}</code>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {modelConfig && Object.keys(modelConfig.aliases).length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4">
                  <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-zinc-300"><Hash className="h-3.5 w-3.5 text-amber-400" />Aliases</h3>
                  <div className="space-y-1.5">
                    {Object.entries(modelConfig.aliases).map(([alias, model]) => (
                      <div key={alias} className="flex items-center gap-2 text-[11px]">
                        <code className="rounded bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-400">{alias}</code>
                        <span className="text-zinc-700">&rarr;</span>
                        <code className="truncate text-zinc-500">{shortModel(model)}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {modelConfig && modelConfig.authProviders.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4">
                  <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-zinc-300"><Key className="h-3.5 w-3.5 text-emerald-400" />Auth Providers</h3>
                  <div className="space-y-2">
                    {modelConfig.authProviders.map((ap) => (
                      <div key={ap.provider} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                        <Shield className="h-3 w-3 text-emerald-500" />
                        <span className="text-[11px] font-medium text-zinc-300">{ap.provider}</span>
                        <span className="ml-auto rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-zinc-500">{ap.authKind}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {agentModels.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4">
                  <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-zinc-300"><Users className="h-3.5 w-3.5 text-cyan-400" />Agent Model Config</h3>
                  <div className="space-y-3">
                    {agentModels.map((am) => (
                      <div key={am.agentId}>
                        <p className="mb-1 text-[11px] font-semibold text-zinc-300">{am.agentId}</p>
                        <div className="rounded-lg bg-white/[0.03] px-3 py-2 space-y-1">
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <span className="text-violet-400">Primary:</span>
                            <code className="text-zinc-400">{shortModel(am.primary)}</code>
                          </div>
                          {am.fallbacks.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {am.fallbacks.map((f, i) => <span key={f} className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-zinc-500">{i + 1}. {shortModel(f)}</span>)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sessionFileSizes.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4">
                  <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-zinc-300"><HardDrive className="h-3.5 w-3.5 text-pink-400" />Session Storage</h3>
                  <div className="space-y-2">
                    {sessionFileSizes.map((sf) => (
                      <div key={sf.agentId} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-[11px]">
                        <span className="font-medium text-zinc-300">{sf.agentId}</span>
                        <div className="text-right">
                          <span className="font-mono text-zinc-400">{fmtBytes(sf.sizeBytes)}</span>
                          <span className="ml-2 text-zinc-600">{sf.fileCount} file{sf.fileCount !== 1 ? "s" : ""}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Agent Usage + Peak */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-200"><Users className="h-4 w-4 text-cyan-400" />Usage by Agent</h2>
              {agentBreakdown.length === 0 ? <p className="text-sm text-zinc-600">No agent data</p> : (
                <div className="space-y-3">
                  {agentBreakdown.map((a) => (
                    <div key={a.agentId}>
                      <div className="flex items-center justify-between">
                        <div><p className="text-[12px] font-semibold text-zinc-200">{a.agentId}</p><p className="text-[10px] text-zinc-600">{a.sessions} sessions &bull; {a.models.join(", ")}</p></div>
                        <p className="text-[12px] font-bold text-zinc-300">{fmtTokens(a.totalTokens)}</p>
                      </div>
                      <TokenBar input={a.inputTokens} output={a.outputTokens} total={a.totalTokens} maxTotal={totals.totalTokens} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-4">
              {peakSession && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-300"><Trophy className="h-4 w-4 text-amber-400" />Heaviest Session</h2>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between"><span className="text-[11px] text-zinc-500">Tokens</span><span className="text-lg font-bold text-amber-300">{fmtTokens(peakSession.totalTokens)}</span></div>
                    <ContextGauge used={peakSession.totalTokens} total={peakSession.contextTokens} />
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div><span className="text-zinc-600">Agent</span><p className="font-medium text-zinc-300">{peakSession.agentId}</p></div>
                      <div><span className="text-zinc-600">Model</span><p className="font-medium text-zinc-300">{shortModel(peakSession.model)}</p></div>
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4 text-center">
                  <Activity className="mx-auto h-5 w-5 text-emerald-400" />
                  <p className="mt-2 text-lg font-bold text-zinc-100">{totals.totalTokens > 0 && totals.sessions > 0 ? fmtTokens(Math.round(totals.totalTokens / totals.sessions)) : "0"}</p>
                  <p className="text-[10px] text-zinc-600">Avg tokens/session</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4 text-center">
                  <Gauge className="mx-auto h-5 w-5 text-violet-400" />
                  <p className="mt-2 text-lg font-bold text-zinc-100">{totals.inputTokens + totals.outputTokens > 0 ? tokenRatio(totals.inputTokens, totals.outputTokens).inPct + ":" + tokenRatio(totals.inputTokens, totals.outputTokens).outPct : "\u2014"}</p>
                  <p className="text-[10px] text-zinc-600">Global I/O ratio</p>
                </div>
              </div>
            </div>
          </div>

          {/* Session Feed */}
          <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-200"><Clock className="h-4 w-4 text-blue-400" />Recent Sessions<span className="ml-auto text-[10px] font-normal text-zinc-600">Top {Math.min(sessions.length, 50)} by recency</span></h2>
            <div className="space-y-1.5">
              {sessions.slice(0, 20).map((s, i) => <SessionRow key={s.sessionId + "-" + i} s={s} />)}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
