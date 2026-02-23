"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";

/* ── types ─────────────────────────────────────── */

type Period = "last1h" | "last24h" | "last7d" | "allTime";

type Bucket = { input: number; output: number; total: number; sessions: number };

type ActivityPoint = {
  ts: number;
  input: number;
  output: number;
  total: number;
  sessions: number;
};

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
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    models: number;
    agents: number;
  };
  buckets: { last1h: Bucket; last24h: Bucket; last7d: Bucket; allTime: Bucket };
  activitySeries?: Record<Period, ActivityPoint[]>;
  activitySeriesByModel?: Record<string, Record<Period, ActivityPoint[]>>;
  modelBreakdown: ModelBreakdown[];
  agentBreakdown: AgentBreakdown[];
  sessions: SessionEntry[];
  peakSession: {
    sessionId: string;
    key: string;
    agentId: string;
    model: string;
    totalTokens: number;
    contextTokens: number;
    percentUsed?: number;
  } | null;
  modelConfig: {
    primary: string;
    fallbacks: string[];
    imageModel: string;
    aliases: Record<string, string>;
    allowed: string[];
    authProviders: AuthProvider[];
  } | null;
  agentModels: { agentId: string; primary: string; fallbacks: string[] }[];
  sessionFileSizes: { agentId: string; sizeBytes: number; fileCount: number }[];
};

type ChartPoint = Record<string, string | number | undefined>;

type TooltipRow = {
  color?: string;
  name?: string;
  value?: number;
  payload?: ChartPoint;
};

/* ── helpers ───────────────────────────────────── */

const PERIOD_LABELS: Record<Period, string> = {
  last1h: "1H",
  last24h: "24H",
  last7d: "7D",
  allTime: "All",
};

const PERIOD_TITLES: Record<Period, string> = {
  last1h: "Last Hour",
  last24h: "Last 24 Hours",
  last7d: "Last 7 Days",
  allTime: "All Time",
};

