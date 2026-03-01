import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { getOpenClawHome, getDefaultWorkspaceSync } from "@/lib/paths";
import { runCliJson, runCli, parseJsonFromCliOutput } from "@/lib/openclaw-cli";
import { fetchGatewaySessions, summarizeSessionsByAgent } from "@/lib/gateway-sessions";

const OPENCLAW_HOME = getOpenClawHome();
export const dynamic = "force-dynamic";

type CliAgent = {
  id: string;
  name?: string;
  identityName?: string;
  identityEmoji?: string;
  identityTheme?: string;
  identityAvatar?: string;
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
  identityTheme: string | null;
  identityAvatar: string | null;
  identitySource: string | null;
  subagents: string[];
  runtimeSubagents: Array<{
    sessionKey: string;
    sessionId: string;
    shortId: string;
    model: string;
    totalTokens: number;
    lastActive: number;
    ageMs: number;
    status: "running" | "recent";
  }>;
  status: "active" | "idle" | "unknown";
};

const SUBAGENT_RECENT_WINDOW_MS = 30 * 60 * 1000;
const SUBAGENT_ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const AGENTS_CACHE_TTL_MS = 5000;

type AgentsGetPayload = {
  agents: AgentFull[];
  owner: string | null;
  defaultModel: string;
  defaultFallbacks: string[];
  configuredChannels: Array<{
    channel: string;
    enabled: boolean;
  }>;
};

let agentsCache: { payload: AgentsGetPayload; expiresAt: number } | null = null;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function isSubagentSessionKey(key: string): boolean {
  return key.includes(":subagent:");
}

function shortSubagentId(key: string, sessionId: string): string {
  const fromKey = key.split(":").pop() || "";
  if (fromKey) return fromKey.slice(0, 8);
  return sessionId.slice(0, 8);
}

