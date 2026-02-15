"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
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
  Search,
  Key,
  ShieldCheck,
  Star,
  ExternalLink,
  Eye,
  EyeOff,
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
      <Handle type="source" position={Position.Right} className="!bg-sky-500 !border-sky-400 !w-2 !h-2" />
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

    // Channel → Agent (channel sends messages into the agent)
    for (const a of agents) {
      if (a.channels.includes(ch)) {
        edges.push({
          id: `ch-${ch}-${a.id}`,
          source: nodeId,
          target: `agent-${a.id}`,
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
  const _totalTokens = agents.reduce((s, a) => s + a.totalTokens, 0);
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

type AuthProviderInfo = {
  provider: string;
  authenticated: boolean;
  authKind: string | null;
};

/* ── Provider metadata for display ── */

const PROVIDER_META: Record<string, { label: string; icon: string; color: string; keyUrl?: string; keyHint: string }> = {
  anthropic: { label: "Anthropic", icon: "🟣", color: "violet", keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-..." },
  openai: { label: "OpenAI", icon: "🟢", color: "emerald", keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-..." },
  google: { label: "Google", icon: "🔵", color: "blue", keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza..." },
  openrouter: { label: "OpenRouter", icon: "🟠", color: "orange", keyUrl: "https://openrouter.ai/keys", keyHint: "sk-or-..." },
  minimax: { label: "MiniMax", icon: "🟡", color: "yellow", keyUrl: "https://platform.minimaxi.com/", keyHint: "eyJ..." },
  groq: { label: "Groq", icon: "⚡", color: "cyan", keyUrl: "https://console.groq.com/keys", keyHint: "gsk_..." },
  xai: { label: "xAI", icon: "𝕏", color: "zinc", keyUrl: "https://console.x.ai/", keyHint: "xai-..." },
  mistral: { label: "Mistral", icon: "🌊", color: "sky", keyUrl: "https://console.mistral.ai/api-keys/", keyHint: "" },
  zai: { label: "Z.AI", icon: "💎", color: "indigo", keyHint: "" },
  cerebras: { label: "Cerebras", icon: "🧠", color: "pink", keyHint: "" },
  ollama: { label: "Ollama (local)", icon: "🦙", color: "lime", keyHint: "Local — no key needed" },
};

const RECOMMENDED_MODELS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-5",
  "openai/gpt-5.2",
  "anthropic/claude-sonnet-4",
  "google/gemini-2.5-pro",
  "minimax/MiniMax-M2.5",
];

/* ── Model Picker: grouped by provider, with auth flow ── */

function ModelPicker({
  value,
  onChange,
  defaultModel,
  disabled,
}: {
  value: string;
  onChange: (model: string) => void;
  defaultModel: string;
  disabled: boolean;
}) {
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [authProviders, setAuthProviders] = useState<AuthProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addingProvider, setAddingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models?scope=all");
      const data = await res.json();
      setModels((data.models || []) as AvailableModel[]);
      setAuthProviders((data.authProviders || []) as AuthProviderInfo[]);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { queueMicrotask(() => fetchModels()); }, [fetchModels]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as globalThis.Node)) {
        setOpen(false);
        setAddingProvider(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search when open
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  // Derive authenticated provider set
  const authedProviders = useMemo(
    () => new Set(authProviders.filter((p) => p.authenticated).map((p) => p.provider)),
    [authProviders]
  );

  // Split models: available (authed) vs unavailable
  const { availableModels, groupedAvailable, unauthProviders } = useMemo(() => {
    const avail = models.filter((m) => m.available || m.local);
    const unavail = models.filter((m) => !m.available && !m.local);

    // Group available models by provider
    const grouped: Record<string, AvailableModel[]> = {};
    for (const m of avail) {
      const provider = m.key.split("/")[0] || "other";
      if (!grouped[provider]) grouped[provider] = [];
      grouped[provider].push(m);
    }
    // Sort each group
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));
    }

    // Find providers that have models but aren't authenticated
    const unavailProviders = new Set<string>();
    for (const m of unavail) {
      const p = m.key.split("/")[0];
      if (p && !authedProviders.has(p)) unavailProviders.add(p);
    }

    return {
      availableModels: avail,
      groupedAvailable: grouped,
      unauthProviders: [...unavailProviders].sort(),
    };
  }, [models, authedProviders]);

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groupedAvailable;
    const q = search.toLowerCase();
    const result: Record<string, AvailableModel[]> = {};
    for (const [provider, items] of Object.entries(groupedAvailable)) {
      const filtered = items.filter(
        (m) =>
          m.key.toLowerCase().includes(q) ||
          (m.name || "").toLowerCase().includes(q) ||
          provider.toLowerCase().includes(q)
      );
      if (filtered.length > 0) result[provider] = filtered;
    }
    return result;
  }, [groupedAvailable, search]);

  // Provider order: prioritize recommended providers
  const providerOrder = useMemo(() => {
    const priority = ["anthropic", "openai", "google", "minimax", "ollama"];
    const keys = Object.keys(filteredGroups);
    const sorted = [
      ...priority.filter((p) => keys.includes(p)),
      ...keys.filter((p) => !priority.includes(p)).sort(),
    ];
    return sorted;
  }, [filteredGroups]);

  // Selected model display
  const selectedModel = models.find((m) => m.key === value);
  const displayLabel = value
    ? selectedModel
      ? `${selectedModel.name || selectedModel.key.split("/").pop()}`
      : value
    : `Use default (${defaultModel.split("/").pop() || defaultModel})`;
  const selectedProvider = value ? value.split("/")[0] : null;
  const selectedMeta = selectedProvider ? PROVIDER_META[selectedProvider] : null;

  // Save API key
  const handleSaveKey = useCallback(async () => {
    if (!addingProvider || !apiKey.trim()) return;
    setSavingKey(true);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auth-provider", provider: addingProvider, token: apiKey.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveSuccess(addingProvider);
        setApiKey("");
        setAddingProvider(null);
        // Refresh models
        setLoading(true);
        await fetchModels();
        setTimeout(() => setSaveSuccess(null), 3000);
      }
    } catch { /* ignore */ }
    setSavingKey(false);
  }, [addingProvider, apiKey, fetchModels]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-2.5 text-[12px] text-muted-foreground/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading available models...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* ── Trigger button ── */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors",
          open
            ? "border-violet-500/30 bg-foreground/[0.03]"
            : "border-foreground/[0.08] bg-foreground/[0.02] hover:border-foreground/[0.15]",
          disabled && "opacity-40 cursor-not-allowed"
        )}
      >
        {selectedMeta && <span className="text-sm">{selectedMeta.icon}</span>}
        <span className={cn("flex-1 truncate", !value && "text-muted-foreground/60")}>
          {displayLabel}
        </span>
        {value && authedProviders.has(value.split("/")[0]) && (
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground/50 transition-transform", open && "rotate-180")} />
      </button>

      {/* ── Success toast ── */}
      {saveSuccess && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-1.5 text-[11px] text-emerald-400 animate-in fade-in slide-in-from-top-1">
          <CheckCircle className="h-3 w-3 shrink-0" />
          {PROVIDER_META[saveSuccess]?.label || saveSuccess} connected! Models are now available.
        </div>
      )}

      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 flex max-h-[50vh] flex-col overflow-hidden rounded-xl border border-foreground/[0.1] bg-card shadow-2xl">
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-foreground/[0.06] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="flex-1 bg-transparent text-[12px] text-foreground/90 placeholder:text-muted-foreground/40 outline-none"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="text-muted-foreground/40 hover:text-foreground/60">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Default option */}
            {!search && (
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors hover:bg-violet-500/[0.06]",
                  !value && "bg-violet-500/[0.08] text-violet-400"
                )}
              >
                <Star className="h-3.5 w-3.5 text-amber-400" />
                <span className="font-medium">Use default</span>
                <span className="text-[10px] text-muted-foreground/50">({defaultModel.split("/").pop()})</span>
              </button>
            )}

            {/* Recommended section */}
            {!search && (
              <>
                <div className="px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">
                  Recommended
                </div>
                {RECOMMENDED_MODELS.map((key) => {
                  const m = models.find((x) => x.key === key);
                  if (!m) return null;
                  const provider = key.split("/")[0];
                  const isAuthed = authedProviders.has(provider);
                  const meta = PROVIDER_META[provider];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        if (!isAuthed) {
                          setAddingProvider(provider);
                          return;
                        }
                        onChange(key);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors",
                        value === key ? "bg-violet-500/[0.08] text-violet-400" : "hover:bg-foreground/[0.03]",
                        !isAuthed && "opacity-60"
                      )}
                    >
                      <span className="text-[11px]">{meta?.icon || "🤖"}</span>
                      <span className="flex-1 font-medium">{m.name || key.split("/").pop()}</span>
                      {isAuthed ? (
                        <ShieldCheck className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                          <Key className="h-2.5 w-2.5" />
                          Needs key
                        </span>
                      )}
                    </button>
                  );
                })}
                <div className="mx-3 my-1.5 h-px bg-foreground/[0.05]" />
              </>
            )}

            {/* Grouped available models */}
            {providerOrder.map((provider) => {
              const items = filteredGroups[provider];
              if (!items) return null;
              const meta = PROVIDER_META[provider];
              const isAuthed = authedProviders.has(provider);
              return (
                <div key={provider}>
                  <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                    <span className="text-[10px]">{meta?.icon || "🤖"}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">
                      {meta?.label || provider}
                    </span>
                    {isAuthed && <ShieldCheck className="h-2.5 w-2.5 text-emerald-500" />}
                    <span className="text-[9px] text-muted-foreground/30">{items.length}</span>
                  </div>
                  {items.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => { onChange(m.key); setOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-1.5 pl-7 text-left text-[12px] transition-colors",
                        value === m.key
                          ? "bg-violet-500/[0.08] text-violet-400"
                          : "text-foreground/80 hover:bg-foreground/[0.03]"
                      )}
                    >
                      <span className="flex-1 truncate">{m.name || m.key.split("/").pop()}</span>
                      {m.local && (
                        <span className="rounded-full bg-lime-500/10 px-1.5 py-0.5 text-[9px] font-medium text-lime-400">LOCAL</span>
                      )}
                      {RECOMMENDED_MODELS.includes(m.key) && (
                        <Star className="h-2.5 w-2.5 text-amber-400" />
                      )}
                    </button>
                  ))}
                </div>
              );
            })}

            {Object.keys(filteredGroups).length === 0 && search && (
              <div className="px-3 py-6 text-center text-[12px] text-muted-foreground/50">
                No models match &ldquo;{search}&rdquo;
              </div>
            )}

            {/* ── Add a Provider section ── */}
            {!search && unauthProviders.length > 0 && (
              <>
                <div className="mx-3 my-1.5 h-px bg-foreground/[0.05]" />
                <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">
                  Connect a new provider
                </div>
                <div className="px-3 pb-2 grid grid-cols-2 gap-1.5">
                  {unauthProviders.slice(0, 8).map((p) => {
                    const meta = PROVIDER_META[p];
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setAddingProvider(p)}
                        className="flex items-center gap-1.5 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-2 py-1.5 text-[10px] text-muted-foreground/70 transition-colors hover:border-violet-500/20 hover:text-foreground/80"
                      >
                        <span>{meta?.icon || "🤖"}</span>
                        <span className="truncate font-medium">{meta?.label || p}</span>
                        <Plus className="ml-auto h-2.5 w-2.5 text-muted-foreground/30" />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* ── Inline Add Provider flow ── */}
          {addingProvider && (
            <div className="border-t border-foreground/[0.08] bg-foreground/[0.02] px-3 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">{PROVIDER_META[addingProvider]?.icon || "🤖"}</span>
                <span className="text-[12px] font-semibold text-foreground/80">
                  Connect {PROVIDER_META[addingProvider]?.label || addingProvider}
                </span>
                <button
                  type="button"
                  onClick={() => { setAddingProvider(null); setApiKey(""); setShowKey(false); }}
                  className="ml-auto rounded p-0.5 text-muted-foreground/40 hover:text-foreground/60"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSaveKey(); } }}
                    placeholder={PROVIDER_META[addingProvider]?.keyHint || "Paste API key..."}
                    className="w-full rounded-lg border border-foreground/[0.08] bg-card px-3 py-2 pr-8 text-[11px] font-mono text-foreground/90 placeholder:text-muted-foreground/30 focus:border-violet-500/30 focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground/60"
                  >
                    {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSaveKey}
                  disabled={!apiKey.trim() || savingKey}
                  className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                >
                  {savingKey ? <Loader2 className="h-3 w-3 animate-spin" /> : "Connect"}
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                <Key className="h-2.5 w-2.5" />
                <span>Stored securely in OpenClaw. Never leaves your machine.</span>
                {PROVIDER_META[addingProvider]?.keyUrl && (
                  <a
                    href={PROVIDER_META[addingProvider].keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-0.5 text-violet-400 hover:text-violet-300"
                  >
                    Get a key <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Footer summary */}
          <div className="border-t border-foreground/[0.06] bg-foreground/[0.01] px-3 py-1.5">
            <p className="text-[10px] text-muted-foreground/40">
              {availableModels.length} models ready from {Object.keys(groupedAvailable).length} providers
              {unauthProviders.length > 0 && ` · ${unauthProviders.length} more providers available`}
            </p>
          </div>
        </div>
      )}

      {/* Status text */}
      {!open && availableModels.length === 0 && (
        <p className="mt-1.5 text-[10px] text-amber-400">
          No authenticated models found. Click above to connect a provider.
        </p>
      )}
    </div>
  );
}

