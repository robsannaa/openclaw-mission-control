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
  onClose: () => void;
  title?: string;
};

export function ModelPicker({
  models,
  currentModel,
  excludeModels,
  onSelect,
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

  const filteredModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    return models
      .filter((m) => !excludeSet.has(m.key))
      .filter((m) => {
        if (providerFilter !== "all" && m.provider !== providerFilter)
          return false;
        if (!query) return true;
        const meta = getModelMeta(m.key);
        return (
          m.name.toLowerCase().includes(query) ||
          m.key.toLowerCase().includes(query) ||
          m.provider.toLowerCase().includes(query) ||
          (meta?.displayName?.toLowerCase().includes(query) ?? false) ||
          (meta?.description?.toLowerCase().includes(query) ?? false)
        );
      })
      .sort((a, b) => {
        // Current model first
        if (a.key === currentModel) return -1;
        if (b.key === currentModel) return 1;
        // Ready before not ready
        const aReady = a.ready || a.local ? 0 : 1;
        const bReady = b.ready || b.local ? 0 : 1;
        if (aReady !== bReady) return aReady - bReady;
        // Group by provider
        if (a.provider !== b.provider)
          return a.provider.localeCompare(b.provider);
        return a.name.localeCompare(b.name);
      });
  }, [models, excludeSet, providerFilter, search, currentModel]);

  // Group by provider for section headers
  const groupedModels = useMemo(() => {
    const groups: { provider: string; models: ModelOption[] }[] = [];
    let current: { provider: string; models: ModelOption[] } | null = null;
    for (const m of filteredModels) {
      if (!current || current.provider !== m.provider) {
        current = { provider: m.provider, models: [] };
        groups.push(current);
      }
      current.models.push(m);
    }
    return groups;
  }, [filteredModels]);

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
        setFocusIndex((i) => Math.min(i + 1, filteredModels.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && focusIndex >= 0) {
        e.preventDefault();
        const model = filteredModels[focusIndex];
        if (model) onSelect(model.key);
      }
    },
    [filteredModels, focusIndex, onClose, onSelect],
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
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
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
              placeholder="Search models by name, provider, or description..."
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
          {filteredModels.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No models match your search.
            </div>
          ) : (
            groupedModels.map((group, groupIdx) => (
              <div key={`${group.provider}:${groupIdx}`} className="mb-1">
                <div className="sticky top-0 z-10 bg-card px-3 py-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {getProviderDisplayName(group.provider)}
                  </p>
                </div>
                {group.models.map((model) => {
                  flatIndex++;
                  const meta = getModelMeta(model.key);
                  const isCurrent = model.key === currentModel;
                  const isFocused = flatIndex === focusIndex;
                  const needsAuth = !model.ready && !model.local && !model.authConnected;
                  const currentFlatIndex = flatIndex;

                  return (
                    <button
                      key={model.key}
                      type="button"
                      data-index={currentFlatIndex}
                      onClick={() => onSelect(model.key)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        isCurrent && "bg-violet-500/10 border border-violet-500/20",
                        !isCurrent && isFocused && "bg-accent",
                        !isCurrent && !isFocused && "hover:bg-accent/70",
                        needsAuth && "opacity-50",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {meta?.displayName || getFriendlyModelName(model.key)}
                          </span>
                          {isCurrent && (
                            <span className="rounded-md bg-violet-500/20 px-1.5 py-0.5 text-xs font-medium text-violet-400">
                              Current
                            </span>
                          )}
                          {needsAuth && (
                            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-400">
                              Needs API key
                            </span>
                          )}
                          {model.local && (
                            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-400">
                              Local
                            </span>
                          )}
                        </div>
                        {meta?.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground/70">
                            {meta.description}
                          </p>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          {meta?.priceTier && (
                            <span className="text-xs text-muted-foreground/50">
                              {meta.priceTier}
                            </span>
                          )}
                          {meta?.contextWindow && (
                            <span className="text-xs text-muted-foreground/50">
                              {meta.contextWindow} context
                            </span>
                          )}
                          {!meta && (
                            <span className="text-xs text-muted-foreground/40">
                              {model.key}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground/50">
            {filteredModels.length} model{filteredModels.length !== 1 ? "s" : ""} available
            {search && ` matching "${search}"`}
          </p>
        </div>
      </div>
    </div>
  );
}
