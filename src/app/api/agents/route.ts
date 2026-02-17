import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { getOpenClawHome, getDefaultWorkspaceSync } from "@/lib/paths";
import { runCliJson, runCli } from "@/lib/openclaw-cli";

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

    const discoveredDefaultAgentId =
      cliAgents.find((a) => a.isDefault)?.id ||
      (configList.find((c) => String(c.id || "") === "main")?.id as string | undefined) ||
      (configList.find((c) => typeof c.id === "string")?.id as string | undefined) ||
      "main";

    // Bindings in openclaw.json are the persisted routing truth.
    // Merge with CLI-reported bindings to avoid stale UI after recent edits.
    const configBindingsByAgent = new Map<string, string[]>();
    const configBindings = (config.bindings || []) as Record<string, unknown>[];
    for (const binding of configBindings) {
      const agentId = String(binding.agentId || discoveredDefaultAgentId).trim();
      const match = (binding.match || {}) as Record<string, unknown>;
      const channel = String(match.channel || "").trim();
      const accountId = String(match.accountId || "").trim();
      if (!channel) continue;
      const label = accountId ? `${channel} accountId=${accountId}` : channel;
      const existing = configBindingsByAgent.get(agentId) || [];
      if (!existing.includes(label)) existing.push(label);
      configBindingsByAgent.set(agentId, existing);
    }

    // Channels configured at instance level (whether bound or not).
    const configuredChannels = Object.entries(
      (config.channels || {}) as Record<string, unknown>
    ).map(([channel, rawCfg]) => {
      const channelCfg =
        rawCfg && typeof rawCfg === "object"
          ? (rawCfg as Record<string, unknown>)
          : {};
      return {
        channel,
        enabled: Boolean(channelCfg.enabled),
      };
    });

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

      // Model — prefer config-level names over CLI's resolved provider model IDs
      // (CLI returns the resolved model after auth failover, e.g. "amazon-bedrock/anthropic.claude-3-sonnet-..."
      //  which is not what the user configured)
      const agentModelCfg = cfg.model as
        | string
        | Record<string, unknown>
        | undefined;
      let model: string;
      let fallbackModels: string[];
      if (typeof agentModelCfg === "string") {
        // Per-agent model set as a plain string
        model = agentModelCfg;
        fallbackModels = defaultFallbacks;
      } else if (agentModelCfg && typeof agentModelCfg === "object") {
        // Per-agent model set as { primary, fallbacks }
        model = (agentModelCfg.primary as string) || defaultPrimary;
        fallbackModels = (agentModelCfg.fallbacks as string[]) || defaultFallbacks;
      } else {
        // No per-agent override — use the configured defaults (NOT the CLI resolved model)
        model = defaultPrimary;
        fallbackModels = defaultFallbacks;
      }

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
      const cliBindings = (cli?.bindingDetails || []).map((b) => b.trim());
      const persistedBindings = configBindingsByAgent.get(id) || [];
      const bindings = Array.from(
        new Set(
          [...persistedBindings, ...cliBindings].filter((b) => Boolean(b))
        )
      );
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
      configuredChannels,
    });
  } catch (err) {
    console.error("Agents API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/agents - Create a new agent or perform agent actions.
 *
 * Body:
 *   { action: "create", name: "work", model?: "provider/model", workspace?: "/path", bindings?: ["whatsapp:biz"] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "create": {
        const name = (body.name as string)?.trim();
        if (!name) {
          return NextResponse.json(
            { error: "Agent name is required" },
            { status: 400 }
          );
        }

        // Validate name: alphanumeric + hyphens only
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
          return NextResponse.json(
            { error: "Agent name must start with a letter/number and contain only letters, numbers, hyphens, or underscores" },
            { status: 400 }
          );
        }

        // Build CLI args
        const args = ["agents", "add", name, "--non-interactive", "--json"];

        // Workspace (default or custom)
        const workspace =
          (body.workspace as string)?.trim() ||
          join(getOpenClawHome(), `workspace-${name}`);
        args.push("--workspace", workspace);

        // Model (optional — inherits default if not set)
        if (body.model) {
          args.push("--model", body.model as string);
        }

        // Bindings (optional, repeatable)
        const bindings = (body.bindings || []) as string[];
        for (const b of bindings) {
          if (b.trim()) args.push("--bind", b.trim());
        }

        const output = await runCli(args, 30000);

        // Try to parse JSON output
        let result: Record<string, unknown> = {};
        try {
          result = JSON.parse(output);
        } catch {
          result = { raw: output };
        }

        return NextResponse.json({ ok: true, action, name, workspace, ...result });
      }

      case "update": {
        const id = body.id as string;
        if (!id) {
          return NextResponse.json(
            { error: "Agent ID is required" },
            { status: 400 }
          );
        }

        const configPath = join(OPENCLAW_HOME, "openclaw.json");
        let config: Record<string, unknown>;
        try {
          config = JSON.parse(await readFile(configPath, "utf-8"));
        } catch {
          return NextResponse.json(
            { error: "Failed to read config" },
            { status: 500 }
          );
        }

        const agentsSection = config.agents as Record<string, unknown>;
        const agentsList = (agentsSection?.list || []) as Record<
          string,
          unknown
        >[];
        const agentIdx = agentsList.findIndex((a) => a.id === id);
        if (agentIdx === -1) {
          return NextResponse.json(
            { error: `Agent "${id}" not found in config` },
            { status: 404 }
          );
        }

        const agent = { ...agentsList[agentIdx] };

        // Update model
        if ("model" in body) {
          const newModel = body.model as string | null;
          const newFallbacks = (body.fallbacks || []) as string[];
          if (!newModel) {
            // Empty = inherit default, remove override
            delete agent.model;
          } else if (newFallbacks.length > 0) {
            agent.model = { primary: newModel, fallbacks: newFallbacks };
          } else {
            agent.model = newModel;
          }
        }

        // Update subagents
        if ("subagents" in body) {
          const subs = (body.subagents || []) as string[];
          if (subs.length > 0) {
            agent.subagents = {
              ...((agent.subagents as Record<string, unknown>) || {}),
              allowAgents: subs,
            };
          } else {
            delete agent.subagents;
          }
        }

        // Update bindings
        if ("bindings" in body) {
          const newBindings = (body.bindings || []) as string[];
          // Remove existing bindings for this agent
          const existingBindings = (
            (config.bindings || []) as Record<string, unknown>[]
          ).filter((b) => (b.agentId as string) !== id);
          // Add new ones
          for (const binding of newBindings) {
            const parts = binding.split(":");
            existingBindings.push({
              agentId: id,
              match: {
                channel: parts[0],
                accountId: parts[1] || "default",
              },
            });
          }
          config.bindings = existingBindings;
        }

        agentsList[agentIdx] = agent;
        agentsSection.list = agentsList;

        await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

        return NextResponse.json({ ok: true, action: "update", id });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Agents API POST error:", err);
    const msg = String(err);
    // Make gateway errors user-friendly
    if (msg.includes("already exists") || msg.includes("Agent already")) {
      return NextResponse.json(
        { error: `An agent with this name already exists` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
