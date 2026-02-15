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
  Info,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { requestRestart } from "@/lib/restart-store";

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
          : "border-foreground/[0.04] bg-muted/40"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        {run.status === "ok" ? (
          <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
        )}
        <span className="font-medium text-foreground/70">
          {fmtFullDate(run.ts)}
        </span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground">{fmtDuration(run.durationMs)}</span>
        {run.sessionId && (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="font-mono text-[10px] text-muted-foreground/40">
              {run.sessionId.substring(0, 8)}
            </span>
          </>
        )}
        <div className="flex-1" />
        {(run.summary || run.error || run.sessionKey) && (
          <button
            type="button"
            onClick={() => setShowFull(!showFull)}
            className="text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
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
        <p className="mt-1.5 line-clamp-2 leading-5 text-muted-foreground">
          {run.summary.replace(/[*#|_`]/g, "").substring(0, 200)}
        </p>
      )}

      {/* Full details (expanded) */}
      {showFull && (
        <div className="mt-2 space-y-2">
          {run.summary && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Summary
              </p>
              <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 leading-5 text-muted-foreground">
                {run.summary}
              </pre>
            </div>
          )}
          {run.sessionKey && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/60">Session:</span>
              <code className="rounded bg-muted/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {run.sessionKey}
              </code>
            </div>
          )}
          {run.runAtMs && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
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

/* ── Known delivery target type ───────────────────── */
type KnownTarget = { target: string; channel: string; source: string };

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
  const [customTo, setCustomTo] = useState(false); // true = manual entry mode
  const [knownTargets, setKnownTargets] = useState<KnownTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);

  const [confirmDel, setConfirmDel] = useState(false);

  // Fetch known delivery targets on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/cron?action=targets");
        const data = await res.json();
        setKnownTargets(data.targets || []);
      } catch {
        /* ignore */
      }
      setTargetsLoading(false);
    })();
  }, []);

  // Filter targets by selected channel
  const filteredTargets = useMemo(() => {
    if (!channel) return knownTargets;
    return knownTargets.filter(
      (t) => t.channel === channel || !t.channel
    );
  }, [knownTargets, channel]);

  // If the current `to` value isn't in the known targets, switch to custom mode
  useEffect(() => {
    if (!targetsLoading && to && filteredTargets.length > 0) {
      const found = filteredTargets.some((t) => t.target === to);
      if (!found) queueMicrotask(() => setCustomTo(true));
    }
    if (!targetsLoading && filteredTargets.length === 0) {
      queueMicrotask(() => setCustomTo(true));
    }
  }, [targetsLoading, to, filteredTargets]);

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
    <div className="border-t border-foreground/[0.06] bg-card/70 px-4 py-4 space-y-4">
      {/* Name */}
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[13px] text-foreground/90 outline-none focus:border-violet-500/30"
        />
      </div>

      {/* Prompt / Message */}
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Prompt / Message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] leading-5 text-foreground/70 outline-none focus:border-violet-500/30"
        />
      </div>

      {/* Schedule */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Schedule Type
          </label>
          <select
            value={schedType}
            onChange={(e) => setSchedType(e.target.value)}
            className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none"
          >
            <option value="cron">Cron Expression</option>
            <option value="every">Interval</option>
          </select>
        </div>
        <div>
          {schedType === "cron" ? (
            <>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Cron Expression
              </label>
              <input
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 8 * * *"
                className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
              />
            </>
          ) : (
            <>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Interval
              </label>
              <input
                value={everyVal}
                onChange={(e) => setEveryVal(e.target.value)}
                placeholder="5m, 1h, 30s"
                className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
              />
            </>
          )}
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Timezone
          </label>
          <input
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="Europe/Warsaw"
            className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
          />
        </div>
      </div>

      {/* Delivery */}
      <div>
        <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          <Send className="h-3 w-3" />
          Delivery Configuration
        </label>
        <div className="rounded-lg border border-foreground/[0.06] bg-muted/50 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[10px] text-muted-foreground">
                Mode
              </label>
              <select
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value)}
                className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none"
              >
                <option value="announce">Announce (send summary)</option>
                <option value="none">No delivery</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-muted-foreground">
                Channel
              </label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                disabled={deliveryMode === "none"}
                className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none disabled:opacity-40"
              >
                <option value="">Select channel</option>
                <option value="telegram">Telegram</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="discord">Discord</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-muted-foreground">
                To (recipient)
              </label>
              {/* Smart target selector: known targets dropdown or custom input */}
              {deliveryMode === "none" ? (
                <input
                  disabled
                  value=""
                  placeholder="—"
                  className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none disabled:opacity-40"
                />
              ) : targetsLoading ? (
                <div className="flex h-[38px] items-center rounded-lg border border-foreground/[0.08] bg-muted/80 px-3">
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60" />
                  <span className="ml-2 text-[11px] text-muted-foreground/40">
                    Loading targets...
                  </span>
                </div>
              ) : !customTo && filteredTargets.length > 0 ? (
                <div className="space-y-1.5">
                  <select
                    value={to}
                    onChange={(e) => {
                      if (e.target.value === "__custom__") {
                        setCustomTo(true);
                      } else {
                        setTo(e.target.value);
                      }
                    }}
                    className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
                  >
                    <option value="">Select a target...</option>
                    {filteredTargets.map((t) => (
                      <option key={t.target} value={t.target}>
                        {t.target} ({t.source})
                      </option>
                    ))}
                    <option value="__custom__">Enter manually...</option>
                  </select>
                  {to && (
                    <p className="text-[10px] text-emerald-500/70">
                      <CheckCircle className="mr-1 inline h-2.5 w-2.5" />
                      Target set: <code className="text-emerald-400">{to}</code>
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder={
                      channel === "telegram"
                        ? "telegram:CHAT_ID"
                        : channel === "discord"
                          ? "discord:CHANNEL_ID"
                          : channel === "whatsapp"
                            ? "+15555550123"
                            : "telegram:CHAT_ID"
                    }
                    className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
                  />
                  {filteredTargets.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCustomTo(false)}
                      className="text-[10px] text-violet-400 hover:text-violet-300"
                    >
                      ← Pick from known targets
                    </button>
                  )}
                </div>
              )}
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

          {customTo && (
            <p className="text-[10px] text-muted-foreground/40">
              Format: <code className="text-muted-foreground/60">telegram:CHAT_ID</code>,{" "}
              <code className="text-muted-foreground/60">+15555550123</code> (WhatsApp),{" "}
              <code className="text-muted-foreground/60">discord:CHANNEL_ID</code>
            </p>
          )}
        </div>
      </div>

      {/* Model override */}
      <div>
        <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          <Cpu className="h-3 w-3" />
          Model Override
          <span className="font-normal normal-case text-muted-foreground/40">
            (optional — leave blank for default)
          </span>
        </label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. minimax-portal/MiniMax-M2.5"
          className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
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
              className="text-[11px] text-muted-foreground hover:text-foreground/70"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            className="flex items-center gap-1 rounded p-1.5 text-muted-foreground/60 hover:bg-red-500/15 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground/70"
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

