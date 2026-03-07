import { useSyncExternalStore } from "react";

export type GatewayHealth = Record<string, unknown> | null;
export type GatewayStatus = "online" | "degraded" | "offline" | "loading";

type Snapshot = {
  status: GatewayStatus;
  health: GatewayHealth;
  restarting: boolean;
  latencyMs: number | null;
};

const RESTART_EVENT = "gateway-restarting";

let snapshot: Snapshot = {
  status: "loading",
  health: null,
  restarting: false,
  latencyMs: null,
};

const SERVER_SNAPSHOT: Snapshot = {
  status: "loading",
  health: null,
  restarting: false,
  latencyMs: null,
};

const VALID_STATUSES = new Set<GatewayStatus>(["online", "degraded", "offline", "loading"]);

function toGatewayStatus(value: unknown): GatewayStatus {
  if (typeof value === "string" && VALID_STATUSES.has(value as GatewayStatus)) {
    return value as GatewayStatus;
  }
  return "offline";
}

const listeners = new Set<() => void>();
let subscribers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let fastPollCount = 0;
let liteInFlight = false;
let fullInFlight = false;
let offlineConsecutiveFailures = 0;
let tabHidden = false;

function emit() {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  emit();
}

/** Lightweight poll via /api/status — 3s max, used for normal ticks. */
async function pollLite() {
  if (liteInFlight || typeof window === "undefined" || tabHidden) return;
  liteInFlight = true;
  try {
    const res = await fetch("/api/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      setSnapshot({ status: "offline", health: null, latencyMs: null });
      switchToOfflinePolling();
      return;
    }
    const data = await res.json();
    const nextStatus = toGatewayStatus(data.gateway);
    setSnapshot({
      status: nextStatus,
      latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
    });
    if (nextStatus === "offline" || nextStatus === "degraded") {
      switchToOfflinePolling();
    } else {
      offlineConsecutiveFailures = 0;
    }
  } catch {
    setSnapshot({ status: "offline", health: null, latencyMs: null });
    switchToOfflinePolling();
  } finally {
    liteInFlight = false;
  }
}

/** Full poll via /api/gateway — used for fast/recovery ticks and initial load. */
async function poll() {
  if (fullInFlight || typeof window === "undefined" || tabHidden) return;
  fullInFlight = true;
  try {
    const res = await fetch("/api/gateway", {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      setSnapshot({ status: "offline", health: null, latencyMs: null });
      switchToOfflinePolling();
      return;
    }
    const data = await res.json();
    const nextStatus = toGatewayStatus(data.status);
    setSnapshot({
      status: nextStatus,
      health: (data.health as GatewayHealth) || null,
      latencyMs: null,
    });

    if (fastPollCount > 0 && nextStatus === "online") {
      // Restart recovery complete
      fastPollCount = 0;
      offlineConsecutiveFailures = 0;
      switchToNormalPolling();
      setSnapshot({ restarting: false });
    } else if (fastPollCount > 0) {
      // During restart: stay in fast-poll mode even if degraded/offline.
      // Don't downgrade to offline polling — the gateway is still coming up.
    } else if (nextStatus === "offline" || nextStatus === "degraded") {
      switchToOfflinePolling();
    } else {
      offlineConsecutiveFailures = 0;
      switchToNormalPolling();
    }
  } catch {
    setSnapshot({ status: "offline", health: null, latencyMs: null });
    if (fastPollCount === 0) switchToOfflinePolling();
  } finally {
    fullInFlight = false;
  }
}

function clearPollTimer() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function switchToNormalPolling() {
  clearPollTimer();
  pollTimer = setInterval(() => {
    void pollLite();
  }, 12000);
}

/** Poll when offline with exponential backoff: 5s, 10s, 20s, capped at 30s. */
function switchToOfflinePolling() {
  // Don't downgrade from fast polling (restart recovery).
  if (fastPollCount > 0) return;
  clearPollTimer();
  offlineConsecutiveFailures += 1;
  const delay = Math.min(5000 * Math.pow(2, Math.min(offlineConsecutiveFailures - 1, 3)), 30000);
  pollTimer = setInterval(() => {
    void poll();
  }, delay);
}

function switchToFastPolling() {
  clearPollTimer();
  fastPollCount = 1;
  pollTimer = setInterval(() => {
    fastPollCount += 1;
    if (fastPollCount > 30) {
      fastPollCount = 0;
      switchToNormalPolling();
      setSnapshot({ restarting: false });
      return;
    }
    void poll();
  }, 2000);
}

function handleRestartingSignal() {
  setSnapshot({ status: "loading", health: null, restarting: true });
  switchToFastPolling();
  setTimeout(() => {
    void poll();
  }, 1500);
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    setSnapshot({ restarting: false });
  }, 5000);
}

function handleVisibilityChange() {
  const hidden = document.visibilityState === "hidden";
  if (tabHidden === hidden) return;
  tabHidden = hidden;
  if (!hidden && subscribers > 0) {
    // Tab became visible — immediately refresh and resume polling.
    void pollLite();
    if (!pollTimer) switchToNormalPolling();
  }
}

async function start() {
  if (typeof window === "undefined") return;
  tabHidden = document.visibilityState === "hidden";
  window.addEventListener(RESTART_EVENT, handleRestartingSignal);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  // Fast preflight via /api/status (3s max) then full health data (sequenced to avoid race)
  await pollLite();
  await poll();
  switchToNormalPolling();
}

function stop() {
  if (typeof window !== "undefined") {
    window.removeEventListener(RESTART_EVENT, handleRestartingSignal);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }
  clearPollTimer();
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  fastPollCount = 0;
  offlineConsecutiveFailures = 0;
  liteInFlight = false;
  fullInFlight = false;
  tabHidden = false;
}

export function notifyGatewayRestarting() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RESTART_EVENT));
}

export function subscribeGatewayStatus(listener: () => void) {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) start();

  return () => {
    listeners.delete(listener);
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers === 0) stop();
  };
}

export function getGatewayStatusSnapshot() {
  return snapshot;
}

export function getGatewayStatusServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

export function useGatewayStatusStore() {
  return useSyncExternalStore(
    subscribeGatewayStatus,
    getGatewayStatusSnapshot,
    getGatewayStatusServerSnapshot
  );
}
