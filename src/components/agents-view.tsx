"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  LayoutGrid,
  GitFork,
  Plus,
  X,
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
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { InlineSpinner, LoadingState } from "@/components/ui/loading-state";
import { SubagentsManagerView } from "@/components/subagents-manager-view";

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

type ConfiguredChannel = {
  channel: string;
  enabled: boolean;
};

type AgentsResponse = {
  agents: Agent[];
  owner: string | null;
  defaultModel: string;
  defaultFallbacks: string[];
  configuredChannels?: ConfiguredChannel[];
};

/* ================================================================
   Helpers
   ================================================================ */

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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


const AGENT_GRAPH_COLORS = {
  delegation: "var(--chart-2)",
  delegationLabel: "var(--chart-2)",
  route: "var(--chart-4)",
  routeLabel: "var(--chart-4)",
  workspace: "var(--chart-3)",
  muted: "var(--chart-muted)",
  mutedSoft: "var(--chart-tick-muted)",
};

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
      <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] shadow-lg shadow-[var(--accent-brand-ring)]">
        <span className="text-xl">🦞</span>
      </div>
      <div className="mt-2 text-center">
        <p className="text-xs font-bold text-foreground">Gateway</p>
        <p className="text-xs text-muted-foreground">
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
        "cursor-pointer rounded-xl border p-3 transition-all min-w-44 max-w-52",
        selected
          ? "border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] shadow-lg shadow-[var(--accent-brand-ring)]"
          : "border-foreground/10 bg-card hover:border-[var(--accent-brand-border)]"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary !border-primary !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-blue-500 !border-blue-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} id="sub" className="!bg-[var(--accent-brand)] !border-[var(--accent-brand)] !w-2 !h-2" />
      <Handle type="target" position={Position.Top} id="parent" className="!bg-[var(--accent-brand)] !border-[var(--accent-brand)] !w-2 !h-2" />

      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-brand-subtle)] ring-1 ring-[var(--accent-brand-border)] text-sm font-bold"
        >
          {agent.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-foreground">
              {agent.name}
            </span>
            <span className={cn("h-2 w-2 rounded-full", sc.dot)} />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {shortModel(agent.model)}
          </p>
        </div>
      </div>

      {/* Badges */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {agent.isDefault && (
          <span className="rounded bg-[var(--accent-brand-subtle)] px-1.5 py-0.5 text-[var(--accent-brand-text)] font-medium">
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
      <div className="mt-2 flex items-center gap-3 border-t border-foreground/5 pt-2 text-xs">
        <span className="text-muted-foreground">Sessions <strong className="text-foreground/70">{agent.sessionCount}</strong></span>
        <span className="text-muted-foreground">Tokens <strong className="text-foreground/70">{formatTokens(agent.totalTokens)}</strong></span>
        <span className={cn("ml-auto font-medium", sc.text)}>
          {formatAgo(agent.lastActive)}
        </span>
      </div>
    </div>
  );
}

function RuntimeSubagentNodeComponent({ data }: NodeProps) {
  const d = data as {
    parentAgentId: string;
    shortId: string;
    model: string;
    status: "running" | "recent";
    totalTokens: number;
    lastActive: number;
  };

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 min-w-40",
        d.status === "running"
          ? "border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)]"
          : "border-zinc-500/30 bg-zinc-900/40"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          "!w-2 !h-2",
          d.status === "running"
            ? "!bg-[var(--accent-brand)] !border-[var(--accent-brand)]"
            : "!bg-zinc-500 !border-zinc-400"
        )}
      />
      <div className="flex items-center gap-1.5">
        <Sparkles className={cn("h-3.5 w-3.5", d.status === "running" ? "text-[var(--accent-brand)]" : "text-zinc-300")} />
        <p className="text-xs font-semibold text-foreground/90">
          subagent #{d.shortId}
        </p>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {shortModel(d.model)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {d.status} · {formatTokens(d.totalTokens)} · {formatAgo(d.lastActive)}
      </p>
    </div>
  );
}

