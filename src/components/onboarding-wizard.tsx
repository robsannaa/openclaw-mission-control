"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Search,
  ShieldCheck,
  SkipForward,
  Star,
} from "lucide-react";
import { QrLoginModal } from "@/components/qr-login-modal";
import { TypingDots } from "@/components/typing-dots";
import { skipOnboarding } from "@/components/setup-gate";
import { cn } from "@/lib/utils";

type SetupStatus = {
  installed: boolean;
  configured: boolean;
  configExists: boolean;
  hasModel: boolean;
  hasApiKey: boolean;
  gatewayRunning: boolean;
  version: string | null;
  gatewayUrl: string;
};

type WizardStep = "model" | "channel" | "finishing";

type ProviderId =
  | "anthropic"
  | "openai"
  | "openrouter";

type ChannelId = "telegram" | "discord" | "whatsapp";

type ModelItem = {
  id: string;
  name: string;
};

type ProviderDef = {
  id: ProviderId;
  label: string;
  icon: string;
  defaultModel: string;
  placeholder: string;
  helpUrl: string;
  helpSteps: string[];
};

type ChannelDef = {
  id: ChannelId;
  label: string;
  icon: string;
  setupType: "token" | "qr" | "manual";
  tokenLabel?: string;
  tokenPlaceholder?: string;
  appTokenLabel?: string;
  appTokenPlaceholder?: string;
  requiresAppToken?: boolean;
  description: string;
  nextSteps: string;
  docsUrl?: string;
};

type PairingRequest = {
  channel: string;
  code: string;
  senderName?: string;
  message?: string;
};

const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    icon: "🟣",
    defaultModel: "anthropic/claude-opus-4-6-20260219",
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
    helpSteps: [
      "Open the Anthropic Console.",
      "Go to Settings, then API Keys.",
      "Create a new key and paste it here.",
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: "🟢",
    defaultModel: "openai/gpt-5.3",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    helpSteps: [
      "Open the OpenAI Platform dashboard.",
      "Go to API Keys.",
      "Create a new secret key and paste it here.",
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    icon: "🟠",
    defaultModel: "openrouter/anthropic/claude-opus-4.6",
    placeholder: "sk-or-...",
    helpUrl: "https://openrouter.ai/keys",
    helpSteps: [
      "Open your OpenRouter dashboard.",
      "Create a key in the Keys section.",
      "Paste it here to fetch supported models.",
    ],
  },
];

const CHANNELS: ChannelDef[] = [
  {
    id: "telegram",
    label: "Telegram",
    icon: "✈️",
    setupType: "token",
    tokenLabel: "Bot Token",
    tokenPlaceholder: "123456:ABC-DEF...",
    description: "Connect a Telegram bot token to let people message your agent.",
    nextSteps: "Ask someone to message your Telegram bot so you can approve the first contact.",
    docsUrl: "https://docs.openclaw.ai/channels/telegram",
  },
  {
    id: "discord",
    label: "Discord",
    icon: "🎮",
    setupType: "token",
    tokenLabel: "Bot Token",
    tokenPlaceholder: "MTIzNDU2Nzg5...",
    description: "Connect your Discord bot token to chat in DMs or servers.",
    nextSteps: "Invite the bot to a server or DM it once so the pairing request appears here.",
    docsUrl: "https://docs.openclaw.ai/channels/discord",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: "💬",
    setupType: "qr",
    description: "WhatsApp requires a QR code scan from your phone.",
    nextSteps: "Scan the QR code, then send a message from your phone number to complete pairing.",
    docsUrl: "https://docs.openclaw.ai/channels/whatsapp",
  },
];

const STEP_IDS: WizardStep[] = ["model", "channel", "finishing"];

