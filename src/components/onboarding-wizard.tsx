"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  AlertCircle,
  Key,
  Radio,
  Eye,
  EyeOff,
  ShieldCheck,
  Star,
  Search,
  ChevronDown,
  ExternalLink,
  SkipForward,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { QrLoginModal } from "@/components/qr-login-modal";

/* ── Types ────────────────────────────────────────── */

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

type ModelItem = { id: string; name: string };

type ProviderDef = {
  id: string;
  label: string;
  defaultModel: string;
  placeholder: string;
  helpUrl: string;
  helpSteps: string[];
};

/* ── Constants ────────────────────────────────────── */

const STEPS: { id: "model" | "channel"; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "model", label: "Connect AI", icon: Key },
  { id: "channel", label: "Messaging", icon: Radio },
];

const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "anthropic/claude-sonnet-4-20250514",
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
    helpSteps: [
      "Go to console.anthropic.com",
      "Navigate to Settings > API Keys",
      "Click \"Create Key\" and copy it",
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "openai/gpt-4o",
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
    helpSteps: [
      "Go to platform.openai.com",
      "Navigate to API Keys",
      "Click \"Create new secret key\" and copy it",
    ],
  },
  {
    id: "google",
    label: "Google",
    defaultModel: "google/gemini-2.0-flash",
    placeholder: "AIza...",
    helpUrl: "https://aistudio.google.com/apikey",
    helpSteps: [
      "Go to aistudio.google.com",
      "Click \"Get API Key\"",
      "Create a key and copy it",
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: "openrouter/anthropic/claude-sonnet-4",
    placeholder: "sk-or-...",
    helpUrl: "https://openrouter.ai/keys",
    helpSteps: [
      "Go to openrouter.ai",
      "Navigate to Keys",
      "Create a new key and copy it",
    ],
  },
  {
    id: "groq",
    label: "Groq",
    defaultModel: "groq/llama-3.3-70b-versatile",
    placeholder: "gsk_...",
    helpUrl: "https://console.groq.com/keys",
    helpSteps: [
      "Go to console.groq.com",
      "Navigate to API Keys",
      "Create a key and copy it",
    ],
  },
  {
    id: "xai",
    label: "xAI",
    defaultModel: "xai/grok-3-mini",
    placeholder: "xai-...",
    helpUrl: "https://console.x.ai/",
    helpSteps: [
      "Go to console.x.ai",
      "Navigate to API Keys",
      "Create a key and copy it",
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    defaultModel: "mistral/mistral-large-latest",
    placeholder: "...",
    helpUrl: "https://console.mistral.ai/api-keys",
    helpSteps: [
      "Go to console.mistral.ai",
      "Navigate to API Keys",
      "Create a key and copy it",
    ],
  },
];

const CHANNEL_OPTIONS = [
  { id: "telegram", label: "Telegram", icon: "\u2708\uFE0F", type: "token" as const, tokenLabel: "Bot Token", placeholder: "123456:ABC-DEF...", instructions: "Find your bot on Telegram and send /start" },
  { id: "discord", label: "Discord", icon: "\uD83C\uDFAE", type: "token" as const, tokenLabel: "Bot Token", placeholder: "MTIzNDU2Nzg5...", instructions: "Add your bot to a server and mention it" },
  { id: "whatsapp", label: "WhatsApp", icon: "\uD83D\uDCAC", type: "qr" as const, instructions: "Open WhatsApp and send a message to your number" },
  { id: "signal", label: "Signal", icon: "\uD83D\uDD12", type: "qr" as const, instructions: "Open Signal and send a message to your agent" },
  { id: "slack", label: "Slack", icon: "\uD83D\uDCBC", type: "token" as const, tokenLabel: "Bot Token", placeholder: "xoxb-...", instructions: "Go to your Slack workspace and DM your bot" },
];

const WELL_KNOWN_MODELS: Record<string, ModelItem[]> = {
  anthropic: [
    { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "anthropic/claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    { id: "anthropic/claude-opus-4-20250514", name: "Claude Opus 4" },
  ],
  openai: [
    { id: "openai/gpt-4o", name: "GPT-4o" },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "openai/o3-mini", name: "o3-mini" },
  ],
  google: [
    { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "google/gemini-2.5-pro-preview-05-06", name: "Gemini 2.5 Pro" },
    { id: "google/gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },
  ],
  openrouter: [
    { id: "openrouter/anthropic/claude-sonnet-4", name: "Claude Sonnet 4 (via OpenRouter)" },
    { id: "openrouter/openai/gpt-4o", name: "GPT-4o (via OpenRouter)" },
    { id: "openrouter/google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash (via OpenRouter)" },
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
};

const RECOMMENDED_MODELS = new Set([
  "anthropic/claude-sonnet-4-20250514",
  "openai/gpt-4o",
  "google/gemini-2.0-flash",
  "openrouter/anthropic/claude-sonnet-4",
  "groq/llama-3.3-70b-versatile",
  "xai/grok-3-mini",
  "mistral/mistral-large-latest",
]);

/* ── Typing dots animation ────────────────────────── */

function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
    </span>
  );
}

/* ── Model Picker Sub-component ───────────────────── */

function OnboardingModelPicker({
  provider,
  value,
  onChange,
  liveModels,
  loadingModels,
}: {
  provider: string;
  value: string;
  onChange: (id: string) => void;
  liveModels: ModelItem[];
  loadingModels: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);

  // Merge well-known + live, dedupe by id
  const allModels = useMemo(() => {
    const wellKnown = WELL_KNOWN_MODELS[provider] || [];
    const map = new Map<string, ModelItem>();
    for (const m of wellKnown) map.set(m.id, m);
    for (const m of liveModels) {
      if (!map.has(m.id)) map.set(m.id, m);
    }
    return Array.from(map.values()).sort((a, b) => {
      const aRec = RECOMMENDED_MODELS.has(a.id) ? 0 : 1;
      const bRec = RECOMMENDED_MODELS.has(b.id) ? 0 : 1;
      if (aRec !== bRec) return aRec - bRec;
      return a.name.localeCompare(b.name);
    });
  }, [provider, liveModels]);

  const filtered = useMemo(() => {
    if (!search) return allModels;
    const q = search.toLowerCase();
    return allModels.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [allModels, search]);

  const selectedLabel = allModels.find((m) => m.id === value)?.name || value;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={dropRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground hover:border-input focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/50"
      >
        <span className="truncate">{selectedLabel || "Select a model..."}</span>
        <span className="flex items-center gap-1.5">
          {loadingModels && (
            <span className="inline-flex items-center gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-current text-muted-foreground [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current text-muted-foreground [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current text-muted-foreground [animation-delay:300ms]" />
            </span>
          )}
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="glass-strong absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-hidden rounded-lg">
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus
            />
          </div>

          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                No models found
              </div>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent",
                  m.id === value && "bg-violet-500/10",
                )}
              >
                {RECOMMENDED_MODELS.has(m.id) && (
                  <Star className="h-3 w-3 shrink-0 text-amber-400" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{m.name}</span>
                  <span className="block truncate text-muted-foreground">{m.id}</span>
                </span>
                {m.id === value && <CheckCircle className="h-3 w-3 shrink-0 text-violet-400" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ───────────────────────────────── */

export function OnboardingWizard({ onComplete }: { onComplete?: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("model");
  const [status, setStatus] = useState<SetupStatus | null>(null);

  // ── Step 1 state ──
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("anthropic/claude-sonnet-4-20250514");
  const [testingKey, setTestingKey] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [liveModels, setLiveModels] = useState<ModelItem[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Step 2 state ──
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [channelToken, setChannelToken] = useState("");
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelConnected, setChannelConnected] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrChannel, setQrChannel] = useState<"whatsapp" | "signal">("whatsapp");

  // ── Pairing watcher state ──
  const [pairingRequests, setPairingRequests] = useState<
    { channel: string; code: string; senderName?: string; message?: string }[]
  >([]);
  const [approvingCode, setApprovingCode] = useState<string | null>(null);
  const [approvedCodes, setApprovedCodes] = useState<Set<string>>(new Set());
  const pairingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Finishing state ──
  const [finishError, setFinishError] = useState<string | null>(null);

  /* ── Silent system check on mount ───────────────── */

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/onboard", { cache: "no-store" });
        const data = (await res.json()) as SetupStatus;
        setStatus(data);
      } catch {
        // silent
      }
    })();
  }, []);

  /* ── Auto-validate API key (600ms debounce) ─────── */

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setKeyValid(null);
    setKeyError(null);
    setLiveModels([]);

    if (!apiKey || apiKey.length < 8) return;

    debounceRef.current = setTimeout(async () => {
      setTestingKey(true);
      try {
        const res = await fetch("/api/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test-key", provider, token: apiKey }),
        });
        const data = await res.json();
        if (data.ok) {
          setKeyValid(true);
          fetchLiveModels(provider, apiKey);
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
    }, 600);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, provider]);

  /* ── Fetch live models from provider ────────────── */

  const fetchLiveModels = async (prov: string, token: string) => {
    setLoadingModels(true);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-models", provider: prov, token }),
      });
      const data = await res.json();
      if (data.ok && data.models) {
        setLiveModels(data.models);
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingModels(false);
    }
  };

  /* ── Pairing watcher (polls every 4s when channel connected) ── */

  useEffect(() => {
    if (!channelConnected) return;

    const poll = async () => {
      try {
        const res = await fetch("/api/pairing", { cache: "no-store" });
        const data = await res.json();
        if (data.dm && data.dm.length > 0) {
          setPairingRequests(data.dm);
        }
      } catch {
        // silent
      }
    };

    poll();
    pairingInterval.current = setInterval(poll, 4000);

    return () => {
      if (pairingInterval.current) clearInterval(pairingInterval.current);
    };
  }, [channelConnected]);

  /* ── Provider change → update model ─────────────── */

  const switchProvider = (id: string) => {
    setProvider(id);
    const prov = PROVIDERS.find((p) => p.id === id);
    if (prov) setModel(prov.defaultModel);
    setApiKey("");
    setKeyValid(null);
    setKeyError(null);
    setLiveModels([]);
    setShowKey(false);
  };

  /* ── Save credentials (called when leaving step 1) ── */

  const saveCredentials = async () => {
    try {
      await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-credentials", provider, apiKey, model }),
      });
    } catch {
      // non-fatal
    }
  };

  /* ── Add channel (token-based) ──────────────────── */

  const addChannel = async () => {
    if (!selectedChannel || !channelToken) return;
    setChannelBusy(true);
    setChannelError(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", channel: selectedChannel, token: channelToken }),
      });
      const data = await res.json();
      if (data.ok) {
        setChannelConnected(true);
      } else {
        setChannelError(data.error || "Failed to connect channel");
      }
    } catch (err) {
      setChannelError(String(err));
    } finally {
      setChannelBusy(false);
    }
  };

  /* ── Approve pairing request ────────────────────── */

  const approvePairing = async (channel: string, code: string) => {
    setApprovingCode(code);
    try {
      await fetch("/api/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve-dm", channel, code }),
      });
      setApprovedCodes((prev) => new Set(prev).add(code));
    } catch {
      // silent
    } finally {
      setApprovingCode(null);
    }
  };

  /* ── Quick setup (finishing step) ───────────────── */

  const runQuickSetup = useCallback(async () => {
    setFinishError(null);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "quick-setup", provider, apiKey, model }),
      });
      const data = await res.json();
      if (data.ok) {
        onComplete?.();
        router.push("/");
      } else {
        setFinishError(data.error || "Setup failed");
      }
    } catch (err) {
      setFinishError(String(err));
    }
  }, [provider, apiKey, model, onComplete, router]);

  /* ── Finish setup (triggered from step 2) ───────── */

  const finishSetup = useCallback(() => {
    setStep("finishing");
    runQuickSetup();
  }, [runQuickSetup]);

  /* ── Step navigation ────────────────────────────── */

  const goToChannel = async () => {
    await saveCredentials();
    setStep("channel");
  };

  const goBackToModel = () => {
    setStep("model");
  };

  const visibleStepIndex = step === "model" ? 0 : step === "channel" ? 1 : 1;
  const systemError = status && !status.installed;
  const step1Disabled = !apiKey || testingKey || keyValid === false;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-background px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* ── Header ──────────────────────────────── */}
        <div className="mb-8 text-center">
          <h1 className="font-[family-name:var(--font-baskervville)] text-2xl text-foreground">
            Set up your agent
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This only takes a minute.
          </p>
        </div>

        {/* ── Step indicator (dots) ───────────────── */}
        {step !== "finishing" && (
          <div className="mb-8 flex items-center justify-center gap-2">
            {STEPS.map((s, i) => {
              const isCurrent = i === visibleStepIndex;
              const isPast = i < visibleStepIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (isPast && s.id === "model") goBackToModel();
                  }}
                  disabled={!isPast}
                  className={cn(
                    "rounded-full transition-all",
                    isCurrent
                      ? "h-2 w-6 bg-violet-400"
                      : isPast
                        ? "h-2 w-2 bg-violet-400/60 hover:bg-violet-400/80 cursor-pointer"
                        : "h-2 w-2 bg-muted-foreground/20",
                  )}
                  aria-label={s.label}
                />
              );
            })}
          </div>
        )}

        {/* ── System error banner ─────────────────── */}
        {systemError && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3">
            <p className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              OpenClaw is not installed. Please install it first.
            </p>
          </div>
        )}

        {/* ── Content card ────────────────────────── */}
        <div className="glass rounded-xl p-6">

          {/* ════════════════════════════════════════ */}
          {/* ── STEP 1: Connect AI ──────────────── */}
          {/* ════════════════════════════════════════ */}
          {step === "model" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xs font-semibold text-foreground">Connect AI</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose your AI provider and enter your API key.
                </p>
              </div>

              {/* Provider pills */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <div className="flex flex-wrap gap-2">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => switchProvider(p.id)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        provider === p.id
                          ? "border-violet-500/20 bg-violet-500/10 text-violet-400"
                          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Help box */}
              {(() => {
                const prov = PROVIDERS.find((p) => p.id === provider);
                if (!prov) return null;
                return (
                  <div className="rounded-lg border border-border/60 bg-muted px-4 py-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      How to get your {prov.label} API key:
                    </p>
                    <ol className="mb-2 space-y-1">
                      {prov.helpSteps.map((s, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          {i + 1}. {s}
                        </li>
                      ))}
                    </ol>
                    <a
                      href={prov.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-violet-400 hover:underline"
                    >
                      Open {prov.label} dashboard
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                );
              })()}

              {/* API Key input */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">API Key</label>
                  <div className="group relative">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/50 transition-colors group-hover:text-emerald-400" />
                    <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                      Encrypted and stored locally. Not even we can see it.
                    </div>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={PROVIDERS.find((p) => p.id === provider)?.placeholder}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                    className="w-full rounded-lg border border-input bg-transparent px-3 py-2 pr-20 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/50"
                  />
                  <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-2">
                    {testingKey && <TypingDots className="text-muted-foreground" />}
                    {!testingKey && keyValid === true && (
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                    )}
                    {!testingKey && keyValid === false && (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                    )}
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                {keyValid === false && keyError && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3 shrink-0" /> {keyError}
                  </p>
                )}
              </div>

              {/* Model picker */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Default Model</label>
                <OnboardingModelPicker
                  provider={provider}
                  value={model}
                  onChange={setModel}
                  liveModels={liveModels}
                  loadingModels={loadingModels}
                />
                <p className="text-xs text-muted-foreground">
                  You can change this later in Settings.
                </p>
              </div>

              {/* Continue button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={goToChannel}
                  disabled={step1Disabled}
                  className={cn(
                    "rounded-lg px-5 py-2.5 text-sm font-medium transition-colors",
                    !step1Disabled
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-muted text-muted-foreground cursor-not-allowed",
                  )}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════ */}
          {/* ── STEP 2: Messaging ───────────────── */}
          {/* ════════════════════════════════════════ */}
          {step === "channel" && !channelConnected && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xs font-semibold text-foreground">Messaging</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connect a messaging channel so your agent can chat. You can skip this.
                </p>
              </div>

              {/* Channel grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CHANNEL_OPTIONS.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => {
                      setSelectedChannel(ch.id);
                      setChannelToken("");
                      setChannelError(null);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-colors",
                      selectedChannel === ch.id
                        ? "border-violet-500/20 bg-violet-500/10"
                        : "border-border bg-card hover:bg-accent",
                    )}
                  >
                    <span className="text-lg">{ch.icon}</span>
                    <span className="text-xs font-medium text-foreground">{ch.label}</span>
                  </button>
                ))}
              </div>

              {/* Token input for token-based channels */}
              {selectedChannel &&
                CHANNEL_OPTIONS.find((c) => c.id === selectedChannel)?.type === "token" && (
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
                          placeholder={
                            CHANNEL_OPTIONS.find((c) => c.id === selectedChannel)?.placeholder
                          }
                          className="flex-1 rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/50"
                        />
                        <button
                          onClick={addChannel}
                          disabled={!channelToken || channelBusy}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors",
                            channelToken && !channelBusy
                              ? "bg-primary text-primary-foreground hover:bg-primary/90"
                              : "bg-muted text-muted-foreground cursor-not-allowed",
                          )}
                        >
                          {channelBusy ? (
                            <span className="inline-flex items-center gap-0.5">
                              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                            </span>
                          ) : (
                            "Connect"
                          )}
                        </button>
                      </div>
                    </div>
                    {channelError && (
                      <p className="flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3 shrink-0" /> {channelError}
                      </p>
                    )}
                  </div>
                )}

              {/* QR scan for QR-based channels */}
              {selectedChannel &&
                CHANNEL_OPTIONS.find((c) => c.id === selectedChannel)?.type === "qr" && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {selectedChannel === "whatsapp"
                        ? "WhatsApp requires scanning a QR code from your phone."
                        : "Signal requires scanning a QR code via signal-cli."}
                    </p>
                    <button
                      onClick={() => {
                        setQrChannel(selectedChannel as "whatsapp" | "signal");
                        setShowQrModal(true);
                      }}
                      className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Scan QR Code
                    </button>
                  </div>
                )}

              {/* Navigation */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={goBackToModel}
                  className="rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={finishSetup}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Channel connected (success + pairing) ── */}
          {step === "channel" && channelConnected && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xs font-semibold text-foreground">Messaging</h2>
              </div>

              {/* Success indicator */}
              <div className="flex flex-col items-center gap-2 py-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                  <CheckCircle className="h-6 w-6 text-emerald-400" />
                </div>
                <p className="text-sm font-medium text-emerald-400">
                  {CHANNEL_OPTIONS.find((c) => c.id === selectedChannel)?.label || selectedChannel} connected
                </p>
              </div>

              {/* Next steps */}
              <div className="rounded-lg border border-border/60 bg-muted px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {CHANNEL_OPTIONS.find((c) => c.id === selectedChannel)?.instructions ||
                    "You can now message your bot."}
                </p>
              </div>

              {/* Pairing watcher */}
              <div className="space-y-3">
                {pairingRequests.length === 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Waiting for someone to message your bot</span>
                    <TypingDots />
                  </div>
                )}

                {pairingRequests.map((req) => (
                  <div
                    key={req.code}
                    className="flex items-center gap-3 rounded-lg border border-border bg-muted px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground">
                        {req.senderName || "Unknown"}{" "}
                        <span className="text-muted-foreground">via {req.channel}</span>
                      </p>
                      {req.message && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          &ldquo;{req.message}&rdquo;
                        </p>
                      )}
                    </div>
                    {approvedCodes.has(req.code) ? (
                      <span className="text-xs text-emerald-400">Approved</span>
                    ) : (
                      <button
                        onClick={() => approvePairing(req.channel, req.code)}
                        disabled={approvingCode === req.code}
                        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {approvingCode === req.code ? (
                          <span className="inline-flex items-center gap-0.5">
                            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                          </span>
                        ) : (
                          "Approve"
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => {
                    setChannelConnected(false);
                    setSelectedChannel(null);
                    setChannelToken("");
                    setChannelError(null);
                    setPairingRequests([]);
                  }}
                  className="rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  Add Another Channel
                </button>
                <button
                  onClick={finishSetup}
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════ */}
          {/* ── FINISHING (auto) ─────────────────── */}
          {/* ════════════════════════════════════════ */}
          {step === "finishing" && (
            <div className="flex flex-col items-center gap-4 py-12">
              {!finishError ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-violet-400 [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-violet-400 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-violet-400 [animation-delay:300ms]" />
                  </span>
                  <p className="text-sm text-muted-foreground">Setting up your agent...</p>
                </>
              ) : (
                <>
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <p className="text-sm text-destructive">{finishError}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setStep("channel")}
                      className="rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => {
                        setFinishError(null);
                        runQuickSetup();
                      }}
                      className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                </>
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
            setChannelConnected(true);
            setShowQrModal(false);
          }}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </div>
  );
}
