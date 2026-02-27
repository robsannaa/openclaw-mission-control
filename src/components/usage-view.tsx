"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ComposedChart,
  Line,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
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
  fullModel: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  contextTokens: number;
  agents: string[];
  lastUsed: number;
  avgPercentUsed: number;
  estimatedCostUsd: number | null;
};

type AgentBreakdown = {
  agentId: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  contextTokens: number;
  models: string[];
  lastUsed: number;
  estimatedCostUsd: number | null;
};

type SessionEntry = {
  key: string;
  kind: string;
  updatedAt: number;
  ageMs: number;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalTokensFresh: boolean;
  model: string;
  fullModel: string;
  contextTokens: number;
  percentUsed?: number;
  remainingTokens?: number;
  agentId: string;
  thinkingLevel?: string;
  estimatedCostUsd: number | null;
};

type AuthProvider = { provider: string; authKind: string; profiles: number };

type LiveCost = {
  totalEstimatedUsd: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
};

type HistoricalData = {
  byModel: Record<string, { totalTokens: number; estimatedCostUsd: number; sessions: number }>;
  byAgent: Record<string, { totalTokens: number; estimatedCostUsd: number; sessions: number }>;
  costTimeSeries: { ts: number; costUsd: number; tokens: number }[];
  totalEstimatedUsd: number;
  totalTokens: number;
  rowCount: number;
} | null;

type UsageData = {
  totals: {
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    models: number;
    agents: number;
    staleSessions: number;
  };
  liveCost: LiveCost;
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
  historical: HistoricalData;
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
  input: "var(--chart-1)",
  output: "var(--chart-3)",
  sessions: "var(--chart-2)",
  cost: "var(--chart-4)",
  grid: "var(--chart-grid)",
  tick: "var(--chart-tick)",
  tickMuted: "var(--chart-tick-muted)",
  text: "var(--chart-text)",
  barHigh: "var(--chart-4)",
  barMid: "var(--chart-2)",
  barLow: "var(--chart-muted)",
};

const costTrendChartConfig = {
  costUsd: { label: "Cost", color: "var(--chart-4)" },
  tokens: { label: "Tokens", color: "var(--chart-2)" },
} satisfies ChartConfig;

const tokenFlowChartConfig = {
  input: { label: "Input", color: "var(--chart-1)" },
  output: { label: "Output", color: "var(--chart-3)" },
  sessions: { label: "Sessions", color: "var(--chart-2)" },
} satisfies ChartConfig;

const modelMixChartConfig = {
  input: { label: "Input", color: "var(--chart-1)" },
  output: { label: "Output", color: "var(--chart-3)" },
} satisfies ChartConfig;

const agentChartConfig = {
  total: { label: "Tokens", color: "var(--chart-2)" },
} satisfies ChartConfig;

