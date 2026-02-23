"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bot,
  Clock,
  Radio,
  Smartphone,
  Wrench,
  AlertCircle,
  CheckCircle,
  Zap,
  RefreshCw,
  Cpu,
  MemoryStick,
  HardDrive,
  Server,
  Folder,
  FileText,
  Database,
  Gauge,
  Timer,
  AlertTriangle,
  Info,
  ArrowRight,
  Shield,
  Rocket,
  KeyRound,
  Bell,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionLayout } from "@/components/section-layout";

/* ── types ────────────────────────────────────────── */

type LiveData = {
  timestamp: number;
  gateway: { status: string; latencyMs: number; port: number; version: string };
  cron: {
    jobs: CronJobLive[];
    stats: { total: number; ok: number; error: number };
  };
  cronRuns: CronRun[];
  agents: { id: string; name: string; emoji: string; sessionCount: number; totalTokens: number; lastActivity: number }[];
  logEntries: LogEntry[];
};

type CronJobLive = {
  id: string;
  name: string;
  enabled: boolean;
  lastStatus: string;
  lastRunAtMs: number | null;
  nextRunAtMs: number | null;
  lastDurationMs: number | null;
  consecutiveErrors: number;
  lastError: string | null;
  scheduleDisplay: string;
};

type CronRun = {
  ts: number;
  jobId: string;
  action: string;
  status: string;
  summary?: string;
  durationMs?: number;
  error?: string;
};

type LogEntry = { time: string; source: string; message: string };

type SystemData = {
  channels: { name: string; enabled: boolean; accounts: string[] }[];
  devices: { displayName?: string; platform: string; clientMode: string; lastUsedAt: number }[];
  skills: { name: string; source: string }[];
  models: { id: string; alias?: string }[];
  stats: { totalDevices: number; totalSkills: number; totalChannels: number };
  gateway?: {
    port?: number;
    mode?: string;
    authMode?: "token" | "password";
    tokenConfigured?: boolean;
    allowTailscale?: boolean;
  };
};

type PairingSummary = {
  dm: unknown[];
  devices: unknown[];
  total: number;
};

type GatewayDiagnosticsData = {
  ts: number;
  status: {
    service?: {
      loaded?: boolean;
      runtime?: { status?: string; state?: string; pid?: number };
      configAudit?: { ok?: boolean; issues?: unknown[] };
    };
    gateway?: { bindMode?: string; bindHost?: string; port?: number };
    port?: { port?: number; status?: string };
    rpc?: { ok?: boolean; url?: string };
  } | null;
  statusError?: string | null;
  doctor: {
    command: string;
    ok: boolean;
    exitCode: number;
    summary: { error: number; warning: number; info: number };
    lines: string[];
    raw: string;
  };
  summary: { error: number; warning: number; info: number };
  highlights: Array<{
    source: "gateway-status" | "doctor";
    severity: "error" | "warning" | "info";
    text: string;
  }>;
};

/* ── helpers ──────────────────────────────────────── */

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatAgo(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCountdown(ms: number | null): string {
  if (!ms) return "—";
  const diff = ms - Date.now();
  if (diff <= 0) return "overdue";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function cronProgress(job: CronJobLive): number {
  if (!job.lastRunAtMs || !job.nextRunAtMs) return 0;
  const total = job.nextRunAtMs - job.lastRunAtMs;
  const elapsed = Date.now() - job.lastRunAtMs;
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

/* ── System stats types ──────────────────────────── */

type SystemStats = {
  ts: number;
  cpu: {
    model: string;
    cores: number;
    usage: number;
    speed: number;
    load1: number;
    load5: number;
    load15: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percent: number;
    app?: number;
    wired?: number;
    compressed?: number;
    cached?: number;
    swapUsed?: number;
    source?: "os" | "vm_stat" | "proc_meminfo";
  };
  disk: { total: number; used: number; free: number; percent: number };
  system: {
    hostname: string;
    platform: string;
    arch: string;
    uptime: number;
    uptimeDisplay: string;
    processCount: number;
  };
  openclaw: {
    homeDir: string;
    workspaceSizeBytes: number;
    sessionsSizeBytes: number;
    totalWorkspaceFiles: number;
    logSizeBytes: number;
    activeSessions: number;
  };
};

function formatBytesCompact(b: number): string {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}

const DASHBOARD_COLORS = {
  primary: "var(--chart-1)",
  success: "var(--chart-2)",
  warning: "var(--chart-3)",
  info: "var(--chart-4)",
  danger: "var(--chart-5)",
  muted: "var(--chart-muted)",
  mutedStrong: "var(--muted-foreground)",
};

/* ── SSE hook: useSystemStats ─────────────────────── */

function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/stats/stream");
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SystemStats;
        if (data.ts) setStats(data);
      } catch {
        /* skip malformed */
      }
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  return { stats, connected };
}

/* ── Radial gauge ────────────────────────────────── */

function RadialGauge({
  value,
  max,
  label,
  unit,
  color,
  size = 88,
}: {
  value: number;
  max: number;
  label: string;
  unit?: string;
  color: string;
  size?: number;
}) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            className="text-foreground/[0.04]"
            strokeWidth={5}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            className="transition-all duration-700 ease-out"
            style={{}}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {Math.round(percent)}
            <span className="text-xs text-muted-foreground/60">%</span>
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      {unit && <p className="text-[11px] text-muted-foreground/40">{unit}</p>}
    </div>
  );
}

