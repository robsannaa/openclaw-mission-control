"use client";

import { useEffect, useRef } from "react";
import { chatStore } from "@/lib/chat-store";

type UsageAlertEvent = {
  id: string;
  message: string;
};

type UsageAlertCheckResponse = {
  ok?: boolean;
  monitorEnabled?: boolean;
  alerts?: UsageAlertEvent[];
};

const POLL_MS = 30_000;

export function UsageAlertMonitor() {
  const inFlight = useRef(false);

  useEffect(() => {
    let disposed = false;

    const check = async () => {
      if (disposed || inFlight.current) return;
      if (document.visibilityState !== "visible") return;

      inFlight.current = true;
      try {
        const res = await fetch("/api/usage/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check" }),
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as UsageAlertCheckResponse;
        if (!payload.monitorEnabled) return;
        const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
        for (const alert of alerts) {
          if (!alert?.message) continue;
          chatStore.pushSystemMessage(alert.message, { notifyDesktop: true });
        }
      } catch {
        // best effort
      } finally {
        inFlight.current = false;
      }
    };

    void check();
    const intervalId = window.setInterval(() => {
      void check();
    }, POLL_MS);
    const onFocus = () => void check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}

