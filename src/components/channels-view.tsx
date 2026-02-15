"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Radio,
  Check,
  X,
  Smartphone,
  Monitor,
  Globe,
  Terminal,
  Shield,
  ShieldOff,
  Clock,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Bell,
  UserCheck,
  UserX,
  Key,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ────────────────────────────────────────── */

type Channel = {
  name: string;
  enabled: boolean;
  accounts: string[];
  dmPolicy: string;
  groupPolicy?: string;
};

type TokenInfo = {
  role: string;
  scopes: string[];
  createdAtMs: number;
  rotatedAtMs?: number;
  lastUsedAtMs: number;
};

type PairedDevice = {
  deviceId: string;
  displayName?: string;
  platform: string;
  clientId: string;
  clientMode: string;
  role: string;
  roles: string[];
  scopes: string[];
  tokens: TokenInfo[];
  createdAtMs: number;
  approvedAtMs: number;
};

type PendingRequest = {
  requestId: string;
  deviceId: string;
  displayName?: string;
  platform: string;
  clientId: string;
  clientMode: string;
  requestedRole: string;
  requestedScopes: string[];
  createdAtMs: number;
  expiresAtMs: number;
};

type Skill = {
  name: string;
  source: "workspace" | "system";
  version?: string;
  installedAt?: number;
};

type Toast = { message: string; type: "success" | "error" };

/* ── Helpers ──────────────────────────────────────── */

function formatAgo(ms: number): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeLeft(expiresMs: number): string {
  const left = expiresMs - Date.now();
  if (left <= 0) return "expired";
  const mins = Math.ceil(left / 60000);
  if (mins < 60) return `${mins}m left`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
}

function shortId(id: string): string {
  if (id.length > 16) return id.substring(0, 8) + "…" + id.substring(id.length - 4);
  return id;
}

const CLIENT_ICONS: Record<string, React.ReactNode> = {
  "openclaw-control-ui": <Globe className="h-5 w-5 text-cyan-400" />,
  "openclaw-macos": <Monitor className="h-5 w-5 text-violet-400" />,
  cli: <Terminal className="h-5 w-5 text-emerald-400" />,
};

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  iphone: <Smartphone className="h-5 w-5 text-blue-400" />,
  android: <Smartphone className="h-5 w-5 text-green-400" />,
};

function getDeviceIcon(device: { clientId: string; platform: string }) {
  if (CLIENT_ICONS[device.clientId]) return CLIENT_ICONS[device.clientId];
  const platform = device.platform.toLowerCase();
  for (const [key, icon] of Object.entries(PLATFORM_ICONS)) {
    if (platform.includes(key)) return icon;
  }
  return <Smartphone className="h-5 w-5 text-muted-foreground" />;
}

const MODE_LABELS: Record<string, string> = {
  webchat: "Web Chat",
  node: "Node",
  cli: "CLI",
  ui: "Desktop App",
};

const ROLE_COLORS: Record<string, string> = {
  node: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  operator: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
};

/* ── Pending Request Card ─────────────────────────── */