const USAGE_COLORS = {
  input: "#4fb8f4",
  output: "#f59a52",
  sessions: "#47cfae",
  grid: "rgba(120, 144, 173, 0.18)",
  tick: "rgba(166, 186, 213, 0.84)",
  tickMuted: "rgba(148, 163, 184, 0.74)",
  text: "rgba(226, 232, 240, 0.9)",
};

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtTokensLong(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtAgo(ms: number): string {
  if (!ms) return "Never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function shortModel(model: string): string {
  return model.split("/").pop() || model;
}

function ratio(input: number, output: number) {
  const sum = input + output;
  if (!sum) return { inPct: 0, outPct: 0 };
  return {
    inPct: Math.round((input / sum) * 100),
    outPct: Math.round((output / sum) * 100),
  };
}

function formatTimeTick(ts: number, period: Period): string {
  const d = new Date(ts);
  if (period === "last1h") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (period === "last24h") return d.toLocaleTimeString("en-US", { hour: "numeric" });
  if (period === "last7d") {
    const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
    const hour = d.toLocaleTimeString("en-US", { hour: "numeric" });
    return `${weekday} ${hour}`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function labelForPoint(ts: number, period: Period): string {
  const d = new Date(ts);
  if (period === "last1h") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (period === "last24h") return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
  if (period === "last7d") return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fallbackSeriesFromBuckets(buckets: UsageData["buckets"]): Record<Period, ActivityPoint[]> {
  const now = Date.now();
  const points = {
    last1h: [{ ts: now, ...buckets.last1h }],
    last24h: [{ ts: now, ...buckets.last24h }],
    last7d: [{ ts: now, ...buckets.last7d }],
    allTime: [{ ts: now, ...buckets.allTime }],
  };
  return points;
}

/* ── ui blocks ──────────────────────────────────── */

function MetricTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "ink" | "teal" | "orange" | "blue" | "rose" | "amber";
}) {
  const toneClass = {
    ink: {
      border: "border-slate-400/25",
      wash: "from-slate-400/12 via-slate-500/4 to-transparent",
      glow: "bg-slate-300/14",
    },
    teal: {
      border: "border-teal-400/30",
      wash: "from-teal-400/14 via-emerald-400/5 to-transparent",
      glow: "bg-teal-300/14",
    },
    orange: {
      border: "border-orange-400/30",
      wash: "from-orange-400/14 via-amber-400/5 to-transparent",
      glow: "bg-orange-300/14",
    },
    blue: {
      border: "border-sky-400/30",
      wash: "from-sky-400/14 via-cyan-400/5 to-transparent",
      glow: "bg-sky-300/14",
    },
    rose: {
      border: "border-rose-400/30",
      wash: "from-rose-400/14 via-fuchsia-400/5 to-transparent",
      glow: "bg-rose-300/14",
    },
    amber: {
      border: "border-amber-400/30",
      wash: "from-amber-400/14 via-yellow-400/5 to-transparent",
      glow: "bg-amber-300/14",
    },
  }[tone];

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border bg-card/80 px-4 py-4 backdrop-blur-sm", toneClass.border)}>
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", toneClass.wash)} />
      <div className={cn("pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full blur-3xl", toneClass.glow)} />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/68">{label}</p>
        <p className="mt-2 text-2xl font-semibold leading-none tracking-tight text-foreground/95">{value}</p>
        {sub && <p className="mt-2 text-xs text-muted-foreground/80">{sub}</p>}
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-foreground/10 bg-card/80 p-4 shadow-inner backdrop-blur-sm md:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold text-foreground/90">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground/70">{subtitle}</p>}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function ActivityTooltip({
  active,
  payload,
  label,
  period,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: number | string;
  period: Period;
}) {
  if (!active || !payload?.length || typeof label !== "number") return null;
  const total = payload.reduce((sum, row) => sum + Number(row.value || 0), 0);
  return (
    <div className="rounded-xl border border-foreground/10 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-xs font-medium text-foreground/90">{labelForPoint(label, period)}</p>
      <div className="mt-1.5 space-y-1 text-xs">
        {payload.map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground" style={{ color: row.color || undefined }}>
              {row.name}
            </span>
            <span className="font-mono text-foreground/90">{fmtTokensLong(Number(row.value || 0))}</span>
          </div>
        ))}
        <div className="mt-1 border-t border-foreground/10 pt-1.5 text-xs font-semibold text-foreground/90">
          Total {fmtTokensLong(total)}
        </div>
      </div>
    </div>
  );
}

function GenericTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: number | string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-foreground/10 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      {label != null && <p className="text-xs font-medium text-foreground/90">{String(label)}</p>}
      <div className="mt-1.5 space-y-1 text-xs">
        {payload.map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground" style={{ color: row.color || undefined }}>
              {row.name}
            </span>
            <span className="font-mono text-foreground/90">{fmtTokensLong(Number(row.value || 0))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelMixTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipRow[];
}) {
  if (!active || !payload?.length) return null;
  const row = (payload[0]?.payload || {}) as ChartPoint;
  const modelName = String(row.model || "");
  const input = Number(row.input || 0);
  const output = Number(row.output || 0);
  const total = input + output;
  const split = ratio(input, output);
  return (
    <div className="rounded-xl border border-foreground/10 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-xs font-medium text-foreground/90">{shortModel(modelName)}</p>
      <div className="mt-1.5 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sky-400">input</span>
          <span className="font-mono text-foreground/90">{fmtTokensLong(input)} ({split.inPct}%)</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-orange-400">output</span>
          <span className="font-mono text-foreground/90">{fmtTokensLong(output)} ({split.outPct}%)</span>
        </div>
        <div className="mt-1 border-t border-foreground/10 pt-1.5 text-xs font-semibold text-foreground/90">
          Total {fmtTokensLong(total)}
        </div>
      </div>
    </div>
  );
}

