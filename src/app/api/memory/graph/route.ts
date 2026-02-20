import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { basename, join } from "path";
import { getDefaultWorkspaceSync } from "@/lib/paths";
import { gatewayCall, runCli, runCliJson } from "@/lib/openclaw-cli";

export const dynamic = "force-dynamic";

const WORKSPACE = getDefaultWorkspaceSync();
const MEMORY_DIR = join(WORKSPACE, "memory");
const GRAPH_JSON_PATH = join(MEMORY_DIR, "knowledge-graph.json");
const GRAPH_MD_PATH = join(MEMORY_DIR, "knowledge-graph.md");
const MEMORY_MD_PATH = join(WORKSPACE, "MEMORY.md");
const exec = promisify(execFile);

// All root-level .md files are included dynamically — no fixed allowlist.

type CliAgentRow = {
  id?: string;
  name?: string;
  identityName?: string;
  workspace?: string;
  isDefault?: boolean;
};

async function getCliAgents(): Promise<CliAgentRow[]> {
  try {
    const rows = await runCliJson<CliAgentRow[]>(["agents", "list"], 12000);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function safeAgentName(agent: CliAgentRow): string {
  const raw = String(agent.identityName || agent.name || agent.id || "agent");
  return raw.replace(/\s*_\(.*?\)_?\s*/g, " ").replace(/\s+/g, " ").trim();
}

const SNAPSHOT_START = "<!-- KNOWLEDGE_GRAPH:START -->";
const SNAPSHOT_END = "<!-- KNOWLEDGE_GRAPH:END -->";

type GraphNode = {
  id: string;
  label: string;
  kind: string;
  summary: string;
  confidence: number;
  source: string;
  tags: string[];
  x: number;
  y: number;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight: number;
  evidence: string;
};

type KnowledgeGraph = {
  version: number;
  updatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    workspace: string;
    materializedPath: string;
    jsonPath: string;
  };
};

type MemoryStatusRow = {
  status?: {
    workspaceDir?: string;
    dbPath?: string;
  };
};

type IndexedChunkRow = {
  path?: string;
  start_line?: number;
  text?: string;
  mtime?: number;
};

type BootstrapFile = {
  name: string;
  content: string;
  source: "indexed" | "filesystem";
};

type SourceChunk = {
  id: string;
  topic: string;
  kind: "heading" | "bullet" | "paragraph";
  text: string;
  startLine: number;
  endLine: number;
};

type SourceFact = {
  id: string;
  topic: string;
  statement: string;
  canonical: string;
  line: number;
  confidenceHint: number;
};

type SourceDocument = {
  id: string;
  name: string;
  path: string;
  source: "workspace" | "memory";
  mtimeMs: number;
  size: number;
  chunks: SourceChunk[];
  facts: SourceFact[];
};

type RecentChatMessage = {
  sessionKey: string;
  role: string;
  timestampMs: number;
  text: string;
};

type GraphTelemetry = {
  generatedAt: string;
  sourceDocuments: SourceDocument[];
  recentChatMessages: RecentChatMessage[];
};

type GatewayMessage = {
  role?: unknown;
  timestamp?: unknown;
  content?: Array<{ type?: unknown; text?: unknown }>;
};

type SessionsListResult = {
  sessions?: Array<{ key?: unknown; updatedAt?: unknown }>;
};

type ChatHistoryResult = {
  messages?: GatewayMessage[];
};

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function sanitizeText(input: unknown, fallback = ""): string {
  if (typeof input !== "string") return fallback;
  return input.replace(/\s+/g, " ").trim();
}

function clamp01(n: unknown, fallback: number): number {
  const value = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(2));
}

function buildGraphNode(
  partial: Partial<GraphNode>,
  index: number,
  idSet: Set<string>
): GraphNode {
  const baseId = sanitizeText(partial.id) || `node-${slug(partial.label || "") || index}`;
  let id = baseId;
  let suffix = 2;
  while (idSet.has(id)) {
    id = `${baseId}-${suffix++}`;
  }
  idSet.add(id);
  const rawLabel = sanitizeText(partial.label, `Untitled ${index + 1}`);
  const label =
    rawLabel.length > 64 ? `${rawLabel.slice(0, 61).trimEnd()}...` : rawLabel;
  const rawSummary = sanitizeText(partial.summary);
  const summary =
    rawSummary.length > 240 ? `${rawSummary.slice(0, 237).trimEnd()}...` : rawSummary;
  return {
    id,
    label,
    kind: sanitizeText(partial.kind, "fact"),
    summary,
    confidence: clamp01(partial.confidence, 0.75),
    source: sanitizeText(partial.source, "manual"),
    tags: Array.isArray(partial.tags)
      ? partial.tags
          .map((t) => sanitizeText(t))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    x: Number.isFinite(partial.x) ? Number(partial.x) : (index % 4) * 280,
    y: Number.isFinite(partial.y) ? Number(partial.y) : Math.floor(index / 4) * 150,
  };
}

