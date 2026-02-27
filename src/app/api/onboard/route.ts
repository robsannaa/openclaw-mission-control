/**
 * Onboarding API — checks setup status and performs quick-setup actions.
 *
 * GET  /api/onboard
 *   Returns: { installed, configured, configExists, hasModel, hasApiKey, gatewayRunning, version, gatewayUrl, home }
 *
 * POST /api/onboard
 *   { action: "test-key",          provider, token }
 *   { action: "save-credentials",  provider, apiKey, model }
 *   { action: "list-models",       provider, token }
 *   { action: "quick-setup",       provider, apiKey, model }
 *   { action: "start-gateway" }
 */

import { NextRequest, NextResponse } from "next/server";
import { access, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { runCli } from "@/lib/openclaw-cli";
import { getOpenClawBin, getOpenClawHome, getGatewayUrl } from "@/lib/paths";

export const dynamic = "force-dynamic";

/* ── Helpers ───────────────────────────────────────── */

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(p: string): Promise<T | null> {
  try {
    const raw = await readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(p: string, data: unknown): Promise<void> {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function checkGatewayHealth(
  gatewayUrl: string,
): Promise<{ running: boolean; version?: string }> {
  try {
    const res = await fetch(gatewayUrl, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        running: true,
        version: typeof data.version === "string" ? data.version : undefined,
      };
    }
    return { running: true };
  } catch {
    return { running: false };
  }
}

/**
 * Set a nested dot-path value in an object, creating intermediate objects as needed.
 */
function setDotPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof cur[key] !== "object" || cur[key] === null) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Read a nested dot-path value from an object.
 */
function getDotPath(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let cur: unknown = obj;
  for (const key of parts) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/* ── Direct file-write helpers (no CLI) ───────────── */

async function ensureAuthProfile(
  home: string,
  provider: string,
  apiKey: string,
): Promise<void> {
  const authPath = join(home, "agents", "main", "agent", "auth-profiles.json");
  const existing = (await readJsonSafe<{ profiles: Record<string, unknown> }>(authPath)) || {
    profiles: {},
  };

  const profileKey = `${provider}:default`;
  const currentProfile = existing.profiles[profileKey] as
    | { key?: string }
    | undefined;

  // No-op if already set to same key
  if (currentProfile?.key === apiKey) return;

  existing.profiles[profileKey] = {
    provider,
    type: "api_key",
    key: apiKey,
  };

  await writeJsonAtomic(authPath, existing);
}

async function ensureConfigValue(
  home: string,
  dotPath: string,
  value: unknown,
): Promise<void> {
  const configPath = join(home, "openclaw.json");
  const existing = (await readJsonSafe<Record<string, unknown>>(configPath)) || {};

  // No-op if value already set
  if (getDotPath(existing, dotPath) === value) return;

  setDotPath(existing, dotPath, value);
  await writeJsonAtomic(configPath, existing);
}

/* ── Provider probe endpoints ─────────────────────── */

const PROVIDER_PROBES: Record<
  string,
  { url: string; method: string; buildHeaders: (token: string) => Record<string, string>; buildBody?: (token: string) => string }
> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    buildHeaders: (token) => ({
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
    buildBody: () =>
      JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
    buildHeaders: () => ({}),
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  groq: {
    url: "https://api.groq.com/openai/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  xai: {
    url: "https://api.x.ai/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    method: "GET",
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
  },
};

/* ── Model list endpoints & parsers ────────────────── */

type ModelItem = { id: string; name: string };

async function fetchModelsFromProvider(
  provider: string,
  token: string,
): Promise<ModelItem[]> {
  const probe = PROVIDER_PROBES[provider];
  if (!probe) throw new Error(`Unknown provider: ${provider}`);

  let url = probe.url;

  // Google needs key as query param; model list is a different endpoint
  if (provider === "google") {
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(token)}`;
  }

  const headers = probe.buildHeaders(token);
  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Provider returned ${res.status}`);
  }

  const data = await res.json();

  switch (provider) {
    case "google": {
      // { models: [{ name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash", supportedGenerationMethods: [...] }] }
      const models = (data.models || [])
        .filter(
          (m: { supportedGenerationMethods?: string[] }) =>
            m.supportedGenerationMethods?.includes("generateContent"),
        )
        .map((m: { name: string; displayName?: string }) => ({
          id: `google/${m.name.replace("models/", "")}`,
          name: m.displayName || m.name.replace("models/", ""),
        }));
      return models;
    }

    case "anthropic": {
      // { data: [{ id, display_name }] }
      const models = (data.data || []).map(
        (m: { id: string; display_name?: string }) => ({
          id: `anthropic/${m.id}`,
          name: m.display_name || m.id,
        }),
      );
      return models;
    }

    case "openrouter": {
      // { data: [{ id, name }] }
      const models = (data.data || []).map(
        (m: { id: string; name?: string }) => ({
          id: `openrouter/${m.id}`,
          name: m.name || m.id,
        }),
      );
      return models;
    }

    // OpenAI, Groq, xAI, Mistral all use { data: [{ id }] }
    default: {
      const models = (data.data || []).map(
        (m: { id: string; name?: string }) => ({
          id: `${provider}/${m.id}`,
          name: m.name || m.id,
        }),
      );
      return models;
    }
  }
}

/* ── GET /api/onboard ──────────────────────────────── */

export async function GET() {
  try {
    const home = getOpenClawHome();
    const configPath = join(home, "openclaw.json");
    const authPath = join(home, "agents", "main", "agent", "auth-profiles.json");

    // Check in parallel: binary, config, auth, gateway health
    const [binPath, configExists, authExists, gatewayUrl] = await Promise.all([
      getOpenClawBin().catch(() => null),
      fileExists(configPath),
      fileExists(authPath),
      getGatewayUrl(),
    ]);

    const installed = binPath !== null;

    // Try to get the version
    let version: string | null = null;
    if (installed) {
      try {
        const out = await runCli(["--version"], 5000);
        version = out.trim().split("\n").pop()?.trim() || null;
      } catch {
        // binary found but --version failed
      }
    }

    // Check gateway
    const gateway = await checkGatewayHealth(gatewayUrl);

    // Check model + api key
    let hasModel = false;
    let hasApiKey = false;

    if (configExists) {
      try {
        const config = await readJsonSafe<Record<string, unknown>>(configPath);
        if (config) {
          const model = getDotPath(config, "agents.defaults.model");
          hasModel = Boolean(
            typeof model === "string" ? model : (model as Record<string, unknown>)?.primary,
          );
        }
      } catch {
        // config unreadable
      }
    }

    if (authExists) {
      try {
        const auth = await readJsonSafe<{ profiles?: Record<string, unknown> }>(authPath);
        hasApiKey = Boolean(auth?.profiles && Object.keys(auth.profiles).length > 0);
      } catch {
        // auth unreadable
      }
    }

    return NextResponse.json({
      installed,
      configured: configExists && hasModel && hasApiKey,
      configExists,
      hasModel,
      hasApiKey,
      gatewayRunning: gateway.running,
      version: version || gateway.version || null,
      gatewayUrl,
      home,
    });
  } catch (err) {
    console.error("Onboard GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── POST /api/onboard ─────────────────────────────── */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      /* ── test-key: lightweight probe ──────────────── */
      case "test-key": {
        const provider = String(body.provider || "").trim();
        const token = String(body.token || "").trim();
        if (!provider || !token) {
          return NextResponse.json(
            { ok: false, error: "Provider and token are required" },
            { status: 400 },
          );
        }

        const probe = PROVIDER_PROBES[provider];
        if (!probe) {
          return NextResponse.json(
            { ok: false, error: `Unknown provider: ${provider}` },
            { status: 400 },
          );
        }

        try {
          let url = probe.url;
          const headers = probe.buildHeaders(token);

          // Google uses key as query param
          if (provider === "google") {
            url = `${probe.url}?key=${encodeURIComponent(token)}`;
          }

          const fetchOpts: RequestInit = {
            method: probe.method,
            headers,
            signal: AbortSignal.timeout(15000),
          };

          if (probe.buildBody && probe.method === "POST") {
            fetchOpts.body = probe.buildBody(token);
          }

          const res = await fetch(url, fetchOpts);

          if (res.ok || (provider === "anthropic" && res.status < 500)) {
            // Anthropic returns 200 for valid keys even with minimal request
            // Other providers return 200 for /models
            return NextResponse.json({ ok: true });
          }

          const errBody = await res.text().catch(() => "");
          return NextResponse.json({
            ok: false,
            error: `Invalid API key — ${provider} returned ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ""}`,
          });
        } catch (err) {
          return NextResponse.json({
            ok: false,
            error: `Key validation failed: ${err}`,
          });
        }
      }

      /* ── save-credentials: write auth + model to disk ── */
      case "save-credentials": {
        const provider = String(body.provider || "").trim();
        const apiKey = String(body.apiKey || "").trim();
        const model = String(body.model || "").trim();

        if (!provider || !apiKey) {
          return NextResponse.json(
            { ok: false, error: "Provider and API key are required" },
            { status: 400 },
          );
        }

        const home = getOpenClawHome();

        try {
          await ensureAuthProfile(home, provider, apiKey);
          if (model) {
            await ensureConfigValue(home, "agents.defaults.model.primary", model);
          }
          return NextResponse.json({ ok: true });
        } catch (err) {
          return NextResponse.json(
            { ok: false, error: `Failed to save credentials: ${err}` },
            { status: 500 },
          );
        }
      }

      /* ── list-models: fetch live model list ─────────── */
      case "list-models": {
        const provider = String(body.provider || "").trim();
        const token = String(body.token || "").trim();
        if (!provider || !token) {
          return NextResponse.json(
            { ok: false, error: "Provider and token are required" },
            { status: 400 },
          );
        }

        try {
          const models = await fetchModelsFromProvider(provider, token);
          return NextResponse.json({ ok: true, provider, models });
        } catch (err) {
          return NextResponse.json({
            ok: false,
            error: `Failed to fetch models: ${err}`,
            models: [],
          });
        }
      }

      /* ── quick-setup: ensure auth + model + start gateway ── */
      case "quick-setup": {
        const provider = String(body.provider || "").trim();
        const apiKey = String(body.apiKey || "").trim();
        const model = String(body.model || "").trim();

        if (!provider || !apiKey) {
          return NextResponse.json(
            { ok: false, error: "Provider and API key are required" },
            { status: 400 },
          );
        }

        const home = getOpenClawHome();
        const steps: string[] = [];

        // 1. Write auth profile
        try {
          await ensureAuthProfile(home, provider, apiKey);
          steps.push(`Authenticated ${provider}`);
        } catch (err) {
          return NextResponse.json(
            { ok: false, error: `Failed to write auth profile: ${err}`, steps },
            { status: 500 },
          );
        }

        // 2. Write default model
        if (model) {
          try {
            await ensureConfigValue(home, "agents.defaults.model.primary", model);
            steps.push(`Default model: ${model}`);
          } catch (err) {
            steps.push(`Warning: could not set default model: ${err}`);
          }
        }

        // 3. Set gateway mode to local
        try {
          await ensureConfigValue(home, "gateway.mode", "local");
        } catch {
          // non-fatal
        }

        // 4. Start gateway if not running
        const gatewayUrl = await getGatewayUrl();
        const gwHealth = await checkGatewayHealth(gatewayUrl);
        if (!gwHealth.running) {
          try {
            await runCli(["gateway", "start"], 25000);
            steps.push("Gateway started");

            // Health check retries: 5 × 1s
            let running = false;
            for (let i = 0; i < 5; i++) {
              await new Promise((r) => setTimeout(r, 1000));
              const check = await checkGatewayHealth(gatewayUrl);
              if (check.running) {
                running = true;
                break;
              }
            }
            if (!running) {
              steps.push("Warning: gateway started but health check not responding yet");
            } else {
              steps.push("Gateway running");
            }
          } catch (err) {
            steps.push(`Warning: could not start gateway: ${err}`);
          }
        } else {
          steps.push("Gateway running");
        }

        return NextResponse.json({
          ok: true,
          steps,
          gatewayUrl,
        });
      }

      /* ── start-gateway ──────────────────────────────── */
      case "start-gateway": {
        const gatewayUrl = await getGatewayUrl();
        const gwHealth = await checkGatewayHealth(gatewayUrl);
        if (gwHealth.running) {
          return NextResponse.json({
            ok: true,
            message: "Gateway already running",
            version: gwHealth.version,
          });
        }

        try {
          await runCli(["gateway", "start"], 25000);
          let retries = 5;
          let version: string | undefined;
          while (retries-- > 0) {
            await new Promise((r) => setTimeout(r, 1000));
            const check = await checkGatewayHealth(gatewayUrl);
            if (check.running) {
              version = check.version;
              break;
            }
          }
          return NextResponse.json({
            ok: true,
            message: "Gateway started",
            version,
          });
        } catch (err) {
          return NextResponse.json(
            { ok: false, error: `Failed to start gateway: ${err}` },
            { status: 500 },
          );
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error("Onboard POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
