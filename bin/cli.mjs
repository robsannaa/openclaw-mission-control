#!/usr/bin/env node

/**
 * openclaw-dashboard CLI
 *
 * Usage:
 *   npx @openclaw/dashboard          # build + start on port 3000
 *   npx @openclaw/dashboard --dev     # dev mode with hot reload
 *   npx @openclaw/dashboard --port 8080
 *   npx @openclaw/dashboard --help
 *
 * Zero config: auto-discovers OPENCLAW_HOME, binary, and agents.
 */

import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Parse args ──────────────────────────────────

const args = process.argv.slice(2);
const help = args.includes("--help") || args.includes("-h");
const dev = args.includes("--dev");
const portIdx = args.indexOf("--port");
const port = portIdx !== -1 && args[portIdx + 1] ? args[portIdx + 1] : "3000";

if (help) {
  console.log(`
  🦞 Mission Control — OpenClaw Dashboard

  Usage:
    npx @openclaw/dashboard            Start the dashboard (port 3000)
    npx @openclaw/dashboard --dev      Development mode (hot reload)
    npx @openclaw/dashboard --port N   Custom port
    npx @openclaw/dashboard --help     This message

  Environment (all optional — auto-discovered):
    OPENCLAW_HOME        Path to ~/.openclaw (default: auto)
    OPENCLAW_BIN         Path to openclaw binary (default: auto)
    OPENCLAW_SKILLS_DIR  Path to skills dir (default: auto)

  The dashboard auto-discovers your OpenClaw installation.
  No configuration required.
`);
  process.exit(0);
}

// ── Verify OpenClaw is installed ────────────────

function findOpenclaw() {
  // Check env
  if (process.env.OPENCLAW_BIN && existsSync(process.env.OPENCLAW_BIN)) {
    return process.env.OPENCLAW_BIN;
  }
  // Check PATH
  try {
    const result = execSync("which openclaw", { encoding: "utf-8" }).trim();
    if (result) return result;
  } catch {
    // not in PATH
  }
  // Common locations
  const candidates = [
    "/opt/homebrew/bin/openclaw",
    "/usr/local/bin/openclaw",
    "/usr/bin/openclaw",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const openclawBin = findOpenclaw();
if (!openclawBin) {
  console.error(`
  ❌ OpenClaw not found.

  Mission Control needs OpenClaw installed to work.
  Install it first: https://docs.openclaw.ai/install

  If it's already installed, set OPENCLAW_BIN to the path:
    OPENCLAW_BIN=/path/to/openclaw npx @openclaw/dashboard
`);
  process.exit(1);
}

// ── Check if build exists (for non-dev mode) ────

const buildExists = existsSync(resolve(ROOT, ".next"));

if (!dev && !buildExists) {
  console.log("  🔨 First run — building the dashboard...\n");
  try {
    execSync("npm run build", {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env },
    });
  } catch {
    console.error("\n  ❌ Build failed. Try running with --dev instead.\n");
    process.exit(1);
  }
  console.log("");
}

// ── Launch ──────────────────────────────────────

const cmd = dev ? "dev" : "start";
const nextArgs = [cmd, "-H", "127.0.0.1", "-p", port];

console.log(`  🦞 Mission Control starting on http://localhost:${port}`);
console.log(`  📡 OpenClaw: ${openclawBin}`);
console.log(`  🏠 OPENCLAW_HOME: ${process.env.OPENCLAW_HOME || "~/.openclaw (auto)"}`);
console.log("");

const child = spawn("npx", ["next", ...nextArgs], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env },
});

child.on("error", (err) => {
  console.error("  ❌ Failed to start:", err.message);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code || 0);
});

// Forward signals
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