const WELL_KNOWN_MODELS: Record<ProviderId, ModelItem[]> = {
  anthropic: [
    { id: "anthropic/claude-opus-4-6-20260219", name: "Claude Opus 4.6" },
    { id: "anthropic/claude-sonnet-4-6-20260219", name: "Claude Sonnet 4.6" },
    { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "anthropic/claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "openai/gpt-5.3", name: "GPT-5.3" },
    { id: "openai/gpt-4o", name: "GPT-4o" },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "openai/o3-mini", name: "o3-mini" },
  ],
  openrouter: [
    { id: "openrouter/anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "openrouter/anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "openrouter/openai/gpt-5.3", name: "GPT-5.3" },
    { id: "openrouter/openai/gpt-4o", name: "GPT-4o" },
    { id: "openrouter/moonshot/kimi-2.5", name: "Kimi 2.5" },
    { id: "openrouter/minimax/minimax-m2.5", name: "MiniMax M2.5" },
    { id: "openrouter/google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
};

const RECOMMENDED_MODEL_MATCHERS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-sonnet-4",
  "openai/gpt-5.3",
  "openai/gpt-4o",
  "openrouter/anthropic/claude-opus-4.6",
  "openrouter/openai/gpt-5.3",
  "openrouter/moonshot/kimi-2.5",
];

function isRecommendedModel(modelId: string) {
  return RECOMMENDED_MODEL_MATCHERS.some(
    (matcher) => modelId === matcher || modelId.startsWith(`${matcher}-`) || modelId.startsWith(`${matcher}/`),
  );
}

function mergeModels(provider: ProviderId, liveModels: ModelItem[]) {
  const merged = new Map<string, ModelItem>();
  for (const model of WELL_KNOWN_MODELS[provider]) merged.set(model.id, model);
  for (const model of liveModels) merged.set(model.id, model);
  return Array.from(merged.values()).sort((a, b) => {
    const aRecommended = isRecommendedModel(a.id) ? 0 : 1;
    const bRecommended = isRecommendedModel(b.id) ? 0 : 1;
    if (aRecommended !== bRecommended) return aRecommended - bRecommended;
    return a.name.localeCompare(b.name);
  });
}

function getChannelLabel(channelId: ChannelId | null) {
  return CHANNELS.find((channel) => channel.id === channelId)?.label || "Channel";
}

function OnboardingModelPicker({
  provider,
  value,
  onChange,
  liveModels,
  loading,
}: {
  provider: ProviderDef;
  value: string;
  onChange: (modelId: string) => void;
  liveModels: ModelItem[];
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const models = useMemo(() => mergeModels(provider.id, liveModels), [provider.id, liveModels]);

  const filteredModels = useMemo(() => {
    if (!query) return models;
    const q = query.toLowerCase();
    return models.filter(
      (model) => model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q),
    );
  }, [models, query]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const selectedModel = models.find((model) => model.id === value);

  if (loading && liveModels.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <TypingDots size="sm" className="text-muted-foreground" />
          <span>Loading models from {provider.label}...</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground/50">
          You can also pick from the default list below while models load.
        </p>
      </div>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
          open
            ? "border-primary/50 bg-background"
            : "border-border bg-background hover:border-primary/30",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-base leading-none">{provider.icon}</span>
          <span className="truncate text-foreground">
            {selectedModel?.name || value || "Select a model"}
          </span>
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {loading && <TypingDots size="sm" className="text-muted-foreground" />}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models..."
                className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto sm:max-h-56">
            {filteredModels.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                No models match your search.
              </div>
            ) : (
              filteredModels.map((model) => {
                const selected = model.id === value;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => {
                      onChange(model.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50",
                      selected ? "bg-primary/5 text-foreground" : "text-foreground/80",
                    )}
                  >
                    <span className="text-base leading-none">{provider.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{model.name}</span>
                      <span className="block truncate text-muted-foreground">{model.id}</span>
                    </span>
                    {isRecommendedModel(model.id) && <Star className="h-3 w-3 text-amber-400" />}
                    {selected && <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function OnboardingWizard({ onComplete }: { onComplete?: () => void }) {
  const router = useRouter();

  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState<WizardStep>("model");

  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(PROVIDERS[0].defaultModel);
  const [testingKey, setTestingKey] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [liveModels, setLiveModels] = useState<ModelItem[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const [selectedChannel, setSelectedChannel] = useState<ChannelId | null>(null);
  const [channelToken, setChannelToken] = useState("");
  const [channelAppToken, setChannelAppToken] = useState("");
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelResult, setChannelResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [connectedChannel, setConnectedChannel] = useState<ChannelId | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrChannel, setQrChannel] = useState<"whatsapp">("whatsapp");

  const [pairingRequests, setPairingRequests] = useState<PairingRequest[]>([]);
  const [approvingCode, setApprovingCode] = useState<string | null>(null);
  const [approvedCodes, setApprovedCodes] = useState<Set<string>>(new Set());
  const [connectPhase, setConnectPhase] = useState<
    "idle" | "validating" | "saving" | "restarting" | "ready"
  >("idle");
  const [botName, setBotName] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [pairingTimeout, setPairingTimeout] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [healthProgress, setHealthProgress] = useState(0);

  const [launchError, setLaunchError] = useState<string | null>(null);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validationSeqRef = useRef(0);
  const modelFetchSeqRef = useRef(0);
  const pairingPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pairingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectAbortRef = useRef<AbortController | null>(null);

  const currentProvider = useMemo(
    () => PROVIDERS.find((entry) => entry.id === provider) || PROVIDERS[0],
    [provider],
  );
  const currentChannel = useMemo(
    () => CHANNELS.find((entry) => entry.id === selectedChannel) || null,
    [selectedChannel],
  );
  const connectedChannelDef = useMemo(
    () => CHANNELS.find((entry) => entry.id === connectedChannel) || null,
    [connectedChannel],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/onboard", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as SetupStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // Silent: the gate is fail-open, and the wizard can still render.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const [modelFetchError, setModelFetchError] = useState(false);

  const fetchLiveModels = useCallback(async (nextProvider: ProviderId, token: string) => {
    const seq = ++modelFetchSeqRef.current;
    setLoadingModels(true);
    setModelFetchError(false);

    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-models", provider: nextProvider, token }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json();
      if (seq !== modelFetchSeqRef.current) return;
      if (data.ok && Array.isArray(data.models)) {
        setLiveModels(data.models as ModelItem[]);
      } else {
        setLiveModels([]);
      }
    } catch {
      if (seq === modelFetchSeqRef.current) {
        setLiveModels([]);
        setModelFetchError(true);
      }
    } finally {
      if (seq === modelFetchSeqRef.current) {
        setLoadingModels(false);
      }
    }
  }, []);

  useEffect(() => {
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    const seq = ++validationSeqRef.current;
    modelFetchSeqRef.current += 1;

    setTestingKey(false);
    setKeyValid(null);
    setKeyError(null);
    setLiveModels([]);
    setLoadingModels(false);

    // Validate API key
    if (apiKey.trim().length < 8) return;

    validateTimerRef.current = setTimeout(async () => {
      setTestingKey(true);
      try {
        const res = await fetch("/api/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test-key", provider, token: apiKey.trim() }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`Validation failed (${res.status})`);
        const data = await res.json();
        if (seq !== validationSeqRef.current) return;

        if (data.ok) {
          setKeyValid(true);
          setKeyError(null);
          await fetchLiveModels(provider, apiKey.trim());
        } else {
          setKeyValid(false);
          setKeyError(data.error || "Key validation failed.");
        }
      } catch (error) {
        if (seq !== validationSeqRef.current) return;
        setKeyValid(false);
        setKeyError(error instanceof Error ? error.message : "Key validation failed.");
      } finally {
        if (seq === validationSeqRef.current) {
          setTestingKey(false);
        }
      }
    }, 600);

    return () => {
      if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    };
  }, [apiKey, fetchLiveModels, provider]);

  useEffect(() => {
    if (!connectedChannel) {
      if (pairingPollRef.current) clearInterval(pairingPollRef.current);
      pairingPollRef.current = null;
      return;
    }

    const controller = new AbortController();

    const poll = async () => {
      try {
        const res = await fetch("/api/pairing", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        if (!res.ok) return;
        const data = await res.json();
        const nextRequests = Array.isArray(data.dm)
          ? (data.dm as PairingRequest[]).filter((request) => request.channel === connectedChannel)
          : [];
        setPairingRequests(nextRequests);
      } catch {
        // Silent polling failure (includes abort).
      }
    };

    poll();
    pairingPollRef.current = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 4000);

    return () => {
      controller.abort();
      if (pairingPollRef.current) clearInterval(pairingPollRef.current);
      pairingPollRef.current = null;
    };
  }, [connectedChannel]);

  // Cleanup pairing timeout timer on unmount (Bug 6)
  useEffect(() => {
    return () => {
      if (pairingTimeoutRef.current) clearTimeout(pairingTimeoutRef.current);
    };
  }, []);

  const handleProviderChange = useCallback((nextProvider: ProviderId) => {
    const nextDef = PROVIDERS.find((entry) => entry.id === nextProvider) || PROVIDERS[0];
    validationSeqRef.current += 1;
    modelFetchSeqRef.current += 1;
    setProvider(nextProvider);
    setModel(nextDef.defaultModel);
    setApiKey("");
    setShowKey(false);
    setKeyValid(null);
    setKeyError(null);
    setLiveModels([]);
    setLoadingModels(false);
  }, []);

  const saveCredentials = useCallback(async () => {
    const payload: Record<string, string> = {
      action: "save-credentials",
      provider,
      apiKey: apiKey.trim(),
      model,
    };
    const res = await fetch("/api/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || "Could not save your API credentials.");
    }
  }, [apiKey, model, provider]);

  const continueToChannelStep = useCallback(async () => {
    try {
      await saveCredentials();
      setStep("channel");
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : "Could not save your API credentials.");
      setKeyValid(false);
    }
  }, [saveCredentials]);

  const waitForGatewayHealth = useCallback(async (channel?: string, maxAttempts = 15): Promise<boolean> => {
    setHealthProgress(0);
    const url = channel ? `/api/channels/health?channel=${encodeURIComponent(channel)}` : "/api/channels/health";
    for (let i = 0; i < maxAttempts; i++) {
      setHealthProgress(Math.round(((i + 1) / maxAttempts) * 100));
      try {
        const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          // If checking a specific channel, wait until it's ready
          if (channel && data.channelReady === false) {
            // Gateway is up but channel not ready yet — keep polling
          } else {
            setHealthProgress(100);
            return true;
          }
        }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }, []);

  const cancelChannelConnect = useCallback(() => {
    connectAbortRef.current?.abort();
    connectAbortRef.current = null;
    setChannelBusy(false);
    setConnectPhase("idle");
    setChannelResult(null);
  }, []);

  const handleConnectChannel = useCallback(async () => {
    if (!currentChannel || currentChannel.setupType !== "token" || !channelToken.trim()) return;
    if (currentChannel.requiresAppToken && !channelAppToken.trim()) return;

    const abort = new AbortController();
    connectAbortRef.current = abort;

    setChannelBusy(true);
    setChannelResult(null);
    setConnectPhase("validating");
    setBotName("");
    setPairingTimeout(false);
    if (pairingTimeoutRef.current) clearTimeout(pairingTimeoutRef.current);

    try {
      // Phase 1: Validate token
      const valRes = await fetch("/api/channels/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: currentChannel.id, token: channelToken.trim() }),
        signal: abort.signal,
      });
      if (!valRes.ok) {
        const errBody = await valRes.json().catch(() => ({}));
        throw new Error((errBody as Record<string, string>).error || `Validation failed (${valRes.status})`);
      }
      const valData = await valRes.json();
      if (valData.ok === false) {
        throw new Error(valData.error || "Token validation failed.");
      }
      if (valData.botName) setBotName(valData.botName);
      if (valData.botUsername) setBotUsername(valData.botUsername);

      if (abort.signal.aborted) return;

      // Phase 2: Save config
      setConnectPhase("saving");
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          channel: currentChannel.id,
          token: channelToken.trim(),
          ...(currentChannel.requiresAppToken ? { appToken: channelAppToken.trim() } : {}),
        }),
        signal: abort.signal,
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Could not connect ${currentChannel.label}.`);
      }

      if (abort.signal.aborted) return;

      // Phase 3: Wait for gateway restart and channel readiness
      setConnectPhase("restarting");
      const healthy = await waitForGatewayHealth(currentChannel.id);
      if (abort.signal.aborted) return;
      if (!healthy) {
        throw new Error("The gateway is taking longer than expected to restart. You can try again or check that the gateway is running.");
      }

      setConnectPhase("ready");
      setChannelResult({
        type: "success",
        message: `${currentChannel.label} connected${valData.botName ? ` (${valData.botName})` : ""}!`,
      });
      setConnectedChannel(currentChannel.id);
      setApprovedCodes(new Set());
      setPairingRequests([]);

      // Start 2-minute pairing timeout
      pairingTimeoutRef.current = setTimeout(() => {
        setPairingTimeout(true);
      }, 120000);
    } catch (error) {
      if (abort.signal.aborted) return;
      setConnectPhase("idle");
      setChannelResult({
        type: "error",
        message: error instanceof Error ? error.message : `Could not connect ${currentChannel.label}.`,
      });
    } finally {
      if (!abort.signal.aborted) setChannelBusy(false);
      connectAbortRef.current = null;
    }
  }, [channelAppToken, channelToken, currentChannel, waitForGatewayHealth]);

  const handleApprovePairing = useCallback(async (request: PairingRequest) => {
    // Idempotency guard: skip if already approved or in-flight
    if (approvedCodes.has(request.code) || approvingCode) return;
    setApprovingCode(request.code);
    setPairingError(null);
    try {
      const res = await fetch("/api/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve-dm", channel: request.channel, code: request.code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Could not approve the pairing request.");
      }
      setApprovedCodes((prev) => {
        const next = new Set(prev);
        next.add(request.code);
        return next;
      });
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : "Could not approve. Check your connection and try again.");
    } finally {
      setApprovingCode(null);
    }
  }, [approvedCodes, approvingCode]);

  const runQuickSetup = useCallback(async () => {
    setLaunchError(null);

    try {
      const payload: Record<string, string> = {
        action: "quick-setup",
        provider,
        apiKey: apiKey.trim(),
        model,
      };
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Setup failed.");
      }
      onComplete?.();
      if (process.env.NEXT_PUBLIC_AGENTBAY_HOSTED === "true") {
        try { localStorage.setItem("mc-post-onboarding", "1"); } catch {}
        router.push("/chat");
      } else {
        router.push("/");
      }
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : "Setup failed.");
    }
  }, [apiKey, model, onComplete, provider, router]);

  const finishSetup = useCallback(() => {
    setStep("finishing");
    void runQuickSetup();
  }, [runQuickSetup]);

  const visibleStepIndex = step === "model" ? 0 : step === "channel" ? 1 : 2;
  const continueDisabled = !apiKey.trim() || testingKey || keyValid !== true || status?.installed === false;
  const onboardingBlocked = status?.installed === false;
  const approvalComplete = approvedCodes.size > 0;

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-background px-4 py-6 sm:justify-center sm:py-8">
        <div className="flex w-full max-w-2xl flex-col items-center">
          <div className="mb-6 text-center sm:mb-8">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
              Set up your agent
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">This only takes a minute.</p>
          </div>

          <div className="mb-6 flex items-center justify-center gap-2 sm:mb-6">
            {STEP_IDS.map((stepId, index) => {
              const isCurrent = index === visibleStepIndex;
              const isPast = index < visibleStepIndex;

              if (isCurrent) {
                return <span key={stepId} className="h-1.5 w-6 rounded-full bg-foreground transition-all duration-300" />;
              }

              if (isPast) {
                // Don't allow navigating back during finishing step
                if (step === "finishing") {
                  return <span key={stepId} className="h-1.5 w-1.5 rounded-full bg-foreground/40 transition-all duration-300" />;
                }
                return (
                  <button
                    key={stepId}
                    type="button"
                    onClick={() => setStep(stepId)}
                    className="h-1.5 w-1.5 cursor-pointer rounded-full bg-foreground/40 transition-all duration-300"
                    aria-label={`Go back to ${stepId}`}
                  />
                );
              }

              return <span key={stepId} className="h-1.5 w-1.5 rounded-full bg-foreground/10 transition-all duration-300" />;
            })}
          </div>
          {step !== "finishing" && (
            <p className="mb-4 text-center text-xs text-muted-foreground/40">
              Step {visibleStepIndex + 1} of {STEP_IDS.length}
            </p>
          )}

          {onboardingBlocked && (
            <div className="mb-4 w-full rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-400 space-y-2">
              <p>OpenClaw is not installed yet. Install it first, then refresh this page.</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full border border-red-500/30 px-3 py-1 text-xs text-red-300 transition-colors hover:bg-red-500/10"
              >
                Refresh and retry
              </button>
            </div>
          )}

          <div className="w-full rounded-2xl border border-border bg-card shadow-[0_20px_60px_rgba(0,0,0,0.06)]">
            <div className="p-5 sm:p-7">
              {step === "model" && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Connect your AI</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Choose a provider, verify your API key, and pick the default model for your agent.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {PROVIDERS.map((entry) => {
                        const selected = entry.id === provider;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => handleProviderChange(entry.id)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                              selected
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-card text-muted-foreground hover:border-foreground/15 hover:text-foreground",
                            )}
                          >
                            {entry.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-secondary/50 p-3 space-y-1.5">
                    <p className="text-xs font-medium text-foreground/80">
                      How to get your {currentProvider.label} API key
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed text-muted-foreground">
                      {currentProvider.helpSteps.map((stepText, index) => (
                        <li key={`${currentProvider.id}-help-${index}`}>{stepText}</li>
                      ))}
                    </ol>
                    {currentProvider.helpUrl ? (
                      <a
                        href={currentProvider.helpUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 transition-colors hover:underline dark:text-blue-400"
                      >
                        Open {currentProvider.label} Dashboard
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        API Key
                      </label>
                      <div className="group relative inline-flex items-center">
                        <ShieldCheck className="h-3 w-3 text-emerald-500/60" />
                        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-lg bg-foreground px-3 py-1.5 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100">
                          Stored securely on this machine. Never sent to external servers.
                        </div>
                      </div>
                    </div>
                    <div className="relative">
                      <input
                        type={showKey ? "text" : "password"}
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={currentProvider.placeholder}
                        autoComplete="off"
                        data-1p-ignore
                        data-lpignore="true"
                        data-form-type="other"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-16 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50"
                      />
                      <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-2">
                        {testingKey ? <TypingDots size="sm" className="text-muted-foreground" /> : null}
                        {!testingKey && keyValid === true ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> : null}
                        {!testingKey && keyValid === false ? <AlertCircle className="h-3.5 w-3.5 text-red-400" /> : null}
                        <button
                          type="button"
                          onClick={() => setShowKey((prev) => !prev)}
                          className="text-muted-foreground/50 transition-colors hover:text-foreground"
                          aria-label={showKey ? "Hide API key" : "Show API key"}
                        >
                          {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                    {keyValid === true && !testingKey ? (
                      <p className="text-xs text-emerald-400">Key is valid</p>
                    ) : null}
                    {keyValid === false && keyError ? (
                      <p className="text-xs text-red-400">{keyError}</p>
                    ) : null}
                    {apiKey.trim().length > 0 && apiKey.trim().length < 8 && !testingKey && keyValid === null ? (
                      <p className="break-words text-xs text-muted-foreground/50">
                        Keep typing — API keys are usually longer
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Model</label>
                    <OnboardingModelPicker
                      key={currentProvider.id}
                      provider={currentProvider}
                      value={model}
                      onChange={setModel}
                      liveModels={liveModels}
                      loading={loadingModels}
                    />
                    {modelFetchError && (
                      <button
                        type="button"
                        onClick={() => {
                          if (keyValid && apiKey.trim()) void fetchLiveModels(provider, apiKey.trim());
                        }}
                        className="text-xs text-amber-400 transition-colors hover:text-amber-300"
                      >
                        Could not load models from provider — using defaults. Click to retry.
                      </button>
                    )}
                    <p className="text-xs text-muted-foreground/50">
                      You can change this later in the Models section.
                    </p>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={continueToChannelStep}
                      disabled={continueDisabled || onboardingBlocked}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-medium transition-opacity",
                        continueDisabled || onboardingBlocked
                          ? "cursor-not-allowed bg-muted text-muted-foreground"
                          : "bg-primary text-primary-foreground hover:opacity-90",
                      )}
                    >
                      Save &amp; Continue
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {step === "channel" && !connectedChannel && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Add messaging</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Connect a channel so your agent can chat. You can skip this for now.
                    </p>
                    {status?.gatewayRunning === false && (
                      <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                        The gateway is not running. Channel setup requires a running gateway — it will be started automatically when you finish setup, or you can start it manually first.
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {CHANNELS.map((channel) => {
                      const selected = channel.id === selectedChannel;
                      return (
                        <button
                          key={channel.id}
                          type="button"
                          onClick={() => {
                            setSelectedChannel(channel.id);
                            setChannelToken("");
                            setChannelAppToken("");
                            setChannelResult(null);
                          }}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-colors",
                            selected
                              ? "border-primary bg-primary/5"
                              : "border-border bg-card hover:border-foreground/15",
                          )}
                        >
                          <span className="text-lg">{channel.icon}</span>
                          <span className="text-xs font-medium text-foreground/80">{channel.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {currentChannel?.setupType === "token" && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">{currentChannel.description}</p>
                      <label className="text-xs font-medium text-muted-foreground">{currentChannel.tokenLabel}</label>
                      <input
                        type="password"
                        value={channelToken}
                        onChange={(event) => setChannelToken(event.target.value)}
                        placeholder={currentChannel.tokenPlaceholder}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
                      />
                      {currentChannel.requiresAppToken && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground">
                            {currentChannel.appTokenLabel || "App Token"}
                          </label>
                          <input
                            type="password"
                            value={channelAppToken}
                            onChange={(event) => setChannelAppToken(event.target.value)}
                            placeholder={currentChannel.appTokenPlaceholder || "xapp-..."}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
                          />
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {currentChannel.docsUrl ? (
                          <a
                            href={currentChannel.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                          >
                            Open setup guide
                          </a>
                        ) : (
                          <span />
                        )}
                        <button
                          type="button"
                          onClick={handleConnectChannel}
                          disabled={
                            !channelToken.trim() ||
                            (currentChannel.requiresAppToken && !channelAppToken.trim()) ||
                            channelBusy
                          }
                          className={cn(
                            "inline-flex min-w-[6rem] items-center justify-center rounded-full px-4 py-2 text-xs font-medium",
                            !channelToken.trim() ||
                              (currentChannel.requiresAppToken && !channelAppToken.trim()) ||
                              channelBusy
                              ? "cursor-not-allowed bg-muted text-muted-foreground"
                              : "bg-primary text-primary-foreground hover:opacity-90",
                          )}
                        >
                          {channelBusy ? (
                            <span className="flex items-center gap-1.5">
                              <TypingDots size="sm" className="text-current" />
                              <span>
                                {connectPhase === "validating" ? "Checking token..." :
                                 connectPhase === "saving" ? "Saving config..." :
                                 connectPhase === "restarting" ? `Starting gateway${healthProgress > 0 ? ` (${healthProgress}%)` : ""}...` :
                                 "Connecting..."}
                              </span>
                            </span>
                          ) : "Connect"}
                        </button>
                      </div>
                      {channelBusy && (
                        <button
                          type="button"
                          onClick={cancelChannelConnect}
                          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Cancel
                        </button>
                      )}
                      {channelResult?.type === "error" ? (
                        <p className="text-xs text-red-400">{channelResult.message}</p>
                      ) : null}
                    </div>
                  )}

                  {currentChannel?.setupType === "qr" && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">{currentChannel.description}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setQrChannel("whatsapp");
                          setShowQrModal(true);
                        }}
                        disabled={channelBusy}
                        className={cn(
                          "rounded-full px-5 py-2.5 text-sm font-medium transition-opacity",
                          channelBusy
                            ? "cursor-not-allowed bg-muted text-muted-foreground"
                            : "bg-primary text-primary-foreground hover:opacity-90",
                        )}
                      >
                        {channelBusy ? (
                          <span className="flex items-center gap-1.5">
                            <TypingDots size="sm" className="text-current" />
                            <span>
                              {connectPhase === "saving" ? "Saving config..." :
                               connectPhase === "restarting" ? `Starting gateway${healthProgress > 0 ? ` (${healthProgress}%)` : ""}...` :
                               "Connecting..."}
                            </span>
                          </span>
                        ) : "Scan QR Code"}
                      </button>
                      {currentChannel.docsUrl && (
                        <a
                          href={currentChannel.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Open setup guide
                        </a>
                      )}
                    </div>
                  )}

                  {currentChannel?.setupType === "manual" && (
                    <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                      <p className="text-sm font-medium text-foreground">Manual setup required</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {currentChannel.description}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {currentChannel.nextSteps}
                      </p>
                      <div className="flex items-center gap-3">
                        {currentChannel.docsUrl && (
                          <a
                            href={currentChannel.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                          >
                            Open setup guide
                          </a>
                        )}
                        <span className="text-xs text-muted-foreground">
                          You can finish this later from the full Channels page.
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (pairingTimeoutRef.current) clearTimeout(pairingTimeoutRef.current);
                        pairingTimeoutRef.current = null;
                        setPairingRequests([]);
                        setPairingTimeout(false);
                        setConnectedChannel(null);
                        setSelectedChannel(null);
                        setChannelToken("");
                        setChannelAppToken("");
                        setChannelResult(null);
                        setConnectPhase("idle");
                        setBotName("");
                        setBotUsername("");
                        setStep("model");
                      }}
                      disabled={channelBusy}
                      className={cn(
                        "rounded-full px-5 py-2.5 text-sm font-medium transition-colors",
                        channelBusy
                          ? "cursor-not-allowed text-muted-foreground/40"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={finishSetup}
                      disabled={channelBusy}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-2.5 text-sm font-medium transition-colors",
                        channelBusy
                          ? "cursor-not-allowed text-muted-foreground/40"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      Skip channel setup
                    </button>
                  </div>
                </div>
              )}

              {step === "channel" && connectedChannel && connectedChannelDef && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Add messaging</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Connect a channel so your agent can chat. You can always add more later.
                    </p>
                  </div>

                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                      <CheckCircle className="h-7 w-7 text-emerald-400" />
                    </div>
                    <p className="text-sm font-medium text-emerald-300">
                      {connectedChannelDef.icon} {connectedChannelDef.label} connected{botName ? ` (${botName})` : ""}
                    </p>
                    {connectedChannel === "telegram" && botUsername && (
                      <a
                        href={`https://t.me/${botUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" /> Open @{botUsername} in Telegram
                      </a>
                    )}
                  </div>

                  {/* Prompt user to text the bot */}
                  <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-medium text-foreground/80">Now test the connection</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Open {connectedChannelDef.label} and send any message (like &quot;hi&quot;) to your bot
                        {connectedChannel === "telegram" && botUsername ? ` (@${botUsername})` : ""}.
                        The bot will reply with an 8-character pairing code — come back here and click <strong>Confirm &amp; Approve</strong> to activate the connection.
                        Codes expire after 1 hour.
                      </p>
                    </div>

                    {/* Waiting state */}
                    {!approvalComplete && pairingRequests.length === 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 py-1">
                          <TypingDots size="sm" className="text-violet-400/60" />
                          <span className="text-xs text-muted-foreground">
                            Waiting for a message to your bot...
                          </span>
                        </div>
                        {pairingTimeout && (
                          <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-300 space-y-1">
                            <p className="font-medium">No pairing request detected yet.</p>
                            <ul className="list-inside list-disc space-y-0.5 text-amber-300/80">
                              <li>Open {connectedChannelDef.label} and send a message to your bot{connectedChannel === "telegram" && botUsername ? ` (@${botUsername})` : ""}</li>
                              <li>Make sure you&apos;re messaging the correct bot, not a group</li>
                              <li>If the problem persists, go back and re-enter the token</li>
                            </ul>
                          </div>
                        )}
                        {pairingError && (
                          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-xs text-red-300">
                            {pairingError}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* Pairing request detected */}
                    {pairingRequests.length > 0 && !approvalComplete ? (
                      <p className="text-xs font-semibold text-emerald-400">Pairing request received!</p>
                    ) : null}

                    {pairingRequests.map((request) => {
                      const approved = approvedCodes.has(request.code);
                      return (
                        <div
                          key={request.code}
                          className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-foreground">
                                {request.senderName || "Unknown sender"}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Pairing code: <code className="rounded bg-violet-500/15 px-1.5 py-0.5 font-bold tracking-wider text-violet-300">{request.code}</code>
                              </p>
                              {!approved && (
                                <p className="mt-1 text-xs text-muted-foreground/60">
                                  Confirm this matches the code you received in {connectedChannelDef.label}.
                                </p>
                              )}
                            </div>
                            {approved ? (
                              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                                <CheckCircle className="h-3.5 w-3.5" />
                                Approved
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleApprovePairing(request)}
                                disabled={approvingCode === request.code}
                                className="shrink-0 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                              >
                                {approvingCode === request.code ? (
                                  <TypingDots size="sm" className="text-current" />
                                ) : (
                                  "Confirm & Approve"
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Success state */}
                    {approvalComplete ? (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                        <CheckCircle className="h-3.5 w-3.5" />
                        Approved! Your agent is now connected to {connectedChannelDef.label}.
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-end pt-2">
                    <button
                      type="button"
                      onClick={finishSetup}
                      disabled={channelBusy}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-medium transition-opacity",
                        channelBusy
                          ? "cursor-not-allowed bg-muted text-muted-foreground"
                          : "bg-primary text-primary-foreground hover:opacity-90",
                      )}
                    >
                      Finish setup
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {step === "finishing" && (
                <div className="py-12">
                  {!launchError ? (
                    <div className="flex flex-col items-center justify-center gap-4 text-center">
                      <TypingDots size="lg" className="text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Setting up your agent...</p>
                        <p className="mt-1 text-xs text-muted-foreground/50">
                          Saving credentials, configuring model, and starting the gateway. This may take 20–30 seconds.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center">
                      <AlertCircle className="h-10 w-10 text-red-400" />
                      <p className="text-sm font-medium text-foreground">Something went wrong</p>
                      <p className="text-xs text-muted-foreground">{launchError}</p>
                      <div className="mt-2 flex w-full flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => void runQuickSetup()}
                          className="w-full rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          Try Again
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setLaunchError(null);
                            setStep("channel");
                          }}
                          className="w-full rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Skip onboarding — inside the card's scroll area */}
              {step !== "finishing" && (
                <div className="mt-6 border-t border-border/50 pt-5 text-center">
                  {!showSkipConfirm ? (
                    <button
                      type="button"
                      onClick={() => setShowSkipConfirm(true)}
                      className="text-xs text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                    >
                      I prefer to configure manually
                    </button>
                  ) : (
                    <div className="mx-auto max-w-sm rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                      <p className="text-xs font-medium text-foreground">Are you sure?</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        You&apos;ll need to set up API keys, choose a model, and start the gateway
                        yourself using the command line. You can always come back to the app
                        settings later to configure everything through the UI instead.
                      </p>
                      <div className="mt-3 flex items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => setShowSkipConfirm(false)}
                          className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Continue setup
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            skipOnboarding();
                            onComplete?.();
                          }}
                          className="rounded-full bg-amber-600 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                        >
                          Skip for now
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {showQrModal && (
        <QrLoginModal
          channel={qrChannel}
          onClose={() => setShowQrModal(false)}
          onSuccess={async () => {
            setShowQrModal(false);
            setSelectedChannel(qrChannel);
            setChannelBusy(true);
            setConnectPhase("saving");

            try {
              // Enable WhatsApp in gateway config
              const res = await fetch("/api/channels", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "connect", channel: qrChannel }),
              });
              const data = await res.json();
              if (!res.ok || data.ok === false) {
                throw new Error(data.error || "Could not enable WhatsApp in config.");
              }

              // Wait for gateway restart and channel readiness
              setConnectPhase("restarting");
              const healthy = await waitForGatewayHealth(qrChannel);
              if (!healthy) {
                throw new Error("Gateway did not come back online. Check the logs.");
              }

              setConnectPhase("ready");
              setConnectedChannel(qrChannel);
              setChannelResult({
                type: "success",
                message: `${getChannelLabel(qrChannel)} connected successfully!`,
              });
              setApprovedCodes(new Set());
              setPairingRequests([]);

              // Start 2-minute pairing timeout
              pairingTimeoutRef.current = setTimeout(() => {
                setPairingTimeout(true);
              }, 120000);
            } catch (error) {
              setConnectPhase("idle");
              setChannelResult({
                type: "error",
                message: error instanceof Error ? error.message : "Could not enable WhatsApp.",
              });
            } finally {
              setChannelBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
