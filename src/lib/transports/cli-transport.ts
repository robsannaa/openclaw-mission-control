/**
 * CLI transport — delegates to the existing openclaw-cli.ts functions.
 *
 * This is the default transport for self-hosted installations where the
 * `openclaw` binary is available on the same machine. All methods pass
 * through 1:1 to the existing implementations with zero behavior change.
 */

import {
  runCli,
  runCliJson,
  runCliCaptureBoth,
  gatewayCall,
  type RunCliResult,
} from "../openclaw-cli";
import { readFile, writeFile, readdir } from "fs/promises";
import { getGatewayUrl } from "../paths";
import type { OpenClawClient, TransportMode } from "../openclaw-client";

export class CliTransport implements OpenClawClient {
  getTransport(): TransportMode {
    return "cli";
  }

  async runJson<T>(args: string[], timeout = 15000): Promise<T> {
    return runCliJson<T>(args, timeout);
  }

  async run(
    args: string[],
    timeout = 15000,
    stdin?: string,
  ): Promise<string> {
    return runCli(args, timeout, stdin);
  }

  async runCapture(args: string[], timeout = 15000): Promise<RunCliResult> {
    return runCliCaptureBoth(args, timeout);
  }

  async gatewayRpc<T>(
    method: string,
    params?: Record<string, unknown>,
    timeout = 15000,
  ): Promise<T> {
    return gatewayCall<T>(method, params, timeout);
  }

  async readFile(path: string): Promise<string> {
    return readFile(path, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf-8");
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await readdir(path);
    return entries.map(String);
  }

  async gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
    const gwUrl = await getGatewayUrl();
    return fetch(`${gwUrl}${path}`, init);
  }
}
