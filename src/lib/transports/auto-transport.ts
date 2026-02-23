/**
 * Auto transport — tries HTTP first, falls back to CLI.
 *
 * Probes the Gateway's HTTP endpoint on first use and caches the result
 * for 60 seconds. If the Gateway is reachable over HTTP, uses HttpTransport;
 * otherwise falls back to CliTransport.
 */

import type { OpenClawClient, TransportMode } from "../openclaw-client";
import type { RunCliResult } from "../openclaw-cli";
import { CliTransport } from "./cli-transport";
import { HttpTransport } from "./http-transport";

export class AutoTransport implements OpenClawClient {
  private cli = new CliTransport();
  private http = new HttpTransport();
  private preferHttp = false;
  private lastProbe = 0;
  private probing: Promise<void> | null = null;
  private readonly probeIntervalMs = 60_000;

  getTransport(): TransportMode {
    return "auto";
  }

  /** Probe Gateway availability and cache the result. */
  private async probe(): Promise<void> {
    if (Date.now() - this.lastProbe < this.probeIntervalMs) return;
    // Deduplicate concurrent probes.
    if (this.probing) return this.probing;
    this.probing = (async () => {
      try {
        const token = process.env.OPENCLAW_GATEWAY_TOKEN;
        if (!token) {
          // HTTP transport requires a token; fall back to CLI.
          this.preferHttp = false;
          return;
        }
        const res = await this.http.gatewayFetch("/", {
          signal: AbortSignal.timeout(2000),
        });
        this.preferHttp = res.ok;
      } catch {
        this.preferHttp = false;
      } finally {
        this.lastProbe = Date.now();
        this.probing = null;
      }
    })();
    return this.probing;
  }

  private async pick(): Promise<OpenClawClient> {
    await this.probe();
    return this.preferHttp ? this.http : this.cli;
  }

  /** Execute with automatic fallback on HTTP failure. */
  private async withFallback<T>(
    fn: (client: OpenClawClient) => Promise<T>,
  ): Promise<T> {
    const primary = await this.pick();
    try {
      return await fn(primary);
    } catch (err) {
      if (primary === this.http) {
        // Mark HTTP as unavailable and retry with CLI.
        this.preferHttp = false;
        this.lastProbe = Date.now();
        return fn(this.cli);
      }
      throw err;
    }
  }

  // ── OpenClawClient interface ──────────────────────

  runJson<T>(args: string[], timeout?: number): Promise<T> {
    return this.withFallback((c) => c.runJson<T>(args, timeout));
  }

  run(args: string[], timeout?: number, stdin?: string): Promise<string> {
    return this.withFallback((c) => c.run(args, timeout, stdin));
  }

  runCapture(args: string[], timeout?: number): Promise<RunCliResult> {
    return this.withFallback((c) => c.runCapture(args, timeout));
  }

  gatewayRpc<T>(
    method: string,
    params?: Record<string, unknown>,
    timeout?: number,
  ): Promise<T> {
    return this.withFallback((c) => c.gatewayRpc<T>(method, params, timeout));
  }

  readFile(path: string): Promise<string> {
    return this.withFallback((c) => c.readFile(path));
  }

  writeFile(path: string, content: string): Promise<void> {
    return this.withFallback((c) => c.writeFile(path, content));
  }

  readdir(path: string): Promise<string[]> {
    return this.withFallback((c) => c.readdir(path));
  }

  async gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
    return this.withFallback((c) => c.gatewayFetch(path, init));
  }
}
