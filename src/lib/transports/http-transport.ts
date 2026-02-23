/**
 * HTTP transport — talks to the Gateway's HTTP API endpoints.
 *
 * Used for hosted deployments where the platform communicates with
 * tenant Gateway containers over the Docker network, and optionally
 * for self-hosted users who prefer HTTP over CLI subprocesses.
 *
 * Primary endpoint: POST /tools/invoke (always enabled on the Gateway)
 * Auth: Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>
 */

import { getGatewayUrl } from "../paths";
import { parseJsonFromCliOutput, type RunCliResult } from "../openclaw-cli";
import type { OpenClawClient, TransportMode } from "../openclaw-client";

export class HttpTransport implements OpenClawClient {
  private token: string;
  private gatewayUrlCache: string | null = null;

  constructor(gatewayUrl?: string, token?: string) {
    this.token = token || process.env.OPENCLAW_GATEWAY_TOKEN || "";
    this.gatewayUrlCache = gatewayUrl || null;
  }

  getTransport(): TransportMode {
    return "http";
  }

  private async getGwUrl(): Promise<string> {
    if (this.gatewayUrlCache) return this.gatewayUrlCache;
    this.gatewayUrlCache = await getGatewayUrl();
    return this.gatewayUrlCache;
  }

  private authHeaders(): Record<string, string> {
    if (!this.token) return {};
    return { Authorization: `Bearer ${this.token}` };
  }

  /**
   * Invoke a Gateway tool via POST /tools/invoke.
   * Returns the parsed JSON response body.
   */
  private async invoke<T>(
    tool: string,
    args: Record<string, unknown> = {},
    timeout = 15000,
  ): Promise<T> {
    const gwUrl = await this.getGwUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${gwUrl}/tools/invoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ tool, args }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Gateway /tools/invoke ${tool} returned ${res.status}: ${text}`,
        );
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Execute a shell command inside the Gateway via the exec tool.
   * Returns the raw stdout.
   */
  private async execCommand(
    command: string,
    timeout = 15000,
  ): Promise<string> {
    const result = await this.invoke<
      { output?: string; stdout?: string; result?: string } | string
    >("exec", { command }, timeout);
    // The exec tool's response shape can vary; handle common forms.
    if (typeof result === "string") return result;
    return result.output || result.stdout || result.result || JSON.stringify(result);
  }

  // ── OpenClawClient interface ──────────────────────

  async runJson<T>(args: string[], timeout = 15000): Promise<T> {
    const command = `openclaw ${args.join(" ")} --json`;
    const raw = await this.execCommand(command, timeout);
    return parseJsonFromCliOutput<T>(raw, command);
  }

  async run(
    args: string[],
    timeout = 15000,
    _stdin?: string,
  ): Promise<string> {
    const command = `openclaw ${args.join(" ")}`;
    return this.execCommand(command, timeout);
  }

  async runCapture(args: string[], timeout = 15000): Promise<RunCliResult> {
    const command = `openclaw ${args.join(" ")}`;
    try {
      const stdout = await this.execCommand(command, timeout);
      return { stdout, stderr: "", code: 0 };
    } catch (err) {
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        code: 1,
      };
    }
  }

  async gatewayRpc<T>(
    method: string,
    params?: Record<string, unknown>,
    timeout = 15000,
  ): Promise<T> {
    // For sessions.list, use the dedicated sessions_list tool directly.
    if (method === "sessions.list") {
      return this.invoke<T>("sessions_list", params || {}, timeout);
    }
    // For other RPC methods, delegate to the exec tool running the CLI.
    const command = params
      ? `openclaw gateway call ${method} --json --params '${JSON.stringify(params).replace(/'/g, "'\\''")}'`
      : `openclaw gateway call ${method} --json`;
    const raw = await this.execCommand(command, timeout + 5000);
    return parseJsonFromCliOutput<T>(raw, `gateway call ${method}`);
  }

  async readFile(path: string): Promise<string> {
    const result = await this.invoke<
      { content?: string; output?: string } | string
    >("read", { path });
    if (typeof result === "string") return result;
    return result.content || result.output || "";
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.invoke("write", { path, content });
  }

  async readdir(path: string): Promise<string[]> {
    const raw = await this.execCommand(`ls -1 "${path}"`);
    return raw.split("\n").filter(Boolean);
  }

  async gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
    const gwUrl = await this.getGwUrl();
    return fetch(`${gwUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...this.authHeaders(),
      },
    });
  }
}
