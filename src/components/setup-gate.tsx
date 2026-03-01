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

function useSkippedOnboarding() {
  const subscribe = useCallback((cb: () => void) => {
    const handler = (e: StorageEvent) => { if (e.key === SKIP_KEY) cb(); };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && localStorage.getItem(SKIP_KEY) === "true",
    () => false,
  );
}

export function skipOnboarding() {
  localStorage.setItem(SKIP_KEY, "true");
}

export function resetOnboardingSkip() {
  localStorage.removeItem(SKIP_KEY);
}

export function SetupGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const skipped = useSkippedOnboarding();

  const fetchStatus = useCallback(async () => {
    if (cachedStatus && Date.now() - cachedStatus.ts < CACHE_TTL) {
      setStatus(cachedStatus.data);
      setLoading(false);
      setError(false);
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
        {children}
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
