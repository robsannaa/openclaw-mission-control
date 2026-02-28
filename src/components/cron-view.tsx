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
  Send,
  Cpu,
  Calendar,
  Globe,
  Hash,
  FileText,
  Timer,
  AlertTriangle,
  Info,
  Plus,
  Terminal,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { requestRestart } from "@/lib/restart-store";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { InlineSpinner, LoadingState } from "@/components/ui/loading-state";
import {
  getTimeFormatSnapshot,
  is12HourTimeFormat,
  withTimeFormat,
  type TimeFormatPreference,
} from "@/lib/time-format-preference";

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

type RunOutputState = {
  status: "running" | "done" | "error";
  output: string;
  runStartedAtMs: number;
};

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
  const timeFormat = getTimeFormatSnapshot();
  return new Date(ms).toLocaleString(
    "en-US",
    withTimeFormat(
      {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      },
      timeFormat,
    ),
  );
}

function fmtFullDate(ms: number | undefined): string {
  if (!ms) return "—";
  const timeFormat = getTimeFormatSnapshot();
  return new Date(ms).toLocaleString(
    "en-US",
    withTimeFormat(
      {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      },
      timeFormat,
    ),
  );
}

/** Turn a cron expression into a short human-readable phrase (e.g. "Every 6 hours", "Daily at 8:00 AM"). */
function cronToHuman(expr: string): string {
  const timeFormat = getTimeFormatSnapshot();
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, day, month, dow] = parts;
  const formatClock = (hour24: number, minute: number): string => {
    if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return `${hour24}:${minute}`;
    if (!is12HourTimeFormat(timeFormat)) {
      return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    const suffix = hour24 < 12 ? "AM" : "PM";
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
  };
  // Every N minutes: */N * * * *
  if (min.startsWith("*/") && hour === "*" && day === "*" && month === "*" && dow === "*") {
    const n = min.slice(2);
    if (/^\d+$/.test(n)) return `Every ${n} minutes`;
  }
  // Every N hours: 0 */N * * *
  if (min === "0" && hour.startsWith("*/") && day === "*" && month === "*" && dow === "*") {
    const n = hour.slice(2);
    if (/^\d+$/.test(n)) return n === "1" ? "Every hour" : `Every ${n} hours`;
  }
  // Every hour: 0 * * * *
  if (min === "0" && hour === "*" && day === "*" && month === "*" && dow === "*")
    return "Every hour";
  // Daily at H:M
  if (min !== "*" && !min.includes("/") && !min.includes(",") && hour !== "*" && !hour.includes("/") && !hour.includes(",") && day === "*" && month === "*" && dow === "*") {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    return `Daily at ${formatClock(h, m)}`;
  }
  // Twice a day: 0 8,20 * * *
  if (min === "0" && /^\d+,\d+$/.test(hour) && day === "*" && month === "*" && dow === "*") {
    const [h1, h2] = hour.split(",").map((x) => parseInt(x, 10));
    return `Twice a day (${formatClock(h1, 0)} & ${formatClock(h2, 0)})`;
  }
  // Weekdays at noon: 0 12 * * 1-5
  if (min === "0" && hour === "12" && day === "*" && month === "*" && dow === "1-5")
    return is12HourTimeFormat(timeFormat) ? "Weekdays at noon" : "Weekdays at 12:00";
  // Weekdays at H
  if (min === "0" && day === "*" && month === "*" && dow === "1-5") {
    const h = parseInt(hour, 10);
    return `Weekdays at ${formatClock(h, 0)}`;
  }
  // Specific weekday: 0 9 * * 1 = Monday at 9am
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (min === "0" && day === "*" && month === "*" && /^\d+$/.test(dow)) {
    const d = parseInt(dow, 10);
    const h = parseInt(hour, 10);
    if (d >= 0 && d <= 6) return `Every ${dayNames[d]} at ${formatClock(h, 0)}`;
  }
  return expr;
}

function scheduleDisplay(s: CronJob["schedule"]): string {
  if (s.kind === "cron" && s.expr) {
    const human = cronToHuman(s.expr);
    return human !== s.expr ? `${human}${s.tz ? ` (${s.tz})` : ""}` : `${s.expr}${s.tz ? ` (${s.tz})` : ""}`;
  }
  if (s.kind === "every" && s.everyMs) {
    const mins = Math.round(s.everyMs / 60000);
    return mins < 60 ? `Every ${mins}m` : `Every ${Math.round(mins / 60)}h`;
  }
  return "Unknown";
}

function scheduleOptionLabel(opt: ScheduleOption, timeFormat: TimeFormatPreference): string {
  if (opt.kind === "cron" && "expr" in opt) {
    const human = cronToHuman(opt.expr);
    if (human !== opt.expr) return human;
  }
  if (!is12HourTimeFormat(timeFormat)) {
    if (opt.id === "daily-8am") return "Every day at 08:00";
    if (opt.id === "daily-6pm") return "Every day at 18:00";
    if (opt.id === "monday-9am") return "Every Monday at 09:00";
    if (opt.id === "twice-day") return "Twice a day (08:00 & 20:00)";
  }
  return opt.label;
}

const SESSION_OUTPUT_MARKER = "--- Session output ---";

function splitSessionOutput(output: string): { prefix: string; session: string } {
  const idx = output.indexOf(SESSION_OUTPUT_MARKER);
  if (idx === -1) {
    return { prefix: output.trimEnd(), session: "" };
  }
  return {
    prefix: output.slice(0, idx).trimEnd(),
    session: output.slice(idx + SESSION_OUTPUT_MARKER.length).trim(),
  };
}

