"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  Bell,
  BotMessageSquare,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  MessageCircle,
  Plus,
  QrCode,
  RefreshCw,
  Settings,
  Trash2,
  UserCheck,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import { QrLoginModal } from "@/components/qr-login-modal";
import { useSmartPoll } from "@/hooks/use-smart-poll";

/* ── Types ──────────────────────────────────────── */

type ChannelId = "telegram" | "discord" | "whatsapp";

type Channel = {
  id: string;
  label: string;
  icon: string;
  setup: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  hint?: string;
  docsUrl?: string;
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  error?: string | null;
  dmPolicy?: string;
  groupPolicy?: string;
  accounts?: string[];
};

type PairingRequest = {
  channel: string;
  code: string;
  account?: string;
  senderId?: string;
  senderName?: string;
  message?: string;
};

type ValidateResult = {
  ok: boolean;
  botName?: string;
  botUsername?: string;
  error?: string;
};

type WizardStep = "pick" | "setup" | "validating" | "connected" | "waiting";

type WizardState = {
  step: WizardStep;
  channelId: ChannelId | null;
  token: string;
  validateResult: ValidateResult | null;
  error: string | null;
};

/* ── Static channel metadata ─────────────────────── */

type ChannelMeta = {
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
  description: string;
  steps: { text: string; link?: { label: string; url: string } }[];
  tokenLabel: string;
  tokenPlaceholder: string;
  hint: string;
  docsUrl: string;
  usesQr: boolean;
};

const CHANNEL_META: Record<ChannelId, ChannelMeta> = {
  telegram: {
    color: "text-sky-400",
    bgColor: "bg-sky-500/10",
    borderColor: "border-sky-500/20",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
      </svg>
    ),
    description: "Connect via your Telegram bot token",
    steps: [
      { text: "Open Telegram on your phone or computer" },
      {
        text: "Start a chat with @BotFather",
        link: { label: "Open BotFather", url: "https://t.me/BotFather" },
      },
      { text: 'Send the message "/newbot" and follow the prompts to name your bot' },
      { text: "Copy the token BotFather gives you — it looks like: 123456:ABC-DEF..." },
    ],
    tokenLabel: "Bot Token",
    tokenPlaceholder: "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
    hint: "Your token is stored only on this device. We never send it to our servers.",
    docsUrl: "https://core.telegram.org/bots/tutorial",
    usesQr: false,
  },
  discord: {
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10",
    borderColor: "border-indigo-500/20",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.014.043.031.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    ),
    description: "Connect via your Discord bot token",
    steps: [
      {
        text: "Go to the Discord Developer Portal",
        link: { label: "Open Portal", url: "https://discord.com/developers/applications" },
      },
      { text: 'Click "New Application", give it a name, then open the "Bot" tab' },
      { text: 'Click "Add Bot" to create your bot user' },
      { text: 'Enable "Message Content Intent" under Privileged Gateway Intents' },
      { text: 'Click "Reset Token", then copy your token' },
      { text: "Invite the bot to your server via the OAuth2 URL Generator (scopes: bot, permissions: Send Messages + Read Message History)" },
    ],
    tokenLabel: "Bot Token",
    tokenPlaceholder: "paste-your-discord-bot-token-here",
    hint: "Your token is stored only on this device. We never send it to our servers.",
    docsUrl: "https://discord.com/developers/docs/intro",
    usesQr: false,
  },
  whatsapp: {
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
      </svg>
    ),
    description: "Connect by scanning a QR code with your phone",
    steps: [
      { text: "Open WhatsApp on your phone" },
      { text: 'Tap the three dots (Android) or Settings (iPhone), then "Linked Devices"' },
      { text: 'Tap "Link a Device"' },
      { text: "Point your camera at the QR code that appears on screen" },
    ],
    tokenLabel: "",
    tokenPlaceholder: "",
    hint: "Your WhatsApp session is stored locally and never shared.",
    docsUrl: "https://faq.whatsapp.com/1317564962315842",
    usesQr: true,
  },
};

