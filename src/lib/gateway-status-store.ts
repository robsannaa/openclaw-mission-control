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

function emit() {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  emit();
}

/** Lightweight poll via /api/status — 3s max, used for normal ticks. */
async function pollLite() {
  if (liteInFlight || typeof window === "undefined") return;
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
  if (fullInFlight || typeof window === "undefined") return;
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
      fastPollCount = 0;
      switchToNormalPolling();
      setSnapshot({ restarting: false });
    } else if (nextStatus === "offline" || nextStatus === "degraded") {
      switchToOfflinePolling();
    } else if (fastPollCount === 0) {
      switchToNormalPolling();
    }
  } catch {
    setSnapshot({ status: "offline", health: null, latencyMs: null });
    switchToOfflinePolling();
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

/** Poll every 5s when offline — detect recovery faster. */
function switchToOfflinePolling() {
  // Don't downgrade from fast polling (restart recovery).
  if (fastPollCount > 0) return;
  clearPollTimer();
  pollTimer = setInterval(() => {
    void poll();
  }, 5000);
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

async function start() {
  if (typeof window === "undefined") return;
  window.addEventListener(RESTART_EVENT, handleRestartingSignal);
  // Fast preflight via /api/status (3s max) then full health data (sequenced to avoid race)
  await pollLite();
  await poll();
  switchToNormalPolling();
}

function stop() {
  if (typeof window !== "undefined") {
    window.removeEventListener(RESTART_EVENT, handleRestartingSignal);
  }
  clearPollTimer();
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  fastPollCount = 0;
  liteInFlight = false;
  fullInFlight = false;
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
