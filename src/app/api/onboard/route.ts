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
import { gatewayCall, runCli } from "@/lib/openclaw";
import { getOpenClawBin, getOpenClawHome, getGatewayUrl } from "@/lib/paths";
import {
  buildProviderCredentialPatch,
  fetchModelsFromProvider,
  MINIMAX_PROVIDER_CONFIG,
  PROVIDER_ENV_KEYS,
  validateProviderToken,
} from "@/lib/provider-auth";

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

async function applyGatewayConfigPatch(rawPatch: Record<string, unknown>): Promise<void> {
  const cfg = await gatewayCall<Record<string, unknown>>("config.get", undefined, 15000);
  const baseHash = String(cfg?.hash || "");

  await gatewayCall(
    "config.patch",
    {
      raw: JSON.stringify(rawPatch),
      baseHash,
      restartDelayMs: 2000,
    },
    20000,
  );
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

/* ── Custom OpenAI-compatible endpoint helpers ─────── */

/**
 * Normalize a base URL: trim, strip trailing slashes, auto-append /v1 if missing.
 */
function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  // If URL doesn't end with /v1 (or /v1/), append it
  if (!/\/v1\/?$/i.test(url)) {
    url = `${url}/v1`;
  }
  return url;
}

/**
 * Probe a custom OpenAI-compatible endpoint by hitting GET /v1/models.
 * Returns { ok, models?, error? }.
 */
