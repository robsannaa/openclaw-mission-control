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
  | "google"
  | "openrouter"
  | "groq"
  | "xai"
  | "mistral"
  | "custom";

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
  /** Custom provider: API key is optional */
  keyOptional?: boolean;
  /** Custom provider: needs a base URL input */
  needsBaseUrl?: boolean;
  baseUrlPlaceholder?: string;
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
    defaultModel: "anthropic/claude-sonnet-4-20250514",
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
    defaultModel: "openai/gpt-4o",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    helpSteps: [
      "Open the OpenAI Platform dashboard.",
      "Go to API Keys.",
      "Create a new secret key and paste it here.",
    ],
  },
  {
    id: "google",
    label: "Google",
    icon: "🔵",
    defaultModel: "google/gemini-2.0-flash",
    placeholder: "AIza...",
    helpUrl: "https://aistudio.google.com/app/apikey",
    helpSteps: [
      "Open Google AI Studio.",
      "Choose Get API key.",
      "Create a key and paste it here.",
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    icon: "🟠",
    defaultModel: "openrouter/anthropic/claude-sonnet-4",
    placeholder: "sk-or-...",
    helpUrl: "https://openrouter.ai/keys",
    helpSteps: [
      "Open your OpenRouter dashboard.",
      "Create a key in the Keys section.",
      "Paste it here to fetch supported models.",
    ],
  },
  {
    id: "groq",
    label: "Groq",
    icon: "⚡",
    defaultModel: "groq/llama-3.3-70b-versatile",
    placeholder: "gsk_...",
    helpUrl: "https://console.groq.com/keys",
    helpSteps: [
      "Open the Groq Console.",
      "Go to API Keys.",
      "Create a key and paste it here.",
    ],
  },
  {
    id: "xai",
    label: "xAI",
    icon: "𝕏",
    defaultModel: "xai/grok-3-mini",
    placeholder: "xai-...",
    helpUrl: "https://console.x.ai/",
    helpSteps: [
      "Open the xAI Console.",
      "Find the API key section.",
      "Create a key and paste it here.",
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    icon: "🌊",
    defaultModel: "mistral/mistral-large-latest",
    placeholder: "...",
    helpUrl: "https://console.mistral.ai/api-keys/",
    helpSteps: [
      "Open the Mistral Console.",
      "Go to API Keys.",
      "Create a key and paste it here.",
    ],
  },
  {
    id: "custom",
    label: "Custom / OpenAI-compatible",
    icon: "🔗",
    defaultModel: "",
    placeholder: "Bearer token (optional for local endpoints)",
    helpUrl: "",
    helpSteps: [
      "Enter your endpoint's base URL (e.g. http://localhost:1234/v1).",
      "Add an API key if your endpoint requires authentication.",
      "Models will be auto-detected from your server.",
    ],
    keyOptional: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: "http://localhost:1234/v1",
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

const STEP_IDS: Array<Exclude<WizardStep, "finishing">> = ["model", "channel"];

const WELL_KNOWN_MODELS: Record<ProviderId, ModelItem[]> = {
  anthropic: [
    { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "anthropic/claude-opus-4-20250514", name: "Claude Opus 4" },
    { id: "anthropic/claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "openai/gpt-4o", name: "GPT-4o" },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "openai/o3-mini", name: "o3-mini" },
  ],
  google: [
    { id: "google/gemini-2.5-pro-preview-05-06", name: "Gemini 2.5 Pro" },
    { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "google/gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },
  ],
  openrouter: [
    { id: "openrouter/anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "openrouter/openai/gpt-4o", name: "GPT-4o" },
    { id: "openrouter/google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash" },
  ],
  groq: [
    { id: "groq/llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
    { id: "groq/llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
    { id: "groq/mixtral-8x7b-32768", name: "Mixtral 8x7B" },
  ],
  xai: [
    { id: "xai/grok-3-mini", name: "Grok 3 Mini" },
    { id: "xai/grok-3", name: "Grok 3" },
    { id: "xai/grok-2-1212", name: "Grok 2" },
  ],
  mistral: [
    { id: "mistral/mistral-large-latest", name: "Mistral Large" },
    { id: "mistral/mistral-small-latest", name: "Mistral Small" },
    { id: "mistral/codestral-latest", name: "Codestral" },
  ],
  custom: [],
};

const RECOMMENDED_MODEL_MATCHERS = [
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-sonnet-4",
  "openai/gpt-4o",
  "google/gemini-2.5-pro",
  "google/gemini-2.0-flash",
  "groq/llama-3.3-70b-versatile",
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
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
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
          <div className="max-h-56 overflow-y-auto">
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
  const [customBaseUrl, setCustomBaseUrl] = useState("");
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
  const [pairingTimeout, setPairingTimeout] = useState(false);

  const [launchError, setLaunchError] = useState<string | null>(null);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validationSeqRef = useRef(0);
  const modelFetchSeqRef = useRef(0);
  const pairingPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pairingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const fetchLiveModels = useCallback(async (nextProvider: ProviderId, token: string) => {
    const seq = ++modelFetchSeqRef.current;
    setLoadingModels(true);

    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-models", provider: nextProvider, token }),
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
      }
    } finally {
      if (seq === modelFetchSeqRef.current) {
        setLoadingModels(false);
      }
    }
  }, []);

  const fetchCustomModels = useCallback(async (baseUrl: string, token: string) => {
    const seq = ++modelFetchSeqRef.current;
    setLoadingModels(true);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-models", provider: "custom", baseUrl, token }),
      });
      const data = await res.json();
      if (seq !== modelFetchSeqRef.current) return;
      if (data.ok && Array.isArray(data.models)) {
        setLiveModels(data.models as ModelItem[]);
        // Auto-select first model if none selected
        if (data.models.length > 0 && !model) {
          setModel((data.models[0] as ModelItem).id);
        }
      } else {
        setLiveModels([]);
      }
    } catch {
      if (seq === modelFetchSeqRef.current) setLiveModels([]);
    } finally {
      if (seq === modelFetchSeqRef.current) setLoadingModels(false);
    }
  }, [model]);

  useEffect(() => {
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    const seq = ++validationSeqRef.current;
    modelFetchSeqRef.current += 1;

    setTestingKey(false);
    setKeyValid(null);
    setKeyError(null);
    setLiveModels([]);
    setLoadingModels(false);

    // Custom provider: validate by probing the base URL
    if (provider === "custom") {
      if (!customBaseUrl.trim() || customBaseUrl.trim().length < 8) return;

      validateTimerRef.current = setTimeout(async () => {
        setTestingKey(true);
        try {
          const res = await fetch("/api/onboard", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "test-key",
              provider: "custom",
              baseUrl: customBaseUrl.trim(),
              token: apiKey.trim() || "",
            }),
          });
          const data = await res.json();
          if (seq !== validationSeqRef.current) return;

          if (data.ok) {
            setKeyValid(true);
            setKeyError(null);
            // Models may already be in the response
            if (Array.isArray(data.models) && data.models.length > 0) {
              const models = data.models.map((m: { id: string; name?: string }) => ({
                id: m.id.includes("/") ? m.id : `custom/${m.id}`,
                name: m.name || m.id,
              }));
              setLiveModels(models);
              if (models.length > 0 && !model) {
                setModel(models[0].id);
              }
              setLoadingModels(false);
            } else {
              await fetchCustomModels(customBaseUrl.trim(), apiKey.trim());
            }
          } else {
            setKeyValid(false);
            setKeyError(data.error || "Could not connect to endpoint.");
          }
        } catch (error) {
          if (seq !== validationSeqRef.current) return;
          setKeyValid(false);
          setKeyError(error instanceof Error ? error.message : "Connection failed.");
        } finally {
          if (seq === validationSeqRef.current) setTestingKey(false);
        }
      }, 800);

      return () => {
        if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
      };
    }

    // Standard providers: validate API key
    if (apiKey.trim().length < 8) return;

    validateTimerRef.current = setTimeout(async () => {
      setTestingKey(true);
      try {
        const res = await fetch("/api/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test-key", provider, token: apiKey.trim() }),
        });
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
  }, [apiKey, customBaseUrl, fetchCustomModels, fetchLiveModels, model, provider]);

  useEffect(() => {
    if (!connectedChannel) {
      if (pairingPollRef.current) clearInterval(pairingPollRef.current);
      pairingPollRef.current = null;
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch("/api/pairing", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const nextRequests = Array.isArray(data.dm)
          ? (data.dm as PairingRequest[]).filter((request) => request.channel === connectedChannel)
          : [];
        setPairingRequests(nextRequests);
      } catch {
        // Silent polling failure.
      }
    };

    poll();
    pairingPollRef.current = setInterval(poll, 4000);

    return () => {
      if (pairingPollRef.current) clearInterval(pairingPollRef.current);
      pairingPollRef.current = null;
    };
  }, [connectedChannel]);

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
    setCustomBaseUrl("");
  }, []);

  const saveCredentials = useCallback(async () => {
    const payload: Record<string, string> = {
      action: "save-credentials",
      provider,
      apiKey: apiKey.trim(),
      model,
    };
    if (provider === "custom" && customBaseUrl.trim()) {
      payload.baseUrl = customBaseUrl.trim();
    }
    const res = await fetch("/api/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || "Could not save your API credentials.");
    }
  }, [apiKey, customBaseUrl, model, provider]);

  const continueToChannelStep = useCallback(async () => {
    try {
      await saveCredentials();
      setStep("channel");
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : "Could not save your API credentials.");
      setKeyValid(false);
    }
  }, [saveCredentials]);

  const waitForGatewayHealth = useCallback(async (maxAttempts = 15): Promise<boolean> => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch("/api/channels/health", { cache: "no-store" });
        if (res.ok) return true;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }, []);

  const handleConnectChannel = useCallback(async () => {
    if (!currentChannel || currentChannel.setupType !== "token" || !channelToken.trim()) return;
    if (currentChannel.requiresAppToken && !channelAppToken.trim()) return;

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
      });
      const valData = await valRes.json();
      if (valData.ok === false) {
        throw new Error(valData.error || "Token validation failed.");
      }
      if (valData.botName) setBotName(valData.botName);

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
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Could not connect ${currentChannel.label}.`);
      }

      // Phase 3: Wait for gateway restart
      setConnectPhase("restarting");
      const healthy = await waitForGatewayHealth();
      if (!healthy) {
        throw new Error("Gateway did not come back online. Check the logs.");
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
      setConnectPhase("idle");
      setChannelResult({
        type: "error",
        message: error instanceof Error ? error.message : `Could not connect ${currentChannel.label}.`,
      });
    } finally {
      setChannelBusy(false);
    }
  }, [channelAppToken, channelToken, currentChannel, waitForGatewayHealth]);

  const handleApprovePairing = useCallback(async (request: PairingRequest) => {
    setApprovingCode(request.code);
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
    } catch {
      // Keep the card as-is if approval fails.
    } finally {
      setApprovingCode(null);
    }
  }, []);

  const runQuickSetup = useCallback(async () => {
    setLaunchError(null);

    try {
      const payload: Record<string, string> = {
        action: "quick-setup",
        provider,
        apiKey: apiKey.trim(),
        model,
      };
      if (provider === "custom" && customBaseUrl.trim()) {
        payload.baseUrl = customBaseUrl.trim();
      }
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
  }, [apiKey, customBaseUrl, model, onComplete, provider, router]);

  const finishSetup = useCallback(() => {
    setStep("finishing");
    void runQuickSetup();
  }, [runQuickSetup]);

  const handleAddAnotherChannel = useCallback(() => {
    setConnectedChannel(null);
    setSelectedChannel(null);
    setChannelToken("");
    setChannelResult(null);
    setPairingRequests([]);
    setApprovedCodes(new Set());
    setConnectPhase("idle");
    setBotName("");
    setPairingTimeout(false);
    if (pairingTimeoutRef.current) clearTimeout(pairingTimeoutRef.current);
  }, []);

  const visibleStepIndex = step === "model" ? 0 : step === "channel" ? 1 : 1;
  const continueDisabled = provider === "custom"
    ? (!customBaseUrl.trim() || testingKey || keyValid !== true || status?.installed === false)
    : (!apiKey.trim() || testingKey || keyValid !== true || status?.installed === false);
  const onboardingBlocked = status?.installed === false;
  const approvalComplete = approvedCodes.size > 0;

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-background px-4">
        <div className="flex w-full max-w-2xl flex-col items-center">
          <div className="mb-6 text-center sm:mb-8">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
              Set up your agent
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">This only takes a minute.</p>
          </div>

          {step !== "finishing" && (
            <div className="mb-6 flex items-center justify-center gap-2 sm:mb-6">
              {STEP_IDS.map((stepId, index) => {
                const isCurrent = index === visibleStepIndex;
                const isPast = index < visibleStepIndex;

                if (isCurrent) {
                  return <span key={stepId} className="h-1.5 w-6 rounded-full bg-foreground transition-all duration-300" />;
                }

                if (isPast) {
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
          )}

          {onboardingBlocked && (
            <div className="mb-4 w-full rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-400">
              OpenClaw is not installed yet. Install the OpenClaw binary first, then return to finish setup.
            </div>
          )}

          <div className="w-full rounded-2xl border border-border bg-card shadow-[0_20px_60px_rgba(0,0,0,0.06)]">
            <div className="max-h-[72vh] overflow-y-auto p-6 sm:p-7">
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
                    <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                      {currentProvider.helpSteps.map((stepText, index) => (
                        <p key={`${currentProvider.id}-help-${index}`}>{stepText}</p>
                      ))}
                    </div>
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

                  {currentProvider.needsBaseUrl && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Endpoint URL</label>
                      <input
                        type="url"
                        value={customBaseUrl}
                        onChange={(event) => setCustomBaseUrl(event.target.value)}
                        placeholder={currentProvider.baseUrlPlaceholder || "http://localhost:1234/v1"}
                        autoComplete="off"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50"
                      />
                      <p className="text-xs text-muted-foreground/50">
                        Works with NVIDIA NIM, vLLM, Ollama, LM Studio, or any OpenAI-compatible server.
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        API Key{currentProvider.keyOptional ? " (optional)" : ""}
                      </label>
                      <div className="group relative inline-flex items-center">
                        <ShieldCheck className="h-3 w-3 text-emerald-500/60" />
                        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-lg bg-foreground px-3 py-1.5 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100">
                          Encrypted and stored locally. Not even we can see it.
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
                      Continue
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
                    <p className="mt-1.5 text-xs text-muted-foreground/80">
                      Telegram and Discord are built-in. If setup fails, ensure OpenClaw is up to date and the gateway is running; see the Channels docs for your channel.
                    </p>
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
                      <div className="flex items-center justify-between gap-3">
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
                                {connectPhase === "validating" ? "Validating..." :
                                 connectPhase === "saving" ? "Saving..." :
                                 connectPhase === "restarting" ? "Starting..." :
                                 "Connecting..."}
                              </span>
                            </span>
                          ) : "Connect"}
                        </button>
                      </div>
                      {channelResult?.type === "success" ? (
                        <p className="text-xs text-emerald-400">{channelResult.message}</p>
                      ) : null}
                      {channelResult?.type === "success" && connectedChannel === "telegram" && (
                        <a
                          href={`https://t.me/${channelResult.message.match(/@(\w+)/)?.[1] || ""}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" /> Open in Telegram to test
                        </a>
                      )}
                      {channelResult?.type === "error" ? (
                        <p className="text-xs text-red-400">Error: {channelResult.message}</p>
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
                        className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                      >
                        Scan QR Code
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

                  <div className="flex justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setStep("model")}
                      className="rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={finishSetup}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      Skip
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
                  </div>

                  {/* Prompt user to text the bot */}
                  <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-medium text-foreground/80">Now test the connection</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Open {connectedChannelDef.label} and send a message to your bot.
                        You will receive a pairing code — then confirm it here.
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
                          <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-300">
                            No pairing request detected yet. Make sure you sent a message to the correct bot.
                            {" "}If the problem persists, go back and re-enter the token.
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

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={handleAddAnotherChannel}
                      className="rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Add Another Channel
                    </button>
                    <button
                      type="button"
                      onClick={finishSetup}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      Continue
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
                      <p className="text-sm text-muted-foreground">Setting up your agent...</p>
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
                      Skip setup and configure manually
                    </button>
                  ) : (
                    <div className="mx-auto max-w-sm rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                      <p className="text-xs font-medium text-foreground">Are you sure?</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Skipping means you&apos;ll need to configure everything manually using the
                        terminal. You&apos;ll need to set API keys, models, and start the gateway
                        yourself via the command line.
                      </p>
                      <div className="mt-3 flex items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => setShowSkipConfirm(false)}
                          className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Go back
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            skipOnboarding();
                            onComplete?.();
                          }}
                          className="rounded-full bg-amber-600 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                        >
                          Skip anyway
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
          onSuccess={() => {
            setSelectedChannel(qrChannel);
            setConnectedChannel(qrChannel);
            setChannelResult({
              type: "success",
              message: `${getChannelLabel(qrChannel)} connected successfully!`,
            });
            setApprovedCodes(new Set());
            setPairingRequests([]);
          }}
        />
      )}
    </>
  );
}
