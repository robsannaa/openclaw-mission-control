import { NextRequest, NextResponse } from "next/server";
import { runCliJson, runCli, gatewayCall } from "@/lib/openclaw-cli";
import { getOpenClawHome } from "@/lib/paths";
import { readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

/* ── Types ────────────────────────────────────────── */

type Skill = {
  name: string;
  description: string;
  emoji: string;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  source: string;
  bundled: boolean;
  homepage?: string;
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
};

type SkillsList = {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: Skill[];
};

type SkillsCheck = {
  summary: {
    total: number;
    eligible: number;
    disabled: number;
    blocked: number;
    missingRequirements: number;
  };
  eligible: string[];
  disabled: string[];
  blocked: string[];
  missingRequirements: { name: string; missing: string[] }[];
};

type SkillDetail = {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
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
  configChecks: unknown[];
  install: { id: string; kind: string; label: string; bins?: string[] }[];
};

/* ── GET ──────────────────────────────────────────── */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "list";

  try {
    if (action === "check") {
      const data = await runCliJson<SkillsCheck>(["skills", "check"]);
      return NextResponse.json(data);
    }

    if (action === "info") {
      const name = searchParams.get("name");
      if (!name)
        return NextResponse.json({ error: "name required" }, { status: 400 });

      const data = await runCliJson<SkillDetail>(["skills", "info", name]);

      // Try to read the SKILL.md content for display
      let skillMd: string | null = null;
      if (data.filePath) {
        try {
          const raw = await readFile(data.filePath, "utf-8");
          // Truncate very long files
          skillMd = raw.length > 10000 ? raw.slice(0, 10000) + "\n\n...(truncated)" : raw;
        } catch {
          // file may not be readable
        }
      }

      // Check the config for skill-specific settings
      let skillConfig: Record<string, unknown> | null = null;
      try {
        const configData = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          8000
        );
        const resolved = (configData.resolved || {}) as Record<string, unknown>;
        const tools = (resolved.tools || {}) as Record<string, unknown>;
        // Check if there's a tools.<skillKey> config
        if (tools[data.skillKey || data.name]) {
          skillConfig = tools[data.skillKey || data.name] as Record<
            string,
            unknown
          >;
        }
      } catch {
        // config not available
      }

      return NextResponse.json({ ...data, skillMd, skillConfig });
    }

    if (action === "config") {
      // Get the full config to see skills/tools section
      try {
        const configData = await gatewayCall<Record<string, unknown>>(
          "config.get",
          undefined,
          8000
        );
        const resolved = (configData.resolved || {}) as Record<string, unknown>;
        const parsed = (configData.parsed || {}) as Record<string, unknown>;

        return NextResponse.json({
          tools: {
            resolved: resolved.tools || {},
            parsed: parsed.tools || {},
          },
          skills: {
            resolved: (resolved as Record<string, unknown>).skills || {},
            parsed: (parsed as Record<string, unknown>).skills || {},
          },
          hash: configData.hash,
        });
      } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
      }
    }

    // Default: list all skills
    const data = await runCliJson<SkillsList>(["skills", "list"]);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Skills API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── POST: install / enable / disable / config ──── */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "install-brew": {
        // Install a binary dependency via brew
        const pkg = body.package as string;
        if (!pkg)
          return NextResponse.json(
            { error: "package required" },
            { status: 400 }
          );
        // Run brew install
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const exec = promisify(execFile);
        try {
          const { stdout, stderr } = await exec("brew", ["install", pkg], {
            timeout: 120000,
          });
          return NextResponse.json({
            ok: true,
            action,
            package: pkg,
            output: stdout + stderr,
          });
        } catch (err: unknown) {
          const e = err as { stderr?: string; message?: string };
          return NextResponse.json(
            {
              error: `brew install failed: ${e.stderr || e.message || String(err)}`,
            },
            { status: 500 }
          );
        }
      }

      case "enable-skill": {
        // Add skill to allowlist or remove from disabledSkills in config
        const name = body.name as string;
        if (!name)
          return NextResponse.json(
            { error: "name required" },
            { status: 400 }
          );

        try {
          const configData = await gatewayCall<Record<string, unknown>>(
            "config.get",
            undefined,
            8000
          );
          const hash = configData.hash as string;
          const parsed = (configData.parsed || {}) as Record<string, unknown>;
          const skills = ((parsed.skills || {}) as Record<string, unknown>);
          const disabled = (skills.disabled || []) as string[];
          const newDisabled = disabled.filter((s) => s !== name);

          await gatewayCall(
            "config.patch",
            {
              raw: JSON.stringify({ skills: { disabled: newDisabled } }),
              baseHash: hash,
            },
            10000
          );
          return NextResponse.json({ ok: true, action, name });
        } catch (err) {
          return NextResponse.json({ error: String(err) }, { status: 500 });
        }
      }

      case "disable-skill": {
        const name = body.name as string;
        if (!name)
          return NextResponse.json(
            { error: "name required" },
            { status: 400 }
          );

        try {
          const configData = await gatewayCall<Record<string, unknown>>(
            "config.get",
            undefined,
            8000
          );
          const hash = configData.hash as string;
          const parsed = (configData.parsed || {}) as Record<string, unknown>;
          const skills = ((parsed.skills || {}) as Record<string, unknown>);
          const disabled = (skills.disabled || []) as string[];
          if (!disabled.includes(name)) disabled.push(name);

          await gatewayCall(
            "config.patch",
            {
              raw: JSON.stringify({ skills: { disabled } }),
              baseHash: hash,
            },
            10000
          );
          return NextResponse.json({ ok: true, action, name });
        } catch (err) {
          return NextResponse.json({ error: String(err) }, { status: 500 });
        }
      }

      case "update-tool-config": {
        // Patch tools.<skillKey> config
        const skillKey = body.skillKey as string;
        const config = body.config as Record<string, unknown>;
        if (!skillKey || !config)
          return NextResponse.json(
            { error: "skillKey and config required" },
            { status: 400 }
          );

        try {
          const configData = await gatewayCall<Record<string, unknown>>(
            "config.get",
            undefined,
            8000
          );
          const hash = configData.hash as string;

          await gatewayCall(
            "config.patch",
            {
              raw: JSON.stringify({ tools: { [skillKey]: config } }),
              baseHash: hash,
            },
            10000
          );
          return NextResponse.json({ ok: true, action, skillKey });
        } catch (err) {
          return NextResponse.json({ error: String(err) }, { status: 500 });
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Skills POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