/* ── Cron presets for quick creation ──────────────── */

const CRON_PRESETS = [
  { label: "Every morning at 8am", expr: "0 8 * * *", kind: "cron" as const },
  { label: "Every evening at 6pm", expr: "0 18 * * *", kind: "cron" as const },
  { label: "Every Monday at 9am", expr: "0 9 * * 1", kind: "cron" as const },
  { label: "Every hour", interval: "1h", kind: "every" as const },
  { label: "Every 30 minutes", interval: "30m", kind: "every" as const },
  { label: "Every 5 minutes", interval: "5m", kind: "every" as const },
  { label: "Twice a day (8am & 8pm)", expr: "0 8,20 * * *", kind: "cron" as const },
  { label: "Weekdays at noon", expr: "0 12 * * 1-5", kind: "cron" as const },
];

/* ── Timezone suggestions ────────────────────────── */

const TZ_SUGGESTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Warsaw",
  "Europe/Rome",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/* ── Create Cron Job Form ────────────────────────── */

function CreateCronForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  // ── Step management ──
  const [step, setStep] = useState(1); // 1=basics, 2=schedule, 3=payload, 4=delivery, 5=review
  const totalSteps = 5;

  // ── Form state ──
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agent, setAgent] = useState("main");
  const [scheduleKind, setScheduleKind] = useState<"cron" | "every" | "at">("cron");
  const [cronExpr, setCronExpr] = useState("0 8 * * *");
  const [everyInterval, setEveryInterval] = useState("1h");
  const [atTime, setAtTime] = useState("");
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [sessionTarget, setSessionTarget] = useState<"main" | "isolated">("isolated");
  const [payloadKind, setPayloadKind] = useState<"agentTurn" | "systemEvent">("agentTurn");
  const [message, setMessage] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"announce" | "none">("announce");
  const [channel, setChannel] = useState("");
  const [to, setTo] = useState("");
  const [bestEffort, setBestEffort] = useState(true);
  const [deleteAfterRun, setDeleteAfterRun] = useState(false);
  const [customTo, setCustomTo] = useState(false);

  // ── Data loading ──
  const [agents, setAgents] = useState<{ id: string; name?: string }[]>([]);
  const [knownTargets, setKnownTargets] = useState<KnownTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch agents and delivery targets on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/agents");
        const data = await res.json();
        const agentList = (data.agents || []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          name: a.name as string | undefined,
        }));
        setAgents(agentList);
        if (agentList.length === 1) setAgent(agentList[0].id);
      } catch { /* ignore */ }
    })();
    (async () => {
      try {
        const res = await fetch("/api/cron?action=targets");
        const data = await res.json();
        setKnownTargets(data.targets || []);
      } catch { /* ignore */ }
      setTargetsLoading(false);
    })();
  }, []);

  // Filter targets by selected channel
  const filteredTargets = useMemo(() => {
    if (!channel) return knownTargets;
    return knownTargets.filter((t) => t.channel === channel || !t.channel);
  }, [knownTargets, channel]);

  // Auto-set deleteAfterRun for "at" schedules
  useEffect(() => {
    if (scheduleKind === "at") setDeleteAfterRun(true);
  }, [scheduleKind]);

  // Auto-set session + delivery when payload kind changes
  useEffect(() => {
    if (payloadKind === "systemEvent") {
      setSessionTarget("main");
      setDeliveryMode("none");
    }
  }, [payloadKind]);

  const canAdvance = (): boolean => {
    switch (step) {
      case 1: return name.trim().length > 0;
      case 2:
        if (scheduleKind === "cron") return cronExpr.trim().length > 0;
        if (scheduleKind === "every") return everyInterval.trim().length > 0;
        if (scheduleKind === "at") return atTime.trim().length > 0;
        return false;
      case 3: return message.trim().length > 0;
      case 4: return true; // delivery is optional
      default: return true;
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: name.trim(),
          description: description.trim() || undefined,
          agent,
          scheduleKind,
          cronExpr: scheduleKind === "cron" ? cronExpr.trim() : undefined,
          everyInterval: scheduleKind === "every" ? everyInterval.trim() : undefined,
          atTime: scheduleKind === "at" ? atTime.trim() : undefined,
          tz: tz || undefined,
          sessionTarget,
          payloadKind,
          message: message.trim(),
          model: model.trim() || undefined,
          thinking: thinking || undefined,
          deliveryMode,
          channel: deliveryMode === "announce" ? channel || undefined : undefined,
          to: deliveryMode === "announce" ? to || undefined : undefined,
          bestEffort: deliveryMode === "announce" ? bestEffort : undefined,
          deleteAfterRun: scheduleKind === "at" ? deleteAfterRun : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onCreated();
      } else {
        setError(data.error || "Failed to create cron job");
      }
    } catch (err) {
      setError(String(err));
    }
    setSubmitting(false);
  };

  return (
    <div className="rounded-xl border border-violet-500/20 bg-card/90 overflow-hidden">
      {/* Wizard header */}
      <div className="flex items-center justify-between border-b border-foreground/[0.06] bg-violet-500/[0.04] px-4 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-violet-400" />
          <h3 className="text-[13px] font-semibold text-foreground">New Cron Job</h3>
        </div>
        <div className="flex items-center gap-3">
          {/* Step indicator */}
          <div className="flex items-center gap-1">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i + 1 === step ? "w-4 bg-violet-500" : i + 1 < step ? "w-1.5 bg-violet-500/60" : "w-1.5 bg-foreground/10"
                )}
              />
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground/60">Step {step}/{totalSteps}</span>
          <button type="button" onClick={onCancel} className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground/70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* ── Step 1: Basics ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h4 className="text-[12px] font-medium text-foreground/80 mb-1">What should we call this job?</h4>
              <p className="text-[10px] text-muted-foreground/60 mb-3">Give it a descriptive name so you can easily find it later.</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Morning Brief, Daily Sync, Weekly Report..."
                className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2.5 text-[13px] text-foreground/90 outline-none focus:border-violet-500/30"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Description <span className="font-normal normal-case">(optional)</span>
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of what this job does..."
                className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Agent</label>
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none"
              >
                {agents.length === 0 && <option value="main">main</option>}
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name || a.id}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* ── Step 2: Schedule ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h4 className="text-[12px] font-medium text-foreground/80 mb-1">When should it run?</h4>
              <p className="text-[10px] text-muted-foreground/60 mb-3">Pick a schedule type or use a quick preset.</p>
            </div>

            {/* Quick presets */}
            <div>
              <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Quick Presets</label>
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setScheduleKind(p.kind);
                      if (p.kind === "cron" && p.expr) setCronExpr(p.expr);
                      if (p.kind === "every" && p.interval) setEveryInterval(p.interval);
                    }}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-[10px] transition-colors",
                      (scheduleKind === "cron" && p.kind === "cron" && cronExpr === p.expr) ||
                        (scheduleKind === "every" && p.kind === "every" && everyInterval === p.interval)
                        ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                        : "border-foreground/[0.06] bg-muted/50 text-muted-foreground/70 hover:bg-muted/80 hover:text-foreground/70"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Schedule type + expression */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Type</label>
                <select
                  value={scheduleKind}
                  onChange={(e) => setScheduleKind(e.target.value as "cron" | "every" | "at")}
                  className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none"
                >
                  <option value="cron">Cron Expression (recurring)</option>
                  <option value="every">Fixed Interval (every X)</option>
                  <option value="at">One-Shot (run once)</option>
                </select>
              </div>
              <div>
                {scheduleKind === "cron" && (
                  <>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Cron Expression</label>
                    <input
                      value={cronExpr}
                      onChange={(e) => setCronExpr(e.target.value)}
                      placeholder="0 8 * * *"
                      className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
                    />
                    <p className="mt-1 text-[9px] text-muted-foreground/40">min hour day month weekday (e.g. &quot;0 8 * * *&quot; = 8am daily)</p>
                  </>
                )}
                {scheduleKind === "every" && (
                  <>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Interval</label>
                    <input
                      value={everyInterval}
                      onChange={(e) => setEveryInterval(e.target.value)}
                      placeholder="5m, 1h, 30s"
                      className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
                    />
                    <p className="mt-1 text-[9px] text-muted-foreground/40">Use s/m/h (e.g. &quot;30m&quot;, &quot;2h&quot;, &quot;45s&quot;)</p>
                  </>
                )}
                {scheduleKind === "at" && (
                  <>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Run At</label>
                    <input
                      type="datetime-local"
                      value={atTime}
                      onChange={(e) => setAtTime(e.target.value)}
                      className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
                    />
                    <p className="mt-1 text-[9px] text-muted-foreground/40">Or use a duration like &quot;20m&quot; for 20 minutes from now</p>
                  </>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Timezone</label>
                <select
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                  className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none"
                >
                  {TZ_SUGGESTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  {!TZ_SUGGESTIONS.includes(tz) && tz && (
                    <option value={tz}>{tz}</option>
                  )}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Payload ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h4 className="text-[12px] font-medium text-foreground/80 mb-1">What should the agent do?</h4>
              <p className="text-[10px] text-muted-foreground/60 mb-3">Write a prompt for the agent. Be specific about what you want.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Payload Type</label>
                <select
                  value={payloadKind}
                  onChange={(e) => setPayloadKind(e.target.value as "agentTurn" | "systemEvent")}
                  className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none"
                >
                  <option value="agentTurn">Agent Turn (isolated task)</option>
                  <option value="systemEvent">System Event (main session)</option>
                </select>
                <p className="mt-1 text-[9px] text-muted-foreground/40">
                  {payloadKind === "agentTurn"
                    ? "Runs in an isolated session — best for tasks with delivery"
                    : "Runs in the main session — best for internal updates"}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Session</label>
                <select
                  value={sessionTarget}
                  onChange={(e) => setSessionTarget(e.target.value as "main" | "isolated")}
                  disabled={payloadKind === "systemEvent"}
                  className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none disabled:opacity-40"
                >
                  <option value="isolated">Isolated (recommended)</option>
                  <option value="main">Main</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {payloadKind === "agentTurn" ? "Agent Prompt" : "System Event Text"}
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder={
                  payloadKind === "agentTurn"
                    ? "e.g. Summarize the latest news and send me a brief update..."
                    : "e.g. Time to run the daily health check."
                }
                className="w-full resize-y rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2.5 text-[12px] leading-5 text-foreground/70 outline-none focus:border-violet-500/30"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  <Cpu className="h-3 w-3" />
                  Model Override <span className="font-normal normal-case">(optional)</span>
                </label>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Leave blank for default model"
                  className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Thinking Level <span className="font-normal normal-case">(optional)</span>
                </label>
                <select
                  value={thinking}
                  onChange={(e) => setThinking(e.target.value)}
                  className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none"
                >
                  <option value="">Default</option>
                  <option value="off">Off</option>
                  <option value="minimal">Minimal</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="xhigh">Extra High</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: Delivery ── */}
        {step === 4 && (
          <div className="space-y-4">
            <div>
              <h4 className="text-[12px] font-medium text-foreground/80 mb-1">Where should results be delivered?</h4>
              <p className="text-[10px] text-muted-foreground/60 mb-3">
                {sessionTarget === "isolated"
                  ? "Isolated jobs can announce results to a messaging channel."
                  : "Main session jobs usually don't need delivery. You can skip this step."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Mode</label>
                <select
                  value={deliveryMode}
                  onChange={(e) => setDeliveryMode(e.target.value as "announce" | "none")}
                  className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none"
                >
                  <option value="announce">Announce (send summary)</option>
                  <option value="none">No delivery</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Channel</label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  disabled={deliveryMode === "none"}
                  className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 text-[12px] text-foreground/70 outline-none disabled:opacity-40"
                >
                  <option value="">Auto-detect</option>
                  <option value="telegram">Telegram</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                  <option value="signal">Signal</option>
                  <option value="last">Last used channel</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Recipient
                </label>
                {deliveryMode === "none" ? (
                  <input disabled value="" placeholder="—" className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none disabled:opacity-40" />
                ) : targetsLoading ? (
                  <div className="flex h-[38px] items-center rounded-lg border border-foreground/[0.08] bg-muted/80 px-3">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60" />
                    <span className="ml-2 text-[11px] text-muted-foreground/40">Loading targets...</span>
                  </div>
                ) : !customTo && filteredTargets.length > 0 ? (
                  <div className="space-y-1.5">
                    <select
                      value={to}
                      onChange={(e) => {
                        if (e.target.value === "__custom__") { setCustomTo(true); }
                        else { setTo(e.target.value); }
                      }}
                      className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
                    >
                      <option value="">Select a target...</option>
                      {filteredTargets.map((t) => (
                        <option key={t.target} value={t.target}>{t.target} ({t.source})</option>
                      ))}
                      <option value="__custom__">Enter manually...</option>
                    </select>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <input
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      placeholder={channel === "telegram" ? "telegram:CHAT_ID" : channel === "discord" ? "discord:CHANNEL_ID" : channel === "whatsapp" ? "+15555550123" : "telegram:CHAT_ID"}
                      className="w-full rounded-lg border border-foreground/[0.08] bg-muted/80 px-3 py-2 font-mono text-[12px] text-foreground/70 outline-none focus:border-violet-500/30"
                    />
                    {filteredTargets.length > 0 && (
                      <button type="button" onClick={() => setCustomTo(false)} className="text-[10px] text-violet-400 hover:text-violet-300">
                        ← Pick from known targets
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {deliveryMode === "announce" && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bestEffort}
                  onChange={(e) => setBestEffort(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-foreground/20 bg-muted/80 text-violet-500 focus:ring-violet-500/30"
                />
                <span className="text-[11px] text-muted-foreground/70">Best effort delivery (don&apos;t fail the job if delivery fails)</span>
              </label>
            )}

            {deliveryMode === "announce" && !to && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <p className="text-[10px] text-amber-300/70">
                  No recipient set. The job will run but delivery may fail unless you set a target or use &quot;last&quot; channel.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Step 5: Review ── */}
        {step === 5 && (
          <div className="space-y-4">
            <div>
              <h4 className="text-[12px] font-medium text-foreground/80 mb-1">Review &amp; Create</h4>
              <p className="text-[10px] text-muted-foreground/60 mb-3">Double-check everything looks good before creating.</p>
            </div>

            <div className="rounded-lg border border-foreground/[0.04] bg-muted/40 divide-y divide-foreground/[0.04]">
              {/* Name */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground/60">Name</span>
                <span className="text-[12px] font-medium text-foreground/80">{name}</span>
              </div>
              {/* Agent */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground/60">Agent</span>
                <span className="text-[12px] text-foreground/70">{agent}</span>
              </div>
              {/* Schedule */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground/60">Schedule</span>
                <span className="text-[12px] font-mono text-foreground/70">
                  {scheduleKind === "cron" && cronExpr}
                  {scheduleKind === "every" && `every ${everyInterval}`}
                  {scheduleKind === "at" && atTime}
                  {tz && <span className="text-muted-foreground/50"> ({tz})</span>}
                </span>
              </div>
              {/* Session */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground/60">Session</span>
                <span className="text-[12px] text-foreground/70">{sessionTarget}</span>
              </div>
              {/* Prompt */}
              <div className="px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground/60">Prompt</span>
                <p className="mt-1 whitespace-pre-wrap rounded bg-muted/60 p-2 text-[11px] leading-5 text-foreground/60">{message}</p>
              </div>
              {/* Model */}
              {model && (
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[10px] text-muted-foreground/60">Model Override</span>
                  <span className="text-[12px] font-mono text-violet-400">{model}</span>
                </div>
              )}
              {/* Delivery */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground/60">Delivery</span>
                <span className="text-[12px] text-foreground/70">
                  {deliveryMode === "none" ? (
                    "No delivery"
                  ) : (
                    <>
                      {channel || "auto"} → {to || <span className="text-amber-400">not set</span>}
                    </>
                  )}
                </span>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/15 bg-red-500/[0.06] px-3 py-2.5">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                <p className="text-[11px] text-red-300">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Navigation ── */}
        <div className="flex items-center gap-2 pt-2 border-t border-foreground/[0.04]">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="rounded px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground/70"
            >
              ← Back
            </button>
          )}
          <div className="flex-1" />
          {step < totalSteps ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={!canAdvance()}
              className="flex items-center gap-1 rounded bg-violet-600 px-4 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="flex items-center gap-1 rounded bg-emerald-600 px-4 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Creating...
                </>
              ) : (
                <>
                  <Check className="h-3 w-3" /> Create Cron Job
                </>
              )}
            </button>
          )}
        </div>
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
  const [showCreate, setShowCreate] = useState(false);
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
    queueMicrotask(() => fetchJobs());
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
        queueMicrotask(() => setExpanded(firstError.id));
        if (!runs[firstError.id]) {
          queueMicrotask(() => fetchRuns(firstError.id));
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
          // Config-changing actions should prompt a restart
          if (["edit", "enable", "disable", "delete"].includes(action)) {
            requestRestart("Cron job configuration was updated.");
          }
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
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading cron jobs...
      </div>
    );
  }

  const errorJobs = jobs.filter((j) => j.state.lastStatus === "error");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 md:px-6 pb-4 pt-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Cron Jobs ({jobs.length})
          </h2>
          <p className="text-[11px] text-muted-foreground/60">
            Schedule, delivery, run history &bull; Edit schedule, content,
            delivery targets
            {errorJobs.length > 0 && (
              <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                {errorJobs.length} failing
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-500"
          >
            <Plus className="h-3 w-3" /> New Cron Job
          </button>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchJobs();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/80"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 md:px-6 pb-6">
        {/* Create form */}
        {showCreate && (
          <CreateCronForm
            onCreated={() => {
              setShowCreate(false);
              flash("Cron job created!");
              fetchJobs();
              requestRestart("New cron job was created.");
            }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* Empty state */}
        {jobs.length === 0 && !showCreate && (
          <div className="flex flex-col items-center justify-center py-16">
            <Calendar className="mx-auto h-10 w-10 text-zinc-700 mb-3" />
            <p className="text-sm text-muted-foreground/60 mb-1">No cron jobs yet</p>
            <p className="text-[11px] text-muted-foreground/40 mb-4">Create your first scheduled task to get started.</p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
            >
              <Plus className="h-4 w-4" /> Create Cron Job
            </button>
          </div>
        )}

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
                "rounded-xl border bg-card/90 transition-colors",
                hasError
                  ? "border-red-500/20"
                  : "border-foreground/[0.06]",
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
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
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
                    <p className="text-[13px] font-medium text-foreground/90">
                      {job.name}
                    </p>
                    {!job.enabled && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground/60">
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
                  <p className="text-[10px] text-muted-foreground/60">
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
                        : "text-muted-foreground/60 hover:bg-muted"
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
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-blue-500/15 hover:text-blue-400 disabled:opacity-50"
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
                        : "text-muted-foreground/60 hover:bg-muted hover:text-foreground/70"
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
                            <code className="rounded bg-muted px-1 text-amber-400">
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
                <div className="border-t border-foreground/[0.04] px-4 py-4 space-y-4">
                  {/* ── Job Configuration ──── */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Info className="h-3 w-3" />
                      Job Configuration
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 md:gap-x-6 gap-y-2 rounded-lg border border-foreground/[0.04] bg-muted/40 px-3 py-3 text-[11px]">
                      <div className="flex items-center gap-2">
                        <Hash className="h-3 w-3 text-muted-foreground/40" />
                        <span className="text-muted-foreground/60">Job ID</span>
                        <code className="ml-auto font-mono text-[10px] text-muted-foreground">
                          {job.id}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <Globe className="h-3 w-3 text-muted-foreground/40" />
                        <span className="text-muted-foreground/60">Agent</span>
                        <span className="ml-auto text-muted-foreground">
                          {job.agentId}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3 text-muted-foreground/40" />
                        <span className="text-muted-foreground/60">Schedule</span>
                        <span className="ml-auto font-mono text-muted-foreground">
                          {scheduleDisplay(job.schedule)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-muted-foreground/40" />
                        <span className="text-muted-foreground/60">Session</span>
                        <span className="ml-auto text-muted-foreground">
                          {job.sessionTarget || "default"}
                          {job.wakeMode && ` · wake: ${job.wakeMode}`}
                        </span>
                      </div>
                      {job.payload.model && (
                        <div className="flex items-center gap-2">
                          <Cpu className="h-3 w-3 text-muted-foreground/40" />
                          <span className="text-muted-foreground/60">Model</span>
                          <span className="ml-auto font-mono text-[10px] text-violet-400">
                            {job.payload.model}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <FileText className="h-3 w-3 text-muted-foreground/40" />
                        <span className="text-muted-foreground/60">Created</span>
                        <span className="ml-auto text-muted-foreground">
                          {fmtDate(job.createdAtMs)}
                        </span>
                      </div>
                      {job.updatedAtMs && (
                        <div className="flex items-center gap-2">
                          <FileText className="h-3 w-3 text-muted-foreground/40" />
                          <span className="text-muted-foreground/60">Updated</span>
                          <span className="ml-auto text-muted-foreground">
                            {fmtDate(job.updatedAtMs)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Delivery Config ─────── */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Send className="h-3 w-3" />
                      Delivery
                    </h3>
                    <div
                      className={cn(
                        "rounded-lg border px-3 py-3 text-[11px]",
                        delivery.hasIssue
                          ? "border-amber-500/20 bg-amber-500/[0.04]"
                          : "border-foreground/[0.04] bg-muted/40"
                      )}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <span className="text-muted-foreground/60">Mode</span>
                          <p className="mt-0.5 font-medium text-foreground/70">
                            {job.delivery.mode || "none"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground/60">Channel</span>
                          <p className="mt-0.5 text-foreground/70">
                            {job.delivery.channel || "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground/60">To (recipient)</span>
                          <p
                            className={cn(
                              "mt-0.5 font-mono",
                              job.delivery.to
                                ? "text-foreground/70"
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
                    <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Timer className="h-3 w-3" />
                      Execution Status
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-lg border border-foreground/[0.04] bg-muted/40 px-3 py-2 text-center">
                        <p className="text-[10px] text-muted-foreground/60">Last Run</p>
                        <p className="mt-0.5 text-[12px] font-medium text-foreground/70">
                          {fmtAgo(st.lastRunAtMs)}
                        </p>
                        <p className="text-[9px] text-muted-foreground/40">
                          {fmtDate(st.lastRunAtMs)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-foreground/[0.04] bg-muted/40 px-3 py-2 text-center">
                        <p className="text-[10px] text-muted-foreground/60">Next Run</p>
                        <p className="mt-0.5 text-[12px] font-medium text-foreground/70">
                          {fmtAgo(st.nextRunAtMs)}
                        </p>
                        <p className="text-[9px] text-muted-foreground/40">
                          {fmtDate(st.nextRunAtMs)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-foreground/[0.04] bg-muted/40 px-3 py-2 text-center">
                        <p className="text-[10px] text-muted-foreground/60">Duration</p>
                        <p className="mt-0.5 text-[12px] font-medium text-foreground/70">
                          {fmtDuration(st.lastDurationMs)}
                        </p>
                      </div>
                      <div
                        className={cn(
                          "rounded-lg border px-3 py-2 text-center",
                          hasError
                            ? "border-red-500/15 bg-red-500/[0.04]"
                            : "border-foreground/[0.04] bg-muted/40"
                        )}
                      >
                        <p className="text-[10px] text-muted-foreground/60">Status</p>
                        <p
                          className={cn(
                            "mt-0.5 text-[12px] font-medium",
                            hasError
                              ? "text-red-400"
                              : st.lastStatus === "ok"
                                ? "text-emerald-400"
                                : "text-muted-foreground"
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
                      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        Prompt
                      </h3>
                      <pre className="max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-foreground/[0.04] bg-muted/40 p-3 text-[11px] leading-5 text-muted-foreground">
                        {job.payload.message}
                      </pre>
                    </div>
                  )}

                  {/* ── Run History ─────────── */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Run History
                      </h3>
                      <button
                        type="button"
                        onClick={() => fetchRuns(job.id)}
                        disabled={runsLoading === job.id}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
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
                      <div className="flex items-center gap-2 py-4 text-[11px] text-muted-foreground/60">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading runs...
                      </div>
                    ) : jobRuns.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/60">
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
