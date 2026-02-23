import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { constants as fsConstants } from "fs";
import { access, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { getDefaultWorkspaceSync } from "@/lib/paths";

export const dynamic = "force-dynamic";

const exec = promisify(execFile);

type ExploreItem = {
  slug: string;
  displayName?: string;
  summary?: string;
  latestVersion?: { version?: string };
  stats?: {
    downloads?: number;
    installsCurrent?: number;
    installsAllTime?: number;
    stars?: number;
  };
  updatedAt?: number;
  developer?: string;
  author?: string;
};

type ExplorePayload = {
  items?: ExploreItem[];
  nextCursor?: string | null;
};

type SearchItem = {
  slug: string;
  version: string;
  summary: string;
  score?: number;
  developer?: string;
  author?: string;
  displayName?: string;
};

type InstalledItem = {
  slug: string;
  version: string;
};

type LockFile = {
  version?: number;
  skills?: Record<string, { version?: string; installedAt?: number }>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function parseLooseJson<T>(raw: string): T | null {
  const clean = stripAnsi(raw);
  const startObj = clean.indexOf("{");
  const startArr = clean.indexOf("[");
  const starts = [startObj, startArr].filter((v) => v >= 0).sort((a, b) => a - b);
  if (!starts.length) return null;
  const sliced = clean.slice(starts[0]);
  try {
    return JSON.parse(sliced) as T;
  } catch {
    return null;
  }
}

function parseSearch(stdout: string): SearchItem[] {
  const lines = stripAnsi(stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("- Searching"));

  const items: SearchItem[] = [];
  for (const line of lines) {
    const strict = line.match(/^([a-z0-9][\w-]*)\s+v([A-Za-z0-9._-]+)\s+(.*?)\s+\(([\d.]+)\)$/i);
    if (strict) {
      items.push({
        slug: strict[1] || "",
        version: strict[2] || "latest",
        summary: strict[3] || "",
        score: Number(strict[4]),
      });
      continue;
    }

    const cols = line.split(/\s{2,}/).filter(Boolean);
    if (!cols.length) continue;
    const head = cols[0] || "";
    const hm = head.match(/^([a-z0-9][\w-]*)\s+v([A-Za-z0-9._-]+)$/i);
    if (!hm) continue;
    const scoreText = cols[2]?.match(/\(([\d.]+)\)/)?.[1];
    items.push({
      slug: hm[1] || "",
      version: hm[2] || "latest",
      summary: cols[1] || "",
      score: scoreText ? Number(scoreText) : undefined,
    });
  }
  return items;
}

function parseInstalled(stdout: string): InstalledItem[] {
  return stripAnsi(stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([a-z0-9][\w-]*)\s+([A-Za-z0-9._-]+)$/i);
      if (!m) return null;
      return {
        slug: m[1] || "",
        version: m[2] || "",
      };
    })
    .filter((v): v is InstalledItem => Boolean(v));
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(slug);
}

async function readLockFile(path: string): Promise<LockFile> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as LockFile;
    if (!parsed || typeof parsed !== "object") {
      return { version: 1, skills: {} };
    }
    if (!parsed.skills || typeof parsed.skills !== "object") {
      parsed.skills = {};
    }
    if (!parsed.version) {
      parsed.version = 1;
    }
    return parsed;
  } catch {
    return { version: 1, skills: {} };
  }
}

async function uninstallWorkspaceSkill(slug: string): Promise<{
  removedDir: boolean;
  removedLock: boolean;
}> {
  const workspace = getDefaultWorkspaceSync();
  const skillDir = join(workspace, "skills", slug);
  const lockPath = join(workspace, ".clawhub", "lock.json");

  let removedDir = false;
  let removedLock = false;

  try {
    await access(skillDir, fsConstants.F_OK);
    await rm(skillDir, { recursive: true, force: true });
    removedDir = true;
  } catch {
    // best effort
  }

  const lock = await readLockFile(lockPath);
  const skills = lock.skills || {};
  if (skills[slug]) {
    delete skills[slug];
    lock.skills = skills;
    await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf-8");
    removedLock = true;
  }

  return { removedDir, removedLock };
}

