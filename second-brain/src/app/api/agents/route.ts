import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { getOpenClawHome, getDefaultWorkspaceSync } from "@/lib/paths";
import { runCliJson } from "@/lib/openclaw-cli";

const OPENCLAW_HOME = getOpenClawHome();

type CliAgent = {
  id: string;
  name?: string;
  identityName?: string;
  identityEmoji?: string;
  identitySource?: string;
  workspace: string;
  agentDir: string;
  model: string;
  bindings: number;
  isDefault?: boolean;
  bindingDetails?: string[];
  routes?: string[];
};

type AgentFull = {
  id: string;
  name: string;
  emoji: string;
  model: string;
  fallbackModels: string[];
  workspace: string;
  agentDir: string;
  isDefault: boolean;
  sessionCount: number;
  lastActive: number | null;
  totalTokens: number;
  bindings: string[];
  channels: string[];
  identitySnippet: string | null;
  subagents: string[];
  status: "active" | "idle" | "unknown";
};

async function readJsonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function readTextSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Rich agent discovery — merges CLI data, config, sessions, identity.
 */
export async function GET() {
  try {
    // 1. Get agents from CLI (includes binding info)
    let cliAgents: CliAgent[] = [];
    try {
      cliAgents = await runCliJson<CliAgent[]>(
        ["agents", "list", "--bindings"],
        10000
      );
    } catch {
      // CLI might not be available
    }

    // 2. Get config for deeper info (models, subagents)
    const configPath = join(OPENCLAW_HOME, "openclaw.json");
    const config = await readJsonSafe<Record<string, unknown>>(configPath, {});
    const agentsConfig = (config.agents || {}) as Record<string, unknown>;
    const defaults = (agentsConfig.defaults || {}) as Record<string, unknown>;
    const configList = (agentsConfig.list || []) as Record<string, unknown>[];

    const defaultModel = defaults.model as Record<string, unknown> | undefined;
    const defaultPrimary = (defaultModel?.primary as string) || "unknown";
    const defaultFallbacks = (defaultModel?.fallbacks as string[]) || [];
    const defaultWorkspace =
      (defaults.workspace as string) || getDefaultWorkspaceSync();

    // Build a lookup from config list
    const configMap = new Map<string, Record<string, unknown>>();
    for (const c of configList) {
      if (c.id) configMap.set(c.id as string, c);
    }

    const agents: AgentFull[] = [];

    // Determine the set of agent ids to process
    const agentIds = new Set<string>();
    for (const cli of cliAgents) agentIds.add(cli.id);
    for (const cfg of configList) {
      if (cfg.id) agentIds.add(cfg.id as string);
    }

    // Also scan agents directory
    try {
      const agentDirs = await readdir(join(OPENCLAW_HOME, "agents"), {
        withFileTypes: true,
      });
      for (const dir of agentDirs) {
        if (dir.isDirectory()) agentIds.add(dir.name);
      }
    } catch {
      // ok
    }

    for (const id of agentIds) {
      const cli = cliAgents.find((a) => a.id === id);
      const cfg = configMap.get(id) || {};

      // Name / emoji — strip markdown template hints like "_(or ...)"
      const rawName =
        cli?.identityName || (cfg.name as string) || cli?.name || id;
      const name = rawName.replace(/\s*_\(.*?\)_?\s*/g, "").trim() || rawName;
      const rawEmoji = cli?.identityEmoji || "🤖";
      const emoji = rawEmoji.replace(/\s*_\(.*?\)_?\s*/g, "").trim() || rawEmoji;

      // Model
      const agentModelCfg = cfg.model as Record<string, unknown> | undefined;
      const model =
        (agentModelCfg?.primary as string) || cli?.model || defaultPrimary;
      const fallbackModels =
        (agentModelCfg?.fallbacks as string[]) || defaultFallbacks;

      // Workspace
      const workspace =
        (cfg.workspace as string) || cli?.workspace || defaultWorkspace;
      const agentDir =
        cli?.agentDir || join(OPENCLAW_HOME, "agents", id, "agent");

      // Subagents
      const subagentsCfg = cfg.subagents as
        | Record<string, unknown>
        | undefined;
      const subagents = (subagentsCfg?.allowAgents as string[]) || [];

      // Bindings / channels
      const bindings = cli?.bindingDetails || [];
      const channels: string[] = [];
      for (const b of bindings) {
        const ch = b.split(" ")[0];
        if (ch && !channels.includes(ch)) channels.push(ch);
      }

      // Sessions & tokens
      let sessionCount = 0;
      let lastActive: number | null = null;
      let totalTokens = 0;
      const sessionsPath = join(
        OPENCLAW_HOME,
        "agents",
        id,
        "sessions",
        "sessions.json"
      );
      try {
        const sessData = await readJsonSafe<
          Record<string, Record<string, unknown>>
        >(sessionsPath, {});
        const entries = Object.values(sessData);
        sessionCount = entries.length;
        for (const s of entries) {
          const updAt = (s.updatedAt as number) || 0;
          if (!lastActive || updAt > lastActive) lastActive = updAt;
          totalTokens += (s.totalTokens as number) || 0;
        }
      } catch {
        // ok
      }

      // Identity snippet (first few meaningful lines)
      let identitySnippet: string | null = null;
      const idFile = await readTextSafe(join(workspace, "IDENTITY.md"));
      if (idFile) {
        const lines = idFile
          .split("\n")
          .filter((l) => l.trim() && !l.startsWith("#"))
          .slice(0, 6)
          .join("\n");
        identitySnippet = lines.slice(0, 500);
      }

      // Status
      const now = Date.now();
      const fiveMinAgo = now - 5 * 60 * 1000;
      const status: AgentFull["status"] = lastActive
        ? lastActive > fiveMinAgo
          ? "active"
          : "idle"
        : "unknown";

      agents.push({
        id,
        name,
        emoji,
        model,
        fallbackModels,
        workspace,
        agentDir,
        isDefault: cli?.isDefault || false,
        sessionCount,
        lastActive,
        totalTokens,
        bindings,
        channels,
        identitySnippet,
        subagents,
        status,
      });
    }

    // Sort: default first, then by name
    agents.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });

    // Get owner info from IDENTITY.md of the default workspace
    let ownerName: string | null = null;
    try {
      const defaultAgent = agents.find((a) => a.isDefault);
      if (defaultAgent?.identitySnippet) {
        // Try to parse owner from bindings or just use generic
      }
      // Also check the main identity file for owner hints
      const mainIdentity = await readTextSafe(
        join(defaultWorkspace, "IDENTITY.md")
      );
      if (mainIdentity) {
        const nameMatch = mainIdentity.match(
          /\*\*Name:\*\*\s*(.+?)(?:\n|$)/
        );
        if (nameMatch) ownerName = nameMatch[1].trim();
      }
    } catch {
      // ok
    }

    return NextResponse.json({
      agents,
      owner: ownerName,
      defaultModel: defaultPrimary,
      defaultFallbacks,
    });
  } catch (err) {
    console.error("Agents API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
