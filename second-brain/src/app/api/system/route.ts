import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { getOpenClawHome, getSystemSkillsDir, getDefaultWorkspaceSync } from "@/lib/paths";

const OPENCLAW_HOME = getOpenClawHome();

type AgentInfo = {
  id: string;
  name: string;
  workspace: string;
  model: string;
  fallbacks: string[];
  sessionCount: number;
  totalTokens: number;
  recentSessions: {
    key: string;
    updatedAt: number;
    totalTokens: number;
    origin?: string;
  }[];
};

type DeviceInfo = {
  deviceId: string;
  displayName?: string;
  platform: string;
  clientId: string;
  clientMode: string;
  role: string;
  roles: string[];
  lastUsedAt: number;
  createdAt: number;
};

type ChannelInfo = {
  name: string;
  enabled: boolean;
  accounts: string[];
  dmPolicy: string;
  groupPolicy?: string;
};

type SkillInfo = {
  name: string;
  source: "workspace" | "system";
  version?: string;
  description?: string;
  installedAt?: number;
};

type SessionInfo = {
  key: string;
  sessionId: string;
  updatedAt: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  origin?: string;
  agentId: string;
};

async function readJsonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function getAgents(
  config: Record<string, unknown>
): Promise<AgentInfo[]> {
  const agents: AgentInfo[] = [];
  const agentsConfig = (config.agents || {}) as Record<string, unknown>;
  const defaults = (agentsConfig.defaults || {}) as Record<string, unknown>;
  const list = ((agentsConfig.list || []) as Record<string, unknown>[]);

  const defaultModel = defaults.model as Record<string, unknown> | undefined;
  const defaultPrimary =
    (defaultModel?.primary as string) || "unknown";
  const defaultFallbacks =
    (defaultModel?.fallbacks as string[]) || [];
  const defaultWorkspace =
    (defaults.workspace as string) || getDefaultWorkspaceSync();

  for (const agent of list) {
    const id = agent.id as string;
    const name = (agent.name as string) || id;
    const agentModel = agent.model as Record<string, unknown> | undefined;
    const model = (agentModel?.primary as string) || defaultPrimary;
    const fallbacks =
      (agentModel?.fallbacks as string[]) || defaultFallbacks;
    const workspace =
      (agent.workspace as string) || defaultWorkspace;

    // Count sessions
    const sessionsPath = join(
      OPENCLAW_HOME,
      "agents",
      id,
      "sessions",
      "sessions.json"
    );
    let sessionCount = 0;
    let totalTokens = 0;
    const recentSessions: AgentInfo["recentSessions"] = [];
    try {
      const sessionsData = await readJsonSafe<Record<string, Record<string, unknown>>>(
        sessionsPath,
        {}
      );
      const entries = Object.entries(sessionsData);
      sessionCount = entries.length;
      for (const [key, s] of entries) {
        const tokens = (s.totalTokens as number) || 0;
        totalTokens += tokens;
        recentSessions.push({
          key,
          updatedAt: (s.updatedAt as number) || 0,
          totalTokens: tokens,
          origin: (s.origin as Record<string, unknown>)?.label as string,
        });
      }
      recentSessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      // sessions file may not exist
    }

    agents.push({
      id,
      name,
      workspace,
      model,
      fallbacks,
      sessionCount,
      totalTokens,
      recentSessions: recentSessions.slice(0, 10),
    });
  }

  return agents;
}

async function getChannels(
  config: Record<string, unknown>
): Promise<ChannelInfo[]> {
  const channels: ChannelInfo[] = [];
  const channelsConfig = (config.channels || {}) as Record<
    string,
    Record<string, unknown>
  >;

  for (const [name, ch] of Object.entries(channelsConfig)) {
    const accounts = ["default"];
    if (ch.accounts && typeof ch.accounts === "object") {
      accounts.push(...Object.keys(ch.accounts as Record<string, unknown>));
    }
    channels.push({
      name,
      enabled: (ch.enabled as boolean) !== false,
      accounts,
      dmPolicy: (ch.dmPolicy as string) || "pairing",
      groupPolicy: ch.groupPolicy as string,
    });
  }

  return channels;
}

