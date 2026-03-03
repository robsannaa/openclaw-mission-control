import { gatewayCall, runCli } from "@/lib/openclaw";
import { getGatewayUrl, getGatewayToken } from "@/lib/paths";

/**
 * Chat endpoint that sends a message to an OpenClaw agent and returns the response.
 * Works with Vercel AI SDK v5's TextStreamChatTransport.
 *
 * Tries the Gateway's OpenResponses API first (streaming, token-by-token).
 * Falls back to CLI subprocess if the gateway endpoint isn't available.
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

function guessMime(url: string, filename?: string): string {
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
  const mimeMatch = url.match(/^data:([^;]+);/);
  if (mimeMatch) return mimeMatch[1];
  return "text/plain";
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

type SessionsPatchResult = {
  ok?: boolean;
  resolved?: {
    modelProvider?: string;
    model?: string;
  };
};

function normalizeRequestedSessionKey(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function buildActiveModelInstructions(requestedModel?: string): string | undefined {
  if (!requestedModel) return undefined;
  return [
    `Active chat model for this request: ${requestedModel}.`,
    `If the user asks which model you are using, answer with ${requestedModel}.`,
    "If they ask about the saved agent setup or default model, distinguish that from the active chat model.",
  ].join(" ");
}

function buildModelLockError(
  requestedModel: string,
  detail: string,
  status = 503,
): Response {
  return new Response(
    [
      `Mission Control could not use ${requestedModel}.`,
      detail,
      "To avoid sending your message with a different model, the request was stopped.",
      "Try again, or switch this chat back to the agent setup.",
    ].join(" "),
    {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    },
  );
}

async function ensureChatSessionModel(
  sessionKey: string | undefined,
  requestedModel: string | undefined,
): Promise<Response | null> {
  if (!sessionKey) {
    if (!requestedModel) return null;
    return buildModelLockError(
      requestedModel,
      "Mission Control could not create a stable OpenClaw session for this chat.",
      400,
    );
  }

  let patchResult: SessionsPatchResult;
  try {
    patchResult = await gatewayCall<SessionsPatchResult>(
      "sessions.patch",
      { key: sessionKey, model: requestedModel ?? null },
      15000,
    );
  } catch (err) {
    if (!requestedModel) return null;
    return buildModelLockError(
      requestedModel,
      `The OpenClaw gateway could not save the selected chat model (${String(err)}).`,
    );
  }

  if (!requestedModel) return null;

  const resolvedProvider = patchResult.resolved?.modelProvider?.trim();
  const resolvedModel = patchResult.resolved?.model?.trim();
  const resolvedRef =
    resolvedProvider && resolvedModel ? `${resolvedProvider}/${resolvedModel}` : "";

  if (resolvedRef === requestedModel) return null;

  return buildModelLockError(
    requestedModel,
    resolvedRef
      ? `OpenClaw resolved this chat to ${resolvedRef} instead.`
      : "OpenClaw did not confirm the selected chat model.",
    409,
  );
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
  requestedModel?: string,
): Promise<Response | null> {
  let gwUrl: string;
  let token: string;
  try {
    gwUrl = await getGatewayUrl();
    token = getGatewayToken();
  } catch (e) {
    console.warn("[chat] Gateway URL/token not available, falling back to CLI:", e);
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-openclaw-agent-id": agentId,
  };
  if (sessionKey) headers["x-openclaw-session-key"] = sessionKey;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const explicitModel = requestedModel?.trim() || undefined;
  const orBody: Record<string, unknown> = {
    model: `openclaw:${agentId}`,
    input,
    stream: true,
  };
  const activeModelInstructions = buildActiveModelInstructions(explicitModel);
  if (activeModelInstructions) orBody.instructions = activeModelInstructions;

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
    if (explicitModel) {
      return buildModelLockError(
        explicitModel,
        "The OpenClaw gateway is unavailable right now.",
        503,
      );
    }
    console.warn(`[chat] Gateway unreachable at ${endpoint}, falling back to CLI:`, e);
    return null;
  }

  if (!gwRes.ok || !gwRes.body) {
    clearTimeout(timeout);
    const status = gwRes.status;
    const text = await gwRes.text().catch(() => "");
    if (explicitModel) {
      const detail = text.trim();
      return buildModelLockError(
        explicitModel,
        detail || `The OpenClaw gateway returned ${status}.`,
        status,
      );
    }
    console.warn(`[chat] Gateway returned ${status} from ${endpoint}, falling back to CLI.`, text.slice(0, 200));
    return null;
  }

  console.log(
    `[chat] Streaming via gateway OpenResponses API (agent=${agentId}, session=${sessionKey || "ephemeral"}, model=${explicitModel || "agent-setup"})`,
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

// ── CLI fallback ────────────────────────────────────

async function cliResponse(
  content: string,
  agentId: string,
): Promise<Response> {
  const args = ["agent", "--agent", agentId, "--message", content];

  console.log(`[chat] Using CLI fallback (agent=${agentId}) — this is slower than streaming`);
  const t0 = Date.now();
  const output = await runCli(args, 180_000);
  console.log(`[chat] CLI response took ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  return new Response(output.trim(), {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// ── Main handler ────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages: Message[] = body.messages || [];
    const agentId: string = body.agentId || "main";
    const sessionKey = normalizeRequestedSessionKey(body.sessionKey);
    const requestedModel =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : undefined;

    const { plainText, openResponsesInput } = extractContent(messages);

    if (!plainText) {
      return new Response("Please send a message or attach a file.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const sessionModelError = await ensureChatSessionModel(
      sessionKey,
      requestedModel,
    );
    if (sessionModelError) return sessionModelError;

    // Try streaming via OpenResponses API first
    const streamingRes = await tryStreamingResponse(
      openResponsesInput,
      agentId,
      sessionKey,
      requestedModel,
    );
    if (streamingRes) return streamingRes;

    // Fall back to CLI subprocess
    return await cliResponse(plainText, agentId);
  } catch (err) {
    console.error("Chat API error:", err);
    const errMsg =
      err instanceof Error ? err.message : "Failed to get agent response";
    return new Response(`Error: ${errMsg}`, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
