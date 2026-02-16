import { NextRequest, NextResponse } from "next/server";
import { gatewayCall } from "@/lib/openclaw-cli";

export const dynamic = "force-dynamic";

const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
];

function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 10) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactSensitive(v, depth + 1));
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_PATTERNS.some((p) => p.test(k)) && typeof v === "string") {
        result[k] = v.length > 8 ? v.slice(0, 4) + "..." + v.slice(-4) : "••••";
      } else {
        result[k] = redactSensitive(v, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGatewayError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("gateway closed") ||
    msg.includes("1006") ||
    msg.includes("abnormal closure") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up")
  );
}

function formatGatewayError(err: unknown): string {
  const msg = String(err);
  if (isTransientGatewayError(err)) {
    return "Gateway temporarily unavailable while loading configuration. Please retry in a moment.";
  }
  return msg;
}

async function gatewayCallWithRetry<T>(
  method: string,
  params: Record<string, unknown> | undefined,
  timeout: number,
  retries = 1
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await gatewayCall<T>(method, params, timeout);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isTransientGatewayError(err)) break;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr;
}

/**
 * GET /api/config
 *
 * Returns config + schema + UI hints.
 * Query: scope=config (default) | schema
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "config";

  try {
    if (scope === "schema") {
      try {
        const data = await gatewayCallWithRetry<Record<string, unknown>>(
          "config.schema",
          undefined,
          15000,
          1
        );
        return NextResponse.json(data);
      } catch (err) {
        return NextResponse.json({
          schema: {},
          uiHints: {},
          warning: formatGatewayError(err),
        });
      }
    }

    // Default: config first, schema best-effort.
    const configData = await gatewayCallWithRetry<Record<string, unknown>>(
      "config.get",
      undefined,
      10000,
      1
    );

    let schemaData: Record<string, unknown> | null = null;
    let warning: string | undefined;
    try {
      schemaData = await gatewayCallWithRetry<Record<string, unknown>>(
        "config.schema",
        undefined,
        15000,
        1
      );
    } catch (err) {
      warning = formatGatewayError(err);
      console.warn("Config schema unavailable, serving config without schema:", err);
    }

    const parsed = (configData.parsed || {}) as Record<string, unknown>;
    const resolved = (configData.resolved || {}) as Record<string, unknown>;
    const redacted = redactSensitive(resolved) as Record<string, unknown>;

    return NextResponse.json({
      config: redacted,
      rawConfig: parsed,
      resolvedConfig: resolved,
      baseHash: configData.hash || "",
      schema: schemaData?.schema || {},
      uiHints: schemaData?.uiHints || {},
      warning,
    });
  } catch (err) {
    console.error("Config GET error:", err);
    return NextResponse.json({ error: formatGatewayError(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/config  — Safe partial update via config.patch
 *
 * Body: { patch: { "agents.defaults.workspace": "~/new" }, baseHash: "..." }
 *   OR: { raw: "{ agents: { defaults: { workspace: '~/new' } } }", baseHash: "..." }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { raw, patch, baseHash } = body as {
      raw?: string;
      patch?: Record<string, unknown>;
      baseHash: string;
    };

    if (!baseHash) {
      return NextResponse.json(
        { error: "baseHash required to prevent conflicts" },
        { status: 400 }
      );
    }

    let patchRaw: string;
    if (raw) {
      // Pre-formed JSON5 string
      patchRaw = raw;
    } else if (patch) {
      patchRaw = JSON.stringify(patch);
    } else {
      return NextResponse.json(
        { error: "raw or patch required" },
        { status: 400 }
      );
    }

    const result = await gatewayCall<Record<string, unknown>>(
      "config.patch",
      {
        raw: patchRaw,
        baseHash,
        restartDelayMs: 2000,
      },
      20000
    );

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = String(err);
    console.error("Config PATCH error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/**
 * PUT /api/config  — Legacy full-config save (kept for backwards compat)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { config, baseHash } = body as {
      config: Record<string, unknown>;
      baseHash?: string;
    };

    if (!config || typeof config !== "object") {
      return NextResponse.json(
        { error: "config object required" },
        { status: 400 }
      );
    }

    const params: Record<string, unknown> = {
      raw: JSON.stringify(config),
      restartDelayMs: 2000,
    };
    if (baseHash) params.baseHash = baseHash;

    const result = await gatewayCall<Record<string, unknown>>(
      "config.patch",
      params,
      20000
    );

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = String(err);
    const validationMatch = msg.match(/invalid.*?:(.*)/i);
    return NextResponse.json(
      { error: validationMatch ? validationMatch[1].trim() : msg },
      { status: 400 }
    );
  }
}
