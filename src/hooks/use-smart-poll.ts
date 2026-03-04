"use client";

import { useEffect, useRef, useCallback } from "react";

type UseSmartPollOptions = {
  /** Milliseconds between polls when tab is visible. Default 5000. */
  intervalMs?: number;
  /** When true, polling pauses (SSE/WS is providing data). */
  sseActive?: boolean;
  /** Fire immediately on mount. Default true. */
  immediate?: boolean;
};

/**
 * Smart polling hook that:
 * - Pauses when the tab is hidden
 * - Pauses when an SSE/WS stream is active
 * - Re-polls immediately when tab becomes visible or window gains focus
 * - Deduplicates in-flight requests
 */
export function useSmartPoll(
  fn: () => void | Promise<void>,
  options: UseSmartPollOptions = {},
) {
  const { intervalMs = 5000, sseActive = false, immediate = true } = options;

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const sseRef = useRef(sseActive);
  sseRef.current = sseActive;
  const inFlight = useRef(false);
  const mountedRef = useRef(false);

  const tick = useCallback(async () => {
    if (inFlight.current) return;
    if (document.visibilityState !== "visible") return;
    if (sseRef.current) return;
    inFlight.current = true;
    try {
      await fnRef.current();
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Fire immediately on mount only (not on intervalMs changes)
  useEffect(() => {
    if (immediate) void tick();
    mountedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set up interval + visibility/focus listeners (re-runs when intervalMs changes)
  useEffect(() => {
    const id = window.setInterval(() => void tick(), intervalMs);

    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    const onFocus = () => void tick();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [tick, intervalMs]);
}