export function UsageView() {
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("allTime");
  /** Token Flow chart: "all" or model key for per-model series */
  const [tokenFlowModel, setTokenFlowModel] = useState<string>("all");

  // Reset token flow filter to "all" if selected model no longer in breakdown
  useEffect(() => {
    if (tokenFlowModel === "all" || !data) return;
    const hasModel = data.modelBreakdown.some((m) => m.model === tokenFlowModel);
    if (!hasModel) setTokenFlowModel("all");
  }, [data, tokenFlowModel]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as UsageData;
      setData(json);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchData();
    }, 15000);
    const onFocus = () => void fetchData();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchData]);

  const activeBucket = useMemo(() => (data ? data.buckets[period] : null), [data, period]);

  /** Token Flow chart series: all or filtered by selected model */
  const tokenFlowSeries = useMemo(() => {
    if (!data) return [];
    if (tokenFlowModel === "all" || !tokenFlowModel) {
      const source = data.activitySeries || fallbackSeriesFromBuckets(data.buckets);
      return source[period] || [];
    }
    const byModel = data.activitySeriesByModel || {};
    const series = byModel[tokenFlowModel] || data.activitySeries || fallbackSeriesFromBuckets(data.buckets);
    return series[period] || [];
  }, [data, period, tokenFlowModel]);

  const modelChart = useMemo(() => {
    if (!data) return [];
    return data.modelBreakdown.slice(0, 8).map((m) => ({
      model: shortModel(m.model),
      input: m.inputTokens,
      output: m.outputTokens,
      total: m.totalTokens,
      sessions: m.sessions,
    }));
  }, [data]);

  const agentChart = useMemo(() => {
    if (!data) return [];
    return data.agentBreakdown.slice(0, 8).map((a) => ({
      agent: a.agentId,
      total: a.totalTokens,
      sessions: a.sessions,
      input: a.inputTokens,
      output: a.outputTokens,
    }));
  }, [data]);

  const contextScatter = useMemo(() => {
    if (!data) return [];
    return data.sessions
      .filter((s) => s.contextTokens > 0)
      .slice(0, 40)
      .map((s) => ({
        x: s.contextTokens,
        y: s.totalTokens,
        z: Math.max(4, Math.min(100, s.percentUsed || 8)),
        session: s.sessionId || s.key || "session",
        model: shortModel(s.model),
        agent: s.agentId,
      }));
  }, [data]);

  if (loading) {
    return <LoadingState label="Loading usage intelligence..." size="lg" className="h-full" />;
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">Failed to load usage data</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void fetchData();
          }}
          className="rounded-lg border border-foreground/10 bg-card px-3 py-1.5 text-xs text-foreground/80 hover:bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  const { totals, sessions, modelBreakdown, modelConfig, peakSession, sessionFileSizes } = data;
  const io = ratio(activeBucket?.input || 0, activeBucket?.output || 0);

  return (
    <SectionLayout className="bg-gradient-to-br from-blue-500/10 via-transparent to-cyan-500/10">
      <SectionHeader
        title={<span className="text-sm tracking-tight">Usage Intelligence</span>}
        description="Token economics, model pressure, and agent throughput"
        descriptionClassName="mt-1 text-sm text-muted-foreground/70"
        actions={
          <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-foreground/10 bg-card/70 p-1 backdrop-blur-sm">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  period === p
                    ? "border-cyan-300/35 bg-cyan-500/14 text-cyan-100"
                    : "border-transparent text-muted-foreground hover:border-foreground/10 hover:bg-foreground/5 hover:text-foreground"
                )}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void fetchData();
            }}
            className="rounded-xl border border-foreground/10 bg-card/70 px-3 py-1.5 text-xs font-medium text-foreground/80 backdrop-blur-sm hover:bg-foreground/10"
          >
            Refresh
          </button>
          </div>
        }
      />

      <SectionBody width="full" padding="regular" innerClassName="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricTile
              label={`Tokens · ${PERIOD_TITLES[period]}`}
              value={fmtTokens(activeBucket?.total || 0)}
              sub={fmtTokensLong(activeBucket?.total || 0)}
              tone="teal"
            />
            <MetricTile
              label="Input"
              value={fmtTokens(activeBucket?.input || 0)}
              sub={`${io.inPct}% of I/O`}
              tone="blue"
            />
            <MetricTile
              label="Output"
              value={fmtTokens(activeBucket?.output || 0)}
              sub={`${io.outPct}% of I/O`}
              tone="orange"
            />
            <MetricTile
              label="Sessions"
              value={String(activeBucket?.sessions || 0)}
              sub={`of ${totals.sessions} total`}
              tone="ink"
            />
            <MetricTile
              label="Models"
              value={String(totals.models)}
              sub={modelConfig?.primary ? `primary ${shortModel(modelConfig.primary)}` : ""}
              tone="rose"
            />
            <MetricTile
              label="Agents"
              value={String(totals.agents)}
              sub={peakSession ? `peak ${peakSession.agentId}` : "active workers"}
              tone="amber"
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <Panel
                title="Token Flow"
                subtitle="Stacked usage with session intensity overlay"
                actions={
                  <select
                    value={tokenFlowModel}
                    onChange={(e) => setTokenFlowModel(e.target.value)}
                    className="rounded-lg border border-foreground/10 bg-card/80 px-2.5 py-1.5 text-xs text-foreground/90 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                  >
                    <option value="all">All models</option>
                    {data.modelBreakdown.map((m) => (
                      <option key={m.model} value={m.model}>
                        {shortModel(m.model)}
                      </option>
                    ))}
                  </select>
                }
              >
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={tokenFlowSeries} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="usageInput" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={USAGE_COLORS.input} stopOpacity={0.36} />
                          <stop offset="95%" stopColor={USAGE_COLORS.input} stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="usageOutput" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={USAGE_COLORS.output} stopOpacity={0.33} />
                          <stop offset="95%" stopColor={USAGE_COLORS.output} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={USAGE_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="ts"
                        tickFormatter={(v) => formatTimeTick(Number(v), period)}
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={22}
                      />
                      <YAxis
                        yAxisId="tokens"
                        tickFormatter={(v) => fmtTokens(Number(v))}
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                        axisLine={false}
                        tickLine={false}
                        width={54}
                      />
                      <YAxis
                        yAxisId="sessions"
                        orientation="right"
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tickMuted }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                        width={36}
                      />
                      <Tooltip content={<ActivityTooltip period={period} />} cursor={false} />
                      <Legend wrapperStyle={{ fontSize: 11, opacity: 0.9, color: USAGE_COLORS.text }} />
                      <Area
                        yAxisId="tokens"
                        type="monotone"
                        dataKey="input"
                        name="Input"
                        stroke={USAGE_COLORS.input}
                        strokeWidth={2}
                        fill="url(#usageInput)"
                        stackId="tokens"
                      />
                      <Area
                        yAxisId="tokens"
                        type="monotone"
                        dataKey="output"
                        name="Output"
                        stroke={USAGE_COLORS.output}
                        strokeWidth={2}
                        fill="url(#usageOutput)"
                        stackId="tokens"
                      />
                      <Line
                        yAxisId="sessions"
                        type="monotone"
                        dataKey="sessions"
                        name="Sessions"
                        stroke={USAGE_COLORS.sessions}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>

            <div className="xl:col-span-4">
              <Panel title="Model Mix" subtitle="Top models by token volume">
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={modelChart}
                      layout="vertical"
                      margin={{ top: 6, right: 8, left: 4, bottom: 4 }}
                      barCategoryGap="26%"
                    >
                      <defs>
                        <linearGradient id="mixInput" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#4fb8f4" stopOpacity={0.92} />
                          <stop offset="100%" stopColor="#39aee8" stopOpacity={0.86} />
                        </linearGradient>
                        <linearGradient id="mixOutput" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#f59a52" stopOpacity={0.95} />
                          <stop offset="100%" stopColor="#ec8441" stopOpacity={0.9} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={USAGE_COLORS.grid} strokeDasharray="3 3" horizontal={false} />
                      <XAxis
                        type="number"
                        tickFormatter={(v) => fmtTokens(Number(v))}
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="model"
                        width={104}
                        tickFormatter={(v) => shortModel(String(v))}
                        tick={{ fontSize: 11, fill: USAGE_COLORS.text }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ModelMixTooltip />} cursor={false} />
                      <Legend wrapperStyle={{ fontSize: 11, color: USAGE_COLORS.text }} />
                      <Bar dataKey="input" stackId="tokens" fill="url(#mixInput)" radius={[4, 0, 0, 4]} activeBar={false} />
                      <Bar dataKey="output" stackId="tokens" fill="url(#mixOutput)" radius={[0, 4, 4, 0]} activeBar={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <Panel title="Agent Throughput" subtitle="Token production by agent">
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agentChart} margin={{ top: 8, right: 8, left: 0, bottom: 10 }}>
                      <CartesianGrid stroke={USAGE_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="agent"
                        tick={{ fontSize: 11, fill: USAGE_COLORS.text }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(v) => fmtTokens(Number(v))}
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                        axisLine={false}
                        tickLine={false}
                        width={50}
                      />
                      <Tooltip content={<GenericTooltip />} cursor={false} />
                      <Bar dataKey="total" name="Tokens" radius={[8, 8, 0, 0]}>
                        {agentChart.map((entry) => (
                          <Cell
                            key={entry.agent}
                            fill={entry.sessions > 10 ? "#52b7e9" : entry.sessions > 4 ? "#4fcab3" : "#7a8ea8"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>

            <div className="xl:col-span-5">
              <Panel title="Context Pressure Map" subtitle="Session size relative to context budget">
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 10, left: 2, bottom: 8 }}>
                      <CartesianGrid stroke={USAGE_COLORS.grid} strokeDasharray="3 3" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="Context"
                        tickFormatter={(v) => fmtTokens(Number(v))}
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name="Used"
                        tickFormatter={(v) => fmtTokens(Number(v))}
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <ZAxis type="number" dataKey="z" range={[60, 460]} name="Pressure" />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0]?.payload as
                            | { session: string; model: string; agent: string; x: number; y: number; z: number }
                            | undefined;
                          if (!p) return null;
                          return (
                            <div className="rounded-xl border border-foreground/10 bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm">
                              <p className="text-xs font-medium text-foreground/90">{p.agent}</p>
                              <p className="text-xs text-muted-foreground/70">{p.model}</p>
                              <div className="mt-1.5 space-y-1 text-xs">
                                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Context</span><span className="font-mono">{fmtTokensLong(p.x)}</span></div>
                                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Used</span><span className="font-mono">{fmtTokensLong(p.y)}</span></div>
                                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Pressure</span><span className="font-mono">{Math.round(p.z)}%</span></div>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Scatter name="Sessions" data={contextScatter} fill={USAGE_COLORS.sessions} fillOpacity={0.45} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <Panel
                title="Top Models"
                subtitle="Bar = each model’s share of total token volume. Context pressure = how full the context window was on average."
              >
                <div className="space-y-2.5">
                  {modelBreakdown.slice(0, 8).map((m) => {
                    const pressure = m.contextTokens > 0 ? Math.round((m.totalTokens / Math.max(1, m.sessions)) / m.contextTokens * 100) : 0;
                    const pct = totals.totalTokens > 0 ? Math.round((m.totalTokens / totals.totalTokens) * 100) : 0;
                    return (
                      <div key={m.model} className="rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-foreground/90">{shortModel(m.model)}</p>
                            <p className="text-xs text-muted-foreground/70">
                              {m.sessions} sessions · {m.agents.length} agent{m.agents.length !== 1 ? "s" : ""} · {fmtAgo(m.lastUsed)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-semibold text-foreground/90">{fmtTokens(m.totalTokens)}</p>
                            <p className="text-xs text-muted-foreground/70">{pct}% of total tokens</p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="shrink-0 text-xs text-muted-foreground/70">Token share</span>
                          <div className="min-w-0 flex-1 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                            <div
                              className="h-full"
                              style={{
                                width: `${Math.max(2, pct)}%`,
                                background: `linear-gradient(90deg, ${USAGE_COLORS.input}, ${USAGE_COLORS.sessions}, ${USAGE_COLORS.output})`,
                              }}
                            />
                          </div>
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground/70">
                          Context pressure: {pressure}% (avg % of context window used per session)
                        </p>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </div>

            <div className="xl:col-span-5 space-y-5">
              <Panel title="Model Routing" subtitle="Primary, fallbacks, and auth posture">
                {modelConfig ? (
                  <div className="space-y-3 text-xs">
                    <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-3">
                      <p className="text-xs uppercase tracking-widest text-muted-foreground/70">Primary</p>
                      <p className="mt-1 font-semibold text-foreground/90">{shortModel(modelConfig.primary)}</p>
                    </div>
                    {modelConfig.fallbacks.length > 0 && (
                      <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-3">
                        <p className="text-xs uppercase tracking-widest text-muted-foreground/70">Fallback Chain</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {modelConfig.fallbacks.map((f, i) => (
                            <span key={f} className="rounded-md border border-foreground/10 bg-card px-2 py-1 text-xs text-foreground/80">
                              {i + 1}. {shortModel(f)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {modelConfig.authProviders.length > 0 && (
                      <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-3">
                        <p className="text-xs uppercase tracking-widest text-muted-foreground/70">Auth Providers</p>
                        <div className="mt-1.5 space-y-1.5">
                          {modelConfig.authProviders.map((ap) => (
                            <div key={ap.provider} className="flex items-center justify-between rounded-md bg-card px-2 py-1.5">
                              <span className="font-medium text-foreground/90">{ap.provider}</span>
                              <span className="text-muted-foreground/70">{ap.authKind}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/70">No routing metadata available.</p>
                )}
              </Panel>

              <Panel title="Session Storage" subtitle="JSONL footprint by agent">
                <div className="space-y-2 text-xs">
                  {sessionFileSizes.map((s) => (
                    <div key={s.agentId} className="flex items-center justify-between rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2">
                      <div>
                        <p className="font-semibold text-foreground/90">{s.agentId}</p>
                        <p className="text-xs text-muted-foreground/70">{s.fileCount} file{s.fileCount !== 1 ? "s" : ""}</p>
                      </div>
                      <span className="font-mono text-foreground/80">{fmtBytes(s.sizeBytes)}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>

          <Panel title="Recent Sessions" subtitle={`Top ${Math.min(sessions.length, 20)} by recency`}>
            <div className="space-y-2">
              {sessions.slice(0, 20).map((s, i) => {
                const p = s.contextTokens > 0 ? Math.round((s.totalTokens / s.contextTokens) * 100) : 0;
                return (
                  <div key={`${s.sessionId}-${i}`} className="rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground/90">{s.agentId} · {shortModel(s.model)}</p>
                        <p className="truncate text-xs text-muted-foreground/70">{s.key || s.sessionId} · {fmtAgo(s.updatedAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-foreground/90">{fmtTokens(s.totalTokens)}</p>
                        <p className="text-xs text-muted-foreground/70">{p}% context</p>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                      <div
                        className={cn(
                          "h-full",
                          p > 80
                            ? "bg-red-500"
                            : p > 55
                              ? "bg-orange-500"
                              : "bg-emerald-500"
                        )}
                        style={{ width: `${Math.min(100, Math.max(2, p))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
      </SectionBody>
    </SectionLayout>
  );
}