function mergeSessionOutput(existing: string, incoming: string): string {
  const nextSession = incoming.trim();
  if (!nextSession) return existing;

  const { prefix, session: currentSession } = splitSessionOutput(existing);
  const basePrefix = prefix ? `${prefix}\n\n` : "";

  if (!currentSession) {
    return `${basePrefix}${SESSION_OUTPUT_MARKER}\n\n${nextSession}`;
  }
  if (currentSession === nextSession || currentSession.includes(nextSession)) {
    return existing;
  }
  if (nextSession.startsWith(currentSession)) {
    const delta = nextSession.slice(currentSession.length);
    if (!delta) return existing;
    return `${existing}${delta}`;
  }

  // Session output changed shape; replace the session segment with latest text.
  return `${basePrefix}${SESSION_OUTPUT_MARKER}\n\n${nextSession}`;
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

type FailureGuide = {
  headline: string;
  explanation: string;
  steps: string[];
};

function buildFailureGuide(error: string, delivery: CronJob["delivery"]): FailureGuide {
  const raw = String(error || "").trim();
  const lower = raw.toLowerCase();
  const channelHint = delivery.channel
    ? `Set recipient in Delivery for the ${delivery.channel} channel.`
    : "Set a delivery channel and recipient in the Delivery section.";

  if (
    lower.includes("delivery target is missing") ||
    (lower.includes("delivery") && lower.includes("missing") && lower.includes("target"))
  ) {
    return {
      headline: "Delivery destination is missing",
      explanation:
        "The job ran, but it had nowhere to send the result. This is a setup issue, not a system crash.",
      steps: [
        "Open job settings.",
        channelHint,
        "Save changes and run the job once to confirm.",
      ],
    };
  }

  if (
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("invalid api key") ||
    lower.includes("api key") ||
    lower.includes("authentication failed")
  ) {
    return {
      headline: "Provider authentication failed",
      explanation:
        "This job could not access the model provider because credentials are missing, expired, or invalid.",
      steps: [
        "Open Models or Accounts/Keys and reconnect the provider.",
        "Check that the selected model is available for your account.",
        "Run the cron job again after updating credentials.",
      ],
    };
  }

  if (
    lower.includes("model") &&
    (lower.includes("not found") ||
      lower.includes("unknown") ||
      lower.includes("invalid") ||
      lower.includes("unavailable"))
  ) {
    return {
      headline: "Selected model is unavailable",
      explanation:
        "The configured model could not be resolved at runtime, so the job stopped before completion.",
      steps: [
        "Edit this job and choose a valid model override, or clear the override.",
        "Confirm the model exists in the Models page.",
        "Run once manually to validate.",
      ],
    };
  }

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return {
      headline: "The job timed out",
      explanation:
        "The run took longer than the allowed execution window and was canceled automatically.",
      steps: [
        "Shorten the prompt to reduce runtime.",
        "Try a faster model for this cron job.",
        "Run once manually and check output duration.",
      ],
    };
  }

  if (
    lower.includes("econnrefused") ||
    lower.includes("connection refused") ||
    lower.includes("network") ||
    lower.includes("dns") ||
    lower.includes("host not found")
  ) {
    return {
      headline: "Connection to a required service failed",
      explanation:
        "The job could not reach a provider or local service while running.",
      steps: [
        "Check internet/local network connectivity.",
        "If using local models, verify the local model service is running.",
        "Retry once services are reachable.",
      ],
    };
  }

  return {
    headline: "The run failed",
    explanation:
      "Mission Control received an error from OpenClaw while executing this job.",
    steps: [
      "Open job settings and confirm schedule, model, and delivery fields.",
      "Run the job once manually to verify behavior.",
      "If this keeps failing, use Technical details below when reporting the issue.",
    ],
  };
}

/* ── Run detail card ──────────────────────────────── */

