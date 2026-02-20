/**
 * Self-discovering path resolution for OpenClaw.
 *
 * OPENCLAW_HOME priority:
 *   1. OPENCLAW_HOME env var
 *   2. OPENCLAW_STATE_DIR env var (alias)
 *   3. $HOME/.openclaw
 *
 * Binary path priority:
 *   1. OPENCLAW_BIN env var
 *   2. `which openclaw`
 *   3. Common install locations
 *
 * System skills dir priority:
 *   1. OPENCLAW_SKILLS_DIR env var
 *   2. `npm root -g` + /openclaw/skills
 *   3. Common npm global paths
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { access } from "fs/promises";
import { homedir } from "os";

const exec = promisify(execFile);

// ── OpenClaw home directory ──────────────────────

let _home: string | null = null;

export function getOpenClawHome(): string {
  if (_home) return _home;
  _home =
    process.env.OPENCLAW_HOME ||
    process.env.OPENCLAW_STATE_DIR ||
    join(homedir(), ".openclaw");
  return _home;
}

// ── Default workspace directory ──────────────────

let _workspace: string | null = null;

/**
 * Resolve the default agent workspace path.
 * Priority:
 *   1. OPENCLAW_WORKSPACE env var
 *   2. agents.defaults.workspace from openclaw.json
 *   3. $OPENCLAW_HOME/workspace
 */
