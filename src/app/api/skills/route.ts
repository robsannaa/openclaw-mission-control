import { NextRequest, NextResponse } from "next/server";
import { runCliJson } from "@/lib/openclaw";
import { fetchConfig, patchConfig } from "@/lib/gateway-config";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { getOpenClawHome, getSystemSkillsDir } from "@/lib/paths";

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

/* ── Filesystem fallback (OpenClaw v2026.3.23+ compat) ── */

const OPENCLAW_HOME = getOpenClawHome();

async function readSkillsFromFilesystem(): Promise<SkillsList> {
  const workspaceDir = join(OPENCLAW_HOME, "workspace");
  const managedSkillsDir = join(OPENCLAW_HOME, "skills");

  const skills: Skill[] = [];

  // Read openclaw.json for allowlist
  let allowlist: string[] = [];
  let hasAllowlist = false;
  try {
    const raw = await readFile(join(OPENCLAW_HOME, "openclaw.json"), "utf-8");
    const config = JSON.parse(raw);
    const sa = config?.skills?.allow;
    if (Array.isArray(sa) && sa.length > 0) {
      allowlist = sa;
      hasAllowlist = true;
    }
  } catch { /* no config */ }

  // Scan directories in order: managed, workspace, personal, bundled
  const dirs: { path: string; source: string }[] = [
    { path: managedSkillsDir, source: "openclaw-managed" },
    { path: join(workspaceDir, "skills"), source: "openclaw-workspace" },
  ];
  // Add personal skills directory if it exists
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/home/openclaw";
  dirs.push({ path: join(homeDir, ".agents", "skills"), source: "agents-skills-personal" });

  // Bundled skills from npm
  try {
    const sysDir = await getSystemSkillsDir();
    dirs.push({ path: sysDir, source: "openclaw-bundled" });
  } catch { /* can't find system skills */ }

  const seen = new Set<string>();
  for (const { path: dir, source } of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || seen.has(entry.name)) continue;
        seen.add(entry.name);
        const skillDir = join(dir, entry.name);
        const skill = await readSkillMeta(
          entry.name,
          skillDir,
          source,
          hasAllowlist,
          allowlist
        );
        if (skill) skills.push(skill);
      }
    } catch {
      // directory doesn't exist — skip
    }
  }

  return { workspaceDir, managedSkillsDir, skills };
}

async function readSkillMeta(
  name: string,
  dir: string,
  source: string,
  hasAllowlist: boolean,
  allowlist: string[]
): Promise<Skill | null> {
  let description = "";
  let emoji = "";
  let homepage = "";

  // Try SKILL.md frontmatter
  try {
    const raw = await readFile(join(dir, "SKILL.md"), "utf-8");
    const fm = raw.match(/^---\n([\s\S]*?)\n---/);
    if (fm) {
      const block = fm[1];
      const dMatch = block.match(/description:\s*["']?(.*?)["']?\s*$/m);
      const eMatch = block.match(/emoji:\s*["']?(.+?)["']?\s*$/m);
      const hMatch = block.match(/homepage:\s*["']?(.+?)["']?\s*$/m);
      if (dMatch) description = dMatch[1];
      if (eMatch) emoji = eMatch[1];
      if (hMatch) homepage = hMatch[1];
    }
  } catch { /* no SKILL.md */ }

  // Try package.json as fallback for description
  if (!description) {
    try {
      const raw = await readFile(join(dir, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      description = pkg.description || "";
    } catch { /* no package.json */ }
  }

  const blockedByAllowlist = hasAllowlist && !allowlist.includes(name);

  return {
    name,
    description,
    emoji,
    eligible: !blockedByAllowlist,
    disabled: false,
    blockedByAllowlist,
    source,
    bundled: source === "openclaw-bundled",
    homepage: homepage || undefined,
    missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
  };
}

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
        const configData = await fetchConfig(8000);
        const tools = (configData.resolved.tools || {}) as Record<string, unknown>;
        if (tools[data.skillKey || data.name]) {
          skillConfig = tools[data.skillKey || data.name] as Record<string, unknown>;
        }
      } catch {
        // config not available
      }

      return NextResponse.json({ ...data, skillMd, skillConfig });
    }

    if (action === "config") {
      // Get the full config to see skills/tools section
      try {
        const configData = await fetchConfig(8000);

        return NextResponse.json({
          tools: {
            resolved: configData.resolved.tools || {},
            parsed: configData.parsed.tools || {},
          },
          skills: {
            resolved: configData.resolved.skills || {},
            parsed: configData.parsed.skills || {},
          },
          hash: configData.hash,
        });
      } catch (err) {
        return NextResponse.json({
          tools: { resolved: {}, parsed: {} },
          skills: { resolved: {}, parsed: {} },
          hash: null,
          warning: String(err),
          degraded: true,
        });
      }
    }

    // Default: list all skills
    try {
      const data = await runCliJson<SkillsList>(["skills", "list"]);
      return NextResponse.json(data);
    } catch (cliErr) {
      console.warn("Skills CLI failed, using filesystem fallback:", cliErr);
      try {
        const data = await readSkillsFromFilesystem();
        return NextResponse.json({ ...data, transport: "filesystem-fallback" });
      } catch (fsErr) {
        console.error("Skills filesystem fallback also failed:", fsErr);
        return NextResponse.json({
          workspaceDir: "",
          managedSkillsDir: "",
          skills: [],
          warning: `CLI: ${String(cliErr)} | FS: ${String(fsErr)}`,
          degraded: true,
        });
      }
    }
  } catch (err) {
    console.error("Skills API error:", err);
    if (action === "check") {
      return NextResponse.json({
        summary: {
          total: 0,
          eligible: 0,
          disabled: 0,
          blocked: 0,
          missingRequirements: 0,
        },
        eligible: [],
        disabled: [],
        blocked: [],
        missingRequirements: [],
        warning: String(err),
        degraded: true,
      });
    }
    if (action === "list") {
      return NextResponse.json({
        workspaceDir: "",
        managedSkillsDir: "",
        skills: [],
        warning: String(err),
        degraded: true,
      });
    }
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

      case "enable-skill":
      case "disable-skill": {
        // Toggle skill via skills.entries.<name>.enabled
        const name = body.name as string;
        if (!name)
          return NextResponse.json(
            { error: "name required" },
            { status: 400 }
          );

        const enabling = action === "enable-skill";

        try {
          await patchConfig({
            skills: {
              entries: {
                [name]: { enabled: enabling },
              },
            },
          }, { restartDelayMs: 2000 });
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
          await patchConfig({ tools: { [skillKey]: config } });
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
