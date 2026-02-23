"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  ChevronRight,
  AlertCircle,
  Loader2,
  Key,
  Cpu,
  Radio,
  Rocket,
  SkipForward,
  ExternalLink,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { QrLoginModal } from "@/components/qr-login-modal";

/* ── Types ────────────────────────────────────────── */

type SetupStatus = {
  installed: boolean;
  configured: boolean;
  configExists: boolean;
  hasModel: boolean;
  gatewayRunning: boolean;
  version: string | null;
  gatewayUrl: string;
};

type WizardStep = "check" | "model" | "channel" | "launch";

const STEPS: { id: WizardStep; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "check", label: "System Check", icon: Cpu },
  { id: "model", label: "Model & API Key", icon: Key },
  { id: "channel", label: "First Channel", icon: Radio },
  { id: "launch", label: "Launch", icon: Rocket },
];

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic", defaultModel: "anthropic/claude-sonnet-4-20250514", placeholder: "sk-ant-..." },
  { id: "openai", label: "OpenAI", defaultModel: "openai/gpt-4o", placeholder: "sk-..." },
  { id: "google", label: "Google", defaultModel: "google/gemini-2.0-flash", placeholder: "AIza..." },
  { id: "openrouter", label: "OpenRouter", defaultModel: "openrouter/anthropic/claude-sonnet-4", placeholder: "sk-or-..." },
  { id: "groq", label: "Groq", defaultModel: "groq/llama-3.3-70b-versatile", placeholder: "gsk_..." },
  { id: "xai", label: "xAI", defaultModel: "xai/grok-3-mini", placeholder: "xai-..." },
  { id: "mistral", label: "Mistral", defaultModel: "mistral/mistral-large-latest", placeholder: "..." },
];

const CHANNEL_OPTIONS = [
  { id: "telegram", label: "Telegram", icon: "✈️", type: "token" as const, tokenLabel: "Bot Token", placeholder: "123456:ABC-DEF..." },
  { id: "discord", label: "Discord", icon: "🎮", type: "token" as const, tokenLabel: "Bot Token", placeholder: "MTIzNDU2Nzg5..." },
  { id: "whatsapp", label: "WhatsApp", icon: "💬", type: "qr" as const },
  { id: "signal", label: "Signal", icon: "🔒", type: "qr" as const },
  { id: "slack", label: "Slack", icon: "💼", type: "token" as const, tokenLabel: "Bot Token", placeholder: "xoxb-..." },
];

/* ── Component ────────────────────────────────────── */