async function probeCustomEndpoint(
  baseUrl: string,
  token?: string,
): Promise<{ ok: boolean; models?: { id: string; name: string }[]; error?: string }> {
  const url = `${normalizeBaseUrl(baseUrl)}/models`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Authentication required — provide an API key." };
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Endpoint returned ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ""}`,
      };
    }

    const data = await res.json();
    const rawModels = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const models = rawModels
      .filter((m: unknown) => m && typeof m === "object" && "id" in (m as Record<string, unknown>))
      .map((m: { id: string; name?: string; owned_by?: string }) => ({
        id: m.id,
        name: m.name || m.id,
      }));

    return { ok: true, models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
      return { ok: false, error: "Could not connect — check the URL and make sure the server is running." };
    }
    if (msg.includes("aborted") || msg.includes("timeout")) {
      return { ok: false, error: "Connection timed out — the server did not respond within 15 seconds." };
    }
    return { ok: false, error: `Connection failed: ${msg}` };
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

    // Check model + credentials + local providers
    let hasModel = false;
    let hasApiKey = false;
    let hasLocalProvider = false;

    if (configExists) {
      try {
        const config = await readJsonSafe<Record<string, unknown>>(configPath);
        if (config) {
          const model = getDotPath(config, "agents.defaults.model");
          hasModel = Boolean(
            typeof model === "string" ? model : (model as Record<string, unknown>)?.primary,
          );

          const env = getDotPath(config, "env");
          if (env && typeof env === "object") {
            hasApiKey = Object.values(PROVIDER_ENV_KEYS).some((key) => {
              const value = (env as Record<string, unknown>)[key];
              return typeof value === "string" && value.trim().length > 0;
            });
          }

          // Check for local/custom providers (Ollama, LM Studio, vLLM, etc.)
          const providers = getDotPath(config, "models.providers");
          if (providers && typeof providers === "object") {
            const providerKeys = Object.keys(providers as Record<string, unknown>);
            hasLocalProvider = providerKeys.some((k) => {
              const p = (providers as Record<string, unknown>)[k];
              if (!p || typeof p !== "object") return false;
              const baseUrl = (p as Record<string, unknown>).baseUrl;
              return typeof baseUrl === "string" && baseUrl.trim().length > 0;
            });
          }
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

    // Detect Ollama running locally (no API key needed)
    let hasOllama = false;
    try {
      const ollamaRes = await fetch("http://127.0.0.1:11434/api/tags", {
        signal: AbortSignal.timeout(2000),
      });
      hasOllama = ollamaRes.ok;
    } catch {
      // Ollama not running
    }

    return NextResponse.json({
      installed,
      configured: hasApiKey || hasLocalProvider || hasOllama,
      configExists,
      hasModel,
      hasApiKey,
      hasLocalProvider,
      hasOllama,
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

        // Custom OpenAI-compatible endpoint (token is optional)
        if (provider === "custom") {
          const baseUrl = String(body.baseUrl || "").trim();
          if (!baseUrl) {
            return NextResponse.json(
              { ok: false, error: "Base URL is required for custom endpoints" },
              { status: 400 },
            );
          }
          const result = await probeCustomEndpoint(baseUrl, token || undefined);
          return NextResponse.json({
            ok: result.ok,
            error: result.error,
            models: result.models,
          });
        }

        // Standard providers require both provider and token
        if (!provider || !token) {
          return NextResponse.json(
            { ok: false, error: "Provider and token are required" },
            { status: 400 },
          );
        }

        const result = await validateProviderToken(provider, token);
        return NextResponse.json(result);
      }

      /* ── save-credentials: write auth + model to disk ── */
      case "save-credentials": {
        const provider = String(body.provider || "").trim();
        const apiKey = String(body.apiKey || "").trim();
        const model = String(body.model || "").trim();
        const baseUrl = String(body.baseUrl || "").trim();

        if (!provider || (!apiKey && provider !== "custom")) {
          return NextResponse.json(
            { ok: false, error: "Provider and API key are required" },
            { status: 400 },
          );
        }

        const home = getOpenClawHome();

        try {
          const envKey = PROVIDER_ENV_KEYS[provider];
          const gatewayPatch = buildProviderCredentialPatch(provider, apiKey);

          if (provider === "custom" && baseUrl) {
            gatewayPatch.models = {
              providers: {
                custom: {
                  baseUrl: normalizeBaseUrl(baseUrl),
                  api: "openai-completions",
                  models: [],
                },
              },
            };
          }

          if (model) {
            gatewayPatch.agents = {
              defaults: {
                model: {
                  primary: model,
                },
              },
            };
          }

          // Try gateway RPC first (triggers live reload), fall back to disk
          let savedViaGateway = false;
          if (Object.keys(gatewayPatch).length > 0) {
            try {
              await applyGatewayConfigPatch(gatewayPatch);
              savedViaGateway = true;
            } catch (rpcErr) {
              console.warn("[onboard] save-credentials: gateway RPC failed, falling back to disk:", rpcErr);
            }
          }

          // Direct disk write as fallback (or always for custom/unknown providers)
          if (!savedViaGateway) {
            if (envKey) {
              await ensureConfigValue(home, `env.${envKey}`, apiKey);
            }
            if (model) {
              await ensureConfigValue(home, "agents.defaults.model.primary", model);
            }
          }

          // Auth profile file — always write for custom/unknown providers,
          // and as belt-and-suspenders for known providers too
          if ((provider === "custom" && apiKey) || !envKey || !savedViaGateway) {
            await ensureAuthProfile(home, provider, apiKey || "local-no-auth");
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
        if (!provider) {
          return NextResponse.json(
            { ok: false, error: "Provider is required" },
            { status: 400 },
          );
        }

        // Custom provider: use probeCustomEndpoint which already returns models
        if (provider === "custom") {
          const baseUrl = String(body.baseUrl || "").trim();
          if (!baseUrl) {
            return NextResponse.json(
              { ok: false, error: "Base URL is required for custom endpoints" },
              { status: 400 },
            );
          }
          const result = await probeCustomEndpoint(baseUrl, token || undefined);
          if (result.ok && result.models) {
            // Prefix model IDs with "custom/" for the model key format
            const models = result.models.map((m) => ({
              id: m.id.includes("/") ? m.id : `custom/${m.id}`,
              name: m.name,
            }));
            return NextResponse.json({ ok: true, provider: "custom", models });
          }
          return NextResponse.json({
            ok: false,
            error: result.error || "Failed to fetch models",
            models: [],
          });
        }

        if (!token) {
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
        const baseUrl = String(body.baseUrl || "").trim();

        if (!provider || (!apiKey && provider !== "custom")) {
          return NextResponse.json(
            { ok: false, error: "Provider and API key are required" },
            { status: 400 },
          );
        }

        const home = getOpenClawHome();
        const steps: string[] = [];

        // 1. Write auth profile (and custom provider config if needed)
        try {
          if (provider === "custom" && baseUrl) {
            const normalizedUrl = normalizeBaseUrl(baseUrl);
            await ensureConfigValue(home, "models.providers.custom", {
              baseUrl: normalizedUrl,
              api: "openai-completions",
              models: [],
            });
            if (apiKey) {
              await ensureAuthProfile(home, "custom", apiKey);
            } else {
              await ensureAuthProfile(home, "custom", "local-no-auth");
            }
            steps.push(`Custom endpoint configured: ${normalizedUrl}`);
          } else {
            const envKey = PROVIDER_ENV_KEYS[provider];
            if (envKey) {
              await ensureConfigValue(home, `env.${envKey}`, apiKey);
              await ensureConfigValue(home, `auth.profiles.${provider}:default`, {
                provider,
                mode: "api_key",
              });
            }
            if (provider === "minimax") {
              await ensureConfigValue(home, "models.providers.minimax", MINIMAX_PROVIDER_CONFIG);
            }
            if (!envKey) {
              await ensureAuthProfile(home, provider, apiKey);
            }
          }
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

        // 3b. Enable OpenResponses HTTP endpoint for streaming chat
        try {
          await ensureConfigValue(
            home,
            "gateway.http.endpoints.responses.enabled",
            true,
          );
        } catch {
          // non-fatal — chat falls back to CLI if this isn't enabled
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
