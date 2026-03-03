"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getModelMeta,
  getFriendlyModelName,
  getProviderDisplayName,
  PROVIDER_INFO,
} from "@/lib/model-metadata";

export type ModelOption = {
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

type ModelPickerProps = {
  models: ModelOption[];
  currentModel?: string;
  excludeModels?: string[];
  onSelect: (fullModel: string) => void;
  onConnectProvider?: (provider: string) => void;
  connectableProviders?: string[];
  onClose: () => void;
  title?: string;
};

type ModelRoute = ModelOption & {
  familyId: string;
  familyName: string;
  familyDescription: string | null;
  familyContextWindow: string | null;
  familyPriceTier: string | null;
  preferredProvider: string;
};

type ModelFamily = {
  id: string;
  name: string;
  description: string | null;
  contextWindow: string | null;
  priceTier: string | null;
  preferredProvider: string;
  routes: ModelRoute[];
  totalRoutes: number;
  readyCount: number;
  hasCurrent: boolean;
};

const LOCAL_PROVIDERS = new Set(["ollama", "vllm", "lmstudio"]);

function splitModelKey(key: string): { provider: string; model: string } {
  const slash = key.indexOf("/");
  if (slash < 0) {
    return { provider: "custom", model: key };
  }
  return {
    provider: key.slice(0, slash),
    model: key.slice(slash + 1),
  };
}

function getOpenRouterUpstreamKey(key: string): string | null {
  if (!key.startsWith("openrouter/")) return null;
  const rest = key.slice("openrouter/".length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  return rest;
}

function normalizeFamilyKey(key: string): string {
  const upstreamKey = getOpenRouterUpstreamKey(key);
  const canonicalKey = upstreamKey || key;
  const { provider, model } = splitModelKey(canonicalKey);
  return `${provider}/${model.replace(/-\d{8}$/, "")}`.toLowerCase();
}

function getFamilyDetails(key: string) {
  const upstreamKey = getOpenRouterUpstreamKey(key);
  const canonicalKey = upstreamKey || key;
  const canonicalMeta = getModelMeta(canonicalKey);
  const routeMeta = getModelMeta(key);
  const meta = canonicalMeta || routeMeta;
  const name = (meta?.displayName || getFriendlyModelName(canonicalKey)).replace(
    /\s+\(via [^)]+\)$/i,
    "",
  );
  const { provider } = splitModelKey(canonicalKey);
  return {
    id: normalizeFamilyKey(key),
    name,
    description: meta?.description || null,
    contextWindow: meta?.contextWindow || null,
    priceTier: meta?.priceTier || null,
    preferredProvider: meta?.provider || provider,
  };
}

function routeMatchesSearch(route: ModelRoute, query: string): boolean {
  if (!query) return true;
  const meta = getModelMeta(route.key);
  return (
    route.name.toLowerCase().includes(query) ||
    route.key.toLowerCase().includes(query) ||
    route.provider.toLowerCase().includes(query) ||
    getProviderDisplayName(route.provider).toLowerCase().includes(query) ||
    (meta?.displayName?.toLowerCase().includes(query) ?? false) ||
    (meta?.description?.toLowerCase().includes(query) ?? false)
  );
}

function familyMatchesSearch(family: ModelFamily, query: string): boolean {
  if (!query) return true;
  return (
    family.name.toLowerCase().includes(query) ||
    (family.description?.toLowerCase().includes(query) ?? false)
  );
}

function sortRoutes(
  routes: ModelRoute[],
  currentModel: string | undefined,
  preferredProvider: string,
) {
  return [...routes].sort((a, b) => {
    if (a.key === currentModel) return -1;
    if (b.key === currentModel) return 1;
    const aReady = a.local || a.ready ? 0 : a.authConnected ? 1 : 2;
    const bReady = b.local || b.ready ? 0 : b.authConnected ? 1 : 2;
    if (aReady !== bReady) return aReady - bReady;
    const aPreferred =
      a.provider === preferredProvider ? 0 : a.provider === "openrouter" ? 1 : 2;
    const bPreferred =
      b.provider === preferredProvider ? 0 : b.provider === "openrouter" ? 1 : 2;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    return getProviderDisplayName(a.provider).localeCompare(
      getProviderDisplayName(b.provider),
    );
  });
}

function getRouteStatus(route: ModelRoute) {
  if (route.local) {
    return { label: "Local", tone: "good" as const };
  }
  if (route.ready) {
    return { label: "Ready", tone: "good" as const };
  }
  if (route.authConnected) {
    return { label: "Provider connected", tone: "neutral" as const };
  }
  return { label: "Needs key", tone: "warn" as const };
}

export function ModelPicker({
  models,
  currentModel,
  excludeModels,
  onSelect,
  onConnectProvider,
  connectableProviders,
  onClose,
  title = "Choose Model",
}: ModelPickerProps) {
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [focusIndex, setFocusIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus search input on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Available models after excluding
  const excludeSet = useMemo(
    () => new Set(excludeModels || []),
    [excludeModels],
  );

  const connectableProviderSet = useMemo(
    () => new Set(connectableProviders || []),
    [connectableProviders],
  );

  const groupedFamilies = useMemo(() => {
    const query = search.trim().toLowerCase();
    const familyMap = new Map<string, ModelFamily>();

    for (const model of models) {
      if (excludeSet.has(model.key)) continue;
      const details = getFamilyDetails(model.key);
      const route: ModelRoute = {
        ...model,
        familyId: details.id,
        familyName: details.name,
        familyDescription: details.description,
        familyContextWindow: details.contextWindow,
        familyPriceTier: details.priceTier,
        preferredProvider: details.preferredProvider,
      };

      const current = familyMap.get(details.id);
      if (current) {
        current.routes.push(route);
        continue;
      }

      familyMap.set(details.id, {
        id: details.id,
        name: details.name,
        description: details.description,
        contextWindow: details.contextWindow,
        priceTier: details.priceTier,
        preferredProvider: details.preferredProvider,
        routes: [route],
        totalRoutes: 0,
        readyCount: 0,
        hasCurrent: false,
      });
    }

    return [...familyMap.values()]
      .map((family) => {
        const providerMatchedRoutes = family.routes.filter((route) => {
          if (providerFilter === "all") return true;
          return route.provider === providerFilter;
        });

        const familyQueryMatch = familyMatchesSearch(family, query);
        const visibleRoutes = providerMatchedRoutes.filter((route) =>
          familyQueryMatch ? true : routeMatchesSearch(route, query),
        );
        if (!visibleRoutes.length) return null;

        const sortedRoutes = sortRoutes(
          visibleRoutes,
          currentModel,
          family.preferredProvider,
        );
        return {
          ...family,
          routes: sortedRoutes,
          totalRoutes: providerMatchedRoutes.length,
          readyCount: providerMatchedRoutes.filter((route) => route.local || route.ready).length,
          hasCurrent: sortedRoutes.some((route) => route.key === currentModel),
        };
      })
      .filter((family): family is ModelFamily => Boolean(family))
      .sort((a, b) => {
        if (a.hasCurrent) return -1;
        if (b.hasCurrent) return 1;
        const aReady = a.readyCount > 0 ? 0 : 1;
        const bReady = b.readyCount > 0 ? 0 : 1;
        if (aReady !== bReady) return aReady - bReady;
        return a.name.localeCompare(b.name);
      });
  }, [models, excludeSet, providerFilter, search, currentModel]);

  const filteredRoutes = useMemo(
    () => groupedFamilies.flatMap((family) => family.routes),
    [groupedFamilies],
  );

  // Provider chips
  const providerChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of models) {
      if (excludeSet.has(m.key)) continue;
      counts.set(m.provider, (counts.get(m.provider) || 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, count]) => ({ provider, count }));
  }, [models, excludeSet]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, filteredRoutes.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && focusIndex >= 0) {
        e.preventDefault();
        const model = filteredRoutes[focusIndex];
        if (model) onSelect(model.key);
      }
    },
    [filteredRoutes, focusIndex, onClose, onSelect],
  );

  // Scroll focused item into view
  useEffect(() => {
    if (focusIndex < 0) return;
    const el = listRef.current?.querySelector(
      `[data-index="${focusIndex}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  // Reset focus index when filter changes
  useEffect(() => {
    setFocusIndex(-1);
  }, [search, providerFilter]);

  // Flat index tracker across groups
  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 flex max-h-[75vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Pick the model first, then choose which provider route should power it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search model families, providers, or route ids..."
              className="w-full rounded-md border border-border bg-muted/40 py-2.5 pl-10 pr-4 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-cyan-500/40"
            />
          </div>

          {/* Provider chips */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setProviderFilter("all")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                providerFilter === "all"
                  ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                  : "bg-card text-muted-foreground border border-border hover:bg-accent hover:text-foreground",
              )}
            >
              All
            </button>
            {providerChips.map(({ provider, count }) => (
              <button
                key={provider}
                type="button"
                onClick={() =>
                  setProviderFilter(
                    providerFilter === provider ? "all" : provider,
                  )
                }
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  providerFilter === provider
                    ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                    : "bg-card text-muted-foreground border border-border hover:bg-accent hover:text-foreground",
                )}
              >
                {PROVIDER_INFO[provider]?.displayName ||
                  getProviderDisplayName(provider)}{" "}
                <span className="opacity-50">({count})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Model list */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {groupedFamilies.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No models match your search.
            </div>
          ) : (
            groupedFamilies.map((family) => (
              <div
                key={family.id}
                className={cn(
                  "mb-3 rounded-xl border p-3",
                  family.hasCurrent
                    ? "border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)]"
                    : "border-border bg-card/70",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        {family.name}
                      </h3>
                      {family.hasCurrent && (
                        <span className="rounded-md border border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-brand-text)]">
                          Current route
                        </span>
                      )}
                    </div>
                    {family.description && (
                      <p className="mt-1 text-xs text-muted-foreground/75">
                        {family.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/60">
                      {family.priceTier && <span>{family.priceTier}</span>}
                      {family.contextWindow && <span>{family.contextWindow} context</span>}
                      <span>
                        {family.totalRoutes} route{family.totalRoutes === 1 ? "" : "s"}
                      </span>
                      <span>
                        {family.readyCount} ready now
                      </span>
                    </div>
                  </div>
                  <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Prefer {getProviderDisplayName(family.preferredProvider)}
                  </span>
                </div>

                <div className="mt-3 grid gap-2">
                  {family.routes.map((route) => {
                    flatIndex++;
                    const isCurrent = route.key === currentModel;
                    const isFocused = flatIndex === focusIndex;
                    const currentFlatIndex = flatIndex;
                    const status = getRouteStatus(route);
                    const canConnect =
                      !route.ready &&
                      !route.local &&
                      !route.authConnected &&
                      connectableProviderSet.has(route.provider) &&
                      !LOCAL_PROVIDERS.has(route.provider) &&
                      typeof onConnectProvider === "function";

                    return (
                      <div
                        key={route.key}
                        className={cn(
                          "flex items-start gap-3 rounded-xl border p-1",
                          isCurrent &&
                            "border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)]",
                          !isCurrent && isFocused && "border-border bg-accent",
                          !isCurrent && !isFocused && "border-border/70 bg-muted/10",
                        )}
                      >
                        <button
                          type="button"
                          data-index={currentFlatIndex}
                          onClick={() => onSelect(route.key)}
                          className={cn(
                            "flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                            !isCurrent && "hover:bg-accent/70",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {getProviderDisplayName(route.provider)}
                              </span>
                              {route.provider === family.preferredProvider && (
                                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  Direct
                                </span>
                              )}
                              <span
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                                  status.tone === "good" &&
                                    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
                                  status.tone === "warn" &&
                                    "bg-amber-500/15 text-amber-600 dark:text-amber-300",
                                  status.tone === "neutral" &&
                                    "bg-muted text-muted-foreground",
                                )}
                              >
                                {status.label}
                              </span>
                              {isCurrent && (
                                <span className="rounded-md bg-[var(--accent-brand)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-brand-text)]">
                                  Selected
                                </span>
                              )}
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/60">
                              <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground/70">
                                {route.key}
                              </code>
                              {route.authKind && !route.local && (
                                <span>via {route.authKind}</span>
                              )}
                            </div>
                          </div>
                        </button>

                        {canConnect && (
                          <button
                            type="button"
                            onClick={() => {
                              onConnectProvider?.(route.provider);
                              onClose();
                            }}
                            className="shrink-0 self-center rounded-lg border border-[var(--accent-brand-border)] bg-card px-2.5 py-1.5 text-[11px] font-medium text-[var(--accent-brand-text)] transition-colors hover:bg-[var(--accent-brand-subtle)]"
                          >
                            Connect
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground/50">
            {groupedFamilies.length} model famil
            {groupedFamilies.length === 1 ? "y" : "ies"} · {filteredRoutes.length} provider route
            {filteredRoutes.length === 1 ? "" : "s"}
            {search && ` matching "${search}"`}
          </p>
        </div>
      </div>
    </div>
  );
}
