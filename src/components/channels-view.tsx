"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Check,
  X,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Rocket,
  Play,
  Plug,
  Plus,
  Bell,
  Monitor,
  Shield,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import { QrLoginModal } from "@/components/qr-login-modal";

/* ── Types ────────────────────────────────────────── */

type ChannelRuntimeStatus = {
  channel: string;
  account: string;
  status: string;
  linked?: boolean;
  connected?: boolean;
  error?: string;
};

type ChannelCatalogItem = {
  channel: string;
  label: string;
  icon: string;
  setupType: "qr" | "token" | "cli" | "auto";
  setupCommand: string;
  setupHint: string;
  configHint?: string;
  tokenLabel?: string;
  tokenPlaceholder?: string;
  docsUrl?: string;
  enabled: boolean;
  configured: boolean;
  accounts: string[];
  statuses: ChannelRuntimeStatus[];
  dmPolicy?: string;
  groupPolicy?: string;
};

type DmPairingRequest = {
  channel: string;
  code: string;
  senderId?: string;
  senderName?: string;
  message?: string;
  createdAt?: string;
};

type DevicePairingRequest = {
  requestId: string;
  displayName?: string;
  platform?: string;
  role?: string;
  roles?: string[];
  createdAtMs?: number;
};

type PairedDevice = {
  deviceId: string;
  displayName?: string;
  platform: string;
  role: string;
  roles: string[];
  createdAtMs: number;
  approvedAtMs: number;
};

type Toast = { message: string; type: "success" | "error" };

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        /^https?:\/\/[^\s]+$/.test(part) ? (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-violet-400/60 underline-offset-2 transition-colors hover:text-violet-300"
          >
            {part}
          </a>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </span>
  );
}

function getPostSetupChecklist(channel: string): string[] {
  switch (channel) {
    case "discord":
      return [
        "Create/configure your app in https://discord.com/developers/applications and enable Message Content Intent.",
        "Invite the bot to your server with message permissions (or use DMs).",
        "The gateway restarts automatically on config changes.",
        "Send a DM to the bot (or message it in a server channel where it has access).",
        "If DM policy is pairing, new contacts will appear in the Pending Pairings section below for approval.",
      ];
    case "telegram":
      return [
        "Create/verify token with https://t.me/BotFather and ensure it is configured.",
        "The gateway restarts automatically on config changes.",
        "Open Telegram and send a message to your bot.",
        "If DM policy is pairing, new contacts will appear in the Pending Pairings section below for approval.",
        "Optional: add the bot to a group and mention it to validate group routing.",
      ];
    case "whatsapp":
      return [
        "After QR linking, the gateway stays running automatically.",
        "Message the linked WhatsApp identity from an allowed number.",
        "If DM policy is pairing, new contacts will appear in the Pending Pairings section below for approval.",
        "For stable ops, use a dedicated WhatsApp number when possible.",
      ];
    case "slack":
      return [
        "Open https://api.slack.com/apps and confirm Socket Mode is enabled.",
        "Confirm the Slack app is installed to your workspace and required scopes are granted.",
        "Invite the bot to a channel (or DM it directly).",
        "The gateway restarts automatically on config changes.",
        "Send a test message and confirm a reply in the same channel.",
      ];
    default:
      return [
        "The gateway restarts automatically on config changes.",
        "Send a test message to this channel integration.",
        "If pairing is enabled, new contacts will appear in the Pending Pairings section below for approval.",
        "Channel status is shown live on this page.",
      ];
  }
}

