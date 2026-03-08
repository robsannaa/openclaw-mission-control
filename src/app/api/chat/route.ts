import { runOpenResponsesText, guessMime } from "@/lib/openresponses";
import { getGatewayUrl, getGatewayToken } from "@/lib/paths";
import { waitForResponsesEndpoint } from "@/app/api/gateway/route";

/**
 * Chat endpoint that sends a message to an OpenClaw agent and returns the response.
 * Works with Vercel AI SDK v5's TextStreamChatTransport.
 *
 * Tries the Gateway's OpenResponses API first (streaming, token-by-token),
 * then a non-streaming gateway request. This route is gateway-only.
 *
 * Request body: { messages, agentId, sessionKey?, model?, ... }
 * Each UIMessage has { id, role, parts: [{ type: 'text', text }, { type: 'file', url, filename }] }
 */

// ── Message extraction helpers ──────────────────────

function dataUrlToSafeMessagePart(
  dataUrl: string,
  filename: string,
): string {
  try {
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
    if (!base64) return `[Attached: ${filename} (empty)]`;
    const buf = Buffer.from(base64, "base64");
    if (buf.includes(0))
      return `[Attached: ${filename} (binary file - not included in message)]`;
    const text = buf.toString("utf-8");
    return `[Attached: ${filename}]\n${text}`;
  } catch {
    return `[Attached: ${filename} (could not decode)]`;
  }
}

type MessagePart = {
  type: string;
  text?: string;
  url?: string;
  filename?: string;
  mimeType?: string;
};

type Message = {
  role: string;
  parts?: MessagePart[];
  content?: string;
};

function normalizeRequestedSessionKey(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}


function extractContent(messages: Message[]): {
  plainText: string;
  openResponsesInput: unknown;
} {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const textParts: string[] = [];
  const fileParts: string[] = [];
  const orItems: unknown[] = [];

  if (lastUserMsg?.parts) {
    for (const p of lastUserMsg.parts) {
      if (p.type === "text" && p.text) {
        textParts.push(p.text);
        orItems.push({ type: "message", role: "user", content: p.text });
      } else if (p.type === "file" && p.url) {
        const name = (p.filename || "file").replace(/\s+/g, " ");
        fileParts.push(dataUrlToSafeMessagePart(p.url, name));

        // Build native OpenResponses input items for files
        const mime = p.mimeType || guessMime(p.url, p.filename);
        if (mime.startsWith("image/")) {
          orItems.push({ type: "input_image", source: { type: "url", url: p.url } });
        } else {
          const base64Match = p.url.match(/^data:[^;]+;base64,(.+)$/);
          if (base64Match) {
            orItems.push({
              type: "input_file",
              source: { type: "base64", media_type: mime, data: base64Match[1], filename: name },
            });
          }
        }
      }
    }
  } else if (lastUserMsg?.content) {
    textParts.push(lastUserMsg.content);
    orItems.push({ type: "message", role: "user", content: lastUserMsg.content });
  }

  const textBlock = textParts.join("").trim();
  const fileBlock = fileParts.length ? "\n\n" + fileParts.join("\n\n---\n\n") : "";
  const plainText = (textBlock + fileBlock).trim();

  // Flatten simple text-only to a plain string
  const openResponsesInput =
    orItems.length === 1 && (orItems[0] as { type: string }).type === "message"
      ? (orItems[0] as { content: string }).content
      : orItems;

  return { plainText, openResponsesInput };
}

// ── Streaming via OpenResponses API ─────────────────

/**
 * Parse SSE chunks and extract text deltas from OpenResponses events.
 * Returns an async generator that yields text fragments.
 */
async function* parseOpenResponsesStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE lines
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") return;

      try {
        const event = JSON.parse(data);
        // Extract text deltas from OpenResponses events
        if (event.type === "response.output_text.delta" && event.delta) {
          yield event.delta;
        }
        // Handle error events
        if (event.type === "response.failed" && event.response?.error) {
          yield `\n\nError: ${event.response.error.message || "Agent encountered an error"}`;
          return;
        }
      } catch {
        // Non-JSON SSE line — skip
      }
    }
  }
}

async function tryStreamingResponse(
  input: unknown,
  agentId: string,
  sessionKey?: string,
): Promise<Response | null> {
  let gwUrl: string;
  let token: string;
  try {
    gwUrl = await getGatewayUrl();
    token = getGatewayToken();
  } catch (e) {
    console.warn("[chat] Gateway URL/token not available:", e);
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-openclaw-agent-id": agentId,
  };
  if (sessionKey) headers["x-openclaw-session-key"] = sessionKey;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const orBody: Record<string, unknown> = {
    model: `openclaw:${agentId}`,
    input,
    stream: true,
  };

  const endpoint = `${gwUrl}/v1/responses`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  let gwRes: Response;
  try {
    gwRes = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(orBody),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    console.warn(`[chat] Gateway unreachable at ${endpoint}:`, e);
    return null;
  }

  if (!gwRes.ok || !gwRes.body) {
    clearTimeout(timeout);
    const status = gwRes.status;
    const text = await gwRes.text().catch(() => "");
    console.warn(`[chat] Gateway returned ${status} from ${endpoint}.`, text.slice(0, 200));
    return null;
  }

  console.log(
    `[chat] Streaming via gateway OpenResponses API (agent=${agentId}, session=${sessionKey || "ephemeral"})`,
  );

  // Stream text deltas as plain text for TextStreamChatTransport
  const reader = gwRes.body.getReader();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const delta of parseOpenResponsesStream(reader)) {
          ctrl.enqueue(encoder.encode(delta));
        }
      } catch {
        // Stream interrupted — ok
      } finally {
        clearTimeout(timeout);
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// ── Non-streaming gateway fallback ──────────────────

async function nonStreamingResponse(
  input: unknown,
  agentId: string,
  sessionKey?: string,
): Promise<Response | null> {
  try {
    const result = await runOpenResponsesText({
      input,
      agentId,
      sessionKey,
      timeoutMs: 180_000,
    });

    if (!result.ok) return null;

    return new Response(result.text || "", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return null;
  }
}

function gatewayUnavailableResponse(): Response {
  return new Response(
    [
      "Mission Control could not send this message through the OpenClaw gateway.",
      "Chat on this page is API-only and no longer falls back to the CLI.",
      "Check that the gateway is online and that your model provider is configured, then try again.",
    ].join(" "),
    {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }
  );
}

// ── Main handler ────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages: Message[] = body.messages || [];
    const agentId: string = body.agentId || "main";
    const sessionKey = normalizeRequestedSessionKey(body.sessionKey);

    const { plainText, openResponsesInput } = extractContent(messages);

    if (!plainText) {
      return new Response("Please send a message or attach a file.", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // Wait for the responses endpoint setup if it's still in progress
    // (ensureResponsesEndpoint fires async on the first gateway health check)
    await waitForResponsesEndpoint();

    // Try streaming via OpenResponses API first
    const streamingRes = await tryStreamingResponse(
      openResponsesInput,
      agentId,
      sessionKey,
    );
    if (streamingRes) return streamingRes;

    // Try a non-streaming OpenResponses request before spawning the CLI.
    const textRes = await nonStreamingResponse(
      openResponsesInput,
      agentId,
      sessionKey,
    );
    if (textRes) return textRes;

    return gatewayUnavailableResponse();
  } catch (err) {
    console.error("Chat API error:", err);
    const errMsg =
      err instanceof Error ? err.message : "Failed to get agent response";
    return new Response(`Error: ${errMsg}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