function normalizeGraph(input: unknown): KnowledgeGraph {
  const raw = (input || {}) as Partial<KnowledgeGraph>;
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const idSet = new Set<string>();
  const nodes = rawNodes.map((n, idx) => buildGraphNode((n || {}) as Partial<GraphNode>, idx, idSet));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeIdSet = new Set<string>();
  const edges: GraphEdge[] = [];

  for (let i = 0; i < rawEdges.length; i++) {
    const e = (rawEdges[i] || {}) as Partial<GraphEdge>;
    const source = sanitizeText(e.source);
    const target = sanitizeText(e.target);
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) continue;
    let id = sanitizeText(e.id, `edge-${slug(source)}-${slug(target)}-${i + 1}`);
    let suffix = 2;
    while (edgeIdSet.has(id)) id = `${id}-${suffix++}`;
    edgeIdSet.add(id);
    edges.push({
      id,
      source,
      target,
      relation: sanitizeText(e.relation, "related_to"),
      weight: clamp01(e.weight, 0.7),
      evidence: sanitizeText(e.evidence),
    });
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
    meta: {
      workspace: WORKSPACE,
      materializedPath: GRAPH_MD_PATH,
      jsonPath: GRAPH_JSON_PATH,
    },
  };
}

type ExtractedFact = {
  topic: string;
  text: string;
  label: string;
  kind: "fact" | "profile" | "task" | "project" | "person";
  relation: string;
};