function ChannelNodeComponent({ data }: NodeProps) {
  const d = data as { channel: string; accountIds: string[] };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-950/50 px-3 py-2 min-w-32">
      <Handle type="source" position={Position.Right} className="!bg-sky-500 !border-sky-400 !w-2 !h-2" />
      <span className="text-sm">{channelIcon(d.channel)}</span>
      <div>
        <p className="text-xs font-semibold text-sky-200 capitalize">
          {d.channel}
        </p>
        {d.accountIds.length > 0 && (
          <p className="text-xs text-sky-400/60">
            {d.accountIds.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

function WorkspaceNodeComponent({ data }: NodeProps) {
  const d = data as {
    path: string;
    agentNames: string[];
    selected?: boolean;
    onClick?: () => void;
  };

  return (
    <div
      onClick={() => d.onClick?.()}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 min-w-32 transition-colors",
        d.selected
          ? "border-amber-400/50 bg-amber-900/50 shadow-lg shadow-amber-500/10"
          : "border-amber-500/20 bg-amber-950/40",
        d.onClick ? "cursor-pointer hover:border-amber-400/35" : ""
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-500 !border-amber-400 !w-2 !h-2" />
      <FolderOpen className="h-4 w-4 text-amber-400 shrink-0" />
      <div>
        <p className="text-xs font-semibold text-amber-200">
          {shortPath(d.path)}
        </p>
        <p className="text-xs text-amber-400/60">
          {d.agentNames.join(", ")}
        </p>
      </div>
    </div>
  );
}

const nodeTypes = {
  gateway: GatewayNode,
  agent: AgentNodeComponent,
  runtimeSubagent: RuntimeSubagentNodeComponent,
  channel: ChannelNodeComponent,
  workspace: WorkspaceNodeComponent,
};

/* ================================================================
   Layout computation
   ================================================================ */

type BuildGraphOptions = {
  layoutDirection?: "ltr" | "rtl";
  getSavedPosition?: (id: string) => { x: number; y: number } | undefined;
};

function buildGraph(
  data: AgentsResponse,
  selectedId: string | null,
  onSelectAgent: (id: string) => void,
  selectedWorkspacePath: string | null,
  onSelectWorkspace: (workspacePath: string) => void,
  options?: BuildGraphOptions
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const agents = data.agents;
  const rtl = options?.layoutDirection === "rtl";
  const getSaved = options?.getSavedPosition;
  const pos = (id: string, x: number, y: number) => getSaved?.(id) ?? { x, y };

  // Gather unique channels/workspaces and explicit binding routes.
  const channelMap = new Map<string, Set<string>>(); // channel → account ids
  const workspaceMap = new Map<string, string[]>(); // workspace → agent names
  const channelRoutes = new Map<
    string,
    Array<{ agentId: string; accountId: string | null; raw: string }>
  >(); // channel -> explicit routes

  for (const ch of data.configuredChannels || []) {
    if (ch.enabled && ch.channel) channelMap.set(ch.channel, new Set());
  }

  for (const a of agents) {
    for (const b of a.bindings) {
      const ch = b.split(" ")[0]?.trim();
      if (!ch) continue;
      const accMatch = b.match(/accountId=(\S+)/);
      const accId = accMatch ? accMatch[1] : null;
      if (!channelMap.has(ch)) channelMap.set(ch, new Set());
      if (accId) channelMap.get(ch)!.add(accId);
      if (!channelRoutes.has(ch)) channelRoutes.set(ch, []);
      channelRoutes.get(ch)!.push({
        agentId: a.id,
        accountId: accId,
        raw: b,
      });
    }
    if (!workspaceMap.has(a.workspace)) workspaceMap.set(a.workspace, []);
    workspaceMap.get(a.workspace)!.push(a.name);
  }

  // ── Classify agents ──
  const subagentIds = new Set(agents.flatMap((a) => a.subagents));
  const topLevelAgents = agents.filter((a) => !subagentIds.has(a.id));
  const subAgents = agents.filter((a) => subagentIds.has(a.id));
  const defaultAgent =
    agents.find((a) => a.isDefault) ||
    agents.find((a) => a.id === "main") ||
    agents[0] ||
    null;

  // ── Level-order (BFS) layout for sub-agents to avoid overlap ──
  const subAgentLevels: Agent[][] = [];
  const inLevel = new Set<string>();
  let currentLevel = agents.filter((a) => {
    const parent = agents.find((p) => p.subagents.includes(a.id));
    return parent && topLevelAgents.includes(parent);
  });
  while (currentLevel.length > 0) {
    subAgentLevels.push(currentLevel);
    currentLevel.forEach((a) => inLevel.add(a.id));
    const nextLevel: Agent[] = [];
    currentLevel.forEach((parent) => {
      parent.subagents.forEach((sid) => {
        const child = agents.find((a) => a.id === sid);
        if (child && !inLevel.has(child.id)) {
          nextLevel.push(child);
          inLevel.add(child.id);
        }
      });
    });
    currentLevel = nextLevel;
  }
  const NODE_SPACING = 180;
  const LAYOUT_FIRST_SUB_Y = 180;
  const LEVEL_DY = 130;
  const agentPositionByLevel = new Map<string, { x: number; y: number }>();
  if (rtl) {
    const RTL_LEVEL_0_X = 400;
    const RTL_LEVEL_DX = -220;
    subAgentLevels.forEach((level, levelIndex) => {
      const len = level.length;
      const centerX = RTL_LEVEL_0_X + levelIndex * RTL_LEVEL_DX;
      const y = LAYOUT_FIRST_SUB_Y + levelIndex * LEVEL_DY;
      level.forEach((agent, i) => {
        agentPositionByLevel.set(agent.id, {
          x: centerX + ((len - 1) / 2 - i) * NODE_SPACING,
          y,
        });
      });
    });
  } else {
    const SUB_AGENT_LAYOUT_CENTER_X = 640;
    subAgentLevels.forEach((level, levelIndex) => {
      const len = level.length;
      const centerX = SUB_AGENT_LAYOUT_CENTER_X + levelIndex * 120;
      const y = LAYOUT_FIRST_SUB_Y + levelIndex * LEVEL_DY;
      level.forEach((agent, i) => {
        agentPositionByLevel.set(agent.id, {
          x: centerX + (i - (len - 1) / 2) * NODE_SPACING,
          y,
        });
      });
    });
  }

  // ── Dynamic layout ──
  const AGENT_SPACING_Y = 160;
  const SUB_AGENT_OFFSET_X = 50;
  const SUB_AGENT_OFFSET_Y = 170;
  const RUNTIME_SUBAGENT_OFFSET_X = 290;
  const RUNTIME_SUBAGENT_SPACING_Y = 94;

  const GATEWAY_X = rtl ? 700 : 0;
  const GATEWAY_Y = 0;
  const AGENT_X = rtl ? 550 : 320;
  const CHANNEL_X = rtl ? 850 : -350;
  const WORKSPACE_X = rtl ? -500 : 1400;
  const gatewayEdgeStyle = { stroke: "var(--border)", strokeWidth: 1.5 };
  const gatewayEdgeMarker = {
    type: MarkerType.ArrowClosed,
    color: "var(--border)",
    width: 18,
    height: 14,
  } as const;

  // ── 1. Gateway node (center hub) ──
  nodes.push({
    id: "gateway",
    type: "gateway",
    position: pos("gateway", GATEWAY_X, GATEWAY_Y),
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
      position: pos(`agent-${agent.id}`, AGENT_X, ay),
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
      style: gatewayEdgeStyle,
      markerEnd: gatewayEdgeMarker,
    });
  }

  // ── 3. Sub-agents: position by level-order layout (no overlap) ──
  for (const sub of subAgents) {
    const parent = agents.find((a) => a.subagents.includes(sub.id));
    const parentNode = nodes.find((n) => n.id === `agent-${parent?.id}`);
    const px = parentNode?.position.x ?? AGENT_X;
    const py = parentNode?.position.y ?? GATEWAY_Y;
    const idx = agents.indexOf(sub);
    const layoutPos = agentPositionByLevel.get(sub.id);
    const computedPos = layoutPos ?? {
      x: px + SUB_AGENT_OFFSET_X + (parent?.subagents.indexOf(sub.id) ?? 0) * 30,
      y: py + SUB_AGENT_OFFSET_Y,
    };

    nodes.push({
      id: `agent-${sub.id}`,
      type: "agent",
      position: pos(`agent-${sub.id}`, computedPos.x, computedPos.y),
      data: {
        agent: sub,
        idx,
        selected: selectedId === sub.id,
        onClick: () => onSelectAgent(sub.id),
      },
      draggable: true,
    });

    // Parent → Sub-agent (delegation hierarchy)
    if (parent) {
      edges.push({
        id: `sub-${parent.id}-${sub.id}`,
        source: `agent-${parent.id}`,
        target: `agent-${sub.id}`,
        sourceHandle: "sub",
        targetHandle: "parent",
        type: "default",
        animated: true,
        style: { stroke: AGENT_GRAPH_COLORS.delegation, strokeWidth: 1.5, strokeDasharray: "5 4" },
        label: "delegates",
        labelStyle: { fill: AGENT_GRAPH_COLORS.delegationLabel, fontSize: 10 },
        labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: AGENT_GRAPH_COLORS.delegation,
          width: 14,
          height: 10,
        },
      });
    }

    // Also connect sub-agent to gateway (same gateway hierarchy style)
    edges.push({
      id: `gw-${sub.id}`,
      source: "gateway",
      target: `agent-${sub.id}`,
      style: gatewayEdgeStyle,
      markerEnd: gatewayEdgeMarker,
    });
  }

  // ── 3b. Runtime spawned subagents from gateway sessions ──
  for (const parent of agents) {
    const runtimeSubs = (parent.runtimeSubagents || [])
      .filter((s) => s.status === "running")
      .slice(0, 6);
    if (runtimeSubs.length === 0) continue;

    const parentNode = nodes.find((n) => n.id === `agent-${parent.id}`);
    if (!parentNode) continue;
    const px = parentNode.position.x;
    const py = parentNode.position.y;
    const staticChildren = subAgents.filter((s) => {
      const parentForSub = agents.find((a) => a.subagents.includes(s.id));
      return parentForSub?.id === parent.id;
    }).length;
    const runtimeStartY = py + SUB_AGENT_OFFSET_Y + Math.max(0, staticChildren) * 72;

    runtimeSubs.forEach((sub, idx) => {
      const runtimeNodeId = `runtime-subagent-${sub.sessionKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      nodes.push({
        id: runtimeNodeId,
        type: "runtimeSubagent",
        position: {
          x: px + RUNTIME_SUBAGENT_OFFSET_X,
          y: runtimeStartY + idx * RUNTIME_SUBAGENT_SPACING_Y,
        },
        data: {
          parentAgentId: parent.id,
          shortId: sub.shortId,
          model: sub.model,
          status: sub.status,
          totalTokens: sub.totalTokens,
          lastActive: sub.lastActive,
        },
        draggable: true,
      });

      edges.push({
        id: `runtime-sub-${parent.id}-${sub.shortId}-${idx}`,
        source: `agent-${parent.id}`,
        target: runtimeNodeId,
        sourceHandle: "sub",
        type: "default",
        animated: sub.status === "running",
        style: {
          stroke: sub.status === "running" ? AGENT_GRAPH_COLORS.delegation : AGENT_GRAPH_COLORS.muted,
          strokeWidth: 1.5,
          strokeDasharray: "5 4",
        },
        label: sub.status === "running" ? "runtime" : "recent",
        labelStyle: {
          fill: sub.status === "running" ? AGENT_GRAPH_COLORS.delegationLabel : AGENT_GRAPH_COLORS.mutedSoft,
          fontSize: 10,
        },
        labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: sub.status === "running" ? AGENT_GRAPH_COLORS.delegation : AGENT_GRAPH_COLORS.muted,
          width: 12,
          height: 9,
        },
      });
    });
  }

  // ── 4. Channel nodes (left of gateway) ──
  const channels = Array.from(channelMap.entries()).map(([channel, accountIds]) => [
    channel,
    Array.from(accountIds),
  ] as const);
  const chCount = channels.length;
  const chSpacing = Math.max(100, 180);
  const chStartY = GATEWAY_Y - ((chCount - 1) * chSpacing) / 2;

  channels.forEach(([ch, accountIds], i) => {
    const nodeId = `ch-${ch}`;
    nodes.push({
      id: nodeId,
      type: "channel",
      position: pos(nodeId, CHANNEL_X, chStartY + i * chSpacing),
      data: { channel: ch, accountIds },
      draggable: true,
    });

    // Channel → Agent routes (one edge per explicit binding route).
    const explicitRoutes = channelRoutes.get(ch) || [];
    const routes =
      explicitRoutes.length > 0
        ? explicitRoutes
        : defaultAgent
          ? [{ agentId: defaultAgent.id, accountId: null, raw: "implicit-default" }]
          : [];

    routes.forEach((route, routeIdx) => {
      const implicitDefault = route.raw === "implicit-default";
      edges.push({
        id: `ch-${ch}-${route.agentId}-${route.accountId || "all"}-${i}-${routeIdx}`,
        source: nodeId,
        target: `agent-${route.agentId}`,
        type: "default",
        style: { stroke: AGENT_GRAPH_COLORS.route, strokeWidth: implicitDefault ? 1.25 : 1.5 },
        label: implicitDefault
          ? "default route"
          : route.accountId
            ? route.accountId
            : "all accounts",
        labelStyle: { fill: AGENT_GRAPH_COLORS.routeLabel, fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: "var(--card)", fillOpacity: 0.85 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: AGENT_GRAPH_COLORS.route,
          width: 14,
          height: 10,
        },
      });
    });
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
      position: pos(nodeId, WORKSPACE_X, wsStartY + i * wsSpacing),
      data: {
        path: ws,
        agentNames,
        selected: selectedWorkspacePath === ws,
        onClick: () => onSelectWorkspace(ws),
      },
      draggable: true,
    });

    // Agent → Workspace
    for (const a of agents) {
      if (a.workspace === ws) {
        edges.push({
          id: `ws-${a.id}-${i}`,
          source: `agent-${a.id}`,
          target: nodeId,
          style: { stroke: AGENT_GRAPH_COLORS.workspace, strokeWidth: 1.5 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: AGENT_GRAPH_COLORS.workspace,
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
    <div className="rounded-xl border border-foreground/10 bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-brand-subtle)] ring-1 ring-[var(--accent-brand-border)] text-lg font-bold shadow-lg"
        >
          {agent.emoji}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold text-foreground">{agent.name}</h2>
            <span className={cn("h-2.5 w-2.5 rounded-full", sc.dot)} />
            <span className={cn("text-xs font-medium", sc.text)}>
              {agent.status === "active" ? "Active" : agent.status === "idle" ? "Idle" : "Unknown"}
            </span>
            {agent.isDefault && (
              <span className="rounded-full bg-[var(--accent-brand-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--accent-brand-text)]">
                <Shield className="mr-0.5 inline h-2.5 w-2.5" /> Default
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            ID: <code className="text-muted-foreground">{agent.id}</code> ·{" "}
            {formatAgo(agent.lastActive)}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat
          icon={<Cpu className="h-3.5 w-3.5 text-[var(--accent-brand-text)]" />}
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
        <div className="rounded-lg border border-foreground/10 bg-card/80 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
            <Layers className="h-3.5 w-3.5 text-[var(--accent-brand-text)]" /> Model Stack
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-[var(--accent-brand-subtle)] px-1.5 py-0.5 text-xs font-bold text-[var(--accent-brand-text)]">PRIMARY</span>
              <code className="text-xs text-foreground/70">{shortModel(agent.model)}</code>
            </div>
            {agent.fallbackModels.map((fm, i) => (
              <div key={fm} className="flex items-center gap-1.5 pl-1">
                <span className="text-xs text-muted-foreground/60">#{i + 1}</span>
                <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40" />
                <code className="text-xs text-muted-foreground">{shortModel(fm)}</code>
              </div>
            ))}
          </div>
        </div>

        {/* Channels */}
        <div className="rounded-lg border border-foreground/10 bg-card/80 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
            <Globe className="h-3.5 w-3.5 text-blue-400" /> Channels & Bindings
          </div>
          {agent.bindings.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">No bindings</p>
          ) : (
            <div className="space-y-1">
              {agent.bindings.map((b, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded bg-foreground/5 px-2 py-1">
                  <span className="text-sm">{channelIcon(b.split(" ")[0])}</span>
                  <code className="text-xs text-foreground/70">{b}</code>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Workspace */}
        <div className="rounded-lg border border-foreground/10 bg-card/80 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
            <FolderOpen className="h-3.5 w-3.5 text-amber-400" /> Workspace
          </div>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 truncate text-xs text-muted-foreground">{agent.workspace}</code>
            <CopyBtn text={agent.workspace} />
          </div>
          <p className="text-xs text-muted-foreground/60">
            Agent dir: <code className="text-muted-foreground">{agent.agentDir}</code>
          </p>
        </div>

        {/* Relationships */}
        <div className="rounded-lg border border-foreground/10 bg-card/80 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
            <Network className="h-3.5 w-3.5 text-[var(--accent-brand-text)]" /> Relationships
          </div>
          {parentAgents.length === 0 && childAgents.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">No sub-agent relationships</p>
          ) : (
            <div className="space-y-1.5">
              {parentAgents.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground/60 mb-0.5">Reports to</p>
                  {parentAgents.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1 rounded bg-foreground/5 px-2 py-0.5 text-xs text-foreground/70 mr-1">
                      {p.emoji} {p.name}
                    </span>
                  ))}
                </div>
              )}
              {childAgents.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground/60 mb-0.5">Delegates to</p>
                  {childAgents.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1 rounded bg-foreground/5 px-2 py-0.5 text-xs text-foreground/70 mr-1">
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
        <div className="rounded-lg border border-foreground/10 bg-card/80">
          <button
            type="button"
            onClick={() => setShowIdentity(!showIdentity)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
          >
            <Bot className="h-3.5 w-3.5 text-pink-400" />
            <span className="flex-1 text-xs font-semibold text-foreground/70">
              Identity
            </span>
            {showIdentity ? (
              <ChevronUp className="h-3 w-3 text-muted-foreground/60" />
            ) : (
              <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
            )}
          </button>
          {showIdentity && (
            <div className="border-t border-foreground/5 px-3 py-2">
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
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
    <div className="flex items-center gap-2 rounded-lg border border-foreground/10 bg-card/80 px-3 py-2">
      {icon}
      <div>
        <p className="text-xs text-muted-foreground/60">{label}</p>
        <p className="text-xs font-semibold text-foreground/90">{value}</p>
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
  const activeCount = agents.filter((a) => a.status === "active").length;
  const channelSet = new Set(agents.flatMap((a) => a.channels));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { icon: <Users className="h-4 w-4 text-[var(--accent-brand-text)]" />, label: "Agents", value: String(agents.length) },
        { icon: <Zap className="h-4 w-4 text-emerald-400" />, label: "Active", value: `${activeCount} / ${agents.length}` },
        { icon: <MessageSquare className="h-4 w-4 text-blue-400" />, label: "Sessions", value: String(totalSessions) },
        { icon: <Hash className="h-4 w-4 text-amber-400" />, label: "Channels", value: String(channelSet.size) },
      ].map((s) => (
        <div key={s.label} className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-card px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/5">
            {s.icon}
          </div>
          <div>
            <p className="text-xs text-muted-foreground/60">{s.label}</p>
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 stagger-cards">
      {agents.map((agent, idx) => {
        const sc = STATUS_COLORS[agent.status] || STATUS_COLORS.unknown;
        const selected = selectedId === agent.id;

        return (
          <button
            type="button"
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className={cn(
              "relative rounded-xl p-4 text-left transition-all glass-glow",
              selected
                ? "border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] shadow-lg shadow-[var(--accent-brand-ring)]"
                : ""
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
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-brand-subtle)] ring-1 ring-[var(--accent-brand-border)] text-xs"
              >
                {agent.emoji}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-foreground">{agent.name}</h3>
                <p className="truncate text-xs text-muted-foreground">{shortModel(agent.model)}</p>
                {agent.isDefault && (
                  <span className="mt-1 inline-block rounded-full bg-[var(--accent-brand-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--accent-brand-text)]">Default</span>
                )}
              </div>
            </div>
            {agent.channels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {agent.channels.map((ch) => (
                  <span key={ch} className="rounded border border-foreground/10 bg-foreground/5 px-1.5 py-0.5 text-xs text-muted-foreground">
                    {channelIcon(ch)} {ch}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded bg-foreground/5 py-1">
                <p className="text-xs text-muted-foreground/60">Sess.</p>
                <p className="text-xs font-semibold text-foreground/70">{agent.sessionCount}</p>
              </div>
              <div className="rounded bg-foreground/5 py-1">
                <p className="text-xs text-muted-foreground/60">Tokens</p>
                <p className="text-xs font-semibold text-foreground/70">{formatTokens(agent.totalTokens)}</p>
              </div>
              <div className="rounded bg-foreground/5 py-1">
                <p className="text-xs text-muted-foreground/60">Active</p>
                <p className={cn("text-xs font-semibold", sc.text)}>{formatAgo(agent.lastActive)}</p>
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
  selectedWorkspacePath,
  onSelectWorkspace,
  autoLayout,
  savedPositionsRef,
}: {
  data: AgentsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selectedWorkspacePath: string | null;
  onSelectWorkspace: (workspacePath: string) => void;
  autoLayout: boolean;
  savedPositionsRef: React.MutableRefObject<Record<string, { x: number; y: number }>>;
}) {
  const { fitView } = useReactFlow();

  const buildGraphOptions = useMemo(
    () => ({
      layoutDirection: "rtl" as const,
      getSavedPosition: autoLayout ? undefined : (id: string) => savedPositionsRef.current[id],
    }),
    [autoLayout, savedPositionsRef]
  );

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () =>
      buildGraph(
        data,
        selectedId,
        onSelect,
        selectedWorkspacePath,
        onSelectWorkspace,
        buildGraphOptions
      ),
    [data, selectedId, onSelect, selectedWorkspacePath, onSelectWorkspace, buildGraphOptions]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = buildGraph(
      data,
      selectedId,
      onSelect,
      selectedWorkspacePath,
      onSelectWorkspace,
      buildGraphOptions
    );
    setNodes(newNodes);
    setEdges(newEdges);
  }, [
    data,
    selectedId,
    onSelect,
    selectedWorkspacePath,
    onSelectWorkspace,
    buildGraphOptions,
    setNodes,
    setEdges,
  ]);

  const onNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      if (!autoLayout) {
        changes.forEach((c) => {
          if (c.type === "position" && "position" in c && c.position && "id" in c) {
            savedPositionsRef.current[c.id] = c.position;
          }
        });
        try {
          localStorage.setItem(
            AGENT_POSITIONS_STORAGE_KEY,
            JSON.stringify(savedPositionsRef.current)
          );
        } catch {
          /* ignore */
        }
      }
    },
    [onNodesChange, autoLayout, savedPositionsRef]
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
      <Background className="!bg-card dark:!bg-zinc-950" color="var(--border)" gap={20} size={1} />
      <Controls
        showInteractive={false}
        className="!bg-card dark:!bg-zinc-900 !border-border !shadow-xl [&>button]:!bg-secondary dark:[&>button]:!bg-zinc-800 [&>button]:!border-border [&>button]:!text-muted-foreground [&>button:hover]:!bg-accent dark:[&>button:hover]:!bg-zinc-700"
      />
    </ReactFlow>
  );
}

const AGENT_POSITIONS_STORAGE_KEY = "openclaw-mission-control-agent-positions";

function FlowView({
  data,
  selectedId,
  onSelect,
  selectedWorkspacePath,
  onSelectWorkspace,
  autoLayout,
  savedPositionsRef,
}: {
  data: AgentsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selectedWorkspacePath: string | null;
  onSelectWorkspace: (workspacePath: string) => void;
  autoLayout: boolean;
  savedPositionsRef: React.MutableRefObject<Record<string, { x: number; y: number }>>;
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
      className="relative h-0 flex-1 w-full border-t border-border overflow-hidden bg-card dark:bg-zinc-950"
    >
      {dims ? (
        <div style={{ width: dims.w, height: dims.h, position: "absolute", inset: 0 }}>
          <ReactFlowProvider>
            <FlowViewInner
              data={data}
              selectedId={selectedId}
              onSelect={onSelect}
              selectedWorkspacePath={selectedWorkspacePath}
              onSelectWorkspace={onSelectWorkspace}
              autoLayout={autoLayout}
              savedPositionsRef={savedPositionsRef}
            />
          </ReactFlowProvider>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground/40">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
          </span>
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
      <div className="flex items-center gap-2 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-xs text-muted-foreground/50">
        <InlineSpinner size="sm" />
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
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
          open
            ? "border-[var(--accent-brand-border)] bg-foreground/5"
            : "border-foreground/10 bg-foreground/5 hover:border-foreground/15",
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
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-400 animate-in fade-in slide-in-from-top-1">
          <CheckCircle className="h-3 w-3 shrink-0" />
          {PROVIDER_META[saveSuccess]?.label || saveSuccess} connected! Models are now available.
        </div>
      )}

      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 flex max-h-96 flex-col overflow-hidden rounded-xl border border-foreground/10 bg-card shadow-2xl">
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-foreground/10 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="flex-1 bg-transparent text-xs text-foreground/90 placeholder:text-muted-foreground/40 outline-none"
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
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--accent-brand-subtle)]",
                  !value && "bg-[var(--accent-brand-subtle)] text-[var(--accent-brand-text)]"
                )}
              >
                <Star className="h-3.5 w-3.5 text-amber-400" />
                <span className="font-medium">Use default</span>
                <span className="text-xs text-muted-foreground/50">({defaultModel.split("/").pop()})</span>
              </button>
            )}

            {/* Recommended section */}
            {!search && (
              <>
                <div className="px-3 pt-2.5 pb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground/40">
                  Recommended
                </div>
                {RECOMMENDED_MODELS.map((key) => {
                  const m = models.find((x) => x.key === key);
                  if (!m) return null;
                  const provider = key.split("/")[0];
                  const isAuthed = authedProviders.has(provider);
                  const isAvailable = !!(m.available || m.local);
                  const needsKey = !isAvailable && !isAuthed;
                  const meta = PROVIDER_META[provider];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        if (needsKey) {
                          setAddingProvider(provider);
                          return;
                        }
                        if (!isAvailable) return;
                        onChange(key);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors",
                        value === key ? "bg-[var(--accent-brand-subtle)] text-[var(--accent-brand-text)]" : "hover:bg-foreground/5",
                        !isAvailable && "opacity-60"
                      )}
                    >
                      <span className="text-xs">{meta?.icon || "🤖"}</span>
                      <span className="flex-1 font-medium">{m.name || key.split("/").pop()}</span>
                      {isAvailable ? (
                        <ShieldCheck className="h-3 w-3 text-emerald-500" />
                      ) : needsKey ? (
                        <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-xs font-semibold text-amber-400">
                          <Key className="h-2.5 w-2.5" />
                          Needs key
                        </span>
                      ) : (
                        <span className="rounded-full bg-zinc-500/10 px-1.5 py-0.5 text-xs font-semibold text-zinc-400">
                          Unavailable
                        </span>
                      )}
                    </button>
                  );
                })}
                <div className="mx-3 my-1.5 h-px bg-foreground/5" />
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
                    <span className="text-xs">{meta?.icon || "🤖"}</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/40">
                      {meta?.label || provider}
                    </span>
                    {isAuthed && <ShieldCheck className="h-2.5 w-2.5 text-emerald-500" />}
                    <span className="text-xs text-muted-foreground/30">{items.length}</span>
                  </div>
                  {items.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => { onChange(m.key); setOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-1.5 pl-7 text-left text-xs transition-colors",
                        value === m.key
                          ? "bg-[var(--accent-brand-subtle)] text-[var(--accent-brand-text)]"
                          : "text-foreground/80 hover:bg-foreground/5"
                      )}
                    >
                      <span className="flex-1 truncate">{m.name || m.key.split("/").pop()}</span>
                      {m.local && (
                        <span className="rounded-full bg-lime-500/10 px-1.5 py-0.5 text-xs font-medium text-lime-400">LOCAL</span>
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
              <div className="px-3 py-6 text-center text-xs text-muted-foreground/50">
                No models match &ldquo;{search}&rdquo;
              </div>
            )}

            {/* ── Add a Provider section ── */}
            {!search && unauthProviders.length > 0 && (
              <>
                <div className="mx-3 my-1.5 h-px bg-foreground/5" />
                <div className="px-3 pt-2 pb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground/40">
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
                        className="flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-foreground/5 px-2 py-1.5 text-xs text-muted-foreground/70 transition-colors hover:border-[var(--accent-brand-border)] hover:text-foreground/80"
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
            <div className="border-t border-foreground/10 bg-foreground/5 px-3 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">{PROVIDER_META[addingProvider]?.icon || "🤖"}</span>
                <span className="text-xs font-semibold text-foreground/80">
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
                    className="w-full rounded-lg border border-foreground/10 bg-card px-3 py-2 pr-8 text-xs font-mono text-foreground/90 placeholder:text-muted-foreground/30 focus:border-[var(--accent-brand-border)] focus:outline-none"
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
                  className="shrink-0 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-medium transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  {savingKey ? (
                    <span className="inline-flex items-center gap-0.5">
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                    </span>
                  ) : "Connect"}
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground/50">
                <Key className="h-2.5 w-2.5" />
                <span>Stored securely in OpenClaw. Never leaves your machine.</span>
                {PROVIDER_META[addingProvider]?.keyUrl && (
                  <a
                    href={PROVIDER_META[addingProvider].keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-0.5 text-[var(--accent-brand-text)] hover:text-[var(--accent-brand)]"
                  >
                    Get a key <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Footer summary */}
          <div className="border-t border-foreground/10 bg-foreground/5 px-3 py-1.5">
            <p className="text-xs text-muted-foreground/40">
              {availableModels.length} models ready from {Object.keys(groupedAvailable).length} providers
              {unauthProviders.length > 0 && ` · ${unauthProviders.length} more providers available`}
            </p>
          </div>
        </div>
      )}

      {/* Status text */}
      {!open && availableModels.length === 0 && (
        <p className="mt-1.5 text-xs text-amber-400">
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
  onChannelsChanged,
  disabled,
}: {
  bindings: string[];
  onAdd: (binding: string) => void;
  onRemove: (binding: string) => void;
  onChannelsChanged?: () => void;
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
      const res = await fetch("/api/channels?scope=all", { cache: "no-store" });
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
        onChannelsChanged?.();
        setTimeout(() => setSetupSuccess(null), 4000);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [selectedChannel, tokenInput, appTokenInput, fetchChannels, onChannelsChanged]);

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
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground/50">
        <InlineSpinner size="sm" />
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
              <span key={b} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] px-2.5 py-1 text-xs text-[var(--accent-brand-text)]">
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
                  className="ml-0.5 rounded text-[var(--accent-brand-text)]/60 hover:text-[var(--accent-brand)]"
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
        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-400 animate-in fade-in slide-in-from-top-1">
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
              <p className="mb-1.5 text-xs text-muted-foreground/60">
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
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                        alreadyBound
                          ? "border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] text-[var(--accent-brand-text)] opacity-60 cursor-not-allowed"
                          : "border-foreground/10 bg-foreground/5 text-foreground/70 hover:border-[var(--accent-brand-border)] hover:bg-[var(--accent-brand-subtle)] hover:text-[var(--accent-brand-text)] disabled:opacity-40"
                      )}
                    >
                      <span className="text-xs">{ch.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium block truncate">{ch.label}</span>
                        <span className={cn(
                          "text-xs",
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
                <p className="mb-1.5 text-xs text-muted-foreground/40">
                  More channels — needs one-time setup:
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {setupChannels.map((ch) => (
                    <button
                      key={ch.channel}
                      type="button"
                      onClick={() => { setSelectedChannel(ch); setSetupMode(true); }}
                      disabled={disabled}
                      className="flex items-center gap-2 rounded-lg border border-dashed border-foreground/10 bg-transparent px-3 py-2 text-left text-xs text-muted-foreground/50 transition-colors hover:border-foreground/15 hover:text-foreground/60 disabled:opacity-40"
                    >
                      <span className="text-sm opacity-60">{ch.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium block truncate">{ch.label}</span>
                        <span className="text-xs text-muted-foreground/30">Set up</span>
                      </div>
                      <Plus className="h-2.5 w-2.5 text-muted-foreground/30" />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {channels.length === 0 && (
            <p className="py-3 text-center text-xs text-muted-foreground/40">
              Could not fetch channels. Is the Gateway running?
            </p>
          )}
        </div>
      ) : (
        /* Selected channel: bind or set up */
        <div className="rounded-lg border border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs">{selectedChannel.icon}</span>
              <span className="text-xs font-semibold text-foreground/80">{selectedChannel.label}</span>
              {getStatus(selectedChannel).ready && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-400">
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
                  className="flex-1 rounded-lg border border-foreground/10 bg-card px-3 py-2 text-xs text-foreground/90 placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:outline-none"
                  autoFocus
                  disabled={disabled}
                />
                <button
                  type="button"
                  onClick={() => handleBindChannel(selectedChannel)}
                  disabled={disabled}
                  className="shrink-0 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-medium transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  Bind
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground/50">
                Leave empty to route all {selectedChannel.label} messages to this agent.
                {selectedChannel.accounts.length > 1 && (
                  <> Accounts: {selectedChannel.accounts.join(", ")}</>
                )}
              </p>
            </div>
          ) : (
            /* Channel needs setup */
            <div>
              <p className="mb-2 text-xs text-foreground/60">
                {selectedChannel.setupHint}
              </p>

              {/* Token-based setup (Telegram, Discord, Slack, etc.) */}
              {selectedChannel.setupType === "token" && (
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground/60">
                      {selectedChannel.tokenLabel || "Token"}
                    </label>
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && tokenInput.trim()) { e.preventDefault(); handleSetupToken(); } }}
                      placeholder={selectedChannel.tokenPlaceholder || "Paste token here..."}
                      className="w-full rounded-lg border border-foreground/10 bg-card px-3 py-2 text-xs font-mono text-foreground/90 placeholder:text-muted-foreground/30 focus:border-[var(--accent-brand-border)] focus:outline-none"
                      autoFocus
                      disabled={saving}
                    />
                  </div>
                  {selectedChannel.channel === "slack" && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground/60">
                        App Token (Socket Mode)
                      </label>
                      <input
                        type="password"
                        value={appTokenInput}
                        onChange={(e) => setAppTokenInput(e.target.value)}
                        placeholder="xapp-..."
                        className="w-full rounded-lg border border-foreground/10 bg-card px-3 py-2 text-xs font-mono text-foreground/90 placeholder:text-muted-foreground/30 focus:border-[var(--accent-brand-border)] focus:outline-none"
                        disabled={saving}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSetupToken}
                      disabled={!tokenInput.trim() || saving}
                      className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-medium transition-colors hover:bg-primary/90 disabled:opacity-40"
                    >
                      {saving ? (
                        <span className="flex items-center gap-1.5"><span className="inline-flex items-center gap-0.5"><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" /><span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" /></span> Connecting...</span>
                      ) : (
                        "Connect & Save"
                      )}
                    </button>
                    <a
                      href={selectedChannel.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--accent-brand-text)] hover:text-[var(--accent-brand)] flex items-center gap-0.5"
                    >
                      Setup guide <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground/40">
                    Token is stored securely in OpenClaw credentials. Never leaves your machine.
                  </p>
                </div>
              )}

              {/* QR-based setup (WhatsApp) */}
              {selectedChannel.setupType === "qr" && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                    <p className="text-xs font-medium text-amber-400 mb-1">Interactive setup required</p>
                    <p className="text-xs text-muted-foreground/60">
                      {selectedChannel.label} requires scanning a QR code. Open the Terminal and run:
                    </p>
                    <code className="mt-1.5 block rounded bg-black/30 px-2 py-1.5 text-xs font-mono text-emerald-400">
                      {selectedChannel.setupCommand}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href="/terminal"
                      className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-medium transition-colors hover:bg-primary/90 inline-flex items-center gap-1.5"
                    >
                      Open Terminal
                    </Link>
                    <a
                      href={selectedChannel.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--accent-brand-text)] hover:text-[var(--accent-brand)] flex items-center gap-0.5"
                    >
                      Setup guide <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              )}

              {/* CLI-based setup */}
              {selectedChannel.setupType === "cli" && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2">
                    <p className="text-xs text-muted-foreground/60 mb-1">
                      Run this command in the Terminal:
                    </p>
                    <code className="block rounded bg-black/30 px-2 py-1.5 text-xs font-mono text-emerald-400">
                      {selectedChannel.setupCommand}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href="/terminal"
                      className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-medium transition-colors hover:bg-primary/90 inline-flex items-center gap-1.5"
                    >
                      Open Terminal
                    </Link>
                    <a
                      href={selectedChannel.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--accent-brand-text)] hover:text-[var(--accent-brand)] flex items-center gap-0.5"
                    >
                      Docs <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              )}

              {selectedChannel.configHint && (
                <p className="mt-1 text-xs text-muted-foreground/40 italic">
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

/* ── Fallback models (for create-agent wizard) ── */

function FallbackModelsField({
  primary,
  fallbacks,
  onAdd,
  onRemove,
  disabled,
}: {
  primary: string;
  fallbacks: string[];
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
  disabled: boolean;
}) {
  const [models, setModels] = useState<{ key: string; name: string }[]>([]);
  useEffect(() => {
    fetch("/api/models?scope=status")
      .then((r) => r.json())
      .then((d) => setModels((d.models || []).map((m: { key: string; name?: string }) => ({ key: m.key, name: m.name || m.key }))));
  }, []);
  const addable = models.filter((m) => m.key !== primary && !fallbacks.includes(m.key));
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-foreground/70">
        Fallback models
        <span className="ml-1 text-xs font-normal text-muted-foreground/40">optional</span>
      </label>
      <p className="mb-1.5 text-[11px] text-muted-foreground/50">
        Used when the primary model is unavailable (failover).
      </p>
      {fallbacks.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {fallbacks.map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-md border border-foreground/10 bg-foreground/5 px-2 py-1 text-xs text-foreground/80"
            >
              {key.split("/").pop() || key}
              <button
                type="button"
                onClick={() => onRemove(key)}
                disabled={disabled}
                className="rounded p-0.5 text-muted-foreground/60 hover:text-red-400 disabled:opacity-40"
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {addable.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) onAdd(v);
            e.target.value = "";
          }}
          disabled={disabled}
          className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs text-foreground/80 focus:border-[var(--accent-brand-border)] focus:outline-none disabled:opacity-40"
        >
          <option value="">Add fallback model...</option>
          {addable.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name || m.key}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function AddAgentModal({
  onClose,
  onCreated,
  onChannelsChanged,
  defaultModel,
  existingAgents = [],
}: {
  onClose: () => void;
  onCreated: () => void;
  onChannelsChanged?: () => void;
  defaultModel: string;
  existingAgents?: { id: string; name?: string }[];
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [model, setModel] = useState("");
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [agentDir, setAgentDir] = useState("");
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [subagents, setSubagents] = useState<string[]>([]);
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
          displayName: displayName.trim() || undefined,
          model: model || undefined,
          fallbacks: fallbacks.length > 0 ? fallbacks : undefined,
          default: setAsDefault || undefined,
          subagents: subagents.length > 0 ? subagents : undefined,
          workspace: workspace.trim() || undefined,
          agentDir: agentDir.trim() || undefined,
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
  }, [name, displayName, model, fallbacks, setAsDefault, subagents, workspace, agentDir, bindings, onCreated, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-backdrop-in" onClick={() => { if (!busy) onClose(); }} />

      <div className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl glass-strong animate-modal-in">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-brand-subtle)]">
              <Sparkles className="h-4 w-4 text-[var(--accent-brand-text)]" />
            </div>
            <div>
              <h2 className="text-xs font-semibold text-foreground">Create New Agent</h2>
              <p className="text-xs text-muted-foreground">Isolated workspace, sessions & auth</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-muted-foreground/60 hover:text-foreground/70 disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable form */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Step 1 — Identity */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              1. Identity
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground/70">
                Agent ID <span className="text-red-400">*</span>
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                placeholder="e.g. work, research, creative"
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground/90 placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:outline-none"
                disabled={busy}
              />
              <p className="mt-1 text-xs text-muted-foreground/50">
                Unique ID used throughout OpenClaw — auto-formatted to lowercase
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground/70">
                Display name
                <span className="ml-1 text-xs font-normal text-muted-foreground/40">optional</span>
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={name ? `e.g. ${name.charAt(0).toUpperCase() + name.slice(1)}` : "Friendly name in UI"}
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground/90 placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:outline-none"
                disabled={busy}
              />
            </div>
          </div>

          {/* Step 2 — Model */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              2. Model
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground/70">
                Primary model
              </label>
              <ModelPicker
                value={model}
                onChange={setModel}
                defaultModel={defaultModel}
                disabled={busy}
              />
            </div>
            <FallbackModelsField
              primary={model}
              fallbacks={fallbacks}
              onAdd={(key) => setFallbacks((prev) => (prev.includes(key) ? prev : [...prev, key]))}
              onRemove={(key) => setFallbacks((prev) => prev.filter((k) => k !== key))}
              disabled={busy}
            />
          </div>

          {/* Step 3 — Channels */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              3. Channel bindings
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground/70">
                Route channels to this agent
                <span className="ml-1 text-xs font-normal text-muted-foreground/40">optional</span>
              </label>
              <ChannelBindingPicker
                bindings={bindings}
                onAdd={addBinding}
                onRemove={removeBinding}
                onChannelsChanged={onChannelsChanged}
                disabled={busy}
              />
            </div>
          </div>

          {/* Step 4 — Advanced */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground/60"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-180")} />
              4. Advanced options
            </button>
            {showAdvanced && (
              <div className="space-y-4 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground/70">
                    Custom workspace path
                  </label>
                  <input
                    type="text"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    placeholder={`~/.openclaw/workspace-${name || "<name>"}`}
                    className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs font-mono text-foreground/80 placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:outline-none"
                    disabled={busy}
                  />
                  <p className="mt-1 text-xs text-muted-foreground/40">
                    Defaults to <code>~/.openclaw/workspace-{name || "<name>"}</code>
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground/70">
                    Custom agent state directory
                  </label>
                  <input
                    type="text"
                    value={agentDir}
                    onChange={(e) => setAgentDir(e.target.value)}
                    placeholder={`~/.openclaw/agents/${name || "<name>"}/agent`}
                    className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs font-mono text-foreground/80 placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:outline-none"
                    disabled={busy}
                  />
                  <p className="mt-1 text-xs text-muted-foreground/40">
                    Matches <code>openclaw agents add --agent-dir</code>
                  </p>
                </div>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={setAsDefault}
                    onChange={(e) => setSetAsDefault(e.target.checked)}
                    disabled={busy}
                    className="h-3.5 w-3.5 rounded border-foreground/20 text-[var(--accent-brand)] focus:ring-[var(--accent-brand-ring)]"
                  />
                  <span className="text-xs text-foreground/80">Set as default agent</span>
                </label>
                {existingAgents.length > 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground/70">
                      Subagents (can delegate to)
                    </label>
                    <p className="mb-1.5 text-[11px] text-muted-foreground/50">
                      Allow this agent to spawn sessions with these agents via sessions_spawn.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {existingAgents.map((a) => (
                        <label
                          key={a.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                            subagents.includes(a.id)
                              ? "border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] text-[var(--accent-brand)]"
                              : "border-foreground/10 bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={subagents.includes(a.id)}
                            onChange={(e) => {
                              if (e.target.checked) setSubagents((prev) => [...prev, a.id]);
                              else setSubagents((prev) => prev.filter((id) => id !== a.id));
                            }}
                            disabled={busy}
                            className="sr-only"
                          />
                          {a.name || a.id}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              Agent &ldquo;{name}&rdquo; created successfully!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-foreground/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-foreground/10 px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !name.trim() || success}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-brand)] text-[var(--accent-brand-on)] px-4 py-2 text-xs font-medium transition-colors hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <>
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                </span>
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
  onClose,
  onSaved,
  onChannelsChanged,
}: {
  agent: Agent;
  idx: number;
  allAgents: Agent[];
  defaultModel: string;
  onClose: () => void;
  onSaved: () => void;
  onChannelsChanged?: () => void;
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
  const [displayName, setDisplayName] = useState(agent.name);
  const [setAsDefault, setSetAsDefault] = useState(agent.isDefault);
  const [identityName, setIdentityName] = useState(agent.name);
  const [identityEmoji, setIdentityEmoji] = useState(agent.emoji);
  const [identityTheme, setIdentityTheme] = useState(agent.identityTheme || "");
  const [identityAvatar, setIdentityAvatar] = useState(agent.identityAvatar || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  /* ── Fetch available models ── */
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Agent editing should only expose models usable by this instance,
        // not the full global catalog.
        const res = await fetch("/api/models?scope=configured", {
          cache: "no-store",
        });
        const data = await res.json();
        const all = (data.models || []) as AvailableModel[];
        const allowed = all
          .filter((m) => m.available || m.local)
          .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));

        // Keep currently configured values visible even if provider auth changed.
        const byKey = new Map<string, AvailableModel>(
          allowed.map((m) => [m.key, m])
        );
        const ensureModel = (key: string) => {
          if (!key || byKey.has(key)) return;
          byKey.set(key, {
            key,
            name: key.split("/").pop() || key,
            available: false,
            local: false,
            contextWindow: 0,
          });
        };
        ensureModel(agent.model);
        for (const fallback of agent.fallbackModels || []) ensureModel(fallback);
        ensureModel(defaultModel);

        setModels(
          [...byKey.values()].sort((a, b) =>
            (a.name || a.key).localeCompare(b.name || b.key)
          )
        );
      } catch {
        /* ignore */
      }
      setModelsLoading(false);
    })();
  }, [agent.fallbackModels, agent.model, defaultModel]);

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

  const handleLoadIdentityFromWorkspace = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-identity",
          id: agent.id,
          fromIdentity: true,
          workspace: agent.workspace,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `Failed (HTTP ${res.status})`);
      }
      requestRestart("Agent identity was updated from IDENTITY.md.");
      setSuccess(true);
      setTimeout(() => {
        onSaved();
        onClose();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [agent.id, agent.workspace, onClose, onSaved]);

  const handleDelete = useCallback(async () => {
    if (deleteConfirmText.trim() !== agent.id) {
      setError(`Type "${agent.id}" to confirm delete.`);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: agent.id,
          force: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `Failed (HTTP ${res.status})`);
      }
      requestRestart("Agent deleted — restart to clean up routes and sessions.");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [agent.id, deleteConfirmText, onClose, onSaved]);

  /* ── Save ── */
  const handleSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const updateBody: Record<string, unknown> = {
        action: "update",
        id: agent.id,
        model: model || null,
        fallbacks: fallbacks.length > 0 ? fallbacks : [],
        subagents,
        bindings,
      };
      if (displayName !== agent.name) {
        updateBody.displayName = displayName;
      }
      if (setAsDefault !== agent.isDefault) {
        updateBody.default = setAsDefault;
      }

      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateBody),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || `Failed (HTTP ${res.status})`);
        setBusy(false);
        return;
      }

      const identityBody: Record<string, unknown> = {
        action: "set-identity",
        id: agent.id,
      };
      let hasIdentityChanges = false;
      const nextIdentityName = identityName.trim();
      const nextIdentityEmoji = identityEmoji.trim();
      const nextIdentityTheme = identityTheme.trim();
      const nextIdentityAvatar = identityAvatar.trim();
      if (nextIdentityName && nextIdentityName !== agent.name) {
        identityBody.name = nextIdentityName;
        hasIdentityChanges = true;
      }
      if (nextIdentityEmoji && nextIdentityEmoji !== agent.emoji) {
        identityBody.emoji = nextIdentityEmoji;
        hasIdentityChanges = true;
      }
      if (nextIdentityTheme && nextIdentityTheme !== (agent.identityTheme || "")) {
        identityBody.theme = nextIdentityTheme;
        hasIdentityChanges = true;
      }
      if (nextIdentityAvatar && nextIdentityAvatar !== (agent.identityAvatar || "")) {
        identityBody.avatar = nextIdentityAvatar;
        hasIdentityChanges = true;
      }

      if (hasIdentityChanges) {
        const identityRes = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(identityBody),
        });
        const identityData = await identityRes.json();
        if (!identityRes.ok || identityData.error) {
          setError(identityData.error || `Identity update failed (HTTP ${identityRes.status})`);
          setBusy(false);
          return;
        }
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
  }, [
    agent.emoji,
    agent.id,
    agent.identityAvatar,
    agent.identityTheme,
    agent.isDefault,
    agent.name,
    bindings,
    displayName,
    fallbacks,
    identityAvatar,
    identityEmoji,
    identityName,
    identityTheme,
    model,
    onClose,
    onSaved,
    setAsDefault,
    subagents,
  ]);

  const sc = STATUS_COLORS[agent.status] || STATUS_COLORS.unknown;
  const otherAgents = allAgents.filter((a) => a.id !== agent.id);
  const mutating = busy || deleting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-backdrop-in"
        onClick={() => {
          if (!mutating) onClose();
        }}
      />

      <div className="relative z-10 flex h-full max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl glass-strong animate-modal-in">
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-brand-subtle)] ring-1 ring-[var(--accent-brand-border)] text-sm font-bold shadow"
            >
              {agent.emoji}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold text-foreground">
                  {agent.name}
                </h2>
                <span className={cn("h-2 w-2 rounded-full", sc.dot)} />
                <span className={cn("text-xs font-medium", sc.text)}>
                  {agent.status === "active"
                    ? "Active"
                    : agent.status === "idle"
                      ? "Idle"
                      : "Unknown"}
                </span>
                {agent.isDefault && (
                  <span className="rounded-full bg-[var(--accent-brand-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--accent-brand-text)]">
                    Default
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {agent.id} · {formatAgo(agent.lastActive)} ·{" "}
                {agent.sessionCount} sessions · {formatTokens(agent.totalTokens)}{" "}
                tokens
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={mutating}
            className="rounded p-1 text-muted-foreground/60 hover:text-foreground/70 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Scrollable form ── */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 1. Identity + default */}
          <div className="space-y-3 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
            <label className="block text-xs font-semibold text-foreground/70">
              Display Name (dashboard label)
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={agent.id}
                className="mt-1.5 w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm text-foreground/90 placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:outline-none"
                disabled={mutating}
              />
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-foreground/70">
                Identity name
                <input
                  type="text"
                  value={identityName}
                  onChange={(e) => setIdentityName(e.target.value)}
                  placeholder={agent.name}
                  className="mt-1.5 w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs text-foreground/90 placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:outline-none"
                  disabled={mutating}
                />
              </label>
              <label className="block text-xs font-semibold text-foreground/70">
                Identity emoji
                <input
                  type="text"
                  value={identityEmoji}
                  onChange={(e) => setIdentityEmoji(e.target.value)}
                  placeholder={agent.emoji}
                  className="mt-1.5 w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs text-foreground/90 placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:outline-none"
                  disabled={mutating}
                />
              </label>
              <label className="block text-xs font-semibold text-foreground/70">
                Identity theme
                <input
                  type="text"
                  value={identityTheme}
                  onChange={(e) => setIdentityTheme(e.target.value)}
                  placeholder={agent.identityTheme || "default"}
                  className="mt-1.5 w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs text-foreground/90 placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:outline-none"
                  disabled={mutating}
                />
              </label>
              <label className="block text-xs font-semibold text-foreground/70">
                Identity avatar (path/url/data URI)
                <input
                  type="text"
                  value={identityAvatar}
                  onChange={(e) => setIdentityAvatar(e.target.value)}
                  placeholder={agent.identityAvatar || "avatars/agent.png"}
                  className="mt-1.5 w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs text-foreground/90 placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:outline-none"
                  disabled={mutating}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground/80">
                <input
                  type="checkbox"
                  checked={setAsDefault}
                  onChange={(e) => setSetAsDefault(e.target.checked)}
                  disabled={mutating}
                  className="h-3.5 w-3.5 rounded border-foreground/20 text-[var(--accent-brand)] focus:ring-[var(--accent-brand-ring)]"
                />
                Set as default agent
              </label>
              <button
                type="button"
                onClick={handleLoadIdentityFromWorkspace}
                disabled={mutating}
                className="rounded-lg border border-foreground/10 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40"
              >
                Load from IDENTITY.md
              </button>
            </div>
          </div>

          {/* 1. Primary Model */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
              <Cpu className="h-3 w-3 text-[var(--accent-brand-text)]" /> Primary Model
            </label>
            {modelsLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-xs text-muted-foreground/50">
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                </span>
                Loading models…
              </div>
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={busy}
                className="w-full appearance-none rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground/90 focus:border-[var(--accent-brand-border)] focus:outline-none disabled:opacity-40"
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
              <p className="mt-1 text-xs text-muted-foreground/50">
                {models.length} authenticated models.{" "}
                <Link
                  href="/models"
                  className="text-[var(--accent-brand-text)] hover:text-[var(--accent-brand)]"
                >
                  Manage providers →
                </Link>
              </p>
            )}
          </div>

          {/* 2. Fallback Models (multi-select checkboxes) */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
              <Layers className="h-3 w-3 text-[var(--accent-brand-text)]" /> Fallback Models
              <span className="text-xs font-normal text-muted-foreground/40">
                — priority order
              </span>
            </label>
            {modelsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                </span> Loading…
              </div>
            ) : models.length === 0 ? (
              <p className="text-xs text-muted-foreground/50">
                No authenticated models available
              </p>
            ) : (
              <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-lg border border-foreground/10 p-1.5">
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
                          "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                          checked
                            ? "bg-[var(--accent-brand-subtle)] text-[var(--accent-brand)]"
                            : "text-muted-foreground hover:bg-foreground/5"
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
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs font-bold",
                            checked
                              ? "border-[var(--accent-brand)] bg-[var(--accent-brand-subtle)] text-[var(--accent-brand)]"
                              : "border-foreground/10 bg-foreground/5"
                          )}
                        >
                          {order ?? ""}
                        </div>
                        <span className="flex-1 truncate">
                          {m.name || shortModel(m.key)}
                        </span>
                        <span className="text-xs text-muted-foreground/40">
                          {m.key.split("/")[0]}
                        </span>
                      </label>
                    );
                  })}
              </div>
            )}
            {fallbacks.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground/50">
                {fallbacks.length} fallback{fallbacks.length !== 1 && "s"}{" "}
                selected — numbered in priority order
              </p>
            )}
          </div>

          {/* 3. Delegation targets (multi-select) */}
          {otherAgents.length > 0 && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
                <Network className="h-3 w-3 text-[var(--accent-brand-text)]" /> Delegation Targets
                <span className="text-xs font-normal text-muted-foreground/40">
                  — select agents this one can hand work to
                </span>
              </label>
              <p className="mb-1.5 text-xs text-muted-foreground/50">
                Checked = this agent is allowed to delegate tasks to that agent.
              </p>
              <div className="space-y-0.5 rounded-lg border border-foreground/10 p-1.5">
                {otherAgents.map((a) => {
                  const checked = subagents.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors",
                        checked
                          ? "bg-[var(--accent-brand-subtle)] text-[var(--accent-brand)]"
                          : "text-muted-foreground hover:bg-foreground/5"
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
                            ? "border-[var(--accent-brand)] bg-[var(--accent-brand-subtle)]"
                            : "border-foreground/10 bg-foreground/5"
                        )}
                      >
                        {checked && (
                          <CheckCircle className="h-2.5 w-2.5 text-[var(--accent-brand-text)]" />
                        )}
                      </div>
                      <span className="text-sm">{a.emoji}</span>
                      <span className="flex-1 truncate font-medium">
                        {a.name}
                      </span>
                      <span className="text-xs text-muted-foreground/40">
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
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
              <Globe className="h-3 w-3 text-blue-400" /> Channel Bindings
            </label>
            <ChannelBindingPicker
              bindings={bindings}
              onAdd={addBinding}
              onRemove={removeBinding}
              onChannelsChanged={onChannelsChanged}
              disabled={busy}
            />
          </div>

          {/* Workspace (read-only) */}
          <div className="rounded-lg border border-foreground/5 bg-foreground/5 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
              <FolderOpen className="h-3 w-3 text-amber-400/60" /> Workspace
            </div>
            <code className="mt-0.5 block truncate text-xs text-foreground/60">
              {agent.workspace}
            </code>
          </div>

          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
            <p className="text-xs font-semibold text-red-300">Danger Zone</p>
            <p className="mt-1 text-xs text-red-200/80">
              Delete this agent and prune workspace/state (CLI parity: <code>openclaw agents delete</code>).
            </p>
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(true);
                  setDeleteConfirmText("");
                  setError(null);
                }}
                disabled={mutating}
                className="mt-2 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-40"
              >
                Delete Agent…
              </button>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-red-200/80">
                  Type <code>{agent.id}</code> to confirm.
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={agent.id}
                  className="w-full rounded-lg border border-red-500/30 bg-black/20 px-3 py-2 text-xs text-red-100 placeholder:text-red-200/40 focus:border-red-400/60 focus:outline-none"
                  disabled={mutating}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={mutating || deleteConfirmText.trim() !== agent.id}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-40"
                  >
                    {deleting ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-0.5">
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                        </span>
                        Deleting…
                      </span>
                    ) : (
                      "Confirm Delete"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(false);
                      setDeleteConfirmText("");
                    }}
                    disabled={mutating}
                    className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-200/80 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              Settings saved! Restarting gateway to apply…
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-foreground/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={mutating}
            className="rounded-lg border border-foreground/10 px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={mutating || success}
            className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-medium transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            {busy ? (
              <>
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                </span>
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

type WorkspaceFileEntry = {
  relativePath: string;
  size: number;
  mtime: number;
  ext: string;
};

type WorkspaceFileCategoryKey =
  | "foundational"
  | "skills"
  | "memory"
  | "config"
  | "source"
  | "content"
  | "other";

type WorkspaceFileCategory = {
  key: WorkspaceFileCategoryKey;
  label: string;
  hint: string;
  files: WorkspaceFileEntry[];
};

const FOUNDATIONAL_WORKSPACE_FILES = new Set([
  "AGENTS.MD",
  "SOUL.MD",
  "TOOLS.MD",
  "IDENTITY.MD",
  "USER.MD",
  "HEARTBEAT.MD",
  "BOOTSTRAP.MD",
  "BOOT.MD",
  "MEMORY.MD",
  "SYSTEM.MD",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".cs",
  ".sh",
]);

const CONFIG_EXTENSIONS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".env",
  ".conf",
  ".config",
]);

function baseName(pathValue: string): string {
  const parts = pathValue.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || pathValue;
}

function classifyWorkspaceFile(file: WorkspaceFileEntry): WorkspaceFileCategoryKey {
  const rel = file.relativePath.replace(/\\/g, "/");
  const lower = rel.toLowerCase();
  const name = baseName(rel);
  const upperName = name.toUpperCase();

  if (FOUNDATIONAL_WORKSPACE_FILES.has(upperName)) return "foundational";
  if (
    lower.includes("/skills/") ||
    lower.endsWith("/skill.md") ||
    lower.endsWith("/skill.json") ||
    upperName === "SKILL.MD"
  ) {
    return "skills";
  }
  if (
    lower.includes("/memory/") ||
    lower.includes("/journal/") ||
    /^\d{4}-\d{2}-\d{2}/.test(name)
  ) {
    return "memory";
  }
  if (
    CONFIG_EXTENSIONS.has(file.ext) ||
    lower.includes("/config/") ||
    lower.endsWith("openclaw.json") ||
    lower.endsWith("package.json")
  ) {
    return "config";
  }
  if (SOURCE_EXTENSIONS.has(file.ext)) return "source";
  if (
    file.ext === ".md" ||
    file.ext === ".txt" ||
    file.ext === ".rst" ||
    file.ext === ".adoc" ||
    file.ext === ".html"
  ) {
    return "content";
  }
  return "other";
}

function WorkspaceFilesModal({
  workspacePath,
  onClose,
  onOpenDocument,
}: {
  workspacePath: string;
  onClose: () => void;
  onOpenDocument: (workspacePath: string, relativePath?: string | null) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/workspace/files?path=${encodeURIComponent(workspacePath)}`,
          { cache: "no-store" }
        );
        const body = (await res.json()) as {
          error?: string;
          files?: WorkspaceFileEntry[];
          truncated?: boolean;
        };
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (!mounted) return;
        setFiles(Array.isArray(body.files) ? body.files : []);
        setTruncated(Boolean(body.truncated));
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [workspacePath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.relativePath.toLowerCase().includes(q));
  }, [files, search]);

  const categorizedFiles = useMemo(() => {
    const buckets: Record<WorkspaceFileCategoryKey, WorkspaceFileEntry[]> = {
      foundational: [],
      skills: [],
      memory: [],
      config: [],
      source: [],
      content: [],
      other: [],
    };
    for (const file of filteredFiles) {
      buckets[classifyWorkspaceFile(file)].push(file);
    }

    const order: Array<Omit<WorkspaceFileCategory, "files">> = [
      {
        key: "foundational",
        label: "Foundational",
        hint: "USER.md, SOUL.md, AGENTS.md and core identity files",
      },
      {
        key: "skills",
        label: "Skills",
        hint: "Skill specs and skill-related files",
      },
      {
        key: "memory",
        label: "Memory & Journal",
        hint: "Memory files, journals, and chronological notes",
      },
      {
        key: "config",
        label: "Config",
        hint: "Configuration and runtime metadata",
      },
      {
        key: "source",
        label: "Source Code",
        hint: "Executable/source files in this workspace",
      },
      {
        key: "content",
        label: "Documents & Notes",
        hint: "Markdown/text docs and narrative content",
      },
      {
        key: "other",
        label: "Other",
        hint: "Everything else",
      },
    ];

    return order
      .map((meta) => ({
        ...meta,
        files: [...buckets[meta.key]].sort((a, b) =>
          a.relativePath.localeCompare(b.relativePath)
        ),
      }))
      .filter((group) => group.files.length > 0);
  }, [filteredFiles]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-card/95 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-amber-400" />
              <h2 className="text-xs font-semibold text-foreground">
                Workspace Files
              </h2>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              <code>{workspacePath}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground/60 hover:text-foreground/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 space-y-3 border-b border-foreground/10 px-5 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm text-muted-foreground">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter files by path..."
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <p className="text-xs text-muted-foreground/70">
            {loading
              ? "Scanning workspace..."
              : `${filteredFiles.length} file${filteredFiles.length !== 1 ? "s" : ""}${
                  search.trim() ? ` (filtered from ${files.length})` : ""
                }`}
            {truncated ? " · truncated snapshot" : ""}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
              <span className="inline-flex items-center gap-0.5">
                <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
              </span>
              Loading workspace files...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          ) : filteredFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">
              No files match this filter.
            </p>
          ) : (
            <div className="space-y-3">
              {categorizedFiles.map((group) => (
                <section key={group.key} className="space-y-1.5">
                  <div className="sticky top-0 z-[1] rounded-lg border border-foreground/10 bg-card/95 px-2.5 py-1.5 backdrop-blur-sm">
                    <p className="text-xs font-semibold text-foreground/80">
                      {group.label}{" "}
                      <span className="text-muted-foreground/60">
                        ({group.files.length})
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground/50">
                      {group.hint}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {group.files.map((file) => (
                      <button
                        key={file.relativePath}
                        type="button"
                        onClick={() => {
                          onOpenDocument(workspacePath, file.relativePath);
                          onClose();
                        }}
                        className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-left transition-colors hover:border-[var(--accent-brand-border)] hover:bg-[var(--accent-brand-subtle)]"
                        title="Open in Documents"
                      >
                        <p className="truncate text-xs font-medium text-foreground/80">
                          {file.relativePath}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground/60">
                          {file.ext || "(no ext)"} · {formatBytes(file.size)} ·{" "}
                          {formatAgo(file.mtime)}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-foreground/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-foreground/10 px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/5"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenDocument(workspacePath, null);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-medium transition-colors hover:bg-primary/90"
          >
            Open Workspace in Documents
            <ExternalLink className="h-3 w-3" />
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
  const router = useRouter();
  const searchParams = useSearchParams();
  // Unified view mode: flow (org chart), grid (cards), subagents
  type ViewMode = "flow" | "grid" | "subagents";
  const initialView: ViewMode =
    (searchParams.get("tab") || "").toLowerCase() === "subagents" ? "subagents" : "flow";
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  // Derived helpers for backward compat
  const tab: "agents" | "subagents" = viewMode === "subagents" ? "subagents" : "agents";
  const view: "flow" | "grid" = viewMode === "grid" ? "grid" : "flow";
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [autoLayout, setAutoLayout] = useState(true);
  const savedPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AGENT_POSITIONS_STORAGE_KEY);
      if (raw) Object.assign(savedPositionsRef.current, JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const handleAgentClick = useCallback((id: string) => {
    setSelectedId(id);
    setEditingAgentId(id);
  }, []);

  const handleWorkspaceClick = useCallback((workspacePath: string) => {
    setSelectedWorkspacePath(workspacePath);
  }, []);

  const openDocumentForWorkspace = useCallback((workspacePath: string, relativePath?: string | null) => {
    const normalizedWorkspacePath = workspacePath.replace(/\\/g, "/");
    const workspaceName =
      normalizedWorkspacePath.split("/").filter(Boolean).pop() || "workspace";
    const params = new URLSearchParams();
    params.set("workspace", workspaceName);
    if (relativePath) {
      const normalizedRelativePath = relativePath
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");
      if (normalizedRelativePath) {
        params.set("path", `${workspaceName}/${normalizedRelativePath}`);
      }
    }
    router.push(`/documents?${params.toString()}`);
  }, [router]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setSelectedId((prev) => {
        if (prev && json.agents.some((a: Agent) => a.id === prev)) return prev;
        if (json.agents.length === 0) return null;
        const def = json.agents.find((a: Agent) => a.isDefault);
        return def?.id || json.agents[0].id;
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchAgents();
      }
    }, 5000);
    return () => window.clearInterval(pollId);
  }, [fetchAgents]);

  useEffect(() => {
    const handleFocus = () => {
      void fetchAgents();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void fetchAgents();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
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

  const switchView = useCallback((next: ViewMode) => {
    setViewMode(next);
    // Keep URL in sync for subagents tab (bookmarkable)
    const params = new URLSearchParams(searchParams.toString());
    params.delete("section");
    if (next === "subagents") params.set("tab", "subagents");
    else params.delete("tab");
    const query = params.toString();
    router.push(query ? `/agents?${query}` : "/agents");
  }, [router, searchParams]);

  useEffect(() => {
    if (viewMode === "subagents") {
      setShowAddModal(false);
      setEditingAgentId(null);
      setSelectedWorkspacePath(null);
    } else if (viewMode !== "flow") {
      setSelectedWorkspacePath(null);
    }
  }, [viewMode]);

  const agentCount = data?.agents.length ?? 0;
  const sectionDescription =
    tab === "agents"
      ? `${agentCount} agent${agentCount !== 1 ? "s" : ""} configured`
      : "Subagent orchestration, controls, and defaults";

  if (loading) {
    return <LoadingState label="Loading agents..." />;
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
    <SectionLayout>
      <SectionHeader
        title={
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-brand-subtle)]">
              <Users className="h-5 w-5 text-[var(--accent-brand-text)]" />
            </span>
            Agents
          </span>
        }
        description={sectionDescription}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Unified view switcher — pill segmented control */}
            <div className="flex rounded-xl bg-muted/50 p-1">
              {([
                { key: "flow" as ViewMode, icon: GitFork, label: "Hierarchy" },
                { key: "grid" as ViewMode, icon: LayoutGrid, label: "Cards" },
                { key: "subagents" as ViewMode, icon: Network, label: "Subagents" },
              ] as const).map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchView(key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                    viewMode === key
                      ? "bg-card shadow-sm text-foreground animate-segment-slide"
                      : "text-muted-foreground hover:text-foreground/70"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            {tab === "agents" && view === "flow" && (
              <button
                type="button"
                onClick={() => setAutoLayout((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  autoLayout
                    ? "border-foreground/20 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    : "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                )}
                title={autoLayout ? "Turn off auto-layout to drag and position nodes manually" : "Turn on auto-layout (right to left)"}
              >
                <Layers className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{autoLayout ? "Auto-layout on" : "Auto-layout off"}</span>
              </button>
            )}

            {tab === "agents" && (
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-brand)] px-3 py-1.5 text-xs font-medium text-[var(--accent-brand-on)] transition-colors hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add Agent</span>
              </button>
            )}

            <button type="button" onClick={fetchAgents} className="rounded-lg border border-foreground/10 bg-card p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground/70">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        }
        className="py-3"
      />

      {tab === "subagents" && (
        <SubagentsManagerView
          agents={data.agents}
          onAgentsReload={() => {
            void fetchAgents();
          }}
        />
      )}

      {/* Flow view: full width, full remaining height */}
      {tab === "agents" && view === "flow" && (
        <FlowView
          data={data}
          selectedId={selectedId}
          onSelect={handleAgentClick}
          selectedWorkspacePath={selectedWorkspacePath}
          onSelectWorkspace={handleWorkspaceClick}
          autoLayout={autoLayout}
          savedPositionsRef={savedPositionsRef}
        />
      )}

      {/* Grid view + detail: scrollable with max-width */}
      {tab === "agents" && view === "grid" && (
        <SectionBody width="content" padding="roomy" innerClassName="space-y-5">
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
        </SectionBody>
      )}

      {/* Add Agent Modal */}
      {tab === "agents" && showAddModal && (
        <AddAgentModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            void fetchAgents();
          }}
          onChannelsChanged={() => {
            void fetchAgents();
          }}
          defaultModel={data.defaultModel}
          existingAgents={data?.agents ?? []}
        />
      )}

      {/* Edit Agent Modal */}
      {tab === "agents" && editingAgent && (
        <EditAgentModal
          agent={editingAgent}
          idx={editingIdx}
          allAgents={data.agents}
          defaultModel={data.defaultModel}
          onClose={() => setEditingAgentId(null)}
          onSaved={() => {
            void fetchAgents();
          }}
          onChannelsChanged={() => {
            void fetchAgents();
          }}
        />
      )}

      {tab === "agents" && selectedWorkspacePath && (
        <WorkspaceFilesModal
          workspacePath={selectedWorkspacePath}
          onClose={() => setSelectedWorkspacePath(null)}
          onOpenDocument={openDocumentForWorkspace}
        />
      )}
    </SectionLayout>
  );
}
