/**
 * Shared Gateway config helpers.
 *
 * Consolidates the duplicated `gatewayCallWithRetry`, `applyConfigPatchWithRetry`,
 * and `isGatewayTransientError` patterns that existed identically in
 * agents/route.ts and models-summary.ts.
 */

import { gatewayCall, runCliCaptureBoth } from "./openclaw";
import { getOpenClawHome } from "./paths";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

// ── Helpers ──────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keys that are RPC parameters for config.patch, NOT valid config keys.
 * Some gateway versions accidentally persist these into openclaw.json.
 */
const LEAKED_RPC_KEYS = ["raw", "baseHash", "restartDelayMs"];

/**
 * Strip leaked RPC parameters from the config file on disk.
 * Returns true if the file was modified.
 */
export async function sanitizeConfigFile(): Promise<boolean> {
  const configPath = join(getOpenClawHome(), "openclaw.json");
  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch {
    return false;
  }
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return false;
  }
  let changed = false;
  for (const key of LEAKED_RPC_KEYS) {
    if (key in config) {
      delete config[key];
      changed = true;
    }
  }
  if (changed) {
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
  return changed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRetryAfterMs(error: unknown): number | null {
  const msg = String(error || "");
  const match = msg.match(/retry after\s+(\d+(?:\.\d+)?)s/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.ceil(seconds * 1000);
}

type ConfigSetEntry = {
  path: string;
  value: unknown;
};

const MAX_CONFIG_SET_FALLBACK_ENTRIES = 24;

function collectConfigSetEntries(
  patchObj: Record<string, unknown>,
  prefix = "",
): ConfigSetEntry[] {
  const entries: ConfigSetEntry[] = [];
  for (const [key, value] of Object.entries(patchObj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value) && Object.keys(value).length > 0 && !key.includes(".")) {
      entries.push(...collectConfigSetEntries(value, path));
      continue;
    }
    entries.push({ path, value });
  }
  return entries;
}

function buildConfigSetFallbackEntries(
  patchObj: Record<string, unknown>,
): { entries: ConfigSetEntry[] | null; reason?: string } {
  const entries = collectConfigSetEntries(patchObj).filter(
    (entry) => entry.path.trim().length > 0,
  );
  if (entries.length === 0) {
    return { entries: null, reason: "empty patch payload" };
  }
  if (entries.length > MAX_CONFIG_SET_FALLBACK_ENTRIES) {
    return {
      entries: null,
      reason: `patch has ${entries.length} entries (limit: ${MAX_CONFIG_SET_FALLBACK_ENTRIES})`,
    };
  }

  for (const entry of entries) {
    if (entry.value === undefined) {
      return { entries: null, reason: `unsupported undefined value for ${entry.path}` };
    }
    const encoded = JSON.stringify(entry.value);
    if (encoded === undefined) {
      return { entries: null, reason: `failed to encode JSON value for ${entry.path}` };
    }
  }

  return { entries };
}

async function applyConfigSetFallback(entries: ConfigSetEntry[]): Promise<{
  failures: Array<{ path: string; error: string }>;
}> {
  const failures: Array<{ path: string; error: string }> = [];

  for (const entry of entries) {
    try {
      const encoded = JSON.stringify(entry.value);
      if (encoded === undefined) {
        throw new Error("Value cannot be encoded as JSON");
      }
      const setResult = await runCliCaptureBoth(
        ["config", "set", "--strict-json", entry.path, encoded],
        20000,
      );
      if (setResult.code !== 0) {
        const details = String(setResult.stderr || setResult.stdout || "").trim();
        throw new Error(details || `config set exited with code ${String(setResult.code)}`);
      }
    } catch (err) {
      failures.push({ path: entry.path, error: String(err || "unknown error") });
    }
  }

  return { failures };
}

// ── Transient error detection ────────────────────

export function isGatewayTransientError(error: unknown): boolean {
  const parts = [String(error || "")];
  if (isRecord(error)) {
    if (typeof error.message === "string") parts.push(error.message);
    if (typeof error.stderr === "string") parts.push(error.stderr);
  }
  const msg = parts.join(" ").toLowerCase();
  return (
    msg.includes("gateway closed") ||
    msg.includes("1006") ||
    msg.includes("gateway call failed") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up") ||
    msg.includes("timed out")
  );
}

// ── Resilient RPC ────────────────────────────────

export async function gatewayCallWithRetry<T>(
  method: string,
  params?: Record<string, unknown>,
  timeout = 15000,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await gatewayCall<T>(method, params, timeout);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw error;
      }
      const transient = isGatewayTransientError(error);
      const baseDelay = transient ? 300 : 150;
      await sleep(Math.min(baseDelay * attempt, transient ? 1200 : 600));
    }
  }
  throw lastError || new Error("Unknown gateway error");
}