function cleanMarkdownInline(input: string): string {
  return sanitizeText(input)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseWords(words: string[]): string {
  return words
    .map((w) => (w.length <= 3 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function toConceptLabel(raw: string): string {
  const cleaned = cleanMarkdownInline(raw)
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "");
  if (!cleaned) return "Concept";

  const keyValue = cleaned.match(/^([^:]{2,48}):\s+(.+)$/);
  if (keyValue?.[1]) {
    return keyValue[1].slice(0, 56);
  }

  const phrase = cleaned
    .split(/[.!?;]+/)
    .map((s) => s.trim())
    .find(Boolean) || cleaned;
  const words = phrase.split(/\s+/).filter(Boolean);
  const compact = titleCaseWords(words.slice(0, 7));
  const label = compact || phrase;
  return label.length > 56 ? `${label.slice(0, 53)}...` : label;
}

function inferConceptKind(
  text: string,
  topic: string
): { kind: ExtractedFact["kind"]; relation: string } {
  const blob = `${topic} ${text}`.toLowerCase();
  if (
    blob.includes("preference") ||
    blob.includes("prefer ") ||
    blob.includes("tone") ||
    blob.includes("style") ||
    blob.includes("rule") ||
    blob.includes("never ")
  ) {
    return { kind: "profile", relation: "captures_preference" };
  }
  if (
    blob.includes("follow-up") ||
    blob.includes("todo") ||
    blob.includes("to do") ||
    blob.includes("next step") ||
    blob.includes("optionally ") ||
    blob.includes("need to ")
  ) {
    return { kind: "task", relation: "action_item" };
  }
  if (
    blob.includes("project") ||
    blob.includes("setup") ||
    blob.includes("config") ||
    blob.includes("dashboard") ||
    blob.includes("integration")
  ) {
    return { kind: "project", relation: "project_signal" };
  }
  if (
    blob.includes("@") ||
    blob.includes("name") ||
    blob.includes("human") ||
    blob.includes("assistant")
  ) {
    return { kind: "person", relation: "about_entity" };
  }
  return { kind: "fact", relation: "supports" };
}

function normalizeTopic(raw: string): string {
  const t = cleanMarkdownInline(raw).replace(/^\d{4}-\d{2}-\d{2}\s*[-–]?\s*/g, "");
  if (!t) return "General";
  return t.length > 48 ? `${t.slice(0, 45)}...` : t;
}

function canonicalizeFact(text: string): string {
  return cleanMarkdownInline(text)
    .toLowerCase()
    .replace(/\b(a|an|the|to|for|and|or|of|in|on|at|by|with)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function parseMarkdownFacts(markdown: string, maxFacts = 40): {
  topics: string[];
  facts: ExtractedFact[];
} {
  const topics: string[] = [];
  const facts: ExtractedFact[] = [];
  const factSet = new Set<string>();
  let currentTopic = "General";

  const addTopic = (topic: string) => {
    const t = normalizeTopic(topic);
    if (t && !topics.includes(t)) topics.push(t);
    currentTopic = t || "General";
  };

  const addFact = (topic: string, text: string) => {
    if (facts.length >= maxFacts) return;
    const clean = cleanMarkdownInline(text);
    if (!clean) return;
    const dedupeKey = `${topic.toLowerCase()}::${clean.toLowerCase()}`;
    if (factSet.has(dedupeKey)) return;
    factSet.add(dedupeKey);
    const label = toConceptLabel(clean);
    const inferred = inferConceptKind(clean, topic);
    facts.push({
      topic,
      text: clean.length > 220 ? `${clean.slice(0, 217)}...` : clean,
      label,
      kind: inferred.kind,
      relation: inferred.relation,
    });
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,4}\s+(.+)/);
    if (heading) {
      addTopic(heading[1]);
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)/);
    if (bullet?.[1]) {
      addFact(currentTopic, bullet[1]);
      if (facts.length >= maxFacts) break;
      continue;
    }
    const kv = line.match(/^\s*([A-Za-z][^:]{1,36}):\s+(.+)/);
    if (kv?.[1] && kv?.[2]) {
      addFact(currentTopic, `${kv[1]}: ${kv[2]}`);
      if (facts.length >= maxFacts) break;
    }
  }

  return { topics, facts };
}

function bootstrapGraph(memoryMd: string, journalFiles: BootstrapFile[], agents: CliAgentRow[] = []): KnowledgeGraph {
  const inputFiles: BootstrapFile[] = [
    ...(memoryMd.trim()
      ? [{ name: "MEMORY.md", content: memoryMd, source: "filesystem" as const }]
      : []),
    ...journalFiles,
  ];

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const ids = new Set<string>();
  const edgeIds = new Set<string>();
  const globalTopicMap = new Map<string, string>();
  const emittedFacts = new Set<string>();

  const root = buildGraphNode(
    {
      id: "memory-core",
      label: "OpenClaw Memory Core",
      kind: "system",
      summary: "High-signal long-term memory distilled from MEMORY.md and recent journals.",
      confidence: 1,
      source: "bootstrap",
      x: 40,
      y: 80,
      tags: ["memory", "core"],
    },
    0,
    ids
  );
  nodes.push(root);

  let factCounter = 0;
  let topicCounter = 0;
  let fileCounter = 0;

  const pushEdge = (partial: Omit<GraphEdge, "id">, hint: string) => {
    let id = hint;
    let suffix = 2;
    while (edgeIds.has(id)) id = `${hint}-${suffix++}`;
    edgeIds.add(id);
    edges.push({ id, ...partial });
  };

  for (const file of inputFiles.slice(0, 14)) {
    const fileNode = buildGraphNode(
      {
        id: `file-${slug(file.name)}`,
        label: file.name,
        kind: "project",
        summary:
          file.source === "indexed"
            ? "Derived from vector-indexed memory chunks."
            : "Derived from memory markdown content.",
        confidence: file.source === "indexed" ? 0.96 : 0.8,
        source: file.source,
        x: 300,
        y: 70 + fileCounter * 135,
        tags: ["memory-file", file.source],
      },
      nodes.length,
      ids
    );
    fileCounter++;
    nodes.push(fileNode);
    pushEdge(
      {
        source: root.id,
        target: fileNode.id,
        relation: "contains_file",
        weight: 0.86,
        evidence: file.name,
      },
      `edge-${root.id}-${fileNode.id}`
    );

    const { topics, facts } = parseMarkdownFacts(file.content, 22);
    const localTopicMap = new Map<string, string>();

    topics.slice(0, 10).forEach((topic) => {
      const key = topic.toLowerCase();
      let topicId = globalTopicMap.get(key);
      if (!topicId) {
        const topicNode = buildGraphNode(
          {
            id: `topic-${slug(topic)}`,
            label: topic,
            kind: "topic",
            summary: "",
            confidence: 0.88,
            source: "bootstrap",
            x: 620,
            y: 60 + topicCounter * 110,
          },
          nodes.length,
          ids
        );
        topicCounter++;
        nodes.push(topicNode);
        topicId = topicNode.id;
        globalTopicMap.set(key, topicId);
        pushEdge(
          {
            source: root.id,
            target: topicId,
            relation: "contains_topic",
            weight: 0.82,
            evidence: topic,
          },
          `edge-${root.id}-${topicId}`
        );
      }
      localTopicMap.set(topic, topicId);
      pushEdge(
        {
          source: fileNode.id,
          target: topicId,
          relation: "mentions_topic",
          weight: 0.7,
          evidence: file.name,
        },
        `edge-${fileNode.id}-${topicId}`
      );
    });

    facts.slice(0, 28).forEach((fact) => {
      const factText = sanitizeText(fact.text);
      const dedupeKey = `${fact.topic.toLowerCase()}::${factText.toLowerCase()}`;
      if (emittedFacts.has(dedupeKey)) return;
      emittedFacts.add(dedupeKey);

      const node = buildGraphNode(
        {
          id: `fact-${slug(file.name)}-${slug(factText)}-${factCounter + 1}`,
          label: fact.label,
          kind: fact.kind,
          summary: factText,
          confidence: file.source === "indexed" ? 0.86 : 0.72,
          source: file.name,
          x: 940 + (factCounter % 2) * 240,
          y: 60 + Math.floor(factCounter / 2) * 82,
          tags: [`file:${file.name}`],
        },
        nodes.length,
        ids
      );
      factCounter++;
      nodes.push(node);
      pushEdge(
        {
          source: localTopicMap.get(fact.topic) || fileNode.id,
          target: node.id,
          relation: fact.relation,
          weight: file.source === "indexed" ? 0.8 : 0.7,
          evidence: file.name,
        },
        `edge-fact-${node.id}`
      );
    });
  }

  // Agent nodes — one per configured agent, connected to root
  agents.forEach((agent, agentIdx) => {
    const agentId = String(agent.id || `agent-${agentIdx}`);
    const agentLabel = safeAgentName(agent);
    const isDefault = Boolean(agent.isDefault);
    const agentNode = buildGraphNode(
      {
        id: `agent-${slug(agentId)}`,
        label: agentLabel,
        kind: "agent",
        summary: isDefault ? "Default OpenClaw agent." : `OpenClaw agent: ${agentId}`,
        confidence: 0.95,
        source: "agents",
        x: 40,
        y: 260 + agentIdx * 120,
        tags: ["agent", ...(isDefault ? ["default"] : [])],
      },
      nodes.length,
      ids
    );
    nodes.push(agentNode);
    pushEdge(
      {
        source: root.id,
        target: agentNode.id,
        relation: "managed_by",
        weight: 0.9,
        evidence: agentId,
      },
      `edge-${root.id}-${agentNode.id}`
    );
  });

  if (nodes.length <= 1) {
    const sampleA = buildGraphNode(
      {
        id: "entity-user-preferences",
        label: "User Preferences",
        kind: "profile",
        summary: "Store stable preferences, style, constraints, and important context.",
        source: "template",
        confidence: 0.9,
        x: 360,
        y: 120,
      },
      nodes.length,
      ids
    );
    const sampleB = buildGraphNode(
      {
        id: "entity-project-context",
        label: "Project Context",
        kind: "project",
        summary: "Active tasks, architecture notes, and key decisions.",
        source: "template",
        confidence: 0.85,
        x: 680,
        y: 260,
      },
      nodes.length + 1,
      ids
    );
    nodes.push(sampleA, sampleB);
    edges.push(
      {
        id: "edge-root-sample-a",
        source: root.id,
        target: sampleA.id,
        relation: "tracks",
        weight: 0.8,
        evidence: "",
      },
      {
        id: "edge-root-sample-b",
        source: root.id,
        target: sampleB.id,
        relation: "tracks",
        weight: 0.8,
        evidence: "",
      }
    );
  }

  return normalizeGraph({ nodes, edges });
}

function graphToMarkdown(graph: KnowledgeGraph): string {
  const entityLines = graph.nodes
    .map((n) => {
      const tags = n.tags.length ? ` | tags: ${n.tags.join(", ")}` : "";
      const summary = n.summary ? ` - ${n.summary}` : "";
      return `- **${n.label}** (\`${n.kind}\`)${summary}${tags}`;
    })
    .join("\n");

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const relationLines = graph.edges
    .map((e) => {
      const from = nodeById.get(e.source)?.label || e.source;
      const to = nodeById.get(e.target)?.label || e.target;
      const weight = Number.isFinite(e.weight) ? ` (${Math.round(e.weight * 100)}%)` : "";
      const evidence = e.evidence ? ` — evidence: ${e.evidence}` : "";
      return `- **${from}** --\`${e.relation}\`--> **${to}**${weight}${evidence}`;
    })
    .join("\n");

  const triples = graph.edges
    .map((e) => {
      const from = nodeById.get(e.source)?.label || e.source;
      const to = nodeById.get(e.target)?.label || e.target;
      return `- ${from} | ${e.relation} | ${to}`;
    })
    .join("\n");

  return [
    "# Knowledge Graph Memory",
    "",
    `Generated: ${graph.updatedAt}`,
    "",
    "This file is generated from Mission Control knowledge graph editing.",
    "",
    "## Entities",
    entityLines || "- _No entities yet_",
    "",
    "## Relations",
    relationLines || "- _No relations yet_",
    "",
    "## Retrieval Triples",
    triples || "- _No triples yet_",
    "",
  ].join("\n");
}

function buildSnapshotSection(graph: KnowledgeGraph): string {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const topNodes = [...graph.nodes]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12)
    .map((n) => `- **${n.label}** (\`${n.kind}\`)${n.summary ? ` — ${n.summary}` : ""}`);

  const topEdges = [...graph.edges]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20)
    .map((e) => {
      const from = nodeById.get(e.source)?.label || e.source;
      const to = nodeById.get(e.target)?.label || e.target;
      return `- ${from} --${e.relation}--> ${to}`;
    });

  return [
    "## Knowledge Graph Snapshot",
    "",
    `_Generated: ${graph.updatedAt}_`,
    "",
    "### High-Signal Entities",
    topNodes.join("\n") || "- _None_",
    "",
    "### High-Signal Relations",
    topEdges.join("\n") || "- _None_",
    "",
  ].join("\n");
}

