import { NextRequest, NextResponse } from "next/server";
import { runCliJson, runCli, gatewayCall } from "@/lib/openclaw-cli";

export const dynamic = "force-dynamic";

/* ── Types ────────────────────────────────────────── */

type Hook = {
  name: string;
  description: string;
  emoji: string;
  eligible: boolean;
  enabled: boolean;
  source: string;
  bundled: boolean;
  homepage?: string;
  events: string[];
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
};

type HooksList = {
  hooks: Hook[];
};

type HooksCheck = {
  summary: {
    total: number;
    eligible: number;
    enabled: number;
    disabled: number;
    missingRequirements: number;
  };
};

type HookDetail = {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  emoji?: string;
  homepage?: string;
  events: string[];
  enabled: boolean;
  eligible: boolean;
  always: boolean;
  requirements: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
};

/* ── GET ──────────────────────────────────────────── */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "list";

  try {
    if (action === "check") {
      const data = await runCliJson<HooksCheck>(["hooks", "check"]);
      return NextResponse.json(data);
    }

    if (action === "info") {
      const name = searchParams.get("name");
      if (!name)
        return NextResponse.json({ error: "name required" }, { status: 400 });
      const data = await runCliJson<HookDetail>(["hooks", "info", name]);
      return NextResponse.json(data);
    }

    // Also fetch the hooks.internal config to know if the system is enabled
    let hooksInternalEnabled = false;
    try {
      const configData = await gatewayCall<Record<string, unknown>>(
        "config.get",
        undefined,
        8000,
      );
      const parsed = (configData.parsed || {}) as Record<string, unknown>;
      const hooks = (parsed.hooks || {}) as Record<string, unknown>;
      const internal = (hooks.internal || {}) as Record<string, unknown>;
      hooksInternalEnabled = internal.enabled === true;
    } catch {
      // config not available — assume enabled
      hooksInternalEnabled = true;
    }

    // Default: list all hooks
    const data = await runCliJson<HooksList>(["hooks", "list"]);
    return NextResponse.json({ ...data, hooksInternalEnabled });
  } catch (err) {
    console.error("Hooks API error:", err);
    if (action === "list") {
      return NextResponse.json({
        hooks: [],
        hooksInternalEnabled: false,
        warning: String(err),
        degraded: true,
      });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── POST: enable / disable / toggle-system ──── */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "enable-hook":
      case "disable-hook": {
        const name = body.name as string;
        if (!name)
          return NextResponse.json({ error: "name required" }, { status: 400 });

        const enabling = action === "enable-hook";

        try {
          // Use config.patch via gateway to update hooks.internal.entries.<name>.enabled
          const configData = await gatewayCall<Record<string, unknown>>(
            "config.get",
            undefined,
            8000,
          );
          const hash = configData.hash as string;

          const patch = {
            hooks: {
              internal: {
                entries: {
                  [name]: { enabled: enabling },
                },
              },
            },
          };

          await gatewayCall(
            "config.patch",
            {
              raw: JSON.stringify(patch),
              baseHash: hash,
              restartDelayMs: 2000,
            },
            10000,
          );
          return NextResponse.json({ ok: true, action, name });
        } catch {
          // Fallback: try CLI command
          try {
            await runCli(["hooks", enabling ? "enable" : "disable", name], 10000);
            return NextResponse.json({ ok: true, action, name, viaCli: true });
          } catch (cliErr) {
            return NextResponse.json({ error: String(cliErr) }, { status: 500 });
          }
        }
      }

      case "enable-all": {
        // Enable all hooks: first ensure hooks.internal.enabled = true,
        // then enable each hook by name
        const names = body.names as string[];
        if (!names?.length)
          return NextResponse.json({ error: "names required" }, { status: 400 });

        try {
          const configData = await gatewayCall<Record<string, unknown>>(
            "config.get",
            undefined,
            8000,
          );
          const hash = configData.hash as string;

          const entries: Record<string, { enabled: boolean }> = {};
          for (const name of names) {
            entries[name] = { enabled: true };
          }

          const patch = {
            hooks: {
              internal: {
                enabled: true,
                entries,
              },
            },
          };

          await gatewayCall(
            "config.patch",
            {
              raw: JSON.stringify(patch),
              baseHash: hash,
              restartDelayMs: 2000,
            },
            10000,
          );
          return NextResponse.json({ ok: true, action, count: names.length });
        } catch (err) {
          return NextResponse.json({ error: String(err) }, { status: 500 });
        }
      }

      case "toggle-system": {
        // Toggle hooks.internal.enabled
        const enabled = body.enabled as boolean;

        try {
          const configData = await gatewayCall<Record<string, unknown>>(
            "config.get",
            undefined,
            8000,
          );
          const hash = configData.hash as string;

          const patch = {
            hooks: {
              internal: {
                enabled,
              },
            },
          };

          await gatewayCall(
            "config.patch",
            {
              raw: JSON.stringify(patch),
              baseHash: hash,
              restartDelayMs: 2000,
            },
            10000,
          );
          return NextResponse.json({ ok: true, action, enabled });
        } catch (err) {
          return NextResponse.json({ error: String(err) }, { status: 500 });
        }
      }

      case "update-hook-env": {
        // Set per-hook env vars via hooks.internal.entries.<name>.env
        const name = body.name as string;
        const env = body.env as Record<string, string>;
        if (!name || !env)
          return NextResponse.json({ error: "name and env required" }, { status: 400 });

        try {
          const configData = await gatewayCall<Record<string, unknown>>(
            "config.get",
            undefined,
            8000,
          );
          const hash = configData.hash as string;

          const patch = {
            hooks: {
              internal: {
                entries: {
                  [name]: { env },
                },
              },
            },
          };

          await gatewayCall(
            "config.patch",
            {
              raw: JSON.stringify(patch),
              baseHash: hash,
              restartDelayMs: 2000,
            },
            10000,
          );
          return NextResponse.json({ ok: true, action, name });
        } catch (err) {
          return NextResponse.json({ error: String(err) }, { status: 500 });
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error("Hooks POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
