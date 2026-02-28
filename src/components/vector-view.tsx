"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Database, Search, RefreshCw, ChevronDown, ChevronUp, Check,
  AlertTriangle, X, FileText, Hash, Cpu, HardDrive,
  Layers, RotateCcw, Activity, Filter, ArrowUpDown, Eye, Copy,
  Box, BarChart3, CircleDot, Settings2, Pencil, Save, Lock, KeyRound,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import { ApiWarningBadge } from "@/components/ui/api-warning-badge";

type SourceCount = { source: string; files: number; chunks: number };

type AgentMemory = {
  agentId: string;
  dbSizeBytes: number;
  status: {
    backend: string; files: number; chunks: number; dirty: boolean;
    workspaceDir: string; dbPath: string; provider: string; model: string;
    requestedProvider: string; sources: string[]; extraPaths: string[];
    sourceCounts: SourceCount[];
    cache: { enabled: boolean; entries: number };
    fts: { enabled: boolean; available: boolean };
    vector: { enabled: boolean; available: boolean; extensionPath?: string; dims?: number };
    batch: { enabled: boolean; failures: number; limit: number; wait: boolean; concurrency: number; pollIntervalMs: number; timeoutMs: number };
  };
  scan: { sources: { source: string; totalFiles: number; issues: string[] }[]; totalFiles: number; issues: string[] };
};

type SearchResult = { path: string; startLine: number; endLine: number; score: number; snippet: string; source: string };
type Toast = { message: string; type: "success" | "error" };

/** Per OpenClaw docs: API-key providers use the onboarding wizard; models auth login requires provider plugins. */
function authCommandForProvider(provider: string): string {
  switch (provider) {
    case "openai":
      return "openclaw onboard --auth-choice openai-api-key";
    case "google":
      return "openclaw onboard --auth-choice gemini-api-key";
    default:
      return "openclaw onboard";
  }
}

const EMBEDDING_MODELS: { provider: string; model: string; dims: number; label: string }[] = [
  { provider: "openai", model: "text-embedding-3-small", dims: 1536, label: "OpenAI text-embedding-3-small" },
  { provider: "openai", model: "text-embedding-3-large", dims: 3072, label: "OpenAI text-embedding-3-large" },
  { provider: "openai", model: "text-embedding-ada-002", dims: 1536, label: "OpenAI Ada 002 (legacy)" },
  { provider: "google", model: "text-embedding-004", dims: 768, label: "Google text-embedding-004" },
  { provider: "voyage", model: "voyage-3-large", dims: 1024, label: "Voyage 3 Large" },
  { provider: "voyage", model: "voyage-3", dims: 1024, label: "Voyage 3" },
  { provider: "voyage", model: "voyage-code-3", dims: 1024, label: "Voyage Code 3" },
  { provider: "cohere", model: "embed-v4.0", dims: 1024, label: "Cohere Embed v4" },
  { provider: "cohere", model: "embed-english-v3.0", dims: 1024, label: "Cohere English v3" },
];

/** Default local embedding model (auto-downloads on first use, ~0.6 GB). See https://docs.openclaw.ai/concepts/memory#vector-memory-search */
const DEFAULT_LOCAL_MODEL_PATH = "hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf";

function formatBytes(b: number): string {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + " GB";
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(0) + " KB";
  return b + " B";
}
function scoreColor(s: number) { return s >= 0.7 ? "text-emerald-400" : s >= 0.5 ? "text-amber-400" : s >= 0.3 ? "text-orange-400" : "text-red-400"; }
function scoreBarColor(s: number) { return s >= 0.7 ? "bg-emerald-500" : s >= 0.5 ? "bg-amber-500" : s >= 0.3 ? "bg-orange-500" : "bg-red-500"; }

