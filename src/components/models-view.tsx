"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  ListOrdered,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  ChevronDown,
  Zap,
  Tag,
} from "lucide-react";
import { requestRestart } from "@/lib/restart-store";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/ui/loading-state";
import { ApiWarningBadge } from "@/components/ui/api-warning-badge";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { getModelMeta, getFriendlyModelName, getProviderDisplayName } from "@/lib/model-metadata";

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

type ModelOption = {
  key: string;
  name: string;
  provider: string;
  available: boolean;
  local: boolean;
  known: boolean;
  ready: boolean;
  authConnected: boolean;
  authKind: string | null;
  oauthStatus: string | null;
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

type Toast = {
  type: "success" | "error";
  message: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatAgo(ts: number | null): string {
  if (!ts) return "unknown";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "n/a";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function masked(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function renderSecret(value: string, reveal: boolean, alreadyRedacted: boolean): string {
  if (alreadyRedacted) return value;
  return reveal ? value : masked(value);
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
  aliases: Record<string, string>
): string {
  const found = models.find((m) => m.key === key);
  if (found?.name) return found.name;
  const alias = Object.entries(aliases).find(([, modelKey]) => modelKey === key)?.[0];
  if (alias) return alias;
  return modelNameFromKey(key);
}

function toneClass(tone: "neutral" | "good" | "warn" | "info") {
  switch (tone) {
    case "good":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "warn":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "info":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "good" | "warn" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium",
        toneClass(tone)
      )}
    >
      {label}
    </span>
  );
}

function ModelSelect({
  value,
  options,
  disabled,
  onSelect,
}: {
  value: string;
  options: ModelOption[];
  disabled: boolean;
  onSelect: (model: string) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onSelect(e.target.value)}
      className="rounded-lg border border-border bg-muted/50 w-full min-w-64 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-cyan-500/40 disabled:opacity-50"
    >
      {options.map((opt) => {
        const suffix = !opt.known
          ? "custom"
          : opt.local
            ? "local"
            : opt.ready
              ? "ready"
              : opt.authConnected
                ? "auth ok"
                : "sign in required";
        return (
          <option key={opt.key} value={opt.key}>
            {opt.name} · {opt.provider} · {suffix}
          </option>
        );
      })}
    </select>
  );
}

function AdvancedSection({
  title,
  icon: Icon,
  iconColor = "text-muted-foreground",
  badge,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-border overflow-hidden bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 md:px-5 transition-colors hover:bg-foreground/5"
      >
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", iconColor)} />
          <h2 className="text-xs font-semibold text-foreground">{title}</h2>
          {badge}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-4 md:px-5 md:py-5">
          {children}
        </div>
      )}
    </section>
  );
}

