/**
 * User preference: auto-restart the gateway when config changes require a restart,
 * instead of showing the restart announcement bar.
 * Persisted in localStorage so it survives refresh.
 */

const STORAGE_KEY = "openclaw-dashboard-autoRestartOnChanges";

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

let _value = false;

function getValue(): boolean {
  if (typeof window === "undefined") return false;
  _value = read();
  return _value;
}

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}

export function getAutoRestartOnChanges(): boolean {
  return typeof window === "undefined" ? false : read();
}

export function setAutoRestartOnChanges(on: boolean): void {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, on ? "true" : "false");
      _value = on;
      notify();
    }
  } catch {
    // ignore
  }
}

export function subscribeAutoRestartPreference(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAutoRestartSnapshot(): boolean {
  if (typeof window !== "undefined") _value = read();
  return _value;
}

export function getAutoRestartServerSnapshot(): boolean {
  return false;
}