function upsertSnapshot(raw: string, section: string): string {
  const block = `${SNAPSHOT_START}\n${section}\n${SNAPSHOT_END}`;
  const start = raw.indexOf(SNAPSHOT_START);
  const end = raw.indexOf(SNAPSHOT_END);
  if (start !== -1 && end !== -1 && end > start) {
    const tailStart = end + SNAPSHOT_END.length;
    return `${raw.slice(0, start).trimEnd()}\n\n${block}\n${raw.slice(tailStart).trimStart()}`;
  }
  const base = raw.trimEnd();
  return `${base}${base ? "\n\n" : ""}${block}\n`;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function readRecentJournalFiles(limit = 8): Promise<BootstrapFile[]> {
  try {
    const entries = await readdir(MEMORY_DIR, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isFile() && /^\d{4}-\d{2}-\d{2}.*\.md$/i.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
      .slice(0, limit);
    const chunks: BootstrapFile[] = [];
    for (const name of names) {
      try {
        const content = await readFile(join(MEMORY_DIR, name), "utf-8");
        chunks.push({ name, content: content.slice(0, 9000), source: "filesystem" });
      } catch {
        // skip
      }
    }
    return chunks;
  } catch {
    return [];
  }
}

async function readIndexedMemoryFiles(limit = 12): Promise<BootstrapFile[]> {
  try {
    const statuses = await runCliJson<MemoryStatusRow[]>(["memory", "status"], 12000);
    const match = statuses.find((s) => s.status?.workspaceDir === WORKSPACE);
    const dbPath = match?.status?.dbPath;
    if (!dbPath) return [];

    // Query all indexed markdown chunks regardless of source so workspace
    // reference files (VERSA_BRAND_PROFILE.md, AGENTS.md, etc.) are included.
    const sql = [
      "select c.path as path, c.start_line as start_line, c.text as text, f.mtime as mtime",
      "from chunks c",
      "join files f on c.path = f.path and c.source = f.source",
      "order by f.mtime desc, c.path asc, c.start_line asc;",
    ].join(" ");

    const { stdout } = await exec("sqlite3", ["-json", dbPath, sql], { timeout: 15000 });
    const rows = JSON.parse(stdout || "[]") as IndexedChunkRow[];
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const grouped = new Map<string, { name: string; parts: string[]; chars: number }>();
    for (const row of rows) {
      const path = sanitizeText(row.path);
      if (!path || !path.endsWith(".md")) continue;
      if (!grouped.has(path)) {
        if (grouped.size >= limit) continue;
        grouped.set(path, { name: basename(path), parts: [], chars: 0 });
      }
      const entry = grouped.get(path);
      if (!entry) continue;
      const chunkRaw = typeof row.text === "string" ? row.text : "";
      const chunk = chunkRaw.replace(/\r\n?/g, "\n").trim();
      if (!chunk) continue;
      if (entry.chars > 11000) continue;
      entry.parts.push(chunk);
      entry.chars += chunk.length;
    }

    return [...grouped.values()]
      .filter((f) => f.parts.length > 0)
      .map((f) => ({ name: f.name, content: f.parts.join("\n\n"), source: "indexed" as const }));
  } catch {
    return [];
  }
}

async function bestEffortReindex(): Promise<{ indexed: boolean; error?: string }> {
  try {
    await runCli(["memory", "index"], 20000);
    return { indexed: true };
  } catch (err) {
    return { indexed: false, error: String(err) };
  }
}

function toEpochMs(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num < 1_000_000_000_000 ? Math.trunc(num * 1000) : Math.trunc(num);
}

function extractMessageText(msg: GatewayMessage): string {
  const chunks = Array.isArray(msg.content) ? msg.content : [];
  return chunks
    .filter((chunk) => chunk?.type === "text" && typeof chunk.text === "string")
    .map((chunk) => String(chunk.text))
    .join("\n")
    .trim();
}

function extractEvidenceFromMarkdown(content: string, maxChunks = 120): {
  chunks: SourceChunk[];
  facts: SourceFact[];
} {
  const chunks: SourceChunk[] = [];
  const facts: SourceFact[] = [];
  const seenFacts = new Set<string>();
  let topic = "General";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");

  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineNo = idx + 1;
    const raw = lines[idx] || "";
    const line = raw.trim();
    if (!line) continue;

    const heading = line.match(/^#{1,4}\s+(.+)/);
    if (heading?.[1]) {
      topic = normalizeTopic(heading[1]);
      if (chunks.length < maxChunks) {
        chunks.push({
          id: `chunk-heading-${lineNo}-${slug(topic)}`,
          topic,
          kind: "heading",
          text: topic,
          startLine: lineNo,
          endLine: lineNo,
        });
      }
      continue;
    }

    const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)/);
    const kv = line.match(/^\s*([A-Za-z][^:]{1,48}):\s+(.+)/);
    const text = cleanMarkdownInline(bullet?.[1] || (kv ? `${kv[1]}: ${kv[2]}` : line));
    if (!text) continue;

    if (chunks.length < maxChunks) {
      chunks.push({
        id: `chunk-${lineNo}-${slug(text)}`,
        topic,
        kind: bullet || kv ? "bullet" : "paragraph",
        text: text.length > 280 ? `${text.slice(0, 277)}...` : text,
        startLine: lineNo,
        endLine: lineNo,
      });
    }

    if (bullet || kv) {
      const canonical = canonicalizeFact(text);
      const factKey = `${topic.toLowerCase()}::${canonical}`;
      if (!canonical || seenFacts.has(factKey)) continue;
      seenFacts.add(factKey);
      facts.push({
        id: `fact-${lineNo}-${slug(canonical)}`,
        topic,
        statement: text.length > 360 ? `${text.slice(0, 357)}...` : text,
        canonical,
        line: lineNo,
        confidenceHint: kv ? 0.8 : 0.72,
      });
    }
  }

  return { chunks, facts };
}

