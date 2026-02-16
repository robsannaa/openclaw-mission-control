import { useSyncExternalStore } from "react";

export type GatewayHealth = Record<string, unknown> | null;
export type GatewayStatus = "online" | "degraded" | "offline" | "loading";

type Snapshot = {
  status: GatewayStatus;
  health: GatewayHealth;
  restarting: boolean;
};

const RESTART_EVENT = "gateway-restarting";

let snapshot: Snapshot = {
  status: "loading",
  health: null,
  restarting: false,
};

const SERVER_SNAPSHOT: Snapshot = {
  status: "loading",
  health: null,
  restarting: false,
};

const listeners = new Set<() => void>();
let subscribers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let fastPollCount = 0;
let inFlight = false;

function emit() {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  emit();
}

async function poll() {
  if (inFlight || typeof window === "undefined") return;
  inFlight = true;
  try {
    const res = await fetch("/api/gateway", { cache: "no-store" });
    const data = await res.json();
    const nextStatus = ((data.status as GatewayStatus) || "offline");
    setSnapshot({
      status: nextStatus,
      health: (data.health as GatewayHealth) || null,
    });

    if (fastPollCount > 0 && nextStatus === "online") {
      fastPollCount = 0;
      switchToNormalPolling();
      setSnapshot({ restarting: false });
    }
  } catch {
    setSnapshot({ status: "offline", health: null });
  } finally {
    inFlight = false;
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
    void poll();
  }, 12000);
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

function start() {
  if (typeof window === "undefined") return;
  window.addEventListener(RESTART_EVENT, handleRestartingSignal);
  void poll();
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
  inFlight = false;
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