export function ModelsView() {
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
  const [modelCredentialSummary, setModelCredentialSummary] = useState<{
    connected: number;
    total: number;
    profiles: number;
    sourceOfTruth: boolean;
  }>({
    connected: 0,
    total: 0,
    profiles: 0,
    sourceOfTruth: false,
  });
  const [modelAuthByAgent, setModelAuthByAgent] = useState<ModelCredentialAgentRow[]>([]);
  const [agentAuthProfiles, setAgentAuthProfiles] = useState<AgentAuthProfileStore[]>([]);
  const [modelCredsError, setModelCredsError] = useState<string | null>(null);
  const [revealModelSecrets, setRevealModelSecrets] = useState(false);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [apiDegraded, setApiDegraded] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [catalogProviderFilter, setCatalogProviderFilter] = useState<string>("all");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogModelToAdd, setCatalogModelToAdd] = useState("");
  const [customModelToAdd, setCustomModelToAdd] = useState("");
  const [providerForToken, setProviderForToken] = useState("openai");
  const [providerToken, setProviderToken] = useState("");
  const [revealProviderToken, setRevealProviderToken] = useState(false);
  const [orderAgentId, setOrderAgentId] = useState("main");
  const [orderProvider, setOrderProvider] = useState("openai");
  const [orderDraft, setOrderDraft] = useState<string[]>([]);
  const [orderSelectedProfileId, setOrderSelectedProfileId] = useState("");
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        typeof data.warning === "string" && data.warning.trim() ? data.warning.trim() : null
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
        typeof data.warning === "string" && data.warning.trim()
          ? data.warning.trim()
          : null
      );
      setApiDegraded(Boolean(data.degraded));
      if (data.error) {
        console.warn("Models API partial error:", data.error);
      }
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
            : [])
      );
      setAgents(Array.isArray(data.agents) ? (data.agents as AgentModelInfo[]) : []);
      setAgentStatuses(
        (data.agentStatuses || {}) as Record<string, AgentRuntimeStatus>
      );
      setLiveModels((data.liveModels || {}) as Record<string, LiveModelInfo>);
      if (data.heartbeat && typeof data.heartbeat === "object" && "model" in data.heartbeat) {
        setHeartbeat({
          every: typeof data.heartbeat.every === "string" ? data.heartbeat.every : "",
          model: typeof data.heartbeat.model === "string" ? data.heartbeat.model : "",
        });
      } else {
        setHeartbeat(null);
      }

      try {
        const accountsRes = await fetch("/api/accounts", { cache: "no-store" });
        const accountsData = (await accountsRes.json()) as
          | (ModelsCredentialSnapshot & { error?: string })
          | { error?: string };
        if (!accountsRes.ok) {
          throw new Error(
            (accountsData as { error?: string })?.error || `HTTP ${accountsRes.status}`
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
          Array.isArray(snapshot.modelAuthByAgent) ? snapshot.modelAuthByAgent : []
        );
        setAgentAuthProfiles(
          Array.isArray(snapshot.agentAuthProfiles) ? snapshot.agentAuthProfiles : []
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

  const runAction = useCallback(
    async (
      body: Record<string, unknown>,
      successMsg: string,
      key: string,
      options?: { restart?: boolean; refreshCatalog?: boolean }
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
    [fetchAllModels, fetchModels, flash, postModelAction]
  );

  const aliases = useMemo(
    () => status?.aliases || {},
    [status]
  );
  const defaultPrimary = defaults?.primary || status?.defaultModel || "";
  const defaultFallbacks = useMemo(
    () => defaults?.fallbacks || status?.fallbacks || [],
    [defaults, status]
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
    return map;
  }, [status]);

  const allowedModels = useMemo(
    () => new Set((status?.allowed || []).map((m) => String(m))),
    [status]
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
    for (const [key, option] of catalogOptionMap.entries()) {
      map.set(key, option);
    }
    for (const [key, option] of configuredOptionMap.entries()) {
      map.set(key, option);
    }
    return map;
  }, [catalogOptionMap, configuredOptionMap]);

  const modelOptions = useMemo(() => {
    return [...configuredOptionMap.values()].sort((a, b) => {
      const aReady = a.ready || a.local ? 0 : 1;
      const bReady = b.ready || b.local ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      return a.name.localeCompare(b.name);
    });
  }, [configuredOptionMap]);

  const allModelOptions = useMemo(() => {
    return [...allOptionMap.values()].sort((a, b) => {
      const aReady = a.ready || a.local ? 0 : 1;
      const bReady = b.ready || b.local ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    });
  }, [allOptionMap]);

  const heartbeatModelOptions = useMemo(() => {
    const empty: ModelOption = {
      key: "",
      name: "— Not set",
      provider: "",
      available: false,
      local: false,
      known: false,
      ready: true,
      authConnected: false,
      authKind: null,
      oauthStatus: null,
    };
    return [empty, ...allModelOptions];
  }, [allModelOptions]);

  const availableModels = useMemo(
    () => modelOptions.filter((m) => m.ready || m.local),
    [modelOptions]
  );
  const authConnectedButLimitedModels = useMemo(
    () => modelOptions.filter((m) => m.known && !m.ready && m.authConnected),
    [modelOptions]
  );
  const lockedModels = useMemo(
    () => modelOptions.filter((m) => m.known && !m.ready && !m.authConnected),
    [modelOptions]
  );

  const selectableOptions = useCallback(
    (currentKey: string) => {
      return allModelOptions.filter(
        (opt) => opt.ready || opt.local || opt.authConnected || opt.key === currentKey
      );
    },
    [allModelOptions]
  );

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

  const filteredCatalogOptions = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return allModelOptions.filter((option) => {
      if (catalogProviderFilter !== "all" && option.provider !== catalogProviderFilter) {
        return false;
      }
      if (!query) return true;
      return (
        option.name.toLowerCase().includes(query) ||
        option.key.toLowerCase().includes(query) ||
        option.provider.toLowerCase().includes(query)
      );
    });
  }, [allModelOptions, catalogProviderFilter, catalogSearch]);

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

  useEffect(() => {
    if (sortedAgents.length === 0) return;
    if (!sortedAgents.some((agent) => agent.id === orderAgentId)) {
      setOrderAgentId(sortedAgents[0].id);
    }
  }, [orderAgentId, sortedAgents]);

  useEffect(() => {
    if (availableProviders.length === 0) return;
    if (!availableProviders.includes(providerForToken)) {
      setProviderForToken(availableProviders[0]);
    }
    if (!availableProviders.includes(orderProvider)) {
      setOrderProvider(availableProviders[0]);
    }
  }, [availableProviders, orderProvider, providerForToken]);

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
    [postModelAction]
  );

  useEffect(() => {
    if (!orderAgentId || !orderProvider) return;
    loadAuthOrder(orderAgentId, orderProvider);
  }, [loadAuthOrder, orderAgentId, orderProvider]);

  const mainAgent = agents.find((agent) => agent.id === "main") || null;
  const mainHasOverride = Boolean(mainAgent && !mainAgent.usesDefaults);
  const mainConfigured = mainAgent?.modelPrimary || defaultPrimary;
  const mainRuntime = mainAgent ? agentStatuses[mainAgent.id] : null;
  const mainResolved =
    mainRuntime?.resolvedDefault || mainRuntime?.defaultModel || mainConfigured;
  const mainLive = mainAgent ? liveModels[mainAgent.id]?.fullModel || null : null;

  const changeDefaultModel = useCallback(
    async (nextModel: string) => {
      if (!nextModel || nextModel === defaultPrimary) return;
      const seed = defaultPrimary ? [defaultPrimary] : [];
      const nextFallbacks = [
        ...seed,
        ...defaultFallbacks.filter(
          (f) => f !== nextModel && (!defaultPrimary || f !== defaultPrimary)
        ),
      ];
      await runAction(
        {
          action: "reorder",
          primary: nextModel,
          fallbacks: nextFallbacks,
        },
        `Default model set to ${getModelDisplayName(nextModel, models, aliases)}`,
        "defaults"
      );
    },
    [aliases, defaultFallbacks, defaultPrimary, models, runAction]
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
        `${agent.name} now configured for ${getModelDisplayName(
          nextModel,
          models,
          aliases
        )}`,
        `agent:${agent.id}`
      );
    },
    [aliases, defaultPrimary, models, runAction]
  );

  const resetAgentToDefaults = useCallback(
    async (agent: AgentModelInfo) => {
      if (agent.usesDefaults) return;
      await runAction(
        {
          action: "reset-agent-model",
          agentId: agent.id,
        },
        `${agent.name} now uses global defaults`,
        `reset:${agent.id}`
      );
    },
    [runAction]
  );

  const changeHeartbeat = useCallback(
    async (updates: { model?: string; every?: string }) => {
      await runAction(
        { action: "set-heartbeat", ...updates },
        "Heartbeat updated",
        "heartbeat"
      );
    },
    [runAction]
  );

  const addDefaultFallback = useCallback(
    async (modelKey: string) => {
      const key = String(modelKey || "").trim();
      if (!key || key === defaultPrimary || defaultFallbacks.includes(key)) return;
      await runAction(
        { action: "set-fallbacks", fallbacks: [...defaultFallbacks, key] },
        `Added fallback ${getModelDisplayName(key, models, aliases)}`,
        "defaults:fallbacks"
      );
    },
    [aliases, defaultFallbacks, defaultPrimary, models, runAction]
  );

  const removeDefaultFallback = useCallback(
    async (modelKey: string) => {
      const next = defaultFallbacks.filter((fallback) => fallback !== modelKey);
      await runAction(
        { action: "set-fallbacks", fallbacks: next },
        `Removed fallback ${getModelDisplayName(modelKey, models, aliases)}`,
        "defaults:fallbacks"
      );
    },
    [aliases, defaultFallbacks, models, runAction]
  );

  const addAgentFallback = useCallback(
    async (agent: AgentModelInfo, modelKey: string) => {
      const key = String(modelKey || "").trim();
      if (!key) return;
      const primary = agent.modelPrimary || defaultPrimary;
      const current = Array.isArray(agent.modelFallbacks) ? agent.modelFallbacks : [];
      if (key === primary || current.includes(key)) return;
      const nextFallbacks = [...current, key];
      await runAction(
        {
          action: "set-agent-model",
          agentId: agent.id,
          primary,
          fallbacks: nextFallbacks,
        },
        `${agent.name} fallback chain updated`,
        `agent:fallback:${agent.id}`
      );
    },
    [defaultPrimary, runAction]
  );

  const removeAgentFallback = useCallback(
    async (agent: AgentModelInfo, modelKey: string) => {
      const primary = agent.modelPrimary || defaultPrimary;
      const current = Array.isArray(agent.modelFallbacks) ? agent.modelFallbacks : [];
      const nextFallbacks = current.filter((entry) => entry !== modelKey);
      await runAction(
        {
          action: "set-agent-model",
          agentId: agent.id,
          primary,
          fallbacks: nextFallbacks,
        },
        `${agent.name} fallback chain updated`,
        `agent:fallback:${agent.id}`
      );
    },
    [defaultPrimary, runAction]
  );

  const addAllowedModel = useCallback(
    async (modelKey: string) => {
      const key = String(modelKey || "").trim();
      if (!key || configuredAllowed.includes(key)) return;
      await runAction(
        { action: "add-allowed-model", model: key },
        `Added ${getModelDisplayName(key, allModels, aliases)} to allowed models`,
        "allowlist:add",
        { refreshCatalog: true }
      );
      setCatalogModelToAdd("");
      setCustomModelToAdd("");
    },
    [aliases, allModels, configuredAllowed, runAction]
  );

  const removeAllowedModel = useCallback(
    async (modelKey: string) => {
      const key = String(modelKey || "").trim();
      if (!key) return;
      await runAction(
        { action: "remove-allowed-model", model: key },
        `Removed ${getModelDisplayName(key, allModels, aliases)} from allowed models`,
        "allowlist:remove",
        { refreshCatalog: true }
      );
    },
    [aliases, allModels, runAction]
  );

  const saveProviderToken = useCallback(async () => {
    if (!providerForToken || !providerToken.trim()) return;
    await runAction(
      {
        action: "auth-provider",
        provider: providerForToken,
        token: providerToken.trim(),
      },
      `${providerForToken} credential saved`,
      "auth:provider",
      { restart: false, refreshCatalog: true }
    );
    setProviderToken("");
    setRevealProviderToken(false);
  }, [providerForToken, providerToken, runAction]);

  const scanModels = useCallback(async () => {
    await runAction(
      {
        action: "scan-models",
        noProbe: false,
      },
      "Model scan complete",
      "catalog:scan",
      { restart: false, refreshCatalog: true }
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

  const globalFallbackCandidates = useMemo(
    () =>
      selectableOptions(defaultPrimary).filter(
        (option) =>
          option.key !== defaultPrimary && !defaultFallbacks.includes(option.key)
      ),
    [defaultFallbacks, defaultPrimary, selectableOptions]
  );

  const catalogPreviewOptions = useMemo(
    () => filteredCatalogOptions.slice(0, 400),
    [filteredCatalogOptions]
  );

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

  const mainMeta = getModelMeta(mainResolved);
  const defaultMeta = getModelMeta(defaultPrimary);

  return (
    <SectionLayout>
      <SectionHeader
        title="Models"
        description="Choose your AI model, connect providers, and manage advanced configuration."
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
              <RefreshCw className={cn("h-3.5 w-3.5", busyKey && "animate-spin")} />
              Refresh
            </button>
          </div>
        }
      />

      <SectionBody width="narrow" padding="roomy" innerClassName="space-y-6">
        {/* ━━━ TIER 1: Your Model ━━━ */}
        <section className="rounded-2xl border border-border p-4 md:p-5 bg-card">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <h2 className="text-xs font-semibold text-foreground">Your Model</h2>
          </div>

          {/* Hero card — current model */}
          <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-transparent p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-foreground">
                  {getFriendlyModelName(mainResolved)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-foreground/10 bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {getProviderDisplayName(modelProvider(mainResolved))}
                  </span>
                  {(mainMeta || defaultMeta) && (
                    <span className="text-xs text-muted-foreground">
                      {(mainMeta || defaultMeta)!.contextWindow} context
                    </span>
                  )}
                  {(mainMeta || defaultMeta) && (
                    <span className="text-xs text-muted-foreground">
                      {(mainMeta || defaultMeta)!.priceTier}
                    </span>
                  )}
                </div>
                {(mainMeta || defaultMeta) && (
                  <p className="mt-2 text-xs text-muted-foreground/80">
                    {(mainMeta || defaultMeta)!.description}
                  </p>
                )}
              </div>
              <StatusPill
                tone={defaultResolved === defaultPrimary ? "good" : "warn"}
                label={defaultResolved === defaultPrimary ? "Active" : "Fallback active"}
              />
            </div>

            {/* Model switcher */}
            <div className="mt-4 max-w-md">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Switch model
              </label>
              <ModelSelect
                value={defaultPrimary}
                options={selectableOptions(defaultPrimary)}
                disabled={Boolean(busyKey)}
                onSelect={(next) => {
                  void changeDefaultModel(next);
                }}
              />
            </div>

            {/* Fallback chain inline */}
            {defaultFallbacks.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1.5">Fallback chain</p>
                <div className="flex flex-wrap gap-1.5">
                  {defaultFallbacks.map((fallback) => (
                    <span
                      key={`hero:fallback:${fallback}`}
                      className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {getFriendlyModelName(fallback)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Status cards — Using now / Saved / Last session (main agent) */}
          {mainAgent && (
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              <div className="rounded-lg border border-border p-2.5 bg-muted/20">
                <p className="uppercase tracking-wide text-muted-foreground text-xs">Using now</p>
                <p className="mt-1 text-xs font-semibold text-foreground">
                  {getFriendlyModelName(mainResolved)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {mainHasOverride ? "From agent override" : "From global default"}
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5 bg-muted/20">
                <p className="uppercase tracking-wide text-muted-foreground text-xs">Saved setting</p>
                <p className="mt-1 text-xs font-semibold text-foreground">
                  {getFriendlyModelName(mainConfigured)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5 bg-muted/20">
                <p className="uppercase tracking-wide text-muted-foreground text-xs">Last session</p>
                {mainLive ? (
                  <>
                    <p className="mt-1 text-xs font-semibold text-foreground">
                      {getFriendlyModelName(mainLive)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatAgo(liveModels[mainAgent.id]?.updatedAt ?? null)}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">No session yet</p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ━━━ TIER 1: Quick Connect ━━━ */}
        <section className="rounded-2xl border border-border p-4 md:p-5 bg-card">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-amber-400" />
            <h2 className="text-xs font-semibold text-foreground">Quick Connect</h2>
            <StatusPill
              tone={providerAuthSummary.some((p) => p.connected) ? "good" : "warn"}
              label={`${providerAuthSummary.filter((p) => p.connected).length}/${providerAuthSummary.length} connected`}
            />
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Connect an AI provider to start using their models. Paste your API key to get started.
          </p>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {providerAuthSummary.map((provider) => (
              <div
                key={`connect:${provider.provider}`}
                className={cn(
                  "rounded-xl border p-3 transition-colors",
                  provider.connected
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-border bg-muted/20 hover:bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">
                    {getProviderDisplayName(provider.provider)}
                  </p>
                  {provider.connected ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3 w-3" />
                      Connected
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not connected</span>
                  )}
                </div>
                {provider.connected && provider.authKind && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    via {provider.authKind}{provider.oauthStatus ? ` (${provider.oauthStatus})` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Inline key paste */}
          <div className="mt-4 rounded-lg border border-border/70 bg-muted/15 p-3">
            <p className="text-xs font-medium text-foreground mb-2">Add or update API key</p>
            <div className="grid gap-2 md:grid-cols-[10rem_1fr_auto_auto]">
              <select
                value={providerForToken}
                onChange={(e) => setProviderForToken(e.target.value)}
                className="rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
              >
                {availableProviders.map((provider) => (
                  <option key={`quickconnect:provider:${provider}`} value={provider}>
                    {getProviderDisplayName(provider)}
                  </option>
                ))}
              </select>
              <input
                type={revealProviderToken ? "text" : "password"}
                value={providerToken}
                onChange={(e) => setProviderToken(e.target.value)}
                placeholder="Paste API key / token"
                className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
              />
              <button
                type="button"
                onClick={() => setRevealProviderToken((prev) => !prev)}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
              >
                {revealProviderToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveProviderToken();
                }}
                disabled={!providerToken.trim() || Boolean(busyKey)}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Save
              </button>
            </div>
          </div>
        </section>

        {/* ━━━ TIER 2: Advanced (collapsible) ━━━ */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Advanced Configuration
          </p>

          {/* Per-Agent Model Configuration */}
          <AdvancedSection
            title="Per-Agent Models"
            icon={Bot}
            iconColor="text-cyan-400"
            badge={mainHasOverride ? <StatusPill tone="warn" label="Override active" /> : undefined}
          >
            <p className="text-xs text-muted-foreground mb-4">
              Override the model for individual agents. Agents set to &quot;inherits default&quot; use the global model above.
            </p>
            <div className="space-y-3">
            {sortedAgents.map((agent) => {
              const configured = agent.modelPrimary || defaultPrimary;
              const runtime = agentStatuses[agent.id];
              const resolved = runtime?.resolvedDefault || runtime?.defaultModel || configured;
              const live = liveModels[agent.id] || null;
              const lastSession = live?.fullModel || null;

              const fallbackActive = resolved !== configured;
              const sessionLag = Boolean(lastSession && lastSession !== resolved);
              const configuredFallbacks = Array.isArray(agent.modelFallbacks)
                ? agent.modelFallbacks
                : [];
              const fallbackCandidates = selectableOptions(configured).filter(
                (opt) => opt.key !== configured && !configuredFallbacks.includes(opt.key)
              );
              const rowBusy =
                busyKey === `agent:${agent.id}` ||
                busyKey === `reset:${agent.id}` ||
                busyKey === `agent:fallback:${agent.id}`;

              return (
                <div
                  key={agent.id}
                  className="rounded-xl border border-border/70 bg-card/50 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {agent.name}
                    </span>
                    <span className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                      {agent.id}
                    </span>
                    <StatusPill
                      tone={agent.usesDefaults ? "neutral" : "warn"}
                      label={agent.usesDefaults ? "inherits default" : "explicit override"}
                    />
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <div className="rounded-lg border border-border p-2.5 bg-muted/20">
                      <p className="uppercase tracking-wide text-muted-foreground text-xs">
                        Using now
                      </p>
                      <p className="mt-1 text-xs font-semibold text-foreground">
                        {getModelDisplayName(resolved, models, aliases)}
                      </p>
                      {fallbackActive && (
                        <p className="text-amber-700 dark:text-amber-300 mt-1 text-xs">Fallback active now</p>
                      )}
                    </div>

                    <div className="rounded-lg border border-border p-2.5 bg-muted/20">
                      <p className="uppercase tracking-wide text-muted-foreground text-xs">
                        Saved setting
                      </p>
                      <p className="mt-1 text-xs font-semibold text-foreground">
                        {getModelDisplayName(configured, models, aliases)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {agent.usesDefaults ? "From global defaults" : "Saved as agent override"}
                      </p>
                    </div>

                    <div className="rounded-lg border border-border p-2.5 bg-muted/20">
                      <p className="uppercase tracking-wide text-muted-foreground text-xs">
                        Last session
                      </p>
                      {lastSession ? (
                        <>
                          <p className="mt-1 text-xs font-semibold text-foreground">
                            {getModelDisplayName(lastSession, models, aliases)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatAgo(live?.updatedAt ?? null)}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">No session yet</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
                    <div className="w-full max-w-md">
                      <ModelSelect
                        value={configured}
                        options={selectableOptions(configured)}
                        disabled={Boolean(busyKey)}
                        onSelect={(next) => {
                          void changeAgentModel(agent, next);
                        }}
                      />
                    </div>
                    {!agent.usesDefaults && (
                      <button
                        type="button"
                        onClick={() => {
                          void resetAgentToDefaults(agent);
                        }}
                        disabled={Boolean(busyKey)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Use defaults
                      </button>
                    )}
                    {rowBusy && <p className="text-cyan-700 dark:text-cyan-300 text-xs">Applying...</p>}
                  </div>

                  <div className="mt-2 rounded-lg border border-border/70 bg-muted/15 p-2.5">
                    <p className="text-xs text-muted-foreground">Fallback chain override</p>
                    {configuredFallbacks.length === 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        No explicit fallback list. This agent follows its default chain.
                      </p>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {configuredFallbacks.map((fallback) => (
                          <button
                            key={`${agent.id}:fallback:${fallback}`}
                            type="button"
                            onClick={() => {
                              void removeAgentFallback(agent, fallback);
                            }}
                            disabled={Boolean(busyKey)}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
                          >
                            {getModelDisplayName(fallback, models, aliases)}
                            <Trash2 className="h-3 w-3" />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value=""
                        disabled={Boolean(busyKey) || fallbackCandidates.length === 0}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (!next) return;
                          void addAgentFallback(agent, next);
                        }}
                        className="rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40 disabled:opacity-50"
                      >
                        <option value="">Add fallback model…</option>
                        {fallbackCandidates.map((opt) => (
                          <option key={`${agent.id}:candidate:${opt.key}`} value={opt.key}>
                            {opt.name} · {opt.provider}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {sessionLag && (
                    <p className="text-amber-700 dark:text-amber-300 mt-2 text-xs">
                      Last session still shows the previous model. New turns should use the
                      model shown in &quot;Using now&quot;.
                    </p>
                  )}
                </div>
              );
            })}
            </div>
          </AdvancedSection>

          {/* Model Catalog & Allowlist */}
          <AdvancedSection
            title="Model Catalog & Allowlist"
            icon={Plus}
            iconColor="text-emerald-500"
            badge={
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusPill tone="good" label={`${configuredAllowed.length} allowed`} />
                <StatusPill tone="info" label={`${allModels.length} discovered`} />
              </div>
            }
          >
          <p className="text-sm text-muted-foreground">
            Manage which provider models are available in selection UIs.
          </p>

          <div className="mt-3 grid gap-2 md:grid-cols-[10rem_1fr_auto_auto]">
            <select
              value={catalogProviderFilter}
              onChange={(e) => setCatalogProviderFilter(e.target.value)}
              className="rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
            >
              <option value="all">All providers</option>
              {availableProviders.map((provider) => (
                <option key={`catalog:provider:${provider}`} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              placeholder="Search model name or key"
              className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
            />
            <button
              type="button"
              onClick={() => {
                fetchAllModels();
              }}
              disabled={allModelsLoading || Boolean(busyKey)}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
            >
              {allModelsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh catalog
            </button>
            <button
              type="button"
              onClick={() => {
                void scanModels();
              }}
              disabled={Boolean(busyKey)}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
            >
              {busyKey === "catalog:scan" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Scan providers
            </button>
          </div>

          {allModelsWarning && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              Catalog warning: {allModelsWarning}
            </p>
          )}

          <div className="mt-3 rounded-lg border border-border/70 bg-muted/15 p-2.5">
            <p className="text-xs text-muted-foreground">Allowed models</p>
            {configuredAllowed.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                No explicit allowlist in config yet.
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {configuredAllowed.map((entry) => (
                  <button
                    key={`allowlist:${entry}`}
                    type="button"
                    onClick={() => {
                      void removeAllowedModel(entry);
                    }}
                    disabled={Boolean(busyKey)}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
                  >
                    {getModelDisplayName(entry, allModels, aliases)}
                    <Trash2 className="h-3 w-3" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
            <select
              value={catalogModelToAdd}
              onChange={(e) => setCatalogModelToAdd(e.target.value)}
              className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
            >
              <option value="">Select a model from providers…</option>
              {catalogPreviewOptions.map((opt) => (
                <option key={`catalog:add:${opt.key}`} value={opt.key}>
                  {opt.name} · {opt.provider}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                void addAllowedModel(catalogModelToAdd);
              }}
              disabled={!catalogModelToAdd || Boolean(busyKey)}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>

          {filteredCatalogOptions.length > catalogPreviewOptions.length && (
            <p className="mt-1 text-xs text-muted-foreground">
              Showing first {catalogPreviewOptions.length} results. Narrow search to see fewer options.
            </p>
          )}

          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              type="text"
              value={customModelToAdd}
              onChange={(e) => setCustomModelToAdd(e.target.value)}
              placeholder="Custom model key (e.g. provider/name)"
              className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
            />
            <button
              type="button"
              onClick={() => {
                void addAllowedModel(customModelToAdd);
              }}
              disabled={!customModelToAdd.trim() || Boolean(busyKey)}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add custom
            </button>
          </div>
          </AdvancedSection>

          {/* Auth Order Override */}
          <AdvancedSection
            title="Auth Order Override"
            icon={ListOrdered}
            iconColor="text-cyan-500"
          >
          <p className="text-sm text-muted-foreground mb-3">
            Control which API key or auth profile is tried first when multiple credentials exist for the same provider.
          </p>

          <div className="rounded-lg border border-border/70 bg-muted/15 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground">Per-agent auth order override</p>
              {orderLoading ? (
                <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading order…
                </p>
              ) : (
                <StatusPill
                  tone={orderDraft.length > 0 ? "warn" : "neutral"}
                  label={orderDraft.length > 0 ? "override active" : "using default rotation"}
                />
              )}
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr]">
              <select
                value={orderAgentId}
                onChange={(e) => setOrderAgentId(e.target.value)}
                className="rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
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
                className="rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
              >
                {availableProviders.map((provider) => (
                  <option key={`order:provider:${provider}`} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
              <select
                value={orderSelectedProfileId}
                onChange={(e) => setOrderSelectedProfileId(e.target.value)}
                className="rounded-lg border border-border bg-muted/50 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
              >
                <option value="">Select profile id…</option>
                {selectedOrderAgentProfiles.map((profileId) => (
                  <option key={`order:profile:${profileId}`} value={profileId}>
                    {profileId}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  addOrderProfile(orderSelectedProfileId);
                }}
                disabled={!orderSelectedProfileId || orderBusy}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Add profile
              </button>
            </div>

            {orderError && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{orderError}</p>
            )}

            <div className="mt-2 space-y-1.5">
              {orderDraft.length === 0 ? (
                <p className="text-xs text-muted-foreground">
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
                onClick={() => {
                  void saveAuthOrder();
                }}
                disabled={orderBusy || orderDraft.length === 0}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
              >
                {orderBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListOrdered className="h-3.5 w-3.5" />}
                Save order
              </button>
              <button
                type="button"
                onClick={() => {
                  void clearAuthOrder();
                }}
                disabled={orderBusy}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
              >
                Clear override
              </button>
            </div>
          </div>
          </AdvancedSection>

          {/* Global Default & Fallback Chain */}
          <AdvancedSection
            title="Global Default & Fallback Chain"
            icon={Sparkles}
            iconColor="text-violet-400"
            badge={
              <StatusPill
                tone={defaultResolved === defaultPrimary ? "good" : "warn"}
                label={defaultResolved === defaultPrimary ? "resolves as configured" : "resolved to fallback now"}
              />
            }
          >
          <p className="text-sm text-muted-foreground">
            The global default model chain. Agents set to &quot;inherits default&quot; will use this configuration.
          </p>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-border p-2.5 bg-muted/20">
              <p className="uppercase tracking-wide text-muted-foreground text-xs">
                Saved default
              </p>
              <p className="mt-1 text-xs font-semibold text-foreground">
                {getModelDisplayName(defaultPrimary, models, aliases)}
              </p>
            </div>
            <div className="rounded-lg border border-border p-2.5 bg-muted/20">
              <p className="uppercase tracking-wide text-muted-foreground text-xs">
                Using now
              </p>
              <p className="mt-1 text-xs font-semibold text-foreground">
                {getModelDisplayName(defaultResolved, models, aliases)}
              </p>
            </div>
          </div>

          {mainHasOverride && (
            <p className="text-amber-700 dark:text-amber-300 mt-3 text-xs">
              Main agent has its own override. Reset main to defaults if you want this default
              model to apply there too.
            </p>
          )}

          <div className="mt-4 max-w-md">
            <ModelSelect
              value={defaultPrimary}
              options={selectableOptions(defaultPrimary)}
              disabled={Boolean(busyKey)}
              onSelect={(next) => {
                void changeDefaultModel(next);
              }}
            />
          </div>

          <div className="mt-3 rounded-lg border border-border/70 bg-muted/15 p-2.5">
            <p className="text-xs text-muted-foreground">Fallback chain</p>
            {defaultFallbacks.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                No fallback models configured.
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {defaultFallbacks.map((fallback) => (
                  <button
                    key={`defaults:fallback:${fallback}`}
                    type="button"
                    onClick={() => {
                      void removeDefaultFallback(fallback);
                    }}
                    disabled={Boolean(busyKey)}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
                  >
                    {getModelDisplayName(fallback, models, aliases)}
                    <Trash2 className="h-3 w-3" />
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value=""
                disabled={Boolean(busyKey) || globalFallbackCandidates.length === 0}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!next) return;
                  void addDefaultFallback(next);
                }}
                className="rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40 disabled:opacity-50"
              >
                <option value="">Add fallback model…</option>
                {globalFallbackCandidates.map((opt) => (
                  <option key={`defaults:candidate:${opt.key}`} value={opt.key}>
                    {opt.name} · {opt.provider}
                  </option>
                ))}
              </select>
            </div>
          </div>
          </AdvancedSection>

          {/* Model Aliases */}
          <AdvancedSection title="Model Aliases" icon={Tag} iconColor="text-amber-400">
            <p className="text-sm text-muted-foreground mb-3">
              Create short names for models. Use an alias anywhere you&apos;d use a full model key.
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
              <p className="text-xs text-muted-foreground mb-3">No aliases configured.</p>
            )}
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <input
                type="text"
                placeholder="Alias name (e.g. fast)"
                id="alias-name-input"
                className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
              />
              <select
                id="alias-target-select"
                className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/40"
              >
                <option value="">Target model…</option>
                {allModelOptions.filter((opt) => opt.ready || opt.authConnected).map((opt) => (
                  <option key={`alias:target:${opt.key}`} value={opt.key}>
                    {opt.name} · {opt.provider}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const nameInput = document.getElementById("alias-name-input") as HTMLInputElement;
                  const targetSelect = document.getElementById("alias-target-select") as HTMLSelectElement;
                  const alias = nameInput?.value?.trim();
                  const model = targetSelect?.value;
                  if (!alias || !model) return;
                  void runAction(
                    { action: "set-alias", alias, model },
                    `Alias "${alias}" created`,
                    `alias:set:${alias}`,
                    { restart: false },
                  );
                  if (nameInput) nameInput.value = "";
                  if (targetSelect) targetSelect.value = "";
                }}
                disabled={Boolean(busyKey)}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Add alias
              </button>
            </div>
          </AdvancedSection>

          {/* Model Availability */}
          <AdvancedSection
            title="Model Availability"
            icon={Check}
            iconColor="text-emerald-400"
            badge={
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusPill tone="good" label={`${availableModels.length} ready`} />
                <StatusPill tone="warn" label={`${lockedModels.length} need auth`} />
              </div>
            }
          >
          <p className="text-sm text-muted-foreground">
            All discovered models with their current auth and readiness status.
          </p>

          {providerAuthSummary.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">Provider auth status</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {providerAuthSummary.map((provider) => (
                  <StatusPill
                    key={provider.provider}
                    tone={provider.connected ? "good" : "warn"}
                    label={`${getProviderDisplayName(provider.provider)} · ${
                      provider.connected
                        ? provider.authKind || provider.oauthStatus || "connected"
                        : "missing"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {modelOptions.map((opt) => {
              const tone: "good" | "warn" | "neutral" | "info" = !opt.known
                ? "neutral"
                : opt.local || opt.ready
                  ? "good"
                  : opt.authConnected
                    ? "info"
                    : "warn";
              const statusLabel = !opt.known
                ? "custom"
                : opt.local
                  ? "local"
                  : opt.ready
                    ? "ready"
                    : opt.authConnected
                      ? "auth ok"
                      : "sign in required";
              return (
                <StatusPill
                  key={opt.key}
                  tone={tone}
                  label={`${opt.name} · ${opt.provider} · ${statusLabel}`}
                />
              );
            })}
          </div>
          </AdvancedSection>

          {/* Model Credentials & Auth Stores */}
          <AdvancedSection
            title="Model Credentials & Auth Stores"
            icon={KeyRound}
            iconColor="text-cyan-500"
          >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <StatusPill
                tone={modelCredentialSummary.sourceOfTruth ? "good" : "warn"}
                label={modelCredentialSummary.sourceOfTruth ? "gateway source-of-truth" : "partial"}
              />
            </div>
            <button
              type="button"
              onClick={() => setRevealModelSecrets((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              {revealModelSecrets ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {revealModelSecrets ? "Hide values" : "Reveal values"}
            </button>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            Unified model auth inventory: provider auth, env-backed model keys, and auth profile stores.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <StatusPill tone="good" label={`provider access ${modelCredentialSummary.connected}/${modelCredentialSummary.total}`} />
            <StatusPill tone="info" label={`auth profiles ${modelCredentialSummary.profiles}`} />
            <StatusPill tone="neutral" label={`${modelAuthByAgent.length} agents`} />
          </div>

          {modelCredsError && (
            <p className="text-amber-700 dark:text-amber-300 mt-3 text-xs">
              Could not load model credential details: {modelCredsError}
            </p>
          )}

          <div className="mt-4 space-y-3">
            {modelAuthByAgent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No model auth rows found.</p>
            ) : (
              modelAuthByAgent.map((row) => (
                <div key={row.agentId} className="rounded-xl border border-border/70 bg-card/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">
                      {agentNameById.get(row.agentId) || row.agentId}
                      <span className="ml-1 text-xs text-muted-foreground">({row.agentId})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      store: <code>{row.storePath || "n/a"}</code>
                    </p>
                  </div>
                  <div className="mt-2 space-y-2">
                    {row.providers.map((provider) => (
                      <div
                        key={`${row.agentId}:${provider.provider}`}
                        className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-foreground">{provider.provider}</p>
                          <StatusPill
                            tone={provider.connected ? "good" : "warn"}
                            label={
                              provider.connected
                                ? `${provider.effectiveKind || "connected"}${provider.effectiveDetail ? ` · ${provider.effectiveDetail}` : ""}`
                                : "missing"
                            }
                          />
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          profiles={provider.profileCount} oauth={provider.oauthCount} token={provider.tokenCount} apiKey={provider.apiKeyCount}
                        </p>
                        {provider.envValue ? (
                          <p className="mt-1 break-all text-muted-foreground">
                            env: <code>{provider.envSource || "unknown"}</code> ={" "}
                            <code>{renderSecret(provider.envValue, revealModelSecrets, false)}</code>
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {row.unusableProfiles.length > 0 && (
                    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
                      {row.unusableProfiles.map((u) => (
                        <p key={`${row.agentId}:${u.profileId}`}>
                          {u.profileId} ({u.provider}) · {u.kind} · {formatDuration(u.remainingMs)} remaining
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-4 space-y-3">
            <h3 className="text-xs font-semibold text-foreground">Auth Profile Stores</h3>
            {agentAuthProfiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No auth profile stores discovered.</p>
            ) : (
              agentAuthProfiles.map((agentRow) => (
                <div key={agentRow.agentId} className="rounded-xl border border-border/70 bg-card/50 p-3">
                  <p className="text-xs text-muted-foreground">
                    {agentNameById.get(agentRow.agentId) || agentRow.agentId} · <code>{agentRow.path}</code>
                  </p>
                  {!agentRow.exists ? (
                    <p className="mt-2 text-xs text-amber-300">auth-profiles.json not found.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {agentRow.profiles.map((profile) => (
                        <div
                          key={`${agentRow.agentId}:${profile.id}`}
                          className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium text-foreground">
                              {profile.id} ({profile.provider}/{profile.type})
                            </p>
                            <p className="text-muted-foreground">
                              expires {profile.expiresAt ? formatAgo(profile.expiresAt) : "n/a"}
                            </p>
                          </div>
                          <p className="mt-1 text-muted-foreground">
                            accountId={profile.accountId || "n/a"} · lastUsed={formatAgo(profile.usage.lastUsed)} · errors={profile.usage.errorCount ?? 0}
                          </p>
                          {profile.secretFields.length > 0 && (
                            <div className="mt-1 space-y-1">
                              {profile.secretFields.map((field) => (
                                <p key={`${profile.id}:${field.key}`} className="break-all text-muted-foreground">
                                  {field.key}: <code>{renderSecret(field.value, revealModelSecrets, field.redacted)}</code>
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          </AdvancedSection>
        </div>
      </SectionBody>

      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-xl backdrop-blur-sm",
            toast.type === "success"
              ? "border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
              : "border-red-500/25 bg-red-500/12 text-red-700 dark:text-red-300"
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
