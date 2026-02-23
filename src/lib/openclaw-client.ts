/**
 * Unified OpenClaw client abstraction.
 *
 * Provides a single interface for all OpenClaw communication that works
 * over both CLI subprocesses (self-hosted) and HTTP to the Gateway
 * (hosted / remote). The transport is selected via the OPENCLAW_TRANSPORT
 * environment variable:
 *
 *   "cli"  (default) — spawns `openclaw` binary, reads local files
 *   "http"           — talks HTTP to the Gateway's /tools/invoke endpoint
 *   "auto"           — tries HTTP, falls back to CLI
 */

import type { RunCliResult } from "./openclaw-cli";

export type TransportMode = "cli" | "http" | "auto";

export interface OpenClawClient {
  /** Run a CLI command and return parsed JSON (equivalent to runCliJson). */
  runJson<T>(args: string[], timeout?: number): Promise<T>;

  /** Run a CLI command and return raw stdout (equivalent to runCli). */
  run(args: string[], timeout?: number, stdin?: string): Promise<string>;

  /** Run a CLI command capturing stdout, stderr, exit code (equivalent to runCliCaptureBoth). */
  runCapture(args: string[], timeout?: number): Promise<RunCliResult>;

  /** Call a Gateway RPC method (equivalent to gatewayCall). */
  gatewayRpc<T>(
    method: string,
    params?: Record<string, unknown>,
    timeout?: number,
  ): Promise<T>;

  /** Read a file from the OpenClaw filesystem. */
  readFile(path: string): Promise<string>;

  /** Write a file to the OpenClaw filesystem. */
  writeFile(path: string, content: string): Promise<void>;

  /** List directory contents (file names only). */
  readdir(path: string): Promise<string[]>;

  /** HTTP request to the Gateway (health check, etc). */
  gatewayFetch(path: string, init?: RequestInit): Promise<Response>;

  /** The resolved transport mode. */
  getTransport(): TransportMode;
}

// ── Singleton ──────────────────────────────────────

let _client: OpenClawClient | null = null;

export function getTransportMode(): TransportMode {
  const mode = (
    process.env.OPENCLAW_TRANSPORT || "cli"
  ).toLowerCase() as string;
  if (mode === "http" || mode === "auto") return mode as TransportMode;
  return "cli";
}

/**
 * Returns the singleton OpenClawClient for the current transport mode.
 * Lazy-loads the transport implementation on first call.
 */
export async function getClient(): Promise<OpenClawClient> {
  if (_client) return _client;

  const mode = getTransportMode();
  switch (mode) {
    case "http": {
      const { HttpTransport } = await import("./transports/http-transport");
      _client = new HttpTransport();
      break;
    }
    case "auto": {
      const { AutoTransport } = await import("./transports/auto-transport");
      _client = new AutoTransport();
      break;
    }
    default: {
      const { CliTransport } = await import("./transports/cli-transport");
      _client = new CliTransport();
      break;
    }
  }
  return _client;
}

/** Reset the singleton (for testing). */
export function resetClient(): void {
  _client = null;
}
