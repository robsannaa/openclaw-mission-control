import { NextRequest } from "next/server";
import { subscribeKanban } from "@/lib/kanban-live";

/**
 * SSE stream for live kanban updates.
 * When kanban.json is written via the dashboard API (PUT or POST init),
 * all connected clients receive a kanban-updated event and can refetch.
 * No polling, no file watcher — works on any install (Mac, VPC).
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: { type: string }) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          unsubscribe();
        }
      };

      const unsubscribe = subscribeKanban(send);

      // Heartbeat so proxies don't close the connection
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`)
          );
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      // Subscription removed in abort listener
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