function RunCard({ run }: { run: RunEntry }) {
  const [showFull, setShowFull] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-xs",
        run.status === "error"
          ? "border-red-500/15 bg-red-500/5"
          : "border-foreground/5 bg-muted/40"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        {run.status === "ok" ? (
          <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
        )}
        <span className="font-medium text-foreground/90">
          {fmtFullDate(run.ts)}
        </span>
        <span className="text-muted-foreground/80">·</span>
        <span className="text-muted-foreground/85">{fmtDuration(run.durationMs)}</span>
        {run.sessionId && (
          <>
            <span className="text-muted-foreground/80">·</span>
            <span className="font-mono text-xs text-muted-foreground/75">
              {run.sessionId.substring(0, 8)}
            </span>
          </>
        )}
        <div className="flex-1" />
        {(run.summary || run.error || run.sessionKey) && (
          <button
            type="button"
            onClick={() => setShowFull(!showFull)}
            className="text-xs text-muted-foreground/80 transition-colors hover:text-foreground/85"
          >
            {showFull ? "Collapse" : "Details"}
          </button>
        )}
      </div>

      {/* Error */}
      {run.error && (
        <div className="mt-2 flex items-start gap-1.5 rounded bg-red-500/10 px-2.5 py-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-600 dark:text-red-300" />
          <p className="text-red-700 dark:text-red-200">{run.error}</p>
        </div>
      )}

      {/* Summary preview (collapsed) */}
      {!showFull && run.summary && (
        <p className="mt-1.5 line-clamp-2 leading-5 text-muted-foreground/85">
          {run.summary.replace(/[*#|_`]/g, "").substring(0, 200)}
        </p>
      )}

      {/* Full details (expanded) */}
      {showFull && (
        <div className="mt-2 space-y-2">
          {run.summary && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
                Summary
              </p>
              <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-foreground/10 bg-background/70 p-3 leading-5 text-foreground/90">
                {run.summary}
              </pre>
            </div>
          )}
          {run.sessionKey && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground/80">Session:</span>
              <code className="rounded bg-background/70 px-2 py-0.5 font-mono text-xs text-foreground/85">
                {run.sessionKey}
              </code>
            </div>
          )}
          {run.runAtMs && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/80">
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

function FailureGuideCard({
  error,
  delivery,
  consecutiveErrors,
  onFix,
  compact = false,
}: {
  error: string;
  delivery: CronJob["delivery"];
  consecutiveErrors?: number;
  onFix: () => void;
  compact?: boolean;
}) {
  const guide = buildFailureGuide(error, delivery);
  const steps = compact ? guide.steps.slice(0, 2) : guide.steps;

  return (
    <div className="rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-300" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-red-700 dark:text-red-200">
            Last run failed
            {consecutiveErrors && consecutiveErrors > 1
              ? ` (${consecutiveErrors} consecutive)`
              : ""}
          </p>
          <p className="mt-1 text-xs font-medium text-red-700/90 dark:text-red-200/95">
            {guide.headline}
          </p>
          <p className="mt-1 text-xs leading-5 text-red-700/80 dark:text-red-100/90">
            {guide.explanation}
          </p>
          <div className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700/80 dark:text-red-200/90">
              What to do
            </p>
            <ol className="mt-1 space-y-1 text-xs text-red-700/85 dark:text-red-100/90">
              {steps.map((step, index) => (
                <li key={`${step}-${index}`}>{index + 1}. {step}</li>
              ))}
            </ol>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onFix}
              className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500"
            >
              Open job settings
            </button>
            <details className="text-xs">
              <summary className="cursor-pointer text-red-700/80 hover:text-red-700 dark:text-red-200/90 dark:hover:text-red-100">
                Technical details
              </summary>
              <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-red-700/80 dark:text-red-100/90">
                {error}
              </pre>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Known delivery target type ───────────────────── */
type KnownTarget = { target: string; channel: string; source: string };
type ChannelInfo = {
  channel: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  setupType: "qr" | "token" | "cli" | "auto";
  statuses: { connected?: boolean; linked?: boolean; error?: string }[];
};

const CHANNEL_PLACEHOLDER: Record<string, string> = {
  telegram: "telegram:CHAT_ID",
  discord: "discord:CHANNEL_ID",
  whatsapp: "+15555550123",
  slack: "slack:CHANNEL_ID",
  signal: "+15555550123",
  webchat: "webchat:ROOM_ID",
  web: "web:ROOM_ID",
};

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
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);

  const [confirmDel, setConfirmDel] = useState(false);

  const fetchTargets = useCallback(async () => {
    setTargetsLoading(true);
    try {
      const [targetsRes, channelsRes] = await Promise.all([
        fetch("/api/cron?action=targets", { cache: "no-store" }),
        fetch("/api/channels?scope=all", { cache: "no-store" }),
      ]);
      const targetsData = await targetsRes.json();
      const channelsData = await channelsRes.json();
      setKnownTargets(targetsData.targets || []);
      setChannels((channelsData.channels || []) as ChannelInfo[]);
    } catch {
      /* ignore */
    }
    setTargetsLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchTargets();
    });
  }, [fetchTargets]);

  const targetChannel = useCallback((t: string) => {
    if (t.startsWith("telegram:")) return "telegram";
    if (t.startsWith("discord:")) return "discord";
    if (t.startsWith("+")) return "whatsapp";
    return "";
  }, []);

  // When channel changes, show dropdown again; clear to only if it was for a different channel
  useEffect(() => {
    if (!channel) return;
    queueMicrotask(() => {
      setCustomTo(false);
      if (to && targetChannel(to) !== channel) setTo("");
    });
  }, [channel, to, targetChannel]);

  const readyChannels = useMemo(() => {
    return channels.filter((ch) => {
      if (ch.setupType === "auto") return true;
      if (!ch.enabled && !ch.configured) return false;
      if (ch.enabled) {
        if (ch.statuses.some((s) => s.connected || s.linked)) return true;
        if (ch.statuses.some((s) => s.error)) return false;
      }
      return ch.configured || ch.enabled;
    });
  }, [channels]);
  const readyChannelKeys = useMemo(
    () => new Set(readyChannels.map((c) => c.channel)),
    [readyChannels]
  );

  // Filter targets by selected channel
  const filteredTargets = useMemo(() => {
    const base = knownTargets.filter(
      (t) => !t.channel || readyChannelKeys.has(t.channel)
    );
    if (!channel) return base;
    return base.filter((t) => t.channel === channel || !t.channel);
  }, [knownTargets, channel, readyChannelKeys]);

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
    <div className="border-t border-foreground/10 bg-card/70 px-4 py-4 space-y-4">
      {/* Name */}
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-sm text-foreground/90 outline-none focus:border-violet-500/30"
        />
      </div>

      {/* Prompt / Message */}
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
          Prompt / Message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs leading-5 text-foreground/90 outline-none focus:border-violet-500/30"
        />
      </div>

      {/* Schedule */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
            Schedule Type
          </label>
          <select
            value={schedType}
            onChange={(e) => setSchedType(e.target.value)}
            className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none"
          >
            <option value="cron">Cron Expression</option>
            <option value="every">Interval</option>
          </select>
        </div>
        <div>
          {schedType === "cron" ? (
            <>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
                Cron Expression
              </label>
              <input
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 8 * * *"
                className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
              />
            </>
          ) : (
            <>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
                Interval
              </label>
              <input
                value={everyVal}
                onChange={(e) => setEveryVal(e.target.value)}
                placeholder="5m, 1h, 30s"
                className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
              />
            </>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
            Timezone
          </label>
          <input
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="Europe/Warsaw"
            className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30"
          />
        </div>
      </div>

      {/* Delivery */}
      <div>
        <label className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
          <Send className="h-3 w-3" />
          Delivery Configuration
        </label>
        <div className="rounded-lg border border-foreground/10 bg-muted/50 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Mode
              </label>
              <select
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value)}
                className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none"
              >
                <option value="announce">Announce (send summary)</option>
                <option value="none">No delivery</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Channel
              </label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                disabled={deliveryMode === "none"}
                className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none disabled:opacity-40"
              >
                <option value="">Select channel</option>
                {readyChannels.map((ch) => (
                  <option key={ch.channel} value={ch.channel}>
                    {ch.label || ch.channel}
                  </option>
                ))}
                {channel && !readyChannelKeys.has(channel) && (
                  <option value={channel}>
                    {channel} (currently unavailable)
                  </option>
                )}
              </select>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-xs text-muted-foreground">
                  To (recipient)
                </label>
                {deliveryMode !== "none" && channel && (
                  <button
                    type="button"
                    onClick={() => fetchTargets()}
                    disabled={targetsLoading}
                    className="shrink-0 text-xs text-violet-700 hover:text-violet-800 disabled:opacity-50 dark:text-violet-300 dark:hover:text-violet-200"
                  >
                    {targetsLoading ? "Refreshing…" : "Refresh targets"}
                  </button>
                )}
              </div>
              {deliveryMode === "none" ? (
                <input
                  disabled
                  value=""
                  placeholder="—"
                  className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none disabled:opacity-40"
                />
              ) : targetsLoading && knownTargets.length === 0 ? (
                <div className="flex h-9 items-center rounded-lg border border-foreground/10 bg-muted/80 px-3">
                  <InlineSpinner size="sm" />
                  <span className="ml-2 text-xs text-muted-foreground/70">
                    Loading targets…
                  </span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <select
                    value={customTo ? "__custom__" : to}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__custom__") {
                        setCustomTo(true);
                      } else {
                        setCustomTo(false);
                        setTo(v);
                      }
                    }}
                    className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                  >
                    <option value="">Select recipient…</option>
                    {filteredTargets.map((t) => (
                      <option key={t.target} value={t.target}>
                        {t.target} ({t.source})
                      </option>
                    ))}
                    <option value="__custom__">
                      {channel
                        ? `Enter ${channel} ID manually…`
                        : "Enter channel ID manually…"}
                    </option>
                  </select>
                  {customTo && (
                    <input
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      placeholder={CHANNEL_PLACEHOLDER[channel] || "channel:TARGET_ID"}
                      className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                      aria-label="Recipient (e.g. discord:CHANNEL_ID)"
                    />
                  )}
                  {!customTo && to && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      <CheckCircle className="mr-1 inline h-2.5 w-2.5" />
                      Target set: <code className="text-emerald-700 dark:text-emerald-300">{to}</code>
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Warning for missing target */}
          {deliveryIssue && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div>
                <p className="text-xs font-medium text-amber-700 dark:text-amber-200">
                  Missing delivery target
                </p>
                <p className="text-xs text-amber-700/80 dark:text-amber-100/90">
                  {deliveryIssue}
                </p>
              </div>
            </div>
          )}

          {customTo && (
            <p className="text-xs text-muted-foreground/70">
              Format: <code className="text-muted-foreground/80">telegram:CHAT_ID</code>,{" "}
              <code className="text-muted-foreground/80">+15555550123</code> (WhatsApp),{" "}
              <code className="text-muted-foreground/80">discord:CHANNEL_ID</code>
            </p>
          )}
        </div>
      </div>

      {/* Model override */}
      <div>
        <label className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
          <Cpu className="h-3 w-3" />
          Model Override
          <span className="font-normal normal-case text-muted-foreground/70">
            (optional — leave blank for default)
          </span>
        </label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. minimax-portal/MiniMax-M2.5"
          className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {confirmDel ? (
          <>
            <button
              type="button"
              onClick={onDelete}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
            >
              Confirm Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDel(false)}
              className="text-xs text-muted-foreground hover:text-foreground/90"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            className="flex items-center gap-1 rounded p-1.5 text-muted-foreground/80 hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground/90"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-1 rounded bg-primary text-primary-foreground px-4 py-1.5 text-xs font-medium hover:bg-primary/90"
        >
          <Check className="h-3 w-3" /> Save Changes
        </button>
      </div>
    </div>
  );
}

/* ── Schedule options: friendly labels + cron/interval ──────────────── */

type ScheduleOption =
  | { id: string; label: string; kind: "cron"; expr: string }
  | { id: string; label: string; kind: "every"; interval: string }
  | { id: string; label: string; kind: "at" }
  | { id: string; label: string; kind: "custom" };

const SCHEDULE_SIMPLE_OPTIONS: ScheduleOption[] = [
  { id: "daily-8am", label: "Every day at 8:00 AM", kind: "cron", expr: "0 8 * * *" },
  { id: "daily-6pm", label: "Every day at 6:00 PM", kind: "cron", expr: "0 18 * * *" },
  { id: "monday-9am", label: "Every Monday at 9:00 AM", kind: "cron", expr: "0 9 * * 1" },
  { id: "weekdays-noon", label: "Weekdays at noon", kind: "cron", expr: "0 12 * * 1-5" },
  { id: "twice-day", label: "Twice a day (8am & 8pm)", kind: "cron", expr: "0 8,20 * * *" },
  { id: "every-hour", label: "Every hour", kind: "every", interval: "1h" },
  { id: "every-6h", label: "Every 6 hours", kind: "cron", expr: "0 */6 * * *" },
  { id: "every-12h", label: "Every 12 hours", kind: "cron", expr: "0 */12 * * *" },
  { id: "every-30m", label: "Every 30 minutes", kind: "every", interval: "30m" },
  { id: "every-5m", label: "Every 5 minutes", kind: "every", interval: "5m" },
  { id: "at", label: "Run once at a specific time", kind: "at" },
  { id: "custom", label: "Custom schedule (advanced)", kind: "custom" },
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
  const timeFormat = getTimeFormatSnapshot();
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
  /** Which simple schedule option is selected (id from SCHEDULE_SIMPLE_OPTIONS); "custom" shows advanced form. */
  const [simpleScheduleOption, setSimpleScheduleOption] = useState<string>("daily-8am");
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
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTargetsCreate = useCallback(async () => {
    setTargetsLoading(true);
    try {
      const [targetsRes, channelsRes] = await Promise.all([
        fetch("/api/cron?action=targets", { cache: "no-store" }),
        fetch("/api/channels?scope=all", { cache: "no-store" }),
      ]);
      const targetsData = await targetsRes.json();
      const channelsData = await channelsRes.json();
      setKnownTargets(targetsData.targets || []);
      setChannels((channelsData.channels || []) as ChannelInfo[]);
    } catch { /* ignore */ }
    setTargetsLoading(false);
  }, []);

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
    void fetchTargetsCreate();
  }, [fetchTargetsCreate]);

  const targetChannelCreate = useCallback((t: string) => {
    if (t.startsWith("telegram:")) return "telegram";
    if (t.startsWith("discord:")) return "discord";
    if (t.startsWith("+")) return "whatsapp";
    return "";
  }, []);

  useEffect(() => {
    if (!channel) return;
    queueMicrotask(() => {
      setCustomTo(false);
      if (to && targetChannelCreate(to) !== channel) setTo("");
    });
  }, [channel, to, targetChannelCreate]);

  const readyChannels = useMemo(() => {
    return channels.filter((ch) => {
      if (ch.setupType === "auto") return true;
      if (!ch.enabled && !ch.configured) return false;
      if (ch.enabled) {
        if (ch.statuses.some((s) => s.connected || s.linked)) return true;
        if (ch.statuses.some((s) => s.error)) return false;
      }
      return ch.configured || ch.enabled;
    });
  }, [channels]);
  const readyChannelKeys = useMemo(
    () => new Set(readyChannels.map((c) => c.channel)),
    [readyChannels]
  );

  // Filter targets by selected channel
  const filteredTargets = useMemo(() => {
    const base = knownTargets.filter(
      (t) => !t.channel || readyChannelKeys.has(t.channel)
    );
    if (!channel) return base;
    return base.filter((t) => t.channel === channel || !t.channel);
  }, [knownTargets, channel, readyChannelKeys]);

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
      <div className="flex items-center justify-between border-b border-foreground/10 bg-violet-500/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <h3 className="text-sm font-semibold text-foreground">New Cron Job</h3>
        </div>
        <div className="flex items-center gap-3">
          {/* Step indicator */}
          <div className="flex items-center gap-1">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i + 1 === step ? "w-4 bg-primary" : i + 1 < step ? "w-1.5 bg-primary/60" : "w-1.5 bg-foreground/10"
                )}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground/80">Step {step}/{totalSteps}</span>
          <button type="button" onClick={onCancel} className="rounded p-1 text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground/90">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* ── Step 1: Basics ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-medium text-foreground/80 mb-1">What should we call this job?</h4>
              <p className="text-xs text-muted-foreground/80 mb-3">Give it a descriptive name so you can easily find it later.</p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Morning Brief, Daily Sync, Weekly Report..."
                className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2.5 text-sm text-foreground/90 outline-none focus:border-violet-500/30"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
                Description <span className="font-normal normal-case">(optional)</span>
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of what this job does..."
                className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Agent</label>
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none"
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
              <h4 className="text-xs font-medium text-foreground/80 mb-1">How often should it run?</h4>
              <p className="text-xs text-muted-foreground/80 mb-3">Choose a schedule below. Timezone applies to daily/weekly times.</p>
            </div>

            {/* Friendly schedule options (cards) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
              {SCHEDULE_SIMPLE_OPTIONS.map((opt) => {
                const isSelected = simpleScheduleOption === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setSimpleScheduleOption(opt.id);
                      if (opt.kind === "cron" && "expr" in opt) {
                        setScheduleKind("cron");
                        setCronExpr(opt.expr);
                      } else if (opt.kind === "every" && "interval" in opt) {
                        setScheduleKind("every");
                        setEveryInterval(opt.interval);
                      } else if (opt.kind === "at") {
                        setScheduleKind("at");
                      }
                      // "custom" leaves kind/expr/interval as-is and shows advanced form
                    }}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left text-xs transition-colors",
                      isSelected
                        ? "border-violet-500/40 bg-violet-500/15 text-violet-800 dark:text-violet-200"
                        : "border-foreground/10 bg-muted/50 text-muted-foreground/80 hover:bg-muted/80 hover:text-foreground/80"
                    )}
                  >
                    {scheduleOptionLabel(opt, timeFormat)}
                  </button>
                );
              })}
            </div>

            {/* Run once: show datetime picker */}
            {simpleScheduleOption === "at" && (
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Run at</label>
                <input
                  type="datetime-local"
                  value={atTime}
                  onChange={(e) => setAtTime(e.target.value)}
                  className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                />
              </div>
            )}

            {/* Custom: show type + cron/interval input */}
            {simpleScheduleOption === "custom" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-foreground/10 bg-muted/30 p-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Type</label>
                  <select
                    value={scheduleKind}
                    onChange={(e) => setScheduleKind(e.target.value as "cron" | "every" | "at")}
                    className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none"
                  >
                    <option value="cron">Cron expression</option>
                    <option value="every">Every X (interval)</option>
                    <option value="at">One-shot (run once)</option>
                  </select>
                </div>
                <div>
                  {scheduleKind === "cron" && (
                    <>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Cron</label>
                      <input
                        value={cronExpr}
                        onChange={(e) => setCronExpr(e.target.value)}
                        placeholder="0 8 * * *"
                        className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                      />
                    </>
                  )}
                  {scheduleKind === "every" && (
                    <>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Interval</label>
                      <input
                        value={everyInterval}
                        onChange={(e) => setEveryInterval(e.target.value)}
                        placeholder="5m, 1h"
                        className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                      />
                    </>
                  )}
                  {scheduleKind === "at" && (
                    <>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Run at</label>
                      <input
                        type="datetime-local"
                        value={atTime}
                        onChange={(e) => setAtTime(e.target.value)}
                        className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none"
                      />
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Timezone (always) */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Timezone</label>
              <select
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none"
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
        )}

        {/* ── Step 3: Payload ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-medium text-foreground/80 mb-1">What should the agent do?</h4>
              <p className="text-xs text-muted-foreground/80 mb-3">Write a prompt for the agent. Be specific about what you want.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Payload Type</label>
                <select
                  value={payloadKind}
                  onChange={(e) => setPayloadKind(e.target.value as "agentTurn" | "systemEvent")}
                  className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none"
                >
                  <option value="agentTurn">Agent Turn (isolated task)</option>
                  <option value="systemEvent">System Event (main session)</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {payloadKind === "agentTurn"
                    ? "Runs in an isolated session — best for tasks with delivery"
                    : "Runs in the main session — best for internal updates"}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Session</label>
                <select
                  value={sessionTarget}
                  onChange={(e) => setSessionTarget(e.target.value as "main" | "isolated")}
                  disabled={payloadKind === "systemEvent"}
                  className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none disabled:opacity-40"
                >
                  <option value="isolated">Isolated (recommended)</option>
                  <option value="main">Main</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
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
                className="w-full resize-y rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2.5 text-xs leading-5 text-foreground/90 outline-none focus:border-violet-500/30"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
                  <Cpu className="h-3 w-3" />
                  Model Override <span className="font-normal normal-case">(optional)</span>
                </label>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Leave blank for default model"
                  className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
                  Thinking Level <span className="font-normal normal-case">(optional)</span>
                </label>
                <select
                  value={thinking}
                  onChange={(e) => setThinking(e.target.value)}
                  className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none"
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
              <h4 className="text-xs font-medium text-foreground/80 mb-1">Where should results be delivered?</h4>
              <p className="text-xs text-muted-foreground/80 mb-3">
                {sessionTarget === "isolated"
                  ? "Isolated jobs can announce results to a messaging channel."
                  : "Main session jobs usually don't need delivery. You can skip this step."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Mode</label>
                <select
                  value={deliveryMode}
                  onChange={(e) => setDeliveryMode(e.target.value as "announce" | "none")}
                  className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none"
                >
                  <option value="announce">Announce (send summary)</option>
                  <option value="none">No delivery</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">Channel</label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  disabled={deliveryMode === "none"}
                  className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 text-xs text-foreground/90 outline-none disabled:opacity-40"
                >
                  <option value="">Auto-detect</option>
                  {readyChannels.map((ch) => (
                    <option key={ch.channel} value={ch.channel}>
                      {ch.label || ch.channel}
                    </option>
                  ))}
                  <option value="last">Last used channel</option>
                  {channel && channel !== "last" && !readyChannelKeys.has(channel) && (
                    <option value={channel}>
                      {channel} (currently unavailable)
                    </option>
                  )}
                </select>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
                    Recipient
                  </label>
                  {deliveryMode !== "none" && channel && (
                    <button
                      type="button"
                      onClick={() => fetchTargetsCreate()}
                      disabled={targetsLoading}
                      className="shrink-0 text-xs text-violet-700 hover:text-violet-800 disabled:opacity-50 dark:text-violet-300 dark:hover:text-violet-200"
                    >
                      {targetsLoading ? "Refreshing…" : "Refresh targets"}
                    </button>
                  )}
                </div>
                {deliveryMode === "none" ? (
                  <input disabled value="" placeholder="—" className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none disabled:opacity-40" />
                ) : targetsLoading && knownTargets.length === 0 ? (
                  <div className="flex h-9 items-center rounded-lg border border-foreground/10 bg-muted/80 px-3">
                    <InlineSpinner size="sm" />
                    <span className="ml-2 text-xs text-muted-foreground/70">Loading targets…</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <select
                      value={customTo ? "__custom__" : to}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__custom__") setCustomTo(true);
                        else { setCustomTo(false); setTo(v); }
                      }}
                      className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                    >
                      <option value="">Select recipient…</option>
                      {filteredTargets.map((t) => (
                        <option key={t.target} value={t.target}>{t.target} ({t.source})</option>
                      ))}
                      <option value="__custom__">
                        {channel ? `Enter ${channel} ID manually…` : "Enter channel ID manually…"}
                      </option>
                    </select>
                    {customTo && (
                      <input
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        placeholder={
                          channel === "last"
                            ? "Auto from last active channel"
                            : CHANNEL_PLACEHOLDER[channel] || "channel:TARGET_ID"
                        }
                        className="w-full rounded-lg border border-foreground/10 bg-muted/80 px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                        aria-label="Recipient (e.g. discord:CHANNEL_ID)"
                      />
                    )}
                    {!customTo && to && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        <CheckCircle className="mr-1 inline h-2.5 w-2.5" />
                        Target set: <code className="text-emerald-700 dark:text-emerald-300">{to}</code>
                      </p>
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
                <span className="text-xs text-muted-foreground/70">Best effort delivery (don&apos;t fail the job if delivery fails)</span>
              </label>
            )}

            {deliveryMode === "announce" && !to && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
                <p className="text-xs text-amber-700/80 dark:text-amber-100/90">
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
              <h4 className="text-xs font-medium text-foreground/80 mb-1">Review &amp; Create</h4>
              <p className="text-xs text-muted-foreground/80 mb-3">Double-check everything looks good before creating.</p>
            </div>

            <div className="rounded-lg border border-foreground/5 bg-muted/40 divide-y divide-foreground/5">
              {/* Name */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-muted-foreground/80">Name</span>
                <span className="text-xs font-medium text-foreground/80">{name}</span>
              </div>
              {/* Agent */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-muted-foreground/80">Agent</span>
                <span className="text-xs text-foreground/90">{agent}</span>
              </div>
              {/* Schedule */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-muted-foreground/80">Schedule</span>
                <span className="text-xs text-foreground/90">
                  {simpleScheduleOption !== "custom" && simpleScheduleOption !== "at"
                    ? (() => {
                        const opt = SCHEDULE_SIMPLE_OPTIONS.find((o) => o.id === simpleScheduleOption);
                        return opt ? scheduleOptionLabel(opt, timeFormat) : (scheduleKind === "cron" ? cronToHuman(cronExpr) : `Every ${everyInterval}`);
                      })()
                    : scheduleKind === "cron"
                      ? cronToHuman(cronExpr)
                      : scheduleKind === "every"
                        ? `Every ${everyInterval}`
                        : atTime}
                  {tz && <span className="text-muted-foreground/70"> ({tz})</span>}
                </span>
              </div>
              {/* Session */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-muted-foreground/80">Session</span>
                <span className="text-xs text-foreground/90">{sessionTarget}</span>
              </div>
              {/* Prompt */}
              <div className="px-3 py-2.5">
                <span className="text-xs text-muted-foreground/80">Prompt</span>
                <p className="mt-1 whitespace-pre-wrap rounded bg-muted/60 p-2 text-xs leading-5 text-foreground/90">{message}</p>
              </div>
              {/* Model */}
              {model && (
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-muted-foreground/80">Model Override</span>
                  <span className="text-xs font-mono text-violet-700 dark:text-violet-300">{model}</span>
                </div>
              )}
              {/* Delivery */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-muted-foreground/80">Delivery</span>
                <span className="text-xs text-foreground/90">
                  {deliveryMode === "none" ? (
                    "No delivery"
                  ) : (
                    <>
                      {channel || "auto"} → {to || <span className="text-amber-700 dark:text-amber-300">not set</span>}
                    </>
                  )}
                </span>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/15 bg-red-500/10 px-3 py-2.5">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700 dark:text-red-300" />
                <p className="text-xs text-red-700 dark:text-red-200">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Navigation ── */}
        <div className="flex items-center gap-2 pt-2 border-t border-foreground/5">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="rounded px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground/90"
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
              className="flex items-center gap-1 rounded bg-primary text-primary-foreground px-4 py-1.5 text-xs font-medium transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="flex items-center gap-1 rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <span className="inline-flex items-center gap-0.5">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                  </span> Creating...
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
  const targetJobId = searchParams.get("job");
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunEntry[]>>({});
  const [runsLoading, setRunsLoading] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [runOutput, setRunOutput] = useState<Record<string, RunOutputState>>({});
  const [runOutputCollapsed, setRunOutputCollapsed] = useState<
    Record<string, boolean>
  >({});
  const runOutputRef = useRef<HTMLPreElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didAutoExpand = useRef(false);
  const didAutoFocusJob = useRef<string | null>(null);

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
    if (targetJobId) return;
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
  }, [showMode, jobs, runs, fetchRuns, targetJobId]);

  // Auto-expand a specific job when navigated with ?job=<id>
  useEffect(() => {
    if (!targetJobId || jobs.length === 0) return;
    const target = jobs.find((j) => j.id === targetJobId);
    if (!target) return;
    if (didAutoFocusJob.current === targetJobId) return;
    didAutoFocusJob.current = targetJobId;
    queueMicrotask(() => setExpanded(target.id));
    if (!runs[target.id]) {
      queueMicrotask(() => fetchRuns(target.id));
    }
    setTimeout(() => {
      const el = document.getElementById(`cron-job-${target.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }, [targetJobId, jobs, runs, fetchRuns]);

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
      if (action === "run") {
        const startedAt = Date.now();
        setExpanded(id);
        setRunOutput((prev) => ({
          ...prev,
          [id]: { status: "running", output: "", runStartedAtMs: startedAt },
        }));
        setRunOutputCollapsed((prev) => ({ ...prev, [id]: false }));
      }
      try {
        const res = await fetch("/api/cron", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, id, ...extra }),
        });
        const data = await res.json();
        if (action === "run") {
          const cliOutput = data.output ?? data.error ?? "";
          const initialOutput =
            typeof cliOutput === "string" ? cliOutput : String(cliOutput);
          setRunOutput((prev) => ({
            ...prev,
            [id]: {
              status: data.ok ? "done" : "error",
              output: initialOutput,
              runStartedAtMs: prev[id]?.runStartedAtMs || Date.now(),
            },
          }));
          // Poll for real session output (agent transcript) — run may finish shortly after CLI returns
          if (data.ok) {
            const pollDelays = [3000, 6000, 10000];
            pollDelays.forEach((delay) => {
              setTimeout(async () => {
                try {
                  const r = await fetch(
                    `/api/cron?action=runOutput&id=${encodeURIComponent(id)}`
                  );
                  const runData = await r.json();
                  const sessionOutput =
                    typeof runData.output === "string"
                      ? runData.output.trim()
                      : "";
                  if (!sessionOutput) return;
                  setRunOutput((prev) => {
                    const cur = prev[id];
                    if (!cur) return prev;
                    const merged = mergeSessionOutput(cur.output, sessionOutput);
                    if (merged === cur.output) return prev;
                    return {
                      ...prev,
                      [id]: {
                        ...cur,
                        output: merged,
                      },
                    };
                  });
                } catch {
                  /* ignore */
                }
              }, delay);
            });
          }
        }
        if (data.ok) {
          flash(`${action} successful`);
          fetchJobs();
          if (action === "run") {
            // Cron state can lag right after a successful run.
            // Refresh again to avoid showing stale "failed" status.
            setTimeout(() => fetchJobs(), 1500);
            setTimeout(() => fetchJobs(), 5000);
          }
          if (action === "run") setTimeout(() => fetchRuns(id), 5000);
          // Config-changing actions should prompt a restart
          if (["edit", "enable", "disable", "delete"].includes(action)) {
            requestRestart("Cron job configuration was updated.");
          }
        } else {
          flash(data.error || "Failed", "error");
        }
      } catch (err) {
        const msg = String(err);
        if (action === "run") {
          setRunOutput((prev) => ({
            ...prev,
            [id]: {
              status: "error",
              output: msg,
              runStartedAtMs: prev[id]?.runStartedAtMs || Date.now(),
            },
          }));
        }
        flash(msg, "error");
      }
      setActionLoading(null);
    },
    [fetchJobs, fetchRuns, flash]
  );

  const clearRunOutput = useCallback((jobId: string) => {
    setRunOutput((prev) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
    setRunOutputCollapsed((prev) => ({ ...prev, [jobId]: false }));
  }, []);

  // Auto-scroll run output to bottom when output updates
  useEffect(() => {
    if (expanded && runOutput[expanded] && runOutputRef.current) {
      const el = runOutputRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [expanded, runOutput]);

  if (loading) {
    return <LoadingState label="Loading cron jobs..." />;
  }

  const errorJobs = jobs.filter((j) => {
    const local = runOutput[j.id];
    const localIsNewer =
      Boolean(local) &&
      (!j.state.lastRunAtMs || (local?.runStartedAtMs || 0) > j.state.lastRunAtMs);
    if (localIsNewer && local?.status === "done") return false;
    if (localIsNewer && local?.status === "error") return true;
    return j.state.lastStatus === "error";
  });

  return (
    <SectionLayout>
      <SectionHeader
        title={`Cron Jobs (${jobs.length})`}
        description={
          <>
            Schedule, delivery, run history &bull; Edit schedule, content, delivery targets
            {errorJobs.length > 0 && (
              <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                {errorJobs.length} failing
              </span>
            )}
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3 w-3" /> New Cron Job
            </button>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                fetchJobs();
              }}
              className="flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </>
        }
      />

      <SectionBody width="content" padding="compact" innerClassName="space-y-3">
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
            <p className="text-sm text-muted-foreground/85 mb-1">No cron jobs yet</p>
            <p className="text-xs text-muted-foreground/75 mb-4">Create your first scheduled task to get started.</p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Create Cron Job
            </button>
          </div>
        )}

        {jobs.map((job) => {
          const isExpanded = expanded === job.id;
          const isEditing = editing === job.id;
          const isFocusedFromLink = targetJobId === job.id;
          const st = job.state;
          const localRun = runOutput[job.id];
          const localRunIsNewer =
            Boolean(localRun) &&
            (!st.lastRunAtMs || (localRun?.runStartedAtMs || 0) > st.lastRunAtMs);
          const effectiveStatus =
            localRunIsNewer && localRun?.status === "done"
              ? "ok"
              : localRunIsNewer && localRun?.status === "error"
                ? "error"
                : st.lastStatus;
          const hasError = effectiveStatus === "error";
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
                  : "border-foreground/10",
                hasError && expanded === job.id && "ring-1 ring-red-500/30",
                isFocusedFromLink && "ring-1 ring-violet-500/35"
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
                    <ChevronRight className="h-4 w-4 text-muted-foreground/80" />
                  )}
                </button>
                <div
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    !job.enabled
                      ? "bg-zinc-600"
                      : hasError
                        ? "bg-red-500 shadow-md shadow-red-500/40"
                        : effectiveStatus === "ok"
                          ? "bg-emerald-500"
                          : "bg-zinc-500"
                  )}
                />
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => toggleExpand(job.id)}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground/90">
                      {job.name}
                    </p>
                    {!job.enabled && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground/80">
                        DISABLED
                      </span>
                    )}
                    {delivery.hasIssue && (
                      <span className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        missing target
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground/85">
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
                        : "text-muted-foreground/80 hover:bg-muted"
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
                      <span className="inline-flex items-center gap-0.5">
                        <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                        <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                        <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                      </span>
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
                        ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                        : "text-muted-foreground/80 hover:bg-muted hover:text-foreground/90"
                    )}
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Error banner with quick-fix suggestion */}
              {hasError && st.lastError && !isEditing && !isExpanded && (
                <div className="mx-4 mb-3">
                  <FailureGuideCard
                    error={st.lastError}
                    delivery={job.delivery}
                    consecutiveErrors={st.consecutiveErrors}
                    onFix={() => setEditing(job.id)}
                    compact
                  />
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
                <div className="border-t border-foreground/5 px-4 py-4 space-y-4">
                  {hasError && st.lastError && (
                    <FailureGuideCard
                      error={st.lastError}
                      delivery={job.delivery}
                      consecutiveErrors={st.consecutiveErrors}
                      onFix={() => setEditing(job.id)}
                    />
                  )}

                  {/* ── Run output (terminal-like accordion) ──── */}
                  {runOutput[job.id] && (
                    <div className="rounded-lg border border-slate-300/70 bg-slate-50 overflow-hidden dark:border-zinc-800 dark:bg-zinc-950/95">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          setRunOutputCollapsed((prev) => ({
                            ...prev,
                            [job.id]: !prev[job.id],
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setRunOutputCollapsed((prev) => ({
                              ...prev,
                              [job.id]: !prev[job.id],
                            }));
                          }
                        }}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-900/70"
                      >
                        <span className="flex items-center gap-1.5">
                          <Terminal className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
                          Run output
                          {runOutput[job.id].status === "running" && (
                            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                              <span className="inline-flex items-center gap-0.5">
                              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                            </span>
                              Running…
                            </span>
                          )}
                          {runOutput[job.id].status === "done" && (
                            <span className="text-emerald-700 dark:text-emerald-300">Done</span>
                          )}
                          {runOutput[job.id].status === "error" && (
                            <span className="text-red-700 dark:text-red-300">Error</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearRunOutput(job.id);
                            }}
                            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 dark:text-zinc-500 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
                            title="Clear output"
                          >
                            <X className="h-3 w-3" />
                          </button>
                          {runOutputCollapsed[job.id] ? (
                            <ChevronRight className="h-3.5 w-3.5 text-slate-500 dark:text-zinc-500" />
                          ) : (
                            <ChevronUp className="h-3.5 w-3.5 text-slate-500 dark:text-zinc-500" />
                          )}
                        </span>
                      </div>
                      {!runOutputCollapsed[job.id] && (
                        <pre
                          ref={job.id === expanded ? runOutputRef : undefined}
                          className="max-h-64 overflow-auto border-t border-slate-200 bg-white px-3 py-2.5 text-xs font-mono leading-relaxed text-slate-900 whitespace-pre-wrap break-words dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-100"
                        >
                          {runOutput[job.id].status === "running" && !runOutput[job.id].output
                            ? "Waiting for output…"
                            : runOutput[job.id].output || "(no output)"}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* ── Job Configuration ──── */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Info className="h-3 w-3" />
                      Job Configuration
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 md:gap-x-6 gap-y-2 rounded-lg border border-foreground/5 bg-muted/40 px-3 py-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Hash className="h-3 w-3 text-muted-foreground/70" />
                        <span className="text-muted-foreground/85">Job ID</span>
                        <code className="ml-auto font-mono text-xs text-foreground/85">
                          {job.id}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <Globe className="h-3 w-3 text-muted-foreground/70" />
                        <span className="text-muted-foreground/85">Agent</span>
                        <span className="ml-auto text-foreground/85">
                          {job.agentId}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3 text-muted-foreground/70" />
                        <span className="text-muted-foreground/85">Schedule</span>
                        <span className="ml-auto font-mono text-foreground/85">
                          {scheduleDisplay(job.schedule)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-muted-foreground/70" />
                        <span className="text-muted-foreground/85">Session</span>
                        <span className="ml-auto text-foreground/85">
                          {job.sessionTarget || "default"}
                          {job.wakeMode && ` · wake: ${job.wakeMode}`}
                        </span>
                      </div>
                      {job.payload.model && (
                        <div className="flex items-center gap-2">
                          <Cpu className="h-3 w-3 text-muted-foreground/70" />
                          <span className="text-muted-foreground/85">Model</span>
                          <span className="ml-auto font-mono text-xs text-violet-700 dark:text-violet-300">
                            {job.payload.model}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <FileText className="h-3 w-3 text-muted-foreground/70" />
                        <span className="text-muted-foreground/85">Created</span>
                        <span className="ml-auto text-foreground/85">
                          {fmtDate(job.createdAtMs)}
                        </span>
                      </div>
                      {job.updatedAtMs && (
                        <div className="flex items-center gap-2">
                          <FileText className="h-3 w-3 text-muted-foreground/70" />
                          <span className="text-muted-foreground/85">Updated</span>
                          <span className="ml-auto text-foreground/85">
                            {fmtDate(job.updatedAtMs)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Delivery Config ─────── */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Send className="h-3 w-3" />
                      Delivery
                    </h3>
                    <div
                      className={cn(
                        "rounded-lg border px-3 py-3 text-xs",
                        delivery.hasIssue
                          ? "border-amber-500/20 bg-amber-500/5"
                          : "border-foreground/5 bg-muted/40"
                      )}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <span className="text-muted-foreground/85">Mode</span>
                          <p className="mt-0.5 font-medium text-foreground/90">
                            {job.delivery.mode || "none"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground/85">Channel</span>
                          <p className="mt-0.5 text-foreground/90">
                            {job.delivery.channel || "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground/85">To (recipient)</span>
                          <p
                            className={cn(
                              "mt-0.5 font-mono",
                              job.delivery.to
                                ? "text-foreground/90"
                                : "text-amber-700 dark:text-amber-300"
                            )}
                          >
                            {job.delivery.to || "⚠ not set"}
                          </p>
                        </div>
                      </div>

                      {delivery.hasIssue && (
                        <div className="mt-2 flex items-center gap-2">
                          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-700 dark:text-amber-300" />
                          <p className="text-xs text-amber-700 dark:text-amber-200">
                            {delivery.issue}
                          </p>
                          <button
                            type="button"
                            onClick={() => setEditing(job.id)}
                            className="ml-auto shrink-0 rounded bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25"
                          >
                            Fix →
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Execution Status ────── */}
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Timer className="h-3 w-3" />
                      Execution Status
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-lg border border-foreground/5 bg-muted/40 px-3 py-2 text-center">
                        <p className="text-xs text-muted-foreground/85">Last Run</p>
                        <p className="mt-0.5 text-xs font-medium text-foreground/90">
                          {fmtAgo(st.lastRunAtMs)}
                        </p>
                        <p className="text-xs text-muted-foreground/75">
                          {fmtDate(st.lastRunAtMs)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-foreground/5 bg-muted/40 px-3 py-2 text-center">
                        <p className="text-xs text-muted-foreground/85">Next Run</p>
                        <p className="mt-0.5 text-xs font-medium text-foreground/90">
                          {fmtAgo(st.nextRunAtMs)}
                        </p>
                        <p className="text-xs text-muted-foreground/75">
                          {fmtDate(st.nextRunAtMs)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-foreground/5 bg-muted/40 px-3 py-2 text-center">
                        <p className="text-xs text-muted-foreground/85">Duration</p>
                        <p className="mt-0.5 text-xs font-medium text-foreground/90">
                          {fmtDuration(st.lastDurationMs)}
                        </p>
                      </div>
                      <div
                        className={cn(
                          "rounded-lg border px-3 py-2 text-center",
                          hasError
                            ? "border-red-500/15 bg-red-500/5"
                            : "border-foreground/5 bg-muted/40"
                        )}
                      >
                        <p className="text-xs text-muted-foreground/85">Status</p>
                        <p
                          className={cn(
                            "mt-0.5 text-xs font-medium",
                            hasError
                              ? "text-red-700 dark:text-red-300"
                              : effectiveStatus === "ok"
                                ? "text-emerald-700 dark:text-emerald-300"
                                : "text-muted-foreground/90"
                          )}
                        >
                          {effectiveStatus || "—"}
                        </p>
                        {hasError && st.consecutiveErrors ? (
                          <p className="text-xs text-red-700 dark:text-red-300">
                            {st.consecutiveErrors} consecutive
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* ── Prompt ──────────────── */}
                  {job.payload.message && (
                    <div>
                      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        Prompt
                      </h3>
                      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-foreground/10 bg-background/70 p-3 text-xs leading-5 text-foreground/90">
                        {job.payload.message}
                      </pre>
                    </div>
                  )}

                  {/* ── Run History ─────────── */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Run History
                      </h3>
                      <button
                        type="button"
                        onClick={() => fetchRuns(job.id)}
                        disabled={runsLoading === job.id}
                        className="flex items-center gap-1 text-xs text-muted-foreground/80 transition-colors hover:text-foreground/85"
                      >
                        {runsLoading === job.id ? (
                          <span className="inline-flex items-center gap-0.5">
                            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                          </span>
                        ) : (
                          <RefreshCw className="h-2.5 w-2.5" />
                        )}
                        Refresh
                      </button>
                    </div>
                    {runsLoading === job.id && jobRuns.length === 0 ? (
                      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground/80">
                        <span className="inline-flex items-center gap-0.5">
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                        </span>
                        Loading runs...
                      </div>
                    ) : jobRuns.length === 0 ? (
                      <p className="text-xs text-muted-foreground/85">
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
      </SectionBody>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs shadow-xl backdrop-blur-sm",
            toast.type === "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
              : "border-red-500/20 bg-red-500/10 text-red-800 dark:text-red-200"
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
    </SectionLayout>
  );
}
