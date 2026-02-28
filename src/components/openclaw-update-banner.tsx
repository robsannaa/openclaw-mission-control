"use client";

import { useEffect, useState, useCallback } from "react";
import { X, ExternalLink, FileText } from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "openclaw-update-dismissed";

type UpdateInfo = {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  changelog: string | null;
  releaseUrl: string | null;
  error?: string;
};

export function OpenClawUpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showChangelog, setShowChangelog] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const fetchUpdate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/openclaw-update", { cache: "no-store" });
      const data = await res.json();
      setInfo({
        currentVersion: data.currentVersion ?? null,
        latestVersion: data.latestVersion ?? null,
        updateAvailable: Boolean(data.updateAvailable),
        changelog: data.changelog ?? null,
        releaseUrl: data.releaseUrl ?? null,
        error: data.error,
      });
      if (data.updateAvailable && typeof window !== "undefined") {
        const dismissedVersion = sessionStorage.getItem(DISMISS_KEY);
        setDismissed(dismissedVersion === data.latestVersion);
      }
    } catch {
      setInfo(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchUpdate();
    });
  }, [fetchUpdate]);

  const handleDismiss = useCallback(() => {
    if (info?.latestVersion) {
      sessionStorage.setItem(DISMISS_KEY, info.latestVersion);
      setDismissed(true);
    }
  }, [info]);

  if (loading || !info?.updateAvailable || dismissed) return null;

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-sm"
        )}
      >
        <div className="flex items-center gap-2 text-violet-200">
          <span className="font-medium">
            OpenClaw <strong>v{info.latestVersion}</strong> is available
            {info.currentVersion && (
              <span className="ml-1 font-normal text-violet-300/90">
                (you have v{info.currentVersion})
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowChangelog(true)}
            className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <FileText className="h-3 w-3" />
            View changelog
          </button>
          {info.releaseUrl && (
            <a
              href={info.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md border border-border bg-primary text-primary-foreground px-2 py-1 text-xs font-medium transition-colors hover:bg-primary/90"
            >
              <ExternalLink className="h-3 w-3" />
              Update
            </a>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded p-1 text-violet-400/80 transition-colors hover:bg-violet-500/20 hover:text-violet-200"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Changelog modal */}
      {showChangelog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setShowChangelog(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Changelog"
        >
          <div
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-foreground/10 bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                What&apos;s new in v{info.latestVersion}
              </h2>
              <button
                type="button"
                onClick={() => setShowChangelog(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3">
              {info.changelog ? (
                <MarkdownContent
                  content={info.changelog}
                  className="prose prose-invert max-w-none text-sm"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No changelog available. See the release page for details.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t border-foreground/10 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Update from terminal: <code className="rounded bg-muted px-1.5 py-0.5 font-mono">npm install -g openclaw@latest</code>
              </p>
              <div className="flex justify-end gap-2">
                {info.releaseUrl && (
                  <a
                    href={info.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open release page
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setShowChangelog(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
