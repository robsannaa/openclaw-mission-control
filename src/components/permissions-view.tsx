"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  TerminalSquare,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  CircleX,
  Sparkles,
  Plus,
  Trash2,
  Activity,
  Bell,
  Smartphone,
  UserCheck,
  UserX,
} from "lucide-react";
import { cn } from "@/lib/utils";

type PermissionSnapshot = {
  ts: number;
  approvals: {
    path?: string;
    exists?: boolean;
    hash?: string;
  };
  allowlist: Array<{
    agentId: string;
    pattern: string;
    id?: string;
    lastUsedAt?: number;
    lastUsedCommand?: string;
    lastResolvedPath?: string;
  }>;
  execPolicies: Array<{
    scope: "defaults" | "agent";
    agentId?: string;
    security?: string;
    ask?: string;
    askFallback?: string;
    autoAllowSkills?: boolean;
    allowlistCount: number;
  }>;
  sandbox: {
    sandbox?: {
      mode?: string;
      workspaceAccess?: string;
      sessionIsSandboxed?: boolean;
      tools?: {
        allow?: string[];
        deny?: string[];
      };
    };
    elevated?: {
      enabled?: boolean;
      allowedByConfig?: boolean;
      alwaysAllowedByConfig?: boolean;
    };
  };
  capabilities: {
    sandboxMode: string;
    sessionIsSandboxed: boolean;
    workspaceAccess: string;
    toolPolicyMode: "allowlist" | "open-denylist";
    allowedToolsConfigured: string[];
    deniedToolsConfigured: string[];
    flags: Array<{ id: string; label: string; allowed: boolean; reason: string }>;
    allowlistCount: number;
    policyScopeCount: number;
  };
};

type AgentItem = { id: string };

type DeviceToken = {
  role: string;
  scopes: string[];
  lastUsedAtMs?: number;
};

type PairedDevice = {
  deviceId: string;
  displayName?: string;
  platform: string;
  clientId: string;
  clientMode: string;
  roles: string[];
  tokens: DeviceToken[];
};

type PendingDeviceRequest = {
  requestId?: string;
  deviceId: string;
  displayName?: string;
  platform: string;
  clientMode: string;
  requestedRole?: string;
  requestedScopes?: string[];
  expiresAtMs?: number;
};

const QUICK_PERMISSIONS: Array<{
  label: string;
  pattern: string;
  why: string;
}> = [
  { label: "Allow rm", pattern: "**/rm", why: "Permit delete command execution when requested by agent workflows." },
  { label: "Allow pkill", pattern: "**/pkill", why: "Permit process termination by name." },
  { label: "Allow killall", pattern: "**/killall", why: "Permit broad process termination by executable name." },
  { label: "Allow kill", pattern: "**/kill", why: "Permit process termination by PID." },
  { label: "Allow chmod", pattern: "**/chmod", why: "Permit permission-mode changes on files/directories." },
  { label: "Allow chown", pattern: "**/chown", why: "Permit ownership changes on files/directories." },
  { label: "Allow systemctl", pattern: "**/systemctl", why: "Permit service lifecycle commands on Linux systems." },
];

