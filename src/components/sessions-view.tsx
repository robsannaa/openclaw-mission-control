"use client";

import { useEffect, useState, useCallback } from "react";
import { Trash2, RefreshCw, MessageSquare, Clock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";

type Session = {
  key: string;
  kind: string;
  updatedAt?: number | null;
  ageMs?: number | null;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  contextTokens: number;
};

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatAge(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function getAgeMs(session: Session): number | null {
  const ageMs = Number(session.ageMs);
  if (Number.isFinite(ageMs) && ageMs >= 0) return ageMs;

  const updatedAt = Number(session.updatedAt);
  if (Number.isFinite(updatedAt) && updatedAt > 0) {
    return Math.max(0, Date.now() - updatedAt);
  }
  return null;
}

function sessionLabel(key: string): { type: string; badge: string } {
  if (key.includes(":cron:") && key.includes(":run:"))
    return { type: "Cron Run", badge: "bg-amber-500/15 text-amber-400" };
  if (key.includes(":cron:"))
    return { type: "Cron", badge: "bg-amber-500/15 text-amber-400" };
  if (key.includes(":main"))
    return { type: "Main", badge: "bg-violet-500/15 text-violet-400" };
  if (key.includes(":hook:"))
    return { type: "Hook", badge: "bg-cyan-500/15 text-cyan-400" };
  return { type: "Session", badge: "bg-zinc-500/15 text-muted-foreground" };
}

export function SessionsView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => fetchSessions());
  }, [fetchSessions]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchSessions();
    }, 5000);

    const onFocus = () => {
      void fetchSessions();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchSessions]);

  const killSession = useCallback(
    async (key: string) => {
      setDeleting(key);
      try {
        const res = await fetch(
          `/api/sessions?key=${encodeURIComponent(key)}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (data.ok || data.deleted) {
          await fetchSessions();
        }
      } catch { /* ignore */ }
      setDeleting(null);
      setConfirmDelete(null);
    },
    [fetchSessions]
  );

  if (loading) {
    return <LoadingState label="Loading sessions..." />;
  }

  return (
    <SectionLayout>
      <SectionHeader
        title={`Sessions (${sessions.length})`}
        description="Live sessions via Gateway RPC • Kill to clear conversation history"
        actions={
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchSessions();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        }
      />

      <SectionBody width="content" padding="compact" innerClassName="space-y-2">
        {sessions.map((s) => {
          const { type, badge } = sessionLabel(s.key);
          const isConfirming = confirmDelete === s.key;
          const isDeleting = deleting === s.key;
          const ageMs = getAgeMs(s);
          const ageLabel = ageMs === null ? "Unknown" : `${formatAge(ageMs)} ago`;
          return (
            <div
              key={s.key}
              className="rounded-xl border border-foreground/10 bg-card/90 p-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", badge)}>
                      {type}
                    </span>
                    <span className="truncate text-xs font-mono text-muted-foreground">
                      {s.key}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {ageLabel}
                    </span>
                    <span className="flex items-center gap-1">
                      <Zap className="h-3 w-3" /> {formatTokens(s.totalTokens)} tokens
                    </span>
                    <span>
                      In: {formatTokens(s.inputTokens)} / Out: {formatTokens(s.outputTokens)}
                    </span>
                    <span className="rounded bg-muted/80 px-1.5 py-0.5 text-xs font-mono">
                      {s.model}
                    </span>
                  </div>
                </div>

                {/* Kill button */}
                <div className="shrink-0">
                  {isConfirming ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => killSession(s.key)}
                        disabled={isDeleting}
                        className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        {isDeleting ? "Killing..." : "Confirm Kill"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground/70"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(s.key)}
                      className="rounded p-1.5 text-muted-foreground/60 transition-colors hover:bg-red-500/15 hover:text-red-400"
                      title="Kill session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground/60">
            No active sessions
          </div>
        )}
      </SectionBody>
    </SectionLayout>
  );
}
