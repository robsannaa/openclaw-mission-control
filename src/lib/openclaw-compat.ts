/**
 * Drop-in compatibility layer for gradual migration.
 *
 * Re-exports the same function signatures as openclaw-cli.ts but routes
 * through the unified OpenClawClient. To migrate an API route, change:
 *
 *   import { runCliJson, gatewayCall } from "@/lib/openclaw-cli";
 *     →
 *   import { runCliJson, gatewayCall } from "@/lib/openclaw-compat";
 *
 * No other code changes needed. In CLI mode (default) these behave
 * identically. In HTTP mode they talk to the Gateway over HTTP instead.
 */

import { getClient } from "./openclaw-client";
import type { RunCliResult } from "./openclaw-cli";

// Re-export the type so consumers don't need a second import.
export type { RunCliResult } from "./openclaw-cli";

// Re-export parseJsonFromCliOutput since some routes use it directly.
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
