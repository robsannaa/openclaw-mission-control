"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { OnboardingWizard } from "@/components/onboarding-wizard";

/* ── Types ────────────────────────────────────────── */

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

/* ── Cache ────────────────────────────────────────── */

let cachedStatus: { data: SetupStatus; ts: number } | null = null;
const CACHE_TTL = 30_000; // 30 seconds

export function invalidateSetupCache() {
  cachedStatus = null;
}

/* ── Context for child components ─────────────────── */

const SetupGateContext = createContext<{
  invalidate: () => void;
}>({ invalidate: () => {} });

export function useSetupGate() {
  return useContext(SetupGateContext);
}

/* ── Component ────────────────────────────────────── */

export function SetupGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchStatus = useCallback(async () => {
    // Use cache if fresh
    if (cachedStatus && Date.now() - cachedStatus.ts < CACHE_TTL) {
      setStatus(cachedStatus.data);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/onboard", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SetupStatus;
      cachedStatus = { data, ts: Date.now() };
      setStatus(data);
      setError(false);
    } catch {
      // Fail-open: let user through on error
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleComplete = useCallback(() => {
    invalidateSetupCache();
    // Re-check — this will let children render on next pass
    fetchStatus();
  }, [fetchStatus]);

  // Loading: full-screen overlay with animated dots
  if (loading && !status) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
        </div>
      </div>
    );
  }

  // Fail-open: if API errored, render children
  if (error) {
    return (
      <SetupGateContext.Provider value={{ invalidate: handleComplete }}>
        {children}
      </SetupGateContext.Provider>
    );
  }

  // Not configured: show onboarding wizard
  if (status && !status.configured) {
    return <OnboardingWizard onComplete={handleComplete} />;
  }

  // Configured: render normally
  return (
    <SetupGateContext.Provider value={{ invalidate: handleComplete }}>
      {children}
    </SetupGateContext.Provider>
  );
}
