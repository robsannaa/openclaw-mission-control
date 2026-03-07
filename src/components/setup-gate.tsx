"use client";

import { useState, useEffect, useCallback, createContext, useContext, useSyncExternalStore } from "react";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { TypingDots } from "@/components/typing-dots";

const SKIP_KEY = "mc-onboarding-skipped";

type SetupStatus = {
  installed: boolean;
  configured: boolean;
  configExists: boolean;
  hasModel: boolean;
  hasApiKey: boolean;
  gatewayRunning: boolean;
  version: string | null;
  gatewayUrl: string;
};

let cachedStatus: { data: SetupStatus; ts: number } | null = null;
const CACHE_TTL = 30_000;

export function invalidateSetupCache() {
  cachedStatus = null;
}

const SetupGateContext = createContext<{ invalidate: () => void }>({
  invalidate: () => {},
});

export function useSetupGate() {
  return useContext(SetupGateContext);
}

/* In-tab notification channel for skip state changes.
 * StorageEvent only fires in *other* tabs, so we need a custom
 * pub/sub to notify useSyncExternalStore in the *current* tab. */
const skipListeners = new Set<() => void>();

function useSkippedOnboarding() {
  const subscribe = useCallback((cb: () => void) => {
    // Cross-tab via StorageEvent
    const handler = (e: StorageEvent) => { if (e.key === SKIP_KEY) cb(); };
    window.addEventListener("storage", handler);
    // Same-tab via custom channel
    skipListeners.add(cb);
    return () => {
      window.removeEventListener("storage", handler);
      skipListeners.delete(cb);
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && localStorage.getItem(SKIP_KEY) === "true",
    () => false,
  );
}

export function skipOnboarding() {
  localStorage.setItem(SKIP_KEY, "true");
  // Notify same-tab subscribers immediately
  for (const fn of skipListeners) {
    try { fn(); } catch { /* */ }
  }
}

export function resetOnboardingSkip() {
  localStorage.removeItem(SKIP_KEY);
  for (const fn of skipListeners) {
    try { fn(); } catch { /* */ }
  }
}

let fetchInFlight: Promise<void> | null = null;

export function SetupGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const skipped = useSkippedOnboarding();

  const fetchStatus = useCallback(async () => {
    // Deduplicate in-flight requests first (before cache check) to avoid
    // concurrent requests that both see an expired cache and fire fetches.
    if (fetchInFlight) {
      await fetchInFlight;
      if (cachedStatus) {
        setStatus(cachedStatus.data);
        setLoading(false);
        setError(false);
      }
      return;
    }

    if (cachedStatus && Date.now() - cachedStatus.ts < CACHE_TTL) {
      setStatus(cachedStatus.data);
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);
    const request = (async () => {
      try {
        const res = await fetch("/api/onboard", { cache: "no-store", signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SetupStatus;
        cachedStatus = { data, ts: Date.now() };
        setStatus(data);
        setError(false);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        fetchInFlight = null;
      }
    })();
    fetchInFlight = request;
    await request;
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleComplete = useCallback(() => {
    invalidateSetupCache();
    fetchStatus();
  }, [fetchStatus]);

  if (loading && !status) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <TypingDots size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <SetupGateContext.Provider value={{ invalidate: handleComplete }}>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
              <svg className="h-7 w-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-foreground">Could not connect to OpenClaw</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Make sure the OpenClaw gateway is running and try again. If the problem persists, check the terminal for errors.
            </p>
            <button
              type="button"
              onClick={() => {
                setError(false);
                fetchStatus();
              }}
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Retry
            </button>
          </div>
        </div>
      </SetupGateContext.Provider>
    );
  }

  if (status && !status.configured && !skipped) {
    return <OnboardingWizard onComplete={handleComplete} />;
  }

  return (
    <SetupGateContext.Provider value={{ invalidate: handleComplete }}>
      {children}
    </SetupGateContext.Provider>
  );
}