const contextChartConfig = {
  sessions: { label: "Sessions", color: "var(--chart-2)" },
} satisfies ChartConfig;

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtTokensLong(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(usd: number | null): string {
  if (usd == null) return "n/a";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtCostLong(usd: number | null): string {
  if (usd == null) return "n/a";
  return `$${usd.toFixed(6)}`;
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
  return {
    last1h: [{ ts: now, ...buckets.last1h }],
    last24h: [{ ts: now, ...buckets.last24h }],
    last7d: [{ ts: now, ...buckets.last7d }],
    allTime: [{ ts: now, ...buckets.allTime }],
  };
}

/* ── ui blocks ──────────────────────────────────── */

function MetricTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="glass-subtle rounded-lg px-4 py-3.5">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">{label}</p>
      <p className="mt-1.5 text-xl font-semibold leading-none tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-muted-foreground/60">{sub}</p>}
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
    <section className="glass rounded-lg p-4 md:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xs font-sans font-semibold text-foreground/90">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground/60">{subtitle}</p>}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function CostTrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: number | string;
}) {
  if (!active || !payload?.length || typeof label !== "number") return null;
  const d = new Date(label);
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-foreground/90">
        {d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" })}
      </p>
      <div className="mt-1.5 space-y-1 text-xs">
        {payload.map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground" style={{ color: row.color || undefined }}>
              {row.name}
            </span>
            <span className="font-mono text-foreground/90">
              {row.name === "Cost" ? fmtCostLong(Number(row.value || 0)) : fmtTokensLong(Number(row.value || 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UsageView() {
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("allTime");
  const [tokenFlowModel, setTokenFlowModel] = useState<string>("all");

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
      cost: m.estimatedCostUsd,
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
      cost: a.estimatedCostUsd,
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

  const costTimeSeries = useMemo(() => {
    if (!data?.historical?.costTimeSeries) return [];
    return data.historical.costTimeSeries;
  }, [data]);

  if (loading) {
    return <LoadingState label="Loading usage data..." size="lg" className="h-full" />;
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

  const { totals, liveCost, sessions, modelBreakdown, modelConfig, peakSession, sessionFileSizes, historical } = data;
  const io = ratio(activeBucket?.input || 0, activeBucket?.output || 0);
  const costPerSession = totals.sessions > 0 ? liveCost.totalEstimatedUsd / totals.sessions : 0;

  return (
    <SectionLayout>
      <SectionHeader
        title={<span className="font-serif font-bold text-base">Usage</span>}
        description="Cost estimation, token economics, cache metrics, and agent throughput."
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-muted p-1">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200",
                    period === p
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
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
              className="rounded-lg border border-foreground/10 bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 hover:bg-muted/80"
            >
              Refresh
            </button>
          </div>
        }
      />

      <SectionBody width="content" padding="regular" innerClassName="space-y-4 pb-8">
        {/* Stale sessions banner */}
        {totals.staleSessions > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-400">
            {totals.staleSessions} session{totals.staleSessions !== 1 ? "s have" : " has"} stale token counts
            &mdash; cost estimates may be outdated until the gateway refreshes.
          </div>
        )}

        {/* Metric tiles */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricTile
            label="Estimated Cost"
            value={fmtCost(liveCost.totalEstimatedUsd)}
            sub={historical ? `${fmtCost(historical.totalEstimatedUsd)} historical` : "live sessions"}
          />
          <MetricTile
            label="Cost / Session"
            value={fmtCost(costPerSession || null)}
            sub={`across ${totals.sessions} sessions`}
          />
          <MetricTile
            label={`Tokens · ${PERIOD_TITLES[period]}`}
            value={fmtTokens(activeBucket?.total || 0)}
            sub={`${io.inPct}% in / ${io.outPct}% out`}
          />
          <MetricTile
            label="Sessions"
            value={String(activeBucket?.sessions || 0)}
            sub={`of ${totals.sessions} total`}
          />
        </div>

        {/* Cache + config row */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricTile
            label="Cache Read"
            value={fmtTokens(liveCost.totalCacheReadTokens)}
            sub={fmtTokensLong(liveCost.totalCacheReadTokens)}
          />
          <MetricTile
            label="Cache Write"
            value={fmtTokens(liveCost.totalCacheWriteTokens)}
            sub={fmtTokensLong(liveCost.totalCacheWriteTokens)}
          />
          <MetricTile
            label="Models"
            value={String(totals.models)}
            sub={modelConfig?.primary ? `primary ${shortModel(modelConfig.primary)}` : ""}
          />
          <MetricTile
            label="Agents"
            value={String(totals.agents)}
            sub={peakSession ? `peak ${peakSession.agentId}` : "active workers"}
          />
        </div>

        {/* Historical Cost Trend chart */}
        {costTimeSeries.length > 1 && (
          <Panel title="Historical Cost Trend" subtitle="Hourly cost from persistent usage history">
            <ChartContainer config={costTrendChartConfig} className="h-56 w-full">
              <ComposedChart data={costTimeSeries} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-costUsd)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-costUsd)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={USAGE_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(v) => {
                    const d = new Date(Number(v));
                    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
                  }}
                  tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  yAxisId="cost"
                  tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                  tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                />
                <YAxis
                  yAxisId="tokens"
                  orientation="right"
                  tickFormatter={(v) => fmtTokens(Number(v))}
                  tick={{ fontSize: 10, fill: USAGE_COLORS.tickMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                />
                <ChartTooltip content={<CostTrendTooltip />} cursor={false} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area
                  yAxisId="cost"
                  type="monotone"
                  dataKey="costUsd"
                  name="Cost"
                  stroke="var(--color-costUsd)"
                  strokeWidth={1.5}
                  fill="url(#costFill)"
                />
                <Line
                  yAxisId="tokens"
                  type="monotone"
                  dataKey="tokens"
                  name="Tokens"
                  stroke="var(--color-tokens)"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </ComposedChart>
            </ChartContainer>
          </Panel>
        )}

        {/* Token Flow + Model Mix */}
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <Panel
              title="Token Flow"
              subtitle="Input & output tokens with session overlay"
              actions={
                <select
                  value={tokenFlowModel}
                  onChange={(e) => setTokenFlowModel(e.target.value)}
                  className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground/90 focus:outline-none focus:ring-2 focus:ring-ring"
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
              <ChartContainer config={tokenFlowChartConfig} className="h-72 w-full">
                <ComposedChart data={tokenFlowSeries} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillInput" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-input)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-input)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="fillOutput" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-output)" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="var(--color-output)" stopOpacity={0.02} />
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
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => labelForPoint(Number(value), period)}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area
                    yAxisId="tokens"
                    type="monotone"
                    dataKey="input"
                    name="Input"
                    stroke="var(--color-input)"
                    strokeWidth={1.5}
                    fill="url(#fillInput)"
                    stackId="tokens"
                  />
                  <Area
                    yAxisId="tokens"
                    type="monotone"
                    dataKey="output"
                    name="Output"
                    stroke="var(--color-output)"
                    strokeWidth={1.5}
                    fill="url(#fillOutput)"
                    stackId="tokens"
                  />
                  <Line
                    yAxisId="sessions"
                    type="monotone"
                    dataKey="sessions"
                    name="Sessions"
                    stroke="var(--color-sessions)"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </ComposedChart>
              </ChartContainer>
            </Panel>
          </div>

          <div className="xl:col-span-4">
            <Panel title="Model Mix" subtitle="Top models by token volume">
              <ChartContainer config={modelMixChartConfig} className="h-72 w-full">
                <BarChart
                  data={modelChart}
                  layout="vertical"
                  margin={{ top: 6, right: 8, left: 4, bottom: 4 }}
                  barCategoryGap="26%"
                >
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
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="input" stackId="tokens" fill="var(--color-input)" radius={[4, 0, 0, 4]} activeBar={false} />
                  <Bar dataKey="output" stackId="tokens" fill="var(--color-output)" radius={[0, 4, 4, 0]} activeBar={false} />
                </BarChart>
              </ChartContainer>
            </Panel>
          </div>
        </div>

        {/* Agent Throughput + Context Pressure */}
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-7">
            <Panel title="Agent Throughput" subtitle="Token production and cost by agent">
              <ChartContainer config={agentChartConfig} className="h-64 w-full">
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
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey="total" name="Tokens" radius={[6, 6, 0, 0]}>
                    {agentChart.map((entry) => (
                      <Cell
                        key={entry.agent}
                        fill={
                          entry.sessions > 10
                            ? USAGE_COLORS.barHigh
                            : entry.sessions > 4
                              ? USAGE_COLORS.barMid
                              : USAGE_COLORS.barLow
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </Panel>
          </div>

          <div className="xl:col-span-5">
            <Panel title="Context Pressure" subtitle="Session size vs context budget">
              <ChartContainer config={contextChartConfig} className="h-64 w-full">
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
                  <ChartTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload as
                        | { session: string; model: string; agent: string; x: number; y: number; z: number }
                        | undefined;
                      if (!p) return null;
                      return (
                        <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
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
                  <Scatter name="Sessions" data={contextScatter} fill="var(--color-sessions)" fillOpacity={0.45} />
                </ScatterChart>
              </ChartContainer>
            </Panel>
          </div>
        </div>

        {/* Top Models + Model Routing + Storage */}
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-7">
            <Panel
              title="Top Models"
              subtitle="Token share, estimated cost, and context pressure"
            >
              <div className="space-y-2">
                {modelBreakdown.slice(0, 8).map((m) => {
                  const pressure = m.contextTokens > 0 ? Math.round((m.totalTokens / Math.max(1, m.sessions)) / m.contextTokens * 100) : 0;
                  const pct = totals.totalTokens > 0 ? Math.round((m.totalTokens / totals.totalTokens) * 100) : 0;
                  return (
                    <div key={m.model} className="glass-subtle rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground/90">{shortModel(m.model)}</p>
                          <p className="text-xs text-muted-foreground/60">
                            {m.sessions} sessions · {m.agents.length} agent{m.agents.length !== 1 ? "s" : ""} · {fmtAgo(m.lastUsed)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-foreground/90">
                            {fmtTokens(m.totalTokens)}
                            <span className="ml-1.5 text-emerald-400">{fmtCost(m.estimatedCostUsd)}</span>
                          </p>
                          <p className="text-xs text-muted-foreground/60">{pct}% of total</p>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.04]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(2, pct)}%`,
                            background: `linear-gradient(90deg, ${USAGE_COLORS.input}, ${USAGE_COLORS.sessions})`,
                          }}
                        />
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground/60">
                        <span>Pressure: {pressure}%</span>
                        {(m.cacheReadTokens > 0 || m.cacheWriteTokens > 0) && (
                          <span>Cache: {fmtTokens(m.cacheReadTokens)}r / {fmtTokens(m.cacheWriteTokens)}w</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className="xl:col-span-5 space-y-4">
            <Panel title="Model Routing" subtitle="Primary, fallbacks, and auth">
              {modelConfig ? (
                <div className="space-y-2.5 text-xs">
                  <div className="glass-subtle rounded-lg p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Primary</p>
                    <p className="mt-1 font-semibold text-foreground/90">{shortModel(modelConfig.primary)}</p>
                  </div>
                  {modelConfig.fallbacks.length > 0 && (
                    <div className="glass-subtle rounded-lg p-3">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Fallback Chain</p>
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
                    <div className="glass-subtle rounded-lg p-3">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Auth Providers</p>
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
                <p className="text-xs text-muted-foreground/60">No routing metadata available.</p>
              )}
            </Panel>

            <Panel title="Session Storage" subtitle="JSONL footprint by agent">
              <div className="space-y-2 text-xs">
                {sessionFileSizes.map((s) => (
                  <div key={s.agentId} className="flex items-center justify-between glass-subtle rounded-lg px-3 py-2">
                    <div>
                      <p className="font-semibold text-foreground/90">{s.agentId}</p>
                      <p className="text-xs text-muted-foreground/60">{s.fileCount} file{s.fileCount !== 1 ? "s" : ""}</p>
                    </div>
                    <span className="font-mono text-foreground/80">{fmtBytes(s.sizeBytes)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        {/* Recent Sessions */}
        <Panel title="Recent Sessions" subtitle={`Top ${Math.min(sessions.length, 20)} by recency`}>
          <div className="space-y-2">
            {sessions.slice(0, 20).map((s, i) => {
              const p = s.contextTokens > 0 ? Math.round((s.totalTokens / s.contextTokens) * 100) : 0;
              const hasCache = s.cacheReadTokens > 0 || s.cacheWriteTokens > 0;
              return (
                <div key={`${s.sessionId}-${i}`} className="glass-subtle rounded-lg px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-xs font-semibold text-foreground/90">{s.agentId} · {shortModel(s.model)}</p>
                        {s.thinkingLevel && (
                          <span className="shrink-0 rounded-md border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                            think:{s.thinkingLevel}
                          </span>
                        )}
                        {!s.totalTokensFresh && (
                          <span className="shrink-0 rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                            stale
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground/60">{s.key || s.sessionId} · {fmtAgo(s.updatedAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-foreground/90">
                        {fmtTokens(s.totalTokens)}
                        <span className="ml-1.5 text-emerald-400">{fmtCost(s.estimatedCostUsd)}</span>
                      </p>
                      <p className="text-xs text-muted-foreground/60">{p}% context</p>
                    </div>
                  </div>
                  {hasCache && (
                    <p className="mt-1 text-[10px] text-muted-foreground/50">
                      Cache: {fmtTokens(s.cacheReadTokens)} read / {fmtTokens(s.cacheWriteTokens)} write
                    </p>
                  )}
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.04]">
                    <div
                      className={cn(
                        "h-full rounded-full",
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