function PendingRequestCard({
  request,
  busy,
  onApprove,
  onReject,
}: {
  request: PendingRequest;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const isExpired = request.expiresAtMs <= now;

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        isExpired
          ? "border-zinc-800/50 bg-card/60 opacity-60"
          : "border-amber-500/20 bg-amber-500/[0.04]"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
          {getDeviceIcon(request)}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90">
              {request.displayName || request.platform || "Unknown device"}
            </span>
            {isExpired && (
              <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                Expired
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{MODE_LABELS[request.clientMode] || request.clientMode}</span>
            <span>{request.platform}</span>
            <span>
              Requesting:{" "}
              <span className="font-medium text-amber-400">
                {request.requestedRole}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {isExpired ? "Expired" : formatTimeLeft(request.expiresAtMs)}
            </span>
          </div>

          {request.requestedScopes.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {request.requestedScopes.map((s) => (
                <span
                  key={s}
                  className="rounded bg-muted/80 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="mt-1 text-[10px] text-muted-foreground/40">
            ID: {shortId(request.requestId || request.deviceId)}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            disabled={busy || isExpired}
            className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/15 disabled:opacity-40"
          >
            <UserX className="h-3 w-3" />
            Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy || isExpired}
            className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
          >
            <UserCheck className="h-3 w-3" />
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Paired Device Card ───────────────────────────── */

function PairedDeviceCard({
  device,
  busy,
  onRevoke,
}: {
  device: PairedDevice;
  busy: boolean;
  onRevoke: (role: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Most recent token usage
  const lastUsed = Math.max(0, ...device.tokens.map((t) => t.lastUsedAtMs || 0));
  const isRecent = now - lastUsed < 300000; // 5 min

  return (
    <div className="rounded-xl border border-foreground/[0.06] bg-card/80 transition-colors hover:bg-card">
      {/* Main row */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-4 px-4 py-3 text-left"
      >
        {/* Icon */}
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground/[0.03]">
          {getDeviceIcon(device)}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-foreground/90">
              {device.displayName || device.platform}
            </span>
            {/* Online indicator */}
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isRecent
                  ? "bg-emerald-400 shadow-[0_0_4px] shadow-emerald-400/50"
                  : "bg-muted"
              )}
              title={isRecent ? "Active recently" : "Inactive"}
            />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{MODE_LABELS[device.clientMode] || device.clientMode}</span>
            <span>{device.platform}</span>
            <span>Last seen {formatAgo(lastUsed)}</span>
          </div>
        </div>

        {/* Roles */}
        <div className="flex shrink-0 items-center gap-1.5">
          {device.roles.map((r) => (
            <span
              key={r}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                ROLE_COLORS[r] || "bg-muted/70 text-muted-foreground border-zinc-700"
              )}
            >
              {r === "node" ? (
                <Shield className="h-2.5 w-2.5" />
              ) : (
                <Key className="h-2.5 w-2.5" />
              )}
              {r}
            </span>
          ))}
        </div>

        {/* Expand toggle */}
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-foreground/[0.04] px-4 py-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
            <div>
              <span className="text-muted-foreground/60">Device ID</span>
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {device.deviceId}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground/60">Client</span>
              <p className="mt-0.5 text-muted-foreground">{device.clientId}</p>
            </div>
            <div>
              <span className="text-muted-foreground/60">Paired on</span>
              <p className="mt-0.5 text-muted-foreground">
                {formatDate(device.approvedAtMs || device.createdAtMs)}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground/60">Scopes</span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {device.scopes.length > 0 ? (
                  device.scopes.map((s) => (
                    <span
                      key={s}
                      className="rounded bg-muted/80 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                    >
                      {s}
                    </span>
                  ))
                ) : (
                  <span className="text-muted-foreground/60">none</span>
                )}
              </div>
            </div>
          </div>

          {/* Tokens */}
          <div className="mt-3">
            <h4 className="mb-2 text-[11px] font-medium text-muted-foreground">
              Tokens ({device.tokens.length})
            </h4>
            <div className="space-y-1.5">
              {device.tokens.map((tok) => (
                <div
                  key={tok.role}
                  className="flex items-center gap-3 rounded-lg border border-foreground/[0.04] bg-foreground/[0.02] px-3 py-2"
                >
                  <Key className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          ROLE_COLORS[tok.role] ||
                            "bg-muted/70 text-muted-foreground border-zinc-700"
                        )}
                      >
                        {tok.role}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">
                        Last used {formatAgo(tok.lastUsedAtMs)}
                      </span>
                      {tok.rotatedAtMs && (
                        <span className="text-[10px] text-muted-foreground/40">
                          · Rotated {formatAgo(tok.rotatedAtMs)}
                        </span>
                      )}
                    </div>
                    {tok.scopes.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {tok.scopes.map((s) => (
                          <span
                            key={s}
                            className="rounded bg-muted/60 px-1 py-0.5 text-[9px] text-muted-foreground/60"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Revoke */}
                  {confirmRevoke === tok.role ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[10px] text-red-400">Revoke?</span>
                      <button
                        type="button"
                        onClick={() => {
                          onRevoke(tok.role);
                          setConfirmRevoke(null);
                        }}
                        disabled={busy}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRevoke(null)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRevoke(tok.role)}
                      disabled={busy}
                      className="shrink-0 rounded-lg p-1.5 text-muted-foreground/40 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 disabled:opacity-40"
                      title={`Revoke ${tok.role} token`}
                      style={{ opacity: 1 }}
                    >
                      <ShieldOff className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Unpair all button */}
          <div className="mt-3 flex justify-end">
            <UnpairButton
              device={device}
              busy={busy}
              onRevoke={onRevoke}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Unpair (revoke all roles) button ─────────────── */

function UnpairButton({
  device,
  busy,
  onRevoke,
}: {
  device: PairedDevice;
  busy: boolean;
  onRevoke: (role: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-red-400">
          Revoke all tokens and unpair this device?
        </span>
        <button
          type="button"
          onClick={() => {
            for (const tok of device.tokens) {
              onRevoke(tok.role);
            }
            setConfirming(false);
          }}
          disabled={busy}
          className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-40"
        >
          <ShieldOff className="h-3 w-3" />
          Confirm Unpair
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      disabled={busy}
      className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-400 transition-colors hover:bg-red-500/15 disabled:opacity-40"
    >
      <ShieldOff className="h-3 w-3" />
      Unpair Device
    </button>
  );
}

/* ── Main ChannelsView ────────────────────────────── */

export function ChannelsView() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ message, type });
      toastTimer.current = setTimeout(() => setToast(null), 4000);
    },
    []
  );

  /* ── Fetch system data (channels, skills) ──── */
  useEffect(() => {
    fetch("/api/system")
      .then((r) => r.json())
      .then((data) => {
        setChannels(data.channels || []);
        setSkills(data.skills || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  /* ── Fetch devices (paired + pending) ──────── */
  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch("/api/devices");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPairedDevices(data.paired || []);
      setPendingRequests(data.pending || []);
    } catch (err) {
      console.error("Failed to fetch devices:", err);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    // Poll for pending requests every 10s
    const interval = setInterval(fetchDevices, 10000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  /* ── Device actions ────────────────────────── */
  const deviceAction = useCallback(
    async (body: Record<string, unknown>, successMsg: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        flash(successMsg);
        await fetchDevices();
      } catch (err) {
        flash(String(err), "error");
      } finally {
        setBusy(false);
      }
    },
    [fetchDevices, flash]
  );

  const approveRequest = useCallback(
    (requestId: string) => {
      deviceAction(
        { action: "approve", requestId },
        "Device pairing approved"
      );
    },
    [deviceAction]
  );

  const rejectRequest = useCallback(
    (requestId: string) => {
      deviceAction(
        { action: "reject", requestId },
        "Device pairing rejected"
      );
    },
    [deviceAction]
  );

  const revokeToken = useCallback(
    (deviceId: string, role: string) => {
      deviceAction(
        { action: "revoke", deviceId, role },
        `Token revoked (${role})`
      );
    },
    [deviceAction]
  );

  if (loading && devicesLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
        Loading...
      </div>
    );
  }

  const workspaceSkills = skills.filter((s) => s.source === "workspace");
  const systemSkills = skills.filter((s) => s.source === "system");

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-8 px-4 md:px-6 py-6">
        {/* ── Pending Requests ──────────── */}
        {pendingRequests.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-foreground/90">
                Pairing Requests
              </h2>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                {pendingRequests.length}
              </span>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground/60">
              Devices requesting to pair with your OpenClaw Gateway. Approve to
              grant access or reject to deny. Requests expire after 5 minutes.
            </p>
            <div className="space-y-2">
              {pendingRequests.map((req) => (
                <PendingRequestCard
                  key={req.requestId || req.deviceId}
                  request={req}
                  busy={busy}
                  onApprove={() =>
                    approveRequest(req.requestId || req.deviceId)
                  }
                  onReject={() =>
                    rejectRequest(req.requestId || req.deviceId)
                  }
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Paired Devices ───────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-foreground/90">
                Paired Devices
              </h2>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {pairedDevices.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setDevicesLoading(true);
                fetchDevices();
              }}
              disabled={busy}
              className="flex items-center gap-1 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] disabled:opacity-40"
            >
              <RefreshCw
                className={cn(
                  "h-3 w-3",
                  devicesLoading && "animate-spin"
                )}
              />
              Refresh
            </button>
          </div>

          {pendingRequests.length === 0 && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-foreground/[0.04] bg-foreground/[0.01] px-3 py-2 text-[11px] text-muted-foreground/60">
              <Bell className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              No pending pairing requests. New device requests will appear here
              automatically.
            </div>
          )}

          {devicesLoading && pairedDevices.length === 0 ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground/60">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading devices...
            </div>
          ) : pairedDevices.length === 0 ? (
            <p className="text-sm text-muted-foreground/60">No paired devices</p>
          ) : (
            <div className="space-y-2">
              {pairedDevices.map((d) => (
                <PairedDeviceCard
                  key={d.deviceId}
                  device={d}
                  busy={busy}
                  onRevoke={(role) => revokeToken(d.deviceId, role)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Channels ─────────────────── */}
        <section>
          <h2 className="mb-4 text-sm font-semibold text-foreground/90">
            Channels
          </h2>
          <div className="space-y-3">
            {channels.map((ch) => (
              <div
                key={ch.name}
                className="rounded-xl border border-foreground/[0.06] bg-card/90 p-4"
              >
                <div className="flex items-center gap-3">
                  <Radio
                    className={cn(
                      "h-5 w-5",
                      ch.enabled ? "text-emerald-400" : "text-muted-foreground/60"
                    )}
                  />
                  <div>
                    <p className="text-sm font-semibold capitalize text-foreground">
                      {ch.name}
                    </p>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        {ch.enabled ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <X className="h-3 w-3 text-red-400" />
                        )}
                        {ch.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <span>DM: {ch.dmPolicy}</span>
                      {ch.groupPolicy && (
                        <span>Group: {ch.groupPolicy}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ch.accounts.map((acc) => (
                    <span
                      key={acc}
                      className="rounded-md border border-foreground/[0.06] bg-muted/70 px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      {acc}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {channels.length === 0 && (
              <p className="text-sm text-muted-foreground/60">No channels configured</p>
            )}
          </div>
        </section>

        {/* ── Skills ───────────────────── */}
        <section>
          <h2 className="mb-4 text-sm font-semibold text-foreground/90">
            Installed Skills ({skills.length})
          </h2>

          {workspaceSkills.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Workspace Skills
              </h3>
              <div className="flex flex-wrap gap-2">
                {workspaceSkills.map((s) => (
                  <div
                    key={s.name}
                    className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2"
                  >
                    <p className="text-[12px] font-medium text-violet-300">
                      {s.name}
                    </p>
                    {s.version && (
                      <p className="text-[10px] text-muted-foreground">
                        v{s.version}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
              System Skills
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {systemSkills.map((s) => (
                <span
                  key={s.name}
                  className="rounded-md border border-foreground/[0.06] bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground"
                >
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        </section>
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
