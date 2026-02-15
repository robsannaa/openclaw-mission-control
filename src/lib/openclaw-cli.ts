import { execFile } from "child_process";
import { promisify } from "util";
import { getOpenClawBin } from "./paths";

const exec = promisify(execFile);

export async function runCli(
  args: string[],
  timeout = 15000
): Promise<string> {
  const bin = await getOpenClawBin();
  const { stdout } = await exec(bin, args, {
    timeout,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return stdout;
}

export async function runCliJson<T>(
  args: string[],
  timeout = 15000
): Promise<T> {
  const stdout = await runCli([...args, "--json"], timeout);
  return JSON.parse(stdout) as T;
}

export async function gatewayCall<T>(
  method: string,
  params?: Record<string, unknown>,
  timeout = 15000
): Promise<T> {
  const args = ["gateway", "call", method, "--json"];
  if (params) args.push("--params", JSON.stringify(params));
  if (timeout > 10000) args.push("--timeout", String(timeout));
  const stdout = await runCli(args, timeout + 5000);
  return JSON.parse(stdout) as T;
}
