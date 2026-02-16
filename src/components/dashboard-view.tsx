"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── types ────────────────────────────────────────── */

type LiveData = {
  timestamp: number;
  gateway: { status: string; latencyMs: number; port: number; version: string };
  cron: {
    jobs: CronJobLive[];
    stats: { total: number; ok: number; error: number };
  };
  cronRuns: CronRun[];
  agents: { id: string; sessionCount: number; totalTokens: number; lastActivity: number }[];
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
  size = 80,
}: {
  value: number;
  max: number;
  label: string;
  unit?: string;
  color: string;
  size?: number;
}) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-white/[0.04]"
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
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-[15px] font-bold text-foreground">
          {Math.round(percent)}
          <span className="text-[10px] text-muted-foreground">%</span>
        </span>
      </div>
      <p className="mt-1 text-[10px] font-medium text-muted-foreground">{label}</p>
      {unit && <p className="text-[9px] text-muted-foreground/40">{unit}</p>}
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
    seg("app", "App", memory.app, "#2dd4bf"),
    seg("wired", "Wired", memory.wired, "#a78bfa"),
    seg("compressed", "Compressed", memory.compressed, "#fb7185"),
    seg("cached", "Cached Files", memory.cached, "#60a5fa"),
    seg("free", memoryFreeLabel, memory.free, "#94a3b8"),
  ].filter((s): s is { key: string; label: string; value: number; color: string } => Boolean(s));

  if (segments.length === 0) {
    const fallbackUsed = Math.max(0, memory.used || 0);
    const fallbackFree = Math.max(0, memory.total - fallbackUsed);
    if (fallbackUsed > 0) segments.push({ key: "used", label: "Used", value: fallbackUsed, color: "#8b5cf6" });
    if (fallbackFree > 0) segments.push({ key: "free", label: memoryFreeLabel, value: fallbackFree, color: "#94a3b8" });
  }

  const known = segments.reduce((sum, item) => sum + item.value, 0);
  const remainder = Math.max(0, (memory.total || 0) - known);
  if (remainder > (memory.total || 0) * 0.005) {
    segments.push({ key: "other", label: "Kernel / Other", value: remainder, color: "#64748b" });
  }

  const denom = Math.max(memory.total || 0, segments.reduce((sum, item) => sum + item.value, 0), 1);

  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.05]">
        {segments.map((item) => (
          <div
            key={item.key}
            className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-700 ease-out"
            style={{ width: `${(item.value / denom) * 100}%`, backgroundColor: item.color }}
            title={`${item.label}: ${formatBytesCompact(item.value)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-muted-foreground/70">
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
      <div className="rounded-xl border border-foreground/[0.06] bg-card/90 p-6">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground/60">
          <Gauge className="h-4 w-4 animate-pulse" />
          Connecting to system stats stream...
        </div>
      </div>
    );
  }

  const cpuColor =
    stats.cpu.usage > 80 ? "#ef4444" : stats.cpu.usage > 50 ? "#f59e0b" : "#10b981";
  const memColor =
    stats.memory.percent > 85 ? "#ef4444" : stats.memory.percent > 65 ? "#f59e0b" : "#8b5cf6";
  const diskColor =
    stats.disk.percent > 90 ? "#ef4444" : stats.disk.percent > 75 ? "#f59e0b" : "#3b82f6";
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
        <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Server className="h-3.5 w-3.5" /> System Monitor
        </h2>
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connected ? "bg-emerald-500 animate-pulse" : "bg-red-500"
            )}
          />
          <span className="text-[9px] text-muted-foreground/60">
            {connected ? "LIVE" : "RECONNECTING"}
          </span>
        </div>
      </div>

      {/* Gauges row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 rounded-xl border border-foreground/[0.06] bg-card/90 px-4 py-5">
        <div className="relative flex justify-center">
          <RadialGauge
            value={stats.cpu.usage}
            max={100}
            label="CPU"
            unit={`${stats.cpu.cores} cores`}
            color={cpuColor}
          />
        </div>
        <div className="relative flex justify-center">
          <RadialGauge
            value={stats.memory.percent}
            max={100}
            label="Memory"
            unit={`${formatBytesCompact(stats.memory.used)} / ${formatBytesCompact(stats.memory.total)}`}
            color={memColor}
          />
        </div>
        <div className="relative flex justify-center">
          <RadialGauge
            value={stats.disk.percent}
            max={100}
            label="Disk"
            unit={`${formatBytesCompact(stats.disk.used)} / ${formatBytesCompact(stats.disk.total)}`}
            color={diskColor}
          />
        </div>
      </div>

      {/* Detail cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* CPU details */}
        <div className="rounded-xl border border-foreground/[0.06] bg-card/90 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Cpu className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold text-foreground/70">CPU</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Usage</span>
              <span className="font-mono text-foreground/70">{stats.cpu.usage}%</span>
            </div>
            <MiniBar percent={stats.cpu.usage} color={cpuColor} />
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Load (1/5/15m)</span>
              <span className="font-mono text-muted-foreground">
                {stats.cpu.load1} / {stats.cpu.load5} / {stats.cpu.load15}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Speed</span>
              <span className="font-mono text-muted-foreground">{stats.cpu.speed} MHz</span>
            </div>
            <p className="truncate text-[9px] text-muted-foreground/40" title={stats.cpu.model}>
              {stats.cpu.model}
            </p>
          </div>
        </div>

        {/* Memory details */}
        <div className="rounded-xl border border-foreground/[0.06] bg-card/90 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <MemoryStick className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-[11px] font-semibold text-foreground/70">
              Memory
              {memorySourceLabel}
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Used</span>
              <span className="font-mono text-foreground/70">
                {formatBytesCompact(stats.memory.used)}
              </span>
            </div>
            <MemoryCompositionBar memory={stats.memory} memoryFreeLabel={memoryFreeLabel} />
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">{memoryFreeLabel}</span>
              <span className="font-mono text-muted-foreground">
                {formatBytesCompact(stats.memory.free)}
              </span>
            </div>
            {typeof stats.memory.app === "number" && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground/60">App</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytesCompact(stats.memory.app)}
                </span>
              </div>
            )}
            {typeof stats.memory.wired === "number" && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground/60">Wired</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytesCompact(stats.memory.wired)}
                </span>
              </div>
            )}
            {typeof stats.memory.compressed === "number" && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground/60">Compressed</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytesCompact(stats.memory.compressed)}
                </span>
              </div>
            )}
            {typeof stats.memory.cached === "number" && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground/60">Cached Files</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytesCompact(stats.memory.cached)}
                </span>
              </div>
            )}
            {typeof stats.memory.swapUsed === "number" && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground/60">Swap Used</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytesCompact(stats.memory.swapUsed)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Total</span>
              <span className="font-mono text-muted-foreground">
                {formatBytesCompact(stats.memory.total)}
              </span>
            </div>
          </div>
        </div>

        {/* Disk details */}
        <div className="rounded-xl border border-foreground/[0.06] bg-card/90 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <HardDrive className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-[11px] font-semibold text-foreground/70">Disk</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Used</span>
              <span className="font-mono text-foreground/70">
                {formatBytesCompact(stats.disk.used)}
              </span>
            </div>
            <MiniBar percent={stats.disk.percent} color={diskColor} />
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Free</span>
              <span className="font-mono text-muted-foreground">
                {formatBytesCompact(stats.disk.free)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Total</span>
              <span className="font-mono text-muted-foreground">
                {formatBytesCompact(stats.disk.total)}
              </span>
            </div>
          </div>
        </div>

        {/* System info */}
        <div className="rounded-xl border border-foreground/[0.06] bg-card/90 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Timer className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[11px] font-semibold text-foreground/70">System</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Hostname</span>
              <span className="font-mono text-muted-foreground">{stats.system.hostname}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Platform</span>
              <span className="font-mono text-muted-foreground">
                {stats.system.platform} {stats.system.arch}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Uptime</span>
              <span className="font-mono text-muted-foreground">{stats.system.uptimeDisplay}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground/60">Processes</span>
              <span className="font-mono text-muted-foreground">{stats.system.processCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* OpenClaw storage stats */}
      <div className="rounded-xl border border-foreground/[0.06] bg-card/90 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-pink-400" />
          <span className="text-[11px] font-semibold text-foreground/70">OpenClaw Storage</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <OcStatMini
            icon={Folder}
            label="Workspace"
            value={formatBytesCompact(stats.openclaw.workspaceSizeBytes)}
            color="text-violet-400"
          />
          <OcStatMini
            icon={FileText}
            label="Files"
            value={String(stats.openclaw.totalWorkspaceFiles)}
            color="text-blue-400"
          />
          <OcStatMini
            icon={Database}
            label="Sessions"
            value={String(stats.openclaw.activeSessions)}
            sub={formatBytesCompact(stats.openclaw.sessionsSizeBytes)}
            color="text-emerald-400"
          />
          <OcStatMini
            icon={FileText}
            label="Today's Log"
            value={formatBytesCompact(stats.openclaw.logSizeBytes)}
            color="text-amber-400"
          />
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
      <div className="rounded-xl border border-foreground/[0.06] bg-card/90 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold text-foreground/90">Gateway Diagnostics</p>
            <p className="text-[12px] text-muted-foreground/65">
              Live snapshot from <code>openclaw gateway status --json</code> and{" "}
              <code>openclaw doctor --non-interactive</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] bg-card px-2.5 py-1.5 text-[11px] text-foreground/80 transition-colors hover:bg-muted/70 disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-red-300/80">Errors</p>
            <p className="mt-1 text-[18px] font-semibold text-red-200">{summary.error}</p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-amber-300/80">Warnings</p>
            <p className="mt-1 text-[18px] font-semibold text-amber-200">{summary.warning}</p>
          </div>
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.04] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-blue-300/80">Signals</p>
            <p className="mt-1 text-[18px] font-semibold text-blue-200">{summary.info}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="rounded-lg border border-foreground/[0.08] bg-background/40 px-3 py-2">
            <p className="text-[10px] text-muted-foreground/60">Runtime</p>
            <p className="mt-1 text-[12px] font-medium text-foreground/85">{runtimeStatus}</p>
          </div>
          <div className="rounded-lg border border-foreground/[0.08] bg-background/40 px-3 py-2">
            <p className="text-[10px] text-muted-foreground/60">Bind</p>
            <p className="mt-1 text-[12px] font-medium text-foreground/85">{bind}</p>
          </div>
          <div className="rounded-lg border border-foreground/[0.08] bg-background/40 px-3 py-2">
            <p className="text-[10px] text-muted-foreground/60">Port</p>
            <p className="mt-1 text-[12px] font-medium text-foreground/85">{portLabel}</p>
          </div>
          <div className="rounded-lg border border-foreground/[0.08] bg-background/40 px-3 py-2">
            <p className="text-[10px] text-muted-foreground/60">RPC</p>
            <p className="mt-1 text-[12px] font-medium text-foreground/85">{rpcLabel}</p>
          </div>
          <div className="rounded-lg border border-foreground/[0.08] bg-background/40 px-3 py-2">
            <p className="text-[10px] text-muted-foreground/60">Doctor</p>
            <p className="mt-1 text-[12px] font-medium text-foreground/85">
              {data?.doctor?.ok ? "ok" : `exit ${data?.doctor?.exitCode ?? "?"}`}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3 text-[12px] text-red-200">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="rounded-xl border border-foreground/[0.06] bg-card/70 px-4 py-8 text-center text-[12px] text-muted-foreground/70">
          <RefreshCw className="mx-auto mb-2 h-4 w-4 animate-spin" />
          Running gateway checks...
        </div>
      )}

      {data && (
        <>
          <div className="rounded-xl border border-foreground/[0.06] bg-card/90 p-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Alerts & Recommendations
            </h3>
            <div className="space-y-1.5">
              {data.highlights.slice(0, 14).map((item, idx) => {
                const cfg =
                  item.severity === "error"
                    ? {
                        icon: AlertCircle,
                        row: "border-red-500/20 bg-red-500/[0.04] text-red-200",
                        chip: "bg-red-500/15 text-red-300",
                      }
                    : item.severity === "warning"
                      ? {
                          icon: AlertTriangle,
                          row: "border-amber-500/20 bg-amber-500/[0.04] text-amber-100",
                          chip: "bg-amber-500/15 text-amber-300",
                        }
                      : {
                          icon: Info,
                          row: "border-blue-500/20 bg-blue-500/[0.04] text-blue-100",
                          chip: "bg-blue-500/15 text-blue-300",
                        };
                const Icon = cfg.icon;
                return (
                  <div
                    key={`${item.source}-${idx}-${item.text}`}
                    className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-2", cfg.row)}
                  >
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0 flex-1 text-[11px] leading-5">{item.text}</div>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide", cfg.chip)}>
                      {item.source === "doctor" ? "doctor" : "status"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-foreground/[0.06] bg-card/90 p-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Doctor Output
            </h3>
            <div className="max-h-[320px] overflow-y-auto rounded-lg border border-foreground/[0.08] bg-background/40 p-2 font-mono text-[10px] leading-5 text-muted-foreground/85">
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
      <p className="mt-1 text-[13px] font-semibold text-foreground/90">{value}</p>
      <p className="text-[9px] text-muted-foreground/60">{label}</p>
      {sub && <p className="text-[8px] text-muted-foreground/40">{sub}</p>}
    </div>
  );
}

/* ── component ───────────────────────────────────── */

const POLL_INTERVAL = 8000;

export function DashboardView() {
  const [live, setLive] = useState<LiveData | null>(null);
  const [system, setSystem] = useState<SystemData | null>(null);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [dashboardTab, setDashboardTab] = useState<"overview" | "gateway">("overview");
  const [gatewayDiag, setGatewayDiag] = useState<GatewayDiagnosticsData | null>(null);
  const [gatewayDiagError, setGatewayDiagError] = useState<string | null>(null);
  const [gatewayDiagLoading, setGatewayDiagLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { stats: sysStats, connected: sseConnected } = useSystemStats();

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch("/api/live");
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

  useEffect(() => {
    queueMicrotask(() => fetchLive());
    // Also fetch system data once (channels, devices, skills)
    fetch("/api/system")
      .then((r) => r.json())
      .then(setSystem)
      .catch(() => {});

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

  // Critical: gateway offline
  if (!isOnline) {
    issues.push({
      id: "gw-offline",
      severity: "critical",
      title: "Gateway is offline",
      detail: "The OpenClaw gateway process is not responding. Most features will not work.",
      fixLabel: "Restart Gateway",
      fixHref: "/?section=channels",
    });
  }

  // Critical: cron jobs with consecutive errors
  for (const job of live.cron.jobs) {
    if (job.consecutiveErrors >= 3) {
      issues.push({
        id: `cron-err-${job.id}`,
        severity: "critical",
        title: `Cron "${job.name}" keeps failing`,
        detail: `${job.consecutiveErrors} consecutive errors. Last: ${job.lastError || "unknown"}`,
        fixLabel: "Fix Cron Job",
        fixHref: `/?section=cron&show=errors`,
      });
    }
  }

  // Warning: cron jobs with missing delivery targets
  for (const job of live.cron.jobs) {
    if (job.lastError?.includes("delivery target is missing")) {
      issues.push({
        id: `cron-target-${job.id}`,
        severity: "warning",
        title: `"${job.name}" has no delivery target`,
        detail: "Job runs but can't deliver results. Set a recipient (e.g. telegram:CHAT_ID).",
        fixLabel: "Set Target",
        fixHref: `/?section=cron&show=errors`,
      });
    }
  }

  // Warning: single cron error
  for (const job of live.cron.jobs) {
    if (job.lastStatus === "error" && (job.consecutiveErrors || 0) < 3 && !issues.find(i => i.id === `cron-err-${job.id}` || i.id === `cron-target-${job.id}`)) {
      issues.push({
        id: `cron-warn-${job.id}`,
        severity: "warning",
        title: `Cron "${job.name}" last run failed`,
        detail: job.lastError || "Unknown error",
        fixLabel: "View Details",
        fixHref: `/?section=cron&show=errors`,
      });
    }
  }

  // Warning: no channels connected
  if (system && system.stats.totalChannels === 0) {
    issues.push({
      id: "no-channels",
      severity: "warning",
      title: "No messaging channels connected",
      detail: "Connect Telegram, WhatsApp, or another channel to receive agent messages.",
      fixLabel: "Setup Channel",
      fixHref: "/?section=agents",
    });
  }

  // Info: no cron jobs configured
  if (live.cron.stats.total === 0) {
    issues.push({
      id: "no-cron",
      severity: "info",
      title: "No cron jobs configured",
      detail: "Scheduled tasks let your agent work automatically — summaries, reminders, reports.",
      fixLabel: "Create Cron Job",
      fixHref: "/?section=cron",
    });
  }

  // Sort: critical → warning → info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // ── Newbie onboarding: show "what to do next" if system is fresh
  const isFreshSetup = live.agents.length <= 1 && live.cron.stats.total === 0;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* ── Gateway status bar ────────────────────── */}
      <div className="shrink-0 border-b border-foreground/[0.06] bg-card/80 px-4 py-2.5 md:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex items-center gap-2">
              <div
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  isOnline ? "bg-emerald-500" : "bg-red-500"
                )}
              />
              {isOnline && (
                <div className="absolute left-0 h-2.5 w-2.5 animate-ping rounded-full bg-emerald-500/50" />
              )}
              <span className="text-[13px] font-medium text-foreground/90">
                Gateway {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground/60">
              v{gw.version} &bull; port {gw.port} &bull; {gw.latencyMs}ms
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground/60">
            Refreshed {Math.floor((now - lastRefresh) / 1000)}s ago &bull; auto-refresh 5s
          </span>
        </div>
      </div>

      <div className="mx-auto w-full space-y-5 px-4 py-5 md:px-6 lg:max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-xl border border-foreground/[0.08] bg-card/70 p-1">
            <button
              type="button"
              onClick={() => setDashboardTab("overview")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors",
                dashboardTab === "overview"
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-muted-foreground/70 hover:text-foreground/80"
              )}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setDashboardTab("gateway")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors",
                dashboardTab === "gateway"
                  ? "bg-blue-500/20 text-blue-200"
                  : "text-muted-foreground/70 hover:text-foreground/80"
              )}
            >
              Gateway Diagnostics
              {gatewayDiag && (gatewayDiag.summary.error > 0 || gatewayDiag.summary.warning > 0) && (
                <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-200">
                  {gatewayDiag.summary.error > 0
                    ? `${gatewayDiag.summary.error} err`
                    : `${gatewayDiag.summary.warning} warn`}
                </span>
              )}
            </button>
          </div>
          {dashboardTab === "gateway" && (
            <span className="text-[10px] text-muted-foreground/65">
              Auto-refresh every 30s while this tab is open
            </span>
          )}
        </div>

        <div className={cn("space-y-5", dashboardTab !== "overview" && "hidden")}>
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
            alertHref={live.cron.stats.error > 0 ? "/?section=cron&show=errors" : undefined}
            onClick={live.cron.stats.error > 0 ? () => window.location.href = "/?section=cron&show=errors" : undefined}
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

        {/* ── Top Issues Now ─────────────────────────── */}
        {issues.length > 0 && (
          <div>
            <h2 className="mb-2.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              Top Issues
              <span className="ml-1 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium">
                {issues.length}
              </span>
            </h2>
            <div className="space-y-2">
              {issues.slice(0, 5).map((issue) => {
                const severityCfg = {
                  critical: {
                    border: "border-red-500/20",
                    bg: "bg-red-500/[0.04]",
                    icon: AlertCircle,
                    iconColor: "text-red-400",
                    badge: "bg-red-500/15 text-red-400",
                    badgeLabel: "Critical",
                  },
                  warning: {
                    border: "border-amber-500/20",
                    bg: "bg-amber-500/[0.03]",
                    icon: AlertTriangle,
                    iconColor: "text-amber-400",
                    badge: "bg-amber-500/15 text-amber-400",
                    badgeLabel: "Warning",
                  },
                  info: {
                    border: "border-blue-500/15",
                    bg: "bg-blue-500/[0.02]",
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
                      "flex items-start gap-3 rounded-xl border p-3.5",
                      severityCfg.border,
                      severityCfg.bg
                    )}
                  >
                    <SevIcon className={cn("mt-0.5 h-4 w-4 shrink-0", severityCfg.iconColor)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[12px] font-medium text-foreground/80">
                          {issue.title}
                        </p>
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-medium", severityCfg.badge)}>
                          {severityCfg.badgeLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70 line-clamp-2">
                        {issue.detail}
                      </p>
                    </div>
                    {issue.fixLabel && issue.fixHref && (
                      <a
                        href={issue.fixHref}
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-foreground/[0.08] bg-card px-2.5 py-1.5 text-[11px] font-medium text-foreground/70 transition-colors hover:bg-muted/80 hover:text-foreground"
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

        {/* ── Getting Started (newbie rails) ────────── */}
        {isFreshSetup && issues.length === 0 && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15">
                <Rocket className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-foreground/90">
                  Welcome to Mission Control
                </h3>
                <p className="mt-1 text-[12px] text-muted-foreground/70">
                  Your OpenClaw agent is running. Here are some things to try:
                </p>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: "Chat with your agent", href: "/?section=chat", desc: "Send a message and see it respond" },
                    { label: "Create a cron job", href: "/?section=cron", desc: "Schedule tasks like daily briefs" },
                    { label: "Connect a channel", href: "/?section=agents", desc: "Link Telegram, WhatsApp, etc." },
                    { label: "Explore skills", href: "/?section=skills", desc: "See what your agent can do" },
                  ].map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-2.5 rounded-lg border border-foreground/[0.06] bg-card/80 px-3 py-2.5 transition-colors hover:border-violet-500/20 hover:bg-violet-500/[0.04]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-foreground/80">{item.label}</p>
                        <p className="text-[10px] text-muted-foreground/60">{item.desc}</p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
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
            <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Bot className="h-3.5 w-3.5" /> Agents
            </h2>
            <div className="space-y-2.5">
              {live.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-xl border border-foreground/[0.06] bg-card/90 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-xl">
                      {agent.id === "main" ? "🦞" : "💀"}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground capitalize">
                        {agent.id}
                      </p>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>{agent.sessionCount} session{agent.sessionCount !== 1 ? "s" : ""}</span>
                        <span>{formatTokens(agent.totalTokens)} tokens</span>
                        <span>Active {formatAgo(agent.lastActivity)}</span>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        now - agent.lastActivity < 300000
                          ? "bg-emerald-500"
                          : "bg-zinc-600"
                      )}
                    />
                  </div>
                  {/* Token usage bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-[10px] text-muted-foreground/60">
                      <span>Token usage</span>
                      <span>{formatTokens(agent.totalTokens)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted">
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
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Model Aliases
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {system.models.map((m) => (
                    <span
                      key={m.id}
                      className="rounded-md border border-foreground/[0.04] bg-card/80 px-2 py-1 text-[10px] text-muted-foreground"
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
            <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Cron Schedules
            </h2>
            <div className="space-y-2.5">
              {live.cron.jobs.map((job) => {
                const progress = cronProgress(job);
                const countdown = formatCountdown(job.nextRunAtMs);
                return (
                  <div
                    key={job.id}
                    className="rounded-xl border border-foreground/[0.06] bg-card/90 p-4"
                  >
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
                        <p className="text-[13px] font-medium text-foreground/90">
                          {job.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60">
                          {job.scheduleDisplay}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-mono font-medium text-foreground/70">
                          {countdown}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60">
                          ran {formatAgo(job.lastRunAtMs || 0)} ({formatDuration(job.lastDurationMs)})
                        </p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-2.5 h-1.5 rounded-full bg-muted">
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
                    {/* Error message */}
                    {job.lastError && (
                      <p className="mt-2 flex items-center gap-1 text-[10px] text-red-400">
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
            <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Zap className="h-3.5 w-3.5" /> Recent Cron Results
            </h2>
            <div className="space-y-1.5">
              {live.cronRuns.slice(0, 6).map((run, i) => (
                <div
                  key={`${run.jobId}-${run.ts}-${i}`}
                  className="rounded-lg border border-foreground/[0.04] bg-card/70 px-4 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    {run.status === "ok" ? (
                      <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {formatAgo(run.ts)}
                    </span>
                    {run.durationMs && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {formatDuration(run.durationMs)}
                      </span>
                    )}
                  </div>
                  {run.summary && (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                      {run.summary.replace(/[*#|_]/g, "").substring(0, 200)}
                    </p>
                  )}
                  {run.error && (
                    <p className="mt-1 text-[11px] text-red-400">{run.error}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Live activity log ───────────────────── */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Radio className="h-3.5 w-3.5" /> Gateway Log
          </h2>
          <div className="rounded-xl border border-foreground/[0.06] bg-background/60 p-1">
            <div className="max-h-[320px] overflow-y-auto font-mono text-[11px] leading-5">
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
                        : "hover:bg-foreground/[0.02]"
                    )}
                  >
                    <span className="shrink-0 text-muted-foreground/60">{time}</span>
                    <span
                      className={cn(
                        "shrink-0 w-24 truncate",
                        isCron
                          ? "text-amber-500"
                          : isWs
                            ? "text-blue-500"
                            : "text-muted-foreground"
                      )}
                    >
                      [{entry.source}]
                    </span>
                    <span className="min-w-0 truncate text-muted-foreground">
                      {entry.message}
                    </span>
                  </div>
                );
              })}
              {live.logEntries.length === 0 && (
                <p className="px-2 py-4 text-center text-muted-foreground/60">
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
      </div>
    </div>
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
        "rounded-xl border border-foreground/[0.06] bg-card/90 p-3",
        onClick && "cursor-pointer transition-colors hover:border-foreground/[0.12]"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5">
        <div className={cn("rounded-lg p-1.5", color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </div>
      {alert && (
        alertHref ? (
          <a
            href={alertHref}
            className="mt-1.5 flex items-center gap-1 text-[10px] text-red-400 transition-colors hover:text-red-300 group"
            onClick={(e) => e.stopPropagation()}
          >
            <AlertCircle className="h-3 w-3" />
            <span className="group-hover:underline">{alert}</span>
            <span className="text-red-500/50 group-hover:text-red-400">&rarr;</span>
          </a>
        ) : (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-red-400">
            <AlertCircle className="h-3 w-3" />
            {alert}
          </p>
        )
      )}
    </div>
  );
}
