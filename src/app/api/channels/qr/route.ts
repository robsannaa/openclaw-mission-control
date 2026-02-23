/**
 * SSE endpoint for streaming QR code login (WhatsApp / Signal).
 *
 * Spawns `openclaw channels login --channel <ch>` as a long-lived process
 * and streams its stdout to the browser via Server-Sent Events. The CLI
 * outputs a QR code as ASCII art which refreshes periodically.
 *
 * Event types:
 *   qr   — A QR ASCII art frame (debounced, sent after 150ms of silence)
 *   log  — Status/log text from stderr
 *   done — Process exited (data contains exit message)
 *   error — Fatal error
 *   ping — Keepalive (every 15s)
 */

import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { getOpenClawBin } from "@/lib/paths";

export const dynamic = "force-dynamic";

const ALLOWED_CHANNELS = new Set(["whatsapp", "signal"]);
const PROCESS_TIMEOUT_MS = 120_000; // 2 minutes
const QR_DEBOUNCE_MS = 150;
const KEEPALIVE_MS = 15_000;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel") || "whatsapp";
  const account = searchParams.get("account") || "";

  if (!ALLOWED_CHANNELS.has(channel)) {
    return Response.json(
      { error: "QR login only supported for whatsapp and signal" },
      { status: 400 },
    );
  }

  let bin: string;
  try {
    bin = await getOpenClawBin();
  } catch {
    return Response.json(
      { error: "OpenClaw binary not found" },
      { status: 500 },
    );
  }

  const args = ["channels", "login", "--channel", channel];
  if (account) args.push("--account", account);

  const proc = spawn(bin, args, {
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    timeout: PROCESS_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: Record<string, string>) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      // ── QR debounce ──────────────────────────────────
      // The CLI prints QR codes in multiple write() calls. We accumulate
      // chunks and send them as one frame after a brief pause.
      let qrBuffer = "";
      let qrTimer: ReturnType<typeof setTimeout> | null = null;

      const flushQr = () => {
        if (qrBuffer.trim()) {
          send({ type: "qr", data: qrBuffer });
          qrBuffer = "";
        }
      };

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        qrBuffer += text;
        if (qrTimer) clearTimeout(qrTimer);
        qrTimer = setTimeout(flushQr, QR_DEBOUNCE_MS);
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) send({ type: "log", data: text });
      });

      proc.on("close", (code) => {
        // Flush any remaining buffered QR data.
        if (qrTimer) {
          clearTimeout(qrTimer);
          qrTimer = null;
        }
        flushQr();

        send({
          type: "done",
          data:
            code === 0
              ? "Login successful"
              : `Process exited with code ${code}`,
        });

        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });

      proc.on("error", (err) => {
        send({ type: "error", data: err.message });
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });

      // ── Keepalive ────────────────────────────────────
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        send({ type: "ping" });
      }, KEEPALIVE_MS);

      // ── Cleanup on client disconnect ─────────────────
      request.signal.addEventListener("abort", () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (qrTimer) clearTimeout(qrTimer);
        try {
          proc.kill("SIGTERM");
        } catch {
          /* already exited */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },

    cancel() {
      if (closed) return;
      closed = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already exited */
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
