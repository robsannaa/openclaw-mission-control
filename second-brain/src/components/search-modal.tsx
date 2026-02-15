"use client";

import {
  useEffect,
  useState,
  useRef,
  useCallback,
  Fragment,
} from "react";
import { Search, FileText, X, Brain, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── types ────────────────────────────────────────── */

type SearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

/* ── helpers ──────────────────────────────────────── */

function scoreLabel(score: number): string {
  if (score >= 0.6) return "High";
  if (score >= 0.45) return "Medium";
  return "Low";
}

function scoreColor(score: number): string {
  if (score >= 0.6) return "text-emerald-400";
  if (score >= 0.45) return "text-amber-400";
  return "text-zinc-500";
}

/** Friendly display for paths like memory/2026-02-14.md */
function pathDisplay(path: string): { icon: string; label: string } {
  if (path.startsWith("memory/")) {
    return { icon: "🧠", label: path.replace("memory/", "") };
  }
  return { icon: "📄", label: path };
}

/** Highlight markdown-style bold tokens as HTML */
function highlightSnippet(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<span class="text-zinc-200 font-semibold">$1</span>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-zinc-800/80 px-1 py-0.5 text-[12px] text-violet-300 font-mono">$1</code>');
}

/* ── component ───────────────────────────────────── */

export function SearchModal({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSearched(false);
      setSelectedIdx(0);
      // Small delay to let the modal render
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results || []);
      setSelectedIdx(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter" && results[selectedIdx]) {
      // Could navigate to the result; for now just scroll to it
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-x-0 top-[12%] z-50 mx-auto w-full max-w-2xl px-4">
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c10] shadow-2xl shadow-black/50">
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
            {loading ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-violet-400" />
            ) : (
              <Search className="h-5 w-5 shrink-0 text-zinc-500" />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search memories with OpenClaw vector search..."
              className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
              spellCheck={false}
              autoComplete="off"
            />
            <kbd className="hidden rounded border border-white/[0.08] bg-zinc-800/50 px-1.5 py-0.5 text-[10px] text-zinc-600 sm:inline">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">
            {/* Hint when empty */}
            {!searched && !loading && (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <div className="flex items-center gap-2 text-zinc-600">
                  <Brain className="h-5 w-5" />
                  <span className="text-sm font-medium">
                    Semantic Memory Search
                  </span>
                </div>
                <p className="max-w-sm text-[12px] leading-5 text-zinc-600">
                  Uses OpenClaw&apos;s vector database to search across your
                  MEMORY.md and daily journal entries. Type at least 2
                  characters to search.
                </p>
              </div>
            )}

            {/* Loading state */}
            {loading && results.length === 0 && searched && (
              <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching vector memory...
              </div>
            )}

            {/* No results */}
            {searched && !loading && results.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-zinc-600">
                No matches found for &quot;{query}&quot;
              </div>
            )}

            {/* Result list */}
            {results.length > 0 && (
              <div className="py-2">
                <div className="px-4 pb-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    {results.length} result{results.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {results.map((result, idx) => {
                  const { icon, label } = pathDisplay(result.path);
                  const isSelected = idx === selectedIdx;
                  return (
                    <button
                      key={`${result.path}-${result.startLine}`}
                      type="button"
                      className={cn(
                        "flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors",
                        isSelected
                          ? "bg-violet-500/10"
                          : "hover:bg-zinc-800/40"
                      )}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      {/* Header row */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{icon}</span>
                        <span className="text-[12px] font-medium text-zinc-300">
                          {label}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          L{result.startLine}–{result.endLine}
                        </span>
                        <div className="flex-1" />
                        <span
                          className={cn(
                            "text-[10px] font-medium",
                            scoreColor(result.score)
                          )}
                        >
                          {(result.score * 100).toFixed(0)}% &middot;{" "}
                          {scoreLabel(result.score)}
                        </span>
                      </div>

                      {/* Snippet */}
                      <div
                        className="line-clamp-4 text-[12px] leading-5 text-zinc-500"
                        dangerouslySetInnerHTML={{
                          __html: highlightSnippet(
                            result.snippet.substring(0, 400)
                          ),
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[10px] text-zinc-600">
            <span>
              Powered by{" "}
              <span className="font-medium text-zinc-500">
                openclaw memory search
              </span>{" "}
              &middot; OpenAI embeddings
            </span>
            <div className="flex items-center gap-2">
              <span>
                <kbd className="rounded border border-white/[0.06] bg-zinc-800/40 px-1 py-0.5">
                  ↑↓
                </kbd>{" "}
                navigate
              </span>
              <span>
                <kbd className="rounded border border-white/[0.06] bg-zinc-800/40 px-1 py-0.5">
                  esc
                </kbd>{" "}
                close
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
