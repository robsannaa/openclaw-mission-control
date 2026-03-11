"use client";

import { useState, useEffect, useCallback } from "react";
import { OnboardingWizard } from "@/components/onboarding-wizard";

const isHosted =
  process.env.NEXT_PUBLIC_AGENTBAY_HOSTED === "true" ||
  process.env.AGENTBAY_HOSTED === "true";
const AUTO_RETRY_SECONDS = 8;

export function SetupGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<{ hasModel: boolean; hasChannel: boolean; hasApiKey: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryIn, setRetryIn] = useState(AUTO_RETRY_SECONDS);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/onboard", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setStatus({ hasModel: data.hasModel, hasChannel: data.hasChannel, hasApiKey: data.hasApiKey });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!error || !isHosted) return;
    setRetryIn(AUTO_RETRY_SECONDS);
    const countdown = setInterval(() => {
      setRetryIn((prev) => Math.max(prev - 1, 0));
    }, 1000);
    const retryTimer = setTimeout(() => {
      void fetchStatus();
    }, AUTO_RETRY_SECONDS * 1000);
    return () => {
      clearInterval(countdown);
      clearTimeout(retryTimer);
    };
  }, [error, fetchStatus]);

  const handleComplete = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (loading && !status) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          {isHosted ? (
            <>
              <h2 className="text-sm font-semibold text-foreground">Your agent is starting up</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                This usually takes a moment. We&apos;ll retry automatically in {retryIn}s.
              </p>
              <a
                href="/help"
                className="text-xs font-medium text-primary underline underline-offset-4 hover:opacity-90"
              >
                Contact support
              </a>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-foreground">Could not connect to OpenClaw</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Make sure the OpenClaw gateway is running and try again.
              </p>
            </>
          )}
          <button
            type="button"
            onClick={fetchStatus}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status && (!status.hasModel || !status.hasApiKey)) {
    return <OnboardingWizard onComplete={handleComplete} />;
  }

  return <>{children}</>;
}