/* ── Channel info fetched from backend ── */

type ChannelInfo = {
  channel: string;
  label: string;
  icon: string;
  setupType: "qr" | "token" | "cli" | "auto";
  setupCommand: string;
  setupHint: string;
  configHint: string;
  tokenLabel?: string;
  tokenPlaceholder?: string;
  docsUrl: string;
  enabled: boolean;
  configured: boolean;
  accounts: string[];
  statuses: { channel: string; account: string; status: string; linked?: boolean; connected?: boolean; error?: string }[];
};

/* ── Channel Binding Picker: live status, inline setup ── */

function ChannelBindingPicker({
  bindings,
  onAdd,
  onRemove,
  disabled,
}: {
  bindings: string[];
  onAdd: (binding: string) => void;
  onRemove: (binding: string) => void;
  disabled: boolean;
}) {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo | null>(null);
  const [setupMode, setSetupMode] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [appTokenInput, setAppTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [setupSuccess, setSetupSuccess] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/channels?scope=all");
      const data = await res.json();
      setChannels((data.channels || []) as ChannelInfo[]);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { queueMicrotask(() => fetchChannels()); }, [fetchChannels]);

  // Derive channel status
  const getStatus = useCallback((ch: ChannelInfo): { text: string; color: string; ready: boolean } => {
    if (ch.setupType === "auto") return { text: "Always available", color: "emerald", ready: true };
    if (!ch.configured && !ch.enabled) return { text: "Not set up", color: "zinc", ready: false };
    if (ch.enabled) {
      const hasConnected = ch.statuses.some((s) => s.connected || s.linked);
      if (hasConnected) return { text: "Connected", color: "emerald", ready: true };
      const hasError = ch.statuses.some((s) => s.error);
      if (hasError) return { text: "Error", color: "red", ready: false };
      return { text: "Enabled", color: "amber", ready: true };
    }
    return { text: "Configured", color: "amber", ready: true };
  }, []);

  const handleSetupToken = useCallback(async () => {
    if (!selectedChannel || !tokenInput.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          channel: selectedChannel.channel,
          token: tokenInput.trim(),
          appToken: appTokenInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSetupSuccess(selectedChannel.channel);
        setTokenInput("");
        setAppTokenInput("");
        setSetupMode(false);
        // Refresh channels
        await fetchChannels();
        setTimeout(() => setSetupSuccess(null), 4000);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [selectedChannel, tokenInput, appTokenInput, fetchChannels]);

  const handleBindChannel = useCallback((ch: ChannelInfo) => {
    const binding = accountId.trim()
      ? `${ch.channel}:${accountId.trim()}`
      : ch.channel;
    onAdd(binding);
    setSelectedChannel(null);
    setAccountId("");
    setSetupMode(false);
  }, [accountId, onAdd]);

  // Split channels: ready vs needs setup
  const { readyChannels, setupChannels } = useMemo(() => {
    const ready: ChannelInfo[] = [];
    const setup: ChannelInfo[] = [];
    for (const ch of channels) {
      const status = getStatus(ch);
      if (status.ready) ready.push(ch);
      else setup.push(ch);
    }
    return { readyChannels: ready, setupChannels: setup };
  }, [channels, getStatus]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground/50">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking available channels...
      </div>
    );
  }

  return (
    <div>
      {/* Existing bindings chips */}
      {bindings.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {bindings.map((b) => {
            const chKey = b.split(":")[0];
            const chInfo = channels.find((c) => c.channel === chKey);
            const status = chInfo ? getStatus(chInfo) : null;
            return (
              <span key={b} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-2.5 py-1 text-[11px] text-violet-400">
                <span>{chInfo?.icon || "📡"}</span>
                <span className="font-medium">{b}</span>
                {status && (
                  <span className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    status.color === "emerald" ? "bg-emerald-400" : status.color === "amber" ? "bg-amber-400" : "bg-zinc-500"
                  )} />
                )}
                <button
                  type="button"
                  onClick={() => onRemove(b)}
                  className="ml-0.5 rounded text-violet-400/60 hover:text-violet-200"
                  disabled={disabled}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Success toast */}
      {setupSuccess && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-1.5 text-[11px] text-emerald-400 animate-in fade-in slide-in-from-top-1">
          <CheckCircle className="h-3 w-3 shrink-0" />
          {channels.find((c) => c.channel === setupSuccess)?.label || setupSuccess} connected! You can now bind it.
        </div>
      )}

      {/* Channel picker or setup */}
      {!selectedChannel ? (
        <div>
          {/* Ready channels */}
          {readyChannels.length > 0 && (
            <>
              <p className="mb-1.5 text-[10px] text-muted-foreground/60">
                Connected channels — click to bind:
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {readyChannels.map((ch) => {
                  const status = getStatus(ch);
                  const alreadyBound = bindings.some((b) => b.split(":")[0] === ch.channel);
                  return (
                    <button
                      key={ch.channel}
                      type="button"
                      onClick={() => {
                        if (alreadyBound) return;
                        setSelectedChannel(ch);
                      }}
                      disabled={disabled || alreadyBound}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11px] transition-colors",
                        alreadyBound
                          ? "border-violet-500/20 bg-violet-500/[0.05] text-violet-400 opacity-60 cursor-not-allowed"
                          : "border-foreground/[0.06] bg-foreground/[0.02] text-foreground/70 hover:border-violet-500/20 hover:bg-violet-500/[0.05] hover:text-violet-400 disabled:opacity-40"
                      )}
                    >
                      <span className="text-base">{ch.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium block truncate">{ch.label}</span>
                        <span className={cn(
                          "text-[9px]",
                          status.color === "emerald" ? "text-emerald-400" : "text-amber-400"
                        )}>
                          {alreadyBound ? "Bound" : status.text}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Channels that need setup */}
          {setupChannels.length > 0 && (
            <>
              <div className={cn(readyChannels.length > 0 && "mt-3")}>
                <p className="mb-1.5 text-[10px] text-muted-foreground/40">
                  More channels — needs one-time setup:
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {setupChannels.map((ch) => (
                    <button
                      key={ch.channel}
                      type="button"
                      onClick={() => { setSelectedChannel(ch); setSetupMode(true); }}
                      disabled={disabled}
                      className="flex items-center gap-2 rounded-lg border border-dashed border-foreground/[0.06] bg-transparent px-3 py-2 text-left text-[11px] text-muted-foreground/50 transition-colors hover:border-foreground/[0.12] hover:text-foreground/60 disabled:opacity-40"
                    >
                      <span className="text-base opacity-60">{ch.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium block truncate">{ch.label}</span>
                        <span className="text-[9px] text-muted-foreground/30">Set up</span>
                      </div>
                      <Plus className="h-2.5 w-2.5 text-muted-foreground/30" />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {channels.length === 0 && (
            <p className="py-3 text-center text-[11px] text-muted-foreground/40">
              Could not fetch channels. Is the Gateway running?
            </p>
          )}
        </div>
      ) : (
        /* Selected channel: bind or set up */
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base">{selectedChannel.icon}</span>
              <span className="text-[12px] font-semibold text-foreground/80">{selectedChannel.label}</span>
              {getStatus(selectedChannel).ready && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
                  <ShieldCheck className="h-2.5 w-2.5" /> Connected
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setSelectedChannel(null); setSetupMode(false); setTokenInput(""); setAppTokenInput(""); setAccountId(""); }}
              className="rounded p-0.5 text-muted-foreground/40 hover:text-foreground/70"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* If channel is ready — just bind */}
          {getStatus(selectedChannel).ready && !setupMode ? (
            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleBindChannel(selectedChannel); } }}
                  placeholder="Account ID (optional — leave empty for all)"
                  className="flex-1 rounded-lg border border-foreground/[0.08] bg-card px-3 py-2 text-[12px] text-foreground/90 placeholder:text-muted-foreground/40 focus:border-violet-500/30 focus:outline-none"
                  autoFocus
                  disabled={disabled}
                />
                <button
                  type="button"
                  onClick={() => handleBindChannel(selectedChannel)}
                  disabled={disabled}
                  className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                >
                  Bind
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground/50">
                Leave empty to route all {selectedChannel.label} messages to this agent.
                {selectedChannel.accounts.length > 1 && (
                  <> Accounts: {selectedChannel.accounts.join(", ")}</>
                )}
              </p>
            </div>
          ) : (
            /* Channel needs setup */
            <div>
              <p className="mb-2 text-[11px] text-foreground/60">
                {selectedChannel.setupHint}
              </p>

              {/* Token-based setup (Telegram, Discord, Slack, etc.) */}
              {selectedChannel.setupType === "token" && (
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-muted-foreground/60">
                      {selectedChannel.tokenLabel || "Token"}
                    </label>
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && tokenInput.trim()) { e.preventDefault(); handleSetupToken(); } }}
                      placeholder={selectedChannel.tokenPlaceholder || "Paste token here..."}
                      className="w-full rounded-lg border border-foreground/[0.08] bg-card px-3 py-2 text-[11px] font-mono text-foreground/90 placeholder:text-muted-foreground/30 focus:border-violet-500/30 focus:outline-none"
                      autoFocus
                      disabled={saving}
                    />
                  </div>
                  {selectedChannel.channel === "slack" && (
                    <div>
                      <label className="mb-1 block text-[10px] font-medium text-muted-foreground/60">
                        App Token (Socket Mode)
                      </label>
                      <input
                        type="password"
                        value={appTokenInput}
                        onChange={(e) => setAppTokenInput(e.target.value)}
                        placeholder="xapp-..."
                        className="w-full rounded-lg border border-foreground/[0.08] bg-card px-3 py-2 text-[11px] font-mono text-foreground/90 placeholder:text-muted-foreground/30 focus:border-violet-500/30 focus:outline-none"
                        disabled={saving}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSetupToken}
                      disabled={!tokenInput.trim() || saving}
                      className="rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                    >
                      {saving ? (
                        <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Connecting...</span>
                      ) : (
                        "Connect & Save"
                      )}
                    </button>
                    <a
                      href={selectedChannel.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-0.5"
                    >
                      Setup guide <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                  <p className="text-[10px] text-muted-foreground/40">
                    Token is stored securely in OpenClaw credentials. Never leaves your machine.
                  </p>
                </div>
              )}

              {/* QR-based setup (WhatsApp) */}
              {selectedChannel.setupType === "qr" && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2">
                    <p className="text-[11px] font-medium text-amber-400 mb-1">Interactive setup required</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {selectedChannel.label} requires scanning a QR code. Open the Terminal and run:
                    </p>
                    <code className="mt-1.5 block rounded bg-black/30 px-2 py-1.5 text-[10px] font-mono text-emerald-400">
                      {selectedChannel.setupCommand}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href="/?section=terminal"
                      className="rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 inline-flex items-center gap-1.5"
                    >
                      Open Terminal
                    </Link>
                    <a
                      href={selectedChannel.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-0.5"
                    >
                      Setup guide <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              )}

              {/* CLI-based setup */}
              {selectedChannel.setupType === "cli" && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2">
                    <p className="text-[10px] text-muted-foreground/60 mb-1">
                      Run this command in the Terminal:
                    </p>
                    <code className="block rounded bg-black/30 px-2 py-1.5 text-[10px] font-mono text-emerald-400">
                      {selectedChannel.setupCommand}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href="/?section=terminal"
                      className="rounded-lg bg-violet-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 inline-flex items-center gap-1.5"
                    >
                      Open Terminal
                    </Link>
                    <a
                      href={selectedChannel.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-0.5"
                    >
                      Docs <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              )}

              {selectedChannel.configHint && (
                <p className="mt-1 text-[10px] text-muted-foreground/40 italic">
                  {selectedChannel.configHint}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

  // Model is now handled by ModelPicker component

  // Channel bindings are now handled by ChannelBindingPicker

  useEffect(() => { nameRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, busy]);

  const addBinding = useCallback((binding: string) => {
    if (!bindings.includes(binding)) {
      setBindings((prev) => [...prev, binding]);
    }
  }, [bindings]);

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

          {/* ── 2. Model (picker) ── */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-foreground/70">
              Model
            </label>
            <ModelPicker
              value={model}
              onChange={setModel}
              defaultModel={defaultModel}
              disabled={busy}
            />
          </div>

          {/* ── 3. Channel Bindings (live) ── */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-foreground/70">
              Channel Bindings
              <span className="ml-1 text-[10px] font-normal text-muted-foreground/40">optional</span>
            </label>
            <ChannelBindingPicker
              bindings={bindings}
              onAdd={addBinding}
              onRemove={removeBinding}
              disabled={busy}
            />
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
  defaultFallbacks: _defaultFallbacks,
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
  /* ── Keyboard ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, busy]);

  const addBinding = useCallback((binding: string) => {
    if (!bindings.includes(binding)) {
      setBindings((prev) => [...prev, binding]);
    }
  }, [bindings]);

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
                <Link
                  href="/?section=models"
                  className="text-violet-400 hover:text-violet-300"
                >
                  Manage providers →
                </Link>
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
            <ChannelBindingPicker
              bindings={bindings}
              onAdd={addBinding}
              onRemove={removeBinding}
              disabled={busy}
            />
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
