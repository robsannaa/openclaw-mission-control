/**
 * Lightweight pub/sub store for gateway restart-needed state.
 *
 * When any component changes config (cron edits, audio settings, etc.)
 * it calls `requestRestart()` to signal that a gateway restart is needed.
 * The global RestartAnnouncementBar subscribes and renders a prompt.
 *
 * The snapshot object is cached at module level and only recreated when
 * data changes — this is required by useSyncExternalStore which uses
 * Object.is to compare snapshots (new object = always "changed" = infinite loop).
 */

type Listener = () => void;
type Snapshot = { needed: boolean; reason: string; restarting: boolean };

let _restartNeeded = false;
let _reason = "";
let _restarting = false;
const _listeners = new Set<Listener>();

/** Cached snapshot — only replaced inside _notify() when state changes */
let _snapshot: Snapshot = { needed: false, reason: "", restarting: false };

/** Stable server-side snapshot (never changes) */
const _serverSnapshot: Snapshot = { needed: false, reason: "", restarting: false };

export function requestRestart(reason: string): void {
  if (_restartNeeded) return; // already showing
  _restartNeeded = true;
  _reason = reason;
  _restarting = false;
  _notify();
}

export function dismissRestart(): void {
  _restartNeeded = false;
  _reason = "";
  _restarting = false;
  _notify();
}

export function setRestarting(val: boolean): void {
  _restarting = val;
  _notify();
}

export function subscribeRestartStore(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/** Client snapshot for useSyncExternalStore — returns cached reference */
export function getRestartSnapshot(): Snapshot {
  return _snapshot;
}

/** Server snapshot for useSyncExternalStore — always the same reference */
export function getServerSnapshot(): Snapshot {
  return _serverSnapshot;
}

function _notify(): void {
  // Create a new snapshot reference so useSyncExternalStore detects the change
  _snapshot = { needed: _restartNeeded, reason: _reason, restarting: _restarting };
  for (const l of _listeners) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}
