"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  ListOrdered,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { requestRestart } from "@/lib/restart-store";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/ui/loading-state";
import { ApiWarningBadge } from "@/components/ui/api-warning-badge";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import {
  getModelMeta,
  getFriendlyModelName,
  getProviderDisplayName,
  PROVIDER_INFO,
} from "@/lib/model-metadata";
import { ModelPicker } from "@/components/model-picker";
import type { ModelOption } from "@/components/model-picker";

// ── Types ──

type ModelInfo = {
  key: string;
  name: string;
  input: string;
  contextWindow: number;
  local: boolean;
  available: boolean;
  tags: string[];
  missing: boolean;
};

type ModelStatus = {
  defaultModel: string;
  resolvedDefault: string;
  fallbacks: string[];
  imageModel: string;
  imageFallbacks: string[];
  aliases: Record<string, string>;
  allowed: string[];
  auth?: {
    providers?: Array<{
      provider: string;
      effective?: {
        kind?: string;
        detail?: string;
      } | null;
    }>;
    oauth?: {
      providers?: Array<{
        provider: string;
        status?: string;
        remainingMs?: number;
      }>;
    };
  };
};

type AuthOrderPayload = {
  agentId: string;
  provider: string;
  order: string[] | null;
};

type DefaultsModelConfig = {
  primary: string;
  fallbacks: string[];
};

type HeartbeatConfig = { every: string; model: string };

type AgentModelInfo = {
  id: string;
  name: string;
  modelPrimary: string | null;
  modelFallbacks: string[] | null;
  usesDefaults: boolean;
  subagents: string[];
  parentId: string | null;
};

type AgentRuntimeStatus = {
  defaultModel: string;
  resolvedDefault: string;
  fallbacks: string[];
};

type LiveModelInfo = {
  fullModel: string | null;
  model: string | null;
  provider: string | null;
  updatedAt: number | null;
  sessionKey: string | null;
};

type ModelCredentialProvider = {
  provider: string;
  connected: boolean;
  effectiveKind: string | null;
  effectiveDetail: string | null;
  profileCount: number;
  oauthCount: number;
  tokenCount: number;
  apiKeyCount: number;
  labels: string[];
  envSource: string | null;
  envValue: string | null;
  modelsJsonSource: string | null;
};

type ModelCredentialAgentRow = {
  agentId: string;
  storePath: string | null;
  shellEnvFallback: { enabled: boolean; appliedKeys: string[] };
  providers: ModelCredentialProvider[];
  oauthProfiles: Array<{
    profileId: string;
    provider: string;
    type: string;
    status: string;
    source: string;
    label: string;
    expiresAt: number | null;
    remainingMs: number | null;
  }>;
  unusableProfiles: Array<{
    profileId: string;
    provider: string;
    kind: string;
    until: number | null;
    remainingMs: number | null;
  }>;
};

type AgentAuthProfileStore = {
  agentId: string;
  path: string;
  exists: boolean;
  lastGood: Record<string, string>;
  profiles: Array<{
    id: string;
    provider: string;
    type: string;
    accountId: string | null;
    expiresAt: number | null;
    remainingMs: number | null;
    usage: {
      lastUsed: number | null;
      errorCount: number | null;
      lastFailureAt: number | null;
      cooldownUntil: number | null;
    };
    secretFields: Array<{ key: string; value: string; redacted: boolean }>;
  }>;
};

type ModelsCredentialSnapshot = {
  sourceOfTruth: { modelsStatus: boolean };
  summary: {
    modelProvidersConnected: number;
    modelProvidersTotal: number;
    authProfiles: number;
  };
  modelAuthByAgent: ModelCredentialAgentRow[];
  agentAuthProfiles: AgentAuthProfileStore[];
};

type ModelsCatalogProvider = {
  provider: string;
  config: Record<string, unknown>;
};

type ModelsCatalogConfig = {
  mode: string;
  providers: ModelsCatalogProvider[];
};

type Toast = {
  type: "success" | "error";
  message: string;
};

type AdvancedTab = "agents" | "allowlist" | "routing" | "aliases";

type PickerTarget =
  | { kind: "default" }
  | { kind: "default-fallback" }
  | { kind: "image-model" }
  | { kind: "image-fallback" }
  | { kind: "heartbeat-model" }
  | { kind: "agent"; agent: AgentModelInfo }
  | { kind: "agent-fallback"; agent: AgentModelInfo }
  | { kind: "allowlist" };

// ── Utilities ──

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modelProvider(key: string): string {
  if (!key.includes("/")) return "custom";
  return key.split("/")[0];
}

function modelNameFromKey(key: string): string {
  return key.split("/").pop() || key;
}

function getModelDisplayName(
  key: string,
  models: ModelInfo[],
  aliases: Record<string, string>,
): string {
  const found = models.find((m) => m.key === key);
  if (found?.name) return found.name;
  const alias = Object.entries(aliases).find(([, modelKey]) => modelKey === key)?.[0];
  if (alias) return alias;
  return modelNameFromKey(key);
}

const PROVIDER_CONFIG_TEMPLATES: Record<string, Record<string, unknown>> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    api: "anthropic-messages",
  },
  minimax: {
    baseUrl: "https://api.minimax.io/v1",
    api: "openai-completions",
  },
  moonshot: {
    baseUrl: "https://api.moonshot.cn/v1",
    api: "openai-completions",
  },
};

const CONNECT_PROVIDER_META: Record<
  string,
  { label: string; icon: string; keyUrl?: string; keyHint: string; keyOptional?: boolean; needsBaseUrl?: boolean; baseUrlPlaceholder?: string }
> = {
  anthropic: { label: "Anthropic", icon: "🟣", keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-..." },
  openai: { label: "OpenAI", icon: "🟢", keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-..." },
  google: { label: "Google", icon: "🔵", keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza..." },
  openrouter: { label: "OpenRouter", icon: "🟠", keyUrl: "https://openrouter.ai/keys", keyHint: "sk-or-..." },
  minimax: { label: "MiniMax", icon: "🟡", keyUrl: "https://platform.minimaxi.com/", keyHint: "eyJ..." },
  groq: { label: "Groq", icon: "⚡", keyUrl: "https://console.groq.com/keys", keyHint: "gsk_..." },
  xai: { label: "xAI", icon: "𝕏", keyUrl: "https://console.x.ai/", keyHint: "xai-..." },
  mistral: { label: "Mistral", icon: "🌊", keyUrl: "https://console.mistral.ai/api-keys/", keyHint: "" },
  zai: { label: "Z.AI", icon: "💎", keyHint: "" },
  cerebras: { label: "Cerebras", icon: "🧠", keyHint: "" },
  huggingface: { label: "Hugging Face", icon: "🤗", keyUrl: "https://huggingface.co/settings/tokens", keyHint: "hf_..." },
  custom: { label: "Custom Endpoint", icon: "🔗", keyHint: "Bearer token (optional)", keyOptional: true, needsBaseUrl: true, baseUrlPlaceholder: "http://localhost:1234/v1" },
};

// ── Small Inline Components ──

function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "good" | "warn" | "info";
}) {
  const cls =
    tone === "good"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : tone === "info"
          ? "border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] text-[var(--accent-brand-text)]"
          : "border-border bg-muted/40 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium",
        cls,
      )}
    >
      {label}
    </span>
  );
}

function BusyDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
    </span>
  );
}

// ── Main Component ──

