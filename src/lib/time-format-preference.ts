/**
 * Global UI preference for 12h/24h time display.
 * Persisted in localStorage so it survives refreshes.
 */

export type TimeFormatPreference = "12h" | "24h";

const STORAGE_KEY = "openclaw-dashboard-time-format";

type Listener = () => void;
const listeners = new Set<Listener>();

function isTimeFormatPreference(value: unknown): value is TimeFormatPreference {
  return value === "12h" || value === "24h";
}

function detectDefaultTimeFormat(): TimeFormatPreference {
  if (typeof window === "undefined") return "24h";
  try {
    const resolved = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
    return resolved.hour12 ? "12h" : "24h";
  } catch {
    return "24h";
  }
}

function read(): TimeFormatPreference {
  if (typeof window === "undefined") return "24h";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isTimeFormatPreference(raw)) return raw;
  } catch {
    // ignore
  }
  return detectDefaultTimeFormat();
}

let _value: TimeFormatPreference = "24h";

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

export function setTimeFormatPreference(value: TimeFormatPreference): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore
  }
  _value = value;
  notify();
}

export function subscribeTimeFormatPreference(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTimeFormatSnapshot(): TimeFormatPreference {
  if (typeof window !== "undefined") {
    _value = read();
  }
  return _value;
}

export function getTimeFormatServerSnapshot(): TimeFormatPreference {
  return "24h";
}

export function is12HourTimeFormat(value: TimeFormatPreference): boolean {
  return value === "12h";
}

export function withTimeFormat(
  options: Intl.DateTimeFormatOptions,
  timeFormat: TimeFormatPreference,
): Intl.DateTimeFormatOptions {
  if (options.hour == null && options.timeStyle == null) {
    return options;
  }
  return {
    ...options,
    hour12: is12HourTimeFormat(timeFormat),
  };
}
