import { NextResponse } from "next/server";
import { runCliJson } from "@/lib/openclaw";
import { getOpenClawBin } from "@/lib/paths";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

async function runGatewayServiceCommand(
  subcommand: "restart" | "stop" | "start",
  timeout = 25000
): Promise<{ stdout: string; stderr: string }> {
  const bin = await getOpenClawBin();
  return exec(bin, ["gateway", subcommand], {
    timeout,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

/**
 * GET /api/gateway - Returns comprehensive gateway health status.
 *
 * Uses `runCliJson(["health"])` which is routed through the unified
 * OpenClawClient (AutoTransport by default). AutoTransport probes the
 * Gateway over HTTP first and falls back to CLI — so this works in
 * Docker (where the CLI binary is slow) and on Mac (where CLI is fast).
 *
 * Timeout bumped to 30s for environments with cold CLI starts.
 */
export async function GET() {
  try {
    const health = await runCliJson<Record<string, unknown>>(
      ["health"],
      30000
    );
    return NextResponse.json({
      status: health.ok ? "online" : "degraded",
      health,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("timed out") || message.includes("TIMEOUT") || message.includes("aborted");
    return NextResponse.json({
      status: "offline",
      health: {
        ok: false,
        error: isTimeout
          ? "Gateway health check timed out"
          : "Gateway is not running",
      },
    });
  }
}

/**
 * POST /api/gateway - Restart/stop the gateway.
 * Body: { action: "restart" | "stop" }
 *
 * For restart: sends SIGTERM to the gateway process, then the macOS app
 * or daemon manager automatically restarts it.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action as string;

    if (action === "restart" || action === "stop") {
      // Prefer service-manager commands (launchd/systemd/schtasks).
      // This avoids port-collision loops caused by manually spawning a second gateway process.
      if (action === "stop") {
        try {
          const out = await runGatewayServiceCommand("stop");
          return NextResponse.json({
            ok: true,
            message: "Gateway stop requested via service manager",
            output: `${out.stdout}\n${out.stderr}`.trim(),
            action: "stop",
          });
        } catch {
          // If service control is unavailable, fall back to process kill.
        }

        let pid: number | null = null;
        try {
          const { stdout } = await exec("pgrep", ["-f", "openclaw-gateway"], { timeout: 5000 });
          const pids = stdout
            .trim()
            .split("\n")
            .map((p) => parseInt(p, 10))
            .filter((p) => !isNaN(p));
          if (pids.length > 0) pid = pids[0];
        } catch {
          // no running process
        }
        if (!pid) {
          return NextResponse.json({
            ok: true,
            message: "Gateway is already stopped",
            action: "stop",
          });
        }
        process.kill(pid, "SIGTERM");
        return NextResponse.json({
          ok: true,
          message: "Gateway stop signal sent",
          pid,
          action: "stop",
        });
      }

      // action === "restart"
      try {
        const out = await runGatewayServiceCommand("restart", 35000);
        return NextResponse.json({
          ok: true,
          message: "Gateway restart requested via service manager",
          output: `${out.stdout}\n${out.stderr}`.trim(),
          action: "restart",
        });
      } catch (serviceErr) {
        // Fallback for unsupervised setups: stop then start via service commands.
        // Do not call bare `openclaw gateway` to avoid duplicate listeners.
        try {
          await runGatewayServiceCommand("stop", 20000).catch(() => null);
          await new Promise((resolve) => setTimeout(resolve, 800));
          const out = await runGatewayServiceCommand("start", 25000);
          return NextResponse.json({
            ok: true,
            message: "Gateway start requested (fallback path)",
            output: `${out.stdout}\n${out.stderr}`.trim(),
            action: "start",
          });
        } catch {
          return NextResponse.json(
            {
              ok: false,
              error: `Gateway restart failed: ${String(serviceErr)}`,
            },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    console.error("Gateway POST error:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
