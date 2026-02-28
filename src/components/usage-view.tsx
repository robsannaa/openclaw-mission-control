"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Mail, RefreshCw, Sparkles, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import {
  getTimeFormatServerSnapshot,
  getTimeFormatSnapshot,
  subscribeTimeFormatPreference,
  withTimeFormat,
  type TimeFormatPreference,
} from "@/lib/time-format-preference";

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

type DiagnosticsSource = {
  ok: boolean;
  error: string | null;
};

type MissingPricingModel = {
  model: string;
  sessions: number;
  totalTokens: number;
};

type UsageDiagnostics = {
  sources: {
    gateway: DiagnosticsSource;
    usageHistoryWrite: DiagnosticsSource;
    historical: DiagnosticsSource;
    modelStatus: DiagnosticsSource;
    agentDirectory: DiagnosticsSource;
    sessionStorage: DiagnosticsSource & { failedAgents: string[] };
  };
  pricing: {
    coveredSessions: number;
    uncoveredSessions: number;
    coveragePct: number;
    uncoveredModels: MissingPricingModel[];
  };
  warnings: string[];
};

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
  diagnostics?: UsageDiagnostics;
};

type UsageAlarmTimeline = "last1h" | "last24h" | "last7d";

type UsageAlarmRule = {
  id: string;
  fullModel: string;
  timeline: UsageAlarmTimeline;
  tokenLimit: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

type UsageAlarmEvaluation = {
  ruleId: string;
  status: "ok" | "no-model-data" | "no-data-in-window";
  reason: string | null;
  provider: string;
  fullModel: string;
  timeline: UsageAlarmTimeline;
  tokenLimit: number;
  observedTokens: number;
  totalModelTokens: number;
  sampleSessions: number;
  staleSessions: number;
  exceeded: boolean;
  windowStart: number;
  windowEnd: number;
};

type UsageAlarmProviderCapability = {
  provider: string;
  providerUsageApiKnown: boolean;
  docsUrl: string | null;
  note: string;
};

type UsageAlarmsPayload = {
  ok: boolean;
  monitorEnabled: boolean;
  rules: UsageAlarmRule[];
  evaluations: UsageAlarmEvaluation[];
  alerts?: Array<{ id: string; message: string }>;
  providerCapabilities: Record<string, UsageAlarmProviderCapability>;
  warning?: string;
  degraded?: boolean;
};

type OpenRouterCredits = {
  total_credits: number;
  total_usage: number;
};

type OpenRouterActivityRow = {
  date: string;
  model: string;
  provider_name: string;
  usage: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
};

type OpenRouterKeyUsage = {
  key_hash: string;
  label: string;
  usage: number;
  limit: number | null;
  is_free_tier: boolean;
  rate_limit: { requests: number; interval: string } | null;
};

type OpenRouterBillingData = {
  available: true;
  credits: OpenRouterCredits;
  activity: OpenRouterActivityRow[];
  keys: OpenRouterKeyUsage[];
  fetchedAt: number;
};

type OpenRouterBillingUnavailable = {
  available: false;
  reason: string;
};

type OpenRouterBillingResult =
  | OpenRouterBillingData
  | OpenRouterBillingUnavailable;

type OrModelRow = {
  model: string;
  usage: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
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

const USAGE_ALARM_TIMELINE_LABELS: Record<UsageAlarmTimeline, string> = {
  last1h: "Last 1 hour",
  last24h: "Last 24 hours",
  last7d: "Last 7 days",
};

const SUPPORT_EMAIL = "roberto.sannazzaro@gmail.com";

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

const OR_MODEL_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5, hsl(280 60% 55%))",
  "var(--chart-6, hsl(200 60% 55%))",
  "var(--chart-muted)",
];

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

function modelProvider(model: string): string {
  const provider = String(model || "").split("/")[0]?.trim().toLowerCase();
  return provider || "unknown";
}

function ratio(input: number, output: number) {
  const sum = input + output;
  if (!sum) return { inPct: 0, outPct: 0 };
  return {
    inPct: Math.round((input / sum) * 100),
    outPct: Math.round((output / sum) * 100),
  };
}

