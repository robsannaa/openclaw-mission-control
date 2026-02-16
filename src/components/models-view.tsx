"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bot, Check, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { requestRestart } from "@/lib/restart-store";
import { cn } from "@/lib/utils";

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
};

type DefaultsModelConfig = {
  primary: string;
  fallbacks: string[];
};

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
      return "bg-emerald-500/12 text-emerald-300 border-emerald-500/25";
    case "warn":
      return "bg-amber-500/12 text-amber-300 border-amber-500/25";
    case "info":
      return "bg-cyan-500/12 text-cyan-300 border-cyan-500/25";
    default:
      return "bg-foreground/[0.04] text-muted-foreground border-foreground/[0.08]";
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
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium",
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
      className="w-full min-w-[16rem] rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2 text-[12px] text-foreground/90 outline-none transition-colors focus:border-cyan-500/40 disabled:opacity-50"
    >
      {options.map((opt) => {
        const status = opt.local
          ? "local"
          : opt.available
            ? "ready"
            : "needs auth";
        const suffix = opt.known ? status : "custom";
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
    } catch (err) {
      console.warn("Failed to fetch models:", err);
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

  const optionMap = useMemo(() => {
    const map = new Map<string, ModelOption>();

    for (const model of models) {
      map.set(model.key, {
        key: model.key,
        name: model.name || modelNameFromKey(model.key),
        provider: modelProvider(model.key),
        available: Boolean(model.available),
        local: Boolean(model.local),
        known: true,
      });
    }

    const ensure = (key: string | null | undefined) => {
      if (!key || map.has(key)) return;
      map.set(key, {
        key,
        name: modelNameFromKey(key),
        provider: modelProvider(key),
        available: true,
        local: false,
        known: false,
      });
    };

    ensure(defaultPrimary);
    ensure(defaultResolved);

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
  }, [agents, agentStatuses, defaultPrimary, defaultResolved, liveModels, models]);

  const modelOptions = useMemo(() => {
    return [...optionMap.values()].sort((a, b) => {
      const aReady = a.available || a.local ? 0 : 1;
      const bReady = b.available || b.local ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      return a.name.localeCompare(b.name);
    });
  }, [optionMap]);

  const availableModels = useMemo(
    () => modelOptions.filter((m) => m.available || m.local),
    [modelOptions]
  );
  const lockedModels = useMemo(
    () => modelOptions.filter((m) => !m.available && !m.local),
    [modelOptions]
  );

  const selectableOptions = useCallback(
    (currentKey: string) => {
      return modelOptions.filter(
        (opt) => opt.available || opt.local || opt.key === currentKey
      );
    },
    [modelOptions]
  );

  const mainAgent = agents.find((agent) => agent.id === "main") || null;
  const mainHasOverride = Boolean(mainAgent && !mainAgent.usesDefaults);

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

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground/70" />
        <span className="ml-2 text-sm text-muted-foreground">Loading models...</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-400">
        Failed to load model configuration
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-foreground/[0.06] px-4 py-4 md:px-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Models</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            One place to see and switch the model used by each agent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            fetchModels();
          }}
          disabled={Boolean(busyKey)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", busyKey && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <section className="rounded-2xl border border-foreground/[0.08] bg-foreground/[0.02] p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-cyan-400" />
                <h2 className="text-[15px] font-semibold text-foreground">Agent Models</h2>
              </div>
              {mainHasOverride && (
                <StatusPill
                  tone="warn"
                  label="Main has override (defaults do not apply)"
                />
              )}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Configured is what is saved. Resolved now is what OpenClaw will pick now.
              Last session is what the latest session actually used.
            </p>

            <div className="mt-4 space-y-3">
              {sortedAgents.map((agent) => {
                const configured = agent.modelPrimary || defaultPrimary;
                const runtime = agentStatuses[agent.id];
                const resolved =
                  runtime?.resolvedDefault || runtime?.defaultModel || configured;
                const live = liveModels[agent.id] || null;
                const lastSession = live?.fullModel || null;

                const fallbackActive = resolved !== configured;
                const sessionLag = Boolean(lastSession && lastSession !== resolved);
                const rowBusy =
                  busyKey === `agent:${agent.id}` || busyKey === `reset:${agent.id}`;

                return (
                  <div
                    key={agent.id}
                    className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] p-3"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold text-foreground/95">
                            {agent.name}
                          </span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {agent.id}
                          </span>
                          <StatusPill
                            tone={agent.usesDefaults ? "neutral" : "warn"}
                            label={agent.usesDefaults ? "uses defaults" : "override"}
                          />
                          {fallbackActive && (
                            <StatusPill tone="warn" label="fallback active" />
                          )}
                          {sessionLag && (
                            <StatusPill tone="warn" label="session still old" />
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <StatusPill
                            label={`configured: ${getModelDisplayName(
                              configured,
                              models,
                              aliases
                            )}`}
                          />
                          <StatusPill
                            tone={fallbackActive ? "warn" : "good"}
                            label={`resolved now: ${getModelDisplayName(
                              resolved,
                              models,
                              aliases
                            )}`}
                          />
                          {lastSession && (
                            <StatusPill
                              tone={sessionLag ? "warn" : "info"}
                              label={`last session: ${getModelDisplayName(
                                lastSession,
                                models,
                                aliases
                              )} · ${formatAgo(live?.updatedAt ?? null)}`}
                            />
                          )}
                        </div>

                        {fallbackActive && (
                          <p className="mt-2 text-[11px] text-amber-300/90">
                            OpenClaw is currently resolving this agent to a fallback model.
                          </p>
                        )}
                        {sessionLag && (
                          <p className="mt-1 text-[11px] text-amber-300/90">
                            Latest session still shows the previous model. Start a new turn/session to confirm the new model in replies.
                          </p>
                        )}
                      </div>

                      <div className="flex w-full max-w-[26rem] shrink-0 flex-col gap-2">
                        <ModelSelect
                          value={configured}
                          options={selectableOptions(configured)}
                          disabled={Boolean(busyKey)}
                          onSelect={(next) => {
                            void changeAgentModel(agent, next);
                          }}
                        />
                        {!agent.usesDefaults && (
                          <button
                            type="button"
                            onClick={() => {
                              void resetAgentToDefaults(agent);
                            }}
                            disabled={Boolean(busyKey)}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] disabled:opacity-40"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Use defaults
                          </button>
                        )}
                        {rowBusy && (
                          <p className="text-[10px] text-cyan-300/90">Applying...</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-foreground/[0.08] bg-foreground/[0.02] p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <h2 className="text-[15px] font-semibold text-foreground">Global Default</h2>
              </div>
              <StatusPill
                tone={defaultResolved === defaultPrimary ? "good" : "warn"}
                label={`resolved now: ${getModelDisplayName(
                  defaultResolved,
                  models,
                  aliases
                )}`}
              />
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Used only by agents set to Use defaults.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <StatusPill
                label={`configured: ${getModelDisplayName(
                  defaultPrimary,
                  models,
                  aliases
                )}`}
              />
              {mainHasOverride && (
                <StatusPill
                  tone="warn"
                  label="main is on override; reset main to use this"
                />
              )}
            </div>

            <div className="mt-4 max-w-[26rem]">
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

          <section className="rounded-2xl border border-foreground/[0.08] bg-foreground/[0.02] p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-foreground">Model Availability</h2>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <StatusPill tone="good" label={`${availableModels.length} ready`} />
                <StatusPill tone="warn" label={`${lockedModels.length} need auth`} />
              </div>
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Agent selectors only show models that are ready for this instance (plus currently configured custom refs).
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {modelOptions.map((opt) => {
                const tone: "good" | "warn" | "neutral" = opt.local || opt.available
                  ? "good"
                  : opt.known
                    ? "warn"
                    : "neutral";
                return (
                  <StatusPill
                    key={opt.key}
                    tone={tone}
                    label={`${opt.name} · ${opt.provider}`}
                  />
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12px] shadow-xl backdrop-blur-sm",
            toast.type === "success"
              ? "border-emerald-500/25 bg-emerald-500/12 text-emerald-300"
              : "border-red-500/25 bg-red-500/12 text-red-300"
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
