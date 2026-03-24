"use client";

import {type CSSProperties, useCallback, useEffect, useRef, useState} from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Key,
  Loader2,
  MessageCircle,
  ShieldCheck,
  Zap,
} from "lucide-react";
import {cn} from "@/lib/utils";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {getFriendlyModelName} from "@/lib/model-metadata";

type Model = { id: string; name: string };

/** Latest recommended model per provider — shown with an "Advised" badge. */
const ADVISED_MODELS: Record<string, string> = {
  openai: "openai/gpt-5.4",
  anthropic: "anthropic/claude-sonnet-4-6",
  openrouter: "openrouter/anthropic/claude-sonnet-4-6",
};

function isAdvisedModel(provider: string, modelId: string): boolean {
  const advised = ADVISED_MODELS[provider];
  if (!advised) return false;
  return modelId === advised || modelId.endsWith(advised.replace(/^[^/]+\//, ""));
}

/** True if the key looks like an OpenAI key (sk- but not sk-or-). Used with OpenRouter to show only OpenAI models. */
function looksLikeOpenAIKey(key: string): boolean {
  const k = key.trim();
  return k.length > 0 && k.startsWith("sk-") && !k.toLowerCase().startsWith("sk-or-");
}

type DmRequest = {
  channel: string;
  code: string;
  account?: string;
  senderId?: string;
  senderName?: string;
  message?: string;
  createdAt?: string;
};

type Provider = {
  id: string;
  label: string;
  placeholder: string;
  defaultModelHint: string;
  url: string;
  logo: React.ReactNode;
  /** 企业自建 / 自定义 API：需用户输入 baseUrl、API Key 请求头、模型名 */
  isCustom?: boolean;
};

const PROVIDERS: Provider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    placeholder: "sk-or-...",
    defaultModelHint: "claude-sonnet",
    url: "https://openrouter.ai/keys",
    logo: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    id: "openai",
    label: "OpenAI",
    placeholder: "sk-...",
    defaultModelHint: "gpt-4",
    url: "https://platform.openai.com/api-keys",
    logo: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
      </svg>
    ),
  },
  {
    id: "anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-...",
    defaultModelHint: "claude-sonnet",
    url: "https://console.anthropic.com/settings/keys",
    logo: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0l6.569-16.96zm2.327 5.093L6.453 14.58h4.886L8.896 8.613z" />
      </svg>
    ),
  },
  {
    id: "custom",
    label: "企业自建",
    placeholder: "Bearer ...",
    defaultModelHint: "gpt-4",
    url: "",
    isCustom: true,
    logo: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
];

type Channel = {
  id: string;
  label: string;
  placeholder: string;
  helpText: string;
  logo: React.ReactNode;
};

const CHANNELS: Channel[] = [
  {
    id: "telegram",
    label: "Telegram",
    placeholder: "123456:ABC-DEF...",
    helpText: "Create a bot via @BotFather on Telegram to get your token.",
    logo: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
  {
    id: "discord",
    label: "Discord",
    placeholder: "MTA2NjY...",
    helpText: "Create a bot in the Discord Developer Portal and copy the bot token.",
    logo: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    ),
  },
];

// Cycling messages for the gateway start loading state
const SAVING_STAGES = [
  { label: "Saving configuration...", threshold: 0 },
  { label: "Writing config file...", threshold: 10 },
  { label: "Starting gateway...", threshold: 25 },
  { label: "Applying channel settings...", threshold: 50 },
  { label: "Almost ready...", threshold: 80 },
];

const SAVING_STAGES_NO_CHANNEL = [
  { label: "Saving configuration...", threshold: 0 },
  { label: "Writing config file...", threshold: 10 },
  { label: "Starting gateway...", threshold: 25 },
  { label: "Checking gateway health...", threshold: 50 },
  { label: "Almost ready...", threshold: 80 },
];

const POST_ONBOARDING_KEY = "mc-post-onboarding";

function isMatchingChannel(channelName: string, expected: string): boolean {
  const ch = channelName.toLowerCase();
  const base = expected.toLowerCase();
  return (
    ch === base ||
    ch.startsWith(`${base}:`) ||
    ch.startsWith(`${base}-`) ||
    ch.startsWith(`${base}/`) ||
    ch.startsWith(`${base}@`)
  );
}