async function runClawHub(args: string[], timeout = 30000): Promise<{ stdout: string; stderr: string }> {
  const workspace = getDefaultWorkspaceSync();
  const fullArgs = ["--no-input", "--workdir", workspace, ...args];
  const { stdout, stderr } = await exec("clawhub", fullArgs, {
    cwd: workspace,
    timeout,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout, stderr };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "explore";

  try {
    if (action === "search") {
      const q = (searchParams.get("q") || "").trim();
      const limit = clamp(Number(searchParams.get("limit") || 24), 1, 50);
      if (!q) return NextResponse.json({ items: [] });
      const { stdout } = await runClawHub(["search", q, "--limit", String(limit)], 30000);
      return NextResponse.json({ items: parseSearch(stdout) });
    }

    if (action === "list") {
      const { stdout } = await runClawHub(["list"], 10000);
      return NextResponse.json({ items: parseInstalled(stdout) });
    }

    if (action === "inspect") {
      const slug = (searchParams.get("slug") || "").trim();
      if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
      const version = (searchParams.get("version") || "").trim();
      const args = ["inspect", slug, "--json"];
      if (version) args.push("--version", version);
      const { stdout } = await runClawHub(args, 20000);
      const parsed = parseLooseJson<Record<string, unknown>>(stdout);
      return NextResponse.json(parsed || { ok: false, raw: stdout });
    }

    const limit = clamp(Number(searchParams.get("limit") || 24), 1, 100);
    const sort = (searchParams.get("sort") || "trending").trim();
    const { stdout } = await runClawHub(["explore", "--limit", String(limit), "--sort", sort, "--json"], 30000);
    const parsed = parseLooseJson<ExplorePayload>(stdout);
    return NextResponse.json({
      items: parsed?.items || [],
      nextCursor: parsed?.nextCursor || null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;
    const slug = (body.slug as string | undefined)?.trim();
    const version = (body.version as string | undefined)?.trim();

    if (action === "install") {
      if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
      const force = Boolean(body.force);
      const args = ["install", slug];
      if (version) args.push("--version", version);
      if (force) args.push("--force");
      const { stdout, stderr } = await runClawHub(args, 120000);
      return NextResponse.json({ ok: true, action, slug, output: `${stdout}${stderr}`.trim() });
    }

    if (action === "update") {
      if (!slug) {
        const args = ["update", "--all"];
        if (body.force) args.push("--force");
        const { stdout, stderr } = await runClawHub(args, 120000);
        return NextResponse.json({ ok: true, action, slug: null, output: `${stdout}${stderr}`.trim() });
      }
      const args = ["update", slug];
      if (version) args.push("--version", version);
      if (body.force) args.push("--force");
      const { stdout, stderr } = await runClawHub(args, 120000);
      return NextResponse.json({ ok: true, action, slug: slug || null, output: `${stdout}${stderr}`.trim() });
    }

    if (action === "uninstall") {
      if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
      if (!isValidSlug(slug)) {
        return NextResponse.json({ error: "invalid slug" }, { status: 400 });
      }
      const result = await uninstallWorkspaceSkill(slug);
      if (!result.removedDir && !result.removedLock) {
        return NextResponse.json(
          { error: `Skill "${slug}" not found in workspace` },
          { status: 404 }
        );
      }
      return NextResponse.json({
        ok: true,
        action,
        slug,
        output: `Removed ${slug} from workspace skills.`,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const e = err as { message?: string; stdout?: string; stderr?: string };
    const details = [e.message, e.stderr, e.stdout].filter(Boolean).join("\n");
    return NextResponse.json({ error: details || String(err) }, { status: 500 });
  }
}