// ── Config data types ────────────────────────────

export type ConfigData = {
  parsed: Record<string, unknown>;
  resolved: Record<string, unknown>;
  hash: string;
};

export type AgentEntry = {
  id: string;
  name?: string;
  model?: unknown;
  workspace?: string;
  identity?: Record<string, unknown>;
  subagents?: Record<string, unknown>;
  heartbeat?: unknown;
  default?: boolean;
  [key: string]: unknown;
};

export type BindingEntry = {
  agentId: string;
  match: {
    channel: string;
    accountId?: string;
  };
  [key: string]: unknown;
};

// ── Typed config.get wrapper ─────────────────────

export async function fetchConfig(timeout = 10000): Promise<ConfigData> {
  const raw = await gatewayCallWithRetry<Record<string, unknown>>(
    "config.get",
    undefined,
    timeout,
  );
  return {
    parsed: isRecord(raw.parsed) ? raw.parsed : {},
    resolved: isRecord(raw.resolved) ? raw.resolved : {},
    hash: String(raw.hash || ""),
  };
}

// ── Atomic config.patch with retry ───────────────

export async function patchConfig(
  patch: Record<string, unknown>,
  opts?: { maxAttempts?: number; restartDelayMs?: number },
): Promise<void> {
  const maxAttempts = opts?.maxAttempts ?? 8;
  const raw = JSON.stringify(patch);
  const fallback = buildConfigSetFallbackEntries(patch);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const configData = await gatewayCall<Record<string, unknown>>(
        "config.get",
        undefined,
        6000,
      );
      const hash = String(configData?.hash || "").trim();
      if (!hash) {
        // Legacy gateway compatibility: some builds omit hash on config.get.
        // First try config.patch without baseHash; if rejected, use CLI config.set fallback.
        try {
          const patchParams: Record<string, unknown> = { raw };
          if (opts?.restartDelayMs) {
            patchParams.restartDelayMs = opts.restartDelayMs;
          }
          await gatewayCall("config.patch", patchParams, 15000);
          await sanitizeConfigFile().catch(() => {});
          return;
        } catch {
          if (!fallback.entries) {
            throw new Error(
              `Compatibility patch unavailable: ${fallback.reason || "unsupported patch"}`,
            );
          }
          const fallbackResult = await applyConfigSetFallback(fallback.entries);
          if (fallbackResult.failures.length > 0) {
            const first = fallbackResult.failures[0];
            throw new Error(
              `Compatibility patch failed at ${first.path}: ${first.error}`,
            );
          }
          return;
        }
      }
      const patchParams: Record<string, unknown> = { raw, baseHash: hash };
      if (opts?.restartDelayMs) {
        patchParams.restartDelayMs = opts.restartDelayMs;
      }
      await gatewayCall("config.patch", patchParams, 15000);
      await sanitizeConfigFile().catch(() => {});
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw error;
      }
      const retryAfterMs = parseRetryAfterMs(error);
      const backoffMs = Math.min(400 * attempt, 2500);
      await sleep(
        retryAfterMs ? Math.max(backoffMs, retryAfterMs + 150) : backoffMs,
      );
    }
  }
  throw lastError || new Error("Unknown config.patch error");
}

// ── Config data extractors ───────────────────────

export function extractAgentsList(configData: ConfigData): AgentEntry[] {
  const agents = isRecord(configData.parsed.agents) ? configData.parsed.agents : {};
  const list = Array.isArray(agents.list) ? agents.list : [];
  return list.filter(isRecord).map((entry) => ({
    ...entry,
    id: String(entry.id || ""),
  })) as AgentEntry[];
}

export function extractBindings(configData: ConfigData): BindingEntry[] {
  const bindings = Array.isArray(configData.parsed.bindings)
    ? configData.parsed.bindings
    : [];
  return bindings.filter(isRecord).map((b) => {
    const match = isRecord(b.match) ? b.match : {};
    return {
      ...b,
      agentId: String(b.agentId || ""),
      match: {
        channel: String(match.channel || ""),
        accountId: typeof match.accountId === "string" ? match.accountId : undefined,
      },
    };
  }) as BindingEntry[];
}
