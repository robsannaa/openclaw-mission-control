/**
 * Onboarding API — checks setup status and performs quick-setup actions.
 *
 * GET  /api/onboard
 *   Returns: { installed, configured, gatewayRunning, version }
 *
 * POST /api/onboard
 *   { action: "quick-setup", provider, apiKey, model }
 *   { action: "test-key", provider, token }
 *   { action: "start-gateway" }
 */

import { NextRequest, NextResponse } from "next/server";
import { access } from "fs/promises";
import { join } from "path";
import { runCli, runCliJson } from "@/lib/openclaw-cli";
import { getOpenClawBin, getOpenClawHome, getGatewayUrl } from "@/lib/paths";

export const dynamic = "force-dynamic";

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function checkGatewayHealth(
  gatewayUrl: string
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
 * GET /api/onboard — Returns setup status for the onboarding wizard.
 */
export async function GET() {
  try {
    const home = getOpenClawHome();
    const configPath = join(home, "openclaw.json");

    // Check in parallel: binary, config, gateway health
    const [binPath, configExists, gatewayUrl] = await Promise.all([
      getOpenClawBin().catch(() => null),
      fileExists(configPath),
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

    // Check if there's at least one model configured
    let hasModel = false;
    if (installed && configExists) {
      try {
        const { readFile } = await import("fs/promises");
        const raw = await readFile(configPath, "utf-8");
        const config = JSON.parse(raw);
        const model = config?.agents?.defaults?.model;
        hasModel = Boolean(
          typeof model === "string"
            ? model
            : model?.primary
        );
      } catch {
        // config unreadable
      }
    }

    return NextResponse.json({
      installed,
      configured: configExists && hasModel,
      configExists,
      hasModel,
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

/**
 * POST /api/onboard — Perform onboarding actions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "test-key": {
        // Validate an API key by running `openclaw models scan --provider <p>`
        const provider = String(body.provider || "").trim();
        const token = String(body.token || "").trim();
        if (!provider || !token) {
          return NextResponse.json(
            { error: "Provider and token are required" },
            { status: 400 }
          );
        }

        // Temporarily set the env var and run models scan
        const envKey = PROVIDER_ENV_KEYS[provider];
        if (!envKey) {
          return NextResponse.json(
            { error: `Unknown provider: ${provider}` },
            { status: 400 }
          );
        }

        try {
          // Use paste-token to auth the provider
          await runCli(
            ["models", "auth", "paste-token", "--provider", provider],
            15000,
            token
          );

          // Verify it works by scanning
          const scanResult = await runCliJson<Record<string, unknown>>(
            ["models", "scan", "--provider", provider, "--no-probe", "--no-input", "--yes"],
            30000
          );

          return NextResponse.json({
            ok: true,
            provider,
            scan: scanResult,
          });
        } catch (err) {
          return NextResponse.json(
            { ok: false, error: `Key validation failed: ${err}` },
            { status: 400 }
          );
        }
      }

      case "quick-setup": {
        // Full one-shot setup: auth provider + set default model + start gateway
        const provider = String(body.provider || "").trim();
        const apiKey = String(body.apiKey || "").trim();
        const model = String(body.model || "").trim();

        if (!provider || !apiKey) {
          return NextResponse.json(
            { error: "Provider and API key are required" },
            { status: 400 }
          );
        }

        const steps: string[] = [];

        // 1. Auth the provider
        try {
          await runCli(
            ["models", "auth", "paste-token", "--provider", provider],
            15000,
            apiKey
          );
          steps.push(`Authenticated ${provider}`);
        } catch (err) {
          return NextResponse.json(
            { ok: false, error: `Failed to authenticate ${provider}: ${err}`, steps },
            { status: 500 }
          );
        }

        // 2. Set the default model if provided
        if (model) {
          try {
            await runCli(
              ["config", "set", "agents.defaults.model.primary", model],
              10000
            );
            steps.push(`Set default model to ${model}`);
          } catch (err) {
            // Non-fatal — continue
            steps.push(`Warning: could not set default model: ${err}`);
          }
        }

        // 3. Start gateway if not running
        const gatewayUrl = await getGatewayUrl();
        const gwHealth = await checkGatewayHealth(gatewayUrl);
        if (!gwHealth.running) {
          try {
            await runCli(["gateway", "start"], 25000);
            steps.push("Started gateway");

            // Wait for it to come up
            let retries = 10;
            let running = false;
            while (retries-- > 0) {
              await new Promise((r) => setTimeout(r, 1500));
              const check = await checkGatewayHealth(gatewayUrl);
              if (check.running) {
                running = true;
                break;
              }
            }
            if (!running) {
              steps.push("Warning: gateway started but health check not responding yet");
            }
          } catch (err) {
            steps.push(`Warning: could not start gateway: ${err}`);
          }
        } else {
          steps.push("Gateway already running");
        }

        return NextResponse.json({
          ok: true,
          steps,
          gatewayUrl,
        });
      }

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
          // Wait for it
          let retries = 10;
          let version: string | undefined;
          while (retries-- > 0) {
            await new Promise((r) => setTimeout(r, 1500));
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
            { status: 500 }
          );
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Onboard POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  huggingface: "HUGGINGFACE_HUB_TOKEN",
  zai: "ZAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
};