function ToastBar({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className={cn("fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-xl backdrop-blur-sm", toast.type === "success" ? "border-emerald-500/30 bg-emerald-950/80 text-emerald-300" : "border-red-500/30 bg-red-950/80 text-red-300")}>
      <div className="flex items-center gap-2">{toast.type === "success" ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{toast.message}</div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-foreground/10"><div className={cn("h-1.5 rounded-full transition-all", scoreBarColor(score))} style={{ width: Math.round(score * 100) + "%" }} /></div>
      <span className={cn("text-xs font-mono font-semibold", scoreColor(score))}>{score.toFixed(4)}</span>
    </div>
  );
}

function ResultCard({ result, rank }: { result: SearchResult; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-foreground/10 bg-foreground/5 transition-all hover:border-foreground/10">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-xs font-bold text-violet-400">#{rank}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span className="truncate text-sm font-medium text-foreground/90">{result.path}</span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">L{result.startLine}-{result.endLine}</span>
            <span className="shrink-0 rounded border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-xs text-sky-400">{result.source}</span>
          </div>
        </div>
        <ScoreBar score={result.score} />
        <div className="flex items-center gap-1">
          <button onClick={() => { navigator.clipboard.writeText(result.snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground/70" title="Copy">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => setExpanded(!expanded)} className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground/70">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {!expanded && <div className="border-t border-foreground/5 px-4 py-2"><p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{result.snippet.replace(/\n+/g, " ").substring(0, 200)}</p></div>}
      {expanded && (
        <div className="border-t border-foreground/10 px-4 py-3">
          <div className="flex items-center gap-2 mb-2"><Hash className="h-3 w-3 text-muted-foreground/60" /><span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Vector Match - Chunk Content</span></div>
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words">{result.snippet}</pre>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground/60">
            <span>Lines {result.startLine}-{result.endLine}</span><span>{result.snippet.length} chars</span><span>~{Math.ceil(result.snippet.split(/\s+/).length)} tokens (est.)</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-foreground/5 bg-muted/50 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/60 mb-0.5"><Icon className="h-3 w-3" />{label}</div>
      <p className="text-xs font-mono text-foreground/70 truncate" title={value}>{value}</p>
    </div>
  );
}

function AgentIndexCard({ agent, onReindex, reindexing }: { agent: AgentMemory; onReindex: (id: string, force: boolean) => void; reindexing: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const st = agent.status; const vec = st.vector;
  return (
    <div className={cn("rounded-xl border transition-all", agent.scan.issues.length > 0 ? "border-amber-500/20 bg-amber-500/5" : "border-foreground/10 bg-foreground/5")}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-sm">{agent.agentId === "main" ? "\u{1F99E}" : "\u{1F480}"}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground/90 capitalize">{agent.agentId}</span>
            {st.dirty && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-300">Dirty</span>}
            {vec.available && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-emerald-300">Vector</span>}
            {st.fts.available && <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-sky-300">FTS</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{st.files} files</span><span>{st.chunks} chunks</span>{vec.dims && <span>{vec.dims}d vectors</span>}<span>{formatBytes(agent.dbSizeBytes)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onReindex(agent.agentId, false)} disabled={reindexing} className="flex items-center gap-1.5 rounded-lg bg-foreground/10 px-3 py-1.5 text-xs font-medium text-foreground/70 hover:bg-foreground/10 disabled:opacity-50">
            {reindexing ? <span className="inline-flex items-center gap-0.5"><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" /></span> : <RefreshCw className="h-3 w-3" />}Reindex
          </button>
          <button onClick={() => setExpanded(!expanded)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground/70">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-foreground/5 px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat icon={Layers} label="Backend" value={st.backend} />
            <MiniStat icon={Cpu} label="Provider" value={st.provider} />
            <MiniStat icon={Box} label="Model" value={st.model} />
            <MiniStat icon={Hash} label="Dimensions" value={vec.dims ? String(vec.dims) : "\u2014"} />
          </div>
          {st.sourceCounts.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">Sources</p>
              <div className="space-y-1">{st.sourceCounts.map((sc) => (
                <div key={sc.source} className="flex items-center justify-between rounded-lg border border-foreground/5 bg-muted/50 px-3 py-2">
                  <div className="flex items-center gap-2"><CircleDot className="h-3 w-3 text-violet-400" /><span className="text-xs text-foreground/70">{sc.source}</span></div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground"><span>{sc.files} files</span><span>{sc.chunks} chunks</span></div>
                </div>
              ))}</div>
            </div>
          )}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground/60">Cache: <span className={st.cache.enabled ? "text-emerald-400" : "text-muted-foreground/60"}>{st.cache.enabled ? st.cache.entries + " entries" : "disabled"}</span></span>
            <span className="text-muted-foreground/60">FTS: <span className={st.fts.available ? "text-emerald-400" : "text-red-400"}>{st.fts.available ? "available" : "unavailable"}</span></span>
            <span className="text-muted-foreground/60">Vector: <span className={vec.available ? "text-emerald-400" : "text-red-400"}>{vec.available ? "available" : "unavailable"}</span></span>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2"><p className="text-xs text-muted-foreground/60 mb-0.5">Database Path</p><code className="text-xs text-muted-foreground break-all">{st.dbPath}</code></div>
          {agent.scan.issues.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 space-y-1">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300"><AlertTriangle className="h-3 w-3" />Issues</p>
              {agent.scan.issues.map((issue, i) => <p key={i} className="text-xs text-amber-400/80 pl-5">{issue}</p>)}
            </div>
          )}
          <button onClick={() => onReindex(agent.agentId, true)} disabled={reindexing} className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50">
            <RotateCcw className="h-3 w-3" />Force Full Reindex
          </button>
        </div>
      )}
    </div>
  );
}

type EmbeddingOptions = { localModelPath?: string; fallback?: string; cacheEnabled?: boolean };

function EmbeddingModelEditor({
  currentProvider,
  currentModel,
  currentDims,
  currentBackend,
  memorySearch,
  onSave,
  saving,
}: {
  currentProvider: string;
  currentModel: string;
  currentDims: number | null;
  currentBackend: string;
  memorySearch: Record<string, unknown> | null;
  onSave: (p: string, m: string, options?: EmbeddingOptions) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(currentProvider);
  const [model, setModel] = useState(currentModel);
  const [localModelPath, setLocalModelPath] = useState(() => {
    const local = memorySearch?.local as Record<string, unknown> | undefined;
    return (local?.modelPath as string) || "";
  });
  const [fallback, setFallback] = useState(() => (memorySearch?.fallback as string) || "none");
  const [cacheEnabled, setCacheEnabled] = useState(() => {
    const c = memorySearch?.cache as Record<string, unknown> | undefined;
    return c?.enabled !== false;
  });
  const [authProviders, setAuthProviders] = useState<Set<string>>(new Set());
  const [authLoading, setAuthLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const preset = EMBEDDING_MODELS.find((m) => m.provider === provider && m.model === model);

  // Fetch authenticated providers when editor opens
  useEffect(() => {
    if (!editing) return;
    queueMicrotask(() => setAuthLoading(true));
    (async () => {
      try {
        const res = await fetch("/api/models");
        const data = await res.json();
        const providers = new Set<string>();
        // Extract providers that have auth configured
        const authList = data?.status?.auth?.providers ?? [];
        for (const p of authList) {
          if (p.effective) providers.add(p.provider);
        }
        // Always include the current provider
        if (currentProvider) providers.add(currentProvider);
        setAuthProviders(providers);
      } catch {
        // If we can't check, show all models
        setAuthProviders(new Set(EMBEDDING_MODELS.map((m) => m.provider)));
      }
      setAuthLoading(false);
    })();
  }, [editing, currentProvider]);

  // Local is always available (no API key). Remote providers need auth.
  const availableModels = useMemo(
    () => EMBEDDING_MODELS.filter((m) => authProviders.has(m.provider)),
    [authProviders]
  );
  const lockedModels = useMemo(
    () => EMBEDDING_MODELS.filter((m) => m.provider !== "local" && !authProviders.has(m.provider)),
    [authProviders]
  );
  const lockedProviders = useMemo(
    () => [...new Set(lockedModels.map((m) => m.provider))],
    [lockedModels]
  );

  if (!editing) return (
    <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90"><Cpu className="h-4 w-4 text-violet-400" />Index Control Plane</div>
        <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg bg-foreground/10 px-3 py-1.5 text-xs font-medium text-foreground/70 hover:bg-foreground/10"><Pencil className="h-3 w-3" />Change</button>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-foreground/5 bg-muted/50 px-3 py-2"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Provider</p><p className="text-sm font-mono text-foreground/90 mt-0.5">{currentProvider}</p></div>
        <div className="rounded-lg border border-foreground/5 bg-muted/50 px-3 py-2"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Model</p><p className="text-sm font-mono text-foreground/90 mt-0.5 truncate" title={currentModel}>{currentModel}</p><p className="mt-1 text-xs text-muted-foreground/70">{currentDims ? `${currentDims}d embeddings` : "\u2014"}</p></div>
        <div className="rounded-lg border border-foreground/5 bg-muted/50 px-3 py-2"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Backend</p><p className="text-sm font-mono text-foreground/90 mt-0.5">{currentBackend || "\u2014"}</p></div>
      </div>
      {currentProvider === "local" && (() => {
        const local = memorySearch?.local as Record<string, unknown> | undefined;
        const path = local?.modelPath as string | undefined;
        return path ? <p className="mt-2 text-xs text-muted-foreground/70">Local path: <span className="font-mono truncate block" title={path}>{path}</span></p> : null;
      })()}
    </div>
  );

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90"><Cpu className="h-4 w-4 text-violet-400" />Change Embedding Model</div>
        <button onClick={() => { setEditing(false); setProvider(currentProvider); setModel(currentModel); }} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground/70"><X className="h-4 w-4" /></button>
      </div>
      <p className="text-xs text-muted-foreground">Changing the embedding model requires a full reindex.</p>

      {/* Available models — from authenticated providers */}
      {authLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground/60">
          <span className="inline-flex items-center gap-0.5"><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" /></span>Checking authenticated providers...
        </div>
      ) : (
        <>
          {/* Local (Offline) — always available, no API key */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              Local (offline)
            </p>
            <button
              type="button"
              onClick={() => { setProvider("local"); setModel("auto"); }}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left transition-all",
                provider === "local"
                  ? "border-violet-500/40 bg-violet-500/15"
                  : "border-foreground/10 bg-foreground/5 hover:border-foreground/15"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg" title="Runs on device">💻</span>
                <div>
                  <span className={cn("text-xs font-medium", provider === "local" ? "text-violet-300" : "text-foreground/70")}>Local (Offline)</span>
                  {currentProvider === "local" && provider === "local" && <span className="ml-2 rounded bg-emerald-500/20 px-1 py-0.5 text-xs text-emerald-400">CURRENT</span>}
                </div>
              </div>
              <p className="text-xs text-muted-foreground/60 mt-0.5">No API key. Model auto-downloads on first use (~0.6 GB).</p>
            </button>
          </div>

          {availableModels.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                Available (remote)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {availableModels.map((m) => {
                  const sel = m.provider === provider && m.model === model;
                  const cur = m.provider === currentProvider && m.model === currentModel;
                  return (
                    <button
                      key={m.provider + "/" + m.model}
                      onClick={() => { setProvider(m.provider); setModel(m.model); }}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left transition-all",
                        sel
                          ? "border-violet-500/40 bg-violet-500/15"
                          : "border-foreground/10 bg-foreground/5 hover:border-foreground/15"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn("text-xs font-medium", sel ? "text-violet-300" : "text-foreground/70")}>{m.label}</span>
                        {cur && <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-xs text-emerald-400">CURRENT</span>}
                      </div>
                      <p className="text-xs text-muted-foreground/60 mt-0.5">{m.dims}d &middot; {m.provider}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Locked models — providers not authenticated */}
          {lockedModels.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/40 mb-1.5 flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Requires Authentication
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 opacity-50">
                {lockedModels.map((m) => (
                  <div
                    key={m.provider + "/" + m.model}
                    className="rounded-lg border border-foreground/5 bg-foreground/5 px-3 py-2 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Lock className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                      <span className="text-xs font-medium text-muted-foreground/60">{m.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground/40 mt-0.5">{m.dims}d &middot; {m.provider}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2 rounded-lg border border-foreground/10 bg-muted/30 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                  Authenticate providers via the onboarding wizard (API keys; no plugins required):
                </p>
                <ul className="mt-1.5 pl-5 space-y-1 text-xs font-mono text-muted-foreground/70 list-disc">
                  {lockedProviders.map((p) => (
                    <li key={p}>
                      <code className="rounded bg-muted px-1 py-0.5 text-violet-400/80">{authCommandForProvider(p)}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}

      {/* Local model path — when using local provider */}
      {provider === "local" && (
        <div className="space-y-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Local model path</p>
          <input
            value={localModelPath}
            onChange={(e) => setLocalModelPath(e.target.value)}
            placeholder={DEFAULT_LOCAL_MODEL_PATH}
            className="w-full rounded-lg border border-foreground/10 bg-muted px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
          />
          <p className="text-xs text-muted-foreground/70">
            Leave empty to use the default (EmbeddingGemma, ~0.6 GB). Use a path to a GGUF file or an <code className="rounded bg-muted px-1">hf:...</code> URI. The model auto-downloads on first use. See{" "}
            <a href="https://docs.openclaw.ai/concepts/memory#vector-memory-search" target="_blank" rel="noopener noreferrer" className="text-violet-400 underline hover:text-violet-300">docs</a>.
          </p>
        </div>
      )}

      {/* Advanced: fallback + cache */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/60 hover:text-foreground/70"
        >
          {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Advanced
        </button>
        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-foreground/10 bg-muted/30 p-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Fallback provider</span>
              <select value={fallback} onChange={(e) => setFallback(e.target.value)} className="w-full rounded-lg border border-foreground/10 bg-muted px-3 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30">
                <option value="none">None</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="local">Local</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pt-6">
              <input type="checkbox" checked={cacheEnabled} onChange={(e) => setCacheEnabled(e.target.checked)} className="rounded border-foreground/20" />
              <span className="text-xs text-muted-foreground">Embedding cache (faster reindex)</span>
            </label>
          </div>
        )}
      </div>

      {/* Custom entry */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Or enter custom</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-lg border border-foreground/10 bg-muted px-3 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30" placeholder="Provider" />
          <input value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg border border-foreground/10 bg-muted px-3 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30" placeholder="Model" />
        </div>
      </div>

      {/* Reindex warning */}
      {(provider !== currentProvider || model !== currentModel) && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs text-amber-300"><AlertTriangle className="h-3 w-3" />Changing model requires a full reindex. Existing embeddings will be replaced.{preset && currentDims && preset.dims !== currentDims && " Vector dimensions will change."}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            const options: EmbeddingOptions = {};
            if (provider === "local" && localModelPath.trim()) options.localModelPath = localModelPath.trim();
            if (fallback && fallback !== "none") options.fallback = fallback;
            options.cacheEnabled = cacheEnabled;
            onSave(provider, model, options);
            setEditing(false);
          }}
          disabled={saving || !provider.trim() || !model.trim() || (provider === currentProvider && model === currentModel)}
          className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <span className="inline-flex items-center gap-0.5"><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" /></span> : <Save className="h-3.5 w-3.5" />}Save & Reindex
        </button>
        <button onClick={() => { setEditing(false); setProvider(currentProvider); setModel(currentModel); }} className="rounded-lg px-3 py-2 text-xs text-muted-foreground hover:text-foreground/90">Cancel</button>
      </div>
    </div>
  );
}

/* ── Setup Wizard ────────────────────────────────── */

type SetupProvider = { id: string; provider: string; model: string; dims: number; label: string; description: string; needsKey: string; icon: string };

const SETUP_OPTIONS: SetupProvider[] = [
  { id: "openai", provider: "openai", model: "text-embedding-3-small", dims: 1536, label: "OpenAI", description: "Best quality, widely used. Requires OPENAI_API_KEY.", needsKey: "OPENAI_API_KEY", icon: "🟢" },
  { id: "openai-large", provider: "openai", model: "text-embedding-3-large", dims: 3072, label: "OpenAI (Large)", description: "Higher quality, 3072 dimensions. More expensive.", needsKey: "OPENAI_API_KEY", icon: "🟢" },
  { id: "google", provider: "google", model: "text-embedding-004", dims: 768, label: "Google Gemini", description: "Free tier available. Requires GEMINI_API_KEY.", needsKey: "GEMINI_API_KEY", icon: "🔵" },
  { id: "local", provider: "local", model: "auto", dims: 0, label: "Local (Offline)", description: "Runs on your device. No API key needed. Downloads ~600MB model.", needsKey: "", icon: "💻" },
];

function SetupWizard({ authProviders, onSetup, busy }: { authProviders: string[]; onSetup: (provider: string, model: string, options?: { localModelPath?: string }) => void; busy: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [customProvider, setCustomProvider] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [localModelPath, setLocalModelPath] = useState("");

  // Auto-select best available option
  useEffect(() => {
    if (selected) return;
    queueMicrotask(() => {
      if (authProviders.includes("openai")) { setSelected("openai"); return; }
      if (authProviders.includes("google")) { setSelected("google"); return; }
      setSelected("local");
    });
  }, [authProviders, selected]);

  const recommended = SETUP_OPTIONS.find((o) => {
    if (authProviders.includes("openai")) return o.id === "openai";
    if (authProviders.includes("google")) return o.id === "google";
    return o.id === "local";
  });

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl space-y-6">
        {/* Hero */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/15">
            <Database className="h-8 w-8 text-violet-400" />
          </div>
          <h1 className="text-sm font-semibold text-foreground">Set Up Vector Memory</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Vector memory lets your agents search notes, documents, and knowledge semantically.
            Pick an embedding provider to get started — it takes one click.
          </p>
        </div>

        {/* Provider cards */}
        <div className="space-y-2">
          {SETUP_OPTIONS.map((opt) => {
            const isAuth = opt.provider === "local" || authProviders.includes(opt.provider);
            const isSel = selected === opt.id;
            const isRec = recommended?.id === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelected(opt.id)}
                disabled={!isAuth}
                className={cn(
                  "w-full rounded-xl border p-4 text-left transition-all",
                  !isAuth
                    ? "cursor-not-allowed border-foreground/5 bg-foreground/5 opacity-50"
                    : isSel
                      ? "border-violet-500/40 bg-violet-500/10 scale-105"
                      : "border-foreground/10 bg-foreground/5 hover:border-foreground/15"
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{opt.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={cn("text-xs font-semibold", isSel ? "text-violet-300" : isAuth ? "text-foreground/90" : "text-foreground/50")}>{opt.label}</p>
                      {isRec && isAuth && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">RECOMMENDED</span>
                      )}
                      {isAuth && !isSel && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400/80">Ready</span>
                      )}
                      {!isAuth && (
                        <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          <Lock className="h-2.5 w-2.5" />No API key
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                    {opt.dims > 0 && (
                      <p className="text-xs text-muted-foreground/50 mt-0.5">
                        {opt.model} · {opt.dims}d vectors
                      </p>
                    )}
                  </div>
                  {isSel && isAuth && (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3.5 w-3.5 text-white" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Auth hint for locked providers — use onboard (API keys), not models auth login (needs plugins) */}
        {SETUP_OPTIONS.some((o) => o.provider !== "local" && !authProviders.includes(o.provider)) && (
          <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-3.5">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-violet-400" />
              Add your API key via the onboarding wizard:
            </p>
            <ul className="mt-2 space-y-1 pl-5 list-disc text-xs font-mono text-muted-foreground/60">
              {!authProviders.includes("openai") && (
                <li><code className="rounded bg-muted px-1.5 py-0.5 text-violet-400/80">openclaw onboard --auth-choice openai-api-key</code></li>
              )}
              {!authProviders.includes("google") && (
                <li><code className="rounded bg-muted px-1.5 py-0.5 text-violet-400/80">openclaw onboard --auth-choice gemini-api-key</code></li>
              )}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground/70">
              Or run <code className="rounded bg-muted px-1 py-0.5">openclaw onboard</code> and pick a provider in the wizard.
            </p>
          </div>
        )}

        {/* Local model path — when Local is selected */}
        {selected === "local" && (
          <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-3.5 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Local model (optional)</p>
            <input
              value={localModelPath}
              onChange={(e) => setLocalModelPath(e.target.value)}
              placeholder={DEFAULT_LOCAL_MODEL_PATH}
              className="w-full rounded-lg border border-foreground/10 bg-muted px-3 py-2 font-mono text-xs text-foreground/90 outline-none focus:border-violet-500/30"
            />
            <p className="text-xs text-muted-foreground/70">
              Leave empty to use the default (auto-downloads ~0.6 GB). Or set a path or <code className="rounded bg-muted px-1">hf:...</code> URI.{" "}
              <a href="https://docs.openclaw.ai/concepts/memory#vector-memory-search" target="_blank" rel="noopener noreferrer" className="text-violet-400 underline hover:text-violet-300">Docs</a>
            </p>
          </div>
        )}

        {/* Or configure manually — always allow setting provider/model via app */}
        <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-3.5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Or configure manually</p>
          <p className="text-xs text-muted-foreground">
            Enter any embedding provider and model (e.g. after authenticating with the commands above).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={customProvider}
              onChange={(e) => setCustomProvider(e.target.value)}
              placeholder="Provider (e.g. openai)"
              className="rounded-lg border border-foreground/10 bg-muted px-3 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30"
            />
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="Model (e.g. text-embedding-3-small)"
              className="rounded-lg border border-foreground/10 bg-muted px-3 py-2 text-xs text-foreground/90 outline-none focus:border-violet-500/30"
            />
          </div>
          <button
            type="button"
            disabled={busy || !customProvider.trim() || !customModel.trim()}
            onClick={() => onSetup(customProvider.trim(), customModel.trim())}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <span className="inline-flex items-center gap-0.5"><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" /></span> : <Save className="h-3.5 w-3.5" />}
            Save & Enable
          </button>
        </div>

        {/* Action */}
        {selected && (
          <div className="text-center">
            <button
              type="button"
              disabled={busy || !selected}
              onClick={() => {
                const opt = SETUP_OPTIONS.find((o) => o.id === selected);
                if (opt) onSetup(opt.provider, opt.model, selected === "local" && localModelPath.trim() ? { localModelPath: localModelPath.trim() } : undefined);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-8 py-3 text-xs font-semibold transition hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? (
                <><span className="inline-flex items-center gap-0.5"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" /></span>Setting up...</>
              ) : (
                <><Zap className="h-4 w-4" />Enable Vector Memory</>
              )}
            </button>
            <p className="mt-2 text-xs text-muted-foreground/40">
              This configures your embedding provider and runs the initial index.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewStat({ icon: Icon, value, label, sub, color }: { icon: React.ComponentType<{ className?: string }>; value: string; label: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1"><Icon className={cn("h-3.5 w-3.5", color)} />{label}</div>
      <p className="text-xs font-semibold text-foreground/90">{value}</p>
      {sub && <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

export function VectorView() {
  const [agents, setAgents] = useState<AgentMemory[]>([]);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [apiDegraded, setApiDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [ensuringExtraPaths, setEnsuringExtraPaths] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [query, setQuery] = useState("");
  const [searchAgent, setSearchAgent] = useState("");
  const [maxResults, setMaxResults] = useState("10");
  const [minScore, setMinScore] = useState("");
  const [sortBy, setSortBy] = useState<"score" | "path">("score");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [searchTime, setSearchTime] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [authProviders, setAuthProviders] = useState<string[]>([]);
  const [memorySearch, setMemorySearch] = useState<Record<string, unknown> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/vector?scope=status");
      const data = await res.json();
      setApiWarning(
        typeof data.warning === "string" && data.warning.trim()
          ? data.warning.trim()
          : null
      );
      setApiDegraded(Boolean(data.degraded));
      setAgents(data.agents || []);
      setAuthProviders(data.authProviders || []);
      setMemorySearch(data.memorySearch || null);
    }
    catch (err) {
      console.error("Vector fetch:", err);
      setApiWarning(err instanceof Error ? err.message : String(err));
      setApiDegraded(true);
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const doSearch = useCallback(async (q: string) => {
    if (!q || q.trim().length < 2) { setResults([]); setLastQuery(""); return; }
    setSearching(true); const start = performance.now();
    try {
      const p = new URLSearchParams({ scope: "search", q: q.trim(), max: maxResults });
      if (searchAgent) p.set("agent", searchAgent);
      if (minScore) p.set("minScore", minScore);
      const res = await fetch("/api/vector?" + p); const data = await res.json();
      setResults(data.results || []); setLastQuery(q); setSearchTime(Math.round(performance.now() - start));
    } catch { setResults([]); } finally { setSearching(false); }
  }, [searchAgent, maxResults, minScore]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => doSearch(query), 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [query, doSearch]);

  const handleReindex = useCallback(async (agentId: string, force: boolean) => {
    setReindexing(true);
    try {
      const res = await fetch("/api/vector", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reindex", agent: agentId, force }) });
      const d = await res.json();
      if (d.ok) { setToast({ message: agentId + (force ? " force" : "") + " reindexed", type: "success" }); await fetchStatus(); }
      else setToast({ message: d.error || "Reindex failed", type: "error" });
    } catch (e) { setToast({ message: String(e), type: "error" }); } finally { setReindexing(false); }
  }, [fetchStatus]);

  const handleEnsureExtraPaths = useCallback(async () => {
    setEnsuringExtraPaths(true);
    try {
      const res = await fetch("/api/vector", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensure-extra-paths" }) });
      const d = await res.json();
      if (d.ok) {
        const paths = (d.extraPaths as string[]) || [];
        setToast({ message: paths.length > 0 ? `Added ${paths.length} reference file(s) to index and reindexed` : d.message || "Done", type: "success" });
        await fetchStatus();
      } else setToast({ message: d.error || "Failed", type: "error" });
    } catch (e) { setToast({ message: String(e), type: "error" }); } finally { setEnsuringExtraPaths(false); }
  }, [fetchStatus]);

  const handleUpdateModel = useCallback(async (prov: string, mod: string, options?: EmbeddingOptions) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { action: "update-embedding-model", provider: prov, model: mod };
      if (options?.localModelPath !== undefined) body.localModelPath = options.localModelPath;
      if (options?.fallback !== undefined) body.fallback = options.fallback;
      if (options?.cacheEnabled !== undefined) body.cacheEnabled = options.cacheEnabled;
      const res = await fetch("/api/vector", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (d.ok) { setToast({ message: "Model changed to " + prov + "/" + mod + ". Run reindex.", type: "success" }); await fetchStatus(); }
      else setToast({ message: d.error || "Failed", type: "error" });
    } catch (e) { setToast({ message: String(e), type: "error" }); } finally { setSaving(false); }
  }, [fetchStatus]);

  const handleSetup = useCallback(async (provider: string, model: string, options?: { localModelPath?: string }) => {
    setSettingUp(true);
    try {
      const body: Record<string, unknown> = { action: "setup-memory", provider, model };
      if (options?.localModelPath) body.localModelPath = options.localModelPath;
      const res = await fetch("/api/vector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.ok) {
        setToast({ message: "Vector memory enabled with " + provider + "/" + model + "!", type: "success" });
        setLoading(true);
        await fetchStatus();
      } else {
        setToast({ message: d.error || "Setup failed", type: "error" });
      }
    } catch (e) {
      setToast({ message: String(e), type: "error" });
    } finally {
      setSettingUp(false);
    }
  }, [fetchStatus]);

  const sorted = useMemo(() => { const r = [...results]; if (sortBy === "path") r.sort((a, b) => a.path.localeCompare(b.path)); return r; }, [results, sortBy]);

  const totalChunks = agents.reduce((s, a) => s + a.status.chunks, 0);
  const totalFiles = agents.reduce((s, a) => s + a.status.files, 0);
  const totalDb = agents.reduce((s, a) => s + a.dbSizeBytes, 0);
  const dirtyNamespaces = agents.filter((a) => a.status.dirty).length;
  const vectorReadyNamespaces = agents.filter((a) => a.status.vector.available).length;
  const ftsReadyNamespaces = agents.filter((a) => a.status.fts.available).length;
  const primary = agents.find((a) => a.agentId === "main") || agents[0];
  const curProv = primary?.status.provider || "";
  const curModel = primary?.status.model || "";
  const curDims = primary?.status.vector.dims || null;
  const curBackend = primary?.status.backend || "";

  // Determine if setup is needed:
  // - No agents returned, OR
  // - memorySearch not configured, OR
  // - No provider detected, OR
  // - Zero chunks across all agents and no provider set
  const needsSetup =
    agents.length === 0 ||
    (!memorySearch && !curProv) ||
    (totalChunks === 0 && totalFiles === 0 && !curProv);

  if (loading) return <LoadingState label="Loading vector memory..." size="lg" />;

  if (needsSetup) {
    return (
      <>
        <SetupWizard authProviders={authProviders} onSetup={handleSetup} busy={settingUp} />
        {toast && <ToastBar toast={toast} onDone={() => setToast(null)} />}
      </>
    );
  }

  return (
    <SectionLayout>
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <Database className="h-5 w-5 text-violet-400" />
            Vector Memory
          </span>
        }
        description="Browse, search, and manage your embedding index"
        actions={
          <div className="flex items-center gap-2">
            <ApiWarningBadge warning={apiWarning} degraded={apiDegraded} />
            <button
              onClick={() => {
                setLoading(true);
                fetchStatus();
              }}
              className="rounded-lg p-2 text-muted-foreground hover:bg-foreground/10 hover:text-foreground/70"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        }
      />
      <SectionBody width="content" padding="regular" innerClassName="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <OverviewStat icon={Layers} value={String(totalChunks)} label="Total Chunks" color="text-violet-400" />
          <OverviewStat icon={FileText} value={String(totalFiles)} label="Indexed Files" color="text-sky-400" />
          <OverviewStat icon={HardDrive} value={formatBytes(totalDb)} label="DB Size" color="text-emerald-400" />
          <OverviewStat icon={Activity} value={`${agents.length - dirtyNamespaces}/${agents.length}`} label="Index Health" sub={dirtyNamespaces > 0 ? `${dirtyNamespaces} namespace${dirtyNamespaces > 1 ? "s" : ""} need reindex` : "All namespaces clean"} color={dirtyNamespaces > 0 ? "text-amber-400" : "text-emerald-400"} />
          <OverviewStat icon={Hash} value={`${vectorReadyNamespaces}/${agents.length}`} label="Vector Ready" sub={`FTS ${ftsReadyNamespaces}/${agents.length}`} color="text-pink-400" />
        </div>

        {/* Explicit OpenAI-for-embeddings status so you can see at a glance if it's configured */}
        <div className="rounded-lg border border-foreground/10 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Embedding status: </span>
          {curProv === "openai" ? (
            <span>OpenAI is configured for embeddings ({curModel}).</span>
          ) : authProviders.includes("openai") ? (
            <span>Current provider is <span className="font-mono">{curProv || "—"}/{curModel || "—"}</span>. OpenAI is available — click Change below to use it for embeddings.</span>
          ) : curProv ? (
            <span>Current: <span className="font-mono">{curProv}/{curModel}</span>. To add OpenAI for embeddings, run <code className="rounded bg-muted px-1 py-0.5 text-violet-400/90">openclaw onboard --auth-choice openai-api-key</code> then refresh.</span>
          ) : (
            <span>No embedding provider set. Use &quot;Or configure manually&quot; below with provider <span className="font-mono">openai</span> and model <span className="font-mono">text-embedding-3-small</span> after running <code className="rounded bg-muted px-1 py-0.5 text-violet-400/90">openclaw onboard --auth-choice openai-api-key</code>.</span>
          )}
        </div>

        <EmbeddingModelEditor
          currentProvider={curProv}
          currentModel={curModel}
          currentDims={curDims}
          currentBackend={curBackend}
          memorySearch={memorySearch}
          onSave={handleUpdateModel}
          saving={saving}
        />

        <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90"><Search className="h-4 w-4 text-violet-400" />Query Console</div>
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" /><input type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doSearch(query); }} placeholder="Semantic search across your vector memory..." className="w-full rounded-lg border border-foreground/10 bg-muted py-2.5 pl-10 pr-4 text-sm text-foreground/90 placeholder-zinc-600 outline-none focus:border-violet-500/30" />{searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:0ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:150ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:300ms]" /></span>}</div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5"><Filter className="h-3 w-3 text-muted-foreground/60" /><span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Filters</span></div>
            <select value={searchAgent} onChange={(e) => setSearchAgent(e.target.value)} className="rounded-md border border-foreground/10 bg-muted px-2.5 py-1.5 text-xs text-foreground/70 outline-none"><option value="">All namespaces</option>{agents.map((a) => <option key={a.agentId} value={a.agentId}>{a.agentId}</option>)}</select>
            <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground/60">Top-K:</span><select value={maxResults} onChange={(e) => setMaxResults(e.target.value)} className="rounded-md border border-foreground/10 bg-muted px-2 py-1.5 text-xs text-foreground/70 outline-none">{["3","5","10","20","50"].map((v) => <option key={v} value={v}>{v}</option>)}</select></div>
            <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground/60">Min score:</span><input type="number" step="0.05" min="0" max="1" value={minScore} onChange={(e) => setMinScore(e.target.value)} placeholder="0.0" className="w-16 rounded-md border border-foreground/10 bg-muted px-2 py-1.5 text-xs text-foreground/70 outline-none" /></div>
            <div className="flex items-center gap-1.5"><ArrowUpDown className="h-3 w-3 text-muted-foreground/60" /><select value={sortBy} onChange={(e) => setSortBy(e.target.value as "score"|"path")} className="rounded-md border border-foreground/10 bg-muted px-2 py-1.5 text-xs text-foreground/70 outline-none"><option value="score">By score</option><option value="path">By path</option></select></div>
          </div>
          {lastQuery && <div className="flex items-center gap-3 text-xs text-muted-foreground"><span>{results.length} result{results.length !== 1 ? "s" : ""} for <span className="font-medium text-violet-400">{"\u201C"}{lastQuery}{"\u201D"}</span></span><span className="text-muted-foreground/40">&middot;</span><span>{searchTime}ms</span>{results.length > 0 && <><span className="text-muted-foreground/40">&middot;</span><span>top: <span className={cn("font-mono", scoreColor(results[0].score))}>{results[0].score.toFixed(4)}</span></span></>}</div>}
        </div>

        {sorted.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><BarChart3 className="h-3.5 w-3.5" />Results<span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{sorted.length}</span></div>
            {sorted.map((r, i) => <ResultCard key={r.path + "-" + r.startLine + "-" + i} result={r} rank={i + 1} />)}
          </div>
        )}

        {lastQuery && results.length === 0 && !searching && (
          <div className="rounded-xl border border-dashed border-foreground/10 bg-muted/50 p-8 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No results for <span className="text-violet-400">{"\u201C"}{lastQuery}{"\u201D"}</span></p>
            <p className="text-xs text-muted-foreground/60 mt-1">Try different keywords or lower the minimum score.</p>
          </div>
        )}

        <div><h2 className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground/90"><Database className="h-4 w-4 text-violet-400" />Namespaces<span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{agents.length}</span></h2><div className="space-y-2">{agents.map((a) => <AgentIndexCard key={a.agentId} agent={a} onReindex={handleReindex} reindexing={reindexing} />)}</div></div>

        <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90"><FileText className="h-4 w-4 text-violet-400" />Workspace reference files</div>
              <p className="text-xs text-muted-foreground mt-0.5">Include all root-level <code className="rounded bg-muted px-1 text-xs">.md</code> files in semantic search so the index covers your full workspace knowledge, not just <code className="rounded bg-muted px-1 text-xs">memory/</code>.</p>
            </div>
            <button type="button" onClick={handleEnsureExtraPaths} disabled={ensuringExtraPaths} className="shrink-0 flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
              {ensuringExtraPaths ? <span className="inline-flex items-center gap-0.5"><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" /></span> : <FileText className="h-3.5 w-3.5" />}
              {ensuringExtraPaths ? "Adding & reindexing…" : "Include reference files in search"}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90"><Settings2 className="h-4 w-4 text-muted-foreground" />How It Works</div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>OpenClaw indexes workspace <code className="rounded bg-foreground/10 px-1 text-xs text-muted-foreground">memory/</code> files into SQLite with vector embeddings (sqlite-vec). Use &quot;Include reference files in search&quot; above to also index root-level <code className="rounded bg-foreground/10 px-1 text-xs text-muted-foreground">.md</code> files.</p>
            <p>Each file is chunked and embedded using the configured model (default: text-embedding-3-small, 1536d). Search uses cosine similarity. FTS5 is available as fallback.</p>
          </div>
          <div className="rounded-lg bg-muted p-3 font-mono text-xs text-muted-foreground space-y-0.5">
            <p><span className="text-violet-400">openclaw memory status</span> <span className="text-muted-foreground/60"># Index status</span></p>
            <p><span className="text-violet-400">openclaw memory index</span> <span className="text-muted-foreground/60"># Incremental reindex</span></p>
            <p><span className="text-violet-400">openclaw memory index --force</span> <span className="text-muted-foreground/60"># Full reindex</span></p>
            <p><span className="text-violet-400">openclaw memory search &quot;query&quot;</span> <span className="text-muted-foreground/60"># Semantic search</span></p>
          </div>
        </div>
      </SectionBody>
      {toast && <ToastBar toast={toast} onDone={() => setToast(null)} />}
    </SectionLayout>
  );
}