export function ChannelsView() {
  const [channels, setChannels] = useState<ChannelCatalogItem[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardChannel, setWizardChannel] = useState("");
  const [wizardToken, setWizardToken] = useState("");
  const [wizardAppToken, setWizardAppToken] = useState("");
  const [wizardAccount, setWizardAccount] = useState("");
  const [wizardRunning, setWizardRunning] = useState(false);
  const [wizardOutput, setWizardOutput] = useState("");
  const [wizardError, setWizardError] = useState("");

  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrChannel, setQrChannel] = useState<"whatsapp" | "signal">("whatsapp");

  // Pairing & Devices
  const [dmPairings, setDmPairings] = useState<DmPairingRequest[]>([]);
  const [devicePairings, setDevicePairings] = useState<DevicePairingRequest[]>([]);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [pairingBusy, setPairingBusy] = useState<string | null>(null);
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((message: string, type: "success" | "error" = "success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/channels?scope=all", { cache: "no-store" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChannels((data.channels || []) as ChannelCatalogItem[]);
    } catch (err) {
      flash(String(err), "error");
    } finally {
      setChannelsLoading(false);
    }
  }, [flash]);

  const fetchPairings = useCallback(async () => {
    try {
      const res = await fetch("/api/pairing", { cache: "no-store" });
      const data = await res.json();
      setDmPairings((data.dm || []) as DmPairingRequest[]);
      setDevicePairings((data.devices || []) as DevicePairingRequest[]);
    } catch {
      // silently degrade
    }
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      const data = await res.json();
      setPairedDevices((data.paired || []) as PairedDevice[]);
    } catch {
      // silently degrade
    }
  }, []);

  useEffect(() => {
    void fetchChannels();
    void fetchPairings();
    void fetchDevices();
  }, [fetchChannels, fetchPairings, fetchDevices]);

  const runChannelAction = useCallback(
    async (body: Record<string, unknown>, successMsg: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        flash(successMsg);
        await fetchChannels();
      } catch (err) {
        flash(String(err), "error");
      } finally {
        setBusy(false);
      }
    },
    [fetchChannels, flash]
  );

  const approveDmPairing = useCallback(
    async (channel: string, code: string) => {
      setPairingBusy(`dm:${channel}:${code}`);
      try {
        const res = await fetch("/api/pairing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve-dm", channel, code }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        flash(`Approved pairing for ${channel}`);
        await fetchPairings();
      } catch (err) {
        flash(String(err), "error");
      } finally {
        setPairingBusy(null);
      }
    },
    [flash, fetchPairings]
  );

  const handleDeviceAction = useCallback(
    async (action: "approve" | "reject" | "revoke", id: string, role?: string) => {
      setPairingBusy(`device:${action}:${id}`);
      try {
        const endpoint = action === "revoke" ? "/api/devices" : "/api/pairing";
        const body: Record<string, unknown> =
          action === "revoke"
            ? { action: "revoke", deviceId: id, role: role || "user" }
            : { action: `${action}-device`, requestId: id };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        flash(`Device ${action}d`);
        await Promise.all([fetchPairings(), fetchDevices()]);
      } catch (err) {
        flash(String(err), "error");
      } finally {
        setPairingBusy(null);
      }
    },
    [flash, fetchPairings, fetchDevices]
  );

  const setChannelPolicy = useCallback(
    async (channel: string, field: "dmPolicy" | "groupPolicy", value: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set-policy", channel, [field]: value }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        flash(`${field === "dmPolicy" ? "DM" : "Group"} policy updated for ${channel}`);
        await fetchChannels();
      } catch (err) {
        flash(String(err), "error");
      } finally {
        setBusy(false);
      }
    },
    [flash, fetchChannels]
  );

  const toggleChannelExpanded = useCallback((channel: string) => {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  }, []);

  const setupCandidates = channels.filter((ch) => !ch.configured && ch.setupType !== "auto");
  const selectedWizardChannel = channels.find((ch) => ch.channel === wizardChannel) || null;
  const requiresAppToken = selectedWizardChannel?.channel === "slack";
  const needsToken = selectedWizardChannel?.setupType === "token";
  const canRunWizard =
    !!selectedWizardChannel &&
    (selectedWizardChannel.setupType !== "token" ||
      (wizardToken.trim().length > 0 && (!requiresAppToken || wizardAppToken.trim().length > 0)));

  const openWizard = useCallback(
    (channelId?: string) => {
      const fallback = setupCandidates[0]?.channel || channels[0]?.channel || "";
      const targetChannel = channelId || fallback;
      setWizardChannel(targetChannel);
      // If user clicked Setup/Reconfigure on a specific channel, jump directly to Configure.
      // Keep step 1 only for generic "Add Channel".
      setWizardStep(channelId ? 2 : 1);
      setWizardToken("");
      setWizardAppToken("");
      setWizardAccount("");
      setWizardOutput("");
      setWizardError("");
      setWizardOpen(true);
    },
    [channels, setupCandidates]
  );

  const runWizardSetup = useCallback(async () => {
    if (!selectedWizardChannel) return;
    setWizardRunning(true);
    setWizardError("");
    setWizardOutput("");

    try {
      if (selectedWizardChannel.setupType === "auto") {
        setWizardOutput("No setup required. This channel is available automatically.");
        setWizardStep(3);
        return;
      }

      const account = wizardAccount.trim();
      const setupCommand = selectedWizardChannel.setupCommand.toLowerCase();
      const needsLogin =
        selectedWizardChannel.setupType === "qr" ||
        setupCommand.includes("channels login");

      const payload: Record<string, unknown> = {
        action: needsLogin ? "login" : "add",
        channel: selectedWizardChannel.channel,
      };
      if (account) payload.account = account;

      if (selectedWizardChannel.setupType === "token") {
        if (!wizardToken.trim()) {
          throw new Error(`${selectedWizardChannel.tokenLabel || "Token"} is required.`);
        }
        payload.token = wizardToken.trim();
        if (wizardAppToken.trim()) payload.appToken = wizardAppToken.trim();
      }

      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.interactive) {
        // For WhatsApp/Signal: open the QR login modal instead of
        // telling the user to switch to the Terminal.
        const ch = selectedWizardChannel.channel;
        if (ch === "whatsapp" || ch === "signal") {
          setQrChannel(ch as "whatsapp" | "signal");
          setQrModalOpen(true);
          setWizardRunning(false);
          return;
        }
        setWizardOutput(
          data.message ||
            "Interactive login is required. Run the command below in the Terminal tab."
        );
      } else {
        setWizardOutput(
          typeof data.output === "string" && data.output.trim().length > 0
            ? data.output
            : `${selectedWizardChannel.label} setup command completed.`
        );
      }

      // Idempotent: if setup worked, ensure channel is enabled.
      await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable", channel: selectedWizardChannel.channel }),
      }).catch(() => null);

      await fetchChannels();
      setWizardStep(3);
      flash(
        data.interactive
          ? `${selectedWizardChannel.label}: continue in Terminal for interactive login`
          : `${selectedWizardChannel.label} configured`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setWizardError(message);
      flash(message, "error");
    } finally {
      setWizardRunning(false);
    }
  }, [
    fetchChannels,
    flash,
    selectedWizardChannel,
    wizardAccount,
    wizardAppToken,
    wizardToken,
  ]);

  const statusTone = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes("connected") || s.includes("ready") || s.includes("online") || s.includes("idle")) {
      return "text-emerald-400";
    }
    if (s.includes("error") || s.includes("failed") || s.includes("offline") || s.includes("not-configured")) {
      return "text-red-400";
    }
    return "text-amber-400";
  };

  if (channelsLoading) {
    return <LoadingState label="Loading channels..." />;
  }

  return (
    <SectionLayout>
      <SectionBody width="narrow" padding="roomy" innerClassName="space-y-8">
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xs font-semibold text-foreground/90">Channels</h2>
              <p className="mt-0.5 text-xs text-muted-foreground/70">
                Connect and manage Discord, Telegram, WhatsApp, Slack, and more.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setChannelsLoading(true);
                  void fetchChannels();
                }}
                disabled={busy || channelsLoading}
                className="flex items-center gap-1 rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 disabled:opacity-40"
              >
                {channelsLoading ? (
                  <span className="inline-flex items-center gap-0.5">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                  </span>
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Refresh
              </button>
              <button
                type="button"
                onClick={() => openWizard()}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Channel
              </button>
            </div>
          </div>

          {wizardOpen && (
            <div className="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-violet-300" />
                  <h3 className="text-sm font-semibold text-foreground/90">Channel Setup Wizard</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setWizardOpen(false)}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground/80"
                >
                  Close
                </button>
              </div>

              <div className="mb-3 flex items-center gap-2 text-xs">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border text-xs font-semibold",
                        wizardStep >= step
                          ? "border-violet-400/40 bg-violet-500/20 text-violet-200"
                          : "border-foreground/10 bg-muted text-muted-foreground"
                      )}
                    >
                      {step}
                    </span>
                    <span className="text-muted-foreground">
                      {step === 1 ? "Choose" : step === 2 ? "Configure" : "Finish"}
                    </span>
                    {step < 3 && <span className="text-muted-foreground/40">→</span>}
                  </div>
                ))}
              </div>

              {wizardStep === 1 && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Pick a channel to connect. The wizard will guide you through required steps.
                  </p>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {channels.map((ch) => (
                      <button
                        key={ch.channel}
                        type="button"
                        onClick={() => setWizardChannel(ch.channel)}
                        className={cn(
                          "flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                          wizardChannel === ch.channel
                            ? "border-violet-500/30 bg-violet-500/10"
                            : "border-foreground/10 bg-card/60 hover:bg-card"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-xs">{ch.icon}</span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-foreground/90">{ch.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {ch.setupType === "token"
                                ? "Token setup"
                                : ch.setupType === "qr"
                                  ? "Interactive login"
                                  : ch.setupType === "auto"
                                    ? "Built in"
                                    : "CLI setup"}
                            </p>
                          </div>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            ch.configured
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-amber-500/15 text-amber-300"
                          )}
                        >
                          {ch.configured ? "Configured" : "Needs setup"}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      disabled={!selectedWizardChannel}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium transition-colors hover:bg-primary/90 disabled:opacity-40"
                    >
                      Next
                      <Play className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}

              {wizardStep === 2 && selectedWizardChannel && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-foreground/10 bg-card/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{selectedWizardChannel.icon}</span>
                        <div>
                          <p className="text-xs font-semibold text-foreground/90">{selectedWizardChannel.label}</p>
                        </div>
                      </div>
                      {selectedWizardChannel.docsUrl && (
                        <a
                          href={selectedWizardChannel.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-foreground/10 bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground/80"
                        >
                          Docs
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="mt-2 rounded-md border border-violet-500/25 bg-violet-500/10 px-3 py-2.5">
                      <p className="text-sm font-medium leading-relaxed text-foreground/95">
                        <LinkifiedText text={selectedWizardChannel.setupHint} />
                      </p>
                    </div>
                    {selectedWizardChannel.setupCommand && (
                      <div className="mt-2 rounded-md border border-foreground/10 bg-muted/60 px-2 py-1.5 font-mono text-xs text-muted-foreground">
                        {selectedWizardChannel.setupCommand}
                      </div>
                    )}
                    {selectedWizardChannel.configHint && (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground/90">
                        <LinkifiedText text={selectedWizardChannel.configHint} />
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {needsToken && (
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                          {selectedWizardChannel.tokenLabel || "Token"}
                        </span>
                        <input
                          value={wizardToken}
                          onChange={(e) => setWizardToken(e.target.value)}
                          type="password"
                          placeholder={selectedWizardChannel.tokenPlaceholder || "Paste token"}
                          className="w-full rounded-md border border-foreground/10 bg-muted px-2.5 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                        />
                      </label>
                    )}
                    {requiresAppToken && (
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                          App Token
                        </span>
                        <input
                          value={wizardAppToken}
                          onChange={(e) => setWizardAppToken(e.target.value)}
                          type="password"
                          placeholder="xapp-..."
                          className="w-full rounded-md border border-foreground/10 bg-muted px-2.5 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                        />
                      </label>
                    )}
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                        Account (optional)
                      </span>
                      <input
                        value={wizardAccount}
                        onChange={(e) => setWizardAccount(e.target.value)}
                        placeholder="default"
                        className="w-full rounded-md border border-foreground/10 bg-muted px-2.5 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30"
                      />
                    </label>
                  </div>

                  {wizardError && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      {wizardError}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="rounded-lg border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void runWizardSetup()}
                      disabled={!canRunWizard || wizardRunning}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium transition-colors hover:bg-primary/90 disabled:opacity-40"
                    >
                      {wizardRunning ? (
                        <>
                          <span className="inline-flex items-center gap-0.5">
                            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                          </span>
                          Running...
                        </>
                      ) : (
                        <>
                          <Plug className="h-3 w-3" />
                          Run Setup
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {wizardStep === 3 && selectedWizardChannel && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    Setup run completed for <span className="font-semibold">{selectedWizardChannel.label}</span>.
                    {selectedWizardChannel.setupType === "qr" && " If interactive login is required, continue in Terminal."}
                  </div>
                  <div className="rounded-lg border border-foreground/10 bg-card/70 px-3 py-2.5">
                    <p className="text-xs font-semibold text-foreground/90">
                      What to do now
                    </p>
                    <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-muted-foreground">
                      {getPostSetupChecklist(selectedWizardChannel.channel).map((step, idx) => (
                        <li key={`${selectedWizardChannel.channel}-post-step-${idx}`}>
                          <span>
                            <LinkifiedText text={step} />
                          </span>
                        </li>
                      ))}
                    </ol>
                    {selectedWizardChannel.docsUrl && (
                      <a
                        href={selectedWizardChannel.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-violet-300 transition-colors hover:text-violet-200"
                      >
                        Open channel docs
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {wizardOutput && (
                    <pre className="max-h-40 overflow-auto rounded-lg border border-foreground/10 bg-card px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
                      {wizardOutput}
                    </pre>
                  )}
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="rounded-lg border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5"
                    >
                      Reconfigure
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openWizard()}
                        className="rounded-lg border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5"
                      >
                        Setup Another
                      </button>
                      <Link
                        href="/terminal"
                        className="inline-flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium transition-colors hover:bg-primary/90"
                      >
                        Open Terminal
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            {channels.map((ch) => (
              <div
                key={ch.channel}
                className="rounded-xl border border-foreground/10 bg-card/90 p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs">{ch.icon}</span>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{ch.label}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        {ch.enabled ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <X className="h-3 w-3 text-red-400" />
                        )}
                        {ch.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <span>{ch.configured ? "Configured" : "Not configured"}</span>
                      <span className="capitalize">{ch.setupType} setup</span>
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {ch.docsUrl && (
                      <a
                        href={ch.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground/80"
                      >
                        Docs
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => openWizard(ch.channel)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                    >
                      {ch.configured ? "Reconfigure" : "Setup"}
                    </button>
                    {ch.configured && (
                      <button
                        type="button"
                        onClick={() =>
                          void runChannelAction(
                            { action: ch.enabled ? "disable" : "enable", channel: ch.channel },
                            `${ch.label} ${ch.enabled ? "disabled" : "enabled"}`
                          )
                        }
                        disabled={busy}
                        className="rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 disabled:opacity-40"
                      >
                        {ch.enabled ? "Disable" : "Enable"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {ch.accounts.map((acc) => (
                    <span
                      key={acc}
                      className="rounded-md border border-foreground/10 bg-muted/70 px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {acc}
                    </span>
                  ))}
                  {ch.accounts.length === 0 && (
                    <span className="rounded-md border border-foreground/10 bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground/70">
                      No accounts connected yet
                    </span>
                  )}
                </div>

                {ch.statuses.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ch.statuses.map((status) => (
                      <span
                        key={`${status.channel}:${status.account}:${status.status}`}
                        className={cn(
                          "rounded-full border border-foreground/10 bg-foreground/5 px-2 py-0.5 text-xs",
                          statusTone(status.status)
                        )}
                        title={status.error || status.status}
                      >
                        {status.account || "default"} · {status.status}
                      </span>
                    ))}
                  </div>
                )}

                {ch.configured && (
                  <button
                    type="button"
                    onClick={() => toggleChannelExpanded(ch.channel)}
                    className="mt-2 flex items-center gap-1 text-xs text-muted-foreground/70 transition-colors hover:text-foreground/80"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 transition-transform",
                        expandedChannels.has(ch.channel) && "rotate-180"
                      )}
                    />
                    Channel Settings
                  </button>
                )}

                {expandedChannels.has(ch.channel) && ch.configured && (
                  <div className="mt-3 rounded-lg border border-foreground/10 bg-muted/30 p-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-xs">
                        <Shield className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">DM Policy</span>
                        <select
                          value={ch.dmPolicy || "pairing"}
                          onChange={(e) =>
                            void setChannelPolicy(ch.channel, "dmPolicy", e.target.value)
                          }
                          disabled={busy}
                          className="rounded border border-foreground/10 bg-background px-2 py-1 text-xs"
                        >
                          <option value="pairing">Pairing (approve first)</option>
                          <option value="allow">Allow all</option>
                          <option value="deny">Deny all</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <Shield className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Group Policy</span>
                        <select
                          value={ch.groupPolicy || "allow"}
                          onChange={(e) =>
                            void setChannelPolicy(ch.channel, "groupPolicy", e.target.value)
                          }
                          disabled={busy}
                          className="rounded border border-foreground/10 bg-background px-2 py-1 text-xs"
                        >
                          <option value="allow">Allow all</option>
                          <option value="mention">Mention only</option>
                          <option value="deny">Deny all</option>
                        </select>
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground/60">
                      DM Policy controls who can message the bot directly. Group Policy controls how the bot responds in group chats.
                    </p>
                  </div>
                )}

                {ch.setupHint && !expandedChannels.has(ch.channel) && (
                  <p className="mt-2 text-xs text-muted-foreground/70">
                    <LinkifiedText text={ch.setupHint} />
                  </p>
                )}
              </div>
            ))}

            {channels.length === 0 && (
              <p className="text-sm text-muted-foreground/60">No channels found</p>
            )}
          </div>
        </section>

        {/* ── Pending Pairings ── */}
        {(dmPairings.length > 0 || devicePairings.length > 0) && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-400" />
              <h2 className="text-xs font-semibold text-foreground/90">Pending Pairings</h2>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                {dmPairings.length + devicePairings.length}
              </span>
            </div>

            {dmPairings.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground/70">
                  New contacts waiting for approval to message your bot.
                </p>
                {dmPairings.map((req) => (
                  <div
                    key={`${req.channel}:${req.code}`}
                    className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        {req.senderName || req.senderId || "Unknown"}{" "}
                        <span className="text-muted-foreground">on {req.channel}</span>
                      </p>
                      {req.message && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                          &ldquo;{req.message}&rdquo;
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground/50">
                        Code: {req.code}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void approveDmPairing(req.channel, req.code)}
                      disabled={pairingBusy === `dm:${req.channel}:${req.code}`}
                      className="ml-3 shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {pairingBusy === `dm:${req.channel}:${req.code}` ? "Approving..." : "Approve"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {devicePairings.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground/70">
                  Devices requesting access to your OpenClaw instance.
                </p>
                {devicePairings.map((req) => (
                  <div
                    key={req.requestId}
                    className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        {req.displayName || req.requestId}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground/70">
                        {req.platform && `${req.platform} · `}
                        {req.role || (req.roles || []).join(", ") || "user"}
                      </p>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDeviceAction("approve", req.requestId)}
                        disabled={pairingBusy === `device:approve:${req.requestId}`}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeviceAction("reject", req.requestId)}
                        disabled={pairingBusy === `device:reject:${req.requestId}`}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Paired Devices ── */}
        {pairedDevices.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold text-foreground/90">Paired Devices</h2>
            </div>
            <div className="space-y-2">
              {pairedDevices.map((device) => (
                <div
                  key={device.deviceId}
                  className="flex items-center justify-between rounded-lg border border-foreground/10 bg-card/90 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">
                      {device.displayName || device.deviceId}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground/70">
                      {device.platform} · {device.role}{" "}
                      {device.approvedAtMs > 0 && (
                        <span>
                          · approved {new Date(device.approvedAtMs).toLocaleDateString()}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void handleDeviceAction("revoke", device.deviceId, device.role)
                    }
                    disabled={pairingBusy === `device:revoke:${device.deviceId}`}
                    className="ml-3 shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs shadow-xl backdrop-blur-sm",
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
      {/* QR Login Modal for WhatsApp / Signal */}
      {qrModalOpen && (
        <QrLoginModal
          channel={qrChannel}
          account={wizardAccount || undefined}
          onSuccess={() => {
            setQrModalOpen(false);
            void fetchChannels();
            flash(`${qrChannel === "whatsapp" ? "WhatsApp" : "Signal"} login successful`);
          }}
          onClose={() => setQrModalOpen(false)}
        />
      )}
      </SectionBody>
    </SectionLayout>
  );
}