type Props = { onComplete: () => void };

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 state
  const [provider, setProvider] = useState<string>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [validated, setValidated] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [validating, setValidating] = useState(false);
  // 企业自建 Provider
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKeyHeader, setCustomApiKeyHeader] = useState("Authorization");
  const [customModelManual, setCustomModelManual] = useState("");
  /** true=支持 /v1/models 拉取列表并验证；false=不支持，直接填 URL 全路径 + 模型名，无需验证 */
  const [customSupportsModels, setCustomSupportsModels] = useState(true);

  // Step 2 state
  const [selectedChannel, setSelectedChannel] = useState<string>("telegram");
  const [channelTokens, setChannelTokens] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [savingIncludesChannel, setSavingIncludesChannel] = useState(false);
  const saveProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 3 state (pairing)
  const [pairingRequests, setPairingRequests] = useState<DmRequest[]>([]);
  const [approving, setApproving] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [botNames, setBotNames] = useState<Record<string, string>>({});
  const [pairingPollError, setPairingPollError] = useState(false);
  const [pairingRefreshing, setPairingRefreshing] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const autoValidateRef = useRef<((p: string, key: string) => void) | null>(null);

  const selectedProvider = PROVIDERS.find((p) => p.id === provider)!;
  const activeChannel = CHANNELS.find((c) => c.id === selectedChannel)!;
  const activeChannelToken = channelTokens[selectedChannel] || "";

  // ── Step 1: Validate key + fetch models ──

  const validateKey = useCallback(
    async (
      providerId: string,
      key: string,
      customOpts?: { customBaseUrl: string; customApiKeyHeader: string },
    ) => {
      if (!key.trim()) return;
      const isCustom = providerId === "custom";
      if (isCustom) {
        const baseUrl = (customOpts?.customBaseUrl ?? customBaseUrl).trim();
        if (!baseUrl) {
          setError("请输入 Base URL");
          return;
        }
      }
      setValidating(true);
      setError(null);
      try {
        const customBody = isCustom
          ? {
              customBaseUrl: (customOpts?.customBaseUrl ?? customBaseUrl).trim(),
              customApiKeyHeader: (customOpts?.customApiKeyHeader ?? customApiKeyHeader).trim() || "Authorization",
            }
          : {};
        const res = await fetch("/api/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "validate-key", provider: providerId, token: key, ...customBody }),
        });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Invalid API key.");
        setValidating(false);
        return;
      }
      setValidated(true);

      const modelsRes = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-models", provider: providerId, token: key, ...customBody }),
      });
      const modelsData = await modelsRes.json();
      if (modelsData.ok && Array.isArray(modelsData.models)) {
        let list: Model[] = modelsData.models;
        // OpenRouter accepts OpenAI keys; with an OpenAI key only OpenAI models work — filter to those
        if (providerId === "openrouter" && looksLikeOpenAIKey(key)) {
          list = list.filter((m) => /openai\/|^openai\//i.test(m.id) || m.id.includes("/openai/"));
        }
        // Sort advised model to top
        const sorted = [...list].sort((a, b) =>
          isAdvisedModel(providerId, a.id) ? -1 : isAdvisedModel(providerId, b.id) ? 1 : 0
        );
        setModels(sorted);
        // Auto-select advised model, fallback to hint match, then first
        const defaultModel =
          sorted.find((m) => isAdvisedModel(providerId, m.id)) ||
          sorted.find((m) => m.id.includes(PROVIDERS.find((p) => p.id === providerId)?.defaultModelHint ?? "")) ||
          sorted[0];
        if (defaultModel) setSelectedModel(defaultModel.id);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setValidating(false);
    }
  },
  [customBaseUrl, customApiKeyHeader],
);

  const handleValidate = useCallback(
    () =>
      validateKey(
        provider,
        apiKey,
        provider === "custom" ? { customBaseUrl, customApiKeyHeader } : undefined,
      ),
    [provider, apiKey, customBaseUrl, customApiKeyHeader, validateKey],
  );

  autoValidateRef.current = validateKey;

  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    setApiKey("");
    setValidated(false);
    setModels([]);
    setSelectedModel("");
    setCustomBaseUrl("");
    setCustomApiKeyHeader("Authorization");
    setCustomModelManual("");
    setCustomSupportsModels(true);
    setError(null);
  }, []);

  /** 企业自建且不支持 models 时，填写完整即可，无需验证 */
  const customReadyWithoutValidation =
    provider === "custom" &&
    !customSupportsModels &&
    customBaseUrl.trim() &&
    apiKey.trim() &&
    customModelManual.trim();

  const canProceedStep1 =
    (provider !== "custom" && validated && selectedModel) ||
    (provider === "custom" &&
      customSupportsModels &&
      validated &&
      (selectedModel || customModelManual.trim())) ||
    customReadyWithoutValidation;

  // ── Step 2: Save config + restart gateway ──

  const completeOnboarding = useCallback(() => {
    try {
      localStorage.setItem(POST_ONBOARDING_KEY, "1");
    } catch {
      // ignore storage failures in private mode
    }
    onComplete();
  }, [onComplete]);

  const saveAndRestart = useCallback(async (opts: { goToPairing: boolean; tokens?: Record<string, string> }) => {
    const effectiveTokens = opts.tokens ?? channelTokens;
    const telegramToken = (effectiveTokens.telegram || "").trim();
    const discordToken = (effectiveTokens.discord || "").trim();
    const hasChannelTokens = Boolean(telegramToken || discordToken);

    setSavingIncludesChannel(hasChannelTokens);
    setSaving(true);
    setSaveProgress(0);
    setError(null);
    setSaveError(null);

    saveProgressRef.current = setInterval(() => {
      setSaveProgress((prev) => {
        if (prev >= 90) return prev;
        const remaining = 90 - prev;
        return prev + remaining * 0.035;
      });
    }, 500);

    try {
      const effectiveModel =
        provider === "custom"
          ? (selectedModel || customModelManual.trim() || selectedModel)
          : selectedModel;
      const modelForApi =
        provider === "custom" && effectiveModel && !effectiveModel.startsWith("custom/")
          ? `custom/${effectiveModel}`
          : effectiveModel;
      const body: Record<string, string> = {
        action: "save-and-restart",
        provider,
        apiKey,
        model: modelForApi,
        telegramToken,
        discordToken,
      };
      if (provider === "custom") {
        body.customBaseUrl = customBaseUrl.trim();
        body.customApiKeyHeader = customApiKeyHeader.trim() || "Authorization";
      }
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setSaveError(data.error ?? "Failed to save configuration.");
        return;
      }
      setSaveProgress(100);
      setTimeout(() => {
        if (opts.goToPairing && hasChannelTokens) {
          setStep(3);
          return;
        }
        completeOnboarding();
      }, 300);
    } catch {
      setSaveError("Network error while saving. Please try again.");
    } finally {
      if (saveProgressRef.current) clearInterval(saveProgressRef.current);
      setSaving(false);
    }
  }, [provider, apiKey, selectedModel, customBaseUrl, customApiKeyHeader, customModelManual, channelTokens, completeOnboarding]);

  const handleSaveAndRestart = useCallback(async () => {
    if (!activeChannelToken.trim()) return;
    await saveAndRestart({ goToPairing: true });
  }, [activeChannelToken, saveAndRestart]);

  const handleStartChatNow = useCallback(async () => {
    await saveAndRestart({
      goToPairing: false,
      tokens: { telegram: "", discord: "" },
    });
  }, [saveAndRestart]);

  const handleSetUpLater = useCallback(async () => {
    await saveAndRestart({
      goToPairing: false,
      tokens: { telegram: "", discord: "" },
    });
  }, [saveAndRestart]);

  // ── Step 3: Poll pairing requests ──

  const configuredChannels = CHANNELS.filter((c) => channelTokens[c.id]?.trim());

  const fetchPairing = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setPairingRefreshing(true);
    try {
      // Cache-bust so browsers/proxies never return a stale empty list
      const res = await fetch(`/api/pairing?_=${Date.now()}`, {
        cache: "no-store",
        headers: { Pragma: "no-cache" },
      });
      if (!res.ok) throw new Error(`Pairing API ${res.status}`);
      const data = await res.json();
      const allDm = data.dm || [];
      // On step 3 always show all DM requests so pending Telegram (etc.) is never hidden
      setPairingRequests(allDm);
      setPairingPollError(false);
    } catch {
      setPairingPollError(true);
    } finally {
      if (showRefreshing) setPairingRefreshing(false);
    }
  }, []);

  // Poll for pairing requests every 5s when on step 3
  // Note: useSmartPoll has reliability issues in dev/Turbopack — use direct interval
  useEffect(() => {
    if (step !== 3) return;
    void fetchPairing();
    const timer = setInterval(() => void fetchPairing(), 5000);
    return () => clearInterval(timer);
  }, [step, fetchPairing]);

  useEffect(() => {
    if (step !== 3) return;
    // Fetch bot names for configured channels
    for (const ch of configuredChannels) {
      const token = channelTokens[ch.id]?.trim();
      if (!token) continue;
      fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get-bot-info", channel: ch.id, token }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.ok && (data.username || data.name)) {
            setBotNames((prev) => ({ ...prev, [ch.id]: data.username || data.name }));
          }
        })
        .catch(() => {});
    }
  }, [step, configuredChannels, channelTokens]);

  const handleApprove = useCallback(
    async (channel: string, code: string, account?: string) => {
      setApproving(code);
      setError(null);
      try {
        const res = await fetch("/api/pairing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve-dm", channel, code, account }),
        });
        const data = await res.json().catch(() => null);
        if (data?.ok) {
          setApproved(true);
          setTimeout(() => completeOnboarding(), 1500);
        } else {
          setError(data?.error || `Approve failed (${res.status}).`);
        }
      } catch (err) {
        setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setApproving(null);
      }
    },
    [completeOnboarding],
  );

  // Derive current saving stage label
  const activeSavingStages = savingIncludesChannel ? SAVING_STAGES : SAVING_STAGES_NO_CHANNEL;
  const currentSavingStage = activeSavingStages.filter((s) => saveProgress >= s.threshold).at(-1)!;

  const STEPS = [
    { n: 1, label: "Model" },
    { n: 2, label: "Channel" },
    { n: 3, label: "Pairing" },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 dark:bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-[460px] mx-4 rounded-2xl border border-stone-200 dark:border-[#23282e] bg-white dark:bg-[#171a1d] shadow-2xl shadow-black/30 overflow-hidden">

        {/* Step indicator — top rail */}
        <div className="px-8 pt-7 pb-5">
          <div className="flex items-center gap-0">
            {STEPS.map((s, i) => {
              const done = s.n < step;
              const active = s.n === step;
              return (
                <div key={s.n} className="flex items-center flex-1 last:flex-none">
                  {/* Node */}
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ring-1 transition-all duration-300",
                        done
                          ? "bg-emerald-500 dark:bg-emerald-500 text-white ring-emerald-500 dark:ring-emerald-500"
                          : active
                            ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 ring-stone-900 dark:ring-stone-100"
                            : "bg-transparent text-stone-400 dark:text-stone-600 ring-stone-200 dark:ring-[#2e343b]",
                      )}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : s.n}
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-medium tracking-wide uppercase transition-colors duration-300",
                        active
                          ? "text-stone-900 dark:text-[#f5f7fa]"
                          : done
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-stone-400 dark:text-stone-600",
                      )}
                    >
                      {s.label}
                    </span>
                  </div>
                  {/* Connector (not after last) */}
                  {i < STEPS.length - 1 && (
                    <div className="relative flex-1 mx-2 mb-4">
                      <div className="h-px w-full bg-stone-200 dark:bg-[#23282e]" />
                      <div
                        className="absolute inset-y-0 left-0 h-px bg-emerald-500 dark:bg-emerald-500 transition-all duration-500"
                        style={{ width: done ? "100%" : "0%" }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-stone-100 dark:bg-[#23282e]" />

        <div className="px-8 py-7 max-h-[min(70vh,520px)] overflow-y-auto overscroll-contain">
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 mb-1">
                  <Key className="h-3.5 w-3.5 text-stone-400 dark:text-[#a8b0ba]" />
                  <h2 className="text-base font-semibold tracking-tight text-stone-900 dark:text-[#f5f7fa]">
                    Configure your AI model
                  </h2>
                </div>
                <p className="text-sm text-stone-500 dark:text-[#a8b0ba] leading-relaxed">
                  Choose a provider, enter your API key, and select a model.
                </p>
              </div>

              {/* Provider cards */}
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map((p) => {
                  const isSelected = provider === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleProviderChange(p.id)}
                      disabled={validating}
                      className={cn(
                        "group relative flex flex-col items-center gap-2.5 rounded-xl border px-3 py-4 transition-all duration-200",
                        isSelected
                          ? "border-stone-900 dark:border-stone-200/60 bg-stone-900 dark:bg-stone-100/[0.07] text-stone-900 dark:text-[#f5f7fa] shadow-sm"
                          : "border-stone-200 dark:border-[#23282e] bg-white dark:bg-[#0d1014] text-stone-400 dark:text-[#5a6270] hover:border-stone-300 dark:hover:border-[#343b44] hover:text-stone-700 dark:hover:text-[#a8b0ba] hover:-translate-y-px hover:shadow-sm",
                        validating && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      {/* Selected indicator dot */}
                      {isSelected && (
                        <span className="absolute top-2.5 right-2.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                      <span className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-200",
                        isSelected
                          ? "bg-stone-100 dark:bg-white/10 text-stone-900 dark:text-[#f5f7fa]"
                          : "bg-stone-100 dark:bg-[#1c2128] text-stone-500 dark:text-[#5a6270] group-hover:text-stone-700 dark:group-hover:text-[#a8b0ba]",
                      )}>
                        {p.logo}
                      </span>
                      <span className={cn(
                        "text-xs font-medium transition-colors duration-200",
                        isSelected ? "text-stone-900 dark:text-[#f5f7fa]" : "text-stone-500 dark:text-[#5a6270]",
                      )}>
                        {p.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-stone-500 dark:text-[#a8b0ba]">
                  {selectedProvider.isCustom
                    ? "连接企业自建的 OpenAI 兼容 API。支持 /v1/models 的可验证并拉取模型列表；不支持的直接填完整 URL 和模型名。"
                    : "New to this? Start with OpenRouter — it supports all major models and you only pay for what you use."}
                </p>
                {!selectedProvider.isCustom && (
                <div className="rounded-xl border border-stone-200 dark:border-[#23282e] bg-stone-50 dark:bg-[#0d1014] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Key className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                    <span className="text-xs font-semibold text-stone-800 dark:text-[#d6dce3]">
                      Get your {selectedProvider.label} API key
                    </span>
                  </div>
                  <ol className="space-y-2.5">
                    <li className="flex items-start gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200/80 dark:bg-[#20252a] text-[10px] font-semibold text-stone-600 dark:text-[#7a8591] ring-1 ring-stone-300 dark:ring-[#2c343d]">
                        1
                      </span>
                      <p className="pt-0.5 text-xs leading-relaxed text-stone-500 dark:text-[#a8b0ba]">
                        Open the{" "}
                        <a
                          href={selectedProvider.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 underline underline-offset-2 hover:opacity-90"
                        >
                          {selectedProvider.label} API keys page
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                        .
                      </p>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200/80 dark:bg-[#20252a] text-[10px] font-semibold text-stone-600 dark:text-[#7a8591] ring-1 ring-stone-300 dark:ring-[#2c343d]">
                        2
                      </span>
                      <p className="pt-0.5 text-xs leading-relaxed text-stone-500 dark:text-[#a8b0ba]">
                        Create a new API key and copy it.
                      </p>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200/80 dark:bg-[#20252a] text-[10px] font-semibold text-stone-600 dark:text-[#7a8591] ring-1 ring-stone-300 dark:ring-[#2c343d]">
                        3
                      </span>
                      <p className="pt-0.5 text-xs leading-relaxed text-stone-500 dark:text-[#a8b0ba]">
                        Paste it below and we&apos;ll validate it instantly.
                      </p>
                    </li>
                  </ol>
                  {provider === "openai" && (
                    <p className="mt-3 rounded-lg bg-amber-100/70 dark:bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                      ChatGPT Plus does not include API access. You need API credits at{" "}
                      <a
                        href="https://platform.openai.com/settings/organization/billing"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium underline underline-offset-2"
                      >
                        platform.openai.com/settings/organization/billing
                      </a>
                      .
                    </p>
                  )}
                </div>
                )}

              {provider === "custom" && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <span className="block text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-[#5a6270]">
                      API 能力
                    </span>
                    <div className="flex gap-4">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="customModelsMode"
                          checked={customSupportsModels}
                          onChange={() => {
                            setCustomSupportsModels(true);
                            setValidated(false);
                            setModels([]);
                            setSelectedModel("");
                            setError(null);
                          }}
                          className="h-3.5 w-3.5 accent-stone-700 dark:accent-stone-300"
                        />
                        <span className="text-sm text-stone-700 dark:text-[#d6dce3]">支持模型列表</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="customModelsMode"
                          checked={!customSupportsModels}
                          onChange={() => {
                            setCustomSupportsModels(false);
                            setValidated(false);
                            setModels([]);
                            setSelectedModel("");
                            setError(null);
                          }}
                          className="h-3.5 w-3.5 accent-stone-700 dark:accent-stone-300"
                        />
                        <span className="text-sm text-stone-700 dark:text-[#d6dce3]">不支持，直接填 URL 和模型名</span>
                      </label>
                    </div>
                    <p className="text-[11px] text-stone-500 dark:text-[#5a6270]">
                      {customSupportsModels
                        ? "支持 /v1/models 的 API：验证密钥后可拉取模型列表选择"
                        : "不支持 /v1/models 的 API：填写完整 Base URL 和模型名称，无需验证"}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-[#5a6270]">
                      {customSupportsModels ? "Base URL" : "API Base URL（完整路径）"}
                    </label>
                    <input
                      type="url"
                      value={customBaseUrl}
                      onChange={(e) => {
                        setCustomBaseUrl(e.target.value);
                        if (validated) {
                          setValidated(false);
                          setModels([]);
                          setSelectedModel("");
                        }
                        setError(null);
                      }}
                      placeholder={customSupportsModels ? "https://api.your-company.com/v1" : "https://api.your-company.com/v1（完整路径，勿省略）"}
                      disabled={validating}
                      className="w-full rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-[#0d1014] border border-stone-200 dark:border-[#23282e] text-stone-900 dark:text-[#f5f7fa] placeholder:text-stone-300 dark:placeholder:text-[#3a424c] focus:outline-none focus:ring-2 focus:ring-stone-400/40 dark:focus:ring-stone-500/30 focus:border-stone-400 dark:focus:border-stone-500 disabled:opacity-50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-[#5a6270]">
                      API Key 请求头
                    </label>
                    <select
                      value={customApiKeyHeader}
                      onChange={(e) => {
                        setCustomApiKeyHeader(e.target.value);
                        if (validated) {
                          setValidated(false);
                          setModels([]);
                          setSelectedModel("");
                        }
                        setError(null);
                      }}
                      disabled={validating}
                      className="w-full rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-[#0d1014] border border-stone-200 dark:border-[#23282e] text-stone-900 dark:text-[#f5f7fa] focus:outline-none focus:ring-2 focus:ring-stone-400/40 dark:focus:ring-stone-500/30 disabled:opacity-50"
                    >
                      <option value="Authorization">Authorization (Bearer)</option>
                      <option value="X-API-Key">X-API-Key</option>
                    </select>
                  </div>
                </div>
              )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-[#5a6270]">
                  {selectedProvider.label} API Key
                </label>
                <div className="relative flex items-center gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      if (validated) {
                        setValidated(false);
                        setModels([]);
                        setSelectedModel("");
                      }
                      setError(null);
                    }}
                    onPaste={(e) => {
                      const pasted = e.clipboardData.getData("text").trim();
                      if (pasted) {
                        e.preventDefault();
                        setApiKey(pasted);
                        setValidated(false);
                        setModels([]);
                        setSelectedModel("");
                        setError(null);
                        if (provider !== "custom" || customSupportsModels) {
                          setTimeout(() => autoValidateRef.current?.(provider, pasted), 0);
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !validated && !validating && apiKey.trim() && (provider !== "custom" || customSupportsModels)) {
                        handleValidate();
                      }
                    }}
                    placeholder={selectedProvider.placeholder}
                    disabled={validating}
                    className="flex-1 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-[#0d1014] border border-stone-200 dark:border-[#23282e] text-stone-900 dark:text-[#f5f7fa] placeholder:text-stone-300 dark:placeholder:text-[#3a424c] focus:outline-none focus:ring-2 focus:ring-stone-400/40 dark:focus:ring-stone-500/30 focus:border-stone-400 dark:focus:border-stone-500 disabled:opacity-50 transition-all duration-200"
                  />
                  {/* 企业自建且支持 models：显示验证按钮 */}
                  {provider === "custom" && customSupportsModels && customBaseUrl.trim() && apiKey.trim() && !validated && !validating && (
                    <button
                      type="button"
                      onClick={handleValidate}
                      className="shrink-0 rounded-lg px-3 py-2.5 text-xs font-medium bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-300 transition-colors"
                    >
                      验证
                    </button>
                  )}
                  {/* Inline validation pill — 不支持 models 模式不显示 */}
                  {(provider !== "custom" || customSupportsModels) && (validating || validated) && (
                    <div
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-300",
                        validating
                          ? "bg-stone-100 dark:bg-[#1c2128] text-stone-500 dark:text-[#a8b0ba]"
                          : "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/20",
                      )}
                    >
                      {validating ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      {validating ? "Checking" : "Verified"}
                    </div>
                  )}
                </div>
                {error && (
                  <p className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400 mt-1">
                    <span className="inline-block h-1 w-1 rounded-full bg-red-500 dark:bg-red-400 shrink-0" />
                    {error}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-[#5a6270]">
                  Model
                </label>
                {provider === "custom" && !customSupportsModels ? (
                  <input
                    type="text"
                    value={customModelManual}
                    onChange={(e) => {
                      setCustomModelManual(e.target.value);
                      setError(null);
                    }}
                    placeholder="例如: gpt-4、claude-3-sonnet"
                    disabled={saving}
                    className="w-full rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-[#0d1014] border border-stone-200 dark:border-[#23282e] text-stone-900 dark:text-[#f5f7fa] placeholder:text-stone-300 dark:placeholder:text-[#3a424c] focus:outline-none focus:ring-2 focus:ring-stone-400/40 dark:focus:ring-stone-500/30 focus:border-stone-400 dark:focus:border-stone-500 disabled:opacity-50"
                  />
                ) : !validated ? (
                  <div className="w-full rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-[#0d1014] border border-stone-200 dark:border-[#23282e] text-stone-400 dark:text-[#5a6270] opacity-40 cursor-not-allowed">
                    {provider === "custom" ? "填写 Base URL 与 API Key，粘贴密钥或按 Enter 验证" : "Validate your API key first"}
                  </div>
                ) : provider === "custom" && models.length === 0 ? (
                  <input
                    type="text"
                    value={customModelManual}
                    onChange={(e) => {
                      setCustomModelManual(e.target.value);
                      setError(null);
                    }}
                    placeholder="例如: gpt-4、claude-3-sonnet"
                    disabled={validating}
                    className="w-full rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-[#0d1014] border border-stone-200 dark:border-[#23282e] text-stone-900 dark:text-[#f5f7fa] placeholder:text-stone-300 dark:placeholder:text-[#3a424c] focus:outline-none focus:ring-2 focus:ring-stone-400/40 dark:focus:ring-stone-500/30 focus:border-stone-400 dark:focus:border-stone-500 disabled:opacity-50"
                  />
                ) : validated && models.length > 0 ? (
                  <>
                  <Combobox
                    items={models}
                    value={models.find((m) => m.id === selectedModel) ?? null}
                    onValueChange={(val) => setSelectedModel(val?.id ?? "")}
                    itemToStringLabel={(m) => getFriendlyModelName(m.id)}
                    itemToStringValue={(m) => {
                      const friendly = getFriendlyModelName(m.id);
                      const idWithSpaces = m.id.replace(/[-./_]/g, " ").toLowerCase();
                      const friendlyLower = friendly.toLowerCase();
                      return `${friendly} ${m.name} ${m.id} ${idWithSpaces} ${friendlyLower}`;
                    }}
                  >
                    <ComboboxInput
                      placeholder="Type to search (e.g. claude, sonnet, gpt)…"
                      className="w-full"
                      aria-label="Search or select model"
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>
                        <span className="block text-muted-foreground">No models match. Try a shorter term (e.g. &quot;claude&quot;, &quot;sonnet&quot;) or scroll to browse.</span>
                      </ComboboxEmpty>
                      <ComboboxList>
                        {(model) => (
                          <ComboboxItem key={model.id} value={model}>
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{getFriendlyModelName(model.id)}</span>
                                {isAdvisedModel(provider, model.id) && (
                                  <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                                    Advised
                                  </span>
                                )}
                              </div>
                              {getFriendlyModelName(model.id) !== model.id && (
                                <span className="font-mono text-[11px] text-muted-foreground">{model.id}</span>
                              )}
                            </div>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <p className="mt-1.5 text-[11px] text-stone-400 dark:text-[#5a6270]">
                    Search by display name or model ID — partial matches work
                  </p>
                  </>
                ) : (
                  <div className="w-full rounded-lg px-3 py-2.5 text-sm bg-stone-50 dark:bg-[#0d1014] border border-stone-200 dark:border-[#23282e] text-stone-500 dark:text-[#5a6270]">
                    No models returned from API
                  </div>
                )}
              </div>

              {saveError && !saving && (
                <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-3.5 animate-in fade-in duration-300">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-500 dark:text-red-400 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                        Configuration failed
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-red-600 dark:text-red-400/90">
                        {saveError}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSaveError(null)}
                      className="shrink-0 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300"
                    >
                      <span className="sr-only">Dismiss</span>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  onClick={() => { setError(null); setSaveError(null); setStep(2); }}
                  disabled={!canProceedStep1 || saving || validating}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-stone-500 dark:text-[#a8b0ba] ring-1 ring-stone-200 dark:ring-[#2c343d] hover:bg-stone-100 dark:hover:bg-[#1c2128] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                >
                  Connect Telegram/Discord now
                </button>
                <button
                  onClick={handleStartChatNow}
                  disabled={!canProceedStep1 || saving || validating}
                  className="flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 shadow-sm"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      Start chat now
                      <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>

              {saving && (
                <div className="space-y-2 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-stone-500 dark:text-[#a8b0ba] transition-all duration-500">
                      {currentSavingStage.label}
                    </span>
                    <span className="text-xs tabular-nums text-stone-400 dark:text-[#5a6270]">
                      {Math.round(saveProgress)}%
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-[#23282e]">
                    <div
                      className="h-full rounded-full bg-stone-900 dark:bg-stone-200 transition-all duration-500 ease-out"
                      style={{ width: `${saveProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-stone-400 dark:text-[#5a6270]">
                    Gateway startup can take up to 30s &mdash; hang tight.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 mb-1">
                  <Bot className="h-3.5 w-3.5 text-stone-400 dark:text-[#a8b0ba]" />
                  <h2 className="text-base font-semibold tracking-tight text-stone-900 dark:text-[#f5f7fa]">
                    Connect a channel (optional)
                  </h2>
                </div>
                <p className="text-sm text-stone-500 dark:text-[#a8b0ba] leading-relaxed">
                  Connect Telegram or Discord now, or start in browser chat and add channels later.
                </p>
              </div>

              {/* Channel cards */}
              <div className="grid grid-cols-2 gap-2">
                {CHANNELS.map((c) => {
                  const isSelected = selectedChannel === c.id;
                  const hasToken = !!channelTokens[c.id]?.trim();
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setSelectedChannel(c.id); setError(null); }}
                      disabled={saving}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl border px-4 py-3.5 transition-all duration-200 text-left",
                        isSelected
                          ? "border-stone-900 dark:border-stone-200/60 bg-stone-900 dark:bg-stone-100/[0.07] shadow-sm"
                          : "border-stone-200 dark:border-[#23282e] bg-white dark:bg-[#0d1014] hover:border-stone-300 dark:hover:border-[#343b44] hover:-translate-y-px hover:shadow-sm",
                        saving && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <span className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
                        isSelected
                          ? "bg-stone-100 dark:bg-white/10 text-stone-900 dark:text-[#f5f7fa]"
                          : "bg-stone-100 dark:bg-[#1c2128] text-stone-500 dark:text-[#5a6270] group-hover:text-stone-700 dark:group-hover:text-[#a8b0ba]",
                      )}>
                        {c.logo}
                      </span>
                      <span className={cn(
                        "text-sm font-medium transition-colors duration-200",
                        isSelected ? "text-white dark:text-[#f5f7fa]" : "text-stone-600 dark:text-[#a8b0ba]",
                      )}>
                        {c.label}
                      </span>
                      {hasToken && (
                        <span className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 dark:bg-emerald-500/20">
                          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium uppercase tracking-wide text-stone-400 dark:text-[#5a6270]">
                  {activeChannel.label} Bot Token
                </label>
                <input
                  type="password"
                  value={activeChannelToken}
                  onChange={(e) => {
                    setChannelTokens((prev) => ({ ...prev, [selectedChannel]: e.target.value }));
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && activeChannelToken.trim() && !saving) {
                      handleSaveAndRestart();
                    }
                  }}
                  placeholder={activeChannel.placeholder}
                  disabled={saving}
                  className="w-full rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-[#0d1014] border border-stone-200 dark:border-[#23282e] text-stone-900 dark:text-[#f5f7fa] placeholder:text-stone-300 dark:placeholder:text-[#3a424c] focus:outline-none focus:ring-2 focus:ring-stone-400/40 dark:focus:ring-stone-500/30 focus:border-stone-400 dark:focus:border-stone-500 disabled:opacity-50 transition-all duration-200"
                />
                <p className="text-xs text-stone-400 dark:text-[#5a6270] leading-relaxed">
                  {activeChannel.helpText}
                </p>
                {error && (
                  <p className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400">
                    <span className="inline-block h-1 w-1 rounded-full bg-red-500 dark:bg-red-400 shrink-0" />
                    {error}
                  </p>
                )}
              </div>

              {saveError && !saving && (
                <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-3.5 animate-in fade-in duration-300">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-500 dark:text-red-400 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                        Configuration failed
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-red-600 dark:text-red-400/90">
                        {saveError}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSaveError(null)}
                      className="shrink-0 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300"
                    >
                      <span className="sr-only">Dismiss</span>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              )}

              {saving && (
                <div className="space-y-2 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-stone-500 dark:text-[#a8b0ba] transition-all duration-500">
                      {currentSavingStage.label}
                    </span>
                    <span className="text-xs tabular-nums text-stone-400 dark:text-[#5a6270]">
                      {Math.round(saveProgress)}%
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-[#23282e]">
                    <div
                      className="h-full rounded-full bg-stone-900 dark:bg-stone-200 transition-all duration-500 ease-out"
                      style={{ width: `${saveProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-stone-400 dark:text-[#5a6270]">
                    Gateway startup can take up to 30s &mdash; hang tight.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setError(null); setSaveError(null); setStep(1); }}
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-stone-500 dark:text-[#a8b0ba] hover:bg-stone-100 dark:hover:bg-[#1c2128] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>
                  <button
                    onClick={handleSetUpLater}
                    disabled={saving}
                    className="rounded-lg px-3 py-2 text-xs font-medium text-stone-500 dark:text-[#a8b0ba] ring-1 ring-stone-200 dark:ring-[#2c343d] hover:bg-stone-100 dark:hover:bg-[#1c2128] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    Set up later
                  </button>
                </div>
                <button
                  onClick={handleSaveAndRestart}
                  disabled={!activeChannelToken.trim() || saving}
                  className="flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 shadow-sm"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      Save & Continue
                      <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="relative space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              {approved && <OnboardingSuccessFireworks />}
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-stone-400 dark:text-[#a8b0ba]" />
                  <h2 className="text-base font-semibold tracking-tight text-stone-900 dark:text-[#f5f7fa]">
                    Pair your account
                  </h2>
                </div>
                <p className="text-sm text-stone-500 dark:text-[#a8b0ba] leading-relaxed">
                  Send any message to your bot
                  {Object.keys(botNames).length > 0 && (
                    <>
                      {" "}
                      <span className="font-mono text-xs text-stone-700 dark:text-[#d4dae2] font-semibold">
                        {configuredChannels.map((c) => botNames[c.id]).filter(Boolean).join(" / ")}
                      </span>
                    </>
                  )}
                  {" "}on{" "}
                  <span className="text-stone-700 dark:text-[#d4dae2] font-medium">
                    {configuredChannels.map((c) => c.label).join(" or ")}
                  </span>
                  , then approve the request below.
                </p>
              </div>

              {approved ? (
                <div className="flex flex-col items-center gap-3 py-8 animate-in fade-in duration-300">
                  <div className="relative flex h-14 w-14 items-center justify-center">
                    <span className="absolute inset-0 rounded-full bg-emerald-500/15 dark:bg-emerald-500/10 animate-ping" />
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15 ring-1 ring-emerald-200 dark:ring-emerald-500/20">
                      <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                  </div>
                  <div className="text-center space-y-0.5">
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      Pairing approved
                    </p>
                    <p className="text-xs text-stone-400 dark:text-[#5a6270]">
                      Finishing setup...
                    </p>
                  </div>
                </div>
              ) : pairingRequests.length === 0 ? (
                <PairingWaitState configuredChannels={configuredChannels} botNames={botNames} />
              ) : (
                <div className="space-y-2">
                  {pairingRequests.map((req) => (
                    <div
                      key={req.code}
                      className="rounded-xl border border-stone-200 dark:border-[#23282e] bg-stone-50 dark:bg-[#0d1014] p-4 animate-in fade-in duration-200"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-200 dark:border-sky-500/20 bg-sky-50 dark:bg-sky-500/10">
                          <MessageCircle className="h-4 w-4 text-sky-500 dark:text-sky-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-stone-800 dark:text-[#f5f7fa] capitalize">
                              {req.channel}
                            </span>
                            <span className="rounded-full bg-stone-100 dark:bg-[#23282e] px-1.5 py-0.5 text-[10px] text-stone-500 dark:text-[#a8b0ba]">
                              DM pairing
                            </span>
                          </div>
                          {(req.senderName || req.senderId) && (
                            <p className="mt-1 text-sm font-medium text-stone-700 dark:text-[#d6dce3]">
                              {req.senderName || req.senderId}
                            </p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <code className="rounded-md bg-violet-500/10 dark:bg-violet-500/15 px-2 py-0.5 text-xs font-bold tracking-widest text-violet-600 dark:text-violet-300 ring-1 ring-violet-200 dark:ring-violet-500/20">
                              {req.code}
                            </code>
                          </div>
                          {req.message && (
                            <p className="mt-1.5 line-clamp-1 text-xs text-stone-400 dark:text-[#5a6270] italic">
                              &ldquo;{req.message}&rdquo;
                            </p>
                          )}
                          {req.createdAt && (
                            <span className="mt-1 flex items-center gap-1 text-[10px] text-stone-400 dark:text-[#5a6270]">
                              <Clock className="h-2.5 w-2.5" />
                              {formatTimeAgo(req.createdAt)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleApprove(req.channel, req.code, req.account)}
                        disabled={approving !== null}
                        className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {approving === req.code ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        )}
                        Approve pairing
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <p className="flex items-center justify-center gap-1.5 text-xs text-red-500 dark:text-red-400">
                  <span className="inline-block h-1 w-1 rounded-full bg-red-500 dark:bg-red-400 shrink-0" />
                  {error}
                </p>
              )}

              {pairingPollError && !approved && (
                <div className="flex items-center justify-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    Could not reach gateway &mdash; retrying automatically
                  </p>
                </div>
              )}

              {!approved && (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                    <p className="text-center text-[11px] text-stone-400 dark:text-[#3a424c]">
                      Polling every 5s &middot; Codes expire after 1 hour
                    </p>
                    <button
                      type="button"
                      onClick={() => void fetchPairing(true)}
                      disabled={pairingRefreshing}
                      className="text-[11px] font-medium text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 disabled:opacity-50"
                    >
                      {pairingRefreshing ? "Checking…" : "Refresh"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={completeOnboarding}
                    className="text-[11px] font-medium text-stone-400 dark:text-[#5a6270] underline underline-offset-2 hover:text-stone-600 dark:hover:text-[#a8b0ba] transition-colors"
                  >
                    Skip pairing, start chatting
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pairing wait state — extracted for clarity ──

function PairingWaitState({ configuredChannels, botNames }: { configuredChannels: Channel[]; botNames: Record<string, string> }) {
  const [scanLine, setScanLine] = useState(0);

  // Animate a vertical scan line across the icon area
  useEffect(() => {
    const id = setInterval(() => {
      setScanLine((prev) => (prev + 1) % 4);
    }, 800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center gap-5 py-6 animate-in fade-in duration-300">
      {/* Icon with animated ring */}
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-stone-200 dark:bg-[#23282e] animate-ping opacity-40" />
        <span className="absolute inset-2 rounded-full bg-stone-100 dark:bg-[#1c2128] animate-ping opacity-30 [animation-delay:400ms]" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-stone-100 dark:bg-[#1c2128] ring-1 ring-stone-200 dark:ring-[#23282e]">
          <Zap
            className={cn(
              "h-6 w-6 transition-colors duration-700",
              scanLine % 2 === 0
                ? "text-stone-400 dark:text-[#5a6270]"
                : "text-stone-600 dark:text-[#a8b0ba]",
            )}
          />
        </div>
      </div>

      {/* Text */}
      <div className="text-center space-y-1.5">
        <p className="text-sm font-semibold text-stone-800 dark:text-[#f5f7fa]">
          Waiting for your message
        </p>
        <p className="text-xs text-stone-500 dark:text-[#a8b0ba] max-w-[260px] leading-relaxed">
          Open{" "}
          <span className="font-medium text-stone-700 dark:text-[#d4dae2]">
            {configuredChannels.map((c) => c.label).join(" or ")}
          </span>
          , find{" "}
          {Object.keys(botNames).length > 0 ? (
            <span className="font-mono font-semibold text-stone-700 dark:text-[#d4dae2]">
              {configuredChannels.map((c) => botNames[c.id]).filter(Boolean).join(" / ")}
            </span>
          ) : (
            "your bot"
          )}
          {" "}and send it any message to start pairing.
        </p>
      </div>

      {/* Subtle channel chips */}
      <div className="flex items-center gap-2">
        {configuredChannels.map((c) => (
          <span
            key={c.id}
            className="flex items-center gap-1.5 rounded-full border border-stone-200 dark:border-[#23282e] bg-stone-50 dark:bg-[#0d1014] px-3 py-1.5 text-xs text-stone-500 dark:text-[#a8b0ba]"
          >
            <span className="[&>svg]:h-3 [&>svg]:w-3">{c.logo}</span>
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function OnboardingSuccessFireworks() {
  const bursts = [
    { x: "14%", y: "24%", delay: 0 },
    { x: "50%", y: "12%", delay: 140 },
    { x: "86%", y: "28%", delay: 280 },
  ];
  const colors = ["#22c55e", "#14b8a6", "#3b82f6", "#f59e0b", "#ec4899", "#a855f7"];
  const particlesPerBurst = 14;

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {bursts.map((burst, burstIndex) => (
          <div
            key={`${burst.x}-${burst.y}`}
            className="absolute"
            style={{ left: burst.x, top: burst.y }}
          >
            {Array.from({ length: particlesPerBurst }).map((_, i) => {
              const angle = Math.round((360 / particlesPerBurst) * i);
              const distance = 54 + (i % 4) * 14;
              const delay = burst.delay + i * 20;
              const particleStyle = {
                "--fw-angle": `${angle}deg`,
                "--fw-distance": `${distance}px`,
                animationDelay: `${delay}ms`,
                backgroundColor: colors[(i + burstIndex) % colors.length],
              } as CSSProperties & Record<`--${string}`, string>;

              return (
                <span
                  key={`${burstIndex}-${i}`}
                  className="onboarding-firework-particle"
                  style={particleStyle}
                />
              );
            })}
          </div>
        ))}
      </div>

      <style jsx>{`
        .onboarding-firework-particle {
          position: absolute;
          left: 0;
          top: 0;
          width: 5px;
          height: 12px;
          border-radius: 9999px;
          opacity: 0;
          transform: translate(-50%, -50%) rotate(var(--fw-angle)) translateY(0) scale(0.65);
          animation: onboarding-firework-burst 900ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes onboarding-firework-burst {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) rotate(var(--fw-angle)) translateY(0) scale(0.65);
          }
          14% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) rotate(var(--fw-angle)) translateY(calc(var(--fw-distance) * -1)) scale(1);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .onboarding-firework-particle {
            animation: none;
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}

function formatTimeAgo(dateStr: string): string {
  const ts = new Date(dateStr).getTime();
  if (!ts) return "";
  const ago = Date.now() - ts;
  if (ago < 60000) return "just now";
  if (ago < 3600000) return Math.floor(ago / 60000) + "m ago";
  if (ago < 86400000) return Math.floor(ago / 3600000) + "h ago";
  return Math.floor(ago / 86400000) + "d ago";
}