function collectGraphSourceHints(graph: KnowledgeGraph): Set<string> {
  const out = new Set<string>();
  for (const node of graph.nodes) {
    const source = sanitizeText(node.source).toLowerCase();
    if (
      source &&
      source !== "bootstrap" &&
      source !== "manual" &&
      source !== "template" &&
      source !== "filesystem"
    ) {
      out.add(source);
    }
    for (const tag of node.tags || []) {
      if (!tag.startsWith("file:")) continue;
      const hint = sanitizeText(tag.slice("file:".length)).toLowerCase();
      if (hint) out.add(hint);
    }
  }
  for (const edge of graph.edges) {
    const evidence = sanitizeText(edge.evidence).toLowerCase();
    if (evidence.endsWith(".md")) out.add(evidence);
  }
  out.add("memory.md");
  return out;
}

async function readSourceDocumentsForGraph(graph: KnowledgeGraph, limit = 20): Promise<SourceDocument[]> {
  const docs: SourceDocument[] = [];
  const byLowerName = new Set<string>();
  const sourceHints = collectGraphSourceHints(graph);

  const pushDoc = async (name: string, path: string, source: "workspace" | "memory") => {
    const lower = name.toLowerCase();
    if (!name.endsWith(".md") || byLowerName.has(lower)) return;
    try {
      const [fileStat, content] = await Promise.all([stat(path), readFile(path, "utf-8")]);
      if (!fileStat.isFile()) return;
      const parsed = extractEvidenceFromMarkdown(content, 140);
      docs.push({
        id: `doc-${slug(name)}`,
        name,
        path,
        source,
        mtimeMs: fileStat.mtimeMs || 0,
        size: fileStat.size || Buffer.byteLength(content, "utf-8"),
        chunks: parsed.chunks,
        facts: parsed.facts,
      });
      byLowerName.add(lower);
    } catch {
      // Ignore per-file read errors.
    }
  };

  await pushDoc("MEMORY.md", MEMORY_MD_PATH, "workspace");

  // All root-level .md files in the workspace (sorted alphabetically, MEMORY.md excluded)
  try {
    const entries = await readdir(WORKSPACE, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "MEMORY.md" && e.name !== "memory.md")
      .map((e) => e.name)
      .sort();
    for (const name of names) {
      await pushDoc(name, join(WORKSPACE, name), "workspace");
    }
  } catch {
    // ignore missing workspace dir
  }

  try {
    const entries = await readdir(MEMORY_DIR, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => entry.name);
    for (const name of names) {
      await pushDoc(name, join(MEMORY_DIR, name), "memory");
    }
  } catch {
    // ignore missing memory dir
  }

  return docs
    .sort((a, b) => {
      const aHint = sourceHints.has(a.name.toLowerCase()) ? 1 : 0;
      const bHint = sourceHints.has(b.name.toLowerCase()) ? 1 : 0;
      if (aHint !== bHint) return bHint - aHint;
      return b.mtimeMs - a.mtimeMs;
    })
    .slice(0, limit);
}

