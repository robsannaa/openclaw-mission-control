"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  Clock,
  Play,
  Pause,
  Pencil,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  Loader2,
  Send,
  Cpu,
  Zap,
  Calendar,
  Globe,
  Hash,
  FileText,
  Timer,
  AlertTriangle,
  Copy,
  ExternalLink,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── types ────────────────────────────────────────── */

type CronJob = {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  schedule: { kind: string; expr?: string; everyMs?: number; tz?: string };
  sessionTarget?: string;
  wakeMode?: string;
  payload: { kind: string; message?: string; model?: string };
  delivery: { mode: string; channel?: string; to?: string; bestEffort?: boolean };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
    lastError?: string;
  };
};

type RunEntry = {
  ts: number;
  jobId: string;
  action: string;
  status: string;
  summary?: string;
  durationMs?: number;
  error?: string;
  sessionId?: string;
  sessionKey?: string;
  runAtMs?: number;
  nextRunAtMs?: number;
};

type Toast = { message: string; type: "success" | "error" };

/* ── helpers ──────────────────────────────────────── */

function fmtDuration(ms: number | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function fmtAgo(ms: number | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) {
    // Future
    const absDiff = Math.abs(diff);
    if (absDiff < 60000) return `in ${Math.floor(absDiff / 1000)}s`;
    if (absDiff < 3600000) return `in ${Math.floor(absDiff / 60000)}m`;
    if (absDiff < 86400000) return `in ${Math.floor(absDiff / 3600000)}h`;
    return `in ${Math.floor(absDiff / 86400000)}d`;
  }
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function fmtDate(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtFullDate(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function scheduleDisplay(s: CronJob["schedule"]): string {
  if (s.kind === "cron" && s.expr)
    return `${s.expr}${s.tz ? ` (${s.tz})` : ""}`;
  if (s.kind === "every" && s.everyMs) {
    const mins = Math.round(s.everyMs / 60000);
    return mins < 60 ? `Every ${mins}m` : `Every ${Math.round(mins / 60)}h`;
  }
  return "Unknown";
}

function describeDelivery(d: CronJob["delivery"]): {
  label: string;
  hasIssue: boolean;
  issue?: string;
} {
  if (!d.mode || d.mode === "none")
    return { label: "No delivery", hasIssue: false };
  const parts: string[] = [d.mode];
  if (d.channel) parts.push(`→ ${d.channel}`);
  if (d.to) parts.push(`→ ${d.to}`);
  const hasIssue = d.mode === "announce" && !d.to;
  return {
    label: parts.join(" "),
    hasIssue,
    issue: hasIssue
      ? 'Missing delivery target ("to"). The job will fail after completing.'
      : undefined,
  };
}

/* ── Run detail card ──────────────────────────────── */

function RunCard({ run }: { run: RunEntry }) {
  const [showFull, setShowFull] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-[11px]",
        run.status === "error"
          ? "border-red-500/15 bg-red-500/[0.03]"
          : "border-white/[0.04] bg-zinc-800/20"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        {run.status === "ok" ? (
          <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
        )}
        <span className="font-medium text-zinc-300">
          {fmtFullDate(run.ts)}
        </span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-500">{fmtDuration(run.durationMs)}</span>
        {run.sessionId && (
          <>
            <span className="text-zinc-600">·</span>
            <span className="font-mono text-[10px] text-zinc-700">
              {run.sessionId.substring(0, 8)}
            </span>
          </>
        )}
        <div className="flex-1" />
        {(run.summary || run.error || run.sessionKey) && (
          <button
            type="button"
            onClick={() => setShowFull(!showFull)}
            className="text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
          >
            {showFull ? "Collapse" : "Details"}
          </button>
        )}
      </div>

      {/* Error */}
      {run.error && (
        <div className="mt-2 flex items-start gap-1.5 rounded bg-red-500/10 px-2.5 py-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
          <p className="text-red-300">{run.error}</p>
        </div>
      )}

      {/* Summary preview (collapsed) */}
      {!showFull && run.summary && (
        <p className="mt-1.5 line-clamp-2 leading-5 text-zinc-500">
          {run.summary.replace(/[*#|_`]/g, "").substring(0, 200)}
        </p>
      )}

      {/* Full details (expanded) */}
      {showFull && (
        <div className="mt-2 space-y-2">
          {run.summary && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Summary
              </p>
              <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-800/40 p-3 leading-5 text-zinc-400">
                {run.summary}
              </pre>
            </div>
          )}
          {run.sessionKey && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-600">Session:</span>
              <code className="rounded bg-zinc-800/60 px-2 py-0.5 font-mono text-[10px] text-zinc-500">
                {run.sessionKey}
              </code>
            </div>
          )}
          {run.runAtMs && (
            <div className="flex items-center gap-2 text-[10px] text-zinc-600">
              <span>Scheduled: {fmtFullDate(run.runAtMs)}</span>
              <span>·</span>
              <span>Ran: {fmtFullDate(run.ts)}</span>
              {run.nextRunAtMs && (
                <>
                  <span>·</span>
                  <span>Next: {fmtFullDate(run.nextRunAtMs)}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Edit form ───────────────────────────────────── */

function EditCronForm({
  job,
  onSave,
  onCancel,
  onDelete,
}: {
  job: CronJob;
  onSave: (updates: Record<string, unknown>) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(job.name);
  const [message, setMessage] = useState(job.payload.message || "");
  const [schedType, setSchedType] = useState(job.schedule.kind);
  const [cronExpr, setCronExpr] = useState(job.schedule.expr || "");
  const [everyVal, setEveryVal] = useState(
    job.schedule.everyMs
      ? `${Math.round(job.schedule.everyMs / 60000)}m`
      : ""
  );
  const [tz, setTz] = useState(job.schedule.tz || "");
  const [model, setModel] = useState(job.payload.model || "");

  // Delivery
  const [deliveryMode, setDeliveryMode] = useState(job.delivery.mode || "none");
  const [channel, setChannel] = useState(job.delivery.channel || "");
  const [to, setTo] = useState(job.delivery.to || "");

  const [confirmDel, setConfirmDel] = useState(false);

  const save = () => {
    const updates: Record<string, unknown> = {};
    if (name !== job.name) updates.name = name;
    if (message !== (job.payload.message || "")) updates.message = message;
    if (schedType === "cron" && cronExpr !== (job.schedule.expr || ""))
      updates.cron = cronExpr;
    if (schedType === "every" && everyVal) updates.every = everyVal;
    if (tz && tz !== (job.schedule.tz || "")) updates.tz = tz;
    if (model && model !== (job.payload.model || "")) updates.model = model;

    // Delivery updates
    if (deliveryMode === "announce") {
      updates.announce = true;
      if (channel && channel !== (job.delivery.channel || ""))
        updates.channel = channel;
      if (to !== (job.delivery.to || "")) updates.to = to;
    } else if (deliveryMode === "none") {
      if (job.delivery.mode === "announce") updates.announce = false;
    }

    onSave(updates);
  };

  const deliveryIssue =
    deliveryMode === "announce" && !to
      ? "Without a target, delivery will fail. Set a recipient (e.g. telegram:YOUR_CHAT_ID)"
      : null;

  return (
    <div className="border-t border-white/[0.06] bg-zinc-900/30 px-4 py-4 space-y-4">
      {/* Name */}
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 text-[13px] text-zinc-200 outline-none focus:border-violet-500/30"
        />
      </div>

      {/* Prompt / Message */}
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Prompt / Message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 text-[12px] leading-5 text-zinc-300 outline-none focus:border-violet-500/30"
        />
      </div>

      {/* Schedule */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            Schedule Type
          </label>
          <select
            value={schedType}
            onChange={(e) => setSchedType(e.target.value)}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 text-[12px] text-zinc-300 outline-none"
          >
            <option value="cron">Cron Expression</option>
            <option value="every">Interval</option>
          </select>
        </div>
        <div>
          {schedType === "cron" ? (
            <>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Cron Expression
              </label>
              <input
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 8 * * *"
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 font-mono text-[12px] text-zinc-300 outline-none focus:border-violet-500/30"
              />
            </>
          ) : (
            <>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                Interval
              </label>
              <input
                value={everyVal}
                onChange={(e) => setEveryVal(e.target.value)}
                placeholder="5m, 1h, 30s"
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 font-mono text-[12px] text-zinc-300 outline-none focus:border-violet-500/30"
              />
            </>
          )}
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            Timezone
          </label>
          <input
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="Europe/Warsaw"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 text-[12px] text-zinc-300 outline-none focus:border-violet-500/30"
          />
        </div>
      </div>

      {/* Delivery */}
      <div>
        <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          <Send className="h-3 w-3" />
          Delivery Configuration
        </label>
        <div className="rounded-lg border border-white/[0.06] bg-zinc-800/30 p-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[10px] text-zinc-500">
                Mode
              </label>
              <select
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value)}
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 text-[12px] text-zinc-300 outline-none"
              >
                <option value="announce">Announce (send summary)</option>
                <option value="none">No delivery</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-zinc-500">
                Channel
              </label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                disabled={deliveryMode === "none"}
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 text-[12px] text-zinc-300 outline-none disabled:opacity-40"
              >
                <option value="">Select channel</option>
                <option value="telegram">Telegram</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="discord">Discord</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-zinc-500">
                To (recipient)
              </label>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={deliveryMode === "none"}
                placeholder="telegram:CHAT_ID"
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 font-mono text-[12px] text-zinc-300 outline-none focus:border-violet-500/30 disabled:opacity-40"
              />
            </div>
          </div>

          {/* Warning for missing target */}
          {deliveryIssue && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <div>
                <p className="text-[11px] font-medium text-amber-400">
                  Missing delivery target
                </p>
                <p className="text-[10px] text-amber-300/70">
                  {deliveryIssue}
                </p>
              </div>
            </div>
          )}

          <p className="text-[10px] text-zinc-700">
            Format: <code className="text-zinc-600">telegram:CHAT_ID</code>,{" "}
            <code className="text-zinc-600">+15555550123</code> (WhatsApp),{" "}
            <code className="text-zinc-600">discord:CHANNEL_ID</code>
          </p>
        </div>
      </div>

      {/* Model override */}
      <div>
        <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          <Cpu className="h-3 w-3" />
          Model Override
          <span className="font-normal normal-case text-zinc-700">
            (optional — leave blank for default)
          </span>
        </label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. minimax-portal/MiniMax-M2.5"
          className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 font-mono text-[12px] text-zinc-300 outline-none focus:border-violet-500/30"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {confirmDel ? (
          <>
            <button
              type="button"
              onClick={onDelete}
              className="rounded bg-red-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-red-500"
            >
              Confirm Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDel(false)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            className="flex items-center gap-1 rounded p-1.5 text-zinc-600 hover:bg-red-500/15 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-1 rounded bg-violet-600 px-4 py-1.5 text-[11px] font-medium text-white hover:bg-violet-500"
        >
          <Check className="h-3 w-3" /> Save Changes
        </button>
      </div>
    </div>
  );
}

/* ── Main CronView ───────────────────────────────── */

export function CronView() {
  const searchParams = useSearchParams();
  const showMode = searchParams.get("show"); // "errors" to auto-expand first error
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunEntry[]>>({});
  const [runsLoading, setRunsLoading] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didAutoExpand = useRef(false);

  const flash = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ message, type });
      toastTimer.current = setTimeout(() => setToast(null), 4000);
    },
    []
  );

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/cron");
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const fetchRuns = useCallback(async (jobId: string) => {
    setRunsLoading(jobId);
    try {
      const res = await fetch(
        `/api/cron?action=runs&id=${jobId}&limit=20`
      );
      const data = await res.json();
      setRuns((prev) => ({ ...prev, [jobId]: data.entries || [] }));
    } catch {
      /* ignore */
    }
    setRunsLoading(null);
  }, []);

  // Auto-expand the first errored job when navigated with ?show=errors
  useEffect(() => {
    if (showMode === "errors" && jobs.length > 0 && !didAutoExpand.current) {
      const firstError = jobs.find((j) => j.state.lastStatus === "error");
      if (firstError) {
        didAutoExpand.current = true;
        setExpanded(firstError.id);
        if (!runs[firstError.id]) {
          fetchRuns(firstError.id);
        }
        setTimeout(() => {
          const el = document.getElementById(`cron-job-${firstError.id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 200);
      }
    }
  }, [showMode, jobs, runs, fetchRuns]);

  const toggleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      if (!runs[id]) fetchRuns(id);
    }
  };

  const doAction = useCallback(
    async (action: string, id: string, extra?: Record<string, unknown>) => {
      setActionLoading(`${action}-${id}`);
      try {
        const res = await fetch("/api/cron", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, id, ...extra }),
        });
        const data = await res.json();
        if (data.ok) {
          flash(`${action} successful`);
          fetchJobs();
          if (action === "run") setTimeout(() => fetchRuns(id), 5000);
        } else {
          flash(data.error || "Failed", "error");
        }
      } catch (err) {
        flash(String(err), "error");
      }
      setActionLoading(null);
    },
    [fetchJobs, fetchRuns, flash]
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading cron jobs...
      </div>
    );
  }

  const errorJobs = jobs.filter((j) => j.state.lastStatus === "error");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-5">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">
            Cron Jobs ({jobs.length})
          </h2>
          <p className="text-[11px] text-zinc-600">
            Schedule, delivery, run history &bull; Edit schedule, content,
            delivery targets
            {errorJobs.length > 0 && (
              <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                {errorJobs.length} failing
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            fetchJobs();
          }}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800/60"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 pb-6">
        {jobs.map((job) => {
          const isExpanded = expanded === job.id;
          const isEditing = editing === job.id;
          const st = job.state;
          const hasError = st.lastStatus === "error";
          const delivery = describeDelivery(job.delivery);
          const jobRuns = runs[job.id] || [];

          return (
            <div
              key={job.id}
              id={`cron-job-${job.id}`}
              className={cn(
                "rounded-xl border bg-zinc-900/50 transition-colors",
                hasError
                  ? "border-red-500/20"
                  : "border-white/[0.06]",
                hasError && expanded === job.id && "ring-1 ring-red-500/30"
              )}
            >
              {/* Job header */}
              <div className="flex items-center gap-3 p-4">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(job.id);
                  }}
                  className="shrink-0"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-zinc-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-zinc-600" />
                  )}
                </button>
                <div
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    !job.enabled
                      ? "bg-zinc-600"
                      : hasError
                        ? "bg-red-500 shadow-[0_0_6px] shadow-red-500/40"
                        : st.lastStatus === "ok"
                          ? "bg-emerald-500"
                          : "bg-zinc-500"
                  )}
                />
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => toggleExpand(job.id)}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-zinc-200">
                      {job.name}
                    </p>
                    {!job.enabled && (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-zinc-600">
                        DISABLED
                      </span>
                    )}
                    {delivery.hasIssue && (
                      <span className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        missing target
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    {scheduleDisplay(job.schedule)} &bull; {job.agentId}
                    {st.nextRunAtMs && (
                      <>
                        {" "}&bull; Next: {fmtAgo(st.nextRunAtMs)}
                      </>
                    )}
                  </p>
                </div>
                {/* Quick actions */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      doAction(
                        job.enabled ? "disable" : "enable",
                        job.id
                      )
                    }
                    disabled={
                      actionLoading ===
                      `${job.enabled ? "disable" : "enable"}-${job.id}`
                    }
                    className={cn(
                      "rounded p-1.5 transition-colors",
                      job.enabled
                        ? "text-emerald-500 hover:bg-emerald-500/15"
                        : "text-zinc-600 hover:bg-zinc-800"
                    )}
                    title={job.enabled ? "Disable" : "Enable"}
                  >
                    {job.enabled ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => doAction("run", job.id)}
                    disabled={actionLoading === `run-${job.id}`}
                    className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-blue-500/15 hover:text-blue-400 disabled:opacity-50"
                    title="Run now"
                  >
                    {actionLoading === `run-${job.id}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing(isEditing ? null : job.id)
                    }
                    className={cn(
                      "rounded p-1.5 transition-colors",
                      isEditing
                        ? "bg-violet-500/15 text-violet-400"
                        : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                    )}
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Error banner with quick-fix suggestion */}
              {hasError && st.lastError && !isEditing && (
                <div className="mx-4 mb-3 rounded-lg border border-red-500/15 bg-red-500/[0.06] px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-red-400">
                        Error
                        {st.consecutiveErrors && st.consecutiveErrors > 1
                          ? ` (${st.consecutiveErrors} consecutive)`
                          : ""}
                      </p>
                      <p className="mt-0.5 text-[11px] text-red-300/70">
                        {st.lastError}
                      </p>

                      {/* Quick-fix suggestion */}
                      {st.lastError.includes("delivery target is missing") && (
                        <div className="mt-2 flex items-center gap-2 rounded bg-amber-500/10 px-2.5 py-1.5">
                          <Zap className="h-3 w-3 shrink-0 text-amber-400" />
                          <p className="text-[10px] text-amber-300">
                            <strong>Fix:</strong> Edit this job and add a delivery
                            target (e.g.{" "}
                            <code className="rounded bg-zinc-800/80 px-1 text-amber-400">
                              telegram:CHAT_ID
                            </code>
                            ) in the Delivery section.
                          </p>
                          <button
                            type="button"
                            onClick={() => setEditing(job.id)}
                            className="shrink-0 rounded bg-amber-500/15 px-2 py-1 text-[10px] font-medium text-amber-300 transition-colors hover:bg-amber-500/25"
                          >
                            Fix now →
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Edit form */}
              {isEditing && (
                <EditCronForm
                  job={job}
                  onSave={(updates) => {
                    doAction("edit", job.id, updates);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                  onDelete={() => {
                    doAction("delete", job.id);
                    setEditing(null);
                  }}
                />
              )}

              {/* Expanded detail view */}
              {isExpanded && !isEditing && (
                <div className="border-t border-white/[0.04] px-4 py-4 space-y-4">
                  {/* ── Job Configuration ──── */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      <Info className="h-3 w-3" />
                      Job Configuration
                    </h3>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-white/[0.04] bg-zinc-800/20 px-3 py-3 text-[11px]">
                      <div className="flex items-center gap-2">
                        <Hash className="h-3 w-3 text-zinc-700" />
                        <span className="text-zinc-600">Job ID</span>
                        <code className="ml-auto font-mono text-[10px] text-zinc-500">
                          {job.id}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <Globe className="h-3 w-3 text-zinc-700" />
                        <span className="text-zinc-600">Agent</span>
                        <span className="ml-auto text-zinc-400">
                          {job.agentId}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3 text-zinc-700" />
                        <span className="text-zinc-600">Schedule</span>
                        <span className="ml-auto font-mono text-zinc-400">
                          {scheduleDisplay(job.schedule)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-zinc-700" />
                        <span className="text-zinc-600">Session</span>
                        <span className="ml-auto text-zinc-400">
                          {job.sessionTarget || "default"}
                          {job.wakeMode && ` · wake: ${job.wakeMode}`}
                        </span>
                      </div>
                      {job.payload.model && (
                        <div className="flex items-center gap-2">
                          <Cpu className="h-3 w-3 text-zinc-700" />
                          <span className="text-zinc-600">Model</span>
                          <span className="ml-auto font-mono text-[10px] text-violet-400">
                            {job.payload.model}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <FileText className="h-3 w-3 text-zinc-700" />
                        <span className="text-zinc-600">Created</span>
                        <span className="ml-auto text-zinc-500">
                          {fmtDate(job.createdAtMs)}
                        </span>
                      </div>
                      {job.updatedAtMs && (
                        <div className="flex items-center gap-2">
                          <FileText className="h-3 w-3 text-zinc-700" />
                          <span className="text-zinc-600">Updated</span>
                          <span className="ml-auto text-zinc-500">
                            {fmtDate(job.updatedAtMs)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Delivery Config ─────── */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      <Send className="h-3 w-3" />
                      Delivery
                    </h3>
                    <div
                      className={cn(
                        "rounded-lg border px-3 py-3 text-[11px]",
                        delivery.hasIssue
                          ? "border-amber-500/20 bg-amber-500/[0.04]"
                          : "border-white/[0.04] bg-zinc-800/20"
                      )}
                    >
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <span className="text-zinc-600">Mode</span>
                          <p className="mt-0.5 font-medium text-zinc-300">
                            {job.delivery.mode || "none"}
                          </p>
                        </div>
                        <div>
                          <span className="text-zinc-600">Channel</span>
                          <p className="mt-0.5 text-zinc-300">
                            {job.delivery.channel || "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-zinc-600">To (recipient)</span>
                          <p
                            className={cn(
                              "mt-0.5 font-mono",
                              job.delivery.to
                                ? "text-zinc-300"
                                : "text-amber-400"
                            )}
                          >
                            {job.delivery.to || "⚠ not set"}
                          </p>
                        </div>
                      </div>

                      {delivery.hasIssue && (
                        <div className="mt-2 flex items-center gap-2">
                          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                          <p className="text-[10px] text-amber-400">
                            {delivery.issue}
                          </p>
                          <button
                            type="button"
                            onClick={() => setEditing(job.id)}
                            className="ml-auto shrink-0 rounded bg-amber-500/15 px-2 py-1 text-[10px] font-medium text-amber-300 transition-colors hover:bg-amber-500/25"
                          >
                            Fix →
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Execution Status ────── */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      <Timer className="h-3 w-3" />
                      Execution Status
                    </h3>
                    <div className="grid grid-cols-4 gap-3">
                      <div className="rounded-lg border border-white/[0.04] bg-zinc-800/20 px-3 py-2 text-center">
                        <p className="text-[10px] text-zinc-600">Last Run</p>
                        <p className="mt-0.5 text-[12px] font-medium text-zinc-300">
                          {fmtAgo(st.lastRunAtMs)}
                        </p>
                        <p className="text-[9px] text-zinc-700">
                          {fmtDate(st.lastRunAtMs)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/[0.04] bg-zinc-800/20 px-3 py-2 text-center">
                        <p className="text-[10px] text-zinc-600">Next Run</p>
                        <p className="mt-0.5 text-[12px] font-medium text-zinc-300">
                          {fmtAgo(st.nextRunAtMs)}
                        </p>
                        <p className="text-[9px] text-zinc-700">
                          {fmtDate(st.nextRunAtMs)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/[0.04] bg-zinc-800/20 px-3 py-2 text-center">
                        <p className="text-[10px] text-zinc-600">Duration</p>
                        <p className="mt-0.5 text-[12px] font-medium text-zinc-300">
                          {fmtDuration(st.lastDurationMs)}
                        </p>
                      </div>
                      <div
                        className={cn(
                          "rounded-lg border px-3 py-2 text-center",
                          hasError
                            ? "border-red-500/15 bg-red-500/[0.04]"
                            : "border-white/[0.04] bg-zinc-800/20"
                        )}
                      >
                        <p className="text-[10px] text-zinc-600">Status</p>
                        <p
                          className={cn(
                            "mt-0.5 text-[12px] font-medium",
                            hasError
                              ? "text-red-400"
                              : st.lastStatus === "ok"
                                ? "text-emerald-400"
                                : "text-zinc-400"
                          )}
                        >
                          {st.lastStatus || "—"}
                        </p>
                        {st.consecutiveErrors ? (
                          <p className="text-[9px] text-red-500">
                            {st.consecutiveErrors} consecutive
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* ── Prompt ──────────────── */}
                  {job.payload.message && (
                    <div>
                      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        <FileText className="h-3 w-3" />
                        Prompt
                      </h3>
                      <pre className="max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/[0.04] bg-zinc-800/20 p-3 text-[11px] leading-5 text-zinc-400">
                        {job.payload.message}
                      </pre>
                    </div>
                  )}

                  {/* ── Run History ─────────── */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        <Clock className="h-3 w-3" />
                        Run History
                      </h3>
                      <button
                        type="button"
                        onClick={() => fetchRuns(job.id)}
                        disabled={runsLoading === job.id}
                        className="flex items-center gap-1 text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
                      >
                        <RefreshCw
                          className={cn(
                            "h-2.5 w-2.5",
                            runsLoading === job.id && "animate-spin"
                          )}
                        />
                        Refresh
                      </button>
                    </div>
                    {runsLoading === job.id && jobRuns.length === 0 ? (
                      <div className="flex items-center gap-2 py-4 text-[11px] text-zinc-600">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading runs...
                      </div>
                    ) : jobRuns.length === 0 ? (
                      <p className="text-[11px] text-zinc-600">
                        No runs recorded
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {jobRuns.map((run, i) => (
                          <RunCard key={`${run.ts}-${i}`} run={run} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12px] shadow-xl backdrop-blur-sm",
            toast.type === "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/20 bg-red-500/10 text-red-300"
          )}
        >
          {toast.type === "success" ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          {toast.message}
        </div>
      )}
    </div>
  );
}
