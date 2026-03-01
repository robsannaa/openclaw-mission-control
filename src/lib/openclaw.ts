/**
 * Primary OpenClaw client — all server-side code should import from here.
 *
 * Routes every call through the unified OpenClawClient which selects the
 * best transport automatically (HTTP to Gateway when available, CLI
 * subprocess as fallback). Works on Mac, Linux, and Docker.
 *
 * Internal modules (transports, openclaw-cli.ts) should NOT be imported
 * directly from API routes or lib helpers.
 */

import { getClient } from "./openclaw-client";
import type { RunCliResult } from "./openclaw-cli";

export type { RunCliResult } from "./openclaw-cli";
export { parseJsonFromCliOutput } from "./openclaw-cli";

export async function runCli(
  args: string[],
  timeout = 15000,
  stdin?: string,
): Promise<string> {
  const client = await getClient();
  return client.run(args, timeout, stdin);
}

export async function runCliJson<T>(
  args: string[],
  timeout = 15000,
): Promise<T> {
  const client = await getClient();
  return client.runJson<T>(args, timeout);
}

export async function runCliCaptureBoth(
  args: string[],
  timeout = 15000,
): Promise<RunCliResult> {
  const client = await getClient();
  return client.runCapture(args, timeout);
}

export async function gatewayCall<T>(
  method: string,
  params?: Record<string, unknown>,
  timeout = 15000,
): Promise<T> {
  const client = await getClient();
  return client.gatewayRpc<T>(method, params, timeout);
}