/* ── Mini bar ────────────────────────────────────── */

function MiniBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-foreground/[0.04]">
      <div
        className="h-1.5 rounded-full transition-all duration-700 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: color }}
      />
    </div>
  );
}

function MemoryCompositionBar({
  memory,
  memoryFreeLabel,
}: {
  memory: SystemStats["memory"];
  memoryFreeLabel: string;
}) {
  const seg = (
    key: string,
    label: string,
    value: number | undefined,
    color: string
  ): { key: string; label: string; value: number; color: string } | null => {
    if (typeof value !== "number" || value <= 0) return null;
    return { key, label, value, color };
  };

  const segments = [
    seg("app", "App", memory.app, DASHBOARD_COLORS.success),
    seg("wired", "Wired", memory.wired, DASHBOARD_COLORS.info),
    seg("compressed", "Compressed", memory.compressed, DASHBOARD_COLORS.danger),
    seg("cached", "Cached Files", memory.cached, DASHBOARD_COLORS.primary),
    seg("free", memoryFreeLabel, memory.free, DASHBOARD_COLORS.muted),
  ].filter((s): s is { key: string; label: string; value: number; color: string } => Boolean(s));

  if (segments.length === 0) {
    const fallbackUsed = Math.max(0, memory.used || 0);
    const fallbackFree = Math.max(0, memory.total - fallbackUsed);
    if (fallbackUsed > 0) segments.push({ key: "used", label: "Used", value: fallbackUsed, color: DASHBOARD_COLORS.primary });
    if (fallbackFree > 0) segments.push({ key: "free", label: memoryFreeLabel, value: fallbackFree, color: DASHBOARD_COLORS.muted });
  }

  const known = segments.reduce((sum, item) => sum + item.value, 0);
  const remainder = Math.max(0, (memory.total || 0) - known);
  if (remainder > (memory.total || 0) * 0.005) {
    segments.push({ key: "other", label: "Kernel / Other", value: remainder, color: DASHBOARD_COLORS.mutedStrong });
  }

  const denom = Math.max(memory.total || 0, segments.reduce((sum, item) => sum + item.value, 0), 1);

  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.04]">
        {segments.map((item) => (
          <div
            key={item.key}
            className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-700 ease-out"
            style={{ width: `${(item.value / denom) * 100}%`, backgroundColor: item.color }}
            title={`${item.label}: ${formatBytesCompact(item.value)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground/60">
        {segments.map((item) => (
          <span key={`${item.key}-legend`} className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── System Stats Panel ──────────────────────────── */

function SystemStatsPanel({ stats, connected }: { stats: SystemStats | null; connected: boolean }) {
  if (!stats) {
    return (
      <div className="glass rounded-lg p-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
          <Gauge className="h-4 w-4 animate-pulse" />
          Connecting to system stats stream...
        </div>
      </div>
    );
  }

  const cpuColor =
    stats.cpu.usage > 80 ? DASHBOARD_COLORS.danger : stats.cpu.usage > 50 ? DASHBOARD_COLORS.warning : DASHBOARD_COLORS.success;
  const memColor =
    stats.memory.percent > 85 ? DASHBOARD_COLORS.danger : stats.memory.percent > 65 ? DASHBOARD_COLORS.warning : DASHBOARD_COLORS.primary;
  const diskColor =
    stats.disk.percent > 90 ? DASHBOARD_COLORS.danger : stats.disk.percent > 75 ? DASHBOARD_COLORS.warning : DASHBOARD_COLORS.info;
  const memorySourceLabel =
    stats.memory.source === "vm_stat"
      ? " (Activity-style)"
      : stats.memory.source === "proc_meminfo"
        ? " (MemAvailable)"
        : "";
  const memoryFreeLabel =
    stats.memory.source === "vm_stat"
      ? "Free + Speculative"
      : stats.memory.source === "proc_meminfo"
        ? "Available"
        : "Free";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-sans font-semibold uppercase tracking-wider text-muted-foreground">
          <Server className="h-3.5 w-3.5" /> System Monitor
        </h2>
        <div className="flex items-center gap-1.5">
          <span className={cn("inline-flex h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-red-500")} />
          <span className="text-xs text-muted-foreground/50">
            {connected ? "LIVE" : "RECONNECTING"}
          </span>
        </div>
      </div>

      {/* Gauges row */}
      <div className="glass grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 rounded-lg px-4 py-5">
        <div className="relative flex justify-center">
          <RadialGauge value={stats.cpu.usage} max={100} label="CPU" unit={`${stats.cpu.cores} cores`} color={cpuColor} />
        </div>
        <div className="relative flex justify-center">
          <RadialGauge value={stats.memory.percent} max={100} label="Memory" unit={`${formatBytesCompact(stats.memory.used)} / ${formatBytesCompact(stats.memory.total)}`} color={memColor} />
        </div>
        <div className="relative flex justify-center">
          <RadialGauge value={stats.disk.percent} max={100} label="Disk" unit={`${formatBytesCompact(stats.disk.used)} / ${formatBytesCompact(stats.disk.total)}`} color={diskColor} />
        </div>
      </div>

      {/* Detail cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* CPU details */}
        <div className="glass-subtle rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Cpu className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-sans font-semibold text-foreground/70">CPU</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Usage</span>
              <span className="font-mono text-foreground/70">{stats.cpu.usage}%</span>
            </div>
            <MiniBar percent={stats.cpu.usage} color={cpuColor} />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Load (1/5/15m)</span>
              <span className="font-mono text-muted-foreground">
                {stats.cpu.load1} / {stats.cpu.load5} / {stats.cpu.load15}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Speed</span>
              <span className="font-mono text-muted-foreground">{stats.cpu.speed} MHz</span>
            </div>
            <p className="truncate text-xs text-muted-foreground/40" title={stats.cpu.model}>
              {stats.cpu.model}
            </p>
          </div>
        </div>

        {/* Memory details */}
        <div className="glass-subtle rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <MemoryStick className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-xs font-sans font-semibold text-foreground/70">
              Memory
              {memorySourceLabel}
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Used</span>
              <span className="font-mono text-foreground/70">
                {formatBytesCompact(stats.memory.used)}
              </span>
            </div>
            <MemoryCompositionBar memory={stats.memory} memoryFreeLabel={memoryFreeLabel} />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">{memoryFreeLabel}</span>
              <span className="font-mono text-muted-foreground">
                {formatBytesCompact(stats.memory.free)}
              </span>
            </div>
            {typeof stats.memory.app === "number" && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground/60">App</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytesCompact(stats.memory.app)}
                </span>
              </div>
            )}
            {typeof stats.memory.wired === "number" && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground/60">Wired</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytesCompact(stats.memory.wired)}
                </span>
              </div>
            )}
            {typeof stats.memory.compressed === "number" && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground/60">Compressed</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytesCompact(stats.memory.compressed)}
                </span>
              </div>
            )}
            {typeof stats.memory.cached === "number" && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground/60">Cached Files</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytesCompact(stats.memory.cached)}
                </span>
              </div>
            )}
            {typeof stats.memory.swapUsed === "number" && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground/60">Swap Used</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytesCompact(stats.memory.swapUsed)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Total</span>
              <span className="font-mono text-muted-foreground">
                {formatBytesCompact(stats.memory.total)}
              </span>
            </div>
          </div>
        </div>

        {/* Disk details */}
        <div className="glass-subtle rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <HardDrive className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs font-sans font-semibold text-foreground/70">Disk</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Used</span>
              <span className="font-mono text-foreground/70">
                {formatBytesCompact(stats.disk.used)}
              </span>
            </div>
            <MiniBar percent={stats.disk.percent} color={diskColor} />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Free</span>
              <span className="font-mono text-muted-foreground">
                {formatBytesCompact(stats.disk.free)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Total</span>
              <span className="font-mono text-muted-foreground">
                {formatBytesCompact(stats.disk.total)}
              </span>
            </div>
          </div>
        </div>

        {/* System info */}
        <div className="glass-subtle rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Timer className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-sans font-semibold text-foreground/70">System</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Hostname</span>
              <span className="font-mono text-muted-foreground">{stats.system.hostname}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Platform</span>
              <span className="font-mono text-muted-foreground">
                {stats.system.platform} {stats.system.arch}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Uptime</span>
              <span className="font-mono text-muted-foreground">{stats.system.uptimeDisplay}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground/60">Processes</span>
              <span className="font-mono text-muted-foreground">{stats.system.processCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* OpenClaw storage stats */}
      <div className="glass-subtle rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-pink-400" />
          <span className="text-xs font-sans font-semibold text-foreground/70">OpenClaw Storage</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <OcStatMini icon={Folder} label="Workspace" value={formatBytesCompact(stats.openclaw.workspaceSizeBytes)} color="text-violet-400" />
          <OcStatMini icon={FileText} label="Files" value={String(stats.openclaw.totalWorkspaceFiles)} color="text-blue-400" />
          <OcStatMini icon={Database} label="Sessions" value={String(stats.openclaw.activeSessions)} sub={formatBytesCompact(stats.openclaw.sessionsSizeBytes)} color="text-emerald-400" />
          <OcStatMini icon={FileText} label="Today's Log" value={formatBytesCompact(stats.openclaw.logSizeBytes)} color="text-amber-400" />
        </div>
      </div>
    </div>
  );
}

function GatewayDiagnosticsPanel({
  data,
  loading,
  error,
  onRefresh,
}: {
  data: GatewayDiagnosticsData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const status = data?.status;
  const summary = data?.summary || { error: 0, warning: 0, info: 0 };
  const runtimeStatus = status?.service?.runtime?.status || "unknown";
  const bind = status?.gateway?.bindMode || "unknown";
  const rpcLabel = status?.rpc?.ok ? "reachable" : "unreachable";
  const portLabel = status?.port?.port || status?.gateway?.port || "—";

  return (
    <div className="space-y-4">
      <div className="glass rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-sans font-medium text-foreground/90">Gateway Diagnostics</p>
            <p className="text-xs text-muted-foreground/60">
              Live snapshot from <code className="rounded bg-foreground/[0.06] px-1">gateway status</code> and{" "}
              <code className="rounded bg-foreground/[0.06] px-1">doctor</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1.5 text-xs text-foreground/80 transition-colors hover:bg-foreground/[0.08] disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1.5">
            <p className="text-xs uppercase tracking-wide text-red-300/80">Errors</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-red-200">{summary.error}</p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
            <p className="text-xs uppercase tracking-wide text-amber-300/80">Warnings</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-amber-200">{summary.warning}</p>
          </div>
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-2.5 py-1.5">
            <p className="text-xs uppercase tracking-wide text-blue-300/80">Signals</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-blue-200">{summary.info}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { label: "Runtime", value: runtimeStatus },
            { label: "Bind", value: bind },
            { label: "Port", value: String(portLabel) },
            { label: "RPC", value: rpcLabel },
            { label: "Doctor", value: data?.doctor?.ok ? "ok" : `exit ${data?.doctor?.exitCode ?? "?"}` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.03] px-2.5 py-1.5">
              <p className="text-xs text-muted-foreground/60">{label}</p>
              <p className="mt-0.5 text-xs font-medium text-foreground/90">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-200">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="rounded-lg border border-foreground/10 bg-card/70 px-4 py-8 text-center text-xs text-muted-foreground/70">
          <RefreshCw className="mx-auto mb-2 h-4 w-4 animate-spin" />
          Running gateway checks...
        </div>
      )}

      {data && (
        <>
          <div className="glass-subtle rounded-lg p-3">
            <h3 className="mb-1.5 text-xs font-sans font-semibold uppercase tracking-wider text-muted-foreground/60">
              Alerts & Recommendations
            </h3>
            <div className="space-y-1">
              {data.highlights.slice(0, 14).map((item, idx) => {
                const cfg =
                  item.severity === "error"
                    ? {
                      icon: AlertCircle,
                      row: "border-red-500/20 bg-red-500/5 text-red-200",
                      chip: "bg-red-500/15 text-red-300",
                    }
                    : item.severity === "warning"
                      ? {
                        icon: AlertTriangle,
                        row: "border-amber-500/20 bg-amber-500/5 text-amber-100",
                        chip: "bg-amber-500/15 text-amber-300",
                      }
                      : {
                        icon: Info,
                        row: "border-blue-500/20 bg-blue-500/5 text-blue-100",
                        chip: "bg-blue-500/15 text-blue-300",
                      };
                const SevIcon = cfg.icon;
                return (
                  <div
                    key={`${item.source}-${idx}-${item.text}`}
                    className={cn("flex items-start gap-2 rounded-lg border px-2 py-1.5", cfg.row)}
                  >
                    <SevIcon className="mt-0.5 h-3 w-3 shrink-0" />
                    <div className="min-w-0 flex-1 text-xs leading-snug">{item.text}</div>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs uppercase tracking-wide", cfg.chip)}>
                      {item.source === "doctor" ? "doctor" : "status"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass-subtle rounded-lg p-3">
            <h3 className="mb-1.5 text-xs font-sans font-semibold uppercase tracking-wider text-muted-foreground/60">
              Doctor Output
            </h3>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-foreground/[0.06] bg-foreground/[0.03] p-2 font-mono text-xs leading-snug text-muted-foreground/90">
              {(data.doctor.lines || []).slice(0, 120).map((line, idx) => (
                <div key={`${idx}-${line}`} className="truncate">
                  {line}
                </div>
              ))}
              {(data.doctor.lines || []).length === 0 && <div>No doctor output.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OcStatMini({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="text-center">
      <Icon className={cn("mx-auto h-3.5 w-3.5", color)} />
      <p className="mt-1 text-sm font-semibold tabular-nums text-foreground/90">{value}</p>
      <p className="text-xs text-muted-foreground/60">{label}</p>
      {sub && <p className="text-xs text-muted-foreground/40">{sub}</p>}
    </div>
  );
}

/* ── component ───────────────────────────────────── */

const POLL_INTERVAL = 8000;

export function DashboardView() {
  const router = useRouter();
  const [live, setLive] = useState<LiveData | null>(null);
  const [system, setSystem] = useState<SystemData | null>(null);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [dashboardTab, setDashboardTab] = useState<"overview" | "gateway">("overview");
  const [gatewayDiag, setGatewayDiag] = useState<GatewayDiagnosticsData | null>(null);
  const [gatewayDiagError, setGatewayDiagError] = useState<string | null>(null);
  const [gatewayDiagLoading, setGatewayDiagLoading] = useState(false);
  const [pairingSummary, setPairingSummary] = useState<PairingSummary | null>(null);
  const [onboardStatus, setOnboardStatus] = useState<{
    installed: boolean;
    configured: boolean;
  } | null>(null);
  const [onboardDismissed, setOnboardDismissed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("mc-onboard-dismissed") === "1";
    }
    return false;
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { stats: sysStats, connected: sseConnected } = useSystemStats();

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch("/api/live", { cache: "no-store" });
      const data = await res.json();
      setLive(data);
      setLastRefresh(Date.now());
    } catch { /* retry next interval */ }
  }, []);

  const fetchGatewayDiagnostics = useCallback(
    async (silent = false) => {
      if (!silent) setGatewayDiagLoading(true);
      try {
        const res = await fetch("/api/gateway/diagnostics", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GatewayDiagnosticsData;
        setGatewayDiag(data);
        setGatewayDiagError(null);
      } catch (err) {
        setGatewayDiagError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setGatewayDiagLoading(false);
      }
    },
    []
  );

  const openCronJob = useCallback(
    (jobId: string) => {
      if (!jobId) return;
      const params = new URLSearchParams();
      params.set("job", jobId);
      router.push(`/cron?${params.toString()}`);
    },
    [router]
  );

  useEffect(() => {
    queueMicrotask(() => fetchLive());
    fetch("/api/system", { cache: "no-store" })
      .then((r) => r.json())
      .then(setSystem)
      .catch(() => { });
    fetch("/api/pairing", { cache: "no-store" })
      .then((r) => r.json())
      .then(setPairingSummary)
      .catch(() => { });
    fetch("/api/onboard", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setOnboardStatus({ installed: d.installed, configured: d.configured }))
      .catch(() => { });

    const startLivePolling = () => {
      if (pollRef.current) return;
      pollRef.current = setInterval(() => {
        void fetchLive();
      }, POLL_INTERVAL);
    };

    const stopLivePolling = () => {
      if (!pollRef.current) return;
      clearInterval(pollRef.current);
      pollRef.current = null;
    };

    const handleVisibility = () => {
      if (document.hidden) stopLivePolling();
      else {
        void fetchLive();
        startLivePolling();
      }
    };

    if (!document.hidden) startLivePolling();
    document.addEventListener("visibilitychange", handleVisibility);

    tickRef.current = setInterval(() => {
      if (document.hidden) return;
      setNow(Date.now());
    }, 1000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (pollRef.current) clearInterval(pollRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [fetchLive]);

  useEffect(() => {
    if (dashboardTab !== "gateway") return;
    void fetchGatewayDiagnostics();
    const id = setInterval(() => {
      void fetchGatewayDiagnostics(true);
    }, 30000);
    return () => clearInterval(id);
  }, [dashboardTab, fetchGatewayDiagnostics]);

  if (!live) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Connecting to system...
      </div>
    );
  }

  const gw = live.gateway;
  const isOnline = gw.status === "online";

  // ── Issue detection ──────────────────────────────
  type Issue = {
    id: string;
    severity: "critical" | "warning" | "info";
    title: string;
    detail: string;
    fixLabel?: string;
    fixHref?: string;
  };

  const issues: Issue[] = [];

  if (!isOnline) {
    issues.push({
      id: "gw-offline",
      severity: "critical",
      title: "Gateway is offline",
      detail: "The OpenClaw gateway process is not responding. Most features will not work.",
      fixLabel: "Restart Gateway",
      fixHref: "/channels",
    });
  }

  for (const job of live.cron.jobs) {
    if (job.consecutiveErrors >= 3) {
      issues.push({
        id: `cron-err-${job.id}`,
        severity: "critical",
        title: `Cron "${job.name}" keeps failing`,
        detail: `${job.consecutiveErrors} consecutive errors. Last: ${job.lastError || "unknown"}`,
        fixLabel: "Fix Cron Job",
        fixHref: "/cron?show=errors",
      });
    }
  }

  for (const job of live.cron.jobs) {
    if (job.lastError?.includes("delivery target is missing")) {
      issues.push({
        id: `cron-target-${job.id}`,
        severity: "warning",
        title: `"${job.name}" has no delivery target`,
        detail: "Job runs but can't deliver results. Set a recipient (e.g. telegram:CHAT_ID).",
        fixLabel: "Set Target",
        fixHref: "/cron?show=errors",
      });
    }
  }

  for (const job of live.cron.jobs) {
    if (job.lastStatus === "error" && (job.consecutiveErrors || 0) < 3 && !issues.find(i => i.id === `cron-err-${job.id}` || i.id === `cron-target-${job.id}`)) {
      issues.push({
        id: `cron-warn-${job.id}`,
        severity: "warning",
        title: `Cron "${job.name}" last run failed`,
        detail: job.lastError || "Unknown error",
        fixLabel: "View Details",
        fixHref: "/cron?show=errors",
      });
    }
  }

  if (system && system.stats.totalChannels === 0) {
    issues.push({
      id: "no-channels",
      severity: "warning",
      title: "No messaging channels connected",
      detail: "Connect Telegram, WhatsApp, or another channel to receive agent messages.",
      fixLabel: "Setup Channel",
      fixHref: "/agents",
    });
  }

  if (live.cron.stats.total === 0) {
    issues.push({
      id: "no-cron",
      severity: "info",
      title: "No cron jobs configured",
      detail: "Scheduled tasks let your agent work automatically — summaries, reminders, reports.",
      fixLabel: "Create Cron Job",
      fixHref: "/cron",
    });
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const isFreshSetup = live.agents.length <= 1 && live.cron.stats.total === 0;

  return (
    <SectionLayout>
      {/* ── Gateway status bar ────────────────────── */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-2.5 md:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex items-center gap-1.5">
              <span className={cn("inline-flex h-2 w-2 rounded-full", isOnline ? "bg-emerald-500" : "bg-red-500")} />
              <span className="text-xs font-medium text-foreground/90">
                Gateway {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            <span className="text-xs text-muted-foreground/50">
              v{gw.version} · port {gw.port} · {gw.latencyMs}ms
            </span>
          </div>
          <span className="text-xs text-muted-foreground/40">
            {Math.floor((now - lastRefresh) / 1000)}s ago · auto 5s
          </span>
        </div>
      </div>

      <SectionBody width="content" padding="regular" innerClassName="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-border bg-muted p-1">
            <button
              type="button"
              onClick={() => setDashboardTab("overview")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200",
                dashboardTab === "overview"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setDashboardTab("gateway")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200",
                dashboardTab === "gateway"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Gateway Diagnostics
              {gatewayDiag && (gatewayDiag.summary.error > 0 || gatewayDiag.summary.warning > 0) && (
                <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-200">
                  {gatewayDiag.summary.error > 0
                    ? `${gatewayDiag.summary.error} err`
                    : `${gatewayDiag.summary.warning} warn`}
                </span>
              )}
            </button>
          </div>
          {dashboardTab === "gateway" && (
            <span className="text-xs text-muted-foreground/50">
              Auto-refresh every 30s while this tab is open
            </span>
          )}
        </div>

        <div className={cn("space-y-6", dashboardTab !== "overview" && "hidden")}>
          {/* ── Onboarding banner ──────────────────────── */}
          {onboardStatus && !onboardStatus.configured && !onboardDismissed && (
            <div className="glass rounded-lg border-violet-500/20 bg-violet-500/10 dark:bg-violet-500/5 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15">
                  <Rocket className="h-4.5 w-4.5 text-violet-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-sans font-semibold text-foreground/90">
                    {onboardStatus.installed
                      ? "Set up your agent"
                      : "Install OpenClaw to get started"}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">
                    {onboardStatus.installed
                      ? "Configure your AI model and API key to get your agent running."
                      : "OpenClaw needs to be installed before Mission Control can work."}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href="/onboard"
                    className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500"
                  >
                    {onboardStatus.installed ? "Set up" : "Install"}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setOnboardDismissed(true);
                      localStorage.setItem("mc-onboard-dismissed", "1");
                    }}
                    className="rounded-md p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                    title="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Stat cards ─────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              icon={Bot}
              value={live.agents.length}
              label="Agents"
              color="bg-violet-500/15 text-violet-400"
            />
            <StatCard
              icon={Activity}
              value={formatTokens(live.agents.reduce((s, a) => s + a.totalTokens, 0))}
              label="Tokens Used"
              color="bg-blue-500/15 text-blue-400"
            />
            <StatCard
              icon={Clock}
              value={`${live.cron.stats.ok}/${live.cron.stats.total}`}
              label="Cron OK"
              color={
                live.cron.stats.error > 0
                  ? "bg-amber-500/15 text-amber-400"
                  : "bg-emerald-500/15 text-emerald-400"
              }
              alert={live.cron.stats.error > 0 ? `${live.cron.stats.error} error` : undefined}
              alertHref={live.cron.stats.error > 0 ? "/cron?show=errors" : undefined}
              onClick={live.cron.stats.error > 0 ? () => window.location.href = "/cron?show=errors" : undefined}
            />
            <StatCard
              icon={Smartphone}
              value={system?.stats.totalDevices || 0}
              label="Devices"
              color="bg-cyan-500/15 text-cyan-400"
            />
            <StatCard
              icon={Wrench}
              value={system?.stats.totalSkills || 0}
              label="Skills"
              color="bg-pink-500/15 text-pink-400"
            />
          </div>

          {/* ── Access & pairing ─── */}
          <div className="glass-subtle rounded-lg p-4">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-sans font-semibold uppercase tracking-wider text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" /> Access & pairing
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-foreground/80">Gateway auth</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {system?.gateway?.authMode
                    ? `Mode: ${system.gateway.authMode}${system.gateway.tokenConfigured ? " · Token set" : ""}`
                    : "Not configured (open access)"}
                  {system?.gateway?.allowTailscale && " · Tailscale allowed"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground/50">
                  Set or edit the token in{" "}
                  <Link href="/config" className="text-violet-400 hover:underline">
                    Config
                  </Link>{" "}
                  under <code className="rounded bg-foreground/[0.06] px-1">gateway.auth.token</code>. The UI shows it redacted; to view or copy the full token, run on the gateway host: <code className="rounded bg-foreground/[0.06] px-1">openclaw config get gateway.auth.token</code>. For remote access, paste the token when the dashboard prompts.{" "}
                  <a
                    href="https://docs.openclaw.ai/web/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:underline"
                  >
                    Docs
                  </a>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-foreground/80">Pairing requests</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {(pairingSummary?.total ?? 0) > 0
                    ? `${pairingSummary?.total ?? 0} pending (device + DM) — use the bell in the header to approve or reject.`
                    : "No pending requests. New device or DM pairing will show in the header bell."}
                </p>
                {(pairingSummary?.total ?? 0) > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground/50">
                    Click the <Bell className="inline h-3 w-3" /> icon in the top bar to manage.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Top Issues Now ─────────────────────────── */}
          {issues.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-sans font-semibold uppercase tracking-wider text-muted-foreground">
                <Shield className="h-3.5 w-3.5" />
                Top Issues
                <span className="ml-1 rounded-full bg-foreground/[0.08] px-1.5 py-0.5 text-xs font-medium">
                  {issues.length}
                </span>
              </h2>
              <div className="space-y-2">
                {issues.slice(0, 5).map((issue) => {
                  const severityCfg = {
                    critical: {
                      border: "border-red-500/20",
                      bg: "bg-red-500/5",
                      icon: AlertCircle,
                      iconColor: "text-red-400",
                      badge: "bg-red-500/15 text-red-400",
                      badgeLabel: "Critical",
                    },
                    warning: {
                      border: "border-amber-500/20",
                      bg: "bg-amber-500/5",
                      icon: AlertTriangle,
                      iconColor: "text-amber-400",
                      badge: "bg-amber-500/15 text-amber-400",
                      badgeLabel: "Warning",
                    },
                    info: {
                      border: "border-blue-500/15",
                      bg: "bg-blue-500/5",
                      icon: Info,
                      iconColor: "text-blue-400",
                      badge: "bg-blue-500/10 text-blue-400",
                      badgeLabel: "Info",
                    },
                  }[issue.severity];
                  const SevIcon = severityCfg.icon;
                  return (
                    <div
                      key={issue.id}
                      className={cn(
                        "glass-subtle flex items-start gap-3 rounded-lg p-4",
                        severityCfg.border,
                        severityCfg.bg
                      )}
                    >
                      <SevIcon className={cn("mt-0.5 h-4 w-4 shrink-0", severityCfg.iconColor)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium text-foreground/80">
                            {issue.title}
                          </p>
                          <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-medium", severityCfg.badge)}>
                            {severityCfg.badgeLabel}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground/60 line-clamp-2">
                          {issue.detail}
                        </p>
                      </div>
                      {issue.fixLabel && issue.fixHref && (
                        <a
                          href={issue.fixHref}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1.5 text-xs font-medium text-foreground/70 transition-all duration-200 hover:bg-foreground/[0.08] hover:text-foreground"
                        >
                          {issue.fixLabel}
                          <ArrowRight className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Getting Started ────────── */}
          {isFreshSetup && issues.length === 0 && (
            <div className="glass rounded-lg border-violet-500/20 bg-violet-500/10 dark:bg-violet-500/5 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15">
                  <Rocket className="h-5 w-5 text-violet-400" />
                </div>
                <div>
                  <h3 className="text-xs font-sans font-semibold text-foreground/90">
                    Welcome to Mission Control
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    Your OpenClaw agent is running. Here are some things to try:
                  </p>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { label: "Chat with your agent", href: "/chat", desc: "Send a message and see it respond" },
                      { label: "Create a cron job", href: "/cron", desc: "Schedule tasks like daily briefs" },
                      { label: "Connect a channel", href: "/agents", desc: "Link Telegram, WhatsApp, etc." },
                      { label: "Explore skills", href: "/skills", desc: "See what your agent can do" },
                    ].map((item) => (
                      <a
                        key={item.href}
                        href={item.href}
                        className="glass-subtle flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-all duration-200 hover:border-violet-500/20 hover:bg-violet-500/5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground/80">{item.label}</p>
                          <p className="text-xs text-muted-foreground/50">{item.desc}</p>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Main grid: Agents + Cron ──────────────── */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Agents */}
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-sans font-semibold uppercase tracking-wider text-muted-foreground">
                <Bot className="h-3.5 w-3.5" /> Agents
              </h2>
              <div className="space-y-2.5">
                {live.agents.map((agent) => (
                  <div key={agent.id} className="glass-glow rounded-lg p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 text-base">
                        {agent.emoji || (agent.id === "main" ? "🦞" : "🤖")}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground capitalize">
                          {agent.name || agent.id}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                          <span>{agent.sessionCount} session{agent.sessionCount !== 1 ? "s" : ""}</span>
                          <span>{formatTokens(agent.totalTokens)} tokens</span>
                          <span>Active {formatAgo(agent.lastActivity)}</span>
                        </div>
                      </div>
                      <span className={cn(
                        "inline-flex h-2 w-2 rounded-full",
                        now - agent.lastActivity < 300000 ? "bg-emerald-500" : "bg-muted-foreground/30"
                      )} />
                    </div>
                    {/* Token usage bar */}
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-muted-foreground/50">
                        <span>Token usage</span>
                        <span>{formatTokens(agent.totalTokens)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-foreground/[0.04]">
                        <div
                          className="h-1.5 rounded-full bg-violet-500/60 transition-all duration-1000"
                          style={{
                            width: `${Math.min(100, (agent.totalTokens / 200000) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Models */}
              {system?.models && system.models.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 text-xs font-sans font-semibold uppercase tracking-wider text-muted-foreground/50">
                    Model Aliases
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {system.models.map((m) => (
                      <span
                        key={m.id}
                        className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.03] px-2 py-1 text-xs text-muted-foreground"
                      >
                        {m.alias && (
                          <span className="mr-1 text-violet-400">/{m.alias}</span>
                        )}
                        {m.id.split("/").pop()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Cron countdowns */}
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-sans font-semibold uppercase tracking-wider text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Cron Schedules
              </h2>
              <div className="space-y-2.5">
                {live.cron.jobs.map((job) => {
                  const progress = cronProgress(job);
                  const countdown = formatCountdown(job.nextRunAtMs);
                  return (
                    <div key={job.id} className="glass-glow rounded-lg p-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={cn(
                            "h-2.5 w-2.5 shrink-0 rounded-full",
                            job.lastStatus === "ok"
                              ? "bg-emerald-500"
                              : job.lastStatus === "error"
                                ? "bg-red-500"
                                : "bg-zinc-500"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground/90">
                            {job.name}
                          </p>
                          <p className="text-xs text-muted-foreground/50">
                            {job.scheduleDisplay}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold tabular-nums text-foreground/80">
                            {countdown}
                          </p>
                          <p className="text-xs text-muted-foreground/50">
                            ran {formatAgo(job.lastRunAtMs || 0)} ({formatDuration(job.lastDurationMs)})
                          </p>
                        </div>
                      </div>
                      <div className="mt-2.5 h-1.5 rounded-full bg-foreground/[0.04]">
                        <div
                          className={cn(
                            "h-1.5 rounded-full transition-all duration-1000",
                            job.lastStatus === "error"
                              ? "bg-red-500/60"
                              : "bg-emerald-500/50"
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      {job.lastError && (
                        <p className="mt-2 flex items-center gap-1 text-xs text-red-400">
                          <AlertCircle className="h-3 w-3" />
                          {job.lastError}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── System Stats (SSE – no polling) ────── */}
          <SystemStatsPanel stats={sysStats} connected={sseConnected} />

          {/* ── Recent cron run results ─────────────── */}
          {live.cronRuns.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-sans font-semibold uppercase tracking-wider text-muted-foreground">
                <Zap className="h-3.5 w-3.5" /> Recent Cron Results
              </h2>
              <div className="space-y-1.5">
                {live.cronRuns.slice(0, 6).map((run, i) => (
                  <button
                    type="button"
                    key={`${run.jobId}-${run.ts}-${i}`}
                    onClick={() => openCronJob(run.jobId)}
                    className="w-full glass-subtle rounded-lg px-4 py-2.5 text-left transition-all duration-200 hover:border-violet-500/20 hover:bg-violet-500/5"
                  >
                    <div className="flex items-center gap-2">
                      {run.status === "ok" ? (
                        <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatAgo(run.ts)}
                      </span>
                      {run.durationMs && (
                        <span className="text-xs text-muted-foreground/50">
                          {formatDuration(run.durationMs)}
                        </span>
                      )}
                    </div>
                    {run.summary && (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground/70">
                        {run.summary.replace(/[*#|_]/g, "").substring(0, 200)}
                      </p>
                    )}
                    {run.error && (
                      <p className="mt-1 text-xs text-red-400">{run.error}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Live activity log ───────────────────── */}
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-xs font-sans font-semibold uppercase tracking-wider text-muted-foreground">
              <Radio className="h-3.5 w-3.5" /> Gateway Log
            </h2>
            <div className="glass-subtle rounded-lg p-1">
              <div className="max-h-80 overflow-y-auto font-mono text-xs leading-5">
                {live.logEntries.map((entry, i) => {
                  const isError =
                    entry.message.toLowerCase().includes("error") ||
                    entry.message.toLowerCase().includes("fail");
                  const isWs = entry.source === "ws";
                  const isCron = entry.source.includes("cron");
                  const time = entry.time
                    ? new Date(entry.time).toLocaleTimeString()
                    : "";
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex gap-2 rounded px-2 py-0.5",
                        isError
                          ? "bg-red-500/5 text-red-400"
                          : "hover:bg-foreground/[0.03]"
                      )}
                    >
                      <span className="shrink-0 text-muted-foreground/40">{time}</span>
                      <span
                        className={cn(
                          "shrink-0 w-24 truncate",
                          isCron
                            ? "text-amber-500"
                            : isWs
                              ? "text-blue-500"
                              : "text-muted-foreground/60"
                        )}
                      >
                        [{entry.source}]
                      </span>
                      <span className="min-w-0 truncate text-muted-foreground/70">
                        {entry.message}
                      </span>
                    </div>
                  );
                })}
                {live.logEntries.length === 0 && (
                  <p className="px-2 py-4 text-center text-muted-foreground/50">
                    No recent log entries
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {dashboardTab === "gateway" && (
          <GatewayDiagnosticsPanel
            data={gatewayDiag}
            loading={gatewayDiagLoading}
            error={gatewayDiagError}
            onRefresh={() => void fetchGatewayDiagnostics()}
          />
        )}
      </SectionBody>
    </SectionLayout>
  );
}

/* ── sub-components ──────────────────────────────── */

function StatCard({
  icon: Icon,
  value,
  label,
  color,
  alert,
  alertHref,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  color: string;
  alert?: string;
  alertHref?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "glass-glow rounded-lg p-4",
        onClick && "cursor-pointer"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className={cn("rounded-lg p-2", color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground/60">{label}</p>
        </div>
      </div>
      {alert && (
        alertHref ? (
          <a
            href={alertHref}
            className="mt-2 flex items-center gap-1 text-xs text-red-400 transition-colors hover:text-red-300 group"
            onClick={(e) => e.stopPropagation()}
          >
            <AlertCircle className="h-3 w-3" />
            <span className="group-hover:underline">{alert}</span>
            <span className="text-red-500/50 group-hover:text-red-400">&rarr;</span>
          </a>
        ) : (
          <p className="mt-2 flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="h-3 w-3" />
            {alert}
          </p>
        )
      )}
    </div>
  );
}
