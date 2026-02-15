"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { requestRestart } from "@/lib/restart-store";
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
  Lock,
  KeyRound,
  Loader2,
  ExternalLink,
  CheckCircle,
  Plug,
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
    ollama: "bg-zinc-500/15 text-muted-foreground border-zinc-500/20",
  };
  return colors[p] || "bg-zinc-500/15 text-muted-foreground border-zinc-500/20";
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
          : "border-foreground/[0.06] bg-foreground/[0.02] hover:bg-foreground/[0.04]",
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
              ? "text-muted-foreground group-hover:text-violet-400 transition-colors"
              : "text-muted-foreground/40"
          )}
        />
        <span
          className={cn(
            "text-[10px] font-bold",
            isPrimary ? "text-violet-400" : "text-muted-foreground/60"
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
              isPrimary ? "text-violet-200" : "text-foreground/90"
            )}
          >
            {info?.name || model.split("/").pop()}
          </span>
          {alias && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
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
          <span className="text-[10px] text-muted-foreground/60">{model}</span>
          {info && (
            <>
              <span className="text-[10px] text-muted-foreground/40">·</span>
              <span className="text-[10px] text-muted-foreground">
                ctx {formatCtx(info.contextWindow)}
              </span>
              {info.input.includes("image") && (
                <>
                  <span className="text-[10px] text-muted-foreground/40">·</span>
                  <span className="text-[10px] text-cyan-500">vision</span>
                </>
              )}
            </>
          )}
          {info && !info.available && !info.local && (
            <>
              <span className="text-[10px] text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5 text-[10px] text-amber-500" title="Provider not authenticated — add API key in model picker">
                <Lock className="h-2.5 w-2.5" />
                needs auth
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
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40"
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
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40"
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

/* ── Provider metadata for auth UX ───────────────── */

type ProviderMeta = {
  id: string;
  name: string;
  authType: "api-key" | "oauth" | "oauth-cli" | "local" | "env";
  envKey?: string;
  placeholder?: string;
  oauthCommand?: string;
  docsUrl?: string;
};

const PROVIDER_CATALOG: ProviderMeta[] = [
  { id: "anthropic", name: "Anthropic", authType: "api-key", envKey: "ANTHROPIC_API_KEY", placeholder: "sk-ant-...", docsUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI", authType: "api-key", envKey: "OPENAI_API_KEY", placeholder: "sk-proj-...", docsUrl: "https://platform.openai.com/api-keys" },
  { id: "openai-codex", name: "OpenAI Codex", authType: "oauth-cli", oauthCommand: "openclaw models auth login --provider openai-codex" },
  { id: "google", name: "Google Gemini", authType: "api-key", envKey: "GEMINI_API_KEY", placeholder: "AI...", docsUrl: "https://aistudio.google.com/apikey" },
  { id: "google-gemini-cli", name: "Gemini CLI (OAuth)", authType: "oauth-cli", oauthCommand: "openclaw models auth login --provider google-gemini-cli --set-default" },
  { id: "google-antigravity", name: "Google Antigravity", authType: "oauth-cli", oauthCommand: "openclaw models auth login --provider google-antigravity --set-default" },
  { id: "openrouter", name: "OpenRouter", authType: "api-key", envKey: "OPENROUTER_API_KEY", placeholder: "sk-or-...", docsUrl: "https://openrouter.ai/keys" },
  { id: "groq", name: "Groq", authType: "api-key", envKey: "GROQ_API_KEY", placeholder: "gsk_...", docsUrl: "https://console.groq.com/keys" },
  { id: "xai", name: "xAI (Grok)", authType: "api-key", envKey: "XAI_API_KEY", placeholder: "xai-..." },
  { id: "mistral", name: "Mistral", authType: "api-key", envKey: "MISTRAL_API_KEY", placeholder: "...", docsUrl: "https://console.mistral.ai/api-keys" },
  { id: "minimax", name: "MiniMax", authType: "api-key", envKey: "MINIMAX_API_KEY", placeholder: "..." },
  { id: "minimax-portal", name: "MiniMax Portal", authType: "oauth-cli", oauthCommand: "openclaw models auth login --provider minimax-portal" },
  { id: "zai", name: "Z.AI (GLM)", authType: "api-key", envKey: "ZAI_API_KEY", placeholder: "..." },
  { id: "cerebras", name: "Cerebras", authType: "api-key", envKey: "CEREBRAS_API_KEY", placeholder: "..." },
  { id: "huggingface", name: "Hugging Face", authType: "api-key", envKey: "HUGGINGFACE_HUB_TOKEN", placeholder: "hf_...", docsUrl: "https://huggingface.co/settings/tokens" },
  { id: "ollama", name: "Ollama", authType: "local" },
  { id: "vllm", name: "vLLM", authType: "local" },
];

type AuthProviderInfo = { provider: string; authenticated: boolean; authKind: string | null };

/* ── Inline provider auth card ───────────────────── */

function ProviderAuthCard({
  meta,
  isAuthenticated,
  onAuthenticated,
}: {
  meta: ProviderMeta;
  isAuthenticated: boolean;
  onAuthenticated: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSubmitKey = useCallback(async () => {
    if (!apiKey.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auth-provider", provider: meta.id, token: apiKey.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({ ok: true, msg: "Connected!" });
        setApiKey("");
        setTimeout(() => {
          onAuthenticated();
          setExpanded(false);
          setResult(null);
        }, 1200);
      } else {
        setResult({ ok: false, msg: data.error || "Failed" });
      }
    } catch (err) {
      setResult({ ok: false, msg: String(err) });
    }
    setBusy(false);
  }, [apiKey, meta.id, onAuthenticated]);

  if (isAuthenticated) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2">
        <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
        <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">{meta.name}</span>
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">Connected</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] transition-all">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        <Plug className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        <span className="flex-1 text-[12px] font-medium text-foreground/80">{meta.name}</span>
        {meta.authType === "api-key" && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">API Key</span>
        )}
        {meta.authType === "oauth-cli" && (
          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-400">OAuth / CLI</span>
        )}
        {meta.authType === "local" && (
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] text-blue-400">Local</span>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground/40 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="border-t border-foreground/[0.04] px-3 py-3">
          {meta.authType === "api-key" && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmitKey(); }}
                  placeholder={meta.placeholder || "Paste your API key..."}
                  className="flex-1 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2 text-[12px] text-foreground/80 placeholder:text-muted-foreground/40 focus:border-violet-500/30 focus:outline-none"
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={handleSubmitKey}
                  disabled={busy || !apiKey.trim()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                  Connect
                </button>
              </div>
              {meta.docsUrl && (
                <a
                  href={meta.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  Get your API key from {meta.name}
                </a>
              )}
              {result && (
                <div className={cn("flex items-center gap-1.5 text-[11px]", result.ok ? "text-emerald-400" : "text-red-400")}>
                  {result.ok ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {result.msg}
                </div>
              )}
            </div>
          )}

          {meta.authType === "oauth-cli" && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                This provider uses OAuth. Run this command in your terminal:
              </p>
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                <code className="flex-1 text-[11px] font-mono text-foreground/70">
                  {meta.oauthCommand}
                </code>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(meta.oauthCommand || ""); }}
                  className="shrink-0 rounded p-1 text-muted-foreground/60 hover:text-foreground/70"
                  title="Copy command"
                >
                  <Check className="h-3 w-3" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground/50">
                After authenticating, click the refresh button above to see the new models.
              </p>
            </div>
          )}

          {meta.authType === "local" && (
            <p className="text-[11px] text-muted-foreground">
              {meta.id === "ollama"
                ? "Ollama runs locally — no authentication needed. Just install Ollama and pull a model (e.g. ollama pull llama3.3)."
                : "vLLM runs locally — point it at your model server. No cloud auth needed."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Model Picker (auth-aware, grouped by provider) ── */

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
  const [authProviders, setAuthProviders] = useState<AuthProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showConnectProviders, setShowConnectProviders] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/models?scope=all");
      const d = await res.json();
      setAllModels(d.models || []);
      setAuthProviders(d.authProviders || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { queueMicrotask(() => fetchData()); }, [fetchData, refreshKey]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Build authenticated provider set
  const authSet = useMemo(() => {
    const set = new Set<string>();
    for (const p of authProviders) {
      if (p.authenticated) set.add(p.provider);
    }
    return set;
  }, [authProviders]);

  // Group models: available (authenticated) vs locked
  const { availableModels, lockedModels } = useMemo(() => {
    const q = query.toLowerCase();
    const matching = allModels.filter(
      (m) =>
        !excludeModels.includes(m.key) &&
        (m.key.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)))
    );

    const available: ModelInfo[] = [];
    const locked: ModelInfo[] = [];

    for (const m of matching) {
      const provider = m.key.split("/")[0];
      if (m.available || m.local || authSet.has(provider)) {
        available.push(m);
      } else {
        locked.push(m);
      }
    }

    return {
      availableModels: available.slice(0, 40),
      lockedModels: locked.slice(0, 30),
    };
  }, [allModels, query, excludeModels, authSet]);

  // Providers that are NOT authenticated
  const unauthenticatedProviders = useMemo(() => {
    const authed = new Set(authProviders.filter((p) => p.authenticated).map((p) => p.provider));
    return PROVIDER_CATALOG.filter((p) => !authed.has(p.id) && p.authType !== "local");
  }, [authProviders]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] sm:pt-[10vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 mx-2 flex max-h-[85vh] w-full max-w-[min(40rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card/95 shadow-2xl sm:mx-4 sm:max-h-[75vh]">
        {/* Search header */}
        <div className="flex items-center gap-3 border-b border-foreground/[0.06] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models (e.g. anthropic, gpt, claude, ollama)..."
            className="flex-1 bg-transparent text-sm text-foreground/90 placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => { setRefreshKey((k) => k + 1); }}
            className="rounded p-1 text-muted-foreground/60 hover:text-foreground/70"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground/70">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
              <span className="ml-2 text-sm text-muted-foreground">Loading models...</span>
            </div>
          ) : (
            <>
              {/* ── Available models (authenticated) ── */}
              {availableModels.length > 0 && (
                <div className="p-2">
                  <div className="mb-1 flex items-center gap-2 px-2 py-1">
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Ready to use
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">
                      ({availableModels.length})
                    </span>
                  </div>
                  {availableModels.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => onSelect(m.key)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-violet-500/10"
                    >
                      <Cpu className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground/90">
                            {m.name || m.key.split("/").pop()}
                          </span>
                          {m.local && (
                            <span className="shrink-0 rounded bg-blue-500/10 px-1 py-0.5 text-[9px] font-medium text-blue-400">local</span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className={cn("inline-flex items-center rounded border px-1 py-0.5 text-[9px] font-medium", getProviderColor(m.key))}>
                            {m.key.split("/")[0]}
                          </span>
                          <span className="truncate text-[10px] text-muted-foreground/60">{m.key}</span>
                          <span className="text-[10px] text-muted-foreground/40">·</span>
                          <span className="text-[10px] text-muted-foreground">ctx {formatCtx(m.contextWindow)}</span>
                          {m.input.includes("image") && (
                            <>
                              <span className="text-[10px] text-muted-foreground/40">·</span>
                              <span className="text-[10px] text-cyan-500">vision</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* ── Locked models (unauthenticated) ── */}
              {lockedModels.length > 0 && !showConnectProviders && (
                <div className="border-t border-foreground/[0.04] p-2">
                  <div className="mb-1 flex items-center gap-2 px-2 py-1">
                    <Lock className="h-3.5 w-3.5 text-muted-foreground/40" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                      Requires authentication
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">
                      ({lockedModels.length}+)
                    </span>
                  </div>

                  {/* Show a few locked model previews */}
                  {lockedModels.slice(0, 5).map((m) => (
                    <div
                      key={m.key}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 opacity-50"
                    >
                      <Lock className="h-4 w-4 shrink-0 text-muted-foreground/30" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground/50">
                            {m.name || m.key.split("/").pop()}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className={cn("inline-flex items-center rounded border px-1 py-0.5 text-[9px] font-medium opacity-60", getProviderColor(m.key))}>
                            {m.key.split("/")[0]}
                          </span>
                          <span className="text-[10px] text-muted-foreground/40">ctx {formatCtx(m.contextWindow)}</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Connect button */}
                  <button
                    type="button"
                    onClick={() => setShowConnectProviders(true)}
                    className="mx-2 mt-2 flex w-[calc(100%-1rem)] items-center justify-center gap-2 rounded-lg border border-dashed border-violet-500/30 bg-violet-500/[0.05] px-4 py-3 text-[12px] font-medium text-violet-400 transition-colors hover:bg-violet-500/10"
                  >
                    <Plug className="h-4 w-4" />
                    Connect a provider to unlock {lockedModels.length}+ more models
                  </button>
                </div>
              )}

              {/* ── Connect providers panel ── */}
              {showConnectProviders && (
                <div className="border-t border-foreground/[0.04] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Plug className="h-4 w-4 text-violet-400" />
                      <span className="text-[12px] font-semibold text-foreground/80">
                        Connect Providers
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowConnectProviders(false)}
                      className="rounded p-1 text-muted-foreground/40 hover:text-foreground/70"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <p className="mb-3 text-[11px] text-muted-foreground/60">
                    Add your API keys to unlock models. Keys are stored securely in your local OpenClaw auth store.
                  </p>

                  <div className="space-y-1.5">
                    {unauthenticatedProviders.map((meta) => (
                      <ProviderAuthCard
                        key={meta.id}
                        meta={meta}
                        isAuthenticated={authSet.has(meta.id)}
                        onAuthenticated={() => setRefreshKey((k) => k + 1)}
                      />
                    ))}
                  </div>

                  {unauthenticatedProviders.length === 0 && (
                    <div className="py-6 text-center text-[12px] text-emerald-400">
                      <CheckCircle className="mx-auto mb-2 h-6 w-6" />
                      All providers connected!
                    </div>
                  )}
                </div>
              )}

              {/* Empty state */}
              {availableModels.length === 0 && lockedModels.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground/60">
                  {query ? "No models matching your search" : "No additional models available"}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-foreground/[0.06] px-4 py-2">
          <span className="text-[10px] text-muted-foreground/60">
            {loading
              ? "Scanning model catalog..."
              : `${availableModels.length} available · ${allModels.length} total`}
          </span>
          {!showConnectProviders && unauthenticatedProviders.length > 0 && (
            <button
              type="button"
              onClick={() => setShowConnectProviders(true)}
              className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300"
            >
              <Plus className="h-2.5 w-2.5" />
              Add provider
            </button>
          )}
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
    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3"
      >
        <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90">
              {agent.name}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {agent.id}
            </span>
            {isOverridden ? (
              <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">
                custom
              </span>
            ) : (
              <span className="rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                inherits defaults
              </span>
            )}
          </div>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {getModelDisplayName(effectivePrimary, models, aliases)}
            {effectiveFallbacks.length > 0 &&
              ` → ${effectiveFallbacks
                .map((f) => getModelDisplayName(f, models, aliases))
                .join(" → ")}`}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground/60" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground/60" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-foreground/[0.06] px-4 py-3">
          {/* Primary */}
          <div className="mb-2 flex items-center gap-2">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            <span className="text-[11px] font-medium text-muted-foreground">
              Primary:
            </span>
            <span className="text-[11px] text-foreground/70">
              {effectivePrimary}
            </span>
          </div>

          {/* Fallbacks */}
          <div className="mb-3 flex items-start gap-2">
            <Shield className="mt-0.5 h-3 w-3 text-muted-foreground/60" />
            <div>
              <span className="text-[11px] font-medium text-muted-foreground">
                Fallbacks:
              </span>
              {effectiveFallbacks.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {effectiveFallbacks.map((f, i) => (
                    <span
                      key={f}
                      className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >
                      <span className="text-muted-foreground/60">#{i + 1}</span>{" "}
                      {getModelDisplayName(f, models, aliases)}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="ml-1 text-[11px] text-muted-foreground/60">none</span>
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
                className="flex items-center gap-1 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] disabled:opacity-40"
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
    <div className="group flex items-center gap-2 rounded-lg border border-foreground/[0.04] bg-foreground/[0.02] px-3 py-2">
      <Tag className="h-3 w-3 shrink-0 text-muted-foreground/60" />
      <span className="text-[12px] font-medium text-amber-400">{alias}</span>
      <span className="text-[12px] text-muted-foreground/40">→</span>
      <span className="truncate text-[12px] text-muted-foreground">{model}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="ml-auto rounded p-1 text-muted-foreground/40 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100 disabled:opacity-40"
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
      if (data.error) {
        // Non-critical: log and continue — the API degrades gracefully
        console.warn("Models API partial error:", data.error);
      }
      if (data.status) setStatus(data.status);
      if (data.models) setModels(data.models);
      setAgents(data.agents || []);
      setConfigHash(data.configHash ?? null);
    } catch (err) {
      console.warn("Failed to fetch models:", err);
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
        if (data.error) {
          // Show friendly error instead of throwing (avoids React error overlay)
          const msg = String(data.error);
          if (msg.includes("gateway closed") || msg.includes("1006")) {
            flash("Gateway temporarily unavailable — try again in a moment", "error");
          } else {
            flash(msg, "error");
          }
          return;
        }
        flash(successMsg);
        requestRestart("Model configuration was updated.");
        await fetchModels();
      } catch (err) {
        const msg = String(err);
        if (msg.includes("gateway closed") || msg.includes("1006")) {
          flash("Gateway temporarily unavailable — try again in a moment", "error");
        } else {
          flash(msg, "error");
        }
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
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground/60" />
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
      {/* Header */}
      <div className="flex items-center justify-between border-b border-foreground/[0.06] px-4 md:px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Models</h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
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
          className="flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-8">
          {/* ── Model Chain ────────────── */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-violet-400" />
                <h2 className="text-sm font-semibold text-foreground/90">
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

            <p className="mb-4 text-[11px] text-muted-foreground/60">
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
                  <div className="h-px flex-1 bg-foreground/[0.06]" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                    Fallbacks
                  </span>
                  <div className="h-px flex-1 bg-foreground/[0.06]" />
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
                <p className="mb-2 text-[11px] text-muted-foreground">
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
                              : "border-foreground/[0.08] bg-foreground/[0.02] text-muted-foreground hover:bg-foreground/[0.06]"
                          )}
                        >
                          <Star className="h-2.5 w-2.5" />
                          {m.name || m.key.split("/").pop()}
                          {!m.available && !m.local && (
                            <Lock className="h-2.5 w-2.5 text-amber-500" />
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
                <Users className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground/90">
                  Per-Agent Overrides
                </h2>
                <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {agents.length}
                </span>
                <div className="flex-1" />
                {showAgents ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground/60" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground/60" />
                )}
              </button>

              {showAgents && (
                <>
                  <p className="mb-3 text-[11px] text-muted-foreground/60">
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
              <Tag className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground/90">
                Model Aliases
              </h2>
              <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {Object.keys(aliases).length}
              </span>
              <div className="flex-1" />
              {showAliases ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground/60" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground/60" />
              )}
            </button>

            {showAliases && (
              <>
                <p className="mb-3 text-[11px] text-muted-foreground/60">
                  Aliases are short names for models. Use them in chat with{" "}
                  <code className="rounded bg-muted px-1 text-muted-foreground">
                    /model &lt;alias&gt;
                  </code>
                  . Also limits the allowlist for{" "}
                  <code className="rounded bg-muted px-1 text-muted-foreground">
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
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                    placeholder="alias"
                    className="w-24 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-2.5 py-1.5 text-[12px] text-foreground/70 placeholder:text-muted-foreground/40 focus:border-violet-500/30 focus:outline-none"
                  />
                  <span className="text-muted-foreground/40">→</span>
                  <input
                    type="text"
                    value={newAliasModel}
                    onChange={(e) => setNewAliasModel(e.target.value)}
                    placeholder="provider/model-name"
                    className="flex-1 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-2.5 py-1.5 text-[12px] text-foreground/70 placeholder:text-muted-foreground/40 focus:border-violet-500/30 focus:outline-none"
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
          <section className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-cyan-400" />
              <h3 className="text-[12px] font-semibold text-foreground/70">
                Image Model
              </h3>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Used when the primary model cannot accept images.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12px] text-foreground/70">
                {status.imageModel || "same as primary"}
              </span>
              {status.imageFallbacks.length > 0 && (
                <>
                  <span className="text-[10px] text-muted-foreground/40">→</span>
                  {status.imageFallbacks.map((f) => (
                    <span key={f} className="text-[11px] text-muted-foreground">
                      {f.split("/").pop()}
                    </span>
                  ))}
                </>
              )}
            </div>
          </section>

          {/* ── Config hash debug ──────── */}
          {configHash && (
            <div className="text-[10px] text-muted-foreground/40">
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
