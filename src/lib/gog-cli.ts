/**
 * Helpers to run the gog CLI (https://clawhub.ai/steipete/gog).
 * Same pattern as openclaw-cli.ts. Uses getGogBin() and process.env (GOG_ACCOUNT is passed through).
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { getGogBin } from "./paths";

const exec = promisify(execFile);

/** Result when both stdout and stderr are captured. */
export type RunGogResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export type RunGogOptions = {
  /** Override env vars for this run (e.g. { GOG_ACCOUNT: "user@example.com" }). */
  envOverrides?: Record<string, string>;
};

function gogEnv(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.env.GOG_ACCOUNT) env.GOG_ACCOUNT = process.env.GOG_ACCOUNT;
  if (overrides) Object.assign(env, overrides);
  return env;
}

/**
 * Run gog and capture both stdout and stderr.
 */
export async function runGogCaptureBoth(
  args: string[],
  timeout = 15000,
  options?: RunGogOptions
): Promise<RunGogResult> {
  const bin = await getGogBin();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: gogEnv(options?.envOverrides),
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("close", (code, signal) => {
      resolve({
        stdout,
        stderr,
        code: code ?? (signal ? -1 : 0),
      });
    });
    child.on("error", reject);
  });
}

/**
 * Run gog and return stdout. Throws on non-zero exit.
 */
export async function runGog(
  args: string[],
  timeout = 15000,
  stdin?: string,
  options?: RunGogOptions
): Promise<string> {
  const bin = await getGogBin();
  const env = gogEnv(options?.envOverrides);
  if (stdin !== undefined) {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        env,
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`gog failed (exit ${code}): ${stderr || stdout}`));
      });
      child.on("error", reject);
      child.stdin.write(stdin);
      child.stdin.end();
    });
  }
  const { stdout } = await exec(bin, args, {
    encoding: "utf-8",
    timeout,
    env,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Run gog with --json and parse stdout as JSON.
 */
export async function runGogJson<T>(
  args: string[],
  timeout = 15000,
  options?: RunGogOptions
): Promise<T> {
  const stdout = await runGog([...args, "--json"], timeout, undefined, options);
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("gog returned empty output");
  return JSON.parse(trimmed) as T;
}