export async function getDefaultWorkspace(): Promise<string> {
  if (_workspace) return _workspace;

  // 1. Env var
  if (process.env.OPENCLAW_WORKSPACE) {
    _workspace = process.env.OPENCLAW_WORKSPACE;
    return _workspace;
  }

  // 2. Read from config
  try {
    const { readFile } = await import("fs/promises");
    const configPath = join(getOpenClawHome(), "openclaw.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    const ws = config?.agents?.defaults?.workspace;
    if (ws && typeof ws === "string") {
      _workspace = ws;
      return _workspace;
    }
  } catch {
    // Config doesn't exist or is invalid — fall through
  }

  // 3. Conventional default
  _workspace = join(getOpenClawHome(), "workspace");
  return _workspace;
}

/** Synchronous accessor — uses cached value or falls back to convention. */
export function getDefaultWorkspaceSync(): string {
  return (
    _workspace ||
    process.env.OPENCLAW_WORKSPACE ||
    join(getOpenClawHome(), "workspace")
  );
}

// ── OpenClaw binary path ─────────────────────────

let _bin: string | null = null;
let _binDone = false;

const BIN_CANDIDATES = [
  "/opt/homebrew/bin/openclaw",
  "/usr/local/bin/openclaw",
  "/usr/bin/openclaw",
  join(homedir(), ".local/bin/openclaw"),
  join(homedir(), ".npm-global/bin/openclaw"),
];

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function getOpenClawBin(): Promise<string> {
  if (_binDone && _bin) return _bin;

  // 1. Env var
  if (process.env.OPENCLAW_BIN) {
    _bin = process.env.OPENCLAW_BIN;
    _binDone = true;
    return _bin;
  }

  // 2. which
  try {
    const { stdout } = await exec("which", ["openclaw"], { timeout: 3000 });
    const resolved = stdout.trim();
    if (resolved) {
      _bin = resolved;
      _binDone = true;
      return _bin;
    }
  } catch {
    // continue
  }

  // 3. Probe common locations
  for (const c of BIN_CANDIDATES) {
    if (await fileExists(c)) {
      _bin = c;
      _binDone = true;
      return _bin;
    }
  }

  // 4. Fall back to bare name (hope PATH has it)
  _bin = "openclaw";
  _binDone = true;
  return _bin;
}

/** Synchronous accessor — uses cached value or env. */
export function getOpenClawBinSync(): string {
  return _bin || process.env.OPENCLAW_BIN || "openclaw";
}

// ── gog binary path (same pattern as openclaw: env → which → candidates) ──

let _gogBin: string | null = null;
let _gogBinDone = false;

const GOG_BIN_CANDIDATES = [
  "/opt/homebrew/bin/gog",
  "/usr/local/bin/gog",
  "/usr/bin/gog",
  "/snap/bin/gog",
  join(homedir(), ".local/bin/gog"),
  join(homedir(), "bin/gog"),
];

export async function getGogBin(): Promise<string> {
  if (_gogBinDone && _gogBin) return _gogBin;

  if (process.env.GOG_PATH) {
    _gogBin = process.env.GOG_PATH;
    _gogBinDone = true;
    return _gogBin;
  }

  try {
    const { stdout } = await exec("which", ["gog"], { timeout: 3000 });
    const resolved = stdout.trim();
    if (resolved) {
      _gogBin = resolved;
      _gogBinDone = true;
      return _gogBin;
    }
  } catch {
    // continue
  }

  for (const c of GOG_BIN_CANDIDATES) {
    if (await fileExists(c)) {
      _gogBin = c;
      _gogBinDone = true;
      return _gogBin;
    }
  }

  _gogBin = "gog";
  _gogBinDone = true;
  return _gogBin;
}

// ── Gateway URL ─────────────────────────────────

let _gatewayUrl: string | null = null;

/**
 * Resolve the gateway URL.
 * Priority:
 *   1. OPENCLAW_GATEWAY_URL env var
 *   2. gateway.port from openclaw.json → http://127.0.0.1:{port}
 *   3. http://127.0.0.1:18789
 */
export async function getGatewayUrl(): Promise<string> {
  if (_gatewayUrl) return _gatewayUrl;

  // 1. Env var
  if (process.env.OPENCLAW_GATEWAY_URL) {
    _gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
    return _gatewayUrl;
  }

  // 2. Read from config
  try {
    const { readFile } = await import("fs/promises");
    const configPath = join(getOpenClawHome(), "openclaw.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    const port = config?.gateway?.port;
    if (port && typeof port === "number") {
      _gatewayUrl = `http://127.0.0.1:${port}`;
      return _gatewayUrl;
    }
  } catch {
    // Config doesn't exist or is invalid — fall through
  }

  // 3. Conventional default
  _gatewayUrl = "http://127.0.0.1:18789";
  return _gatewayUrl;
}

/** Extract the port number from the resolved gateway URL. */
export async function getGatewayPort(): Promise<number> {
  const url = await getGatewayUrl();
  try {
    const parsed = new URL(url);
    const port = parseInt(parsed.port, 10);
    return isNaN(port) ? 18789 : port;
  } catch {
    return 18789;
  }
}

// ── System skills directory ──────────────────────

let _skills: string | null = null;
let _skillsDone = false;

export async function getSystemSkillsDir(): Promise<string> {
  if (_skillsDone && _skills) return _skills;

  // 1. Env var
  if (process.env.OPENCLAW_SKILLS_DIR) {
    _skills = process.env.OPENCLAW_SKILLS_DIR;
    _skillsDone = true;
    return _skills;
  }

  // 2. npm root -g
  try {
    const { stdout } = await exec("npm", ["root", "-g"], { timeout: 5000 });
    const root = stdout.trim();
    if (root) {
      _skills = join(root, "openclaw", "skills");
      _skillsDone = true;
      return _skills;
    }
  } catch {
    // continue
  }

  // 3. Common fallbacks
  const candidates = [
    "/opt/homebrew/lib/node_modules/openclaw/skills",
    "/usr/local/lib/node_modules/openclaw/skills",
    "/usr/lib/node_modules/openclaw/skills",
  ];

  for (const c of candidates) {
    if (await fileExists(c)) {
      _skills = c;
      _skillsDone = true;
      return _skills;
    }
  }

  _skills = "/usr/local/lib/node_modules/openclaw/skills";
  _skillsDone = true;
  return _skills;
}
