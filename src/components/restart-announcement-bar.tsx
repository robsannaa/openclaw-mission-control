"use client";

import { useSyncExternalStore, useCallback, useEffect, useRef } from "react";
import {
  subscribeRestartStore,
  getRestartSnapshot,
  getServerSnapshot,
  dismissRestart,
  setRestarting,
} from "@/lib/restart-store";
import {
  subscribeAutoRestartPreference,
  getAutoRestartSnapshot,
  getAutoRestartServerSnapshot,
} from "@/lib/auto-restart-preference";
import { notifyGatewayRestarting } from "@/lib/gateway-status-store";
import { AlertTriangle, RefreshCw, X, Loader2 } from "lucide-react";

/**
 * Global announcement bar shown when a config change requires a gateway restart.
 * When "Auto-restart on changes" is on, we restart immediately and do not show the bar.
 */
export function RestartAnnouncementBar() {
  const { needed, reason, restarting } = useSyncExternalStore(
    subscribeRestartStore,
    getRestartSnapshot,
    getServerSnapshot,
  );
  const autoRestartOnChanges = useSyncExternalStore(
    subscribeAutoRestartPreference,
    getAutoRestartSnapshot,
    getAutoRestartServerSnapshot,
  );
  const autoRestartTriggeredRef = useRef(false);

  const doRestart = useCallback(async () => {
    setRestarting(true);
    notifyGatewayRestarting();
    try {
      const res = await fetch("/api/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      const data = await res.json();
      if (data.ok) {
        setTimeout(() => dismissRestart(), 3000);
      } else {
        setRestarting(false);
      }
    } catch {
      setRestarting(false);
    }
  }, []);

  // When auto-restart is on and a restart is needed, restart immediately and never show the bar
  useEffect(() => {
    if (!needed || !autoRestartOnChanges) {
      if (!needed) autoRestartTriggeredRef.current = false;
      return;
    }
    if (autoRestartTriggeredRef.current) return;
    autoRestartTriggeredRef.current = true;
    void doRestart();
  }, [needed, autoRestartOnChanges, doRestart]);

  if (!needed) return null;
  if (autoRestartOnChanges) return null;

  const handleRestart = doRestart;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 sm:gap-3 sm:px-5 sm:py-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-amber-600 dark:text-amber-200">
          Configuration changed — gateway restart recommended
        </p>
        {reason && (
          <p className="text-xs text-amber-500/70 dark:text-amber-400/60">
            {reason}
          </p>
        )}
      </div>
      <button
        onClick={handleRestart}
        disabled={restarting}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500/15 px-4 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-500/25 disabled:opacity-60 dark:text-amber-200 dark:hover:bg-amber-500/30"
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
