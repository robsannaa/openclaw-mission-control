import { getGatewayUrl, getGatewayToken } from "@/lib/paths";
import { logRequest, logError } from "@/lib/request-log";

/**
 * Streaming chat endpoint — proxies SSE from the Gateway's OpenResponses API.
 *
 * POST /api/chat/stream
 * Body: { agent, messages: [{ role, id, parts }], model? }
 *
 * Streams back SSE events from the gateway's POST /v1/responses endpoint.
 * If the gateway doesn't support OpenResponses (404/502), returns a specific
 * status so the client can fall back to the non-streaming /api/chat endpoint.
 */
export async function POST(req: Request) {
  const start = Date.now();
  try {
    const body = await req.json();
    const messages: {
      role: string;
      parts?: { type: string; text?: string; url?: string; filename?: string; mimeType?: string }[];
      content?: string;
    }[] = body.messages || [];
    const agentId: string = body.agent || body.agentId || "main";
    const model: string | undefined = body.model?.trim() || undefined;

    // Extract last user message — text + file attachments as OpenResponses input items
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const inputItems: unknown[] = [];

    if (lastUserMsg?.parts) {
      for (const p of lastUserMsg.parts) {
        if (p.type === "text" && p.text) {
          inputItems.push({
            type: "message",
            role: "user",
            content: p.text,
          });
        } else if (p.type === "file" && p.url) {
          const mime = p.mimeType || guessMimeFromUrl(p.url, p.filename);
          if (mime.startsWith("image/")) {
            inputItems.push({
              type: "input_image",
              source: { type: "url", url: p.url },
            });
          } else {
            // Extract base64 data from data URL
            const base64Match = p.url.match(/^data:[^;]+;base64,(.+)$/);
            if (base64Match) {
              inputItems.push({
                type: "input_file",
                source: {
                  type: "base64",
                  media_type: mime,
                  data: base64Match[1],
                  filename: p.filename || "file",
                },
              });
            }
          }
        }
      }
    } else if (lastUserMsg?.content) {
      inputItems.push({
        type: "message",
        role: "user",
        content: lastUserMsg.content,
      });
    }

    // Flatten: if there's only simple text, use a plain string input
    const input =
      inputItems.length === 1 &&
      (inputItems[0] as { type: string }).type === "message"
        ? (inputItems[0] as { content: string }).content
        : inputItems.length > 0
          ? inputItems
          : "";

    if (!input || (typeof input === "string" && !input.trim())) {
      return new Response("Please send a message or attach a file.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const gwUrl = await getGatewayUrl();
    const token = getGatewayToken();

    // Build OpenResponses request
    const orBody: Record<string, unknown> = {
      model: model || "openclaw",
      input,
      stream: true,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-openclaw-agent-id": agentId,
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    let gwRes: Response;
    try {
      gwRes = await fetch(`${gwUrl}/v1/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify(orBody),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      logError("/api/chat/stream", err, { agentId, phase: "gateway_fetch" });
      return new Response(
        JSON.stringify({ error: "gateway_unreachable", message: String(err) }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!gwRes.ok) {
      clearTimeout(timeout);
      const text = await gwRes.text().catch(() => "");
      logRequest("/api/chat/stream", gwRes.status, Date.now() - start, { agentId, error: gwRes.status === 404 ? "endpoint_not_enabled" : "gateway_error" });
      return new Response(
        JSON.stringify({
          error: gwRes.status === 404 ? "endpoint_not_enabled" : "gateway_error",
          status: gwRes.status,
          message: text,
        }),
        { status: gwRes.status, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!gwRes.body) {
      clearTimeout(timeout);
      return new Response(
        JSON.stringify({ error: "no_stream_body" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    // Pipe the SSE stream through to the client
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Pipe in background — don't await
    (async () => {
      const reader = gwRes.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      } catch {
        // Stream interrupted (client disconnect, gateway error) — ok
      } finally {
        clearTimeout(timeout);
        await writer.close().catch(() => {});
      }
    })();

    logRequest("/api/chat/stream", 200, Date.now() - start, { agentId, model: model || "openclaw" });
    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    logError("/api/chat/stream", err);
    return new Response(
      JSON.stringify({
        error: "internal",
        message: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

function guessMimeFromUrl(url: string, filename?: string): string {
  const name = filename || url;
  if (/\.(jpe?g)$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.md$/i.test(name)) return "text/markdown";
  if (/\.html?$/i.test(name)) return "text/html";
  // Check data URL prefix
  const mimeMatch = url.match(/^data:([^;]+);/);
  if (mimeMatch) return mimeMatch[1];
  return "text/plain";
}
