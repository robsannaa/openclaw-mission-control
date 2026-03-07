import { getGatewayUrl, getGatewayToken } from "@/lib/paths";

export function guessMime(url: string, filename?: string): string {
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

function collectOutputText(node: unknown, out: string[]) {
  if (!node) return;
  if (typeof node === "string") {
    if (node.trim()) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectOutputText(item, out);
    return;
  }
  if (typeof node !== "object") return;
  const record = node as Record<string, unknown>;

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    out.push(record.output_text);
  }
  if (typeof record.text === "string" && record.text.trim()) {
    out.push(record.text);
  }
  if (typeof record.content === "string" && record.content.trim()) {
    out.push(record.content);
  }

  if (record.type === "output_text" || record.type === "text" || record.type === "message") {
    if (typeof record.text === "string" && record.text.trim()) out.push(record.text);
    if (typeof record.content === "string" && record.content.trim()) out.push(record.content);
  }

  if ("output" in record) collectOutputText(record.output, out);
  if ("content" in record && Array.isArray(record.content)) collectOutputText(record.content, out);
  if ("message" in record) collectOutputText(record.message, out);
  if ("response" in record) collectOutputText(record.response, out);
}

export function extractOpenResponsesText(payload: unknown): string {
  const out: string[] = [];
  collectOutputText(payload, out);
  return out
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

type OpenResponsesTextRequest = {
  input: unknown;
  agentId: string;
  sessionKey?: string;
  requestedModel?: string;
  instructions?: string;
  timeoutMs?: number;
};

type OpenResponsesTextResult = {
  ok: boolean;
  status: number;
  text: string;
  raw: unknown;
};

export async function runOpenResponsesText(
  request: OpenResponsesTextRequest
): Promise<OpenResponsesTextResult> {
  const gwUrl = await getGatewayUrl();
  const token = getGatewayToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 180_000);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-openclaw-agent-id": request.agentId,
    };
    if (request.sessionKey) headers["x-openclaw-session-key"] = request.sessionKey;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const body: Record<string, unknown> = {
      model: `openclaw:${request.agentId}`,
      input: request.input,
      stream: false,
    };
    if (request.instructions) body.instructions = request.instructions;
    if (request.requestedModel) body.model = `openclaw:${request.agentId}`;

    const response = await fetch(`${gwUrl}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    const raw = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");
    const text = typeof raw === "string" ? raw.trim() : extractOpenResponsesText(raw);

    return {
      ok: response.ok,
      status: response.status,
      text,
      raw,
    };
  } finally {
    clearTimeout(timeout);
  }
}
