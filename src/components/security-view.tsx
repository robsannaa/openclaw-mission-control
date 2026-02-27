"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CircleHelp,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  FileCheck2,
  Bot,
} from "lucide-react";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiWarningBadge } from "@/components/ui/api-warning-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionsView } from "@/components/permissions-view";
import { cn } from "@/lib/utils";

type SecuritySeverity = "critical" | "warn" | "info";

type SecurityFinding = {
  checkId: string;
  severity: SecuritySeverity;
  title: string;
  detail?: string;
  remediation?: string;
};

type SecurityAuditReport = {
  ts: number;
  mode: "quick" | "deep" | "fix";
  summary: {
    critical: number;
    warn: number;
    info: number;
  };
  findings: SecurityFinding[];
  deep?: unknown;
};

type SecurityFixAction = {
  kind: string;
  path?: string;
  mode?: number;
  ok?: boolean;
  skipped?: string;
  error?: string;
};

type SecurityFixResult = {
  ok: boolean;
  stateDir?: string;
  configPath?: string;
  configWritten?: boolean;
  changes: string[];
  actions: SecurityFixAction[];
  errors: string[];
};

type SecuritySnapshot = {
  ts: number;
  docsUrl: string;
  cache: {
    updatedAt?: number;
    lastAudit?: SecurityAuditReport;
    lastFix?: {
      ts: number;
      fix: SecurityFixResult;
      report: SecurityAuditReport;
    };
  };
  warning?: string;
  degraded?: boolean;
  error?: string;
};

type SecurityPrefs = {
  autoScan: boolean;
  defaultMode: "quick" | "deep";
};

type SecurityTab = "audit" | "permissions";

const PREFS_KEY = "openclaw-security-center-prefs-v1";
const TAB_PREF_KEY = "openclaw-security-center-tab-v1";
const DEFAULT_PREFS: SecurityPrefs = { autoScan: true, defaultMode: "quick" };
const STALE_AUDIT_MS = 24 * 60 * 60 * 1000;

function formatTime(ts?: number): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString();
}

function formatAge(ts?: number): string {
  if (!ts) return "not yet scanned";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function loadPrefs(): SecurityPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<SecurityPrefs>;
    return {
      autoScan: parsed.autoScan !== false,
      defaultMode: parsed.defaultMode === "deep" ? "deep" : "quick",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: SecurityPrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore persistence failures.
  }
}

function severityLabel(severity: SecuritySeverity): string {
  if (severity === "critical") return "critical";
  if (severity === "warn") return "warning";
  return "info";
}

function severityClass(severity: SecuritySeverity): string {
  if (severity === "critical") {
    return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200";
  }
  if (severity === "warn") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  }
  return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-200";
}

