"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Bell,
  BellRing,
  Shield,
  ShieldCheck,
  ShieldX,
  Smartphone,
  MessageCircle,
  Check,
  X,
  Loader2,
  Clock,
  Monitor,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ────────────────────────────────────────── */

type DmRequest = {
  channel: string;
  code: string;
  senderId?: string;
  senderName?: string;
  message?: string;
  createdAt?: string;
  expiresAt?: string;
};

type DeviceRequest = {
  requestId: string;
  deviceId?: string;
  displayName?: string;
  platform?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  createdAtMs?: number;
};

type PairingData = {
  dm: DmRequest[];
  devices: DeviceRequest[];
  total: number;
};

/* ── Helpers ──────────────────────────────────────── */

const CHANNEL_ICONS: Record<string, string> = {
  telegram: "\u{1F4AC}",
  whatsapp: "\u{1F4F1}",
  discord: "\u{1F3AE}",
  slack: "\u{1F4BC}",
  signal: "\u{1F510}",
  imessage: "\u{1F4AC}",
};

const CHANNEL_COLORS: Record<string, string> = {
  telegram: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  whatsapp: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  discord: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  slack: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  signal: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

function formatTimeAgo(dateStr?: string, ms?: number): string {
  const ts = ms || (dateStr ? new Date(dateStr).getTime() : 0);
  if (!ts) return "";
  const ago = Date.now() - ts;
  if (ago < 60000) return "just now";
  if (ago < 3600000) return Math.floor(ago / 60000) + "m ago";
  if (ago < 86400000) return Math.floor(ago / 3600000) + "h ago";
  return Math.floor(ago / 86400000) + "d ago";
}

function platformIcon(platform?: string) {
  if (!platform) return Monitor;
  const p = platform.toLowerCase();
  if (p.includes("iphone") || p.includes("ios") || p.includes("android"))
    return Smartphone;
  if (p.includes("mac") || p.includes("darwin") || p.includes("linux"))
    return Monitor;
  return Globe;
}

/* ── DM Request Card ──────────────────────────────── */

function DmRequestCard({
  req,
  onApprove,
  busy,
}: {
  req: DmRequest;
  onApprove: () => void;
  busy: boolean;
}) {
  const icon = CHANNEL_ICONS[req.channel] || "\u{1F4E8}";
  const colorClass =
    CHANNEL_COLORS[req.channel] || "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-all hover:border-white/[0.1]">
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm",
            colorClass
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold capitalize text-zinc-200">
              {req.channel}
            </span>
            <MessageCircle className="h-3 w-3 text-zinc-600" />
            <span className="text-[10px] text-zinc-600">DM pairing</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <code className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-bold tracking-wider text-violet-300">
              {req.code}
            </code>
            {req.senderName && (
              <span className="text-[11px] text-zinc-500">
                from {req.senderName}
              </span>
            )}
            {!req.senderName && req.senderId && (
              <span className="text-[11px] text-zinc-500">
                ID: {req.senderId}
              </span>
            )}
          </div>
          {req.message && (
            <p className="mt-1 line-clamp-1 text-[10px] text-zinc-600 italic">
              &ldquo;{req.message}&rdquo;
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            {req.createdAt && (
              <span className="flex items-center gap-1 text-[9px] text-zinc-600">
                <Clock className="h-2.5 w-2.5" />
                {formatTimeAgo(req.createdAt)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={onApprove}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ShieldCheck className="h-3 w-3" />
          )}
          Approve
        </button>
      </div>
    </div>
  );
}

/* ── Device Request Card ─────────────────────────── */

function DeviceRequestCard({
  req,
  onApprove,
  onReject,
  busy,
}: {
  req: DeviceRequest;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const PlatformIcon = platformIcon(req.platform);
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-all hover:border-white/[0.1]">
      <div className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/20 text-amber-400">
          <PlatformIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-zinc-200">
              {req.displayName || req.clientId || "Unknown Device"}
            </span>
            <Smartphone className="h-3 w-3 text-zinc-600" />
            <span className="text-[10px] text-zinc-600">Device pairing</span>
          </div>
          {req.platform && (
            <p className="mt-0.5 text-[11px] text-zinc-500">{req.platform}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {req.role && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">
                {req.role}
              </span>
            )}
            {req.clientMode && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">
                {req.clientMode}
              </span>
            )}
            {req.createdAtMs && (
              <span className="flex items-center gap-1 text-[9px] text-zinc-600">
                <Clock className="h-2.5 w-2.5" />
                {formatTimeAgo(undefined, req.createdAtMs)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={onApprove}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ShieldCheck className="h-3 w-3" />
          )}
          Approve
        </button>
        <button
          onClick={onReject}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.06] py-1.5 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/[0.12] disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ShieldX className="h-3 w-3" />
          )}
          Reject
        </button>
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────── */

export function PairingNotifications() {
  const [data, setData] = useState<PairingData | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);
  const [hasNew, setHasNew] = useState(false);
  const prevCountRef = useRef(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Fetch ─────────── */
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/pairing");
      const d = (await res.json()) as PairingData;
      setData(d);

      // Flash the bell if count increased
      if (d.total > prevCountRef.current && prevCountRef.current >= 0) {
        setHasNew(true);
      }
      prevCountRef.current = d.total;
    } catch {
      // silent
    }
  }, []);

  // Initial fetch + poll every 15s
  useEffect(() => {
    fetchData();
    pollRef.current = setInterval(fetchData, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchData]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Clear "new" indicator when dropdown opens
  useEffect(() => {
    if (open) setHasNew(false);
  }, [open]);

  /* ── Actions ───────── */

  const approveDm = useCallback(
    async (channel: string, code: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/pairing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve-dm", channel, code }),
        });
        const d = await res.json();
        if (d.ok) {
          setToast({ msg: `${channel} sender approved`, type: "success" });
          await fetchData();
        } else {
          setToast({ msg: d.error || "Approve failed", type: "error" });
        }
      } catch (err) {
        setToast({ msg: String(err), type: "error" });
      } finally {
        setBusy(false);
      }
    },
    [fetchData]
  );

  const approveDevice = useCallback(
    async (requestId: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/pairing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve-device", requestId }),
        });
        const d = await res.json();
        if (d.ok) {
          setToast({ msg: "Device approved", type: "success" });
          await fetchData();
        } else {
          setToast({ msg: d.error || "Approve failed", type: "error" });
        }
      } catch (err) {
        setToast({ msg: String(err), type: "error" });
      } finally {
        setBusy(false);
      }
    },
    [fetchData]
  );

  const rejectDevice = useCallback(
    async (requestId: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/pairing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject-device", requestId }),
        });
        const d = await res.json();
        if (d.ok) {
          setToast({ msg: "Device rejected", type: "success" });
          await fetchData();
        } else {
          setToast({ msg: d.error || "Reject failed", type: "error" });
        }
      } catch (err) {
        setToast({ msg: String(err), type: "error" });
      } finally {
        setBusy(false);
      }
    },
    [fetchData]
  );

  /* ── Toast auto-clear ── */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const count = data?.total || 0;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
          count > 0
            ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            : "border-white/[0.08] bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60"
        )}
        aria-label={`Pairing requests: ${count}`}
      >
        {count > 0 ? (
          <BellRing
            className={cn(
              "h-3.5 w-3.5",
              hasNew && "animate-[ring_0.5s_ease-in-out_3]"
            )}
          />
        ) : (
          <Bell className="h-3.5 w-3.5" />
        )}

        {/* Badge */}
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow-lg shadow-red-500/30">
            {count}
          </span>
        )}

        {/* Pulse ring when new */}
        {hasNew && count > 0 && (
          <span className="absolute inset-0 animate-ping rounded-lg border border-amber-400/40" />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[380px] overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-900/95 shadow-2xl backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-violet-400" />
              <span className="text-[13px] font-semibold text-zinc-200">
                Pairing Requests
              </span>
              {count > 0 && (
                <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                  {count}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-zinc-600 transition-colors hover:text-zinc-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Content */}
          <div className="max-h-[420px] overflow-y-auto">
            {count === 0 ? (
              <div className="px-4 py-8 text-center">
                <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-emerald-500/40" />
                <p className="text-[13px] font-medium text-zinc-400">
                  All clear
                </p>
                <p className="mt-1 text-[11px] text-zinc-600">
                  No pending pairing requests. When someone tries to DM your
                  bot or a new device connects, it will show up here.
                </p>
              </div>
            ) : (
              <div className="space-y-2 p-3">
                {/* DM requests */}
                {(data?.dm || []).map((req) => (
                  <DmRequestCard
                    key={`dm-${req.channel}-${req.code}`}
                    req={req}
                    onApprove={() => approveDm(req.channel, req.code)}
                    busy={busy}
                  />
                ))}

                {/* Device requests */}
                {(data?.devices || []).map((req) => (
                  <DeviceRequestCard
                    key={`dev-${req.requestId}`}
                    req={req}
                    onApprove={() => approveDevice(req.requestId)}
                    onReject={() => rejectDevice(req.requestId)}
                    busy={busy}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-white/[0.06] px-4 py-2">
            <p className="text-[10px] text-zinc-600">
              Polling every 15s &middot; DM codes expire after 1 hour
            </p>
          </div>

          {/* Toast */}
          {toast && (
            <div
              className={cn(
                "absolute bottom-10 left-1/2 z-10 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-[11px] font-medium shadow-lg",
                toast.type === "success"
                  ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-300"
                  : "border-red-500/30 bg-red-950/90 text-red-300"
              )}
            >
              <div className="flex items-center gap-1.5">
                {toast.type === "success" ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <X className="h-3 w-3" />
                )}
                {toast.msg}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