export function ModelsView() {
  // ── Data state ──
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [defaults, setDefaults] = useState<DefaultsModelConfig | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [allModelsLoading, setAllModelsLoading] = useState(false);
  const [allModelsWarning, setAllModelsWarning] = useState<string | null>(null);
  const [configuredAllowed, setConfiguredAllowed] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentModelInfo[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentRuntimeStatus>>({});
  const [liveModels, setLiveModels] = useState<Record<string, LiveModelInfo>>({});
  const [heartbeat, setHeartbeat] = useState<HeartbeatConfig | null>(null);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [modelsCatalogConfig, setModelsCatalogConfig] = useState<ModelsCatalogConfig>({
    mode: "merge",
    providers: [],
  });
  const [modelCredentialSummary, setModelCredentialSummary] = useState<{
    connected: number;
    total: number;
    profiles: number;
    sourceOfTruth: boolean;
  }>({ connected: 0, total: 0, profiles: 0, sourceOfTruth: false });
  const [modelAuthByAgent, setModelAuthByAgent] = useState<ModelCredentialAgentRow[]>([]);
  const [agentAuthProfiles, setAgentAuthProfiles] = useState<AgentAuthProfileStore[]>([]);
  const [modelCredsError, setModelCredsError] = useState<string | null>(null);
  const [revealModelSecrets, setRevealModelSecrets] = useState(false);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [apiDegraded, setApiDegraded] = useState(false);

  // ── UI state ──
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<AdvancedTab>("agents");
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);

  // Alias form state
  const [aliasName, setAliasName] = useState("");
  const [aliasTarget, setAliasTarget] = useState("");

  // Allowlist state
  const [customModelToAdd, setCustomModelToAdd] = useState("");
  const [providerDraftId, setProviderDraftId] = useState("");
  const [providerDraftCustomId, setProviderDraftCustomId] = useState("");
  const [providerDraftJson, setProviderDraftJson] = useState(
    JSON.stringify(PROVIDER_CONFIG_TEMPLATES.openrouter, null, 2),
  );
  const [providerDraftError, setProviderDraftError] = useState<string | null>(null);
  const [heartbeatEveryDraft, setHeartbeatEveryDraft] = useState("");

  // Auth order state
  const [orderAgentId, setOrderAgentId] = useState("main");
  const [orderProvider, setOrderProvider] = useState("openai");
  const [orderDraft, setOrderDraft] = useState<string[]>([]);
  const [orderSelectedProfileId, setOrderSelectedProfileId] = useState("");
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Connect-provider inline flow state
  const [connectProvider, setConnectProvider] = useState<string | null>(null);
  const [connectKey, setConnectKey] = useState("");
  const [connectBaseUrl, setConnectBaseUrl] = useState("");
  const [connectShowKey, setConnectShowKey] = useState(false);
  const [connectSaving, setConnectSaving] = useState(false);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Core callbacks ──

  const flash = useCallback((message: string, type: "success" | "error") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const postModelAction = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(String(data.error || `Request failed with ${res.status}`));
    }
    return data as Record<string, unknown>;
  }, []);

  const fetchAllModels = useCallback(async () => {
    setAllModelsLoading(true);
    try {
      const res = await fetch("/api/models?scope=all", { cache: "no-store" });
      const data = await res.json();
      const nextModels = Array.isArray(data.models) ? (data.models as ModelInfo[]) : [];
      setAllModels(nextModels);
      setAllModelsWarning(
        typeof data.warning === "string" && data.warning.trim() ? data.warning.trim() : null,
      );
    } catch (err) {
      setAllModelsWarning(err instanceof Error ? err.message : String(err));
    } finally {
      setAllModelsLoading(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models?scope=status", { cache: "no-store" });
      const data = await res.json();
      setApiWarning(
        typeof data.warning === "string" && data.warning.trim() ? data.warning.trim() : null,
      );
      setApiDegraded(Boolean(data.degraded));
      if (data.error) console.warn("Models API partial error:", data.error);
      if (data.status) setStatus(data.status as ModelStatus);
      if (data.defaults && typeof data.defaults.primary === "string") {
        setDefaults({
          primary: data.defaults.primary,
          fallbacks: Array.isArray(data.defaults.fallbacks)
            ? data.defaults.fallbacks.map((f: unknown) => String(f))
            : [],
        });
      } else {
        setDefaults(null);
      }
      setModels(Array.isArray(data.models) ? (data.models as ModelInfo[]) : []);
      const configuredAllowedRaw = Array.isArray(data.allowedConfigured)
        ? data.allowedConfigured.map((entry: unknown) => String(entry)).filter(Boolean)
        : null;
      setConfiguredAllowed(
        configuredAllowedRaw ??
          (Array.isArray(data.status?.allowed)
            ? data.status.allowed.map((entry: unknown) => String(entry)).filter(Boolean)
            : []),
      );
      setAgents(Array.isArray(data.agents) ? (data.agents as AgentModelInfo[]) : []);
      setAgentStatuses((data.agentStatuses || {}) as Record<string, AgentRuntimeStatus>);
      setLiveModels((data.liveModels || {}) as Record<string, LiveModelInfo>);
      setConfiguredProviders(
        Array.isArray(data.configuredProviders)
          ? data.configuredProviders.map((entry: unknown) => String(entry)).filter(Boolean)
          : [],
      );
      if (data.heartbeat && typeof data.heartbeat === "object" && "model" in data.heartbeat) {
        setHeartbeat({
          every: typeof data.heartbeat.every === "string" ? data.heartbeat.every : "",
          model: typeof data.heartbeat.model === "string" ? data.heartbeat.model : "",
        });
      } else {
        setHeartbeat(null);
      }
      if (data.modelsCatalogConfig && typeof data.modelsCatalogConfig === "object") {
        const next = data.modelsCatalogConfig as {
          mode?: unknown;
          providers?: unknown;
        };
        const providers = Array.isArray(next.providers)
          ? next.providers
              .map((entry) => {
                if (!entry || typeof entry !== "object") return null;
                const row = entry as { provider?: unknown; config?: unknown };
                const provider = String(row.provider || "").trim();
                if (!provider) return null;
                const config =
                  row.config && typeof row.config === "object" && !Array.isArray(row.config)
                    ? (row.config as Record<string, unknown>)
                    : {};
                return { provider, config };
              })
              .filter((entry): entry is ModelsCatalogProvider => Boolean(entry))
          : [];
        setModelsCatalogConfig({
          mode:
            typeof next.mode === "string" && next.mode.trim().toLowerCase() === "replace"
              ? "replace"
              : "merge",
          providers,
        });
      } else {
        setModelsCatalogConfig({ mode: "merge", providers: [] });
      }

      try {
        const accountsRes = await fetch("/api/accounts", { cache: "no-store" });
        const accountsData = (await accountsRes.json()) as
          | (ModelsCredentialSnapshot & { error?: string })
          | { error?: string };
        if (!accountsRes.ok) {
          throw new Error(
            (accountsData as { error?: string })?.error || `HTTP ${accountsRes.status}`,
          );
        }
        const snapshot = accountsData as ModelsCredentialSnapshot;
        setModelCredentialSummary({
          connected: Number(snapshot.summary?.modelProvidersConnected || 0),
          total: Number(snapshot.summary?.modelProvidersTotal || 0),
          profiles: Number(snapshot.summary?.authProfiles || 0),
          sourceOfTruth: Boolean(snapshot.sourceOfTruth?.modelsStatus),
        });
        setModelAuthByAgent(
          Array.isArray(snapshot.modelAuthByAgent) ? snapshot.modelAuthByAgent : [],
        );
        setAgentAuthProfiles(
          Array.isArray(snapshot.agentAuthProfiles) ? snapshot.agentAuthProfiles : [],
        );
        setModelCredsError(null);
      } catch (err) {
        setModelCredsError(err instanceof Error ? err.message : String(err));
      }
    } catch (err) {
      console.warn("Failed to fetch models:", err);
      setApiWarning(err instanceof Error ? err.message : String(err));
      setApiDegraded(true);
      flash("Failed to load models", "error");
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    fetchAllModels();
  }, [fetchAllModels]);

  const handleConnectProvider = useCallback(async () => {
    if (!connectProvider) return;
    const isCustom = connectProvider === "custom";
    // Standard providers require a key; custom requires a base URL
    if (!isCustom && !connectKey.trim()) return;
    if (isCustom && !connectBaseUrl.trim()) return;
    setConnectSaving(true);
    try {
      if (isCustom) {
        // Use onboard API to save-credentials for custom provider
        const res = await fetch("/api/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save-credentials",
            provider: "custom",
            apiKey: connectKey.trim() || "",
            baseUrl: connectBaseUrl.trim(),
          }),
        });
        const data = await res.json();
        if (data.ok) {
          setConnectSuccess("custom");
          setConnectKey("");
          setConnectBaseUrl("");
          setConnectProvider(null);
          setConnectShowKey(false);
          flash("Custom endpoint connected!", "success");
          setLoading(true);
          fetchModels();
          fetchAllModels();
          setTimeout(() => setConnectSuccess(null), 3000);
        } else {
          flash(data.error || "Failed to connect custom endpoint", "error");
        }
      } else {
        const res = await fetch("/api/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "auth-provider", provider: connectProvider, token: connectKey.trim() }),
        });
        const data = await res.json();
        if (data.ok) {
          setConnectSuccess(connectProvider);
          setConnectKey("");
          setConnectProvider(null);
          setConnectShowKey(false);
          flash(`${CONNECT_PROVIDER_META[connectProvider]?.label || connectProvider} connected!`, "success");
          setLoading(true);
          fetchModels();
          fetchAllModels();
          setTimeout(() => setConnectSuccess(null), 3000);
        } else {
          flash(data.error || "Failed to connect provider", "error");
        }
      }
    } catch {
      flash("Failed to connect provider", "error");
    }
    setConnectSaving(false);
  }, [connectProvider, connectKey, connectBaseUrl, flash, fetchModels, fetchAllModels]);

  const runAction = useCallback(
    async (
      body: Record<string, unknown>,
      successMsg: string,
      key: string,
      options?: { restart?: boolean; refreshCatalog?: boolean },
    ) => {
      setBusyKey(key);
      const maxAttempts = 3;
      const isTransient = (msg: string) => {
        const m = msg.toLowerCase();
        return (
          m.includes("gateway closed") ||
          m.includes("1006") ||
          m.includes("gateway call failed")
        );
      };
      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            await postModelAction(body);
            flash(successMsg, "success");
            if (options?.restart !== false) {
              requestRestart("Model configuration was updated.");
            }
            await fetchModels();
            if (options?.refreshCatalog) {
              await fetchAllModels();
            }
            return;
          } catch (err) {
            const msg = String(err);
            if (isTransient(msg) && attempt < maxAttempts) {
              await sleep(900 * attempt);
              continue;
            }
            flash(msg, "error");
            return;
          }
        }
      } finally {
        setBusyKey(null);
      }
    },
    [fetchAllModels, fetchModels, flash, postModelAction],
  );

  // ── Derived data ──

  const aliases = useMemo(() => status?.aliases || {}, [status]);
  const defaultPrimary = defaults?.primary || status?.defaultModel || "";
  const defaultFallbacks = useMemo(
    () => defaults?.fallbacks || status?.fallbacks || [],
    [defaults, status],
  );
  const defaultResolved = status?.resolvedDefault || defaultPrimary;

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      if (a.id === "main" && b.id !== "main") return -1;
      if (a.id !== "main" && b.id === "main") return 1;
      return a.name.localeCompare(b.name);
    });
  }, [agents]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) map.set(agent.id, agent.name);
    return map;
  }, [agents]);

  const providerAuthMap = useMemo(() => {
    const map = new Map<
      string,
      { connected: boolean; authKind: string | null; oauthStatus: string | null }
    >();
    const authProviders = status?.auth?.providers || [];
    for (const provider of authProviders) {
      const providerKey = String(provider.provider || "").trim();
      if (!providerKey) continue;
      map.set(providerKey, {
        connected: Boolean(provider.effective),
        authKind: provider.effective?.kind || null,
        oauthStatus: null,
      });
    }
    const oauthProviders = status?.auth?.oauth?.providers || [];
    for (const provider of oauthProviders) {
      const providerKey = String(provider.provider || "").trim();
      if (!providerKey) continue;
      const prev = map.get(providerKey);
      const oauthStatus = provider.status || null;
      const oauthConnected = oauthStatus === "ok" || oauthStatus === "static";
      map.set(providerKey, {
        connected: Boolean(prev?.connected || oauthConnected),
        authKind: prev?.authKind || null,
        oauthStatus,
      });
    }
    const localProviders = new Set<string>();
    for (const model of [...models, ...allModels]) {
      const provider = modelProvider(model.key);
      if (!provider || provider === "custom") continue;
      if (model.local) localProviders.add(provider);
    }
    for (const provider of localProviders) {
      const prev = map.get(provider);
      map.set(provider, {
        connected: true,
        authKind: prev?.authKind || "local",
        oauthStatus: prev?.oauthStatus || null,
      });
    }
    for (const provider of configuredProviders) {
      if (!provider) continue;
      const prev = map.get(provider);
      const providerIsLocal =
        provider === "ollama" || provider === "vllm" || provider === "lmstudio";
      map.set(provider, {
        connected: true,
        authKind: prev?.authKind || (providerIsLocal ? "local" : "configured"),
        oauthStatus: prev?.oauthStatus || null,
      });
    }
    return map;
  }, [allModels, configuredProviders, models, status]);

  const allowedModels = useMemo(
    () => new Set((status?.allowed || []).map((m) => String(m))),
    [status],
  );

  const configuredOptionMap = useMemo(() => {
    const map = new Map<string, ModelOption>();
    for (const model of models) {
      const provider = modelProvider(model.key);
      const auth = providerAuthMap.get(provider);
      const ready = Boolean(model.local || model.available || allowedModels.has(model.key));
      map.set(model.key, {
        key: model.key,
        name: model.name || modelNameFromKey(model.key),
        provider,
        available: Boolean(model.available),
        local: Boolean(model.local),
        known: true,
        ready,
        authConnected: Boolean(auth?.connected),
        authKind: auth?.authKind || null,
        oauthStatus: auth?.oauthStatus || null,
      });
    }

    const ensure = (key: string | null | undefined) => {
      if (!key || map.has(key)) return;
      const provider = modelProvider(key);
      const auth = providerAuthMap.get(provider);
      map.set(key, {
        key,
        name: modelNameFromKey(key),
        provider,
        available: true,
        local: false,
        known: false,
        ready: true,
        authConnected: Boolean(auth?.connected),
        authKind: auth?.authKind || null,
        oauthStatus: auth?.oauthStatus || null,
      });
    };

    ensure(defaultPrimary);
    ensure(defaultResolved);
    if (heartbeat?.model) ensure(heartbeat.model);
    if (status?.imageModel) ensure(status.imageModel);
    for (const fallback of status?.imageFallbacks || []) ensure(fallback);

    for (const agent of agents) {
      const configured = agent.modelPrimary || defaultPrimary;
      const runtime = agentStatuses[agent.id];
      const resolved = runtime?.resolvedDefault || runtime?.defaultModel || configured;
      const live = liveModels[agent.id]?.fullModel || null;
      ensure(configured);
      ensure(resolved);
      ensure(live);
    }

    return map;
  }, [
    agents,
    agentStatuses,
    allowedModels,
    defaultPrimary,
    defaultResolved,
    heartbeat?.model,
    liveModels,
    models,
    providerAuthMap,
    status?.imageFallbacks,
    status?.imageModel,
  ]);

  const catalogOptionMap = useMemo(() => {
    const map = new Map<string, ModelOption>();
    for (const model of allModels) {
      const provider = modelProvider(model.key);
      const auth = providerAuthMap.get(provider);
      map.set(model.key, {
        key: model.key,
        name: model.name || modelNameFromKey(model.key),
        provider,
        available: Boolean(model.available),
        local: Boolean(model.local),
        known: true,
        ready: Boolean(model.local || model.available || allowedModels.has(model.key)),
        authConnected: Boolean(auth?.connected),
        authKind: auth?.authKind || null,
        oauthStatus: auth?.oauthStatus || null,
      });
    }
    return map;
  }, [allModels, allowedModels, providerAuthMap]);

  const allOptionMap = useMemo(() => {
    const map = new Map<string, ModelOption>();
    for (const [key, option] of catalogOptionMap.entries()) map.set(key, option);
    for (const [key, option] of configuredOptionMap.entries()) map.set(key, option);
    return map;
  }, [catalogOptionMap, configuredOptionMap]);

  const allModelOptions = useMemo(() => {
    return [...allOptionMap.values()].sort((a, b) => {
      const aReady = a.ready || a.local ? 0 : 1;
      const bReady = b.ready || b.local ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    });
  }, [allOptionMap]);

  const providerAuthSummary = useMemo(() => {
    return [...providerAuthMap.entries()]
      .map(([provider, data]) => ({
        provider,
        connected: data.connected,
        authKind: data.authKind,
        oauthStatus: data.oauthStatus,
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider));
  }, [providerAuthMap]);

  const providerCatalogCounts = useMemo(() => {
    const counts = new Map<string, { total: number; local: number }>();
    for (const model of allModels) {
      const provider = modelProvider(model.key);
      const prev = counts.get(provider) || { total: 0, local: 0 };
      counts.set(provider, {
        total: prev.total + 1,
        local: prev.local + (model.local ? 1 : 0),
      });
    }
    return counts;
  }, [allModels]);

  const configInvalidDetected = useMemo(() => {
    const combined = [apiWarning, allModelsWarning]
      .map((entry) => String(entry || ""))
      .join(" ")
      .toLowerCase();
    return combined.includes("config invalid");
  }, [allModelsWarning, apiWarning]);

  const availableProviders = useMemo(() => {
    const providers = new Set<string>();
    for (const row of providerAuthSummary) {
      if (row.provider) providers.add(row.provider);
    }
    for (const option of allModelOptions) {
      if (option.provider && option.provider !== "custom") providers.add(option.provider);
    }
    for (const store of agentAuthProfiles) {
      for (const profile of store.profiles) {
        if (profile.provider) providers.add(profile.provider);
      }
    }
    return [...providers].sort((a, b) => a.localeCompare(b));
  }, [agentAuthProfiles, allModelOptions, providerAuthSummary]);

  const providerConfigMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const entry of modelsCatalogConfig.providers) {
      map.set(entry.provider, entry.config || {});
    }
    return map;
  }, [modelsCatalogConfig.providers]);

  const providerDraftOptions = useMemo(() => {
    const options = new Set<string>();
    for (const key of Object.keys(PROVIDER_CONFIG_TEMPLATES)) options.add(key);
    for (const provider of availableProviders) options.add(provider);
    for (const row of modelsCatalogConfig.providers) options.add(row.provider);
    return [...options].sort((a, b) => a.localeCompare(b));
  }, [availableProviders, modelsCatalogConfig.providers]);

  const selectedOrderAgentProfiles = useMemo(() => {
    const row = agentAuthProfiles.find((entry) => entry.agentId === orderAgentId);
    if (!row) return [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const profile of row.profiles) {
      if (profile.provider !== orderProvider) continue;
      if (!profile.id || seen.has(profile.id)) continue;
      seen.add(profile.id);
      ids.push(profile.id);
    }
    ids.sort((a, b) => a.localeCompare(b));
    return ids;
  }, [agentAuthProfiles, orderAgentId, orderProvider]);

  // Sync dropdown selections when data changes
  useEffect(() => {
    if (sortedAgents.length === 0) return;
    if (!sortedAgents.some((agent) => agent.id === orderAgentId)) {
      setOrderAgentId(sortedAgents[0].id);
    }
  }, [orderAgentId, sortedAgents]);

  useEffect(() => {
    if (availableProviders.length === 0) return;
    if (!availableProviders.includes(orderProvider)) {
      setOrderProvider(availableProviders[0]);
    }
  }, [availableProviders, orderProvider]);

  useEffect(() => {
    if (selectedOrderAgentProfiles.includes(orderSelectedProfileId)) return;
    setOrderSelectedProfileId(selectedOrderAgentProfiles[0] || "");
  }, [orderSelectedProfileId, selectedOrderAgentProfiles]);

  const loadAuthOrder = useCallback(
    async (agentId: string, provider: string) => {
      if (!agentId || !provider) return;
      setOrderLoading(true);
      try {
        const data = await postModelAction({
          action: "get-auth-order",
          agentId,
          provider,
        });
        const authOrder = (data.authOrder || {}) as AuthOrderPayload;
        const nextOrder = Array.isArray(authOrder.order)
          ? authOrder.order.map((entry) => String(entry)).filter(Boolean)
          : [];
        setOrderDraft(nextOrder);
        setOrderError(null);
      } catch (err) {
        setOrderError(err instanceof Error ? err.message : String(err));
        setOrderDraft([]);
      } finally {
        setOrderLoading(false);
      }
    },
    [postModelAction],
  );

  useEffect(() => {
    if (!orderAgentId || !orderProvider) return;
    loadAuthOrder(orderAgentId, orderProvider);
  }, [loadAuthOrder, orderAgentId, orderProvider]);

  // ── Action callbacks ──

  const changeDefaultModel = useCallback(
    async (nextModel: string) => {
      if (!nextModel || nextModel === defaultPrimary) return;
      const seed = defaultPrimary ? [defaultPrimary] : [];
      const nextFallbacks = [
        ...seed,
        ...defaultFallbacks.filter(
          (f) => f !== nextModel && (!defaultPrimary || f !== defaultPrimary),
        ),
      ];
      await runAction(
        { action: "reorder", primary: nextModel, fallbacks: nextFallbacks },
        `Default model set to ${getModelDisplayName(nextModel, models, aliases)}`,
        "defaults",
      );
    },
    [aliases, defaultFallbacks, defaultPrimary, models, runAction],
  );

  const changeAgentModel = useCallback(
    async (agent: AgentModelInfo, nextModel: string) => {
      const currentConfigured = agent.modelPrimary || defaultPrimary;
      if (!nextModel) return;
      if (agent.usesDefaults && nextModel === defaultPrimary) return;
      if (!agent.usesDefaults && currentConfigured === nextModel) return;
      await runAction(
        {
          action: "set-agent-model",
          agentId: agent.id,
          primary: nextModel,
          fallbacks: Array.isArray(agent.modelFallbacks) ? agent.modelFallbacks : null,
        },
        `${agent.name} now configured for ${getModelDisplayName(nextModel, models, aliases)}`,
        `agent:${agent.id}`,
      );
    },
    [aliases, defaultPrimary, models, runAction],
  );

  const resetAgentToDefaults = useCallback(
    async (agent: AgentModelInfo) => {
      if (agent.usesDefaults) return;
      await runAction(
        { action: "reset-agent-model", agentId: agent.id },
        `${agent.name} now uses global defaults`,
        `reset:${agent.id}`,
      );
    },
    [runAction],
  );

  const addDefaultFallback = useCallback(
    async (modelKey: string) => {
      const key = String(modelKey || "").trim();
      if (!key || key === defaultPrimary || defaultFallbacks.includes(key)) return;
      await runAction(
        { action: "set-fallbacks", fallbacks: [...defaultFallbacks, key] },
        `Added fallback ${getModelDisplayName(key, models, aliases)}`,
        "defaults:fallbacks",
      );
    },
    [aliases, defaultFallbacks, defaultPrimary, models, runAction],
  );

  const removeDefaultFallback = useCallback(
    async (modelKey: string) => {
      const next = defaultFallbacks.filter((fallback) => fallback !== modelKey);
      await runAction(
        { action: "set-fallbacks", fallbacks: next },
        `Removed fallback ${getModelDisplayName(modelKey, models, aliases)}`,
        "defaults:fallbacks",
      );
    },
    [aliases, defaultFallbacks, models, runAction],
  );

  const addAgentFallback = useCallback(
    async (agent: AgentModelInfo, modelKey: string) => {
      const key = String(modelKey || "").trim();
      if (!key) return;
      const primary = agent.modelPrimary || defaultPrimary;
      const current = Array.isArray(agent.modelFallbacks) ? agent.modelFallbacks : [];
      if (key === primary || current.includes(key)) return;
      await runAction(
        {
          action: "set-agent-model",
          agentId: agent.id,
          primary,
          fallbacks: [...current, key],
        },
        `${agent.name} fallback chain updated`,
        `agent:fallback:${agent.id}`,
      );
    },
    [defaultPrimary, runAction],
  );

  const removeAgentFallback = useCallback(
    async (agent: AgentModelInfo, modelKey: string) => {
      const primary = agent.modelPrimary || defaultPrimary;
      const current = Array.isArray(agent.modelFallbacks) ? agent.modelFallbacks : [];
      await runAction(
        {
          action: "set-agent-model",
          agentId: agent.id,
          primary,
          fallbacks: current.filter((entry) => entry !== modelKey),
        },
        `${agent.name} fallback chain updated`,
        `agent:fallback:${agent.id}`,
      );
    },
    [defaultPrimary, runAction],
  );

  const addAllowedModel = useCallback(
    async (modelKey: string) => {
      const key = String(modelKey || "").trim();
      if (!key || configuredAllowed.includes(key)) return;
      await runAction(
        { action: "add-allowed-model", model: key },
        `Added ${getModelDisplayName(key, allModels, aliases)} to allowed models`,
        "allowlist:add",
        { refreshCatalog: true },
      );
    },
    [aliases, allModels, configuredAllowed, runAction],
  );

  const removeAllowedModel = useCallback(
    async (modelKey: string) => {
      const key = String(modelKey || "").trim();
      if (!key) return;
      await runAction(
        { action: "remove-allowed-model", model: key },
        `Removed ${getModelDisplayName(key, allModels, aliases)} from allowed models`,
        "allowlist:remove",
        { refreshCatalog: true },
      );
    },
    [aliases, allModels, runAction],
  );

  const scanModels = useCallback(async () => {
    await runAction(
      { action: "scan-models", noProbe: false },
      "Model scan complete",
      "catalog:scan",
      { restart: false, refreshCatalog: true },
    );
  }, [runAction]);

  const addOrderProfile = useCallback((profileId: string) => {
    const id = String(profileId || "").trim();
    if (!id) return;
    setOrderDraft((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  const removeOrderProfile = useCallback((profileId: string) => {
    setOrderDraft((current) => current.filter((id) => id !== profileId));
  }, []);

  const moveOrderProfile = useCallback((profileId: string, direction: -1 | 1) => {
    setOrderDraft((current) => {
      const index = current.indexOf(profileId);
      if (index < 0) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [entry] = next.splice(index, 1);
      next.splice(nextIndex, 0, entry);
      return next;
    });
  }, []);

  const saveAuthOrder = useCallback(async () => {
    if (!orderAgentId || !orderProvider || orderDraft.length === 0) return;
    setOrderBusy(true);
    try {
      await postModelAction({
        action: "set-auth-order",
        agentId: orderAgentId,
        provider: orderProvider,
        profileIds: orderDraft,
      });
      flash("Auth order override saved", "success");
      await loadAuthOrder(orderAgentId, orderProvider);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setOrderBusy(false);
    }
  }, [flash, loadAuthOrder, orderAgentId, orderDraft, orderProvider, postModelAction]);

  const clearAuthOrder = useCallback(async () => {
    if (!orderAgentId || !orderProvider) return;
    setOrderBusy(true);
    try {
      await postModelAction({
        action: "clear-auth-order",
        agentId: orderAgentId,
        provider: orderProvider,
      });
      flash("Auth order override cleared", "success");
      await loadAuthOrder(orderAgentId, orderProvider);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setOrderBusy(false);
    }
  }, [flash, loadAuthOrder, orderAgentId, orderProvider, postModelAction]);

  const setImageModel = useCallback(
    async (nextModel: string) => {
      const current = status?.imageModel || "";
      if (!nextModel || nextModel === current) return;
      await runAction(
        { action: "set-image-model", model: nextModel },
        `Image model set to ${getFriendlyModelName(nextModel)}`,
        "image:model",
        { restart: false },
      );
    },
    [runAction, status?.imageModel],
  );

  const addImageFallback = useCallback(
    async (modelKey: string) => {
      const key = String(modelKey || "").trim();
      const current = status?.imageFallbacks || [];
      const imagePrimary = status?.imageModel || "";
      if (!key || key === imagePrimary || current.includes(key)) return;
      await runAction(
        { action: "add-image-fallback", model: key },
        `Added image fallback ${getFriendlyModelName(key)}`,
        "image:fallbacks",
        { restart: false },
      );
    },
    [runAction, status?.imageFallbacks, status?.imageModel],
  );

  const removeImageFallback = useCallback(
    async (modelKey: string) => {
      const key = String(modelKey || "").trim();
      if (!key) return;
      await runAction(
        { action: "remove-image-fallback", model: key },
        `Removed image fallback ${getFriendlyModelName(key)}`,
        "image:fallbacks",
        { restart: false },
      );
    },
    [runAction],
  );

  const setCatalogMode = useCallback(
    async (mode: string) => {
      const next = mode.trim().toLowerCase();
      if (next !== "merge" && next !== "replace") return;
      if (next === (modelsCatalogConfig.mode || "merge")) return;
      await runAction(
        { action: "set-models-mode", mode: next },
        `Provider catalog mode set to ${next}`,
        "providers:mode",
        { restart: false },
      );
    },
    [modelsCatalogConfig.mode, runAction],
  );

  const providerDraftResolvedId = useMemo(() => {
    if (providerDraftId === "__custom__") {
      return providerDraftCustomId.trim().toLowerCase();
    }
    return providerDraftId.trim().toLowerCase();
  }, [providerDraftCustomId, providerDraftId]);

  const loadProviderDraft = useCallback(
    (provider: string) => {
      const key = provider.trim().toLowerCase();
      if (!key) return;
      const existing = modelsCatalogConfig.providers.find(
        (entry) => entry.provider === key,
      );
      const fallbackTemplate =
        PROVIDER_CONFIG_TEMPLATES[key] || {
          baseUrl: "",
          api: "openai-completions",
        };
      setProviderDraftError(null);
      setProviderDraftJson(JSON.stringify(existing?.config || fallbackTemplate, null, 2));
    },
    [modelsCatalogConfig.providers],
  );

  const saveProviderConfig = useCallback(async () => {
    const provider = providerDraftResolvedId;
    if (!provider) {
      setProviderDraftError("Choose a provider id first.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(providerDraftJson);
    } catch (err) {
      setProviderDraftError(
        err instanceof Error ? err.message : "Invalid JSON",
      );
      return;
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      setProviderDraftError("Provider config must be a JSON object.");
      return;
    }
    setProviderDraftError(null);
    await runAction(
      {
        action: "set-provider-config",
        provider,
        config: parsed as Record<string, unknown>,
      },
      `Saved provider override for ${provider}`,
      `providers:set:${provider}`,
      { restart: false },
    );
  }, [providerDraftJson, providerDraftResolvedId, runAction]);

  const removeProviderConfig = useCallback(
    async (provider: string) => {
      const key = provider.trim().toLowerCase();
      if (!key) return;
      await runAction(
        { action: "remove-provider-config", provider: key },
        `Removed provider override for ${key}`,
        `providers:remove:${key}`,
        { restart: false },
      );
    },
    [runAction],
  );

  const setHeartbeatModel = useCallback(
    async (model: string) => {
      await runAction(
        { action: "set-heartbeat", model },
        model
          ? `Heartbeat model set to ${getFriendlyModelName(model)}`
          : "Heartbeat model reset to inherited default",
        "heartbeat:model",
        { restart: false },
      );
    },
    [runAction],
  );

  const setHeartbeatEvery = useCallback(
    async (every: string) => {
      const nextEvery = every.trim();
      if (!nextEvery) {
        flash("Heartbeat interval is required", "error");
        return;
      }
      if (nextEvery === (heartbeat?.every || "")) return;
      await runAction(
        { action: "set-heartbeat", every: nextEvery },
        `Heartbeat interval set to ${nextEvery}`,
        "heartbeat:every",
        { restart: false },
      );
    },
    [flash, heartbeat?.every, runAction],
  );

  const applyProviderTemplate = useCallback(() => {
    const provider = providerDraftResolvedId;
    if (!provider) return;
    const template = PROVIDER_CONFIG_TEMPLATES[provider] || {
      baseUrl: "",
      api: "openai-completions",
    };
    setProviderDraftError(null);
    setProviderDraftJson(JSON.stringify(template, null, 2));
  }, [providerDraftResolvedId]);

  useEffect(() => {
    if (providerDraftId) return;
    const preferred =
      modelsCatalogConfig.providers[0]?.provider ||
      availableProviders[0] ||
      "openrouter";
    setProviderDraftId(preferred);
    loadProviderDraft(preferred);
  }, [
    availableProviders,
    loadProviderDraft,
    modelsCatalogConfig.providers,
    providerDraftId,
  ]);

  useEffect(() => {
    setHeartbeatEveryDraft(heartbeat?.every || "1h");
  }, [heartbeat?.every]);

  const providerDraftHasOverride = useMemo(
    () => providerConfigMap.has(providerDraftResolvedId),
    [providerConfigMap, providerDraftResolvedId],
  );

  // ── Model picker handler ──

  const handlePickerSelect = useCallback(
    (fullModel: string) => {
      if (!pickerTarget) return;
      setPickerTarget(null);
      switch (pickerTarget.kind) {
        case "default":
          void changeDefaultModel(fullModel);
          break;
        case "default-fallback":
          void addDefaultFallback(fullModel);
          break;
        case "image-model":
          void setImageModel(fullModel);
          break;
        case "image-fallback":
          void addImageFallback(fullModel);
          break;
        case "heartbeat-model":
          void setHeartbeatModel(fullModel);
          break;
        case "agent":
          void changeAgentModel(pickerTarget.agent, fullModel);
          break;
        case "agent-fallback":
          void addAgentFallback(pickerTarget.agent, fullModel);
          break;
        case "allowlist":
          void addAllowedModel(fullModel);
          break;
      }
    },
    [
      addAllowedModel,
      addDefaultFallback,
      addImageFallback,
      addAgentFallback,
      changeAgentModel,
      changeDefaultModel,
      pickerTarget,
      setHeartbeatModel,
      setImageModel,
    ],
  );

  const imageCapableModelKeys = useMemo(() => {
    const keys = new Set<string>();
    const collect = (rows: ModelInfo[]) => {
      for (const row of rows) {
        const input = String(row.input || "").toLowerCase();
        if (input.includes("image")) keys.add(row.key);
      }
    };
    collect(models);
    collect(allModels);
    if (status?.imageModel) keys.add(status.imageModel);
    for (const fallback of status?.imageFallbacks || []) keys.add(fallback);
    return keys;
  }, [allModels, models, status?.imageFallbacks, status?.imageModel]);

  const pickerModels = useMemo(() => {
    if (!pickerTarget) return allModelOptions;
    if (pickerTarget.kind !== "image-model" && pickerTarget.kind !== "image-fallback") {
      return allModelOptions;
    }
    const filtered = allModelOptions.filter(
      (option) => imageCapableModelKeys.has(option.key) || !option.known,
    );
    return filtered.length > 0 ? filtered : allModelOptions;
  }, [allModelOptions, imageCapableModelKeys, pickerTarget]);

  // Compute picker exclude list
  const pickerExcludeModels = useMemo(() => {
    if (!pickerTarget) return undefined;
    switch (pickerTarget.kind) {
      case "default-fallback":
        return [defaultPrimary, ...defaultFallbacks];
      case "image-fallback":
        return [status?.imageModel || "", ...(status?.imageFallbacks || [])].filter(Boolean);
      case "agent-fallback": {
        const agent = pickerTarget.agent;
        const primary = agent.modelPrimary || defaultPrimary;
        const fbs = Array.isArray(agent.modelFallbacks) ? agent.modelFallbacks : [];
        return [primary, ...fbs];
      }
      case "allowlist":
        return configuredAllowed;
      default:
        return undefined;
    }
  }, [
    configuredAllowed,
    defaultFallbacks,
    defaultPrimary,
    pickerTarget,
    status?.imageFallbacks,
    status?.imageModel,
  ]);

  const pickerTitle = useMemo(() => {
    if (!pickerTarget) return "Choose Model";
    switch (pickerTarget.kind) {
      case "default":
        return "Choose Default Model";
      case "default-fallback":
        return "Add Fallback Model";
      case "image-model":
        return "Choose Image Model";
      case "image-fallback":
        return "Add Image Fallback";
      case "heartbeat-model":
        return "Choose Heartbeat Model";
      case "agent":
        return `Choose Model for ${pickerTarget.agent.name}`;
      case "agent-fallback":
        return `Add Fallback for ${pickerTarget.agent.name}`;
      case "allowlist":
        return "Add to Allowlist";
    }
  }, [pickerTarget]);

  // ── Derived hero data ──

  const mainAgent = agents.find((agent) => agent.id === "main") || null;
  const mainHasOverride = Boolean(mainAgent && !mainAgent.usesDefaults);
  const activeMeta = getModelMeta(defaultResolved) || getModelMeta(defaultPrimary);
  const imageModel = status?.imageModel || "";
  const imageFallbacks = status?.imageFallbacks || [];
  const heartbeatModel = heartbeat?.model || "";
  const heartbeatEvery = heartbeat?.every || "1h";

  // ── Loading / error states ──

  if (loading) {
    return <LoadingState label="Loading models..." />;
  }

  if (!status) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-400">
        Failed to load model configuration
      </div>
    );
  }

  const connectedProviderCount = providerAuthSummary.filter((p) => p.connected).length;
  const hasCredentialProviders = providerAuthSummary.some(
    (p) => p.provider !== "ollama" && p.provider !== "vllm" && p.provider !== "lmstudio",
  );

  // Providers that are known but not connected (candidates for inline connect flow)
  const LOCAL_PROVIDERS = new Set(["ollama", "vllm", "lmstudio"]);
  const disconnectedProviders = providerAuthSummary
    .filter((p) => !p.connected && !LOCAL_PROVIDERS.has(p.provider))
    .map((p) => p.provider);
  // Also include well-known providers that aren't even in the auth summary yet
  const knownInSummary = new Set(providerAuthSummary.map((p) => p.provider));
  const connectableProviders = [
    ...disconnectedProviders,
    ...Object.keys(CONNECT_PROVIDER_META).filter(
      (p) => p !== "custom" && !knownInSummary.has(p) && !LOCAL_PROVIDERS.has(p),
    ),
    // Always show custom endpoint as last option
    "custom",
  ];

  return (
    <SectionLayout>
      <SectionHeader
        title="Models"
        description="Choose and manage your AI models"
        actions={
          <div className="flex items-center gap-2">
            <ApiWarningBadge warning={apiWarning} degraded={apiDegraded} />
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                fetchModels();
                fetchAllModels();
              }}
              disabled={Boolean(busyKey)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
            >
              {busyKey ? <BusyDots /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button>
          </div>
        }
      />

      <SectionBody width="narrow" padding="roomy" innerClassName="space-y-5">
        {configInvalidDetected && (
          <section className="rounded-xl border border-red-500/25 bg-red-500/8 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-300">
                  Config Validation Failed
                </p>
                <p className="text-sm text-red-700 dark:text-red-200">
                  OpenClaw reported an invalid config, so model discovery is currently partial.
                </p>
                <p className="text-xs text-red-700/80 dark:text-red-200/80">
                  Fix command: <code className="font-mono">openclaw doctor --fix</code>
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ━━━ SECTION 1: Active Model ━━━ */}
        <section className="rounded-2xl border border-border p-5 bg-card">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-[var(--accent-brand-text)]" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active Model
            </h2>
          </div>

          {/* Hero card */}
          <div className="rounded-xl border border-[var(--accent-brand-border)] bg-gradient-to-br from-[var(--accent-brand-subtle)] to-transparent p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-foreground">
                  {getFriendlyModelName(defaultResolved)}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-foreground/10 bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {getProviderDisplayName(modelProvider(defaultResolved))}
                  </span>
                  {activeMeta && (
                    <>
                      <span className="text-xs text-muted-foreground">
                        {activeMeta.priceTier}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {activeMeta.contextWindow} context
                      </span>
                    </>
                  )}
                </div>
                {activeMeta?.description && (
                  <p className="mt-2 text-xs text-muted-foreground/80 italic">
                    &ldquo;{activeMeta.description}&rdquo;
                  </p>
                )}
              </div>
              <StatusPill
                tone={defaultResolved === defaultPrimary ? "good" : "warn"}
                label={defaultResolved === defaultPrimary ? "Active" : "Fallback active"}
              />
            </div>

            {/* Change Model button */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setPickerTarget({ kind: "default" })}
                disabled={Boolean(busyKey)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Change Model
              </button>
            </div>

            {/* Fallback chain */}
            <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Fallback Chain {defaultFallbacks.length > 0 && `(${defaultFallbacks.length})`}
              </p>
              {defaultFallbacks.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">
                  No fallback models configured. If the primary model fails, requests will error.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {defaultFallbacks.map((fallback, i) => {
                    const fbMeta = getModelMeta(fallback);
                    return (
                      <div
                        key={`fallback:${fallback}`}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-card/60 px-3 py-1.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-medium text-muted-foreground/50 w-4 shrink-0">
                            {i + 1}.
                          </span>
                          <span className="text-xs font-medium text-foreground truncate">
                            {getFriendlyModelName(fallback)}
                          </span>
                          {fbMeta && (
                            <span className="text-xs text-muted-foreground/50 hidden sm:inline">
                              {getProviderDisplayName(fbMeta.provider)}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeDefaultFallback(fallback)}
                          disabled={Boolean(busyKey)}
                          className="shrink-0 rounded p-1 text-muted-foreground/50 transition-colors hover:bg-muted/60 hover:text-red-400 disabled:opacity-40"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={() => setPickerTarget({ kind: "default-fallback" })}
                disabled={Boolean(busyKey)}
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-border/50 bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                Add Fallback
              </button>
            </div>
          </div>
        </section>

        {/* ━━━ SECTION 2: Connected Providers ━━━ */}
        <section className="rounded-2xl border border-border p-5 bg-card">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[var(--accent-brand-text)]" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Connected Providers
              </h2>
              <StatusPill
                tone={connectedProviderCount > 0 ? "good" : "warn"}
                label={`${connectedProviderCount}/${providerAuthSummary.length}`}
              />
            </div>
          </div>

          {/* Provider chips */}
          {providerAuthSummary.length === 0 && connectableProviders.length === 0 ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
              <p className="text-sm text-foreground font-medium">No providers detected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect an AI provider to start using models.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {providerAuthSummary.map((provider) => (
                  <div
                    key={`provider:${provider.provider}`}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs transition-colors",
                      provider.connected
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : "border-border bg-muted/20",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {provider.connected ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <X className="h-3 w-3 text-muted-foreground/50" />
                      )}
                      <span className="font-medium text-foreground">
                        {getProviderDisplayName(provider.provider)}
                      </span>
                    </div>
                    {provider.connected && provider.authKind && (
                      <p className="mt-0.5 pl-5 text-muted-foreground/60">
                        via {provider.authKind}
                      </p>
                    )}
                    {(() => {
                      const count = providerCatalogCounts.get(provider.provider);
                      if (!count) return null;
                      const label =
                        count.local > 0
                          ? `${count.total} model${count.total === 1 ? "" : "s"} discovered (${count.local} local)`
                          : `${count.total} model${count.total === 1 ? "" : "s"} discovered`;
                      return <p className="mt-0.5 pl-5 text-muted-foreground/60">{label}</p>;
                    })()}
                    {provider.provider === "ollama" && (
                      <p className="mt-0.5 pl-5 text-muted-foreground/60">
                        Ollama shows models installed on this machine only.
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {providerAuthSummary.length === 1 && providerAuthSummary[0]?.provider === "ollama" && (
                <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                  <p className="text-xs font-medium text-foreground">Only one Ollama model found</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pull another model to expand your local catalog, for example{" "}
                    <code className="font-mono">ollama pull llama3.1:8b</code>.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── Connect a new provider ── */}
          {connectableProviders.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/40">
                Connect a new provider
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {connectableProviders.slice(0, 12).map((p) => {
                  const meta = CONNECT_PROVIDER_META[p];
                  const isActive = connectProvider === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        if (isActive) {
                          setConnectProvider(null);
                          setConnectKey("");
                          setConnectBaseUrl("");
                          setConnectShowKey(false);
                        } else {
                          setConnectProvider(p);
                          setConnectKey("");
                          setConnectBaseUrl("");
                          setConnectShowKey(false);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-colors",
                        isActive
                          ? "border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] text-foreground"
                          : connectSuccess === p
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-foreground/10 bg-foreground/5 text-muted-foreground/70 hover:border-[var(--accent-brand-border)] hover:text-foreground/80",
                      )}
                    >
                      <span>{meta?.icon || "🤖"}</span>
                      <span className="truncate font-medium">{meta?.label || getProviderDisplayName(p)}</span>
                      {connectSuccess === p ? (
                        <Check className="ml-auto h-3 w-3 text-emerald-400" />
                      ) : (
                        <Plus className="ml-auto h-2.5 w-2.5 text-muted-foreground/30" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Inline key input ── */}
          {connectProvider && (() => {
            const meta = CONNECT_PROVIDER_META[connectProvider];
            const isCustom = connectProvider === "custom";
            const canSubmit = isCustom
              ? connectBaseUrl.trim().length > 0
              : connectKey.trim().length > 0;
            return (
            <div className="mt-3 rounded-xl border border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm">{meta?.icon || "🤖"}</span>
                <span className="text-xs font-semibold text-foreground">
                  Connect {meta?.label || connectProvider}
                </span>
                <button
                  type="button"
                  onClick={() => { setConnectProvider(null); setConnectKey(""); setConnectBaseUrl(""); setConnectShowKey(false); }}
                  className="ml-auto rounded p-0.5 text-muted-foreground/40 hover:text-foreground/60"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Base URL input for custom providers */}
              {meta?.needsBaseUrl && (
                <div className="mb-2">
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground/60">
                    Endpoint URL
                  </label>
                  <input
                    type="text"
                    value={connectBaseUrl}
                    onChange={(e) => setConnectBaseUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) { e.preventDefault(); handleConnectProvider(); } }}
                    placeholder={meta.baseUrlPlaceholder || "https://api.example.com/v1"}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-mono text-foreground/90 placeholder:text-muted-foreground/30 focus:border-[var(--accent-brand-border)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-brand-ring)]"
                    autoFocus
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground/40">
                    Any OpenAI-compatible endpoint (vLLM, Ollama, LM Studio, NVIDIA NIM, etc.)
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  {meta?.needsBaseUrl && (
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground/60">
                      API Key {meta?.keyOptional ? "(optional)" : ""}
                    </label>
                  )}
                  <input
                    type={connectShowKey ? "text" : "password"}
                    value={connectKey}
                    onChange={(e) => setConnectKey(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) { e.preventDefault(); handleConnectProvider(); } }}
                    placeholder={meta?.keyHint || "Paste API key..."}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 pr-9 text-xs font-mono text-foreground/90 placeholder:text-muted-foreground/30 focus:border-[var(--accent-brand-border)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-brand-ring)]"
                    autoFocus={!meta?.needsBaseUrl}
                  />
                  <button
                    type="button"
                    onClick={() => setConnectShowKey(!connectShowKey)}
                    className="absolute right-2.5 bottom-2.5 text-muted-foreground/40 hover:text-foreground/60"
                  >
                    {connectShowKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleConnectProvider}
                  disabled={!canSubmit || connectSaving}
                  className={cn(
                    "shrink-0 rounded-lg bg-[var(--accent-brand)] text-[var(--accent-brand-on)] px-4 py-2.5 text-xs font-medium transition-colors hover:opacity-90 disabled:opacity-40",
                    meta?.needsBaseUrl && "self-end",
                  )}
                >
                  {connectSaving ? <BusyDots /> : "Connect"}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/50">
                <KeyRound className="h-2.5 w-2.5" />
                <span>Stored securely in OpenClaw. Never leaves your machine.</span>
                {meta?.keyUrl && (
                  <a
                    href={meta.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-0.5 text-[var(--accent-brand-text)] hover:text-[var(--accent-brand)]"
                  >
                    Get a key <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>
            );
          })()}

          {/* Manage keys link */}
          {hasCredentialProviders && (
            <div className="mt-3">
              <a
                href="/accounts"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Advanced Key Management
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </section>

        {/* ━━━ SECTION 3: Advanced Settings ━━━ */}
        <section className="rounded-2xl border border-border overflow-hidden bg-card">
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-foreground/5"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-foreground">Advanced Settings</h2>
              {mainHasOverride && <StatusPill tone="warn" label="Overrides active" />}
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                advancedOpen && "rotate-180",
              )}
            />
          </button>

          {advancedOpen && (
            <div className="border-t border-border">
              {/* Tab bar */}
              <div className="flex border-b border-border">
                {(
                  [
                    { key: "agents" as const, label: "Per-Agent", icon: Bot },
                    { key: "allowlist" as const, label: "Allowlist", icon: Shield },
                    { key: "routing" as const, label: "Routing", icon: SlidersHorizontal },
                    { key: "aliases" as const, label: "Aliases & Auth", icon: Tag },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setAdvancedTab(tab.key)}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2",
                      advancedTab === tab.key
                        ? "border-[var(--accent-brand)] text-[var(--accent-brand-text)]"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                    )}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="px-5 py-4">
                {/* ── Tab 1: Per-Agent Overrides ── */}
                {advancedTab === "agents" && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-4">
                      Override the model for individual agents. Agents without overrides inherit
                      the global default model.
                    </p>
                    <div className="space-y-3">
                      {sortedAgents.map((agent) => {
                        const configured = agent.modelPrimary || defaultPrimary;
                        const runtime = agentStatuses[agent.id];
                        const resolved =
                          runtime?.resolvedDefault || runtime?.defaultModel || configured;
                        const configuredFallbacks = Array.isArray(agent.modelFallbacks)
                          ? agent.modelFallbacks
                          : [];
                        const rowBusy =
                          busyKey === `agent:${agent.id}` ||
                          busyKey === `reset:${agent.id}` ||
                          busyKey === `agent:fallback:${agent.id}`;

                        return (
                          <div
                            key={agent.id}
                            className="rounded-xl border border-border/70 bg-muted/10 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-foreground">
                                  {agent.name}
                                </span>
                                <StatusPill
                                  tone={agent.usesDefaults ? "neutral" : "warn"}
                                  label={
                                    agent.usesDefaults ? "uses default" : "override"
                                  }
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                {!agent.usesDefaults && (
                                  <button
                                    type="button"
                                    onClick={() => void resetAgentToDefaults(agent)}
                                    disabled={Boolean(busyKey)}
                                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    Reset
                                  </button>
                                )}
                                {rowBusy && (
                                  <span className="text-xs text-[var(--accent-brand-text)]">
                                    <BusyDots />
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Current effective model */}
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Model:</span>
                              <span className="text-xs font-medium text-foreground">
                                {getFriendlyModelName(resolved)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setPickerTarget({ kind: "agent", agent })
                                }
                                disabled={Boolean(busyKey)}
                                className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                              >
                                <RefreshCw className="h-3 w-3" />
                                Change
                              </button>
                            </div>

                            {/* Agent fallbacks */}
                            {(configuredFallbacks.length > 0 || !agent.usesDefaults) && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Fallbacks:</span>
                                {configuredFallbacks.map((fb) => (
                                  <span
                                    key={`${agent.id}:fb:${fb}`}
                                    className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground"
                                  >
                                    {getFriendlyModelName(fb)}
                                    <button
                                      type="button"
                                      onClick={() => void removeAgentFallback(agent, fb)}
                                      disabled={Boolean(busyKey)}
                                      className="rounded p-0.5 hover:text-red-400 disabled:opacity-40"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  </span>
                                ))}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPickerTarget({
                                      kind: "agent-fallback",
                                      agent,
                                    })
                                  }
                                  disabled={Boolean(busyKey)}
                                  className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-border/50 px-2 py-0.5 text-xs text-muted-foreground/60 transition-colors hover:bg-accent disabled:opacity-40"
                                >
                                  <Plus className="h-3 w-3" />
                                  Add
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Tab 2: Allowlist ── */}
                {advancedTab === "allowlist" && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Control which models are available for selection.
                      {allModels.length > 0 && (
                        <span className="ml-1 text-muted-foreground/50">
                          ({allModels.length} models discovered from providers)
                        </span>
                      )}
                    </p>

                    {allModelsWarning && (
                      <p className="mb-3 text-xs text-amber-400">
                        <AlertTriangle className="mr-1 inline h-3 w-3" />
                        {allModelsWarning}
                      </p>
                    )}

                    {/* Current allowlist */}
                    <div className="rounded-lg border border-border/50 bg-muted/10 p-3 mb-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-xs font-medium text-foreground">
                          Allowed Models ({configuredAllowed.length})
                        </p>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => fetchAllModels()}
                            disabled={allModelsLoading || Boolean(busyKey)}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                          >
                            {allModelsLoading ? <BusyDots /> : <RefreshCw className="h-3 w-3" />}
                            Refresh
                          </button>
                          <button
                            type="button"
                            onClick={() => void scanModels()}
                            disabled={Boolean(busyKey)}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                          >
                            {busyKey === "catalog:scan" ? (
                              <BusyDots />
                            ) : (
                              <Search className="h-3 w-3" />
                            )}
                            Scan
                          </button>
                        </div>
                      </div>
                      {configuredAllowed.length === 0 ? (
                        <p className="text-xs text-muted-foreground/60">
                          No explicit allowlist. All discovered models are available.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {configuredAllowed.map((entry) => (
                            <button
                              key={`allow:${entry}`}
                              type="button"
                              onClick={() => void removeAllowedModel(entry)}
                              disabled={Boolean(busyKey)}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                            >
                              {getFriendlyModelName(entry)}
                              <Trash2 className="h-3 w-3" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Add to allowlist */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPickerTarget({ kind: "allowlist" })}
                        disabled={Boolean(busyKey)}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add from Catalog
                      </button>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={customModelToAdd}
                          onChange={(e) => setCustomModelToAdd(e.target.value)}
                          placeholder="provider/model-name"
                          className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-[var(--accent-brand-border)] w-56"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void addAllowedModel(customModelToAdd);
                            setCustomModelToAdd("");
                          }}
                          disabled={!customModelToAdd.trim() || Boolean(busyKey)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Custom
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Tab 3: Routing ── */}
                {advancedTab === "routing" && (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Configure failover and catalog behavior. These controls map directly to
                      OpenClaw model routing settings.
                    </p>

                    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-xs font-semibold text-foreground">Image Routing</h3>
                          <p className="mt-1 text-xs text-muted-foreground/70">
                            Choose the model used for image-capable requests and define failover.
                          </p>
                        </div>
                        <StatusPill
                          tone={imageModel ? "good" : "warn"}
                          label={imageModel ? "configured" : "not configured"}
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">Primary image model:</span>
                        <span className="rounded-md border border-border/60 bg-card px-2 py-1 text-xs font-medium text-foreground">
                          {imageModel ? getFriendlyModelName(imageModel) : "Not set"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPickerTarget({ kind: "image-model" })}
                          disabled={Boolean(busyKey)}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                          Choose model
                        </button>
                      </div>

                      <div className="mt-3">
                        <p className="text-xs text-muted-foreground mb-2">
                          Image fallback chain ({imageFallbacks.length})
                        </p>
                        {imageFallbacks.length === 0 ? (
                          <p className="text-xs text-muted-foreground/60">
                            No image fallback models configured.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {imageFallbacks.map((fallback) => (
                              <span
                                key={`image-fallback:${fallback}`}
                                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground"
                              >
                                {getFriendlyModelName(fallback)}
                                <button
                                  type="button"
                                  onClick={() => void removeImageFallback(fallback)}
                                  disabled={Boolean(busyKey)}
                                  className="rounded p-0.5 transition-colors hover:bg-muted/60 hover:text-red-400 disabled:opacity-40"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setPickerTarget({ kind: "image-fallback" })}
                          disabled={Boolean(busyKey)}
                          className="mt-2 inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add image fallback
                        </button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-xs font-semibold text-foreground">
                            Heartbeat Model
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground/70">
                            Select the model used by automated heartbeat jobs.
                          </p>
                        </div>
                        <StatusPill
                          tone={heartbeatModel ? "warn" : "neutral"}
                          label={heartbeatModel ? "override" : "inherits default"}
                        />
                      </div>

                      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,180px)_auto_auto]">
                        <input
                          type="text"
                          value={heartbeatEveryDraft}
                          onChange={(e) => setHeartbeatEveryDraft(e.target.value)}
                          placeholder="1h"
                          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-[var(--accent-brand-border)]"
                        />
                        <button
                          type="button"
                          onClick={() => void setHeartbeatEvery(heartbeatEveryDraft)}
                          disabled={
                            Boolean(busyKey) ||
                            !heartbeatEveryDraft.trim() ||
                            heartbeatEveryDraft.trim() === heartbeatEvery
                          }
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                        >
                          Save interval
                        </button>
                        <button
                          type="button"
                          onClick={() => setPickerTarget({ kind: "heartbeat-model" })}
                          disabled={Boolean(busyKey)}
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Choose model
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Effective heartbeat model:
                        </span>
                        <span className="rounded-md border border-border/60 bg-card px-2 py-1 text-xs font-medium text-foreground">
                          {getFriendlyModelName(heartbeatModel || defaultPrimary)}
                          {!heartbeatModel ? " (default)" : ""}
                        </span>
                        {heartbeatModel && (
                          <button
                            type="button"
                            onClick={() => void setHeartbeatModel("")}
                            disabled={Boolean(busyKey)}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Reset model
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
                      <h3 className="text-xs font-semibold text-foreground">Provider Catalog Mode</h3>
                      <p className="mt-1 text-xs text-muted-foreground/70">
                        <code>merge</code> keeps built-in providers and adds overrides.
                        <code className="ml-1">replace</code> uses only providers listed below.
                      </p>
                      <div className="mt-3 inline-flex rounded-lg border border-border bg-muted p-1">
                        {(["merge", "replace"] as const).map((mode) => (
                          <button
                            key={`catalog-mode:${mode}`}
                            type="button"
                            onClick={() => void setCatalogMode(mode)}
                            disabled={Boolean(busyKey)}
                            className={cn(
                              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                              modelsCatalogConfig.mode === mode
                                ? "bg-card text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold text-foreground">
                          Provider Overrides
                        </h3>
                        <StatusPill
                          tone={modelsCatalogConfig.providers.length > 0 ? "warn" : "neutral"}
                          label={`${modelsCatalogConfig.providers.length} active`}
                        />
                      </div>

                      {modelsCatalogConfig.providers.length > 0 ? (
                        <div className="mt-2 space-y-1.5">
                          {modelsCatalogConfig.providers.map((entry) => (
                            <div
                              key={`provider-override:${entry.provider}`}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-card/70 px-2.5 py-2"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-foreground">
                                  {PROVIDER_INFO[entry.provider]?.displayName ||
                                    getProviderDisplayName(entry.provider)}
                                </p>
                                <p className="text-xs text-muted-foreground/60">
                                  <code>{entry.provider}</code> ·{" "}
                                  {Object.keys(entry.config || {}).length} keys
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setProviderDraftId(entry.provider);
                                    setProviderDraftCustomId("");
                                    loadProviderDraft(entry.provider);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeProviderConfig(entry.provider)}
                                  disabled={Boolean(busyKey)}
                                  className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground/60">
                          No provider overrides configured.
                        </p>
                      )}

                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <select
                          value={providerDraftId}
                          onChange={(e) => {
                            const next = e.target.value;
                            setProviderDraftError(null);
                            setProviderDraftId(next);
                            if (next && next !== "__custom__") {
                              setProviderDraftCustomId("");
                              loadProviderDraft(next);
                            }
                          }}
                          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-[var(--accent-brand-border)]"
                        >
                          <option value="">Select provider...</option>
                          {providerDraftOptions.map((provider) => (
                            <option key={`provider-draft:${provider}`} value={provider}>
                              {PROVIDER_INFO[provider]?.displayName ||
                                getProviderDisplayName(provider)}{" "}
                              ({provider})
                            </option>
                          ))}
                          <option value="__custom__">Custom provider id...</option>
                        </select>
                        {providerDraftId === "__custom__" ? (
                          <input
                            type="text"
                            value={providerDraftCustomId}
                            onChange={(e) => setProviderDraftCustomId(e.target.value)}
                            onBlur={(e) => {
                              const next = e.target.value.trim().toLowerCase();
                              if (next) loadProviderDraft(next);
                            }}
                            placeholder="provider id (for example my-proxy)"
                            className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-[var(--accent-brand-border)]"
                          />
                        ) : (
                          <div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground">
                            Editing <code>{providerDraftResolvedId}</code>
                          </div>
                        )}
                      </div>

                      <textarea
                        value={providerDraftJson}
                        onChange={(e) => setProviderDraftJson(e.target.value)}
                        className="mt-2 h-40 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors focus:border-[var(--accent-brand-border)]"
                      />
                      {providerDraftError && (
                        <p className="mt-2 text-xs text-red-500">{providerDraftError}</p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={applyProviderTemplate}
                          disabled={!providerDraftResolvedId}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                        >
                          Use template
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveProviderConfig()}
                          disabled={!providerDraftResolvedId || Boolean(busyKey)}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                        >
                          Save override
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeProviderConfig(providerDraftResolvedId)}
                          disabled={!providerDraftHasOverride || Boolean(busyKey)}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                        >
                          Remove current override
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Tab 4: Aliases & Auth ── */}
                {advancedTab === "aliases" && (
                  <div className="space-y-6">
                    {/* Model Aliases */}
                    <div>
                      <h3 className="text-xs font-semibold text-foreground mb-2">
                        Model Aliases
                      </h3>
                      <p className="text-xs text-muted-foreground mb-3">
                        Create short names for models. Use an alias anywhere you&apos;d use a full
                        model key.
                      </p>
                      {Object.keys(aliases).length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {Object.entries(aliases).map(([alias, target]) => (
                            <button
                              key={`alias:${alias}`}
                              type="button"
                              onClick={() => {
                                void runAction(
                                  { action: "remove-alias", alias },
                                  `Removed alias "${alias}"`,
                                  `alias:remove:${alias}`,
                                  { restart: false },
                                );
                              }}
                              disabled={Boolean(busyKey)}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
                            >
                              <span className="font-semibold text-foreground">{alias}</span>
                              <span className="text-muted-foreground/60">&rarr;</span>
                              <span>{getFriendlyModelName(target)}</span>
                              <Trash2 className="h-3 w-3 ml-1" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground/60 mb-3">
                          No aliases configured.
                        </p>
                      )}
                      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                        <input
                          type="text"
                          value={aliasName}
                          onChange={(e) => setAliasName(e.target.value)}
                          placeholder="Alias name (e.g. fast)"
                          className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-[var(--accent-brand-border)]"
                        />
                        <select
                          value={aliasTarget}
                          onChange={(e) => setAliasTarget(e.target.value)}
                          className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-[var(--accent-brand-border)]"
                        >
                          <option value="">Target model...</option>
                          {allModelOptions
                            .filter((opt) => opt.ready || opt.authConnected)
                            .map((opt) => (
                              <option key={`alias:target:${opt.key}`} value={opt.key}>
                                {opt.name} · {opt.provider}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            if (!aliasName.trim() || !aliasTarget) return;
                            void runAction(
                              { action: "set-alias", alias: aliasName.trim(), model: aliasTarget },
                              `Alias "${aliasName.trim()}" created`,
                              `alias:set:${aliasName.trim()}`,
                              { restart: false },
                            );
                            setAliasName("");
                            setAliasTarget("");
                          }}
                          disabled={!aliasName.trim() || !aliasTarget || Boolean(busyKey)}
                          className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Auth Order Override */}
                    <div>
                      <h3 className="text-xs font-semibold text-foreground mb-2">
                        Auth Order Override
                      </h3>
                      <p className="text-xs text-muted-foreground mb-3">
                        Control which credential is tried first when multiple exist for the same
                        provider.
                      </p>
                      <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            {orderLoading ? (
                              <span className="text-xs text-muted-foreground">
                                <BusyDots /> Loading...
                              </span>
                            ) : (
                              <StatusPill
                                tone={orderDraft.length > 0 ? "warn" : "neutral"}
                                label={
                                  orderDraft.length > 0
                                    ? "override active"
                                    : "default rotation"
                                }
                              />
                            )}
                          </div>
                        </div>

                        <div className="grid gap-2 md:grid-cols-2 mb-2">
                          <select
                            value={orderAgentId}
                            onChange={(e) => setOrderAgentId(e.target.value)}
                            className="rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-[var(--accent-brand-border)]"
                          >
                            {sortedAgents.map((agent) => (
                              <option key={`order:agent:${agent.id}`} value={agent.id}>
                                {agent.name} ({agent.id})
                              </option>
                            ))}
                          </select>
                          <select
                            value={orderProvider}
                            onChange={(e) => setOrderProvider(e.target.value)}
                            className="rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-[var(--accent-brand-border)]"
                          >
                            {availableProviders.map((provider) => (
                              <option key={`order:provider:${provider}`} value={provider}>
                                {provider}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid gap-2 md:grid-cols-[1fr_auto] mb-2">
                          <select
                            value={orderSelectedProfileId}
                            onChange={(e) => setOrderSelectedProfileId(e.target.value)}
                            className="rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-[var(--accent-brand-border)]"
                          >
                            <option value="">Select profile id...</option>
                            {selectedOrderAgentProfiles.map((profileId) => (
                              <option key={`order:profile:${profileId}`} value={profileId}>
                                {profileId}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => addOrderProfile(orderSelectedProfileId)}
                            disabled={!orderSelectedProfileId || orderBusy}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add
                          </button>
                        </div>

                        {orderError && (
                          <p className="mb-2 text-xs text-amber-400">{orderError}</p>
                        )}

                        <div className="space-y-1.5">
                          {orderDraft.length === 0 ? (
                            <p className="text-xs text-muted-foreground/60">
                              No override set for this provider/agent pair.
                            </p>
                          ) : (
                            orderDraft.map((profileId, index) => (
                              <div
                                key={`order:draft:${profileId}`}
                                className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-xs"
                              >
                                <span className="text-foreground">{profileId}</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => moveOrderProfile(profileId, -1)}
                                    disabled={index === 0 || orderBusy}
                                    className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground disabled:opacity-40"
                                  >
                                    Up
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveOrderProfile(profileId, 1)}
                                    disabled={index === orderDraft.length - 1 || orderBusy}
                                    className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground disabled:opacity-40"
                                  >
                                    Down
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeOrderProfile(profileId)}
                                    disabled={orderBusy}
                                    className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground disabled:opacity-40"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void saveAuthOrder()}
                            disabled={orderBusy || orderDraft.length === 0}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                          >
                            {orderBusy ? <BusyDots /> : <ListOrdered className="h-3.5 w-3.5" />}
                            Save order
                          </button>
                          <button
                            type="button"
                            onClick={() => void clearAuthOrder()}
                            disabled={orderBusy}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                          >
                            Clear override
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Model Credentials summary */}
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h3 className="text-xs font-semibold text-foreground">
                          Model Credentials
                        </h3>
                        <button
                          type="button"
                          onClick={() => setRevealModelSecrets((prev) => !prev)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40"
                        >
                          {revealModelSecrets ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                          {revealModelSecrets ? "Hide" : "Reveal"}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                        <StatusPill
                          tone="good"
                          label={`${modelCredentialSummary.connected}/${modelCredentialSummary.total} providers`}
                        />
                        <StatusPill
                          tone="info"
                          label={`${modelCredentialSummary.profiles} profiles`}
                        />
                      </div>

                      {modelCredsError && (
                        <p className="mb-3 text-xs text-amber-400">
                          <AlertTriangle className="mr-1 inline h-3 w-3" />
                          {modelCredsError}
                        </p>
                      )}

                      <div className="space-y-2">
                        {modelAuthByAgent.map((row) => (
                          <div
                            key={row.agentId}
                            className="rounded-lg border border-border/50 bg-muted/10 p-2.5"
                          >
                            <p className="text-xs font-medium text-foreground mb-1.5">
                              {agentNameById.get(row.agentId) || row.agentId}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {row.providers.map((provider) => (
                                <div
                                  key={`${row.agentId}:${provider.provider}`}
                                  className="rounded-md border border-border/40 bg-muted/20 px-2 py-1 text-xs"
                                >
                                  <span className="font-medium text-foreground">
                                    {provider.provider}
                                  </span>
                                  <span className="ml-1.5">
                                    {provider.connected ? (
                                      <span className="text-emerald-400">
                                        {provider.effectiveKind || "connected"}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/50">missing</span>
                                    )}
                                  </span>
                                  {provider.envValue && revealModelSecrets && (
                                    <p className="mt-0.5 break-all text-muted-foreground/50">
                                      <code>
                                        {provider.envSource}: {provider.envValue}
                                      </code>
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </SectionBody>

      {/* ── Model Picker Modal ── */}
      {pickerTarget && (
        <ModelPicker
          models={pickerModels}
          currentModel={
            pickerTarget.kind === "default"
              ? defaultPrimary
              : pickerTarget.kind === "image-model"
                ? imageModel
                : pickerTarget.kind === "heartbeat-model"
                  ? heartbeatModel || defaultPrimary
              : pickerTarget.kind === "agent"
                ? pickerTarget.agent.modelPrimary || defaultPrimary
                : undefined
          }
          excludeModels={pickerExcludeModels}
          onSelect={handlePickerSelect}
          onClose={() => setPickerTarget(null)}
          title={pickerTitle}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-xl backdrop-blur-sm",
            toast.type === "success"
              ? "border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
              : "border-red-500/25 bg-red-500/12 text-red-700 dark:text-red-300",
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
    </SectionLayout>
  );
}