const CHANNEL_IDS: ChannelId[] = ["telegram", "discord", "whatsapp"];

/* ── Shared atoms ────────────────────────────────── */

function ChannelIcon({
  channelId,
  size = "md",
}: {
  channelId: ChannelId;
  size?: "sm" | "md" | "lg";
}) {
  const meta = CHANNEL_META[channelId];
  const sizeClass =
    size === "sm" ? "h-8 w-8" : size === "lg" ? "h-14 w-14" : "h-10 w-10";
  const svgClass =
    size === "sm"
      ? "[&_svg]:h-4 [&_svg]:w-4"
      : size === "lg"
        ? "[&_svg]:h-7 [&_svg]:w-7"
        : "[&_svg]:h-5 [&_svg]:w-5";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border",
        sizeClass,
        svgClass,
        meta.bgColor,
        meta.color,
        meta.borderColor
      )}
    >
      {meta.icon}
    </div>
  );
}

function StatusDot({
  connected,
  className,
}: {
  connected: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative flex h-2.5 w-2.5", className)}>
      {connected && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
      )}
      <span
        className={cn(
          "relative inline-flex h-2.5 w-2.5 rounded-full",
          connected ? "bg-emerald-400" : "bg-[#3d4752]"
        )}
      />
    </span>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#20252a] text-xs font-semibold tabular-nums text-[#a8b0ba] ring-1 ring-[#2c343d]">
      {n}
    </span>
  );
}

/* ── Wizard ──────────────────────────────────────── */

