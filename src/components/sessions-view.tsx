"use client";

import { useState, useCallback } from "react";
import { Trash2, RefreshCw, MessageSquare, Clock, Zap, DollarSign } from "lucide-react";
import { estimateCostUsd } from "@/lib/model-metadata";
import { cn } from "@/lib/utils";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import { useSmartPoll } from "@/hooks/use-smart-poll";

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
    return { type: "Cron Run", badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
  if (key.includes(":cron:"))
    return { type: "Cron", badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
  if (key.includes(":main"))
    return { type: "Main", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
  if (key.includes(":hook:"))
    return { type: "Hook", badge: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" };
  return { type: "Session", badge: "bg-stone-100 text-stone-600 dark:bg-stone-700/60 dark:text-stone-300" };
}

export function SessionsView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useSmartPoll(fetchSessions, { intervalMs: 5000 });

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
    return (
      <SectionLayout>
        <LoadingState label="Loading sessions..." />
      </SectionLayout>
    );
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
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-[#c7d0d9] dark:hover:bg-[#20252a] dark:hover:text-[#f5f7fa]"
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
              className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-[#2c343d] dark:bg-[#171a1d]"
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-stone-400 dark:text-[#7a8591]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", badge)}>
                      {type}
                    </span>
                    <span className="truncate text-xs font-mono text-stone-500 dark:text-[#8d98a5]">
                      {s.key}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-stone-500 dark:text-[#8d98a5]">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {ageLabel}
                    </span>
                    <span className="flex items-center gap-1">
                      <Zap className="h-3 w-3" /> {formatTokens(s.totalTokens)} tokens
                    </span>
                    <span>
                      In: {formatTokens(s.inputTokens)} / Out: {formatTokens(s.outputTokens)}
                    </span>
                    {(() => {
                      const cost = estimateCostUsd(s.model, s.inputTokens, s.outputTokens);
                      if (cost === null) return null;
                      return (
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`}
                        </span>
                      );
                    })()}
                    <span className="rounded-md border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-xs font-mono text-stone-600 dark:border-[#2c343d] dark:bg-[#15191d] dark:text-[#c7d0d9]">
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
                        className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                      >
                        {isDeleting ? "Killing..." : "Confirm Kill"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 dark:border-[#2c343d] dark:bg-[#171a1d] dark:text-[#c7d0d9] dark:hover:bg-[#20252a] dark:hover:text-[#f5f7fa]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(s.key)}
                      className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-[#7a8591] dark:hover:bg-red-500/10 dark:hover:text-red-300"
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
          <div className="flex items-center justify-center py-12 text-sm text-stone-500 dark:text-[#8d98a5]">
            No active sessions
          </div>
        )}
      </SectionBody>
    </SectionLayout>
  );
}
