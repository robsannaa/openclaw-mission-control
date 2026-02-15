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
  memory: { total: number; used: number; free: number; percent: number };
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
        <span className="text-[15px] font-bold text-zinc-100">
          {Math.round(percent)}
          <span className="text-[10px] text-zinc-500">%</span>
        </span>
      </div>
      <p className="mt-1 text-[10px] font-medium text-zinc-500">{label}</p>
      {unit && <p className="text-[9px] text-zinc-700">{unit}</p>}
    </div>
  );
}

/* ── Mini bar ────────────────────────────────────── */

function MiniBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-white/[0.04]">
      <div
        className="h-1.5 rounded-full transition-all duration-700 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: color }}
      />
    </div>
  );
}

/* ── System Stats Panel ──────────────────────────── */

function SystemStatsPanel({ stats, connected }: { stats: SystemStats | null; connected: boolean }) {
  if (!stats) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-6">
        <div className="flex items-center gap-2 text-[12px] text-zinc-600">
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          <Server className="h-3.5 w-3.5" /> System Monitor
        </h2>
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connected ? "bg-emerald-500 animate-pulse" : "bg-red-500"
            )}
          />
          <span className="text-[9px] text-zinc-600">
            {connected ? "LIVE" : "RECONNECTING"}
          </span>
        </div>
      </div>

      {/* Gauges row */}
      <div className="grid grid-cols-3 gap-4 rounded-xl border border-white/[0.06] bg-zinc-900/50 px-4 py-5">
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
      <div className="grid grid-cols-2 gap-2">
        {/* CPU details */}
        <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Cpu className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold text-zinc-300">CPU</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Usage</span>
              <span className="font-mono text-zinc-300">{stats.cpu.usage}%</span>
            </div>
            <MiniBar percent={stats.cpu.usage} color={cpuColor} />
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Load (1/5/15m)</span>
              <span className="font-mono text-zinc-400">
                {stats.cpu.load1} / {stats.cpu.load5} / {stats.cpu.load15}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Speed</span>
              <span className="font-mono text-zinc-400">{stats.cpu.speed} MHz</span>
            </div>
            <p className="truncate text-[9px] text-zinc-700" title={stats.cpu.model}>
              {stats.cpu.model}
            </p>
          </div>
        </div>

        {/* Memory details */}
        <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <MemoryStick className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-[11px] font-semibold text-zinc-300">Memory</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Used</span>
              <span className="font-mono text-zinc-300">
                {formatBytesCompact(stats.memory.used)}
              </span>
            </div>
            <MiniBar percent={stats.memory.percent} color={memColor} />
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Free</span>
              <span className="font-mono text-zinc-400">
                {formatBytesCompact(stats.memory.free)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Total</span>
              <span className="font-mono text-zinc-400">
                {formatBytesCompact(stats.memory.total)}
              </span>
            </div>
          </div>
        </div>

        {/* Disk details */}
        <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <HardDrive className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-[11px] font-semibold text-zinc-300">Disk</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Used</span>
              <span className="font-mono text-zinc-300">
                {formatBytesCompact(stats.disk.used)}
              </span>
            </div>
            <MiniBar percent={stats.disk.percent} color={diskColor} />
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Free</span>
              <span className="font-mono text-zinc-400">
                {formatBytesCompact(stats.disk.free)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Total</span>
              <span className="font-mono text-zinc-400">
                {formatBytesCompact(stats.disk.total)}
              </span>
            </div>
          </div>
        </div>

        {/* System info */}
        <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Timer className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[11px] font-semibold text-zinc-300">System</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Hostname</span>
              <span className="font-mono text-zinc-400">{stats.system.hostname}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Platform</span>
              <span className="font-mono text-zinc-400">
                {stats.system.platform} {stats.system.arch}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Uptime</span>
              <span className="font-mono text-zinc-400">{stats.system.uptimeDisplay}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-600">Processes</span>
              <span className="font-mono text-zinc-400">{stats.system.processCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* OpenClaw storage stats */}
      <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-pink-400" />
          <span className="text-[11px] font-semibold text-zinc-300">OpenClaw Storage</span>
        </div>
        <div className="grid grid-cols-4 gap-3">
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
      <p className="mt-1 text-[13px] font-semibold text-zinc-200">{value}</p>
      <p className="text-[9px] text-zinc-600">{label}</p>
      {sub && <p className="text-[8px] text-zinc-700">{sub}</p>}
    </div>
  );
}

/* ── component ───────────────────────────────────── */

const POLL_INTERVAL = 5000;