async function readRecentChatMessages(limitSessions = 8, perSessionLimit = 40): Promise<RecentChatMessage[]> {
  try {
    const sessionsResult = await gatewayCall<SessionsListResult>("sessions.list", undefined, 10000);
    const sessions = Array.isArray(sessionsResult.sessions) ? sessionsResult.sessions : [];
    const ranked = sessions
      .map((session) => ({
        key: sanitizeText(session.key),
        updatedAtMs: toEpochMs(session.updatedAt),
      }))
      .filter((session) => session.key.startsWith("agent:"))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, limitSessions);

    const histories = await Promise.all(
      ranked.map(async (session) => {
        try {
          const history = await gatewayCall<ChatHistoryResult>(
            "chat.history",
            { sessionKey: session.key, limit: perSessionLimit },
            10000
          );
          const rows = Array.isArray(history.messages) ? history.messages : [];
          return rows
            .map((msg) => ({
              sessionKey: session.key,
              role: sanitizeText(msg.role, "unknown"),
              timestampMs: toEpochMs(msg.timestamp),
              text: extractMessageText(msg),
            }))
            .filter((msg) => msg.text.length > 0);
        } catch {
          return [] as RecentChatMessage[];
        }
      })
    );

    return histories
      .flat()
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, limitSessions * perSessionLimit);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") || "";
    const forceBootstrap = mode === "bootstrap";
    const raw = await readOptional(GRAPH_JSON_PATH);
    let graph: KnowledgeGraph;
    let bootstrapInfo:
      | {
          source: "indexed" | "filesystem";
          files: string[];
        }
      | undefined;

    const agents = await getCliAgents();

    // Read all workspace root .md files from disk (always, regardless of index state)
    const workspaceRootFiles: BootstrapFile[] = [];
    try {
      const entries = await readdir(WORKSPACE, { withFileTypes: true });
      const names = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "MEMORY.md" && e.name !== "memory.md")
        .map((e) => e.name)
        .sort();
      for (const name of names) {
        try {
          const content = await readFile(join(WORKSPACE, name), "utf-8");
          workspaceRootFiles.push({ name, content: content.slice(0, 11000), source: "filesystem" });
        } catch { /* skip unreadable files */ }
      }
    } catch { /* workspace unreadable */ }

    // Fire-and-forget: ensure workspace root files are in the vector index
    void runCli(["memory", "index"], 45000).catch(() => {});

    if (raw && !forceBootstrap) {
      graph = normalizeGraph(JSON.parse(raw));
      // Inject any workspace files / agents that are missing from the saved graph
      const existingIds = new Set(graph.nodes.map((n) => n.id));
      const existingEdgeIds = new Set(graph.edges.map((e) => e.id));
      const rootId = graph.nodes.find((n) => n.id === "memory-core")?.id ?? "memory-core";
      const inject: { nodes: GraphNode[]; edges: GraphEdge[] } = { nodes: [], edges: [] };

      workspaceRootFiles.forEach((file, idx) => {
        const nodeId = `file-${slug(file.name)}`;
        if (existingIds.has(nodeId)) return;
        existingIds.add(nodeId);
        inject.nodes.push({
          id: nodeId, label: file.name, kind: "project",
          summary: "Workspace reference file.", confidence: 0.9, source: "filesystem",
          tags: ["workspace-file"], x: 280, y: 320 + idx * 110,
        });
        const edgeId = `edge-root-ws-${nodeId}`;
        if (!existingEdgeIds.has(edgeId)) {
          inject.edges.push({ id: edgeId, source: rootId, target: nodeId, relation: "contains_file", weight: 0.85, evidence: file.name });
        }
      });

      agents.forEach((agent, idx) => {
        const nodeId = `agent-${slug(String(agent.id || idx))}`;
        if (existingIds.has(nodeId)) return;
        existingIds.add(nodeId);
        inject.nodes.push({
          id: nodeId, label: safeAgentName(agent), kind: "agent",
          summary: "OpenClaw agent.", confidence: 0.95, source: "agents",
          tags: ["agent"], x: 40, y: 280 + idx * 120,
        });
        const edgeId = `edge-root-agent-${nodeId}`;
        if (!existingEdgeIds.has(edgeId)) {
          inject.edges.push({ id: edgeId, source: rootId, target: nodeId, relation: "managed_by", weight: 0.9, evidence: String(agent.id || "") });
        }
      });

      if (inject.nodes.length > 0) {
        graph = normalizeGraph({ ...graph, nodes: [...graph.nodes, ...inject.nodes], edges: [...graph.edges, ...inject.edges] });
      }
    } else {
      const memoryMd = (await readOptional(MEMORY_MD_PATH)) || "";
      const indexed = await readIndexedMemoryFiles(12);
      const fallbackFiles = indexed.length ? [] : await readRecentJournalFiles(10);
      const indexedOrFallback = indexed.length ? indexed : fallbackFiles;
      // Merge: indexed/fallback files + workspace root files (deduplicated by name)
      const indexedNames = new Set(indexedOrFallback.map((f) => f.name));
      const extraWorkspace = workspaceRootFiles.filter((f) => !indexedNames.has(f.name));
      const seedFiles = [...indexedOrFallback, ...extraWorkspace];
      graph = bootstrapGraph(memoryMd, seedFiles, agents);
      bootstrapInfo = {
        source: indexed.length ? "indexed" : "filesystem",
        files: seedFiles.map((f) => f.name),
      };
    }
    const telemetry: GraphTelemetry = {
      generatedAt: new Date().toISOString(),
      sourceDocuments: await readSourceDocumentsForGraph(graph, 24),
      recentChatMessages: await readRecentChatMessages(8, 50),
    };

    return NextResponse.json({
      graph,
      bootstrap: bootstrapInfo,
      telemetry,
      workspace: WORKSPACE,
      paths: {
        json: GRAPH_JSON_PATH,
        markdown: GRAPH_MD_PATH,
        memory: MEMORY_MD_PATH,
      },
    });
  } catch (err) {
    console.error("Memory graph GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action || "save");
    const graph = normalizeGraph(body.graph);
    graph.updatedAt = new Date().toISOString();

    if (action === "save") {
      await mkdir(MEMORY_DIR, { recursive: true });
      await writeFile(GRAPH_JSON_PATH, JSON.stringify(graph, null, 2), "utf-8");
      await writeFile(GRAPH_MD_PATH, graphToMarkdown(graph), "utf-8");
      const reindex = body.reindex !== false;
      const reindexResult = reindex ? await bestEffortReindex() : { indexed: false };
      return NextResponse.json({
        ok: true,
        action,
        graph,
        materialized: GRAPH_MD_PATH,
        ...reindexResult,
      });
    }

    if (action === "publish-memory-md") {
      const current = (await readOptional(MEMORY_MD_PATH)) || "";
      const next = upsertSnapshot(current, buildSnapshotSection(graph));
      await writeFile(MEMORY_MD_PATH, next, "utf-8");
      const reindex = body.reindex !== false;
      const reindexResult = reindex ? await bestEffortReindex() : { indexed: false };
      return NextResponse.json({
        ok: true,
        action,
        published: MEMORY_MD_PATH,
        ...reindexResult,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("Memory graph POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
