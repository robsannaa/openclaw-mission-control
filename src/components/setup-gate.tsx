"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { TypingDots } from "@/components/typing-dots";

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

export function SetupGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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

  if (status && !status.configured) {
    return <OnboardingWizard onComplete={handleComplete} />;
  }

  return (
    <SetupGateContext.Provider value={{ invalidate: handleComplete }}>
      {children}
    </SetupGateContext.Provider>
  );
}