function AddChannelWizard({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (channelId: string) => void;
}) {
  const [wizard, setWizard] = useState<WizardState>({
    step: "pick",
    channelId: null,
    token: "",
    validateResult: null,
    error: null,
  });
  const [showQr, setShowQr] = useState(false);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const meta = wizard.channelId ? CHANNEL_META[wizard.channelId] : null;

  function pickChannel(id: ChannelId) {
    setWizard({ step: "setup", channelId: id, token: "", validateResult: null, error: null });
    setTimeout(() => tokenInputRef.current?.focus(), 80);
  }

  function goBack() {
    if (wizard.step === "validating") return;
    setWizard({ step: "pick", channelId: null, token: "", validateResult: null, error: null });
  }

  async function handleConnect() {
    if (!wizard.channelId) return;

    if (CHANNEL_META[wizard.channelId].usesQr) {
      // Enable WhatsApp in config before showing QR
      try {
        await fetch("/api/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "connect", channel: wizard.channelId }),
        });
      } catch {
        // Best effort — QR login may still work
      }
      setShowQr(true);
      return;
    }

    if (!wizard.token.trim()) {
      setWizard((s) => ({ ...s, error: "Please paste your bot token before connecting." }));
      return;
    }

    setWizard((s) => ({ ...s, step: "validating", error: null }));

    try {
      const validateRes = await fetch("/api/channels/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: wizard.channelId, token: wizard.token.trim() }),
      });
      const result: ValidateResult = await validateRes.json();

      if (!result.ok) {
        setWizard((s) => ({
          ...s,
          step: "setup",
          error:
            result.error ??
            "Token validation failed. Double-check you copied it correctly and try again.",
        }));
        return;
      }

      await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          channel: wizard.channelId,
          token: wizard.token.trim(),
        }),
      });

      setWizard((s) => ({ ...s, step: "connected", validateResult: result }));
    } catch {
      setWizard((s) => ({
        ...s,
        step: "setup",
        error: "Network error. Check your connection and try again.",
      }));
    }
  }

  function handleQrSuccess() {
    setShowQr(false);
    setWizard((s) => ({
      ...s,
      step: "connected",
      validateResult: { ok: true, botName: "Your WhatsApp" },
    }));
    if (wizard.channelId) onConnected(wizard.channelId);
  }

  function proceedToWaiting() {
    setWizard((s) => ({ ...s, step: "waiting" }));
    if (wizard.channelId) onConnected(wizard.channelId);
  }

  function handleDone() {
    if (wizard.channelId) onConnected(wizard.channelId);
    onClose();
  }

  const stepTitle: Record<WizardStep, string> = {
    pick: "Add a messaging channel",
    setup: "Set up your connection",
    validating: "Verifying token...",
    connected: "Channel connected!",
    waiting: "Waiting for first message",
  };

  return (
    <>
      <div className="animate-backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
        <div className="animate-modal-in mx-0 flex w-full max-w-lg flex-col rounded-t-2xl border border-[#2c343d] bg-[#171a1d] shadow-2xl sm:mx-4 sm:rounded-2xl">
          {/* Header */}
          <div className="flex shrink-0 items-center gap-3 border-b border-[#2c343d] px-5 py-4">
            {wizard.step !== "pick" && (
              <button
                type="button"
                onClick={goBack}
                disabled={wizard.step === "validating"}
                aria-label="Go back"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#a8b0ba] transition-colors hover:bg-[#20252a] hover:text-[#f5f7fa] disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-[#f5f7fa]">
                {stepTitle[wizard.step]}
              </h2>
              {wizard.step === "pick" && (
                <p className="mt-0.5 text-xs text-[#7a8591]">
                  Choose a platform to connect your AI assistant to
                </p>
              )}
              {wizard.step === "setup" && wizard.channelId && (
                <p className="mt-0.5 text-xs text-[#7a8591]">
                  Follow the steps below, then paste your token
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#7a8591] transition-colors hover:bg-[#20252a] hover:text-[#f5f7fa]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Step: pick */}
            {wizard.step === "pick" && (
              <div className="grid grid-cols-1 gap-3 p-5">
                {CHANNEL_IDS.map((id) => {
                  const m = CHANNEL_META[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => pickChannel(id)}
                      className="group flex w-full items-center gap-4 rounded-xl border border-[#2c343d] bg-[#15191d] p-4 text-left transition-all hover:border-[#3d4752] hover:bg-[#1d2227] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34d399]/30"
                    >
                      <ChannelIcon channelId={id} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#f5f7fa]">
                            {id.charAt(0).toUpperCase() + id.slice(1)}
                          </span>
                          {id === "whatsapp" && (
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                              QR code
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-[#7a8591]">{m.description}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[#3d4752] transition-colors group-hover:text-[#7a8591]" />
                    </button>
                  );
                })}
              </div>
            )}

            {/* Step: setup */}
            {wizard.step === "setup" && wizard.channelId && meta && (
              <div className="p-5 space-y-4">
                {/* Instructions card */}
                <div className="rounded-xl border border-[#2c343d] bg-[#15191d] p-4">
                  <div className="mb-3 flex items-center gap-2.5">
                    <ChannelIcon channelId={wizard.channelId} size="sm" />
                    <span className="text-xs font-semibold text-[#d6dce3]">
                      {meta.usesQr ? "How to link your phone" : "How to get your token"}
                    </span>
                  </div>
                  <ol className="space-y-3">
                    {meta.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <StepNumber n={i + 1} />
                        <p className="pt-0.5 text-xs leading-relaxed text-[#a8b0ba]">
                          {step.text}
                          {step.link && (
                            <a
                              href={step.link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 inline-flex items-center gap-1 text-[#34d399] underline-offset-2 hover:underline"
                            >
                              {step.link.label}
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Token input */}
                {!meta.usesQr && (
                  <div className="space-y-2">
                    <label
                      htmlFor="channel-token"
                      className="block text-xs font-medium text-[#d6dce3]"
                    >
                      {meta.tokenLabel}
                    </label>
                    <input
                      ref={tokenInputRef}
                      id="channel-token"
                      type="text"
                      value={wizard.token}
                      onChange={(e) =>
                        setWizard((s) => ({ ...s, token: e.target.value, error: null }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleConnect();
                      }}
                      placeholder={meta.tokenPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                      className={cn(
                        "w-full rounded-lg border bg-[#15191d] px-3 py-2.5 font-mono text-sm text-[#f5f7fa] placeholder-[#3d4752]",
                        "transition-colors focus:outline-none focus:ring-2",
                        wizard.error
                          ? "border-red-500/40 focus:border-red-500/40 focus:ring-red-500/20"
                          : "border-[#2c343d] focus:border-[#34d399]/40 focus:ring-[#34d399]/20"
                      )}
                    />
                    {wizard.error && (
                      <p className="flex items-center gap-1.5 text-xs text-red-400">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        {wizard.error}
                      </p>
                    )}
                    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[#7a8591]">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#34d399]" />
                      {meta.hint}
                    </p>
                  </div>
                )}

                {/* WhatsApp QR placeholder */}
                {meta.usesQr && (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-[#2c343d] bg-[#15191d] p-6 text-center">
                    <QrCode className="h-10 w-10 text-[#3d4752]" />
                    <p className="text-sm text-[#a8b0ba]">
                      Click "Open QR scanner" and a code will appear.
                    </p>
                    <p className="text-xs text-[#7a8591]">Have your phone ready before clicking.</p>
                  </div>
                )}
              </div>
            )}

            {/* Step: validating */}
            {wizard.step === "validating" && (
              <div className="flex flex-col items-center gap-4 py-14">
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-[#34d399]/10" />
                  <Loader2 className="h-8 w-8 animate-spin text-[#34d399]" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[#f5f7fa]">Checking your token...</p>
                  <p className="mt-1 text-xs text-[#7a8591]">This only takes a moment</p>
                </div>
              </div>
            )}

            {/* Step: connected */}
            {wizard.step === "connected" && wizard.channelId && (
              <div className="flex flex-col items-center gap-5 px-5 py-10">
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-emerald-500/15" />
                  <Check className="h-8 w-8 text-emerald-400" strokeWidth={2.5} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-[#f5f7fa]">
                    {wizard.validateResult?.botName
                      ? `Connected as ${wizard.validateResult.botName}`
                      : "Successfully connected!"}
                  </p>
                  {wizard.validateResult?.botUsername && (
                    <p className="mt-0.5 text-xs text-[#7a8591]">
                      @{wizard.validateResult.botUsername}
                    </p>
                  )}
                </div>
                <div className="w-full rounded-xl border border-[#34d399]/20 bg-[#34d399]/5 p-4">
                  <div className="flex items-start gap-3">
                    <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[#34d399]" />
                    <div>
                      <p className="text-xs font-semibold text-[#d6dce3]">
                        {wizard.channelId === "whatsapp"
                          ? "Now send a message from WhatsApp"
                          : "Now send your bot a message"}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-[#7a8591]">
                        When someone messages your bot for the first time, a pairing request will appear in your dashboard. Approve it and they can start chatting with your AI.
                      </p>
                    </div>
                  </div>
                </div>
                {wizard.channelId === "telegram" && wizard.validateResult?.botUsername && (
                  <a
                    href={`https://t.me/${wizard.validateResult.botUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-[#34d399]/30 bg-[#34d399]/10 px-4 py-2 text-sm font-medium text-[#34d399] transition-colors hover:bg-[#34d399]/20"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open @{wizard.validateResult.botUsername} in Telegram
                  </a>
                )}
              </div>
            )}

            {/* Step: waiting */}
            {wizard.step === "waiting" && (
              <div className="flex flex-col items-center gap-5 px-5 py-10">
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <div className="absolute inset-0 animate-ping rounded-full bg-amber-500/20" />
                  <div className="absolute inset-0 rounded-full bg-amber-500/10" />
                  <Clock className="h-8 w-8 text-amber-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-[#f5f7fa]">Waiting for a message</p>
                  <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[#7a8591]">
                    Send your bot a message now. When it receives its first message, a pairing request will appear — you approve it, and the conversation begins.
                  </p>
                </div>
                <div className="flex w-full items-center gap-2 rounded-lg border border-[#2c343d] bg-[#15191d] px-3 py-2.5">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#3d4752]" />
                  <span className="text-xs text-[#7a8591]">Watching for pairing requests...</span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {wizard.step === "setup" && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#2c343d] px-5 py-4">
              {meta?.docsUrl ? (
                <a
                  href={meta.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[#7a8591] underline-offset-2 hover:text-[#a8b0ba] hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Official docs
                </a>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void handleConnect()}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#34d399] px-5 text-sm font-medium text-[#101214] transition-colors hover:bg-[#6ee7b7]"
              >
                {meta?.usesQr ? (
                  <>
                    <QrCode className="h-4 w-4" />
                    Open QR scanner
                  </>
                ) : (
                  <>
                    Connect
                    <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          )}

          {wizard.step === "connected" && (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#2c343d] px-5 py-4">
              <button
                type="button"
                onClick={handleDone}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#2c343d] bg-[#15191d] px-4 text-sm font-medium text-[#a8b0ba] transition-colors hover:bg-[#20252a] hover:text-[#f5f7fa]"
              >
                Done
              </button>
              <button
                type="button"
                onClick={proceedToWaiting}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#34d399] px-5 text-sm font-medium text-[#101214] transition-colors hover:bg-[#6ee7b7]"
              >
                <Bell className="h-4 w-4" />
                Watch for requests
              </button>
            </div>
          )}

          {wizard.step === "waiting" && (
            <div className="shrink-0 border-t border-[#2c343d] px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-[#2c343d] bg-[#15191d] text-sm font-medium text-[#a8b0ba] transition-colors hover:bg-[#20252a] hover:text-[#f5f7fa]"
              >
                Close — I'll check back later
              </button>
            </div>
          )}
        </div>
      </div>

      {/* QR modal rendered on top */}
      {showQr && wizard.channelId === "whatsapp" && (
        <QrLoginModal
          channel="whatsapp"
          onSuccess={handleQrSuccess}
          onClose={() => setShowQr(false)}
        />
      )}
    </>
  );
}

/* ── Pairing request card ────────────────────────── */

function PairingCard({
  request,
  onApprove,
  approving,
}: {
  request: PairingRequest;
  onApprove: () => void;
  approving: boolean;
}) {
  const channelId = (request.channel as ChannelId) in CHANNEL_META
    ? (request.channel as ChannelId)
    : "telegram";
  const meta = CHANNEL_META[channelId];

  return (
    <div className="animate-enter flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border [&_svg]:h-4 [&_svg]:w-4",
          meta.bgColor,
          meta.color,
          meta.borderColor
        )}
      >
        {meta.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-[#f5f7fa]">
            {request.senderName ?? request.senderId ?? "Someone new"}
          </span>
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
            Wants to connect
          </span>
        </div>
        {request.message && (
          <p className="mt-1 truncate text-xs text-[#7a8591]">
            &ldquo;{request.message}&rdquo;
          </p>
        )}
        {request.account && (
          <p className="mt-0.5 text-[11px] text-[#7a8591]">via {request.account}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onApprove}
        disabled={approving}
        className="ml-2 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#34d399] px-3 text-xs font-medium text-[#101214] transition-colors hover:bg-[#6ee7b7] disabled:opacity-60"
      >
        {approving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <UserCheck className="h-3 w-3" />
        )}
        Approve
      </button>
    </div>
  );
}

/* ── Channel card ────────────────────────────────── */

function ChannelCard({
  channel,
  pairingCount,
  onConnect,
  onDisconnect,
}: {
  channel: Channel;
  pairingCount: number;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const channelId =
    channel.id in CHANNEL_META ? (channel.id as ChannelId) : null;
  const meta = channelId ? CHANNEL_META[channelId] : null;
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleDisconnect() {
    if (!confirming) {
      setConfirming(true);
      confirmTimer.current = setTimeout(() => setConfirming(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setDisconnecting(true);
    try {
      await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect", channel: channel.id }),
      });
      onDisconnect();
    } finally {
      setDisconnecting(false);
      setConfirming(false);
    }
  }

  if (!meta || !channelId) return null;

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-4 rounded-xl border p-5 transition-all",
        channel.connected
          ? "border-[#2c343d] bg-[#15191d]"
          : "border-[#2c343d]/50 bg-[#15191d]/50"
      )}
    >
      {/* Top row */}
      <div className="flex items-start gap-3">
        <ChannelIcon channelId={channelId} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#f5f7fa]">{channel.label}</span>
            {pairingCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-bold text-amber-400 ring-1 ring-amber-500/30">
                {pairingCount}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <StatusDot connected={channel.connected} />
            <span
              className={cn(
                "text-xs",
                channel.connected ? "text-emerald-400" : "text-[#7a8591]"
              )}
            >
              {channel.connected ? "Connected" : "Not connected"}
            </span>
          </div>
        </div>

        {/* Actions */}
        {channel.connected ? (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              title="Settings"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[#7a8591] transition-colors hover:bg-[#20252a] hover:text-[#a8b0ba]"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={confirming ? "Click again to confirm disconnect" : "Disconnect"}
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                confirming
                  ? "bg-red-500/15 text-red-400 opacity-100 ring-1 ring-red-500/30"
                  : "text-[#7a8591] hover:bg-red-500/10 hover:text-red-400"
              )}
            >
              {disconnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#2c343d] bg-[#20252a] px-2.5 text-xs font-medium text-[#a8b0ba] transition-colors hover:border-[#34d399]/30 hover:bg-[#34d399]/10 hover:text-[#34d399]"
          >
            <Plus className="h-3.5 w-3.5" />
            Connect
          </button>
        )}
      </div>

      {/* Error */}
      {channel.error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
          <p className="text-xs text-red-400">{channel.error}</p>
        </div>
      )}

      {/* Pairing pending */}
      {channel.connected && pairingCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <Bell className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-400">
            {pairingCount === 1
              ? "1 pairing request needs your approval"
              : `${pairingCount} pairing requests need your approval`}
          </p>
        </div>
      )}

      {/* Idle connected */}
      {channel.connected && pairingCount === 0 && !channel.error && (
        <div className="flex items-center gap-2 text-[11px] text-[#7a8591]">
          <Zap className="h-3 w-3 text-[#3d4752]" />
          Ready — watching for incoming messages
        </div>
      )}
    </div>
  );
}

/* ── Main view ───────────────────────────────────── */

export function ChannelsView() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [pairingRequests, setPairingRequests] = useState<PairingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [approvingCode, setApprovingCode] = useState<string | null>(null);
  const [recentlyConnected, setRecentlyConnected] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/channels");
      if (!res.ok) throw new Error("Failed to load channels");
      const data: { channels: Channel[] } = await res.json();
      setChannels(data.channels ?? []);
      setFetchError(null);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPairing = useCallback(async () => {
    try {
      const res = await fetch("/api/pairing");
      if (!res.ok) return;
      const data: { dm: PairingRequest[] } = await res.json();
      setPairingRequests(data.dm ?? []);
    } catch {
      // Non-critical — silent fail
    }
  }, []);

  useSmartPoll(fetchChannels, { intervalMs: 15000, immediate: true });
  useSmartPoll(fetchPairing, { intervalMs: 5000, immediate: true });

  async function handleApprove(request: PairingRequest) {
    setApprovingCode(request.code);
    try {
      await fetch("/api/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve-dm",
          channel: request.channel,
          code: request.code,
          account: request.account,
        }),
      });
      setPairingRequests((prev) => prev.filter((r) => r.code !== request.code));
    } finally {
      setApprovingCode(null);
    }
  }

  function handleConnected(channelId: string) {
    setRecentlyConnected(channelId);
    void fetchChannels();
    void fetchPairing();
    setTimeout(() => setRecentlyConnected(null), 5000);
  }

  const connectedCount = channels.filter((c) => c.connected).length;
  const pendingCount = pairingRequests.length;

  function getPairingCount(channelId: string) {
    return pairingRequests.filter((r) => r.channel === channelId).length;
  }

  return (
    <SectionLayout>
      <SectionHeader
        title="Messaging Channels"
        description="Connect your AI assistant to messaging apps so people can talk to it."
        meta={
          connectedCount > 0
            ? `${connectedCount} channel${connectedCount !== 1 ? "s" : ""} active`
            : undefined
        }
        actions={
          <button
            type="button"
            onClick={() => setShowWizard(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#34d399] px-4 text-sm font-medium text-[#101214] transition-colors hover:bg-[#6ee7b7]"
          >
            <Plus className="h-4 w-4" />
            Add channel
          </button>
        }
        bordered
      />

      <SectionBody width="narrow">
        {loading ? (
          <LoadingState label="Loading channels..." />
        ) : fetchError ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10">
              <WifiOff className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#f5f7fa]">Could not load channels</p>
              <p className="mt-1 text-xs text-[#7a8591]">{fetchError}</p>
            </div>
            <button
              type="button"
              onClick={() => void fetchChannels()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#2c343d] bg-[#15191d] px-3 py-1.5 text-xs font-medium text-[#a8b0ba] transition-colors hover:bg-[#20252a]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Pairing requests */}
            {pendingCount > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Bell className="h-4 w-4 text-amber-400" />
                  <h2 className="text-sm font-semibold text-[#f5f7fa]">Pairing requests</h2>
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/20 px-1.5 text-[11px] font-bold text-amber-400 ring-1 ring-amber-500/30">
                    {pendingCount}
                  </span>
                </div>
                <div className="space-y-2">
                  {pairingRequests.map((req) => (
                    <PairingCard
                      key={`${req.channel}-${req.code}`}
                      request={req}
                      onApprove={() => void handleApprove(req)}
                      approving={approvingCode === req.code}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Recently connected banner */}
            {recentlyConnected && (
              <div className="animate-enter flex items-center gap-3 rounded-xl border border-[#34d399]/20 bg-[#34d399]/5 px-4 py-3">
                <Check className="h-4 w-4 shrink-0 text-[#34d399]" />
                <p className="text-xs text-[#34d399]">
                  {recentlyConnected.charAt(0).toUpperCase() + recentlyConnected.slice(1)} connected. Send your bot a message to get started.
                </p>
              </div>
            )}

            {/* Empty state */}
            {channels.length === 0 ? (
              <div className="flex flex-col items-center gap-6 py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#2c343d] bg-[#15191d]">
                  <MessageCircle className="h-8 w-8 text-[#3d4752]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#f5f7fa]">No channels connected yet</p>
                  <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-[#7a8591]">
                    Connect Telegram, Discord, or WhatsApp so people can chat with your AI assistant directly from their favourite app.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWizard(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#34d399] px-5 text-sm font-medium text-[#101214] transition-colors hover:bg-[#6ee7b7]"
                >
                  <Plus className="h-4 w-4" />
                  Add your first channel
                </button>
              </div>
            ) : (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#7a8591]">
                  Your channels
                </h2>
                <div className="stagger-cards grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {channels.map((ch) => (
                    <ChannelCard
                      key={ch.id}
                      channel={ch}
                      pairingCount={getPairingCount(ch.id)}
                      onConnect={() => setShowWizard(true)}
                      onDisconnect={() => void fetchChannels()}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* How it works — shown when channels exist but none are connected */}
            {channels.length > 0 && connectedCount === 0 && (
              <div className="rounded-xl border border-[#2c343d] bg-[#15191d] p-5">
                <div className="mb-3 flex items-center gap-2">
                  <BotMessageSquare className="h-4 w-4 text-[#34d399]" />
                  <span className="text-xs font-semibold text-[#d6dce3]">How it works</span>
                </div>
                <ol className="space-y-3">
                  {[
                    "Connect a channel using the Connect button on any card above.",
                    "Send your bot its first message from that app.",
                    "Approve the pairing request here — then that person can chat with your AI.",
                  ].map((text, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <StepNumber n={i + 1} />
                      <p className="pt-0.5 text-xs leading-relaxed text-[#a8b0ba]">{text}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </SectionBody>

      {showWizard && (
        <AddChannelWizard
          onClose={() => setShowWizard(false)}
          onConnected={handleConnected}
        />
      )}
    </SectionLayout>
  );
}