async function getDevices(): Promise<DeviceInfo[]> {
  const pairedPath = join(OPENCLAW_HOME, "devices", "paired.json");
  const data = await readJsonSafe<Record<string, Record<string, unknown>>>(
    pairedPath,
    {}
  );

  return Object.values(data).map((d) => {
    // Find most recent token usage
    let lastUsedAt = 0;
    const tokens = (d.tokens || {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const t of Object.values(tokens)) {
      const lu = (t.lastUsedAtMs as number) || 0;
      if (lu > lastUsedAt) lastUsedAt = lu;
    }

    return {
      deviceId: ((d.deviceId as string) || "").substring(0, 12) + "...",
      displayName: d.displayName as string,
      platform: (d.platform as string) || "unknown",
      clientId: (d.clientId as string) || "unknown",
      clientMode: (d.clientMode as string) || "unknown",
      role: (d.role as string) || "unknown",
      roles: (d.roles as string[]) || [],
      lastUsedAt,
      createdAt: (d.createdAtMs as number) || 0,
    };
  });
}

async function getSkills(): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  // Workspace skills from lock.json
  const lockPath = join(
    OPENCLAW_HOME,
    "workspace",
    ".clawhub",
    "lock.json"
  );
  const lockData = await readJsonSafe<{
    skills?: Record<string, { version?: string; installedAt?: number }>;
  }>(lockPath, {});
  if (lockData.skills) {
    for (const [name, info] of Object.entries(lockData.skills)) {
      skills.push({
        name,
        source: "workspace",
        version: info.version,
        installedAt: info.installedAt,
      });
    }
  }

  // Also check workspace/skills directory for local skills
  const wsSkillsDir = join(getDefaultWorkspaceSync(), "skills");
  try {
    const entries = await readdir(wsSkillsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !skills.find((s) => s.name === e.name)) {
        skills.push({ name: e.name, source: "workspace" });
      }
    }
  } catch {
    // skills dir may not exist
  }

  // System skills
  try {
    const sysSkillsPath = await getSystemSkillsDir();
    const entries = await readdir(sysSkillsPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        skills.push({ name: e.name, source: "system" });
      }
    }
  } catch {
    // system skills dir may not exist
  }

  return skills;
}

async function getAllSessions(): Promise<SessionInfo[]> {
  const allSessions: SessionInfo[] = [];
  const agentsDir = join(OPENCLAW_HOME, "agents");

  try {
    const agents = await readdir(agentsDir, { withFileTypes: true });
    for (const agent of agents) {
      if (!agent.isDirectory()) continue;
      const sessionsPath = join(
        agentsDir,
        agent.name,
        "sessions",
        "sessions.json"
      );
      try {
        const raw = await readFile(sessionsPath, "utf-8");
        const data = JSON.parse(raw) as Record<
          string,
          Record<string, unknown>
        >;
        for (const [key, s] of Object.entries(data)) {
          allSessions.push({
            key,
            sessionId: (s.sessionId as string) || key,
            updatedAt: (s.updatedAt as number) || 0,
            inputTokens: (s.inputTokens as number) || 0,
            outputTokens: (s.outputTokens as number) || 0,
            totalTokens: (s.totalTokens as number) || 0,
            contextTokens: (s.contextTokens as number) || 0,
            origin:
              ((s.origin as Record<string, unknown>)?.label as string) ||
              undefined,
            agentId: agent.name,
          });
        }
      } catch {
        // sessions file may not exist
      }
    }
  } catch {
    // agents dir may not exist
  }

  allSessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return allSessions;
}

export async function GET() {
  try {
    const configPath = join(OPENCLAW_HOME, "openclaw.json");
    const config = await readJsonSafe<Record<string, unknown>>(
      configPath,
      {}
    );

    const [agents, channels, devices, skills, sessions] = await Promise.all([
      getAgents(config),
      getChannels(config),
      getDevices(),
      getSkills(),
      getAllSessions(),
    ]);

    // Extract safe config info (NO secrets)
    const gateway = (config.gateway || {}) as Record<string, unknown>;
    const meta = (config.meta || {}) as Record<string, unknown>;

    return NextResponse.json({
      agents,
      channels,
      devices,
      skills,
      sessions: sessions.slice(0, 100), // Limit to 100 most recent
      gateway: {
        port: gateway.port || 18789,
        mode: gateway.mode || "local",
        version: (meta.lastTouchedVersion as string) || "unknown",
      },
      models: extractModelAliases(config),
      stats: {
        totalAgents: agents.length,
        totalSessions: sessions.length,
        totalTokens: sessions.reduce((sum, s) => sum + s.totalTokens, 0),
        totalDevices: devices.length,
        totalSkills: skills.length,
        totalChannels: channels.length,
        cronJobs: 0, // Fetched separately via /api/cron
      },
    });
  } catch (err) {
    console.error("System API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function extractModelAliases(
  config: Record<string, unknown>
): { id: string; alias?: string }[] {
  const agents = (config.agents || {}) as Record<string, unknown>;
  const defaults = (agents.defaults || {}) as Record<string, unknown>;
  const models = (defaults.models || {}) as Record<
    string,
    { alias?: string }
  >;
  return Object.entries(models).map(([id, info]) => ({
    id,
    alias: info.alias,
  }));
}
