"use client";

import { useSyncExternalStore, useCallback } from "react";
import {
  subscribeRestartStore,
  getRestartSnapshot,
  getServerSnapshot,
  dismissRestart,
  setRestarting,
} from "@/lib/restart-store";
import { notifyGatewayRestarting } from "@/components/header";
import { AlertTriangle, RefreshCw, X, Loader2 } from "lucide-react";

/**
 * Global announcement bar shown when a config change requires a gateway restart.
 * Mounted in layout.tsx so it's visible across all views.
 */
export function RestartAnnouncementBar() {
  const { needed, reason, restarting } = useSyncExternalStore(
    subscribeRestartStore,
    getRestartSnapshot,
    getServerSnapshot,
  );

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    // Immediately tell the gateway status badge to show "loading" and fast-poll
    notifyGatewayRestarting();
    try {
      const res = await fetch("/api/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      const data = await res.json();
      if (data.ok) {
        // Give the gateway a moment to come back up, then dismiss
        setTimeout(() => dismissRestart(), 3000);
      } else {
        setRestarting(false);
      }
    } catch {
      setRestarting(false);
    }
  }, []);

  if (!needed) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 sm:gap-3 sm:px-5 sm:py-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-amber-600 dark:text-amber-200">
          Configuration changed — gateway restart recommended
        </p>
        {reason && (
          <p className="text-[11px] text-amber-500/70 dark:text-amber-400/60">
            {reason}
          </p>
        )}
      </div>
      <button
        onClick={handleRestart}
        disabled={restarting}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500/15 px-4 py-1.5 text-[12px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/25 disabled:opacity-60 dark:text-amber-200 dark:hover:bg-amber-500/30"
      >
        {restarting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Restarting...
          </>
        ) : (
          <>
            <RefreshCw className="h-3.5 w-3.5" />
            Restart Gateway
          </>
        )}
      </button>
      <button
        onClick={dismissRestart}
        className="rounded p-1 text-amber-400/50 transition-colors hover:text-amber-500 dark:hover:text-amber-300"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
