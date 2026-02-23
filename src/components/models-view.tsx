"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Eye,
  EyeOff,
  Heart,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { requestRestart } from "@/lib/restart-store";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/ui/loading-state";
import { ApiWarningBadge } from "@/components/ui/api-warning-badge";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";

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

export function ModelsView() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [defaults, setDefaults] = useState<DefaultsModelConfig | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((message: string, type: "success" | "error") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
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

  const runAction = useCallback(
    async (body: Record<string, unknown>, successMsg: string, key: string) => {
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
            const res = await fetch("/api/models", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const data = await res.json();
            if (data.error) {
              const msg = String(data.error);
              if (isTransient(msg) && attempt < maxAttempts) {
                await sleep(900 * attempt);
                continue;
              }
              flash(msg, "error");
              return;
            }

            flash(successMsg, "success");
            requestRestart("Model configuration was updated.");
            await fetchModels();
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
    [fetchModels, flash]
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

  const optionMap = useMemo(() => {
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

  const modelOptions = useMemo(() => {
    return [...optionMap.values()].sort((a, b) => {
      const aReady = a.ready || a.local ? 0 : 1;
      const bReady = b.ready || b.local ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      return a.name.localeCompare(b.name);
    });
  }, [optionMap]);

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
    return [empty, ...modelOptions];
  }, [modelOptions]);

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
      return modelOptions.filter(
        (opt) => opt.ready || opt.local || opt.authConnected || opt.key === currentKey
      );
    },
    [modelOptions]
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

  return (
    <SectionLayout>
      <SectionHeader
        title="Models"
        description="See and switch each agent's model — saved, in-use, and last session."
        actions={
          <div className="flex items-center gap-2">
            <ApiWarningBadge warning={apiWarning} degraded={apiDegraded} />
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                fetchModels();
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
        <section className="rounded-2xl border border-border p-4 md:p-5 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-cyan-400" />
              <h2 className="text-xs font-semibold text-foreground">Agent Models</h2>
            </div>
            {mainHasOverride && (
              <StatusPill tone="warn" label="Main uses an explicit override" />
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Changes save immediately to <code>openclaw.json</code>. &quot;Using now&quot; comes
            from <code>openclaw models status --agent</code>.
          </p>

          {mainAgent && (
            <div className="mt-4 rounded-xl border border-cyan-500/25 bg-cyan-500/8 p-3">
              <p className="uppercase tracking-wide text-muted-foreground text-xs text-cyan-700 dark:text-cyan-300">
                Main Agent Using Now
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-foreground">
                  {getModelDisplayName(mainResolved, models, aliases)}
                </p>
                <StatusPill
                  tone={mainHasOverride ? "warn" : "good"}
                  label={mainHasOverride ? "source: main override" : "source: global default"}
                />
              </div>
              {mainLive && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last session: {getModelDisplayName(mainLive, models, aliases)}
                </p>
              )}
            </div>
          )}

          <div className="mt-4 space-y-3">
            {sortedAgents.map((agent) => {
              const configured = agent.modelPrimary || defaultPrimary;
              const runtime = agentStatuses[agent.id];
              const resolved = runtime?.resolvedDefault || runtime?.defaultModel || configured;
              const live = liveModels[agent.id] || null;
              const lastSession = live?.fullModel || null;

              const fallbackActive = resolved !== configured;
              const sessionLag = Boolean(lastSession && lastSession !== resolved);
              const rowBusy = busyKey === `agent:${agent.id}` || busyKey === `reset:${agent.id}`;

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
        </section>

        <section className="rounded-2xl border border-border p-4 md:p-5 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <h2 className="text-xs font-semibold text-foreground">Global Default</h2>
            </div>
            <StatusPill
              tone={defaultResolved === defaultPrimary ? "good" : "warn"}
              label={defaultResolved === defaultPrimary ? "resolves as configured" : "resolved to fallback now"}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Saved at <code>agents.defaults.model</code> in <code>openclaw.json</code>. Agents
            set to &quot;inherits default&quot; will use this model chain.
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
        </section>

        <section className="rounded-2xl border border-border p-4 md:p-5 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-400" />
              <h2 className="text-xs font-semibold text-foreground">Heartbeat</h2>
            </div>
            {heartbeat?.model ? (
              <StatusPill tone="good" label="Configured" />
            ) : (
              <StatusPill tone="neutral" label="Not set" />
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Model and interval for <code>agents.defaults.heartbeat</code>. Used for periodic
            system heartbeat runs.
          </p>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-border p-2.5 bg-muted/20">
              <p className="uppercase tracking-wide text-muted-foreground text-xs">
                Model
              </p>
              <p className="mt-1 text-xs font-semibold text-foreground">
                {heartbeat?.model
                  ? getModelDisplayName(heartbeat.model, models, aliases)
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-border p-2.5 bg-muted/20">
              <p className="uppercase tracking-wide text-muted-foreground text-xs">
                Interval
              </p>
              <p className="mt-1 text-xs font-semibold text-foreground">
                {heartbeat?.every || "—"}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full max-w-md">
              <label className="mb-1 block text-xs text-muted-foreground">Heartbeat model</label>
              <ModelSelect
                value={heartbeat?.model ?? ""}
                options={heartbeatModelOptions}
                disabled={Boolean(busyKey)}
                onSelect={(next) => {
                  void changeHeartbeat({ model: next, every: heartbeat?.every ?? "1h" });
                }}
              />
            </div>
            <div className="w-full max-w-[8rem]">
              <label className="mb-1 block text-xs text-muted-foreground">Interval</label>
              <select
                value={heartbeat?.every ?? "1h"}
                disabled={Boolean(busyKey)}
                onChange={(e) => {
                  const every = e.target.value;
                  void changeHeartbeat({
                    model: heartbeat?.model ?? "",
                    every,
                  });
                }}
                className="rounded-lg border border-border bg-muted/50 w-full px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-cyan-500/40 disabled:opacity-50"
              >
                <option value="15m">15m</option>
                <option value="30m">30m</option>
                <option value="1h">1h</option>
                <option value="2h">2h</option>
                <option value="4h">4h</option>
              </select>
            </div>
            {busyKey === "heartbeat" && (
              <p className="text-cyan-700 dark:text-cyan-300 text-xs self-center">Applying...</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border p-4 md:p-5 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold text-foreground">Model Availability</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusPill tone="good" label={`${availableModels.length} ready`} />
              <StatusPill
                tone="info"
                label={`${authConnectedButLimitedModels.length} auth ok (limited)`}
              />
              <StatusPill tone="warn" label={`${lockedModels.length} sign in required`} />
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Auth labels come from <code>openclaw models status --json</code> provider auth and
            OAuth profiles, not only from <code>models list</code>.
          </p>

          {providerAuthSummary.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">Provider auth status</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {providerAuthSummary.map((provider) => (
                  <StatusPill
                    key={provider.provider}
                    tone={provider.connected ? "good" : "warn"}
                    label={`${provider.provider} · ${
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
        </section>

        <section className="rounded-2xl border border-border p-4 md:p-5 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold text-foreground">
              Model Credentials & Auth Stores
            </h2>
            <div className="flex items-center gap-2">
              <StatusPill
                tone={modelCredentialSummary.sourceOfTruth ? "good" : "warn"}
                label={modelCredentialSummary.sourceOfTruth ? "gateway source-of-truth" : "partial"}
              />
              <button
                type="button"
                onClick={() => setRevealModelSecrets((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              >
                {revealModelSecrets ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {revealModelSecrets ? "Hide values" : "Reveal values"}
              </button>
            </div>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            Unified model auth inventory (moved from Accounts & Keys): provider auth, env-backed model keys, and auth profile stores.
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
        </section>
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
