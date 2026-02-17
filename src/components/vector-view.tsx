"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Database, Search, RefreshCw, ChevronDown, ChevronUp, Check,
  AlertTriangle, Loader2, X, FileText, Hash, Cpu, HardDrive,
  Layers, RotateCcw, Activity, Filter, ArrowUpDown, Eye, Copy,
  Box, BarChart3, CircleDot, Settings2, Pencil, Save, Lock, KeyRound,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";

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
    <div className={cn("fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-[13px] font-medium shadow-xl backdrop-blur-sm", toast.type === "success" ? "border-emerald-500/30 bg-emerald-950/80 text-emerald-300" : "border-red-500/30 bg-red-950/80 text-red-300")}>
      <div className="flex items-center gap-2">{toast.type === "success" ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{toast.message}</div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-foreground/[0.06]"><div className={cn("h-1.5 rounded-full transition-all", scoreBarColor(score))} style={{ width: Math.round(score * 100) + "%" }} /></div>
      <span className={cn("text-[12px] font-mono font-semibold", scoreColor(score))}>{score.toFixed(4)}</span>
    </div>
  );
}

function ResultCard({ result, rank }: { result: SearchResult; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] transition-all hover:border-foreground/[0.1]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-[11px] font-bold text-violet-400">#{rank}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span className="truncate text-[13px] font-medium text-foreground/90">{result.path}</span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">L{result.startLine}-{result.endLine}</span>
            <span className="shrink-0 rounded border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-400">{result.source}</span>
          </div>
        </div>
        <ScoreBar score={result.score} />
        <div className="flex items-center gap-1">
          <button onClick={() => { navigator.clipboard.writeText(result.snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/70" title="Copy">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => setExpanded(!expanded)} className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/70">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {!expanded && <div className="border-t border-foreground/[0.03] px-4 py-2"><p className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">{result.snippet.replace(/\n+/g, " ").substring(0, 200)}</p></div>}
      {expanded && (
        <div className="border-t border-foreground/[0.06] px-4 py-3">
          <div className="flex items-center gap-2 mb-2"><Hash className="h-3 w-3 text-muted-foreground/60" /><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Vector Match - Chunk Content</span></div>
          <pre className="max-h-[400px] overflow-auto rounded-lg bg-muted p-3 text-[12px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">{result.snippet}</pre>
          <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground/60">
            <span>Lines {result.startLine}-{result.endLine}</span><span>{result.snippet.length} chars</span><span>~{Math.ceil(result.snippet.split(/\s+/).length)} tokens (est.)</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-foreground/[0.04] bg-muted/50 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-0.5"><Icon className="h-3 w-3" />{label}</div>
      <p className="text-[12px] font-mono text-foreground/70 truncate" title={value}>{value}</p>
    </div>
  );
}

function AgentIndexCard({ agent, onReindex, reindexing }: { agent: AgentMemory; onReindex: (id: string, force: boolean) => void; reindexing: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const st = agent.status; const vec = st.vector;
  return (
    <div className={cn("rounded-xl border transition-all", agent.scan.issues.length > 0 ? "border-amber-500/20 bg-amber-500/[0.03]" : "border-foreground/[0.06] bg-foreground/[0.02]")}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-lg">{agent.agentId === "main" ? "\u{1F99E}" : "\u{1F480}"}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-foreground/90 capitalize">{agent.agentId}</span>
            {st.dirty && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">Dirty</span>}
            {vec.available && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">Vector</span>}
            {st.fts.available && <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-300">FTS</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>{st.files} files</span><span>{st.chunks} chunks</span>{vec.dims && <span>{vec.dims}d vectors</span>}<span>{formatBytes(agent.dbSizeBytes)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onReindex(agent.agentId, false)} disabled={reindexing} className="flex items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-3 py-1.5 text-[11px] font-medium text-foreground/70 hover:bg-foreground/[0.1] disabled:opacity-50">
            {reindexing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Reindex
          </button>
          <button onClick={() => setExpanded(!expanded)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground/70">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-foreground/[0.04] px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat icon={Layers} label="Backend" value={st.backend} />
            <MiniStat icon={Cpu} label="Provider" value={st.provider} />
            <MiniStat icon={Box} label="Model" value={st.model} />
            <MiniStat icon={Hash} label="Dimensions" value={vec.dims ? String(vec.dims) : "\u2014"} />
          </div>
          {st.sourceCounts.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">Sources</p>
              <div className="space-y-1">{st.sourceCounts.map((sc) => (
                <div key={sc.source} className="flex items-center justify-between rounded-lg border border-foreground/[0.04] bg-muted/50 px-3 py-2">
                  <div className="flex items-center gap-2"><CircleDot className="h-3 w-3 text-violet-400" /><span className="text-[12px] text-foreground/70">{sc.source}</span></div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground"><span>{sc.files} files</span><span>{sc.chunks} chunks</span></div>
                </div>
              ))}</div>
            </div>
          )}
          <div className="flex items-center gap-4 text-[11px]">
            <span className="text-muted-foreground/60">Cache: <span className={st.cache.enabled ? "text-emerald-400" : "text-muted-foreground/60"}>{st.cache.enabled ? st.cache.entries + " entries" : "disabled"}</span></span>
            <span className="text-muted-foreground/60">FTS: <span className={st.fts.available ? "text-emerald-400" : "text-red-400"}>{st.fts.available ? "available" : "unavailable"}</span></span>
            <span className="text-muted-foreground/60">Vector: <span className={vec.available ? "text-emerald-400" : "text-red-400"}>{vec.available ? "available" : "unavailable"}</span></span>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2"><p className="text-[10px] text-muted-foreground/60 mb-0.5">Database Path</p><code className="text-[11px] text-muted-foreground break-all">{st.dbPath}</code></div>
          {agent.scan.issues.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 space-y-1">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-300"><AlertTriangle className="h-3 w-3" />Issues</p>
              {agent.scan.issues.map((issue, i) => <p key={i} className="text-[11px] text-amber-400/80 pl-5">{issue}</p>)}
            </div>
          )}
          <button onClick={() => onReindex(agent.agentId, true)} disabled={reindexing} className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-1.5 text-[11px] text-red-400 hover:bg-red-500/[0.1] disabled:opacity-50">
            <RotateCcw className="h-3 w-3" />Force Full Reindex
          </button>
        </div>
      )}
    </div>
  );
}

function EmbeddingModelEditor({
  currentProvider,
  currentModel,
  currentDims,
  currentBackend,
  onSave,
  saving,
}: {
  currentProvider: string;
  currentModel: string;
  currentDims: number | null;
  currentBackend: string;
  onSave: (p: string, m: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(currentProvider);
  const [model, setModel] = useState(currentModel);
  const [authProviders, setAuthProviders] = useState<Set<string>>(new Set());
  const [authLoading, setAuthLoading] = useState(false);
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

  // Split models into available (authenticated) and locked (not authenticated)
  const availableModels = useMemo(
    () => EMBEDDING_MODELS.filter((m) => authProviders.has(m.provider)),
    [authProviders]
  );
  const lockedModels = useMemo(
    () => EMBEDDING_MODELS.filter((m) => !authProviders.has(m.provider)),
    [authProviders]
  );
  const lockedProviders = useMemo(
    () => [...new Set(lockedModels.map((m) => m.provider))],
    [lockedModels]
  );

  if (!editing) return (
    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground/90"><Cpu className="h-4 w-4 text-violet-400" />Index Control Plane</div>
        <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-3 py-1.5 text-[11px] font-medium text-foreground/70 hover:bg-foreground/[0.1]"><Pencil className="h-3 w-3" />Change</button>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-foreground/[0.04] bg-muted/50 px-3 py-2"><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Provider</p><p className="text-[13px] font-mono text-foreground/90 mt-0.5">{currentProvider}</p></div>
        <div className="rounded-lg border border-foreground/[0.04] bg-muted/50 px-3 py-2"><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Model</p><p className="text-[13px] font-mono text-foreground/90 mt-0.5 truncate" title={currentModel}>{currentModel}</p><p className="mt-1 text-[10px] text-muted-foreground/70">{currentDims ? `${currentDims}d embeddings` : "\u2014"}</p></div>
        <div className="rounded-lg border border-foreground/[0.04] bg-muted/50 px-3 py-2"><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Backend</p><p className="text-[13px] font-mono text-foreground/90 mt-0.5">{currentBackend || "\u2014"}</p></div>
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.04] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground/90"><Cpu className="h-4 w-4 text-violet-400" />Change Embedding Model</div>
        <button onClick={() => { setEditing(false); setProvider(currentProvider); setModel(currentModel); }} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground/70"><X className="h-4 w-4" /></button>
      </div>
      <p className="text-[11px] text-muted-foreground">Changing the embedding model requires a full reindex.</p>

      {/* Available models — from authenticated providers */}
      {authLoading ? (
        <div className="flex items-center gap-2 py-4 text-[11px] text-muted-foreground/60">
          <Loader2 className="h-3 w-3 animate-spin" />Checking authenticated providers...
        </div>
      ) : (
        <>
          {availableModels.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                Available Models
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
                          : "border-foreground/[0.06] bg-foreground/[0.02] hover:border-foreground/[0.12]"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn("text-[12px] font-medium", sel ? "text-violet-300" : "text-foreground/70")}>{m.label}</span>
                        {cur && <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[8px] text-emerald-400">CURRENT</span>}
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{m.dims}d &middot; {m.provider}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Locked models — providers not authenticated */}
          {lockedModels.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40 mb-1.5 flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Requires Authentication
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 opacity-50">
                {lockedModels.map((m) => (
                  <div
                    key={m.provider + "/" + m.model}
                    className="rounded-lg border border-foreground/[0.04] bg-foreground/[0.01] px-3 py-2 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Lock className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                      <span className="text-[12px] font-medium text-muted-foreground/60">{m.label}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/40 mt-0.5">{m.dims}d &middot; {m.provider}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2 rounded-lg border border-foreground/[0.06] bg-muted/30 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                  Authenticate more providers to unlock these models:
                </p>
                <p className="mt-1 pl-5 text-[11px] font-mono text-muted-foreground/70">
                  {lockedProviders.map((p, i) => (
                    <span key={p}>
                      {i > 0 && ", "}
                      <code className="rounded bg-muted px-1 py-0.5 text-violet-400/80">openclaw models auth --provider {p}</code>
                    </span>
                  ))}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Custom entry */}
      <div className="space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Or enter custom</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-lg border border-foreground/[0.08] bg-muted px-3 py-2 text-[12px] text-foreground/90 outline-none focus:border-violet-500/30" placeholder="Provider" />
          <input value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg border border-foreground/[0.08] bg-muted px-3 py-2 text-[12px] text-foreground/90 outline-none focus:border-violet-500/30" placeholder="Model" />
        </div>
      </div>

      {/* Reindex warning */}
      {(provider !== currentProvider || model !== currentModel) && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] text-amber-300"><AlertTriangle className="h-3 w-3" />Changing model requires a full reindex. Existing embeddings will be replaced.{preset && currentDims && preset.dims !== currentDims && " Vector dimensions will change."}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button onClick={() => { onSave(provider, model); setEditing(false); }} disabled={saving || !provider.trim() || !model.trim() || (provider === currentProvider && model === currentModel)} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[12px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save & Reindex
        </button>
        <button onClick={() => { setEditing(false); setProvider(currentProvider); setModel(currentModel); }} className="rounded-lg px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground/90">Cancel</button>
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

function SetupWizard({ authProviders, onSetup, busy }: { authProviders: string[]; onSetup: (provider: string, model: string) => void; busy: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);

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
          <h1 className="text-[22px] font-semibold text-foreground">Set Up Vector Memory</h1>
          <p className="text-[13px] text-muted-foreground max-w-md mx-auto">
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
                    ? "cursor-not-allowed border-foreground/[0.04] bg-foreground/[0.01] opacity-50"
                    : isSel
                      ? "border-violet-500/40 bg-violet-500/10 scale-[1.01]"
                      : "border-foreground/[0.06] bg-foreground/[0.02] hover:border-foreground/[0.12]"
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{opt.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={cn("text-[14px] font-semibold", isSel ? "text-violet-300" : isAuth ? "text-foreground/90" : "text-foreground/50")}>{opt.label}</p>
                      {isRec && isAuth && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-semibold text-emerald-300">RECOMMENDED</span>
                      )}
                      {isAuth && !isSel && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-medium text-emerald-400/80">Ready</span>
                      )}
                      {!isAuth && (
                        <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">
                          <Lock className="h-2.5 w-2.5" />No API key
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{opt.description}</p>
                    {opt.dims > 0 && (
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                        {opt.model} · {opt.dims}d vectors
                      </p>
                    )}
                  </div>
                  {isSel && isAuth && (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500">
                      <Check className="h-3.5 w-3.5 text-white" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Auth hint for locked providers */}
        {SETUP_OPTIONS.some((o) => o.provider !== "local" && !authProviders.includes(o.provider)) && (
          <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3.5">
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-violet-400" />
              Missing a provider? Add your API key:
            </p>
            <div className="mt-2 space-y-1 pl-5">
              {!authProviders.includes("openai") && (
                <p className="text-[11px] font-mono text-muted-foreground/60">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-violet-400/80">openclaw models auth --provider openai</code>
                </p>
              )}
              {!authProviders.includes("google") && (
                <p className="text-[11px] font-mono text-muted-foreground/60">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-violet-400/80">openclaw models auth --provider google</code>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Action */}
        {selected && (
          <div className="text-center">
            <button
              type="button"
              disabled={busy || !selected}
              onClick={() => {
                const opt = SETUP_OPTIONS.find((o) => o.id === selected);
                if (opt) onSetup(opt.provider, opt.model);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-8 py-3 text-[14px] font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {busy ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Setting up...</>
              ) : (
                <><Zap className="h-4 w-4" />Enable Vector Memory</>
              )}
            </button>
            <p className="mt-2 text-[10px] text-muted-foreground/40">
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
    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1"><Icon className={cn("h-3.5 w-3.5", color)} />{label}</div>
      <p className="text-[16px] font-semibold text-foreground/90">{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground/60 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

export function VectorView() {
  const [agents, setAgents] = useState<AgentMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
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
      setAgents(data.agents || []);
      setAuthProviders(data.authProviders || []);
      setMemorySearch(data.memorySearch || null);
    }
    catch (err) { console.error("Vector fetch:", err); }
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

  const handleUpdateModel = useCallback(async (prov: string, mod: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/vector", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update-embedding-model", provider: prov, model: mod }) });
      const d = await res.json();
      if (d.ok) { setToast({ message: "Model changed to " + prov + "/" + mod + ". Run reindex.", type: "success" }); await fetchStatus(); }
      else setToast({ message: d.error || "Failed", type: "error" });
    } catch (e) { setToast({ message: String(e), type: "error" }); } finally { setSaving(false); }
  }, [fetchStatus]);

  const handleSetup = useCallback(async (provider: string, model: string) => {
    setSettingUp(true);
    try {
      const res = await fetch("/api/vector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup-memory", provider, model }),
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

  if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>;

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
          <button
            onClick={() => {
              setLoading(true);
              fetchStatus();
            }}
            className="rounded-lg p-2 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground/70"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
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

        <EmbeddingModelEditor
          currentProvider={curProv}
          currentModel={curModel}
          currentDims={curDims}
          currentBackend={curBackend}
          onSave={handleUpdateModel}
          saving={saving}
        />

        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 space-y-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground/90"><Search className="h-4 w-4 text-violet-400" />Query Console</div>
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" /><input type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doSearch(query); }} placeholder="Semantic search across your vector memory..." className="w-full rounded-lg border border-foreground/[0.08] bg-muted py-2.5 pl-10 pr-4 text-[13px] text-foreground/90 placeholder-zinc-600 outline-none focus:border-violet-500/30" />{searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-violet-400" />}</div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5"><Filter className="h-3 w-3 text-muted-foreground/60" /><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Filters</span></div>
            <select value={searchAgent} onChange={(e) => setSearchAgent(e.target.value)} className="rounded-md border border-foreground/[0.08] bg-muted px-2.5 py-1.5 text-[11px] text-foreground/70 outline-none"><option value="">All namespaces</option>{agents.map((a) => <option key={a.agentId} value={a.agentId}>{a.agentId}</option>)}</select>
            <div className="flex items-center gap-1.5"><span className="text-[10px] text-muted-foreground/60">Top-K:</span><select value={maxResults} onChange={(e) => setMaxResults(e.target.value)} className="rounded-md border border-foreground/[0.08] bg-muted px-2 py-1.5 text-[11px] text-foreground/70 outline-none">{["3","5","10","20","50"].map((v) => <option key={v} value={v}>{v}</option>)}</select></div>
            <div className="flex items-center gap-1.5"><span className="text-[10px] text-muted-foreground/60">Min score:</span><input type="number" step="0.05" min="0" max="1" value={minScore} onChange={(e) => setMinScore(e.target.value)} placeholder="0.0" className="w-16 rounded-md border border-foreground/[0.08] bg-muted px-2 py-1.5 text-[11px] text-foreground/70 outline-none" /></div>
            <div className="flex items-center gap-1.5"><ArrowUpDown className="h-3 w-3 text-muted-foreground/60" /><select value={sortBy} onChange={(e) => setSortBy(e.target.value as "score"|"path")} className="rounded-md border border-foreground/[0.08] bg-muted px-2 py-1.5 text-[11px] text-foreground/70 outline-none"><option value="score">By score</option><option value="path">By path</option></select></div>
          </div>
          {lastQuery && <div className="flex items-center gap-3 text-[11px] text-muted-foreground"><span>{results.length} result{results.length !== 1 ? "s" : ""} for <span className="font-medium text-violet-400">{"\u201C"}{lastQuery}{"\u201D"}</span></span><span className="text-muted-foreground/40">&middot;</span><span>{searchTime}ms</span>{results.length > 0 && <><span className="text-muted-foreground/40">&middot;</span><span>top: <span className={cn("font-mono", scoreColor(results[0].score))}>{results[0].score.toFixed(4)}</span></span></>}</div>}
        </div>

        {sorted.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground"><BarChart3 className="h-3.5 w-3.5" />Results<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">{sorted.length}</span></div>
            <div className="flex h-8 items-end gap-0.5 rounded-lg border border-foreground/[0.04] bg-muted/50 p-1.5">{sorted.map((r, i) => <div key={i} className={cn("flex-1 rounded-sm transition-all", scoreBarColor(r.score))} style={{ height: Math.max(8, r.score * 100) + "%" }} title={"#" + (i+1) + ": " + r.score.toFixed(4)} />)}</div>
            {sorted.map((r, i) => <ResultCard key={r.path + "-" + r.startLine + "-" + i} result={r} rank={i + 1} />)}
          </div>
        )}

        {lastQuery && results.length === 0 && !searching && (
          <div className="rounded-xl border border-dashed border-foreground/[0.08] bg-muted/50 p-8 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-[13px] text-muted-foreground">No results for <span className="text-violet-400">{"\u201C"}{lastQuery}{"\u201D"}</span></p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">Try different keywords or lower the minimum score.</p>
          </div>
        )}

        <div><h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-foreground/90"><Database className="h-4 w-4 text-violet-400" />Namespaces<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">{agents.length}</span></h2><div className="space-y-2">{agents.map((a) => <AgentIndexCard key={a.agentId} agent={a} onReindex={handleReindex} reindexing={reindexing} />)}</div></div>

        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 space-y-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground/90"><Settings2 className="h-4 w-4 text-muted-foreground" />How It Works</div>
          <div className="text-[12px] text-muted-foreground space-y-1">
            <p>OpenClaw indexes workspace <code className="rounded bg-foreground/[0.06] px-1 text-[11px] text-muted-foreground">memory/</code> files into SQLite with vector embeddings (sqlite-vec).</p>
            <p>Each file is chunked and embedded using the configured model (default: text-embedding-3-small, 1536d). Search uses cosine similarity. FTS5 is available as fallback.</p>
          </div>
          <div className="rounded-lg bg-muted p-3 font-mono text-[11px] text-muted-foreground space-y-0.5">
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