export function DashboardView() {
  const [live, setLive] = useState<LiveData | null>(null);
  const [system, setSystem] = useState<SystemData | null>(null);
  const [tick, setTick] = useState(0); // for countdown refresh
  const [lastRefresh, setLastRefresh] = useState(0);
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

  useEffect(() => {
    fetchLive();
    // Also fetch system data once (channels, devices, skills)
    fetch("/api/system")
      .then((r) => r.json())
      .then(setSystem)
      .catch(() => {});

    pollRef.current = setInterval(fetchLive, POLL_INTERVAL);
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [fetchLive]);

  if (!live) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Connecting to system...
      </div>
    );
  }

  const gw = live.gateway;
  const isOnline = gw.status === "online";

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* ── Gateway status bar ────────────────────── */}
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0a0a0e]/80 px-6 py-2.5">
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
              <span className="text-[13px] font-medium text-zinc-200">
                Gateway {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            <span className="text-[11px] text-zinc-600">
              v{gw.version} &bull; port {gw.port} &bull; {gw.latencyMs}ms
            </span>
          </div>
          <span className="text-[10px] text-zinc-600">
            Refreshed {Math.floor((Date.now() - lastRefresh) / 1000)}s ago &bull; auto-refresh 5s
          </span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl space-y-5 px-6 py-5">
        {/* ── Stat cards ─────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
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

        {/* ── Main grid: Agents + Cron ──────────────── */}
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Agents */}
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
              <Bot className="h-3.5 w-3.5" /> Agents
            </h2>
            <div className="space-y-2.5">
              {live.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-xl">
                      {agent.id === "main" ? "🦞" : "💀"}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-zinc-100 capitalize">
                        {agent.id}
                      </p>
                      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                        <span>{agent.sessionCount} session{agent.sessionCount !== 1 ? "s" : ""}</span>
                        <span>{formatTokens(agent.totalTokens)} tokens</span>
                        <span>Active {formatAgo(agent.lastActivity)}</span>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        Date.now() - agent.lastActivity < 300000
                          ? "bg-emerald-500"
                          : "bg-zinc-600"
                      )}
                    />
                  </div>
                  {/* Token usage bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-[10px] text-zinc-600">
                      <span>Token usage</span>
                      <span>{formatTokens(agent.totalTokens)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-zinc-800">
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
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  Model Aliases
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {system.models.map((m) => (
                    <span
                      key={m.id}
                      className="rounded-md border border-white/[0.04] bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-500"
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
            <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
              <Clock className="h-3.5 w-3.5" /> Cron Schedules
            </h2>
            <div className="space-y-2.5">
              {live.cron.jobs.map((job) => {
                const progress = cronProgress(job);
                const countdown = formatCountdown(job.nextRunAtMs);
                return (
                  <div
                    key={job.id}
                    className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4"
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
                        <p className="text-[13px] font-medium text-zinc-200">
                          {job.name}
                        </p>
                        <p className="text-[10px] text-zinc-600">
                          {job.scheduleDisplay}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-mono font-medium text-zinc-300">
                          {countdown}
                        </p>
                        <p className="text-[10px] text-zinc-600">
                          ran {formatAgo(job.lastRunAtMs || 0)} ({formatDuration(job.lastDurationMs)})
                        </p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-2.5 h-1.5 rounded-full bg-zinc-800">
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
            <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
              <Zap className="h-3.5 w-3.5" /> Recent Cron Results
            </h2>
            <div className="space-y-1.5">
              {live.cronRuns.slice(0, 6).map((run, i) => (
                <div
                  key={`${run.jobId}-${run.ts}-${i}`}
                  className="rounded-lg border border-white/[0.04] bg-zinc-900/30 px-4 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    {run.status === "ok" ? (
                      <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    )}
                    <span className="text-[11px] text-zinc-500">
                      {formatAgo(run.ts)}
                    </span>
                    {run.durationMs && (
                      <span className="text-[10px] text-zinc-600">
                        {formatDuration(run.durationMs)}
                      </span>
                    )}
                  </div>
                  {run.summary && (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-zinc-400">
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
          <h2 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
            <Radio className="h-3.5 w-3.5" /> Gateway Log
          </h2>
          <div className="rounded-xl border border-white/[0.06] bg-[#08080c]/60 p-1">
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
                        : "hover:bg-white/[0.02]"
                    )}
                  >
                    <span className="shrink-0 text-zinc-600">{time}</span>
                    <span
                      className={cn(
                        "shrink-0 w-24 truncate",
                        isCron
                          ? "text-amber-500"
                          : isWs
                            ? "text-blue-500"
                            : "text-zinc-500"
                      )}
                    >
                      [{entry.source}]
                    </span>
                    <span className="min-w-0 truncate text-zinc-400">
                      {entry.message}
                    </span>
                  </div>
                );
              })}
              {live.logEntries.length === 0 && (
                <p className="px-2 py-4 text-center text-zinc-600">
                  No recent log entries
                </p>
              )}
            </div>
          </div>
        </div>
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
        "rounded-xl border border-white/[0.06] bg-zinc-900/50 p-3",
        onClick && "cursor-pointer transition-colors hover:border-white/[0.12]"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5">
        <div className={cn("rounded-lg p-1.5", color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-base font-semibold text-zinc-100">{value}</p>
          <p className="text-[10px] text-zinc-500">{label}</p>
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
