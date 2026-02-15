"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bot,
  MessageSquare,
  Zap,
  Clock,
  Cpu,
  FolderOpen,
  Globe,
  Users,
  Shield,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Copy,
  CheckCircle,
  AlertCircle,
  Hash,
  Layers,
  ArrowRight,
  Network,
  Plus,
  X,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { requestRestart } from "@/lib/restart-store";

/* ================================================================
   Types
   ================================================================ */

type Agent = {
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

type AgentsResponse = {
  agents: Agent[];
  owner: string | null;
  defaultModel: string;
  defaultFallbacks: string[];
};

/* ================================================================
   Helpers
   ================================================================ */

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatAgo(ms: number | null): string {
  if (!ms) return "Never";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function shortModel(m: string): string {
  const parts = m.split("/");
  return parts[parts.length - 1];
}

function channelIcon(ch: string): string {
  switch (ch) {
    case "telegram": return "✈️";
    case "whatsapp": return "💬";
    case "email": return "📧";
    case "discord": return "🎮";
    case "slack": return "💼";
    case "web": return "🌐";
    default: return "📡";
  }
}

function shortPath(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || parts[parts.length - 2] || p;
}

const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  active: { dot: "bg-emerald-400", text: "text-emerald-400" },
  idle: { dot: "bg-amber-400", text: "text-amber-400" },
  unknown: { dot: "bg-zinc-500", text: "text-muted-foreground" },
};

const AGENT_GRADIENTS = [
  "from-violet-600 to-violet-800",
  "from-emerald-600 to-emerald-800",
  "from-orange-600 to-orange-800",
  "from-blue-600 to-blue-800",
  "from-pink-600 to-pink-800",
  "from-cyan-600 to-cyan-800",
];

/* ================================================================
   Custom Nodes
   ================================================================ */

function GatewayNode({ data }: NodeProps) {
  const d = data as { agentCount: number; owner: string };
  return (
    <div className="flex flex-col items-center">
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="sub" className="!bg-transparent !border-0 !w-0 !h-0" />
      <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-violet-500/40 bg-gradient-to-br from-violet-900/80 to-violet-950/90 shadow-lg shadow-violet-500/20">
        <span className="text-3xl">🦞</span>
      </div>
      <div className="mt-2 text-center">
        <p className="text-[12px] font-bold text-foreground">Gateway</p>
        <p className="text-[10px] text-muted-foreground">
          {d.agentCount} agent{d.agentCount !== 1 ? "s" : ""}
          {d.owner ? ` · ${d.owner}` : ""}
        </p>
      </div>
    </div>
  );
}

function AgentNodeComponent({ data }: NodeProps) {
  const d = data as {
    agent: Agent;
    idx: number;
    selected: boolean;
    onClick: () => void;
  };
  const { agent, idx, selected } = d;
  const sc = STATUS_COLORS[agent.status] || STATUS_COLORS.unknown;

  return (
    <div
      onClick={() => d.onClick()}
      className={cn(
        "cursor-pointer rounded-xl border p-3 transition-all min-w-[180px] max-w-[210px]",
        selected
          ? "border-violet-500/50 bg-violet-950/60 shadow-lg shadow-violet-500/10"
          : "border-foreground/[0.08] bg-card hover:border-foreground/[0.15]"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-violet-500 !border-violet-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-blue-500 !border-blue-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} id="sub" className="!bg-cyan-500 !border-cyan-400 !w-2 !h-2" />
      <Handle type="target" position={Position.Top} id="parent" className="!bg-cyan-500 !border-cyan-400 !w-2 !h-2" />

      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-sm font-bold text-white",
            AGENT_GRADIENTS[idx % AGENT_GRADIENTS.length]
          )}
        >
          {agent.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-semibold text-foreground">
              {agent.name}
            </span>
            <span className={cn("h-2 w-2 rounded-full", sc.dot)} />
          </div>
          <p className="truncate text-[10px] text-muted-foreground">
            {shortModel(agent.model)}
          </p>
        </div>
      </div>

      {/* Badges */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
        {agent.isDefault && (
          <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-violet-300 font-medium">
            ◇ Default
          </span>
        )}
        {agent.channels.map((ch) => (
          <span key={ch} className="flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-sky-300">
            {channelIcon(ch)} {ch}
          </span>
        ))}
      </div>

      {/* Stats row */}
      <div className="mt-2 flex items-center gap-3 border-t border-foreground/[0.04] pt-2 text-[10px]">
        <span className="text-muted-foreground">Sessions <strong className="text-foreground/70">{agent.sessionCount}</strong></span>
        <span className="text-muted-foreground">Tokens <strong className="text-foreground/70">{formatTokens(agent.totalTokens)}</strong></span>
        <span className={cn("ml-auto font-medium", sc.text)}>
          {formatAgo(agent.lastActive)}
        </span>
      </div>
    </div>
  );
}

function ChannelNodeComponent({ data }: NodeProps) {
  const d = data as { channel: string; accountIds: string[] };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-950/50 px-3 py-2 min-w-[120px]">
      <Handle type="target" position={Position.Right} className="!bg-sky-500 !border-sky-400 !w-2 !h-2" />
      <span className="text-lg">{channelIcon(d.channel)}</span>
      <div>
        <p className="text-[11px] font-semibold text-sky-200 capitalize">
          {d.channel}
        </p>
        {d.accountIds.length > 0 && (
          <p className="text-[9px] text-sky-400/60">
            {d.accountIds.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

function WorkspaceNodeComponent({ data }: NodeProps) {
  const d = data as { path: string; agentNames: string[] };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-950/40 px-3 py-2 min-w-[120px]">
      <Handle type="target" position={Position.Left} className="!bg-amber-500 !border-amber-400 !w-2 !h-2" />
      <FolderOpen className="h-4 w-4 text-amber-400 shrink-0" />
      <div>
        <p className="text-[11px] font-semibold text-amber-200">
          {shortPath(d.path)}
        </p>
        <p className="text-[9px] text-amber-400/60">
          {d.agentNames.join(", ")}
        </p>
      </div>
    </div>
  );
}

const nodeTypes = {
  gateway: GatewayNode,
  agent: AgentNodeComponent,
  channel: ChannelNodeComponent,
  workspace: WorkspaceNodeComponent,
};

/* ================================================================
   Layout computation
   ================================================================ */

function buildGraph(
  data: AgentsResponse,
  selectedId: string | null,
  onSelectAgent: (id: string) => void
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const agents = data.agents;

  // Gather unique channels and workspaces
  const channelMap = new Map<string, string[]>(); // channel → account ids
  const workspaceMap = new Map<string, string[]>(); // workspace → agent names

  for (const a of agents) {
    for (const b of a.bindings) {
      const ch = b.split(" ")[0];
      const accMatch = b.match(/accountId=(\S+)/);
      const accId = accMatch ? accMatch[1] : a.id;
      if (!channelMap.has(ch)) channelMap.set(ch, []);
      channelMap.get(ch)!.push(accId);
    }
    if (!workspaceMap.has(a.workspace)) workspaceMap.set(a.workspace, []);
    workspaceMap.get(a.workspace)!.push(a.name);
  }

  // ── Classify agents ──
  const subagentIds = new Set(agents.flatMap((a) => a.subagents));
  const topLevelAgents = agents.filter((a) => !subagentIds.has(a.id));
  const subAgents = agents.filter((a) => subagentIds.has(a.id));

  // ── Dynamic layout ──
  // Center everything around (0, 0) so fitView works well.
  // Layers left→right: Channels → Gateway → Agents → Workspaces
  const AGENT_SPACING_Y = 160;
  const SUB_AGENT_OFFSET_X = 50;
  const SUB_AGENT_OFFSET_Y = 170;

  const GATEWAY_X = 0;
  const GATEWAY_Y = 0;
  const AGENT_X = 320;
  const CHANNEL_X = -350;
  const WORKSPACE_X = 650;

  // ── 1. Gateway node (center hub) ──
  nodes.push({
    id: "gateway",
    type: "gateway",
    position: { x: GATEWAY_X, y: GATEWAY_Y },
    data: { agentCount: agents.length, owner: data.owner || "" },
    draggable: true,
  });

  // ── 2. Top-level agents, spread vertically around gateway ──
  const topCount = topLevelAgents.length;
  const topStartY = GATEWAY_Y - ((topCount - 1) * AGENT_SPACING_Y) / 2;

  for (let i = 0; i < topLevelAgents.length; i++) {
    const agent = topLevelAgents[i];
    const idx = agents.indexOf(agent);
    const ay = topStartY + i * AGENT_SPACING_Y;

    nodes.push({
      id: `agent-${agent.id}`,
      type: "agent",
      position: { x: AGENT_X, y: ay },
      data: {
        agent,
        idx,
        selected: selectedId === agent.id,
        onClick: () => onSelectAgent(agent.id),
      },
      draggable: true,
    });

    // Gateway → Agent
    edges.push({
      id: `gw-${agent.id}`,
      source: "gateway",
      target: `agent-${agent.id}`,
      type: "default",
      animated: agent.status === "active",
      style: {
        stroke: agent.isDefault ? "#8b5cf6" : "var(--border)",
        strokeWidth: agent.isDefault ? 2.5 : 1.5,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: agent.isDefault ? "#8b5cf6" : "var(--border)",
        width: 18,
        height: 14,
      },
    });
  }

  // ── 3. Sub-agents: position below their parent ──
  for (const sub of subAgents) {
    const parent = agents.find((a) => a.subagents.includes(sub.id));
    const parentNode = nodes.find((n) => n.id === `agent-${parent?.id}`);
    const px = parentNode?.position.x ?? AGENT_X;
    const py = parentNode?.position.y ?? GATEWAY_Y;
    const idx = agents.indexOf(sub);
    // Offset right and down from parent
    const subIdx = parent?.subagents.indexOf(sub.id) ?? 0;

    nodes.push({
      id: `agent-${sub.id}`,
      type: "agent",
      position: {
        x: px + SUB_AGENT_OFFSET_X + subIdx * 30,
        y: py + SUB_AGENT_OFFSET_Y,
      },
      data: {
        agent: sub,
        idx,
        selected: selectedId === sub.id,
        onClick: () => onSelectAgent(sub.id),
      },
      draggable: true,
    });

    // Parent → Sub-agent (dashed "delegates" edge)
    if (parent) {
      edges.push({
        id: `sub-${parent.id}-${sub.id}`,
        source: `agent-${parent.id}`,
        target: `agent-${sub.id}`,
        sourceHandle: "sub",
        targetHandle: "parent",
        type: "default",
        animated: true,
        style: { stroke: "#06b6d4", strokeWidth: 1.5, strokeDasharray: "6 3" },
        label: "delegates",
        labelStyle: { fill: "#06b6d4", fontSize: 10 },
        labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#06b6d4",
          width: 14,
          height: 10,
        },
      });
    }

    // Also connect sub-agent to gateway (thin line)
    edges.push({
      id: `gw-${sub.id}`,
      source: "gateway",
      target: `agent-${sub.id}`,
      style: { stroke: "var(--border)", strokeWidth: 1, strokeDasharray: "4 4" },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--border)",
        width: 12,
        height: 8,
      },
    });
  }

  // ── 4. Channel nodes (left of gateway) ──
  const channels = Array.from(channelMap.entries());
  const chCount = channels.length;
  const chSpacing = Math.max(100, 180);
  const chStartY = GATEWAY_Y - ((chCount - 1) * chSpacing) / 2;

  channels.forEach(([ch, accountIds], i) => {
    const nodeId = `ch-${ch}`;
    nodes.push({
      id: nodeId,
      type: "channel",
      position: { x: CHANNEL_X, y: chStartY + i * chSpacing },
      data: { channel: ch, accountIds },
      draggable: true,
    });

    // Channel ← Agent (agent pushes to channel)
    // Connect the channel to ALL agents that use it
    for (const a of agents) {
      if (a.channels.includes(ch)) {
        edges.push({
          id: `ch-${ch}-${a.id}`,
          source: `agent-${a.id}`,
          target: nodeId,
          type: "default",
          style: { stroke: "#0ea5e9", strokeWidth: 1.5 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#0ea5e9",
            width: 14,
            height: 10,
          },
        });
      }
    }
  });

  // ── 5. Workspace nodes (right of agents) ──
  const workspaces = Array.from(workspaceMap.entries());
  const wsCount = workspaces.length;
  const wsSpacing = Math.max(100, 180);
  const wsStartY = GATEWAY_Y - ((wsCount - 1) * wsSpacing) / 2;

  workspaces.forEach(([ws, agentNames], i) => {
    const nodeId = `ws-${i}`;
    nodes.push({
      id: nodeId,
      type: "workspace",
      position: { x: WORKSPACE_X, y: wsStartY + i * wsSpacing },
      data: { path: ws, agentNames },
      draggable: true,
    });

    // Agent → Workspace
    for (const a of agents) {
      if (a.workspace === ws) {
        edges.push({
          id: `ws-${a.id}-${i}`,
          source: `agent-${a.id}`,
          target: nodeId,
          style: { stroke: "#d97706", strokeWidth: 1.5 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#d97706",
            width: 14,
            height: 10,
          },
        });
      }
    }
  });

  return { nodes, edges };
}

/* ================================================================
   Detail Panel
   ================================================================ */

function AgentDetail({
  agent,
  idx,
  allAgents,
}: {
  agent: Agent;
  idx: number;
  allAgents: Agent[];
}) {
  const sc = STATUS_COLORS[agent.status] || STATUS_COLORS.unknown;

  const parentAgents = useMemo(
    () => allAgents.filter((a) => a.subagents.includes(agent.id)),
    [agent.id, allAgents]
  );

  const childAgents = useMemo(
    () =>
      agent.subagents
        .map((sid) => allAgents.find((a) => a.id === sid))
        .filter(Boolean) as Agent[],
    [agent.subagents, allAgents]
  );

  const [showIdentity, setShowIdentity] = useState(false);

  return (
    <div className="rounded-xl border border-foreground/[0.06] bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br text-2xl font-bold text-white shadow-lg",
            AGENT_GRADIENTS[idx % AGENT_GRADIENTS.length]
          )}
        >
          {agent.emoji}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-foreground">{agent.name}</h2>
            <span className={cn("h-2.5 w-2.5 rounded-full", sc.dot)} />
            <span className={cn("text-[11px] font-medium", sc.text)}>
              {agent.status === "active" ? "Active" : agent.status === "idle" ? "Idle" : "Unknown"}
            </span>
            {agent.isDefault && (
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-400">
                <Shield className="mr-0.5 inline h-2.5 w-2.5" /> Default
              </span>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">
            ID: <code className="text-muted-foreground">{agent.id}</code> ·{" "}
            {formatAgo(agent.lastActive)}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat
          icon={<Cpu className="h-3.5 w-3.5 text-violet-400" />}
          label="Model"
          value={shortModel(agent.model)}
        />
        <MiniStat
          icon={<MessageSquare className="h-3.5 w-3.5 text-blue-400" />}
          label="Sessions"
          value={String(agent.sessionCount)}
        />
        <MiniStat
          icon={<Zap className="h-3.5 w-3.5 text-amber-400" />}
          label="Tokens"
          value={formatTokens(agent.totalTokens)}
        />
        <MiniStat
          icon={<Clock className="h-3.5 w-3.5 text-emerald-400" />}
          label="Last Active"
          value={formatAgo(agent.lastActive)}
        />
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Model Stack */}
        <div className="rounded-lg border border-foreground/[0.06] bg-card/80 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70">
            <Layers className="h-3.5 w-3.5 text-violet-400" /> Model Stack
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-bold text-violet-400">PRIMARY</span>
              <code className="text-[11px] text-foreground/70">{shortModel(agent.model)}</code>
            </div>
            {agent.fallbackModels.map((fm, i) => (
              <div key={fm} className="flex items-center gap-1.5 pl-1">
                <span className="text-[9px] text-muted-foreground/60">#{i + 1}</span>
                <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40" />
                <code className="text-[11px] text-muted-foreground">{shortModel(fm)}</code>
              </div>
            ))}
          </div>
        </div>

        {/* Channels */}
        <div className="rounded-lg border border-foreground/[0.06] bg-card/80 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70">
            <Globe className="h-3.5 w-3.5 text-blue-400" /> Channels & Bindings
          </div>
          {agent.bindings.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/60">No bindings</p>
          ) : (
            <div className="space-y-1">
              {agent.bindings.map((b, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded bg-foreground/[0.03] px-2 py-1">
                  <span className="text-sm">{channelIcon(b.split(" ")[0])}</span>
                  <code className="text-[10px] text-foreground/70">{b}</code>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Workspace */}
        <div className="rounded-lg border border-foreground/[0.06] bg-card/80 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70">
            <FolderOpen className="h-3.5 w-3.5 text-amber-400" /> Workspace
          </div>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 truncate text-[10px] text-muted-foreground">{agent.workspace}</code>
            <CopyBtn text={agent.workspace} />
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            Agent dir: <code className="text-muted-foreground">{agent.agentDir}</code>
          </p>
        </div>

        {/* Relationships */}
        <div className="rounded-lg border border-foreground/[0.06] bg-card/80 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70">
            <Network className="h-3.5 w-3.5 text-cyan-400" /> Relationships
          </div>
          {parentAgents.length === 0 && childAgents.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/60">No sub-agent relationships</p>
          ) : (
            <div className="space-y-1.5">
              {parentAgents.length > 0 && (
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">Reports to</p>
                  {parentAgents.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1 rounded bg-foreground/[0.03] px-2 py-0.5 text-[10px] text-foreground/70 mr-1">
                      {p.emoji} {p.name}
                    </span>
                  ))}
                </div>
              )}
              {childAgents.length > 0 && (
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">Delegates to</p>
                  {childAgents.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1 rounded bg-foreground/[0.03] px-2 py-0.5 text-[10px] text-foreground/70 mr-1">
                      {c.emoji} {c.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Identity */}
      {agent.identitySnippet && (
        <div className="rounded-lg border border-foreground/[0.06] bg-card/80">
          <button
            type="button"
            onClick={() => setShowIdentity(!showIdentity)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
          >
            <Bot className="h-3.5 w-3.5 text-pink-400" />
            <span className="flex-1 text-[11px] font-semibold text-foreground/70">
              Identity
            </span>
            {showIdentity ? (
              <ChevronUp className="h-3 w-3 text-muted-foreground/60" />
            ) : (
              <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
            )}
          </button>
          {showIdentity && (
            <div className="border-t border-foreground/[0.04] px-3 py-2">
              <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">
                {agent.identitySnippet}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-foreground/[0.06] bg-card/80 px-3 py-2">
      {icon}
      <div>
        <p className="text-[9px] text-muted-foreground/60">{label}</p>
        <p className="text-[12px] font-semibold text-foreground/90">{value}</p>
      </div>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded bg-foreground/5 p-1 text-muted-foreground/60 hover:text-muted-foreground"
    >
      {copied ? <CheckCircle className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/* ================================================================
   Summary Bar
   ================================================================ */

function SummaryBar({ agents }: { agents: Agent[] }) {
  const totalSessions = agents.reduce((s, a) => s + a.sessionCount, 0);
  const totalTokens = agents.reduce((s, a) => s + a.totalTokens, 0);
  const activeCount = agents.filter((a) => a.status === "active").length;
  const channelSet = new Set(agents.flatMap((a) => a.channels));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { icon: <Users className="h-4 w-4 text-violet-400" />, label: "Agents", value: String(agents.length) },
        { icon: <Zap className="h-4 w-4 text-emerald-400" />, label: "Active", value: `${activeCount} / ${agents.length}` },
        { icon: <MessageSquare className="h-4 w-4 text-blue-400" />, label: "Sessions", value: String(totalSessions) },
        { icon: <Hash className="h-4 w-4 text-amber-400" />, label: "Channels", value: String(channelSet.size) },
      ].map((s) => (
        <div key={s.label} className="flex items-center gap-3 rounded-xl border border-foreground/[0.06] bg-card px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.04]">
            {s.icon}
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground/60">{s.label}</p>
            <p className="text-sm font-bold text-foreground/90">{s.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ================================================================
   Grid View (card-based, no React Flow)
   ================================================================ */

function GridView({
  agents,
  selectedId,
  onSelect,
}: {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent, idx) => {
        const sc = STATUS_COLORS[agent.status] || STATUS_COLORS.unknown;
        const selected = selectedId === agent.id;

        return (
          <button
            type="button"
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className={cn(
              "relative rounded-xl border p-4 text-left transition-all",
              selected
                ? "border-violet-500/40 bg-violet-500/[0.06] shadow-lg shadow-violet-500/5"
                : "border-foreground/[0.06] bg-card hover:border-foreground/[0.12]"
            )}
          >
            <div className="absolute -right-1 -top-1">
              <span className="relative flex h-3 w-3">
                {agent.status === "active" && (
                  <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-40", sc.dot)} />
                )}
                <span className={cn("relative inline-flex h-3 w-3 rounded-full ring-2", sc.dot, `ring-${agent.status === "active" ? "emerald" : agent.status === "idle" ? "amber" : "zinc"}-400/30`)} />
              </span>
            </div>
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br text-lg text-white",
                  AGENT_GRADIENTS[idx % AGENT_GRADIENTS.length]
                )}
              >
                {agent.emoji}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[13px] font-semibold text-foreground">{agent.name}</h3>
                <p className="truncate text-[10px] text-muted-foreground">{shortModel(agent.model)}</p>
                {agent.isDefault && (
                  <span className="mt-1 inline-block rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] font-medium text-violet-400">Default</span>
                )}
              </div>
            </div>
            {agent.channels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {agent.channels.map((ch) => (
                  <span key={ch} className="rounded border border-foreground/[0.06] bg-foreground/[0.03] px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    {channelIcon(ch)} {ch}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded bg-foreground/[0.03] py-1">
                <p className="text-[9px] text-muted-foreground/60">Sess.</p>
                <p className="text-[11px] font-semibold text-foreground/70">{agent.sessionCount}</p>
              </div>
              <div className="rounded bg-foreground/[0.03] py-1">
                <p className="text-[9px] text-muted-foreground/60">Tokens</p>
                <p className="text-[11px] font-semibold text-foreground/70">{formatTokens(agent.totalTokens)}</p>
              </div>
              <div className="rounded bg-foreground/[0.03] py-1">
                <p className="text-[9px] text-muted-foreground/60">Active</p>
                <p className={cn("text-[11px] font-semibold", sc.text)}>{formatAgo(agent.lastActive)}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ================================================================
   Flow View
   ================================================================ */

function FlowViewInner({
  data,
  selectedId,
  onSelect,
}: {
  data: AgentsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { fitView } = useReactFlow();

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildGraph(data, selectedId, onSelect),
    [data, selectedId, onSelect]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update when data or selection changes
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = buildGraph(data, selectedId, onSelect);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [data, selectedId, onSelect, setNodes, setEdges]);

  // Re-fit whenever nodes change (after React Flow has measured them)
  const onNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
    },
    [onNodesChange]
  );

  // Use onNodesInitialized to fit after nodes are measured
  const handleNodesInitialized = useCallback(() => {
    fitView({ padding: 0.15, duration: 250 });
  }, [fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChangeWrapped}
      onEdgesChange={onEdgesChange}
      onInit={() => {
        // Fit after init with staggered attempts
        setTimeout(() => fitView({ padding: 0.15 }), 0);
        setTimeout(() => fitView({ padding: 0.15, duration: 200 }), 300);
      }}
      onNodeMouseEnter={undefined}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.1}
      maxZoom={2}
      defaultEdgeOptions={{ type: "default" }}
    >
      <Background className="!bg-card dark:!bg-[#08080c]" color="var(--border)" gap={20} size={1} />
      <Controls
        showInteractive={false}
        className="!bg-card dark:!bg-zinc-900 !border-border !shadow-xl [&>button]:!bg-secondary dark:[&>button]:!bg-zinc-800 [&>button]:!border-border [&>button]:!text-muted-foreground [&>button:hover]:!bg-accent dark:[&>button:hover]:!bg-zinc-700"
      />
    </ReactFlow>
  );
}

function FlowView({
  data,
  selectedId,
  onSelect,
}: {
  data: AgentsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  // Measure the container with ResizeObserver for a concrete pixel size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDims({ w: width, h: height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-0 flex-1 w-full border-t border-border overflow-hidden bg-card dark:bg-[#08080c]"
    >
      {dims ? (
        <div style={{ width: dims.w, height: dims.h, position: "absolute", inset: 0 }}>
          <ReactFlowProvider>
            <FlowViewInner data={data} selectedId={selectedId} onSelect={onSelect} />
          </ReactFlowProvider>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground/40">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Add Agent Modal
   ================================================================ */

type AvailableModel = {
  key: string;
  name: string;
  available: boolean;
  local: boolean;
  contextWindow: number;
};

const CHANNEL_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp", icon: "💬", hint: "Phone number or account label" },
  { value: "telegram", label: "Telegram", icon: "✈️", hint: "Bot username or account ID" },
  { value: "discord", label: "Discord", icon: "🎮", hint: "Server or account ID" },
  { value: "slack", label: "Slack", icon: "💼", hint: "Workspace or channel" },
  { value: "imessage", label: "iMessage", icon: "🍎", hint: "Apple ID or phone" },
  { value: "mattermost", label: "Mattermost", icon: "📡", hint: "Team or channel" },
  { value: "web", label: "Web / API", icon: "🌐", hint: "Session label" },
];

function AddAgentModal({
  onClose,
  onCreated,
  defaultModel,
}: {
  onClose: () => void;
  onCreated: () => void;
  defaultModel: string;
}) {
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [bindings, setBindings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // ── Fetch available models ──
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/models?scope=all");
        const data = await res.json();
        const all = (data.models || []) as AvailableModel[];
        // Only show available (authenticated) models, sorted by name
        const avail = all
          .filter((m) => m.available || m.local)
          .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));
        setModels(avail);
      } catch { /* ignore */ }
      setModelsLoading(false);
    })();
  }, []);

  // ── Channel binding wizard state ──
  const [bindChannel, setBindChannel] = useState<string | null>(null);
  const [bindAccountId, setBindAccountId] = useState("");

  useEffect(() => { nameRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, busy]);

  const addBinding = useCallback(() => {
    if (!bindChannel) return;
    const binding = bindAccountId.trim()
      ? `${bindChannel}:${bindAccountId.trim()}`
      : bindChannel;
    if (!bindings.includes(binding)) {
      setBindings((prev) => [...prev, binding]);
    }
    setBindChannel(null);
    setBindAccountId("");
  }, [bindChannel, bindAccountId, bindings]);

  const removeBinding = useCallback((b: string) => {
    setBindings((prev) => prev.filter((x) => x !== b));
  }, []);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      setError("Agent name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: name.trim(),
          model: model || undefined,
          workspace: workspace.trim() || undefined,
          bindings: bindings.length > 0 ? bindings : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || `Failed (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      setSuccess(true);
      requestRestart("New agent was added — restart to pick up changes.");
      setTimeout(() => {
        onCreated();
        onClose();
      }, 1500);
    } catch (err) {
      setError(String(err));
    }
    setBusy(false);
  }, [name, model, workspace, bindings, onCreated, onClose]);

  const selectedChannelMeta = CHANNEL_OPTIONS.find((c) => c.value === bindChannel);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] sm:pt-[8vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!busy) onClose(); }} />

      <div className="relative z-10 mx-3 flex max-h-[88vh] w-full max-w-[min(30rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card/95 shadow-2xl sm:mx-4 sm:max-h-[80vh]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-foreground/[0.06] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15">
              <Sparkles className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Create New Agent</h2>
              <p className="text-[10px] text-muted-foreground">Isolated workspace, sessions & auth</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-muted-foreground/60 hover:text-foreground/70 disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable form */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* ── 1. Name (required) ── */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-foreground/70">
              Agent Name <span className="text-red-400">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              placeholder="e.g. work, research, creative"
              className="w-full rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2.5 text-[13px] text-foreground/90 placeholder:text-muted-foreground/40 focus:border-violet-500/30 focus:outline-none"
              disabled={busy}
            />
            <p className="mt-1 text-[10px] text-muted-foreground/50">
              Unique ID used throughout OpenClaw — auto-formatted to lowercase
            </p>
          </div>

          {/* ── 2. Model (select) ── */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-foreground/70">
              Model
            </label>
            {modelsLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2.5 text-[12px] text-muted-foreground/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading available models...
              </div>
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={busy}
                className="w-full appearance-none rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2.5 text-[13px] text-foreground/90 focus:border-violet-500/30 focus:outline-none disabled:opacity-40"
              >
                <option value="">Use default ({defaultModel.split("/").pop() || defaultModel})</option>
                {models.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name || m.key.split("/").pop()} — {m.key.split("/")[0]}{m.local ? " (local)" : ""}
                  </option>
                ))}
              </select>
            )}
            {!modelsLoading && models.length === 0 && (
              <p className="mt-1.5 text-[10px] text-amber-400">
                No authenticated models found.{" "}
                <a href="/?section=models" className="underline hover:text-amber-300">
                  Go to Models
                </a>{" "}
                to connect a provider.
              </p>
            )}
            {!modelsLoading && models.length > 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground/50">
                Showing {models.length} authenticated models.{" "}
                <a href="/?section=models" className="text-violet-400 hover:text-violet-300">
                  Add more providers →
                </a>
              </p>
            )}
          </div>

          {/* ── 3. Channel Bindings (wizard) ── */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-foreground/70">
              Channel Bindings
              <span className="ml-1 text-[10px] font-normal text-muted-foreground/40">optional</span>
            </label>

            {/* Existing bindings chips */}
            {bindings.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {bindings.map((b) => {
                  const chKey = b.split(":")[0];
                  const chMeta = CHANNEL_OPTIONS.find((c) => c.value === chKey);
                  return (
                    <span key={b} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-2.5 py-1 text-[11px] text-violet-400">
                      <span>{chMeta?.icon || "📡"}</span>
                      <span className="font-medium">{b}</span>
                      <button type="button" onClick={() => removeBinding(b)} className="ml-0.5 rounded text-violet-400/60 hover:text-violet-200" disabled={busy}>
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Channel binding wizard */}
            {bindChannel === null ? (
              /* Step 1: Pick a channel */
              <div>
                <p className="mb-2 text-[10px] text-muted-foreground/60">
                  Route messages from a channel to this agent:
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {CHANNEL_OPTIONS.map((ch) => (
                    <button
                      key={ch.value}
                      type="button"
                      onClick={() => setBindChannel(ch.value)}
                      disabled={busy}
                      className="flex items-center gap-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2 text-left text-[11px] text-foreground/70 transition-colors hover:border-violet-500/20 hover:bg-violet-500/[0.05] hover:text-violet-400 disabled:opacity-40"
                    >
                      <span className="text-base">{ch.icon}</span>
                      <span className="font-medium">{ch.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Step 2: Enter account ID */
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{selectedChannelMeta?.icon}</span>
                    <span className="text-[12px] font-semibold text-foreground/80">{selectedChannelMeta?.label}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setBindChannel(null); setBindAccountId(""); }}
                    className="rounded p-0.5 text-muted-foreground/40 hover:text-foreground/70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={bindAccountId}
                    onChange={(e) => setBindAccountId(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBinding(); } }}
                    placeholder={selectedChannelMeta?.hint || "Account ID (optional)"}
                    className="flex-1 rounded-lg border border-foreground/[0.08] bg-card px-3 py-2 text-[12px] text-foreground/90 placeholder:text-muted-foreground/40 focus:border-violet-500/30 focus:outline-none"
                    autoFocus
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={addBinding}
                    disabled={busy}
                    className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground/50">
                  Leave empty to bind all {selectedChannelMeta?.label} messages, or enter an account ID for specific routing.
                </p>
              </div>
            )}
          </div>

          {/* ── 4. Advanced (collapsible) ── */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 transition-colors hover:text-foreground/60"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-180")} />
              Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-2.5">
                <label className="mb-1 block text-[10px] font-medium text-muted-foreground/60">
                  Custom Workspace Path
                </label>
                <input
                  type="text"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder={`~/.openclaw/workspace-${name || "<name>"}`}
                  className="w-full rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2 text-[12px] font-mono text-foreground/80 placeholder:text-muted-foreground/40 focus:border-violet-500/30 focus:outline-none"
                  disabled={busy}
                />
                <p className="mt-1 text-[10px] text-muted-foreground/40">
                  Defaults to <code>~/.openclaw/workspace-{name || "<name>"}</code>
                </p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-[12px] text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-[12px] text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              Agent &ldquo;{name}&rdquo; created successfully!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-foreground/[0.06] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-foreground/[0.08] px-4 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !name.trim() || success}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Creating...
              </>
            ) : success ? (
              <>
                <CheckCircle className="h-3.5 w-3.5" />
                Done!
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Create Agent
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Edit Agent Modal
   ================================================================ */

function EditAgentModal({
  agent,
  idx,
  allAgents,
  defaultModel,
  defaultFallbacks,
  onClose,
  onSaved,
}: {
  agent: Agent;
  idx: number;
  allAgents: Agent[];
  defaultModel: string;
  defaultFallbacks: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  /* ── derive initial bindings in channel:accountId format ── */
  const initialBindings = useMemo(
    () =>
      agent.bindings.map((b) => {
        const ch = b.split(" ")[0];
        const accMatch = b.match(/accountId=(\S+)/);
        return accMatch ? `${ch}:${accMatch[1]}` : ch;
      }),
    [agent.bindings]
  );

  const [model, setModel] = useState(agent.model);
  const [fallbacks, setFallbacks] = useState<string[]>(agent.fallbackModels);
  const [subagents, setSubagents] = useState<string[]>(agent.subagents);
  const [bindings, setBindings] = useState<string[]>(initialBindings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  /* ── Fetch available models ── */
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/models?scope=all");
        const data = await res.json();
        const all = (data.models || []) as AvailableModel[];
        const avail = all
          .filter((m) => m.available || m.local)
          .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));
        setModels(avail);
      } catch {
        /* ignore */
      }
      setModelsLoading(false);
    })();
  }, []);

  /* ── Channel binding wizard state ── */
  const [bindChannel, setBindChannel] = useState<string | null>(null);
  const [bindAccountId, setBindAccountId] = useState("");

  /* ── Keyboard ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, busy]);

  const addBinding = useCallback(() => {
    if (!bindChannel) return;
    const binding = bindAccountId.trim()
      ? `${bindChannel}:${bindAccountId.trim()}`
      : bindChannel;
    if (!bindings.includes(binding)) {
      setBindings((prev) => [...prev, binding]);
    }
    setBindChannel(null);
    setBindAccountId("");
  }, [bindChannel, bindAccountId, bindings]);

  const removeBinding = useCallback((b: string) => {
    setBindings((prev) => prev.filter((x) => x !== b));
  }, []);

  const toggleFallback = useCallback((modelKey: string) => {
    setFallbacks((prev) =>
      prev.includes(modelKey)
        ? prev.filter((f) => f !== modelKey)
        : [...prev, modelKey]
    );
  }, []);

  const toggleSubagent = useCallback((agentId: string) => {
    setSubagents((prev) =>
      prev.includes(agentId)
        ? prev.filter((s) => s !== agentId)
        : [...prev, agentId]
    );
  }, []);

  /* ── Save ── */
  const handleSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: agent.id,
          model: model || null,
          fallbacks: fallbacks.length > 0 ? fallbacks : [],
          subagents,
          bindings,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || `Failed (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      setSuccess(true);
      requestRestart("Agent settings updated — restart to pick up changes.");
      setTimeout(() => {
        onSaved();
        onClose();
      }, 1200);
    } catch (err) {
      setError(String(err));
    }
    setBusy(false);
  }, [agent.id, model, fallbacks, subagents, bindings, onSaved, onClose]);

  const sc = STATUS_COLORS[agent.status] || STATUS_COLORS.unknown;
  const selectedChannelMeta = CHANNEL_OPTIONS.find(
    (c) => c.value === bindChannel
  );
  const otherAgents = allAgents.filter((a) => a.id !== agent.id);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] sm:pt-[8vh]">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => {
          if (!busy) onClose();
        }}
      />

      <div className="relative z-10 mx-3 flex max-h-[88vh] w-full max-w-[min(34rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-foreground/[0.08] bg-card/95 shadow-2xl sm:mx-4 sm:max-h-[80vh]">
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-foreground/[0.06] px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-lg font-bold text-white shadow",
                AGENT_GRADIENTS[idx % AGENT_GRADIENTS.length]
              )}
            >
              {agent.emoji}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-foreground">
                  {agent.name}
                </h2>
                <span className={cn("h-2 w-2 rounded-full", sc.dot)} />
                <span className={cn("text-[10px] font-medium", sc.text)}>
                  {agent.status === "active"
                    ? "Active"
                    : agent.status === "idle"
                      ? "Idle"
                      : "Unknown"}
                </span>
                {agent.isDefault && (
                  <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] font-medium text-violet-400">
                    Default
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {agent.id} · {formatAgo(agent.lastActive)} ·{" "}
                {agent.sessionCount} sessions · {formatTokens(agent.totalTokens)}{" "}
                tokens
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-muted-foreground/60 hover:text-foreground/70 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Scrollable form ── */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 1. Primary Model */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70">
              <Cpu className="h-3 w-3 text-violet-400" /> Primary Model
            </label>
            {modelsLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2.5 text-[12px] text-muted-foreground/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading models…
              </div>
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={busy}
                className="w-full appearance-none rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2.5 text-[13px] text-foreground/90 focus:border-violet-500/30 focus:outline-none disabled:opacity-40"
              >
                <option value="">
                  Use default ({shortModel(defaultModel)})
                </option>
                {models.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name || m.key.split("/").pop()} —{" "}
                    {m.key.split("/")[0]}
                    {m.local ? " (local)" : ""}
                  </option>
                ))}
              </select>
            )}
            {!modelsLoading && models.length > 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground/50">
                {models.length} authenticated models.{" "}
                <a
                  href="/?section=models"
                  className="text-violet-400 hover:text-violet-300"
                >
                  Manage providers →
                </a>
              </p>
            )}
          </div>

          {/* 2. Fallback Models (multi-select checkboxes) */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70">
              <Layers className="h-3 w-3 text-violet-400" /> Fallback Models
              <span className="text-[10px] font-normal text-muted-foreground/40">
                — priority order
              </span>
            </label>
            {modelsLoading ? (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : models.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/50">
                No authenticated models available
              </p>
            ) : (
              <div className="max-h-[150px] space-y-0.5 overflow-y-auto rounded-lg border border-foreground/[0.06] p-1.5">
                {models
                  .filter((m) => m.key !== model)
                  .map((m) => {
                    const checked = fallbacks.includes(m.key);
                    const order = checked
                      ? fallbacks.indexOf(m.key) + 1
                      : null;
                    return (
                      <label
                        key={m.key}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors",
                          checked
                            ? "bg-violet-500/[0.08] text-violet-300"
                            : "text-muted-foreground hover:bg-foreground/[0.03]"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFallback(m.key)}
                          disabled={busy}
                          className="sr-only"
                        />
                        <div
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold",
                            checked
                              ? "border-violet-500/50 bg-violet-500/20 text-violet-300"
                              : "border-foreground/[0.1] bg-foreground/[0.02]"
                          )}
                        >
                          {order ?? ""}
                        </div>
                        <span className="flex-1 truncate">
                          {m.name || shortModel(m.key)}
                        </span>
                        <span className="text-[9px] text-muted-foreground/40">
                          {m.key.split("/")[0]}
                        </span>
                      </label>
                    );
                  })}
              </div>
            )}
            {fallbacks.length > 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground/50">
                {fallbacks.length} fallback{fallbacks.length !== 1 && "s"}{" "}
                selected — numbered in priority order
              </p>
            )}
          </div>

          {/* 3. Sub-Agents (multi-select checkboxes) */}
          {otherAgents.length > 0 && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70">
                <Network className="h-3 w-3 text-cyan-400" /> Sub-Agents
                <span className="text-[10px] font-normal text-muted-foreground/40">
                  — can delegate tasks to
                </span>
              </label>
              <div className="space-y-0.5 rounded-lg border border-foreground/[0.06] p-1.5">
                {otherAgents.map((a) => {
                  const checked = subagents.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11px] transition-colors",
                        checked
                          ? "bg-cyan-500/[0.08] text-cyan-300"
                          : "text-muted-foreground hover:bg-foreground/[0.03]"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSubagent(a.id)}
                        disabled={busy}
                        className="sr-only"
                      />
                      <div
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-cyan-500/50 bg-cyan-500/20"
                            : "border-foreground/[0.1] bg-foreground/[0.02]"
                        )}
                      >
                        {checked && (
                          <CheckCircle className="h-2.5 w-2.5 text-cyan-400" />
                        )}
                      </div>
                      <span className="text-sm">{a.emoji}</span>
                      <span className="flex-1 truncate font-medium">
                        {a.name}
                      </span>
                      <span className="text-[9px] text-muted-foreground/40">
                        {shortModel(a.model)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Channel Bindings */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70">
              <Globe className="h-3 w-3 text-blue-400" /> Channel Bindings
            </label>

            {/* Existing binding chips */}
            {bindings.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {bindings.map((b) => {
                  const chKey = b.split(":")[0];
                  const chMeta = CHANNEL_OPTIONS.find(
                    (c) => c.value === chKey
                  );
                  return (
                    <span
                      key={b}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-2.5 py-1 text-[11px] text-blue-400"
                    >
                      <span>{chMeta?.icon || "📡"}</span>
                      <span className="font-medium">{b}</span>
                      <button
                        type="button"
                        onClick={() => removeBinding(b)}
                        className="ml-0.5 rounded text-blue-400/60 hover:text-blue-200"
                        disabled={busy}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Channel wizard */}
            {bindChannel === null ? (
              <div>
                <p className="mb-2 text-[10px] text-muted-foreground/60">
                  Route messages from a channel to this agent:
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {CHANNEL_OPTIONS.map((ch) => (
                    <button
                      key={ch.value}
                      type="button"
                      onClick={() => setBindChannel(ch.value)}
                      disabled={busy}
                      className="flex items-center gap-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2 text-left text-[11px] text-foreground/70 transition-colors hover:border-blue-500/20 hover:bg-blue-500/[0.05] hover:text-blue-400 disabled:opacity-40"
                    >
                      <span className="text-base">{ch.icon}</span>
                      <span className="font-medium">{ch.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">
                      {selectedChannelMeta?.icon}
                    </span>
                    <span className="text-[12px] font-semibold text-foreground/80">
                      {selectedChannelMeta?.label}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBindChannel(null);
                      setBindAccountId("");
                    }}
                    className="rounded p-0.5 text-muted-foreground/40 hover:text-foreground/70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={bindAccountId}
                    onChange={(e) => setBindAccountId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addBinding();
                      }
                    }}
                    placeholder={
                      selectedChannelMeta?.hint || "Account ID (optional)"
                    }
                    className="flex-1 rounded-lg border border-foreground/[0.08] bg-card px-3 py-2 text-[12px] text-foreground/90 placeholder:text-muted-foreground/40 focus:border-blue-500/30 focus:outline-none"
                    autoFocus
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={addBinding}
                    disabled={busy}
                    className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground/50">
                  Leave empty for all {selectedChannelMeta?.label} messages, or
                  enter an account ID for specific routing.
                </p>
              </div>
            )}
          </div>

          {/* Workspace (read-only) */}
          <div className="rounded-lg border border-foreground/[0.04] bg-foreground/[0.02] px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <FolderOpen className="h-3 w-3 text-amber-400/60" /> Workspace
            </div>
            <code className="mt-0.5 block truncate text-[11px] text-foreground/60">
              {agent.workspace}
            </code>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-[12px] text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-[12px] text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              Settings saved! Restarting gateway to apply…
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-foreground/[0.06] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-foreground/[0.08] px-4 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || success}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : success ? (
              <>
                <CheckCircle className="h-3.5 w-3.5" />
                Saved!
              </>
            ) : (
              <>
                <CheckCircle className="h-3.5 w-3.5" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Main Export
   ================================================================ */

export function AgentsView() {
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [view, setView] = useState<"flow" | "grid">("flow");
  const [showAddModal, setShowAddModal] = useState(false);

  const handleAgentClick = useCallback((id: string) => {
    setSelectedId(id);
    setEditingAgentId(id);
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      if (!selectedId && json.agents.length > 0) {
        const def = json.agents.find((a: Agent) => a.isDefault);
        setSelectedId(def?.id || json.agents[0].id);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const selectedAgent = useMemo(
    () => data?.agents.find((a) => a.id === selectedId) || null,
    [data, selectedId]
  );

  const selectedIdx = useMemo(
    () => data?.agents.findIndex((a) => a.id === selectedId) ?? 0,
    [data, selectedId]
  );

  const editingAgent = useMemo(
    () => data?.agents.find((a) => a.id === editingAgentId) || null,
    [data, editingAgentId]
  );

  const editingIdx = useMemo(
    () => data?.agents.findIndex((a) => a.id === editingAgentId) ?? 0,
    [data, editingAgentId]
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm">Failed to load agents</p>
        <p className="text-xs text-muted-foreground/60">{error}</p>
        <button type="button" onClick={fetchAgents} className="rounded-lg bg-foreground/5 px-3 py-1.5 text-xs text-foreground/70 hover:bg-foreground/10">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-foreground/[0.06] px-4 md:px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10">
            <Users className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Agents</h1>
            <p className="text-xs text-muted-foreground/60">
              {data.agents.length} agent{data.agents.length !== 1 && "s"} configured
            </p>
          </div>
          </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-1.5 text-[11px] font-medium text-violet-400 transition-colors hover:bg-violet-500/20"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Add Agent</span>
          </button>
          <div className="flex rounded-lg border border-foreground/[0.06] bg-card">
            <button
              type="button"
              onClick={() => setView("flow")}
              className={cn(
                "rounded-l-lg px-3 py-1.5 text-[11px] font-medium transition",
                view === "flow"
                  ? "bg-violet-500/15 text-violet-400"
                  : "text-muted-foreground hover:text-foreground/70"
              )}
            >
              Org Chart
            </button>
            <button
              type="button"
              onClick={() => setView("grid")}
              className={cn(
                "rounded-r-lg px-3 py-1.5 text-[11px] font-medium transition",
                view === "grid"
                  ? "bg-violet-500/15 text-violet-400"
                  : "text-muted-foreground hover:text-foreground/70"
              )}
            >
              Grid
            </button>
          </div>
          <button type="button" onClick={fetchAgents} className="rounded-lg border border-foreground/[0.06] bg-card p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground/70">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Flow view: full width, full remaining height */}
      {view === "flow" && (
        <FlowView
          data={data}
          selectedId={selectedId}
          onSelect={handleAgentClick}
        />
      )}

      {/* Grid view + detail: scrollable with max-width */}
      {view === "grid" && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl space-y-5 px-4 md:px-6 py-6">
            <SummaryBar agents={data.agents} />
            <GridView
              agents={data.agents}
              selectedId={selectedId}
              onSelect={handleAgentClick}
            />
            {selectedAgent && (
              <AgentDetail
                agent={selectedAgent}
                idx={selectedIdx}
                allAgents={data.agents}
              />
            )}
          </div>
        </div>
      )}

      {/* Add Agent Modal */}
      {showAddModal && (
        <AddAgentModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setLoading(true);
            fetchAgents();
          }}
          defaultModel={data.defaultModel}
        />
      )}

      {/* Edit Agent Modal */}
      {editingAgent && (
        <EditAgentModal
          agent={editingAgent}
          idx={editingIdx}
          allAgents={data.agents}
          defaultModel={data.defaultModel}
          defaultFallbacks={data.defaultFallbacks}
          onClose={() => setEditingAgentId(null)}
          onSaved={() => {
            setLoading(true);
            fetchAgents();
          }}
        />
      )}
    </div>
  );
}