function formatTimeTick(ts: number, period: Period, timeFormat: TimeFormatPreference): string {
  const d = new Date(ts);
  if (period === "last1h") return d.toLocaleTimeString("en-US", withTimeFormat({ hour: "numeric", minute: "2-digit" }, timeFormat));
  if (period === "last24h") return d.toLocaleTimeString("en-US", withTimeFormat({ hour: "numeric" }, timeFormat));
  if (period === "last7d") {
    const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
    const hour = d.toLocaleTimeString("en-US", withTimeFormat({ hour: "numeric" }, timeFormat));
    return `${weekday} ${hour}`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function labelForPoint(ts: number, period: Period, timeFormat: TimeFormatPreference): string {
  const d = new Date(ts);
  if (period === "last1h") return d.toLocaleTimeString("en-US", withTimeFormat({ hour: "numeric", minute: "2-digit" }, timeFormat));
  if (period === "last24h") return d.toLocaleString("en-US", withTimeFormat({ month: "short", day: "numeric", hour: "numeric" }, timeFormat));
  if (period === "last7d") return d.toLocaleString("en-US", withTimeFormat({ month: "short", day: "numeric", hour: "numeric" }, timeFormat));
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

function buildSupportEmailUrl(errorMessage: string): string {
  const timestamp = new Date().toISOString();
  const href = typeof window !== "undefined" ? window.location.href : "unknown";
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  const body = [
    "Hi Roberto,",
    "",
    "I hit an error in OpenClaw Mission Control (Usage page).",
    "",
    "Actual error:",
    errorMessage || "unknown",
    "",
    "Context:",
    `- Timestamp: ${timestamp}`,
    `- Page: ${href}`,
    `- User Agent: ${userAgent}`,
    "",
    "Please help me diagnose this.",
  ].join("\n");

  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(SUPPORT_EMAIL)}&su=${encodeURIComponent("OpenClaw Mission Control — Usage page error")}&body=${encodeURIComponent(body)}`;
}

/* ── ui blocks ──────────────────────────────────── */

function MetricTile({
  label,
  value,
  sub,
  variant = "subtle",
}: {
  label: string;
  value: string;
  sub?: string;
  variant?: "subtle" | "surface";
}) {
  return (
    <div className={cn(variant === "surface" ? "glass" : "glass-subtle", "rounded-lg px-4 py-3.5")}>
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
  timeFormat,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: number | string;
  timeFormat: TimeFormatPreference;
}) {
  if (!active || !payload?.length || typeof label !== "number") return null;
  const d = new Date(label);
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-foreground/90">
        {d.toLocaleString("en-US", withTimeFormat({ month: "short", day: "numeric", hour: "numeric" }, timeFormat))}
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
  const timeFormat = useSyncExternalStore(
    subscribeTimeFormatPreference,
    getTimeFormatSnapshot,
    getTimeFormatServerSnapshot,
  );
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("allTime");
  const [tokenFlowModel, setTokenFlowModel] = useState<string>("all");
  const [alarms, setAlarms] = useState<UsageAlarmsPayload | null>(null);
  const [alarmError, setAlarmError] = useState<string | null>(null);
  const [alarmBusy, setAlarmBusy] = useState(false);
  const [newAlarmModel, setNewAlarmModel] = useState("");
  const [newAlarmTimeline, setNewAlarmTimeline] = useState<UsageAlarmTimeline>("last24h");
  const [newAlarmLimit, setNewAlarmLimit] = useState("100000");
  const [orBilling, setOrBilling] = useState<OpenRouterBillingResult | null>(null);
  const [orLoading, setOrLoading] = useState(true);

  useEffect(() => {
    if (tokenFlowModel === "all" || !data) return;
    const hasModel = data.modelBreakdown.some((m) => m.model === tokenFlowModel);
    if (!hasModel) setTokenFlowModel("all");
  }, [data, tokenFlowModel]);

  const modelOptions = useMemo(() => {
    const all = new Set<string>();
    for (const model of data?.modelConfig?.allowed || []) all.add(String(model));
    for (const row of data?.modelBreakdown || []) {
      all.add(row.fullModel || row.model);
    }
    for (const rule of alarms?.rules || []) {
      all.add(rule.fullModel);
    }
    return Array.from(all)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [data, alarms]);

  useEffect(() => {
    if (newAlarmModel || modelOptions.length === 0) return;
    setNewAlarmModel(modelOptions[0]);
  }, [newAlarmModel, modelOptions]);

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

  const fetchAlarmsStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as UsageAlarmsPayload;
      setAlarms(json);
      setAlarmError(null);
    } catch (err) {
      setAlarmError(String(err));
    }
  }, []);

  const fetchOrBilling = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/openrouter", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as OpenRouterBillingResult;
      setOrBilling(json);
    } catch {
      setOrBilling({ available: false, reason: "Failed to reach /api/usage/openrouter" });
    } finally {
      setOrLoading(false);
    }
  }, []);

  const mutateAlarms = useCallback(
    async (payload: Record<string, unknown>) => {
      setAlarmBusy(true);
      try {
        const res = await fetch("/api/usage/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        await fetchAlarmsStatus();
        setAlarmError(null);
      } catch (err) {
        setAlarmError(String(err));
      } finally {
        setAlarmBusy(false);
      }
    },
    [fetchAlarmsStatus],
  );

  const createAlarm = useCallback(async () => {
    const tokenLimit = Number(newAlarmLimit);
    if (!newAlarmModel) {
      setAlarmError("Select a model before creating an alarm.");
      return;
    }
    if (!Number.isFinite(tokenLimit) || tokenLimit <= 0) {
      setAlarmError("Token limit must be a positive number.");
      return;
    }
    await mutateAlarms({
      action: "create",
      fullModel: newAlarmModel,
      timeline: newAlarmTimeline,
      tokenLimit: Math.floor(tokenLimit),
    });
  }, [mutateAlarms, newAlarmLimit, newAlarmModel, newAlarmTimeline]);

  useEffect(() => {
    void fetchData();
    void fetchAlarmsStatus();
    void fetchOrBilling();
  }, [fetchData, fetchAlarmsStatus, fetchOrBilling]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchData();
        void fetchAlarmsStatus();
        void fetchOrBilling();
      }
    }, 15000);
    const onFocus = () => {
      void fetchData();
      void fetchAlarmsStatus();
      void fetchOrBilling();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchData, fetchAlarmsStatus, fetchOrBilling]);

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

  // OpenRouter: 30-day spend from activity
  const orThirtyDaySpend = useMemo(() => {
    if (!orBilling?.available) return 0;
    return orBilling.activity.reduce((sum, r) => sum + r.usage, 0);
  }, [orBilling]);

  // OpenRouter: daily cost series grouped by date
  const orDailyCostSeries = useMemo(() => {
    if (!orBilling?.available) return [];
    const byDate = new Map<string, number>();
    for (const row of orBilling.activity) {
      byDate.set(row.date, (byDate.get(row.date) || 0) + row.usage);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, cost]) => ({ date, cost }));
  }, [orBilling]);

  // OpenRouter: model breakdown aggregated across all dates
  const orModelBreakdown = useMemo((): OrModelRow[] => {
    if (!orBilling?.available) return [];
    const byModel = new Map<string, OrModelRow>();
    for (const row of orBilling.activity) {
      const existing = byModel.get(row.model);
      if (existing) {
        existing.usage += row.usage;
        existing.requests += row.requests;
        existing.prompt_tokens += row.prompt_tokens;
        existing.completion_tokens += row.completion_tokens;
        existing.reasoning_tokens += row.reasoning_tokens;
      } else {
        byModel.set(row.model, {
          model: row.model,
          usage: row.usage,
          requests: row.requests,
          prompt_tokens: row.prompt_tokens,
          completion_tokens: row.completion_tokens,
          reasoning_tokens: row.reasoning_tokens,
        });
      }
    }
    return Array.from(byModel.values()).sort((a, b) => b.usage - a.usage);
  }, [orBilling]);

  // OpenRouter: per-model per-day stacked data (top 6 + "other")
  const orModelDailySeries = useMemo(() => {
    if (!orBilling?.available || orBilling.activity.length === 0) return { data: [] as ChartPoint[], config: {} as ChartConfig, modelKeys: [] as string[] };
    const topModels = orModelBreakdown.slice(0, 6).map((m) => m.model);
    const topSet = new Set(topModels);
    const modelKeys = [...topModels.map((m) => shortModel(m)), ...(orModelBreakdown.length > 6 ? ["other"] : [])];
    const byDate = new Map<string, ChartPoint>();
    for (const row of orBilling.activity) {
      const key = topSet.has(row.model) ? shortModel(row.model) : "other";
      if (!modelKeys.includes(key)) continue;
      const pt = byDate.get(row.date) || { date: row.date };
      pt[key] = ((pt[key] as number) || 0) + row.usage;
      byDate.set(row.date, pt);
    }
    const sorted = Array.from(byDate.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
    const config: ChartConfig = {};
    modelKeys.forEach((key, i) => {
      config[key] = { label: key, color: OR_MODEL_COLORS[i % OR_MODEL_COLORS.length] };
    });
    return { data: sorted, config, modelKeys };
  }, [orBilling, orModelBreakdown]);

  if (loading) {
    return <LoadingState label="Loading usage data..." size="lg" className="h-full" />;
  }

  if (error || !data) {
    const actualError = (error || "Usage API returned empty data.").trim();
    const gmailComposeHref = buildSupportEmailUrl(actualError);
    return (
      <SectionLayout>
        <SectionHeader
          title={<span className="font-serif font-bold text-base">Usage</span>}
          description="Cost estimation, token economics, cache metrics, and agent throughput."
        />
        <SectionBody width="narrow" padding="roomy" innerClassName="space-y-4">
          <section className="glass rounded-2xl border border-red-500/25 bg-red-500/5 p-5 md:p-6">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-700 dark:text-red-200">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Failed to Load Usage Data</h2>
                <p className="mt-1 text-xs text-muted-foreground/85">
                  Mission Control could not fetch analytics from <code>/api/usage</code>. This is usually temporary
                  (gateway restart, stale session metadata, or local API timeout).
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-foreground/10 bg-background/50 p-3">
              <p className="text-xs font-medium text-foreground/90">What you can try now</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-muted-foreground/80">
                <li>Retry once after a few seconds.</li>
                <li>Ensure OpenClaw gateway is online from the dashboard sidebar status.</li>
                <li>If this persists, send the prefilled support email below.</li>
              </ul>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setLoading(true);
                  void fetchData();
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry Loading Usage
              </Button>
              <Button asChild type="button" size="sm" variant="outline">
                <a href={gmailComposeHref} target="_blank" rel="noopener noreferrer">
                  <Mail className="h-3.5 w-3.5" />
                  Email Support (Prefilled)
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                </a>
              </Button>
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground/70">
              This opens Gmail with the exact runtime error and context prefilled.
            </p>

            <details className="mt-3 rounded-xl border border-foreground/10 bg-background/40 p-3">
              <summary className="cursor-pointer text-xs font-medium text-foreground/85">
                Technical Error Details
              </summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded-md border border-foreground/10 bg-card/70 p-2 text-[11px] text-foreground/85">
                {actualError}
              </pre>
            </details>
          </section>
        </SectionBody>
      </SectionLayout>
    );
  }

  const { totals, liveCost, sessions, modelBreakdown, modelConfig, peakSession, sessionFileSizes, historical } = data;
  const diagnostics = data.diagnostics;
  const pricingDiagnostics = diagnostics?.pricing;
  const hasPricingGap = (pricingDiagnostics?.uncoveredSessions || 0) > 0;
  const pricedSessionCount = pricingDiagnostics?.coveredSessions ?? totals.sessions;
  const costPerSession = pricedSessionCount > 0 ? liveCost.totalEstimatedUsd / pricedSessionCount : 0;
  const diagnosticsWarnings = (diagnostics?.warnings || []).filter(
    (warning) => !warning.includes("excluded from cost because pricing metadata is missing"),
  );
  const sourceErrors = diagnostics
    ? Object.entries(diagnostics.sources).filter(([, source]) => source.error)
    : [];
  const io = ratio(activeBucket?.input || 0, activeBucket?.output || 0);
  const alarmEvaluationsById = new Map((alarms?.evaluations || []).map((row) => [row.ruleId, row]));
  const selectedProvider = modelProvider(newAlarmModel);
  const selectedProviderCapability = alarms?.providerCapabilities?.[selectedProvider]
    || alarms?.providerCapabilities?.unknown;

  return (
    <SectionLayout>
      <SectionHeader
        title={<span className="font-serif font-bold text-base">Usage</span>}
        description="Cost estimation, token economics, cache metrics, and agent throughput."
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-muted p-1">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={period === p ? "secondary" : "ghost"}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "h-8 rounded-md px-3 text-xs font-medium transition-all duration-200",
                    period === p
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {PERIOD_LABELS[p]}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setLoading(true);
                void fetchData();
                void fetchAlarmsStatus();
              }}
              className="text-xs font-medium"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        }
      />

      <SectionBody width="content" padding="regular" innerClassName="space-y-4 pb-8">
        {/* Stale sessions banner */}
        {totals.staleSessions > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200">
            {totals.staleSessions} session{totals.staleSessions !== 1 ? "s have" : " has"} stale token counts
            &mdash; cost estimates may be outdated until the gateway refreshes.
          </div>
        )}
        {hasPricingGap && pricingDiagnostics && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-800 dark:text-rose-100">
            <p className="font-medium text-rose-900 dark:text-rose-50">Cost estimate is partial.</p>
            <p className="mt-1 text-rose-800/90 dark:text-rose-100/90">
              Pricing metadata is missing for {pricingDiagnostics.uncoveredSessions} session
              {pricingDiagnostics.uncoveredSessions !== 1 ? "s" : ""}. Coverage is{" "}
              {pricingDiagnostics.coveragePct}% ({pricingDiagnostics.coveredSessions}/{totals.sessions} sessions).
            </p>
            {pricingDiagnostics.uncoveredModels.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-rose-900/90 dark:text-rose-100/90">Models missing pricing metadata</summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-rose-800/90 dark:text-rose-100/90">
                  {pricingDiagnostics.uncoveredModels.slice(0, 8).map((model) => (
                    <li key={model.model}>
                      {shortModel(model.model)} · {model.sessions} sessions · {fmtTokensLong(model.totalTokens)} tokens
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {(diagnosticsWarnings.length || sourceErrors.length > 0) && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
            <p className="font-medium text-amber-900 dark:text-amber-100">Diagnostics</p>
            {diagnosticsWarnings.length ? (
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-amber-800/90 dark:text-amber-200/90">
                {diagnosticsWarnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {sourceErrors.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-amber-900/90 dark:text-amber-200/90">Technical source errors</summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-amber-800/90 dark:text-amber-200/90">
                  {sourceErrors.map(([sourceKey, source]) => (
                    <li key={sourceKey}>
                      {sourceKey}: {source.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <Panel
          title="Max Tokens Alarm"
          subtitle="Persistent per-model token alarms with browser notification + chat message delivery."
          actions={(
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void fetchAlarmsStatus()}
              className="text-xs font-medium"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh alarms
            </Button>
          )}
        >
          <div className="grid gap-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
            <select
              value={newAlarmModel}
              onChange={(e) => setNewAlarmModel(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {modelOptions.length === 0 && <option value="">No models available yet</option>}
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {shortModel(model)} ({modelProvider(model)})
                </option>
              ))}
            </select>
            <select
              value={newAlarmTimeline}
              onChange={(e) => setNewAlarmTimeline(e.target.value as UsageAlarmTimeline)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {(Object.keys(USAGE_ALARM_TIMELINE_LABELS) as UsageAlarmTimeline[]).map((timeline) => (
                <option key={timeline} value={timeline}>
                  {USAGE_ALARM_TIMELINE_LABELS[timeline]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              step={1000}
              value={newAlarmLimit}
              onChange={(e) => setNewAlarmLimit(e.target.value)}
              placeholder="Token limit"
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground/90 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button
              type="button"
              size="sm"
              disabled={alarmBusy || modelOptions.length === 0}
              onClick={() => void createAlarm()}
            >
              Add alarm
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-foreground/10 bg-card/40 px-3 py-2 text-xs">
            <p className="text-foreground/80">
              Monitor status:{" "}
              <span className={cn(
                "font-medium",
                alarms?.monitorEnabled === false ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300",
              )}
              >
                {alarms?.monitorEnabled === false ? "paused" : "active"}
              </span>
            </p>
            <Button
              type="button"
              size="sm"
              variant={alarms?.monitorEnabled === false ? "default" : "outline"}
              disabled={alarmBusy}
              onClick={() => void mutateAlarms({
                action: "set-monitor",
                monitorEnabled: alarms?.monitorEnabled === false,
              })}
              className="text-xs"
            >
              {alarms?.monitorEnabled === false ? "Enable monitor" : "Pause monitor"}
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/65">
            Desktop alerts require browser notification permission (Settings → Notifications & Chat).
          </p>

          {selectedProviderCapability && (
            <div className="mt-2 rounded-lg border border-foreground/10 bg-background/50 px-3 py-2 text-xs text-muted-foreground/80">
              <p>
                Provider context ({selectedProvider}): {selectedProviderCapability.note} Alarms are evaluated from local
                session telemetry for per-model token accuracy.
              </p>
              {selectedProviderCapability.docsUrl && (
                <a
                  href={selectedProviderCapability.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
                >
                  Provider docs
                </a>
              )}
            </div>
          )}

          {(alarmError || alarms?.warning) && (
            <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              {alarmError || alarms?.warning}
            </div>
          )}

          <div className="mt-3 space-y-2">
            {(alarms?.rules || []).length === 0 ? (
              <p className="rounded-lg border border-foreground/10 bg-card/40 px-3 py-2 text-xs text-muted-foreground/75">
                No token alarms configured yet.
              </p>
            ) : (
              (alarms?.rules || []).map((rule) => {
                const evalRow = alarmEvaluationsById.get(rule.id);
                const status = evalRow?.status || "no-model-data";
                const exceeded = Boolean(evalRow?.exceeded);
                const statusLabel = status === "ok"
                  ? exceeded
                    ? "limit exceeded"
                    : "within limit"
                  : status === "no-data-in-window"
                    ? "no data in window"
                    : "no model data";
                const statusTone = status === "ok"
                  ? exceeded
                    ? "text-red-700 dark:text-red-300"
                    : "text-emerald-700 dark:text-emerald-300"
                  : "text-amber-700 dark:text-amber-300";
                return (
                  <div key={rule.id} className="rounded-lg border border-foreground/10 bg-card/40 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground/90">
                          {shortModel(rule.fullModel)}
                          <span className="ml-1.5 text-[11px] text-muted-foreground/65">
                            ({USAGE_ALARM_TIMELINE_LABELS[rule.timeline]})
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground/70">
                          Limit {fmtTokensLong(rule.tokenLimit)} tokens
                          {evalRow
                            ? ` · observed ${fmtTokensLong(evalRow.observedTokens)}`
                            : ""}
                        </p>
                        {evalRow?.reason && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground/65">{evalRow.reason}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn("text-xs font-medium", statusTone)}>{statusLabel}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant={rule.enabled ? "outline" : "default"}
                          disabled={alarmBusy}
                          onClick={() => void mutateAlarms({
                            action: "toggle",
                            ruleId: rule.id,
                            enabled: !rule.enabled,
                          })}
                          className="h-7 px-2.5 text-[11px]"
                        >
                          {rule.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={alarmBusy}
                          onClick={() => void mutateAlarms({ action: "delete", ruleId: rule.id })}
                          className="h-7 px-2 text-[11px] text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Panel>

        {/* Metric tiles */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricTile
            variant="surface"
            label={orBilling?.available ? "Estimated Cost (Local)" : "Estimated Cost"}
            value={fmtCost(liveCost.totalEstimatedUsd)}
            sub={
              hasPricingGap && pricingDiagnostics
                ? `${pricingDiagnostics.coveragePct}% priced session coverage`
                : historical
                  ? `${fmtCost(historical.totalEstimatedUsd)} historical`
                  : "live sessions"
            }
          />
          <MetricTile
            variant="surface"
            label="Cost / Session"
            value={pricedSessionCount > 0 ? fmtCost(costPerSession) : "n/a"}
            sub={`across ${pricedSessionCount} priced session${pricedSessionCount !== 1 ? "s" : ""}`}
          />
          <MetricTile
            variant="surface"
            label={`Tokens · ${PERIOD_TITLES[period]}`}
            value={fmtTokens(activeBucket?.total || 0)}
            sub={`${io.inPct}% in / ${io.outPct}% out`}
          />
          <MetricTile
            variant="surface"
            label="Sessions"
            value={String(activeBucket?.sessions || 0)}
            sub={`of ${totals.sessions} total`}
          />
        </div>

        {/* Cache + config row */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricTile
            variant="surface"
            label="Cache Read"
            value={fmtTokens(liveCost.totalCacheReadTokens)}
            sub={fmtTokensLong(liveCost.totalCacheReadTokens)}
          />
          <MetricTile
            variant="surface"
            label="Cache Write"
            value={fmtTokens(liveCost.totalCacheWriteTokens)}
            sub={fmtTokensLong(liveCost.totalCacheWriteTokens)}
          />
          <MetricTile
            variant="surface"
            label="Models"
            value={String(totals.models)}
            sub={modelConfig?.primary ? `primary ${shortModel(modelConfig.primary)}` : ""}
          />
          <MetricTile
            variant="surface"
            label="Agents"
            value={String(totals.agents)}
            sub={peakSession ? `peak ${peakSession.agentId}` : "active workers"}
          />
        </div>

        {/* Provider Billing (OpenRouter) */}
        {orLoading ? (
          <Panel title="Provider Billing" subtitle="Loading OpenRouter billing data...">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="glass-subtle animate-pulse rounded-lg px-4 py-3.5">
                  <div className="h-2.5 w-20 rounded bg-foreground/10" />
                  <div className="mt-3 h-5 w-16 rounded bg-foreground/10" />
                  <div className="mt-2 h-2 w-24 rounded bg-foreground/10" />
                </div>
              ))}
            </div>
          </Panel>
        ) : orBilling?.available ? (
          <Panel
            title="Provider Billing"
            subtitle="Real cost data from OpenRouter Management API"
            actions={
              <span className="text-[10px] text-muted-foreground/50">
                Fetched {new Date(orBilling.fetchedAt).toLocaleTimeString("en-US", withTimeFormat({ hour: "numeric", minute: "2-digit" }, timeFormat))}
              </span>
            }
          >
            <div className="space-y-4">
              {/* OR metric tiles */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricTile
                  label="Total Spent"
                  value={fmtCost(orBilling.credits.total_usage)}
                  sub={`of ${fmtCost(orBilling.credits.total_credits)} credits purchased`}
                />
                <MetricTile
                  label="30-Day Spend"
                  value={fmtCost(orThirtyDaySpend)}
                  sub={`${orBilling.activity.length} activity rows`}
                />
                <MetricTile
                  label="Balance"
                  value={fmtCost(orBilling.credits.total_credits - orBilling.credits.total_usage)}
                  sub="credits remaining"
                />
                <MetricTile
                  label="Active Keys"
                  value={String(orBilling.keys.length)}
                  sub={orBilling.keys.filter((k) => k.is_free_tier).length > 0 ? "includes free tier" : "paid keys"}
                />
              </div>

              {/* Daily Cost by Model chart */}
              {orModelDailySeries.data.length > 1 && (
                <div>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                    Daily Cost by Model (30 days)
                  </p>
                  <ChartContainer config={orModelDailySeries.config} className="h-56 w-full">
                    <ComposedChart data={orModelDailySeries.data} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={USAGE_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                        axisLine={false}
                        tickLine={false}
                        width={54}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            formatter={(value) => fmtCost(Number(value))}
                          />
                        }
                      />
                      <ChartLegend content={<ChartLegendContent />} />
                      {orModelDailySeries.modelKeys.map((key, i) => (
                        <Area
                          key={key}
                          type="monotone"
                          dataKey={key}
                          name={key}
                          stackId="or-models"
                          stroke={OR_MODEL_COLORS[i % OR_MODEL_COLORS.length]}
                          fill={OR_MODEL_COLORS[i % OR_MODEL_COLORS.length]}
                          fillOpacity={0.3}
                          strokeWidth={1.5}
                        />
                      ))}
                    </ComposedChart>
                  </ChartContainer>
                </div>
              )}

              {/* Daily Total Cost trend */}
              {orDailyCostSeries.length > 1 && (
                <div>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                    Daily Total Cost (30 days)
                  </p>
                  <ChartContainer
                    config={{ cost: { label: "Daily Cost", color: "var(--chart-2)" } } satisfies ChartConfig}
                    className="h-40 w-full"
                  >
                    <ComposedChart data={orDailyCostSeries} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="orDailyCostFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={USAGE_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                        tick={{ fontSize: 10, fill: USAGE_COLORS.tick }}
                        axisLine={false}
                        tickLine={false}
                        width={54}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            formatter={(value) => fmtCost(Number(value))}
                          />
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="cost"
                        name="Daily Cost"
                        stroke="var(--chart-2)"
                        strokeWidth={1.5}
                        fill="url(#orDailyCostFill)"
                      />
                    </ComposedChart>
                  </ChartContainer>
                </div>
              )}

              {/* Top Models by Real Cost */}
              {orModelBreakdown.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                    Top Models by Real Cost
                  </p>
                  <div className="space-y-2">
                    {orModelBreakdown.slice(0, 8).map((m) => {
                      const pct = orThirtyDaySpend > 0 ? Math.round((m.usage / orThirtyDaySpend) * 100) : 0;
                      const totalTokens = m.prompt_tokens + m.completion_tokens + m.reasoning_tokens;
                      return (
                        <div key={m.model} className="glass-subtle rounded-lg px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-foreground/90">{shortModel(m.model)}</p>
                              <p className="text-xs text-muted-foreground/60">
                                {m.requests.toLocaleString("en-US")} requests · {fmtTokens(totalTokens)} tokens
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                                {fmtCost(m.usage)}
                              </p>
                              <p className="text-xs text-muted-foreground/60">{pct}% of 30d</p>
                            </div>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.04]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(2, pct)}%`,
                                background: `linear-gradient(90deg, var(--chart-4), var(--chart-2))`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        ) : orBilling ? (
          <Panel title="Provider Billing" subtitle="OpenRouter Management API">
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
                {orBilling.reason}
              </div>
              <div className="rounded-lg border border-foreground/10 bg-background/50 p-4">
                <p className="text-xs font-medium text-foreground/90">Setup Guide</p>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-muted-foreground/80">
                  <li>
                    Go to{" "}
                    <a
                      href="https://openrouter.ai/settings/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-700 hover:underline dark:text-blue-300"
                    >
                      openrouter.ai/settings/keys
                    </a>{" "}
                    and create a <strong>Management API key</strong>.
                  </li>
                  <li>
                    Add the key to <code className="rounded bg-foreground/10 px-1.5 py-0.5">~/.openclaw/.env</code>:
                    <pre className="mt-1 rounded-md border border-foreground/10 bg-card/70 px-3 py-2 text-[11px] text-foreground/85">
                      OPENROUTER_MANAGEMENT_KEY=sk-or-mgmt-...
                    </pre>
                  </li>
                  <li>Refresh this page. Billing data will appear automatically.</li>
                </ol>
                <p className="mt-3 text-[11px] text-muted-foreground/60">
                  This key is read-only and only accesses billing and usage data. It cannot make model requests or modify your account.
                </p>
              </div>
            </div>
          </Panel>
        ) : null}

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
                    return d.toLocaleString("en-US", withTimeFormat({ month: "short", day: "numeric", hour: "numeric" }, timeFormat));
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
                <ChartTooltip content={<CostTrendTooltip timeFormat={timeFormat} />} cursor={false} />
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
                    tickFormatter={(v) => formatTimeTick(Number(v), period, timeFormat)}
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
                        labelFormatter={(value) => labelForPoint(Number(value), period, timeFormat)}
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
                            <span
                              className={cn(
                                "ml-1.5",
                                m.estimatedCostUsd == null
                                  ? "text-amber-700 dark:text-amber-300"
                                  : "text-emerald-700 dark:text-emerald-300",
                              )}
                            >
                              {m.estimatedCostUsd == null ? "unpriced" : fmtCost(m.estimatedCostUsd)}
                            </span>
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
                          <span className="shrink-0 rounded-md border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                            think:{s.thinkingLevel}
                          </span>
                        )}
                        {!s.totalTokensFresh && (
                          <span className="shrink-0 rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                            stale
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground/60">{s.key || s.sessionId} · {fmtAgo(s.updatedAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-foreground/90">
                        {fmtTokens(s.totalTokens)}
                        <span
                          className={cn(
                            "ml-1.5",
                            s.estimatedCostUsd == null
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-emerald-700 dark:text-emerald-300",
                          )}
                        >
                          {s.estimatedCostUsd == null ? "unpriced" : fmtCost(s.estimatedCostUsd)}
                        </span>
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
