"use client";

import { useCallback, useRef } from "react";
import { chatStore } from "@/lib/chat-store";
import { useSmartPoll } from "@/hooks/use-smart-poll";

type UsageAlertEvent = {
  id: string;
  message: string;
};

type UsageAlertCheckResponse = {
  ok?: boolean;
  monitorEnabled?: boolean;
  alerts?: UsageAlertEvent[];
};

export function UsageAlertMonitor() {
  const seenIds = useRef(new Set<string>());

  const check = useCallback(async () => {
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
        if (!alert?.id || !alert?.message) continue;
        if (seenIds.current.has(alert.id)) continue;
        seenIds.current.add(alert.id);
        chatStore.pushSystemMessage(alert.message, { notifyDesktop: true });
      }
    } catch {
      // best effort
    }
  }, []);

  useSmartPoll(check, { intervalMs: 30_000 });

  return null;
}

