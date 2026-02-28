import { NextRequest } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import { getOpenClawBin } from "@/lib/paths";
import { classifyDoctorOutput } from "@/lib/doctor-checks";
import { saveDoctorRun, createRunId } from "@/lib/doctor-history";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

type RunMode = "scan" | "repair" | "repair-force" | "deep" | "generate-token";

const MODE_CONFIG: Record<RunMode, { args: string[]; timeout: number }> = {
  scan: { args: ["doctor", "--non-interactive"], timeout: 45000 },
  repair: { args: ["doctor", "--repair"], timeout: 60000 },
  "repair-force": { args: ["doctor", "--repair", "--force"], timeout: 120000 },
  deep: { args: ["doctor", "--deep", "--non-interactive"], timeout: 60000 },
  "generate-token": { args: ["doctor", "--generate-gateway-token", "--non-interactive"], timeout: 30000 },
};

// Concurrency guard
let activeChild: ChildProcess | null = null;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const mode = body.mode as string;

  if (!mode || !(mode in MODE_CONFIG)) {
    return new Response(
      JSON.stringify({ error: `Invalid mode. Expected one of: ${Object.keys(MODE_CONFIG).join(", ")}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (activeChild) {
    return new Response(
      JSON.stringify({ error: "A doctor run is already in progress" }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }

  const config = MODE_CONFIG[mode as RunMode];
  const bin = await getOpenClawBin();
  const encoder = new TextEncoder();
  const runId = createRunId();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    start(controller) {
      const allOutput: string[] = [];

      const child = spawn(bin, config.args, {
        env: { ...process.env, NO_COLOR: "1" },
        timeout: config.timeout,
        stdio: ["pipe", "pipe", "pipe"],
      });

      activeChild = child;

      // Send initial banner
      const banner = `$ openclaw ${config.args.join(" ")}\n`;
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "stdout", text: banner })}\n\n`)
        );
      } catch { /* stream closed */ }

      child.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        allOutput.push(text);
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "stdout", text })}\n\n`)
          );
        } catch { /* stream closed */ }
      });

      child.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        allOutput.push(text);
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "stderr", text })}\n\n`)
          );
        } catch { /* stream closed */ }
      });

      child.on("close", (code) => {
        activeChild = null;
        const exitCode = code ?? 1;
        const completedAt = Date.now();
        const rawOutput = allOutput.join("");
        const lines = rawOutput.split(/\r?\n/);
        const issues = classifyDoctorOutput(lines);

        const summary = { errors: 0, warnings: 0, healthy: 0 };
        for (const issue of issues) {
          if (issue.severity === "error") summary.errors++;
          else if (issue.severity === "warning") summary.warnings++;
          else summary.healthy++;
        }

        // Save to history (fire and forget)
        saveDoctorRun({
          id: runId,
          startedAt,
          completedAt,
          mode,
          exitCode,
          summary,
          issues,
          rawOutput,
          durationMs: completedAt - startedAt,
        }).catch(() => {});

        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "exit", code: exitCode })}\n\n`
            )
          );
          controller.close();
        } catch { /* stream closed */ }
      });

      child.on("error", (err) => {
        activeChild = null;
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", text: String(err) })}\n\n`
            )
          );
          controller.close();
        } catch { /* stream closed */ }
      });

      // Close stdin immediately
      child.stdin.end();
    },
    cancel() {
      // Kill the child process when the client disconnects / aborts
      if (activeChild && !activeChild.killed) {
        activeChild.kill();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
