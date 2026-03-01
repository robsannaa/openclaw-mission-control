import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { runCli, gatewayCall } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

type WebSearchRequest = {
  query?: string;
  agentId?: string;
  resultCount?: number;
};

type ConfigGet = {
  path?: string;
  hash?: string;
  parsed?: Record<string, unknown>;
};

const SAFE_TOKEN_RE = /^[A-Za-z0-9._-]+$/;
const OPENCLAW_DIR = join(homedir(), ".openclaw");

function safeToken(raw: string, fallback = ""): string {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  if (!SAFE_TOKEN_RE.test(value)) return "";
  return value;
}

async function readJsonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function readTextSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/** Parse a .env file (KEY=VALUE lines, # comments, optional quoting). */
function parseDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

/** Drill into a nested object by keys. */
function dig(obj: unknown, ...keys: string[]): unknown {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function preview(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/**
 * Resolve a key from multiple sources, returning the first hit.
 * Returns { value, source } or { value: "", source: null }.
 *
 * Sources are checked in the order provided (highest priority first).
 */
function resolveKey(
  sources: Array<{ value: string; label: string }>
): { value: string; source: string | null } {
  for (const s of sources) {
    if (s.value) return { value: s.value, source: s.label };
  }
  return { value: "", source: null };
}

/**
 * GET: return search provider status.
 *
 * Reads credentials from ALL sources per the docs:
 *   https://docs.openclaw.ai/tools/web
 *   https://docs.openclaw.ai/help/faq#how-does-openclaw-load-environment-variables
 *   https://docs.openclaw.ai/concepts/model-failover#auth-storage-keys-oauth
 *
 * Sources checked (highest priority first):
 *   1. openclaw.json  → tools.web.search.perplexity.apiKey / tools.web.search.apiKey
 *   2. auth-profiles.json / auth.json  → provider profiles
 *   3. ~/.openclaw/.env  → global fallback env
 *   4. openclaw.json → env block / env.vars
 *   5. process.env  (inherited from shell / launchd / systemd)
 */
export async function GET() {
  try {
    // ── Read all sources in parallel ──
    const [mainConfig, authProfiles, authJson, dotEnvRaw] = await Promise.all([
      readJsonSafe<Record<string, unknown>>(join(OPENCLAW_DIR, "openclaw.json"), {}),
      readJsonSafe<Record<string, unknown>>(join(OPENCLAW_DIR, "agents", "main", "agent", "auth-profiles.json"), {}),
      readJsonSafe<Record<string, unknown>>(join(OPENCLAW_DIR, "agents", "main", "agent", "auth.json"), {}),
      readTextSafe(join(OPENCLAW_DIR, ".env")),
    ]);

    const dotEnv = parseDotEnv(dotEnvRaw);

    // Gateway config (for hash + env block; non-blocking if gateway is down)
    const gw = await gatewayCall<ConfigGet>("config.get", undefined, 10000).catch(() => null);
    const configHash = String(gw?.hash || "");

    // Config env block: openclaw.json → env.KEY and env.vars.KEY
    const cfgEnv = (dig(mainConfig, "env") || {}) as Record<string, unknown>;
    const cfgEnvVars = (dig(cfgEnv, "vars") || {}) as Record<string, string>;
    // Flatten: top-level string values + vars sub-object
    const envBlock: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfgEnv)) {
      if (typeof v === "string") envBlock[k] = v;
    }
    for (const [k, v] of Object.entries(cfgEnvVars)) {
      if (typeof v === "string" && !envBlock[k]) envBlock[k] = v;
    }

    // ── tools.web.search config ──
    const searchConfig = (dig(mainConfig, "tools", "web", "search") || {}) as Record<string, unknown>;
    const pplxCfg = (dig(searchConfig, "perplexity") || {}) as Record<string, string>;

    // ── Perplexity key ──
    const perplexity = resolveKey([
      { value: String(pplxCfg.apiKey || "").trim(), label: "openclaw.json" },
      { value: String(dotEnv.PERPLEXITY_API_KEY || "").trim(), label: ".env" },
      { value: String(envBlock.PERPLEXITY_API_KEY || "").trim(), label: "config env" },
      { value: String(process.env.PERPLEXITY_API_KEY || "").trim(), label: "process.env" },
    ]);

    // ── OpenRouter key ──
    // Check auth-profiles.json for any openrouter:* profile
    const profiles = (dig(authProfiles, "profiles") || {}) as Record<string, Record<string, unknown>>;
    let orAuthKey = "";
    for (const [id, profile] of Object.entries(profiles)) {
      if (id.startsWith("openrouter:") && typeof profile.key === "string" && profile.key) {
        orAuthKey = profile.key;
        break;
      }
    }
    const orLegacyKey = String((dig(authJson, "openrouter", "key") as string) || "").trim();

    const openrouter = resolveKey([
      { value: orAuthKey, label: "auth-profiles.json" },
      { value: orLegacyKey, label: "auth.json" },
      { value: String(dotEnv.OPENROUTER_API_KEY || "").trim(), label: ".env" },
      { value: String(envBlock.OPENROUTER_API_KEY || "").trim(), label: "config env" },
      { value: String(process.env.OPENROUTER_API_KEY || "").trim(), label: "process.env" },
    ]);

    // ── Brave key ──
    const brave = resolveKey([
      { value: String(searchConfig.apiKey || "").trim(), label: "openclaw.json" },
      { value: String(dotEnv.BRAVE_API_KEY || "").trim(), label: ".env" },
      { value: String(envBlock.BRAVE_API_KEY || "").trim(), label: "config env" },
      { value: String(process.env.BRAVE_API_KEY || "").trim(), label: "process.env" },
    ]);

    const hasPerplexity = Boolean(perplexity.value);
    const hasOpenRouter = Boolean(openrouter.value);
    const hasBrave = Boolean(brave.value);

    // ── Active provider ──
    const configProvider = String(searchConfig.provider || "").toLowerCase();
    let activeProvider: "perplexity" | "brave" | "none" = "none";
    if (configProvider === "perplexity" && (hasPerplexity || hasOpenRouter)) {
      activeProvider = "perplexity";
    } else if (configProvider === "brave" && hasBrave) {
      activeProvider = "brave";
    } else if (hasPerplexity || hasOpenRouter) {
      activeProvider = "perplexity";
    } else if (hasBrave) {
      activeProvider = "brave";
    }

    // ── Model (Perplexity only): tools.web.search.perplexity.model ──
    const model = String(pplxCfg.model || "perplexity/sonar-pro");
    const cacheTtl = Number(searchConfig.cacheTtlMinutes || 15);

    return NextResponse.json({
      ok: true,
      activeProvider,
      configHash,
      model,
      cacheTtlMinutes: cacheTtl,
      providers: {
        perplexity: {
          configured: hasPerplexity,
          keySource: perplexity.source,
          keyPreview: perplexity.value ? preview(perplexity.value) : null,
        },
        openrouter: {
          configured: hasOpenRouter,
          keySource: openrouter.source,
          keyPreview: openrouter.value ? preview(openrouter.value) : null,
        },
        brave: {
          configured: hasBrave,
          keySource: brave.source,
          keyPreview: brave.value ? preview(brave.value) : null,
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

const VALID_MODELS = new Set([
  "perplexity/sonar",
  "perplexity/sonar-pro",
  "perplexity/sonar-reasoning-pro",
]);

/**
 * PATCH: update search model.
 *
 * Reads the current perplexity config first and merges the model in,
 * so we never clobber sibling keys like apiKey.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { model?: string };
    const model = String(body.model || "").trim();
    if (!model || !VALID_MODELS.has(model)) {
      return NextResponse.json(
        { ok: false, error: `Invalid model. Valid: ${[...VALID_MODELS].join(", ")}` },
        { status: 400 }
      );
    }

    // Read current config to get hash AND preserve existing perplexity keys
    const config = await gatewayCall<ConfigGet>("config.get", undefined, 10000);
    const hash = String(config?.hash || "");
    if (!hash) {
      return NextResponse.json(
        { ok: false, error: "Could not read config hash" },
        { status: 500 }
      );
    }

    // Read the existing perplexity block from disk to preserve apiKey etc.
    const mainConfig = await readJsonSafe<Record<string, unknown>>(join(OPENCLAW_DIR, "openclaw.json"), {});
    const existingPplx = (dig(mainConfig, "tools", "web", "search", "perplexity") || {}) as Record<string, unknown>;

    // Merge model into existing perplexity config (preserves apiKey, baseUrl, etc.)
    const mergedPplx = { ...existingPplx, model };
    const patch = { tools: { web: { search: { perplexity: mergedPplx } } } };

    await gatewayCall(
      "config.patch",
      { raw: JSON.stringify(patch), baseHash: hash },
      15000
    );

    return NextResponse.json({ ok: true, model });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/** POST: run a web search via the agent */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as WebSearchRequest;
    const query = String(body.query || "").trim();
    if (!query || query.length < 2) {
      return NextResponse.json(
        { ok: false, error: "Search query must be at least 2 characters" },
        { status: 400 }
      );
    }

    const agentId = safeToken(body.agentId || "", "main");
    if (!agentId) {
      return NextResponse.json(
        { ok: false, error: "Invalid agentId" },
        { status: 400 }
      );
    }

    const resultCount = Math.min(Math.max(Number(body.resultCount) || 5, 1), 10);

    const message = `Use the web_search tool to search for: ${query} (return up to ${resultCount} results). Show the results with titles, URLs, and brief snippets.`;
    const startedAt = Date.now();

    const output = await runCli(
      ["agent", "--agent", agentId, "--message", message],
      60_000
    );

    return NextResponse.json({
      ok: true,
      query,
      agentId,
      resultCount,
      output: output.trim(),
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message || "Web search failed" },
      { status: 500 }
    );
  }
}
