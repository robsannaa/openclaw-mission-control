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
} from "lucide-react";
import { cn } from "@/lib/utils";

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

  useEffect(() => {
    void fetchChannels();
  }, [fetchChannels]);

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
      setWizardChannel(channelId || fallback);
      setWizardStep(1);
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
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
        Loading channels...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-6 md:px-6">
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground/90">Channels</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
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
                className="flex items-center gap-1 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] disabled:opacity-40"
              >
                <RefreshCw className={cn("h-3 w-3", channelsLoading && "animate-spin")} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => openWizard()}
                className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[11px] font-medium text-violet-300 transition-colors hover:bg-violet-500/20"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Channel
              </button>
            </div>
          </div>

          {wizardOpen && (
            <div className="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-violet-300" />
                  <h3 className="text-[13px] font-semibold text-foreground/90">Channel Setup Wizard</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setWizardOpen(false)}
                  className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground/80"
                >
                  Close
                </button>
              </div>

              <div className="mb-3 flex items-center gap-2 text-[11px]">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                        wizardStep >= step
                          ? "border-violet-400/40 bg-violet-500/20 text-violet-200"
                          : "border-foreground/[0.1] bg-muted text-muted-foreground"
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
                  <p className="text-[12px] text-muted-foreground">
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
                            : "border-foreground/[0.08] bg-card/60 hover:bg-card"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-base">{ch.icon}</span>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-medium text-foreground/90">{ch.label}</p>
                            <p className="text-[10px] text-muted-foreground">
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
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
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
                      className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                    >
                      Next
                      <Play className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}

              {wizardStep === 2 && selectedWizardChannel && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-foreground/[0.08] bg-card/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{selectedWizardChannel.icon}</span>
                        <div>
                          <p className="text-[12px] font-semibold text-foreground/90">{selectedWizardChannel.label}</p>
                        </div>
                      </div>
                      {selectedWizardChannel.docsUrl && (
                        <a
                          href={selectedWizardChannel.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-foreground/[0.08] bg-card px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground/80"
                        >
                          Docs
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="mt-2 rounded-md border border-violet-500/25 bg-violet-500/[0.08] px-3 py-2.5">
                      <p className="text-[13px] font-medium leading-relaxed text-foreground/95">
                        <LinkifiedText text={selectedWizardChannel.setupHint} />
                      </p>
                    </div>
                    {selectedWizardChannel.setupCommand && (
                      <div className="mt-2 rounded-md border border-foreground/[0.06] bg-muted/60 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                        {selectedWizardChannel.setupCommand}
                      </div>
                    )}
                    {selectedWizardChannel.configHint && (
                      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground/85">
                        <LinkifiedText text={selectedWizardChannel.configHint} />
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {needsToken && (
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                          {selectedWizardChannel.tokenLabel || "Token"}
                        </span>
                        <input
                          value={wizardToken}
                          onChange={(e) => setWizardToken(e.target.value)}
                          type="password"
                          placeholder={selectedWizardChannel.tokenPlaceholder || "Paste token"}
                          className="w-full rounded-md border border-foreground/[0.08] bg-muted px-2.5 py-2 text-[12px] text-foreground/85 outline-none focus:border-violet-500/30"
                        />
                      </label>
                    )}
                    {requiresAppToken && (
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                          App Token
                        </span>
                        <input
                          value={wizardAppToken}
                          onChange={(e) => setWizardAppToken(e.target.value)}
                          type="password"
                          placeholder="xapp-..."
                          className="w-full rounded-md border border-foreground/[0.08] bg-muted px-2.5 py-2 text-[12px] text-foreground/85 outline-none focus:border-violet-500/30"
                        />
                      </label>
                    )}
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                        Account (optional)
                      </span>
                      <input
                        value={wizardAccount}
                        onChange={(e) => setWizardAccount(e.target.value)}
                        placeholder="default"
                        className="w-full rounded-md border border-foreground/[0.08] bg-muted px-2.5 py-2 text-[12px] text-foreground/85 outline-none focus:border-violet-500/30"
                      />
                    </label>
                  </div>

                  {wizardError && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                      {wizardError}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="rounded-lg border border-foreground/[0.08] px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.04]"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void runWizardSetup()}
                      disabled={!canRunWizard || wizardRunning}
                      className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                    >
                      {wizardRunning ? (
                        <>
                          <RefreshCw className="h-3 w-3 animate-spin" />
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
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.08] px-3 py-2 text-[11px] text-emerald-200">
                    Setup run completed for <span className="font-semibold">{selectedWizardChannel.label}</span>.
                    {selectedWizardChannel.setupType === "qr" && " If interactive login is required, continue in Terminal."}
                  </div>
                  {wizardOutput && (
                    <pre className="max-h-40 overflow-auto rounded-lg border border-foreground/[0.08] bg-card px-3 py-2 text-[10px] text-muted-foreground whitespace-pre-wrap">
                      {wizardOutput}
                    </pre>
                  )}
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="rounded-lg border border-foreground/[0.08] px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.04]"
                    >
                      Reconfigure
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openWizard()}
                        className="rounded-lg border border-foreground/[0.08] px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.04]"
                      >
                        Setup Another
                      </button>
                      <Link
                        href="/?section=terminal"
                        className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-500"
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
                className="rounded-xl border border-foreground/[0.06] bg-card/90 p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="text-base">{ch.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{ch.label}</p>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
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
                        className="inline-flex items-center gap-1 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground/80"
                      >
                        Docs
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => openWizard(ch.channel)}
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1.5 text-[11px] text-violet-300 transition-colors hover:bg-violet-500/20"
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
                        className="rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] disabled:opacity-40"
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
                      className="rounded-md border border-foreground/[0.06] bg-muted/70 px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      {acc}
                    </span>
                  ))}
                  {ch.accounts.length === 0 && (
                    <span className="rounded-md border border-foreground/[0.06] bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground/70">
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
                          "rounded-full border border-foreground/[0.08] bg-foreground/[0.02] px-2 py-0.5 text-[10px]",
                          statusTone(status.status)
                        )}
                        title={status.error || status.status}
                      >
                        {status.account || "default"} · {status.status}
                      </span>
                    ))}
                  </div>
                )}

                {ch.setupHint && (
                  <p className="mt-2 text-[10px] text-muted-foreground/65">
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
      </div>

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