export function SecurityView({ initialTab = "audit" }: { initialTab?: SecurityTab } = {}) {
  const [snapshot, setSnapshot] = useState<SecuritySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [apiDegraded, setApiDegraded] = useState(false);
  const [prefs, setPrefs] = useState<SecurityPrefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [showFixConfirm, setShowFixConfirm] = useState(false);
  const [fixAcknowledge, setFixAcknowledge] = useState(false);
  const [activeTab, setActiveTab] = useState<SecurityTab>(initialTab);
  const autoScanTriggered = useRef(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    setPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    savePrefs(prefs);
  }, [prefs, prefsLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initialTab === "permissions") {
      setActiveTab("permissions");
      return;
    }
    try {
      const saved = localStorage.getItem(TAB_PREF_KEY);
      setActiveTab(saved === "permissions" ? "permissions" : "audit");
    } catch {
      setActiveTab("audit");
    }
  }, [initialTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initialTab === "permissions") return;
    try {
      localStorage.setItem(TAB_PREF_KEY, activeTab);
    } catch {
      // Ignore persistence failures.
    }
  }, [activeTab, initialTab]);

  const load = useCallback(async () => {
    setLoading(true);
    setApiWarning(null);
    setApiDegraded(false);
    try {
      const res = await fetch("/api/security", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SecuritySnapshot;
      setSnapshot(data);
      setError(null);
      if (data.warning) setApiWarning(data.warning);
      if (data.degraded) setApiDegraded(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setApiWarning(message);
      setApiDegraded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAudit = useCallback(
    async (mode: "quick" | "deep", silent = false) => {
      setMutating(true);
      setPendingAction(mode === "deep" ? "audit-deep" : "audit-quick");
      if (!silent) setNotice(null);
      try {
        const res = await fetch("/api/security", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "audit", mode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(String(data?.error || `HTTP ${res.status}`));
        setSnapshot((prev) => ({
          ts: Date.now(),
          docsUrl: prev?.docsUrl || "https://docs.openclaw.ai/cli/security",
          cache: data.cache || prev?.cache || {},
          warning: data.warning || undefined,
          degraded: false,
        }));
        setShowFixConfirm(false);
        setFixAcknowledge(false);
        setError(null);
        if (!silent) {
          setNotice(mode === "deep" ? "Deep security audit completed." : "Security audit completed.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setMutating(false);
        setPendingAction(null);
      }
    },
    []
  );

  const runFix = useCallback(async () => {
    setMutating(true);
    setPendingAction("fix");
    setNotice(null);
    try {
      const res = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fix" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data?.error || `HTTP ${res.status}`));
      setSnapshot((prev) => ({
        ts: Date.now(),
        docsUrl: prev?.docsUrl || "https://docs.openclaw.ai/cli/security",
        cache: data.cache || prev?.cache || {},
        warning: data.warning || undefined,
        degraded: false,
      }));
      setShowFixConfirm(false);
      setFixAcknowledge(false);
      setError(null);
      setNotice("Safe security fixes applied. Review findings below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
      setPendingAction(null);
    }
  }, []);

  useEffect(() => {
    if (!snapshot || !prefsLoaded || autoScanTriggered.current) return;
    if (!prefs.autoScan) return;
    const lastTs = snapshot.cache.lastAudit?.ts || 0;
    if (!lastTs || Date.now() - lastTs > STALE_AUDIT_MS) {
      autoScanTriggered.current = true;
      void runAudit(prefs.defaultMode, true);
    }
  }, [prefs.autoScan, prefs.defaultMode, prefsLoaded, runAudit, snapshot]);

  const lastAudit = snapshot?.cache.lastAudit || null;
  const lastFix = snapshot?.cache.lastFix || null;
  const summary = lastAudit?.summary || { critical: 0, warn: 0, info: 0 };

  const findings = useMemo(() => {
    const order: Record<SecuritySeverity, number> = { critical: 0, warn: 1, info: 2 };
    return [...(lastAudit?.findings || [])].sort((a, b) => {
      const sev = order[a.severity] - order[b.severity];
      if (sev !== 0) return sev;
      return a.checkId.localeCompare(b.checkId);
    });
  }, [lastAudit?.findings]);

  const riskLabel = useMemo(() => {
    if (summary.critical > 0) return "Critical attention required";
    if (summary.warn > 0) return "Needs attention";
    if (summary.info > 0 || lastAudit) return "No active high-risk findings";
    return "Not scanned yet";
  }, [lastAudit, summary.critical, summary.info, summary.warn]);

  const deepGateway = useMemo(() => {
    if (!lastAudit?.deep || typeof lastAudit.deep !== "object" || Array.isArray(lastAudit.deep)) {
      return null;
    }
    const deep = lastAudit.deep as Record<string, unknown>;
    if (!deep.gateway || typeof deep.gateway !== "object" || Array.isArray(deep.gateway)) {
      return null;
    }
    return deep.gateway as Record<string, unknown>;
  }, [lastAudit?.deep]);
  const deepIssue = useMemo(() => {
    if (!deepGateway) return "";
    const value = deepGateway.error || deepGateway.close;
    return String(value || "").trim();
  }, [deepGateway]);

  const initialLoading = loading && !snapshot;

  return (
    <SectionLayout>
      <SectionHeader
        title={
          <span className="flex items-center gap-2 text-sm">
            <ShieldAlert className="h-4 w-4 text-red-300" />
            Security Center
          </span>
        }
        description="Run guided security audits and apply OpenClaw safe fixes. Built for non-technical operators."
        titleClassName="text-sm"
        descriptionClassName="text-sm"
        metaClassName="text-xs"
        meta={
          <>
            <a
              href={snapshot?.docsUrl || "https://docs.openclaw.ai/cli/security"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline"
            >
              docs.openclaw.ai/cli/security
            </a>
            {" · "}
            <code className="text-muted-foreground/80">openclaw security audit</code>
            {" · "}
            cache: <code className="text-muted-foreground/80">~/.openclaw/mission-control/security-audit-cache.json</code>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <ApiWarningBadge warning={apiWarning} degraded={apiDegraded} />
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || mutating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/80 disabled:opacity-60"
            >
              {(loading || mutating) ? (
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                </span>
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh
            </button>
          </div>
        }
        className="bg-card/60"
      />

      <SectionBody width="wide" padding="compact" innerClassName="space-y-4">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value === "permissions" ? "permissions" : "audit")}
          className="space-y-4"
        >
          <TabsList variant="line" className="rounded-xl border border-foreground/10 bg-card/50 p-1">
            <TabsTrigger value="audit" className="text-xs">
              Audit & Fix
            </TabsTrigger>
            <TabsTrigger value="permissions" className="text-xs">
              Permissions & Access
            </TabsTrigger>
          </TabsList>

          <TabsContent value="audit" className="space-y-4">
        {initialLoading && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={`security-stat-${idx}`} className="rounded-xl border border-foreground/10 bg-card/70 p-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-2 h-6 w-20" />
                  <Skeleton className="mt-2 h-3 w-32" />
                </div>
              ))}
            </div>
            <section className="rounded-2xl border border-foreground/10 bg-card/60 p-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-8 w-full rounded-lg" />
              <Skeleton className="mt-2 h-8 w-full rounded-lg" />
            </section>
          </>
        )}

        {!initialLoading && (
          <>
            {error && (
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                {notice}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                <p className="text-xs uppercase tracking-wider text-red-700/90 dark:text-red-200/80">Overall Risk</p>
                <p className="mt-1 text-sm font-semibold text-red-700 dark:text-red-200">{riskLabel}</p>
                <p className="text-xs text-red-700/75 dark:text-red-100/70">
                  critical {summary.critical} • warn {summary.warn} • info {summary.info}
                </p>
              </div>

              <div className="rounded-xl border border-foreground/10 bg-card/70 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground/75">Last Audit</p>
                <p className="mt-1 text-sm font-semibold text-foreground/90">
                  {lastAudit ? formatAge(lastAudit.ts) : "Not run yet"}
                </p>
                <p className="text-xs text-muted-foreground/60">
                  {lastAudit ? `${lastAudit.mode} • ${formatTime(lastAudit.ts)}` : "Run quick or deep scan"}
                </p>
              </div>

              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
                <p className="text-xs uppercase tracking-wider text-blue-700/90 dark:text-blue-200/80">Auto Scan</p>
                <p className="mt-1 text-sm font-semibold text-blue-700 dark:text-blue-100">
                  {prefs.autoScan ? "Enabled" : "Disabled"}
                </p>
                <p className="text-xs text-blue-700/75 dark:text-blue-100/70">default mode: {prefs.defaultMode}</p>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-xs uppercase tracking-wider text-emerald-700/90 dark:text-emerald-200/80">Access Controls</p>
                <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-100">
                  Advanced settings
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("permissions")}
                  className="text-xs text-emerald-700/80 underline hover:text-emerald-700 dark:text-emerald-100/80"
                >
                  Open permissions access
                </button>
              </div>
            </div>

            <section className="rounded-2xl border border-foreground/10 bg-card/60 p-3">
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <FileCheck2 className="h-3.5 w-3.5" />
                Security actions
              </h2>
              <p className="mb-3 text-xs text-muted-foreground/75">
                Quick audit is recommended for daily checks. Deep audit verifies live gateway reachability.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runAudit("quick")}
                  disabled={mutating}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-200 disabled:opacity-50"
                >
                  {pendingAction === "audit-quick" ? (
                    <span className="inline-flex items-center gap-0.5">
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                    </span>
                  ) : <ShieldCheck className="h-3 w-3" />}
                  Run quick audit
                </button>
                <button
                  type="button"
                  onClick={() => void runAudit("deep")}
                  disabled={mutating}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/15 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-200 disabled:opacity-50"
                >
                  {pendingAction === "audit-deep" ? (
                    <span className="inline-flex items-center gap-0.5">
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                    </span>
                  ) : <CircleHelp className="h-3 w-3" />}
                  Run deep audit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowFixConfirm((prev) => !prev);
                    setFixAcknowledge(false);
                  }}
                  disabled={mutating}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-200 disabled:opacity-50"
                >
                  <Wrench className="h-3 w-3" />
                  Apply safe fixes
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/75">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={prefs.autoScan}
                    onChange={(e) => setPrefs((prev) => ({ ...prev, autoScan: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded border border-foreground/20 bg-card"
                  />
                  Auto-run when stale
                </label>
                <span>Default mode:</span>
                <select
                  value={prefs.defaultMode}
                  onChange={(e) => setPrefs((prev) => ({ ...prev, defaultMode: e.target.value === "deep" ? "deep" : "quick" }))}
                  className="rounded border border-foreground/15 bg-card px-2 py-1 text-xs text-foreground/90"
                >
                  <option value="quick">quick</option>
                  <option value="deep">deep</option>
                </select>
              </div>

              {showFixConfirm && (
                <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
                  <p className="font-medium text-amber-700 dark:text-amber-200">Before applying fixes</p>
                  <p className="mt-1 text-muted-foreground/80">
                    This will apply OpenClaw’s built-in safe remediations, including permission hardening and security defaults.
                  </p>
                  <p className="mt-2 font-medium text-foreground/90">What it fixes:</p>
                  <p className="text-muted-foreground/75">groupPolicy hardening, sensitive logging defaults, and sensitive-file permissions.</p>
                  <p className="mt-1 font-medium text-foreground/90">What it does not do:</p>
                  <p className="text-muted-foreground/75">it does not rotate secrets, disable tools, or rewrite plugins/skills.</p>
                  <label className="mt-2 inline-flex items-center gap-1.5 text-foreground/85">
                    <input
                      type="checkbox"
                      checked={fixAcknowledge}
                      onChange={(e) => setFixAcknowledge(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border border-foreground/20 bg-card"
                    />
                    I understand this updates local OpenClaw security settings.
                  </label>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => void runFix()}
                      disabled={mutating || !fixAcknowledge}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-200 disabled:opacity-50"
                    >
                      {pendingAction === "fix" ? (
                        <span className="inline-flex items-center gap-0.5">
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                        </span>
                      ) : <Wrench className="h-3 w-3" />}
                      Confirm and apply safe fixes
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-foreground/10 bg-card/60 p-3">
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" />
                Findings ({findings.length})
              </h2>
              {findings.length === 0 ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-6 text-center text-xs text-emerald-700 dark:text-emerald-200">
                  {lastAudit ? "No findings in the latest audit." : "Run an audit to see security findings."}
                </div>
              ) : (
                <div className="space-y-2">
                  {findings.map((finding) => (
                    <div key={finding.checkId} className="rounded-xl border border-foreground/10 bg-background/35 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-foreground/90">{finding.title}</p>
                          <p className="text-[11px] text-muted-foreground/70">{finding.checkId}</p>
                        </div>
                        <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-medium", severityClass(finding.severity))}>
                          {severityLabel(finding.severity)}
                        </span>
                      </div>
                      {finding.detail && (
                        <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground/80">{finding.detail}</p>
                      )}
                      {finding.remediation && (
                        <div className="mt-2 rounded-md border border-cyan-500/20 bg-cyan-500/8 px-2 py-1.5 text-xs text-cyan-800 dark:text-cyan-100">
                          <span className="font-medium">Suggested fix:</span> {finding.remediation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {deepGateway && (
              <section className="rounded-2xl border border-foreground/10 bg-card/60 p-3">
                <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Bot className="h-3.5 w-3.5" />
                  Deep Audit Gateway Check
                </h2>
                <p className="text-xs text-muted-foreground/75">
                  attempted: <code>{String(Boolean(deepGateway.attempted))}</code> • ok: <code>{String(Boolean(deepGateway.ok))}</code> • url:{" "}
                  <code>{String(deepGateway.url || "unknown")}</code>
                </p>
                {Boolean(deepIssue) && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-200">
                    issue: <code>{deepIssue}</code>
                  </p>
                )}
              </section>
            )}

            {lastFix && (
              <section className="rounded-2xl border border-foreground/10 bg-card/60 p-3">
                <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Wrench className="h-3.5 w-3.5" />
                  Last Safe Fix Run
                </h2>
                <p className="text-xs text-muted-foreground/75">
                  {formatTime(lastFix.ts)} • status:{" "}
                  <span className={lastFix.fix.ok ? "text-emerald-700 dark:text-emerald-200" : "text-red-700 dark:text-red-200"}>
                    {lastFix.fix.ok ? "ok" : "needs review"}
                  </span>
                  {" • "}changes: <code>{lastFix.fix.changes.length}</code> • action steps: <code>{lastFix.fix.actions.length}</code>
                </p>
                {lastFix.fix.configPath && (
                  <p className="mt-1 text-xs text-muted-foreground/75">
                    config path: <code>{lastFix.fix.configPath}</code>
                  </p>
                )}
                {lastFix.fix.changes.length > 0 && (
                  <div className="mt-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2">
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-200">Changes</p>
                    <div className="mt-1 space-y-1">
                      {lastFix.fix.changes.slice(0, 8).map((change, idx) => (
                        <p key={`${change}-${idx}`} className="text-xs text-emerald-800 dark:text-emerald-100">
                          {change}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {lastFix.fix.errors.length > 0 && (
                  <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/5 p-2">
                    <p className="text-xs font-medium text-red-700 dark:text-red-200">Fix errors</p>
                    <div className="mt-1 space-y-1">
                      {lastFix.fix.errors.slice(0, 6).map((err, idx) => (
                        <p key={`${err}-${idx}`} className="text-xs text-red-800 dark:text-red-100">
                          {err}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}
          </TabsContent>

          <TabsContent value="permissions" className="space-y-4">
            <PermissionsView embedded />
          </TabsContent>
        </Tabs>
      </SectionBody>
    </SectionLayout>
  );
}
