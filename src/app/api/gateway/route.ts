import { NextResponse } from "next/server";
import { runCliJson, runCli } from "@/lib/openclaw-cli";
import { getOpenClawBin } from "@/lib/paths";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

/**
 * GET /api/gateway - Returns comprehensive gateway health status.
 * Uses `openclaw health --json` for rich data including channel status,
 * agent info, sessions, and heartbeat configuration.
 */
export async function GET() {
  try {
    const health = await runCliJson<Record<string, unknown>>(
      ["health"],
      12000
    );
    return NextResponse.json({
      status: health.ok ? "online" : "degraded",
      health,
    });
  } catch (err) {
    // If health check fails entirely, gateway is likely offline
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("timed out") || message.includes("TIMEOUT");
    const isConnectionRefused = message.includes("ECONNREFUSED") || message.includes("connect");
    return NextResponse.json({
      status: "offline",
      health: {
        ok: false,
        error: isTimeout
          ? "Gateway health check timed out"
          : isConnectionRefused
            ? "Gateway is not running"
            : message,
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
      // Find the gateway PID
      let pid: number | null = null;
      try {
        // Look for the openclaw-gateway process
        const { stdout } = await exec("pgrep", ["-f", "openclaw-gateway"], {
          timeout: 5000,
        });
        const pids = stdout
          .trim()
          .split("\n")
          .map((p) => parseInt(p, 10))
          .filter((p) => !isNaN(p));
        if (pids.length > 0) pid = pids[0];
      } catch {
        // pgrep returns exit code 1 if no match
      }

      // Also try lsof on port 18789
      if (!pid) {
        try {
          const { stdout } = await exec("lsof", ["-i", ":18789", "-t"], {
            timeout: 5000,
          });
          const pids = stdout
            .trim()
            .split("\n")
            .map((p) => parseInt(p, 10))
            .filter((p) => !isNaN(p));
          if (pids.length > 0) pid = pids[0];
        } catch {
          // no process on port
        }
      }

      if (!pid) {
        if (action === "stop") {
          return NextResponse.json({
            ok: true,
            message: "Gateway is already stopped",
          });
        }
        // For restart when not running, try to start it
        try {
          // Start in background - don't wait for it
          const bin = await getOpenClawBin();
          exec(bin, ["gateway"], {
            timeout: 3000,
            env: { ...process.env, NO_COLOR: "1" },
          }).catch(() => {});
          return NextResponse.json({
            ok: true,
            message: "Gateway start initiated",
            action: "start",
          });
        } catch {
          return NextResponse.json(
            { ok: false, error: "Failed to start gateway" },
            { status: 500 }
          );
        }
      }

      // Send SIGTERM for graceful shutdown
      process.kill(pid, "SIGTERM");

      if (action === "stop") {
        return NextResponse.json({
          ok: true,
          message: "Gateway stop signal sent",
          pid,
          action: "stop",
        });
      }

      // For restart: wait briefly, then start again
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Start gateway in background
      const binPath = await getOpenClawBin();
      exec(binPath, ["gateway"], {
        timeout: 3000,
        env: { ...process.env, NO_COLOR: "1" },
      }).catch(() => {});

      return NextResponse.json({
        ok: true,
        message: "Gateway restart initiated",
        pid,
        action: "restart",
      });
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