export function OnboardingWizard() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<WizardStep>("check");
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Model step state
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("");
  const [testingKey, setTestingKey] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Channel step state
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [channelToken, setChannelToken] = useState("");
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelResult, setChannelResult] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrChannel, setQrChannel] = useState<"whatsapp" | "signal">("whatsapp");

  // Launch step state
  const [launching, setLaunching] = useState(false);
  const [launchSteps, setLaunchSteps] = useState<string[]>([]);
  const [launchDone, setLaunchDone] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/onboard", { cache: "no-store" });
      const data = (await res.json()) as SetupStatus;
      setStatus(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Update default model when provider changes
  useEffect(() => {
    const prov = PROVIDERS.find((p) => p.id === provider);
    if (prov && !model) {
      setModel(prov.defaultModel);
    }
  }, [provider, model]);

  const stepIndex = STEPS.findIndex((s) => s.id === currentStep);

  const goNext = () => {
    const next = STEPS[stepIndex + 1];
    if (next) setCurrentStep(next.id);
  };

  const goBack = () => {
    const prev = STEPS[stepIndex - 1];
    if (prev) setCurrentStep(prev.id);
  };

  const testApiKey = async () => {
    setTestingKey(true);
    setKeyValid(null);
    setKeyError(null);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test-key", provider, token: apiKey }),
      });
      const data = await res.json();
      if (data.ok) {
        setKeyValid(true);
      } else {
        setKeyValid(false);
        setKeyError(data.error || "Key validation failed");
      }
    } catch (err) {
      setKeyValid(false);
      setKeyError(String(err));
    } finally {
      setTestingKey(false);
    }
  };

  const addChannel = async () => {
    if (!selectedChannel || !channelToken) return;
    setChannelBusy(true);
    setChannelResult(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", channel: selectedChannel, token: channelToken }),
      });
      const data = await res.json();
      if (data.ok) {
        setChannelResult(`${selectedChannel} connected successfully!`);
      } else {
        setChannelResult(`Error: ${data.error || "Failed to add channel"}`);
      }
    } catch (err) {
      setChannelResult(`Error: ${err}`);
    } finally {
      setChannelBusy(false);
    }
  };

  const runQuickSetup = async () => {
    setLaunching(true);
    setLaunchSteps([]);
    setLaunchDone(false);
    setLaunchError(null);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "quick-setup", provider, apiKey, model }),
      });
      const data = await res.json();
      if (data.ok) {
        setLaunchSteps(data.steps || []);
        setLaunchDone(true);
      } else {
        setLaunchError(data.error || "Setup failed");
        setLaunchSteps(data.steps || []);
      }
    } catch (err) {
      setLaunchError(String(err));
    } finally {
      setLaunching(false);
    }
  };

  const goToDashboard = () => {
    router.push("/");
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-background px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-xl font-bold text-foreground">
            Welcome to Mission Control
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Let&apos;s set up your OpenClaw agent in a few quick steps.
          </p>
        </div>

        {/* Step indicator */}
        <div className="mb-8 flex items-center justify-center gap-1">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const isCurrent = step.id === currentStep;
            const isPast = i < stepIndex;
            return (
              <div key={step.id} className="flex items-center gap-1">
                {i > 0 && (
                  <div
                    className={cn(
                      "h-px w-8 transition-colors",
                      isPast ? "bg-emerald-500" : "bg-foreground/10"
                    )}
                  />
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (isPast) setCurrentStep(step.id);
                  }}
                  disabled={!isPast}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    isCurrent
                      ? "bg-violet-500/20 text-violet-300"
                      : isPast
                        ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 cursor-pointer"
                        : "bg-foreground/5 text-muted-foreground/50"
                  )}
                >
                  {isPast ? (
                    <CheckCircle className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="rounded-2xl border border-foreground/10 bg-card p-6 shadow-xl">
          {/* ── Step 1: System Check ─────────────────── */}
          {currentStep === "check" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">System Check</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Checking your OpenClaw installation...
                </p>
              </div>

              {loading ? (
                <div className="flex items-center gap-2 py-8 justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
                  <span className="text-sm text-muted-foreground">Checking...</span>
                </div>
              ) : error ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                  <p className="text-sm text-red-300">{error}</p>
                  <button
                    onClick={fetchStatus}
                    className="mt-2 text-xs text-red-400 hover:underline"
                  >
                    Retry
                  </button>
                </div>
              ) : status ? (
                <div className="space-y-3">
                  <CheckItem
                    label="OpenClaw binary"
                    ok={status.installed}
                    detail={
                      status.installed
                        ? `Found${status.version ? ` (v${status.version})` : ""}`
                        : "Not found — install OpenClaw first"
                    }
                    helpUrl={!status.installed ? "https://docs.openclaw.ai/install" : undefined}
                  />
                  <CheckItem
                    label="Configuration file"
                    ok={status.configExists}
                    detail={
                      status.configExists
                        ? "openclaw.json exists"
                        : "Not found — will be created during setup"
                    }
                    warn={!status.configExists}
                  />
                  <CheckItem
                    label="Default model"
                    ok={status.hasModel}
                    detail={
                      status.hasModel
                        ? "Model configured"
                        : "No model set — we'll configure one next"
                    }
                    warn={!status.hasModel}
                  />
                  <CheckItem
                    label="Gateway"
                    ok={status.gatewayRunning}
                    detail={
                      status.gatewayRunning
                        ? `Running at ${status.gatewayUrl}`
                        : "Not running — will start during setup"
                    }
                    warn={!status.gatewayRunning}
                  />
                </div>
              ) : null}

              <div className="flex justify-end pt-2">
                <button
                  onClick={goNext}
                  disabled={!status?.installed}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors",
                    status?.installed
                      ? "bg-violet-600 text-white hover:bg-violet-500"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  Continue
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Model & API Key ──────────────── */}
          {currentStep === "model" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Model & API Key</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose your AI provider and paste your API key.
                </p>
              </div>

              {/* Provider selection */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <div className="flex flex-wrap gap-2">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setProvider(p.id);
                        setModel(p.defaultModel);
                        setKeyValid(null);
                        setKeyError(null);
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        provider === p.id
                          ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                          : "border-foreground/10 bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">API Key</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setKeyValid(null);
                        setKeyError(null);
                      }}
                      placeholder={PROVIDERS.find((p) => p.id === provider)?.placeholder}
                      className="w-full rounded-lg border border-foreground/10 bg-background px-3 py-2 pr-9 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-violet-500/50 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                    >
                      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <button
                    onClick={testApiKey}
                    disabled={!apiKey || testingKey}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                      apiKey && !testingKey
                        ? "bg-blue-600 text-white hover:bg-blue-500"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    )}
                  >
                    {testingKey ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Test"
                    )}
                  </button>
                </div>
                {keyValid === true && (
                  <p className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle className="h-3 w-3" /> Key is valid
                  </p>
                )}
                {keyValid === false && (
                  <p className="flex items-center gap-1 text-xs text-red-400">
                    <AlertCircle className="h-3 w-3" /> {keyError}
                  </p>
                )}
              </div>

              {/* Model */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Default Model</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="provider/model-name"
                  className="w-full rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-violet-500/50 focus:outline-none"
                />
                <p className="text-xs text-muted-foreground/50">
                  You can change this later in the Models section.
                </p>
              </div>

              <div className="flex justify-between pt-2">
                <button
                  onClick={goBack}
                  className="rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={goNext}
                  disabled={!apiKey}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors",
                    apiKey
                      ? "bg-violet-600 text-white hover:bg-violet-500"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  Continue
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: First Channel ────────────────── */}
          {currentStep === "channel" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Connect a Channel</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connect a messaging channel so your agent can communicate. You can skip this and set it up later.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CHANNEL_OPTIONS.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => {
                      setSelectedChannel(ch.id);
                      setChannelToken("");
                      setChannelResult(null);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-colors",
                      selectedChannel === ch.id
                        ? "border-violet-500/40 bg-violet-500/10"
                        : "border-foreground/10 bg-card hover:border-foreground/20"
                    )}
                  >
                    <span className="text-lg">{ch.icon}</span>
                    <span className="text-xs font-medium text-foreground/80">{ch.label}</span>
                  </button>
                ))}
              </div>

              {/* Token-based channel setup */}
              {selectedChannel && CHANNEL_OPTIONS.find((c) => c.id === selectedChannel)?.type === "token" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {CHANNEL_OPTIONS.find((c) => c.id === selectedChannel)?.tokenLabel || "Token"}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={channelToken}
                        onChange={(e) => setChannelToken(e.target.value)}
                        placeholder={CHANNEL_OPTIONS.find((c) => c.id === selectedChannel)?.placeholder}
                        className="flex-1 rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-violet-500/50 focus:outline-none"
                      />
                      <button
                        onClick={addChannel}
                        disabled={!channelToken || channelBusy}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                          channelToken && !channelBusy
                            ? "bg-emerald-600 text-white hover:bg-emerald-500"
                            : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                      >
                        {channelBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Connect"
                        )}
                      </button>
                    </div>
                  </div>
                  {channelResult && (
                    <p
                      className={cn(
                        "text-xs",
                        channelResult.startsWith("Error") ? "text-red-400" : "text-emerald-400"
                      )}
                    >
                      {channelResult}
                    </p>
                  )}
                </div>
              )}

              {/* QR-based channel setup */}
              {selectedChannel && CHANNEL_OPTIONS.find((c) => c.id === selectedChannel)?.type === "qr" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {selectedChannel === "whatsapp"
                      ? "WhatsApp requires a QR code scan from your phone."
                      : "Signal requires QR code scan via signal-cli."}
                  </p>
                  <button
                    onClick={() => {
                      setQrChannel(selectedChannel as "whatsapp" | "signal");
                      setShowQrModal(true);
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-500 transition-colors"
                  >
                    Scan QR Code
                  </button>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button
                  onClick={goBack}
                  className="rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={goNext}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                    Skip
                  </button>
                  <button
                    onClick={goNext}
                    disabled={!channelResult || channelResult.startsWith("Error")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors",
                      channelResult && !channelResult.startsWith("Error")
                        ? "bg-violet-600 text-white hover:bg-violet-500"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    )}
                  >
                    Continue
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Launch ───────────────────────── */}
          {currentStep === "launch" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Launch Your Agent</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  We&apos;ll save your configuration and start the gateway.
                </p>
              </div>

              {/* Summary */}
              <div className="space-y-2 rounded-xl border border-foreground/10 bg-background/50 p-4">
                <SummaryRow label="Provider" value={PROVIDERS.find((p) => p.id === provider)?.label || provider} />
                <SummaryRow label="Model" value={model} />
                <SummaryRow label="API Key" value={apiKey ? `${apiKey.substring(0, 8)}...` : "Not set"} />
                <SummaryRow
                  label="Channel"
                  value={
                    channelResult && !channelResult.startsWith("Error")
                      ? selectedChannel || "None"
                      : "None (skipped)"
                  }
                />
              </div>

              {!launchDone && !launching && (
                <button
                  onClick={runQuickSetup}
                  disabled={!apiKey}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors",
                    apiKey
                      ? "bg-emerald-600 text-white hover:bg-emerald-500"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  <Rocket className="h-4 w-4" />
                  Launch Setup
                </button>
              )}

              {launching && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
                  <span className="text-sm text-muted-foreground">Setting up...</span>
                </div>
              )}

              {launchSteps.length > 0 && (
                <div className="space-y-1.5">
                  {launchSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {step.toLowerCase().startsWith("warning") ? (
                        <AlertCircle className="h-3 w-3 shrink-0 text-amber-400" />
                      ) : (
                        <CheckCircle className="h-3 w-3 shrink-0 text-emerald-400" />
                      )}
                      <span className="text-muted-foreground">{step}</span>
                    </div>
                  ))}
                </div>
              )}

              {launchError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <p className="text-xs text-red-300">{launchError}</p>
                  <button
                    onClick={runQuickSetup}
                    className="mt-2 text-xs text-red-400 hover:underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {launchDone && !launchError && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-2 py-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                      <CheckCircle className="h-7 w-7 text-emerald-400" />
                    </div>
                    <p className="text-sm font-medium text-emerald-300">Setup complete!</p>
                    <p className="text-center text-xs text-muted-foreground">
                      Your OpenClaw agent is configured and the gateway is running.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href="/chat"
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-foreground/10 bg-card px-3 py-2 text-xs font-medium text-foreground/70 hover:bg-muted/80 hover:text-foreground transition-colors"
                    >
                      Chat with Agent
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <a
                      href="/agents"
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-foreground/10 bg-card px-3 py-2 text-xs font-medium text-foreground/70 hover:bg-muted/80 hover:text-foreground transition-colors"
                    >
                      Agent Settings
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  <button
                    onClick={goToDashboard}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
                  >
                    Go to Dashboard
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              {!launchDone && (
                <div className="flex justify-start pt-2">
                  <button
                    onClick={goBack}
                    className="rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Back
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* QR Modal */}
      {showQrModal && (
        <QrLoginModal
          channel={qrChannel}
          onSuccess={() => {
            setChannelResult(`${qrChannel} connected successfully!`);
          }}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </div>
  );
}

/* ── Sub-components ───────────────────────────────── */

function CheckItem({
  label,
  ok,
  detail,
  warn,
  helpUrl,
}: {
  label: string;
  ok: boolean;
  detail: string;
  warn?: boolean;
  helpUrl?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-foreground/10 bg-background/50 px-4 py-3">
      {ok ? (
        <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
      ) : warn ? (
        <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground/80">{label}</p>
        <p className="text-xs text-muted-foreground/60">{detail}</p>
      </div>
      {helpUrl && (
        <a
          href={helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-violet-400 hover:underline"
        >
          Install
          <ExternalLink className="ml-0.5 inline h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground/60">{label}</span>
      <span className="font-mono text-foreground/70">{value}</span>
    </div>
  );
}