function formatAgo(ts?: number): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function PermissionsView() {
  const [snapshot, setSnapshot] = useState<PermissionSnapshot | null>(null);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [pendingDevices, setPendingDevices] = useState<PendingDeviceRequest[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("*");
  const [pattern, setPattern] = useState("");
  const [loading, setLoading] = useState(true);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [deviceMutating, setDeviceMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPairedDevices(Array.isArray(data.paired) ? (data.paired as PairedDevice[]) : []);
      setPendingDevices(Array.isArray(data.pending) ? (data.pending as PendingDeviceRequest[]) : []);
    } catch (err) {
      setError((prev) => prev || (err instanceof Error ? err.message : String(err)));
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [permRes, agentsRes] = await Promise.all([
        fetch("/api/permissions", { cache: "no-store" }),
        fetch("/api/agents", { cache: "no-store" }).catch(() => null),
      ]);
      await loadDevices();
      if (!permRes.ok) throw new Error(`HTTP ${permRes.status}`);
      const perm = (await permRes.json()) as PermissionSnapshot;
      setSnapshot(perm);
      setError(null);

      if (agentsRes?.ok) {
        const data = await agentsRes.json();
        const list = Array.isArray(data.agents) ? (data.agents as AgentItem[]) : [];
        setAgents(list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadDevices]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (body: Record<string, unknown>) => {
      setMutating(true);
      setNotice(null);
      try {
        const res = await fetch("/api/permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(String(data?.error || `HTTP ${res.status}`));
        const next = (data.snapshot || data) as PermissionSnapshot;
        setSnapshot(next);
        setError(null);
        setNotice("Permissions updated.");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setMutating(false);
      }
    },
    []
  );

  const scopedAllowlist = useMemo(() => {
    const rows = snapshot?.allowlist || [];
    if (selectedAgent === "*") return rows;
    return rows.filter((r) => r.agentId === selectedAgent || r.agentId === "*");
  }, [snapshot?.allowlist, selectedAgent]);

  const allowlistSet = useMemo(() => {
    const set = new Set<string>();
    for (const row of snapshot?.allowlist || []) {
      if (selectedAgent === "*" || row.agentId === "*" || row.agentId === selectedAgent) {
        set.add(row.pattern);
      }
    }
    return set;
  }, [snapshot?.allowlist, selectedAgent]);

  const handleAddPattern = useCallback(() => {
    const normalized = pattern.trim();
    if (!normalized) return;
    void mutate({ action: "allow-pattern", agentId: selectedAgent, pattern: normalized });
    setPattern("");
  }, [mutate, pattern, selectedAgent]);

  const handleRevokePattern = useCallback(
    (value: string) => {
      void mutate({ action: "revoke-pattern", agentId: selectedAgent, pattern: value });
    },
    [mutate, selectedAgent]
  );

  const toggleQuickPattern = useCallback(
    (value: string) => {
      const action = allowlistSet.has(value) ? "revoke-pattern" : "allow-pattern";
      void mutate({ action, agentId: selectedAgent, pattern: value });
    },
    [allowlistSet, mutate, selectedAgent]
  );

  const setElevated = useCallback(
    (enabled: boolean) => {
      void mutate({ action: "set-elevated", enabled });
    },
    [mutate]
  );

  const mutateDevice = useCallback(
    async (body: Record<string, unknown>, successMsg: string) => {
      setDeviceMutating(true);
      setNotice(null);
      try {
        const res = await fetch("/api/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(String(data?.error || `HTTP ${res.status}`));
        }
        await loadDevices();
        setNotice(successMsg);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDeviceMutating(false);
      }
    },
    [loadDevices]
  );

  const approveDevice = useCallback(
    (requestId: string) => {
      void mutateDevice({ action: "approve", requestId }, "Pairing request approved.");
    },
    [mutateDevice]
  );

  const rejectDevice = useCallback(
    (requestId: string) => {
      void mutateDevice({ action: "reject", requestId }, "Pairing request rejected.");
    },
    [mutateDevice]
  );

  const revokeDeviceRole = useCallback(
    (deviceId: string, role: string) => {
      void mutateDevice({ action: "revoke", deviceId, role }, `Revoked ${role} token.`);
    },
    [mutateDevice]
  );

  const elevatedEnabled = Boolean(snapshot?.sandbox?.elevated?.enabled);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="border-b border-foreground/[0.08] bg-card/60 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-[16px] font-semibold text-foreground/95">
              <Shield className="h-4 w-4 text-cyan-300" />
              Permission Control
            </h1>
            <p className="text-[12px] text-muted-foreground/70">
              Inspect, grant, and revoke what OpenClaw can execute on this machine.
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              Source: <code>openclaw approvals get --json</code> + <code>openclaw sandbox explain --json</code>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || mutating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] bg-card px-3 py-1.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-muted/80 disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (loading || mutating) && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1360px] space-y-4 px-4 py-4 md:px-6">
        {error && (
          <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-700 dark:text-red-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-200">
            {notice}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-foreground/[0.08] bg-card/70 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/65">Sandbox Mode</p>
            <p className="mt-1 text-[18px] font-semibold text-foreground/90">
              {snapshot?.capabilities.sandboxMode || "—"}
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              workspace: {snapshot?.capabilities.workspaceAccess || "unknown"}
            </p>
          </div>
          <div className="rounded-xl border border-foreground/[0.08] bg-card/70 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/65">Elevated Exec</p>
            <p className="mt-1 flex items-center gap-1.5 text-[18px] font-semibold">
              {elevatedEnabled ? (
                <>
                  <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-300" /> <span className="text-amber-700 dark:text-amber-200">Enabled</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" /> <span className="text-emerald-700 dark:text-emerald-200">Disabled</span>
                </>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              controls privileged exec escalation
            </p>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-3">
            <p className="text-[10px] uppercase tracking-wider text-red-700/85 dark:text-red-200/80">Tool Policy Mode</p>
            <p className="mt-1 text-[18px] font-semibold text-red-700 dark:text-red-200">
              {snapshot?.capabilities.toolPolicyMode || "—"}
            </p>
            <p className="text-[10px] text-red-700/75 dark:text-red-100/70">from sandbox explain</p>
          </div>
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.05] p-3">
            <p className="text-[10px] uppercase tracking-wider text-blue-700/85 dark:text-blue-200/80">Policy Scopes</p>
            <p className="mt-1 text-[18px] font-semibold text-blue-700 dark:text-blue-100">
              {snapshot?.capabilities.policyScopeCount ?? 0}
            </p>
            <p className="text-[10px] text-blue-700/75 dark:text-blue-100/70">
              defaults + agent overrides
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-foreground/[0.08] bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Activity className="h-3.5 w-3.5" />
                Capability Matrix
              </h2>
              <span className="text-[10px] text-muted-foreground/60">
                sandboxed: {snapshot?.capabilities.sessionIsSandboxed ? "yes" : "no"}
              </span>
            </div>
            <div className="space-y-2">
              {(snapshot?.capabilities.flags || []).map((flag) => (
                <div
                  key={flag.id}
                  className={cn(
                    "rounded-xl border px-3 py-2",
                    flag.allowed
                      ? "border-emerald-500/20 bg-emerald-500/[0.05]"
                      : "border-zinc-500/20 bg-zinc-500/[0.05]"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] font-medium text-foreground/90">{flag.label}</p>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                        flag.allowed
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                          : "bg-zinc-500/20 text-zinc-700 dark:text-zinc-300"
                      )}
                    >
                      {flag.allowed ? <CheckCircle2 className="h-3 w-3" /> : <CircleX className="h-3 w-3" />}
                      {flag.allowed ? "allowed" : "blocked"}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">{flag.reason}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-foreground/[0.08] bg-card/60 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Permission Actions
            </h2>

            <div className="rounded-xl border border-foreground/[0.08] bg-background/40 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Agent Scope</p>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="mt-1 w-full rounded-md border border-foreground/[0.08] bg-card px-2 py-1.5 text-[12px] text-foreground/90 outline-none"
              >
                <option value="*">* (all agents)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2 rounded-xl border border-foreground/[0.08] bg-background/40 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Elevated Execution</p>
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                Controls whether escalated exec approvals can be used.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setElevated(true)}
                  disabled={mutating || elevatedEnabled}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/[0.08] px-2 py-1 text-[11px] text-amber-700 dark:text-amber-200 disabled:opacity-50"
                >
                  <Unlock className="h-3 w-3" /> Enable
                </button>
                <button
                  type="button"
                  onClick={() => setElevated(false)}
                  disabled={mutating || !elevatedEnabled}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/[0.08] px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-200 disabled:opacity-50"
                >
                  <Lock className="h-3 w-3" /> Disable
                </button>
              </div>
            </div>

            <div className="mt-2 rounded-xl border border-foreground/[0.08] bg-background/40 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Grant Command Pattern</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder='e.g. **/pkill or /usr/bin/git'
                  className="min-w-0 flex-1 rounded-md border border-foreground/[0.08] bg-card px-2 py-1.5 text-[12px] text-foreground/90 outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddPattern}
                  disabled={mutating || !pattern.trim()}
                  className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/15 px-2 py-1 text-[11px] text-violet-700 dark:text-violet-200 disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" /> Grant
                </button>
              </div>
            </div>

            <div className="mt-2 rounded-xl border border-foreground/[0.08] bg-background/40 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                Exec Approval Policy
              </p>
              <div className="mt-1.5 space-y-1.5">
                {(snapshot?.execPolicies || []).map((scope) => (
                  <div
                    key={`${scope.scope}:${scope.agentId || "*"}`}
                    className="rounded-md border border-foreground/[0.08] bg-card/60 px-2 py-1.5 text-[10px]"
                  >
                    <p className="font-medium text-foreground/85">
                      {scope.scope === "defaults" ? "defaults" : `agent:${scope.agentId}`}
                    </p>
                    <p className="text-muted-foreground/75">
                      security: {scope.security || "default"} • ask: {scope.ask || "default"} • askFallback:{" "}
                      {scope.askFallback || "default"}
                    </p>
                    <p className="text-muted-foreground/65">
                      autoAllowSkills: {String(scope.autoAllowSkills ?? false)} • allowlist: {scope.allowlistCount}
                    </p>
                  </div>
                ))}
                {(snapshot?.execPolicies || []).length === 0 && (
                  <p className="text-[10px] text-muted-foreground/65">No explicit approval policy scopes found.</p>
                )}
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-foreground/[0.08] bg-card/60 p-3">
          <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Quick Command Presets
          </h2>
          <p className="mb-2 text-[10px] text-muted-foreground/65">
            Convenience actions. These are shortcuts for writing allowlist patterns.
          </p>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {QUICK_PERMISSIONS.map((item) => {
              const active = allowlistSet.has(item.pattern);
              return (
                <div key={item.pattern} className="rounded-xl border border-foreground/[0.08] bg-background/40 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-medium text-foreground/90">{item.label}</p>
                      <p className="text-[10px] text-muted-foreground/70">{item.pattern}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleQuickPattern(item.pattern)}
                      disabled={mutating}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[10px] font-medium",
                        active
                          ? "border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-200"
                          : "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                      )}
                    >
                      {active ? "Revoke" : "Grant"}
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">{item.why}</p>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="rounded-2xl border border-foreground/[0.08] bg-card/60 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <TerminalSquare className="h-3.5 w-3.5" />
              Exec Allowlist
            </h2>
            {loading && !snapshot ? (
              <div className="py-10 text-center text-[12px] text-muted-foreground/65">Loading permissions…</div>
            ) : scopedAllowlist.length === 0 ? (
              <div className="rounded-xl border border-dashed border-foreground/[0.08] px-3 py-8 text-center text-[12px] text-muted-foreground/65">
                No allowlist entries for this scope.
              </div>
            ) : (
              <div className="max-h-[480px] space-y-1.5 overflow-y-auto pr-0.5">
                {scopedAllowlist.map((entry) => (
                  <div
                    key={`${entry.agentId}-${entry.pattern}`}
                    className="rounded-xl border border-foreground/[0.08] bg-background/40 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[12px] text-foreground/90">{entry.pattern}</p>
                        <p className="text-[10px] text-muted-foreground/75">
                          agent: {entry.agentId} • last used: {formatAgo(entry.lastUsedAt)}
                        </p>
                        {(entry.lastUsedCommand || entry.lastResolvedPath) && (
                          <p className="truncate text-[10px] text-muted-foreground/65">
                            {entry.lastUsedCommand ? `cmd: ${entry.lastUsedCommand}` : ""}
                            {entry.lastUsedCommand && entry.lastResolvedPath ? " • " : ""}
                            {entry.lastResolvedPath ? `path: ${entry.lastResolvedPath}` : ""}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRevokePattern(entry.pattern)}
                        disabled={mutating}
                        className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/15 px-2 py-1 text-[10px] font-medium text-red-700 dark:text-red-200 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" />
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-foreground/[0.08] bg-card/60 p-3">
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tool Policy
            </h2>
            <p className="mb-2 text-[10px] text-muted-foreground/65">
              Mode: <code>{snapshot?.capabilities.toolPolicyMode || "unknown"}</code>
            </p>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-emerald-700/85 dark:text-emerald-200/85">Configured Allow</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(snapshot?.capabilities.allowedToolsConfigured || []).map((tool) => (
                  <span
                    key={`allow-${tool}`}
                    className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-100"
                  >
                    {tool}
                  </span>
                ))}
                {(snapshot?.capabilities.allowedToolsConfigured || []).length === 0 && (
                  <span className="text-[10px] text-emerald-700/80 dark:text-emerald-100/75">none (open mode)</span>
                )}
              </div>
            </div>
            <div className="mt-2 rounded-xl border border-zinc-500/20 bg-zinc-500/[0.04] p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-700/85 dark:text-zinc-300/85">Configured Deny</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(snapshot?.capabilities.deniedToolsConfigured || []).map((tool) => (
                  <span
                    key={`deny-${tool}`}
                    className="rounded-md border border-zinc-500/25 bg-zinc-500/12 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:text-zinc-200"
                  >
                    {tool}
                  </span>
                ))}
                {(snapshot?.capabilities.deniedToolsConfigured || []).length === 0 && (
                  <span className="text-[10px] text-zinc-700/80 dark:text-zinc-200/75">none</span>
                )}
              </div>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground/65">
              Approvals file: <code>{snapshot?.approvals.path || "unknown"}</code>
            </p>
          </section>
        </div>

        <section className="rounded-2xl border border-foreground/[0.08] bg-card/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Bell className="h-3.5 w-3.5" />
              Device Access
            </h2>
            <button
              type="button"
              onClick={() => void loadDevices()}
              disabled={devicesLoading || deviceMutating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] bg-card px-3 py-1.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-muted/80 disabled:opacity-60"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", (devicesLoading || deviceMutating) && "animate-spin")} />
              Refresh Devices
            </button>
          </div>

          <p className="mb-3 text-[10px] text-muted-foreground/65">
            Pairing and device tokens control which clients can access your gateway.
          </p>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-2.5">
              <h3 className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-200">
                <UserCheck className="h-3.5 w-3.5" />
                Pending Requests ({pendingDevices.length})
              </h3>
              {devicesLoading ? (
                <p className="text-[11px] text-muted-foreground/70">Loading device requests...</p>
              ) : pendingDevices.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/70">No pending pairing requests.</p>
              ) : (
                <div className="space-y-2">
                  {pendingDevices.map((request) => (
                    <div
                      key={request.requestId || request.deviceId}
                      className="rounded-lg border border-foreground/[0.08] bg-card/70 px-3 py-2 text-[11px]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground/90">
                            {request.displayName || request.platform || request.deviceId}
                          </p>
                          <p className="text-[10px] text-muted-foreground/70">
                            {request.clientMode || "unknown"} • role {request.requestedRole || "node"}
                          </p>
                        </div>
                        <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => approveDevice(request.requestId || request.deviceId)}
                          disabled={deviceMutating}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-200 disabled:opacity-50"
                        >
                          <UserCheck className="h-3 w-3" />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectDevice(request.requestId || request.deviceId)}
                          disabled={deviceMutating}
                          className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/15 px-2 py-1 text-[10px] font-medium text-red-700 dark:text-red-200 disabled:opacity-50"
                        >
                          <UserX className="h-3 w-3" />
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-foreground/[0.08] bg-background/40 p-2.5">
              <h3 className="mb-2 text-[11px] font-semibold text-foreground/85">
                Paired Devices ({pairedDevices.length})
              </h3>
              {devicesLoading ? (
                <p className="text-[11px] text-muted-foreground/70">Loading paired devices...</p>
              ) : pairedDevices.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/70">No paired devices.</p>
              ) : (
                <div className="max-h-[280px] space-y-2 overflow-y-auto pr-0.5">
                  {pairedDevices.map((device) => (
                    <div
                      key={device.deviceId}
                      className="rounded-lg border border-foreground/[0.08] bg-card/70 px-3 py-2 text-[11px]"
                    >
                      <p className="truncate font-medium text-foreground/90">
                        {device.displayName || device.platform || device.deviceId}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {device.clientMode || "unknown"} • {device.clientId || "client"}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {(device.roles || []).map((role) => (
                          <button
                            key={`${device.deviceId}:${role}`}
                            type="button"
                            onClick={() => revokeDeviceRole(device.deviceId, role)}
                            disabled={deviceMutating}
                            className="rounded-md border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-200 disabled:opacity-50"
                            title={`Revoke ${role} token`}
                          >
                            revoke:{role}
                          </button>
                        ))}
                        {(device.roles || []).length === 0 && (
                          <span className="text-[10px] text-muted-foreground/65">No roles reported.</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
