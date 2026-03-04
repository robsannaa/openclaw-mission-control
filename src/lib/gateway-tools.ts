/**
 * Typed wrappers for Gateway HTTP endpoints.
 *
 * Provides high-level helpers for `/tools/invoke` and `/hooks/wake`,
 * replacing CLI subprocess calls for memory search, memory index, and
 * agent wake operations.
 *
 * Pattern follows `src/app/api/web-search/route.ts:invokeGatewayWebSearch()`.
 */

import { getGatewayToken, getGatewayUrl } from "./paths";

// ── Types ────────────────────────────────────────

type ToolInvokeEnvelope<T> = {
  ok?: boolean;
  result?: T;
  error?: {
    message?: string;
  };
};

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: string;
};

type MemorySearchToolResult = {
  results?: MemorySearchResult[];
  content?: Array<{ type?: string; text?: string }>;
};

type MemoryIndexToolResult = {
  output?: string;
  content?: Array<{ type?: string; text?: string }>;
};

// ── Base invoke ──────────────────────────────────

export async function invokeGatewayTool<T>(
  tool: string,
  args: Record<string, unknown>,
  timeout = 30000,
): Promise<T> {
  const gwUrl = await getGatewayUrl();
  const token = getGatewayToken();
  const response = await fetch(`${gwUrl}/tools/invoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ tool, args, action: "json" }),
    signal: AbortSignal.timeout(timeout),
  });

  const body = (await response.json().catch(() => null)) as
    | ToolInvokeEnvelope<T>
    | null;

  if (!response.ok) {
    const detail =
      body?.error?.message ||
      (body ? JSON.stringify(body) : response.statusText);
    throw new Error(`Gateway ${tool} failed (${response.status}): ${detail}`);
  }

  if (!body?.ok || !body.result) {
    throw new Error(body?.error?.message || `Gateway ${tool} returned no result`);
  }

  return body.result;
}

// ── Memory search ────────────────────────────────

export async function gatewayMemorySearch(opts: {
  query: string;
  agent?: string;
  maxResults?: number;
  minScore?: string;
}): Promise<{ results: MemorySearchResult[] }> {
  const args: Record<string, unknown> = { query: opts.query };
  if (opts.agent) args.agent = opts.agent;
  if (opts.maxResults) args.max_results = opts.maxResults;
  if (opts.minScore) args.min_score = opts.minScore;

  const result = await invokeGatewayTool<MemorySearchToolResult>(
    "memory_search",
    args,
    30000,
  );

  if (result.results) {
    return { results: result.results };
  }

  // Fallback: parse from content blocks
  const text = result.content
    ?.map((item) => (item?.type === "text" ? String(item.text || "") : ""))
    .filter(Boolean)
    .join("\n") || "";

  try {
    const parsed = JSON.parse(text) as { results?: MemorySearchResult[] };
    return { results: parsed.results || [] };
  } catch {
    return { results: [] };
  }
}

// ── Memory index ─────────────────────────────────

export async function gatewayMemoryIndex(opts?: {
  agent?: string;
  force?: boolean;
}): Promise<string> {
  const args: Record<string, unknown> = {};
  if (opts?.agent) args.agent = opts.agent;
  if (opts?.force) args.force = true;

  const result = await invokeGatewayTool<MemoryIndexToolResult>(
    "memory_index",
    args,
    60000,
  );

  if (result.output) return result.output;

  return result.content
    ?.map((item) => (item?.type === "text" ? String(item.text || "") : ""))
    .filter(Boolean)
    .join("\n") || "";
}

// ── Wake agent ───────────────────────────────────

export async function gatewayWakeAgent(opts: {
  text?: string;
  mode?: string;
}): Promise<string> {
  const gwUrl = await getGatewayUrl();
  const token = getGatewayToken();
  const response = await fetch(`${gwUrl}/hooks/wake`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      text: opts.text || "Check for urgent follow-ups",
      mode: opts.mode || "now",
    }),
    signal: AbortSignal.timeout(20000),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = body?.error?.message || body?.error || response.statusText;
    throw new Error(`Gateway wake failed (${response.status}): ${detail}`);
  }

  return typeof body?.output === "string" ? body.output : JSON.stringify(body || {});
}
