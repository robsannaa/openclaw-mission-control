import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getOpenClawBin } from "@/lib/paths";
import { runCliJson } from "@/lib/openclaw";
import { classifyDoctorOutput, type DoctorIssue } from "@/lib/doctor-checks";
import { getLastRunTimestamp } from "@/lib/doctor-history";

export const dynamic = "force-dynamic";

const exec = promisify(execFile);
const ANSI_RE = /\u001B\[[0-9;]*m/g;

type GatewayStatusPayload = {
  service?: {
    runtime?: { status?: string; pid?: number };
  };
  gateway?: { port?: number };
  port?: { port?: number; status?: string };
  rpc?: { ok?: boolean };
};

async function runDoctor(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const bin = await getOpenClawBin();
  try {
    const { stdout, stderr } = await exec(bin, ["doctor", "--non-interactive"], {
      timeout: 45000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { stdout: stdout || "", stderr: stderr || "", exitCode: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const exitCode = typeof e.code === "number" ? e.code : 1;
    return { stdout: e.stdout || "", stderr: e.stderr || "", exitCode };
  }
}

export async function GET() {
  // Run doctor + gateway status in parallel
  const [doctorResult, gatewayResult, lastRunAt] = await Promise.all([
    runDoctor(),
    runCliJson<GatewayStatusPayload>(["gateway", "status"], 30000).catch(() => null),
    getLastRunTimestamp(),
  ]);

  const raw = `${doctorResult.stdout}${doctorResult.stderr ? `\n${doctorResult.stderr}` : ""}`.trim();
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(ANSI_RE, "").trim())
    .filter((l) => l.length > 0);

  const issues: DoctorIssue[] = classifyDoctorOutput(lines);

  let errors = 0;
  let warnings = 0;
  let healthy = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errors++;
    else if (issue.severity === "warning") warnings++;
    else healthy++;
  }

  // Health score: 100 - (20 * errors) - (5 * warnings), floor 0
  const healthScore = Math.max(0, 100 - 20 * errors - 5 * warnings);
  const overallHealth: "healthy" | "needs-attention" | "critical" =
    healthScore >= 80 ? "healthy" : healthScore >= 40 ? "needs-attention" : "critical";

  const gatewayStatus = gatewayResult
    ? (gatewayResult.service?.runtime?.status || "unknown")
    : "unknown";
  const gatewayPort = gatewayResult?.gateway?.port || gatewayResult?.port?.port || 18789;
  const gatewayPid = gatewayResult?.service?.runtime?.pid;

  return NextResponse.json({
    ts: Date.now(),
    overallHealth,
    healthScore,
    lastRunAt,
    summary: { errors, warnings, healthy },
    gateway: {
      status: gatewayStatus,
      port: gatewayPort,
      ...(gatewayPid ? { pid: gatewayPid } : {}),
    },
    issues,
  });
}
