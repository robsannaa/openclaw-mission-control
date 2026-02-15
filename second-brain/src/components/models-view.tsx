"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  ArrowUp,
  ArrowDown,
  Star,
  Trash2,
  Plus,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Zap,
  RefreshCw,
  Image as ImageIcon,
  Shield,
  Users,
  Tag,
  RotateCcw,
  Check,
  AlertTriangle,
  Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ────────────────────────────────────────── */

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

type AgentModelInfo = {
  id: string;
  name: string;
  modelPrimary: string | null;
  modelFallbacks: string[] | null;
  usesDefaults: boolean;
};

type Toast = { message: string; type: "success" | "error" };

/* ── Helpers ──────────────────────────────────────── */

function formatCtx(ctx: number) {
  if (ctx >= 1000000) return `${(ctx / 1000000).toFixed(1)}M`;
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}K`;
  return String(ctx);
}

function getProviderColor(key: string): string {
  const p = key.split("/")[0];
  const colors: Record<string, string> = {
    anthropic: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    openai: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    "openai-codex": "bg-teal-500/15 text-teal-400 border-teal-500/20",
    google: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    "google-vertex": "bg-blue-500/15 text-blue-400 border-blue-500/20",
    minimax: "bg-purple-500/15 text-purple-400 border-purple-500/20",
    "minimax-portal": "bg-purple-500/15 text-purple-400 border-purple-500/20",
    openrouter: "bg-rose-500/15 text-rose-400 border-rose-500/20",
    groq: "bg-orange-500/15 text-orange-400 border-orange-500/20",
    xai: "bg-sky-500/15 text-sky-400 border-sky-500/20",
    mistral: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
    ollama: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  };
  return colors[p] || "bg-zinc-500/15 text-zinc-400 border-zinc-500/20";
}

function getModelDisplayName(
  key: string,
  models: ModelInfo[],
  aliases: Record<string, string>
): string {
  const m = models.find((mm) => mm.key === key);
  if (m?.name) return m.name;
  // Try alias reverse
  const alias = Object.entries(aliases).find(([, v]) => v === key)?.[0];
  if (alias) return alias;
  // Fallback: extract from key
  return key.split("/").pop() || key;
}

/* ── Model Card ───────────────────────────────────── */

function ModelCard({
  model,
  rank,
  isPrimary,
  isImageModel,
  alias,
  canMoveUp,
  canMoveDown,
  onPromote,
  onMoveUp,
  onMoveDown,
  onRemove,
  models,
  busy,
  draggable,
  isDragOver,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  model: string;
  rank: number;
  isPrimary: boolean;
  isImageModel?: boolean;
  alias?: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPromote?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  models: ModelInfo[];
  busy: boolean;
  draggable?: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const info = models.find((m) => m.key === model);
  const provider = model.split("/")[0];
  const providerColor = getProviderColor(model);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border px-4 py-3 transition-all",
        isPrimary
          ? "border-violet-500/30 bg-violet-500/[0.08]"
          : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]",
        isDragging && "opacity-40 scale-[0.98]",
        isDragOver &&
          "border-violet-500/50 bg-violet-500/[0.06] ring-1 ring-violet-500/30"
      )}
    >
      {/* Drag handle / rank */}
      <div
        className={cn(
          "flex flex-col items-center gap-0.5",
          draggable && "cursor-grab active:cursor-grabbing"
        )}
      >
        <GripVertical
          className={cn(
            "h-3.5 w-3.5",
            draggable
              ? "text-zinc-500 group-hover:text-violet-400 transition-colors"
              : "text-zinc-700"
          )}
        />
        <span
          className={cn(
            "text-[10px] font-bold",
            isPrimary ? "text-violet-400" : "text-zinc-600"
          )}
        >
          #{rank}
        </span>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isPrimary && (
            <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
          )}
          {isImageModel && (
            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          )}
          <span
            className={cn(
              "truncate text-sm font-medium",
              isPrimary ? "text-violet-200" : "text-zinc-200"
            )}
          >
            {info?.name || model.split("/").pop()}
          </span>
          {alias && (
            <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
              {alias}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
              providerColor
            )}
          >
            {provider}
          </span>
          <span className="text-[10px] text-zinc-600">{model}</span>
          {info && (
            <>
              <span className="text-[10px] text-zinc-700">·</span>
              <span className="text-[10px] text-zinc-500">
                ctx {formatCtx(info.contextWindow)}
              </span>
              {info.input.includes("image") && (
                <>
                  <span className="text-[10px] text-zinc-700">·</span>
                  <span className="text-[10px] text-cyan-500">vision</span>
                </>
              )}
            </>
          )}
          {info && !info.available && (
            <>
              <span className="text-[10px] text-zinc-700">·</span>
              <span className="flex items-center gap-0.5 text-[10px] text-amber-500">
                <AlertTriangle className="h-2.5 w-2.5" />
                no auth
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {!isPrimary && onPromote && (
          <button
            type="button"
            onClick={onPromote}
            disabled={busy}
            className="rounded-lg p-1.5 text-amber-400 transition-colors hover:bg-amber-400/10 disabled:opacity-40"
            title="Promote to primary"
          >
            <Star className="h-3.5 w-3.5" />
          </button>
        )}
        {canMoveUp && onMoveUp && (
          <button
            type="button"
            onClick={onMoveUp}
            disabled={busy}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/5 disabled:opacity-40"
            title="Move up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        )}
        {canMoveDown && onMoveDown && (
          <button
            type="button"
            onClick={onMoveDown}
            disabled={busy}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/5 disabled:opacity-40"
            title="Move down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-400/10 disabled:opacity-40"
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Model Picker (search all 700+ models) ────────── */

function ModelPicker({
  onSelect,
  onClose,
  excludeModels,
}: {
  onSelect: (key: string) => void;
  onClose: () => void;
  excludeModels: string[];
}) {
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/models?scope=all")
      .then((r) => r.json())
      .then((d) => {
        setAllModels(d.models || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return allModels
      .filter(
        (m) =>
          !excludeModels.includes(m.key) &&
          (m.key.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            m.tags.some((t) => t.toLowerCase().includes(q)))
      )
      .slice(0, 50);
  }, [allModels, query, excludeModels]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900/95 shadow-2xl">
        {/* Search */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models (e.g. anthropic, gpt, claude, ollama)..."
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-zinc-600" />
              <span className="ml-2 text-sm text-zinc-500">
                Loading models catalog...
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-600">
              {query
                ? "No models matching your search"
                : "No additional models available"}
            </div>
          ) : (
            filtered.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => onSelect(m.key)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-violet-500/10"
              >
                <Cpu className="h-4 w-4 shrink-0 text-zinc-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-200">
                      {m.name || m.key.split("/").pop()}
                    </span>
                    {m.available && (
                      <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400">
                        auth ✓
                      </span>
                    )}
                    {m.local && (
                      <span className="shrink-0 rounded bg-blue-500/10 px-1 py-0.5 text-[9px] font-medium text-blue-400">
                        local
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded border px-1 py-0.5 text-[9px] font-medium",
                        getProviderColor(m.key)
                      )}
                    >
                      {m.key.split("/")[0]}
                    </span>
                    <span className="truncate text-[10px] text-zinc-600">
                      {m.key}
                    </span>
                    <span className="text-[10px] text-zinc-700">·</span>
                    <span className="text-[10px] text-zinc-500">
                      ctx {formatCtx(m.contextWindow)}
                    </span>
                    {m.input.includes("image") && (
                      <>
                        <span className="text-[10px] text-zinc-700">·</span>
                        <span className="text-[10px] text-cyan-500">
                          vision
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="border-t border-white/[0.06] px-4 py-2 text-[10px] text-zinc-600">
          {loading
            ? "Scanning model catalog..."
            : `${allModels.length} total models · ${filtered.length} shown`}
        </div>
      </div>
    </div>
  );
}

/* ── Agent Model Override Card ────────────────────── */

function AgentCard({
  agent,
  defaultPrimary,
  defaultFallbacks,
  models,
  aliases,
  busy,
  onUpdate,
  onReset,
}: {
  agent: AgentModelInfo;
  defaultPrimary: string;
  defaultFallbacks: string[];
  models: ModelInfo[];
  aliases: Record<string, string>;
  busy: boolean;
  onUpdate: (agentId: string, primary: string, fallbacks: string[] | null) => void;
  onReset: (agentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const effectivePrimary = agent.modelPrimary || defaultPrimary;
  const effectiveFallbacks = agent.modelFallbacks ?? defaultFallbacks;
  const isOverridden = !agent.usesDefaults;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3"
      >
        <Users className="h-4 w-4 shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200">
              {agent.name}
            </span>
            <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500">
              {agent.id}
            </span>
            {isOverridden ? (
              <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                custom
              </span>
            ) : (
              <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-600">
                inherits defaults
              </span>
            )}
          </div>
          <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
            {getModelDisplayName(effectivePrimary, models, aliases)}
            {effectiveFallbacks.length > 0 &&
              ` → ${effectiveFallbacks
                .map((f) => getModelDisplayName(f, models, aliases))
                .join(" → ")}`}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-zinc-600" />
        ) : (
          <ChevronDown className="h-4 w-4 text-zinc-600" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] px-4 py-3">
          {/* Primary */}
          <div className="mb-2 flex items-center gap-2">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            <span className="text-[11px] font-medium text-zinc-400">
              Primary:
            </span>
            <span className="text-[11px] text-zinc-300">
              {effectivePrimary}
            </span>
          </div>

          {/* Fallbacks */}
          <div className="mb-3 flex items-start gap-2">
            <Shield className="mt-0.5 h-3 w-3 text-zinc-600" />
            <div>
              <span className="text-[11px] font-medium text-zinc-400">
                Fallbacks:
              </span>
              {effectiveFallbacks.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {effectiveFallbacks.map((f, i) => (
                    <span
                      key={f}
                      className="inline-flex items-center gap-1 rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400"
                    >
                      <span className="text-zinc-600">#{i + 1}</span>{" "}
                      {getModelDisplayName(f, models, aliases)}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="ml-1 text-[11px] text-zinc-600">none</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {isOverridden && (
              <button
                type="button"
                onClick={() => onReset(agent.id)}
                disabled={busy}
                className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/[0.05] disabled:opacity-40"
              >
                <RotateCcw className="h-3 w-3" />
                Use defaults
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              disabled={busy}
              className="flex items-center gap-1 rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 py-1.5 text-[11px] text-violet-400 transition-colors hover:bg-violet-500/20 disabled:opacity-40"
            >
              <Zap className="h-3 w-3" />
              Set custom model
            </button>
          </div>

          {showPicker && (
            <ModelPicker
              excludeModels={[]}
              onClose={() => setShowPicker(false)}
              onSelect={(key) => {
                onUpdate(agent.id, key, null);
                setShowPicker(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Alias row ────────────────────────────────────── */

function AliasRow({
  alias,
  model,
  onRemove,
  busy,
}: {
  alias: string;
  model: string;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2">
      <Tag className="h-3 w-3 shrink-0 text-zinc-600" />
      <span className="text-[12px] font-medium text-amber-400">{alias}</span>
      <span className="text-[12px] text-zinc-700">→</span>
      <span className="truncate text-[12px] text-zinc-400">{model}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="ml-auto rounded p-1 text-zinc-700 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100 disabled:opacity-40"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ── Main ModelsView ──────────────────────────────── */

export function ModelsView() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [agents, setAgents] = useState<AgentModelInfo[]>([]);
  const [configHash, setConfigHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [newAlias, setNewAlias] = useState("");
  const [newAliasModel, setNewAliasModel] = useState("");
  const [showAgents, setShowAgents] = useState(true);
  const [showAliases, setShowAliases] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((message: string, type: "success" | "error" = "success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  /* ── Fetch ────────────────────────────── */
  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models?scope=status");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStatus(data.status);
      setModels(data.models || []);
      setAgents(data.agents || []);
      setConfigHash(data.configHash);
    } catch (err) {
      console.error("Failed to fetch models:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  /* ── API call helper ──────────────────── */
  const apiAction = useCallback(
    async (body: Record<string, unknown>, successMsg: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        flash(successMsg);
        await fetchModels();
      } catch (err) {
        flash(String(err), "error");
      } finally {
        setBusy(false);
      }
    },
    [fetchModels, flash]
  );

  /* ── Drag-and-drop state ─────────────── */
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  /* ── Derived ──────────────────────────── */
  const primary = status?.defaultModel || "";
  const fallbacks = status?.fallbacks || [];
  const aliases = status?.aliases || {};
  const allChain = [primary, ...fallbacks];

  /* ── Reorder helpers ──────────────────── */
  const promoteToFirst = useCallback(
    (model: string) => {
      const newFallbacks = allChain.filter((m) => m !== model);
      apiAction(
        { action: "reorder", primary: model, fallbacks: newFallbacks },
        `${model.split("/").pop()} promoted to primary`
      );
    },
    [allChain, apiAction]
  );

  const moveFallback = useCallback(
    (idx: number, dir: -1 | 1) => {
      const fb = [...fallbacks];
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= fb.length) return;
      [fb[idx], fb[newIdx]] = [fb[newIdx], fb[idx]];
      apiAction(
        { action: "set-fallbacks", fallbacks: fb },
        `Fallback order updated`
      );
    },
    [fallbacks, apiAction]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, idx: number) => {
      setDragIdx(idx);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(idx));
      // Slight delay for the ghost to render before dimming
      requestAnimationFrame(() => setDragIdx(idx));
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverIdx(idx);
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDragOverIdx(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIdx: number) => {
      e.preventDefault();
      const fromIdx = dragIdx;
      setDragIdx(null);
      setDragOverIdx(null);
      if (fromIdx === null || fromIdx === toIdx) return;
      const fb = [...fallbacks];
      const [moved] = fb.splice(fromIdx, 1);
      fb.splice(toIdx, 0, moved);
      apiAction(
        { action: "set-fallbacks", fallbacks: fb },
        "Fallback order updated"
      );
    },
    [dragIdx, fallbacks, apiAction]
  );

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  const removeFallback = useCallback(
    (model: string) => {
      apiAction(
        { action: "remove-fallback", model },
        `${model.split("/").pop()} removed from fallbacks`
      );
    },
    [apiAction]
  );

  const addFallback = useCallback(
    (model: string) => {
      setShowPicker(false);
      apiAction(
        { action: "add-fallback", model },
        `${model.split("/").pop()} added as fallback`
      );
    },
    [apiAction]
  );

  const swapPrimary = useCallback(
    (model: string) => {
      // Swap: current primary becomes last fallback, new model becomes primary
      const newFallbacks = fallbacks.filter((f) => f !== model);
      newFallbacks.push(primary);
      apiAction(
        { action: "reorder", primary: model, fallbacks: newFallbacks },
        `Swapped to ${model.split("/").pop()}`
      );
    },
    [primary, fallbacks, apiAction]
  );

  /* ── Agent model changes ──────────────── */
  const updateAgentModel = useCallback(
    (agentId: string, agentPrimary: string, agentFallbacks: string[] | null) => {
      apiAction(
        {
          action: "set-agent-model",
          agentId,
          primary: agentPrimary,
          fallbacks: agentFallbacks,
        },
        `Agent ${agentId} model updated`
      );
    },
    [apiAction]
  );

  const resetAgentModel = useCallback(
    (agentId: string) => {
      apiAction(
        { action: "reset-agent-model", agentId },
        `Agent ${agentId} reset to defaults`
      );
    },
    [apiAction]
  );

  /* ── Alias changes ────────────────────── */
  const removeAlias = useCallback(
    (alias: string) => {
      apiAction(
        { action: "remove-alias", alias },
        `Alias "${alias}" removed`
      );
    },
    [apiAction]
  );

  const addAlias = useCallback(() => {
    if (!newAlias.trim() || !newAliasModel.trim()) return;
    apiAction(
      { action: "set-alias", alias: newAlias.trim(), model: newAliasModel.trim() },
      `Alias "${newAlias.trim()}" added`
    );
    setNewAlias("");
    setNewAliasModel("");
  }, [newAlias, newAliasModel, apiAction]);

  /* ── Render ───────────────────────────── */
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-zinc-600" />
        <span className="ml-2 text-sm text-zinc-500">Loading models...</span>
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
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Models</h1>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            Manage primary model, fallback chain, and per-agent overrides. Changes
            apply instantly via hot reload.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            fetchModels();
          }}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[12px] text-zinc-400 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-8">
          {/* ── Model Chain ────────────── */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-violet-400" />
                <h2 className="text-sm font-semibold text-zinc-200">
                  Model Priority Chain
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                disabled={busy}
                className="flex items-center gap-1 rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-medium text-violet-400 transition-colors hover:bg-violet-500/20 disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                Add Fallback
              </button>
            </div>

            <p className="mb-4 text-[11px] text-zinc-600">
              The primary model is tried first. On failure (rate limit, auth
              error, timeout), fallbacks are tried in order. Drag and drop
              fallbacks to reorder, or use arrows.
            </p>

            <div className="space-y-2">
              {/* Primary */}
              <ModelCard
                model={primary}
                rank={1}
                isPrimary
                isImageModel={status.imageModel === primary}
                alias={
                  Object.entries(aliases).find(([, v]) => v === primary)?.[0]
                }
                canMoveUp={false}
                canMoveDown={fallbacks.length > 0}
                onMoveDown={() => {
                  // Swap primary with first fallback
                  if (fallbacks.length > 0) {
                    swapPrimary(fallbacks[0]);
                  }
                }}
                models={models}
                busy={busy}
              />

              {/* Fallback divider */}
              {fallbacks.length > 0 && (
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-700">
                    Fallbacks
                  </span>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                </div>
              )}

              {/* Fallbacks */}
              {fallbacks.map((fb, idx) => (
                <ModelCard
                  key={fb}
                  model={fb}
                  rank={idx + 2}
                  isPrimary={false}
                  alias={
                    Object.entries(aliases).find(([, v]) => v === fb)?.[0]
                  }
                  canMoveUp={true}
                  canMoveDown={idx < fallbacks.length - 1}
                  onPromote={() => promoteToFirst(fb)}
                  onMoveUp={() => moveFallback(idx, -1)}
                  onMoveDown={() => moveFallback(idx, 1)}
                  onRemove={() => removeFallback(fb)}
                  models={models}
                  busy={busy}
                  draggable={!busy}
                  isDragging={dragIdx === idx}
                  isDragOver={dragOverIdx === idx && dragIdx !== idx}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, idx)}
                />
              ))}
            </div>

            {/* Quick swap: pick any configured model as primary */}
            {models.length > 1 && (
              <div className="mt-4">
                <p className="mb-2 text-[11px] text-zinc-500">
                  Quick swap — click to make primary:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {models
                    .filter((m) => m.key !== primary)
                    .map((m) => {
                      const isInChain = fallbacks.includes(m.key);
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() =>
                            isInChain
                              ? promoteToFirst(m.key)
                              : swapPrimary(m.key)
                          }
                          disabled={busy}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40",
                            isInChain
                              ? "border-amber-500/20 bg-amber-500/5 text-amber-400 hover:bg-amber-500/15"
                              : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06]"
                          )}
                        >
                          <Star className="h-2.5 w-2.5" />
                          {m.name || m.key.split("/").pop()}
                          {!m.available && (
                            <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </section>

          {/* ── Per-Agent Overrides ─────── */}
          {agents.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowAgents(!showAgents)}
                className="mb-3 flex w-full items-center gap-2"
              >
                <Users className="h-4 w-4 text-zinc-500" />
                <h2 className="text-sm font-semibold text-zinc-200">
                  Per-Agent Overrides
                </h2>
                <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  {agents.length}
                </span>
                <div className="flex-1" />
                {showAgents ? (
                  <ChevronUp className="h-4 w-4 text-zinc-600" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-zinc-600" />
                )}
              </button>

              {showAgents && (
                <>
                  <p className="mb-3 text-[11px] text-zinc-600">
                    Each agent inherits the default model chain above unless
                    overridden. Set a custom model per agent for specialized
                    workloads.
                  </p>
                  <div className="space-y-2">
                    {agents.map((a) => (
                      <AgentCard
                        key={a.id}
                        agent={a}
                        defaultPrimary={primary}
                        defaultFallbacks={fallbacks}
                        models={models}
                        aliases={aliases}
                        busy={busy}
                        onUpdate={updateAgentModel}
                        onReset={resetAgentModel}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {/* ── Aliases ────────────────── */}
          <section>
            <button
              type="button"
              onClick={() => setShowAliases(!showAliases)}
              className="mb-3 flex w-full items-center gap-2"
            >
              <Tag className="h-4 w-4 text-zinc-500" />
              <h2 className="text-sm font-semibold text-zinc-200">
                Model Aliases
              </h2>
              <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                {Object.keys(aliases).length}
              </span>
              <div className="flex-1" />
              {showAliases ? (
                <ChevronUp className="h-4 w-4 text-zinc-600" />
              ) : (
                <ChevronDown className="h-4 w-4 text-zinc-600" />
              )}
            </button>

            {showAliases && (
              <>
                <p className="mb-3 text-[11px] text-zinc-600">
                  Aliases are short names for models. Use them in chat with{" "}
                  <code className="rounded bg-zinc-800 px-1 text-zinc-400">
                    /model &lt;alias&gt;
                  </code>
                  . Also limits the allowlist for{" "}
                  <code className="rounded bg-zinc-800 px-1 text-zinc-400">
                    /model
                  </code>{" "}
                  switching.
                </p>

                <div className="space-y-1.5">
                  {Object.entries(aliases).map(([alias, model]) => (
                    <AliasRow
                      key={alias}
                      alias={alias}
                      model={model}
                      onRemove={() => removeAlias(alias)}
                      busy={busy}
                    />
                  ))}
                </div>

                {/* Add alias */}
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="text"
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                    placeholder="alias"
                    className="w-24 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[12px] text-zinc-300 placeholder:text-zinc-700 focus:border-violet-500/30 focus:outline-none"
                  />
                  <span className="text-zinc-700">→</span>
                  <input
                    type="text"
                    value={newAliasModel}
                    onChange={(e) => setNewAliasModel(e.target.value)}
                    placeholder="provider/model-name"
                    className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[12px] text-zinc-300 placeholder:text-zinc-700 focus:border-violet-500/30 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={addAlias}
                    disabled={busy || !newAlias.trim() || !newAliasModel.trim()}
                    className="flex items-center gap-1 rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 py-1.5 text-[11px] text-violet-400 transition-colors hover:bg-violet-500/20 disabled:opacity-40"
                  >
                    <Check className="h-3 w-3" />
                    Add
                  </button>
                </div>
              </>
            )}
          </section>

          {/* ── Image Model Info ────────── */}
          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-cyan-400" />
              <h3 className="text-[12px] font-semibold text-zinc-300">
                Image Model
              </h3>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              Used when the primary model cannot accept images.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12px] text-zinc-300">
                {status.imageModel || "same as primary"}
              </span>
              {status.imageFallbacks.length > 0 && (
                <>
                  <span className="text-[10px] text-zinc-700">→</span>
                  {status.imageFallbacks.map((f) => (
                    <span key={f} className="text-[11px] text-zinc-500">
                      {f.split("/").pop()}
                    </span>
                  ))}
                </>
              )}
            </div>
          </section>

          {/* ── Config hash debug ──────── */}
          {configHash && (
            <div className="text-[10px] text-zinc-700">
              Config hash: {configHash}
            </div>
          )}
        </div>
      </div>

      {/* Model Picker Modal */}
      {showPicker && (
        <ModelPicker
          excludeModels={allChain}
          onClose={() => setShowPicker(false)}
          onSelect={addFallback}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12px] shadow-xl backdrop-blur-sm",
            toast.type === "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/20 bg-red-500/10 text-red-300"
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