function connectedChannelsFromStatus(raw: unknown): Set<string> {
  const out = new Set<string>();
  const obj = asRecord(raw);
  const channels = asRecord(obj.channels);
  for (const [channel, rowRaw] of Object.entries(channels)) {
    const row = asRecord(rowRaw);
    const probe = asRecord(row.probe);
    if (row.running === true || probe.ok === true) {
      out.add(channel);
    }
  }

  const channelAccounts = asRecord(obj.channelAccounts);
  for (const [channel, entriesRaw] of Object.entries(channelAccounts)) {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    for (const entryRaw of entries) {
      const entry = asRecord(entryRaw);
      const probe = asRecord(entry.probe);
      if (
        entry.running === true ||
        probe.ok === true
      ) {
        out.add(channel);
        break;
      }
    }
  }

  return out;
}

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
    const now = Date.now();
    if (agentsCache && now < agentsCache.expiresAt) {
      return NextResponse.json(agentsCache.payload);
    }

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
    const cliById = new Map<string, CliAgent>();
    for (const agent of cliAgents) {
      cliById.set(agent.id, agent);
    }

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

    const channelStatusRaw = await runCliJson<Record<string, unknown>>(
      ["channels", "status", "--probe"],
      12000
    ).catch(() => ({}));
    const connectedChannels = connectedChannelsFromStatus(channelStatusRaw);

    // Build a lookup from config list
    const configMap = new Map<string, Record<string, unknown>>();
    for (const c of configList) {
      if (c.id) configMap.set(c.id as string, c);
    }

    // Session state comes from gateway RPC (source of truth), not local files.
    let gatewaySessions = [] as Awaited<ReturnType<typeof fetchGatewaySessions>>;
    let sessionsByAgent = new Map<string, { sessionCount: number; totalTokens: number; lastActive: number }>();
    const runtimeSubagentsByAgent = new Map<
      string,
      AgentFull["runtimeSubagents"]
    >();
    try {
      gatewaySessions = await fetchGatewaySessions(10000);
      sessionsByAgent = summarizeSessionsByAgent(gatewaySessions);

      const now = Date.now();
      for (const session of gatewaySessions) {
        if (!isSubagentSessionKey(session.key)) continue;
        if (!session.agentId) continue;
        if (!session.updatedAt) continue;
        const ageMs = Math.max(0, now - session.updatedAt);
        if (ageMs > SUBAGENT_RECENT_WINDOW_MS) continue;
        const row: AgentFull["runtimeSubagents"][number] = {
          sessionKey: session.key,
          sessionId: session.sessionId,
          shortId: shortSubagentId(session.key, session.sessionId),
          model: session.fullModel || "unknown",
          totalTokens: session.totalTokens,
          lastActive: session.updatedAt,
          ageMs,
          status: ageMs <= SUBAGENT_ACTIVE_WINDOW_MS ? "running" : "recent",
        };
        const existing = runtimeSubagentsByAgent.get(session.agentId) || [];
        existing.push(row);
        runtimeSubagentsByAgent.set(session.agentId, existing);
      }

      for (const [agentId, rows] of runtimeSubagentsByAgent.entries()) {
        rows.sort((a, b) => b.lastActive - a.lastActive);
        runtimeSubagentsByAgent.set(agentId, rows.slice(0, 6));
      }
    } catch {
      // Keep agents page usable even if gateway session RPC is temporarily unavailable.
    }

    const agents: AgentFull[] = [];
    const workspaceIdentityCache = new Map<string, string | null>();

    // Determine the set of agent ids to process
    const agentIds = new Set<string>();
    for (const cli of cliAgents) agentIds.add(cli.id);
    for (const cfg of configList) {
      if (cfg.id) agentIds.add(cfg.id as string);
    }
    for (const sessionAgentId of sessionsByAgent.keys()) {
      if (sessionAgentId) agentIds.add(sessionAgentId);
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
      const cli = cliById.get(id);
      const cfg = configMap.get(id) || {};
      const identityCfg =
        cfg.identity && typeof cfg.identity === "object"
          ? (cfg.identity as Record<string, unknown>)
          : {};
      const identityTheme =
        (typeof cli?.identityTheme === "string" && cli.identityTheme) ||
        (typeof identityCfg.theme === "string" ? identityCfg.theme : null);
      const identityAvatar =
        (typeof cli?.identityAvatar === "string" && cli.identityAvatar) ||
        (typeof identityCfg.avatar === "string" ? identityCfg.avatar : null);
      const identitySource =
        (typeof cli?.identitySource === "string" && cli.identitySource) || null;

      // Name / emoji — strip markdown template hints like "_(or ...)"
      const rawName =
        cli?.identityName ||
        (typeof identityCfg.name === "string" ? identityCfg.name : null) ||
        (cfg.name as string) ||
        cli?.name ||
        id;
      const name = rawName.replace(/\s*_\(.*?\)_?\s*/g, "").trim() || rawName;
      const rawEmoji =
        cli?.identityEmoji ||
        (typeof identityCfg.emoji === "string" ? identityCfg.emoji : null) ||
        "🤖";
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
      if (id === discoveredDefaultAgentId || cli?.isDefault) {
        for (const ch of connectedChannels) {
          if (!channels.includes(ch)) channels.push(ch);
        }
      }

      // Sessions & tokens from gateway truth.
      const sessionSummary = sessionsByAgent.get(id);
      const sessionCount = sessionSummary?.sessionCount || 0;
      const lastActive = sessionSummary && sessionSummary.lastActive > 0
        ? sessionSummary.lastActive
        : null;
      const totalTokens = sessionSummary?.totalTokens || 0;
      const runtimeSubagents = runtimeSubagentsByAgent.get(id) || [];

      // Identity snippet (first few meaningful lines)
      let identitySnippet: string | null = null;
      let idFile = workspaceIdentityCache.get(workspace);
      if (idFile === undefined) {
        idFile = await readTextSafe(join(workspace, "IDENTITY.md"));
        workspaceIdentityCache.set(workspace, idFile);
      }
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
        isDefault: Boolean(cli?.isDefault || id === discoveredDefaultAgentId),
        sessionCount,
        lastActive,
        totalTokens,
        bindings,
        channels,
        identitySnippet,
        identityTheme,
        identityAvatar,
        identitySource,
        subagents,
        runtimeSubagents,
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

    const payload: AgentsGetPayload = {
      agents,
      owner: ownerName,
      defaultModel: defaultPrimary,
      defaultFallbacks,
      configuredChannels,
    };
    agentsCache = {
      payload,
      expiresAt: Date.now() + AGENTS_CACHE_TTL_MS,
    };

    return NextResponse.json(payload);
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
    // Invalidate GET cache for any mutation action.
    agentsCache = null;

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
        const agentDir = (body.agentDir as string)?.trim();
        if (agentDir) {
          args.push("--agent-dir", agentDir);
        }

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
          result = parseJsonFromCliOutput<Record<string, unknown>>(
            output,
            "openclaw agents add --json"
          );
        } catch {
          result = { raw: output };
        }

        // Patch the new agent in config: displayName, model+fallbacks, default, subagents (per OpenClaw config reference)
        const configPath = join(OPENCLAW_HOME, "openclaw.json");
        try {
          let config: Record<string, unknown> = {};
          try {
            config = JSON.parse(await readFile(configPath, "utf-8"));
          } catch {
            return NextResponse.json({ ok: true, action, name, workspace, ...result });
          }
          const agentsSection = config.agents as Record<string, unknown> | undefined;
          const list = Array.isArray(agentsSection?.list) ? (agentsSection.list as Record<string, unknown>[]) : [];
          const idx = list.findIndex((a) => (a.id as string) === name);
          if (idx >= 0) {
            const entry = { ...list[idx] };
            const displayName = (body.displayName as string)?.trim();
            if (displayName) entry.name = displayName;
            const fallbacks = (body.fallbacks || []) as string[];
            if (body.model && fallbacks.length > 0) {
              entry.model = { primary: body.model, fallbacks };
            } else if (body.model) {
              entry.model = body.model;
            }
            if (body.default === true) {
              entry.default = true;
              for (let i = 0; i < list.length; i++) {
                if (i !== idx) (list[i] as Record<string, unknown>).default = false;
              }
            }
            const subagentsList = (body.subagents || []) as string[];
            if (subagentsList.length > 0) {
              entry.subagents = { ...((entry.subagents as Record<string, unknown>) || {}), allowAgents: subagentsList };
            }
            list[idx] = entry;
            if (config.agents && typeof config.agents === "object") {
              (config.agents as Record<string, unknown>).list = list;
              await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
            }
          }
        } catch (patchErr) {
          console.warn("Agent create: config patch failed", patchErr);
        }

        return NextResponse.json({
          ok: true,
          action,
          name,
          workspace,
          agentDir: agentDir || undefined,
          ...result,
        });
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

        if (!config.agents || typeof config.agents !== "object") {
          config.agents = {};
        }
        const agentsSection = config.agents as Record<string, unknown>;
        if (!Array.isArray(agentsSection.list)) {
          agentsSection.list = [];
        }
        const agentsList = agentsSection.list as Record<string, unknown>[];
        let agentIdx = agentsList.findIndex((a) => a.id === id);
        // If agent exists only at runtime (e.g. default "main") but not in config, upsert an entry
        if (agentIdx === -1) {
          agentIdx = agentsList.length;
          agentsList.push({ id });
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

        // Update display name shown in dashboard/config
        if ("displayName" in body) {
          const displayName = String(body.displayName || "").trim();
          if (displayName) agent.name = displayName;
          else delete agent.name;
        }

        // Update default marker
        if ("default" in body) {
          if (body.default === true) {
            agent.default = true;
            for (let i = 0; i < agentsList.length; i++) {
              if (i !== agentIdx) {
                const peer = agentsList[i] as Record<string, unknown>;
                if ("default" in peer) delete peer.default;
              }
            }
          } else if (body.default === false && agent.default === true) {
            delete agent.default;
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

      case "set-identity": {
        const id = String(body.id || "").trim();
        if (!id) {
          return NextResponse.json(
            { error: "Agent ID is required" },
            { status: 400 }
          );
        }

        const args = ["agents", "set-identity", "--agent", id, "--json"];
        let hasExplicitIdentityField = false;

        const name = String(body.name || "").trim();
        if (name) {
          args.push("--name", name);
          hasExplicitIdentityField = true;
        }
        const emoji = String(body.emoji || "").trim();
        if (emoji) {
          args.push("--emoji", emoji);
          hasExplicitIdentityField = true;
        }
        const theme = String(body.theme || "").trim();
        if (theme) {
          args.push("--theme", theme);
          hasExplicitIdentityField = true;
        }
        const avatar = String(body.avatar || "").trim();
        if (avatar) {
          args.push("--avatar", avatar);
          hasExplicitIdentityField = true;
        }

        const fromIdentity = body.fromIdentity === true;
        if (fromIdentity) {
          args.push("--from-identity");
        }

        const workspace = String(body.workspace || "").trim();
        if (workspace) {
          args.push("--workspace", workspace);
        }

        const identityFile = String(body.identityFile || "").trim();
        if (identityFile) {
          args.push("--identity-file", identityFile);
        }

        if (!fromIdentity && !hasExplicitIdentityField) {
          return NextResponse.json(
            { error: "Provide identity fields or enable fromIdentity." },
            { status: 400 }
          );
        }

        let output: string;
        try {
          output = await runCli(args, 30000);
        } catch (cliErr) {
          const msg = String(cliErr);
          if (msg.includes("No identity data found")) {
            return NextResponse.json(
              { error: "No IDENTITY.md found in this agent's workspace. Create one first, or set identity fields manually above." },
              { status: 400 }
            );
          }
          throw cliErr;
        }
        let result: Record<string, unknown> = {};
        try {
          result = parseJsonFromCliOutput<Record<string, unknown>>(
            output,
            "openclaw agents set-identity --json"
          );
        } catch {
          result = { raw: output };
        }
        return NextResponse.json({ ok: true, action, id, ...result });
      }

      case "delete": {
        const id = String(body.id || "").trim();
        if (!id) {
          return NextResponse.json(
            { error: "Agent ID is required" },
            { status: 400 }
          );
        }

        const force = body.force !== false;
        const args = ["agents", "delete", id, "--json"];
        if (force) args.push("--force");

        const output = await runCli(args, 30000);
        let result: Record<string, unknown> = {};
        try {
          result = parseJsonFromCliOutput<Record<string, unknown>>(
            output,
            "openclaw agents delete --json"
          );
        } catch {
          result = { raw: output };
        }
        return NextResponse.json({ ok: true, action, id, ...result });
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
