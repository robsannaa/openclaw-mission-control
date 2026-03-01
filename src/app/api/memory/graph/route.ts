import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { basename, join } from "path";
import { getDefaultWorkspaceSync, getOpenClawHome } from "@/lib/paths";
import { gatewayCall, runCli, runCliJson } from "@/lib/openclaw";

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
  fact?: string;
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
    const edgeEntry: GraphEdge = {
      id,
      source,
      target,
      relation: sanitizeText(e.relation, "related_to"),
      weight: clamp01(e.weight, 0.7),
      evidence: sanitizeText(e.evidence),
    };
    if (typeof (e as Partial<GraphEdge>).fact === "string") {
      edgeEntry.fact = sanitizeText((e as Partial<GraphEdge>).fact!).slice(0, 300) || undefined;
    }
    edges.push(edgeEntry);
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

// ── Markdown parsing helpers (used by extractEvidenceFromMarkdown / telemetry) ─

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

// ── LLM Knowledge Extraction ─────────────────────────────────────────────────

type LLMEntity = { name: string; type: string; summary: string };
type LLMRelation = {
  subject: string;
  predicate: string;
  object: string;
  fact: string;
  confidence: number;
};
type LLMExtractionResult = { entities: LLMEntity[]; relations: LLMRelation[] };

const VALID_ENTITY_TYPES = new Set(["person", "project", "tool", "concept", "preference"]);

const EXTRACTION_SYSTEM_PROMPT = `Extract a rich knowledge graph from text. Return ONLY a JSON object with this exact schema:
{
  "entities": [{"name": "string", "type": "person|project|tool|concept|preference", "summary": "string"}],
  "relations": [{"subject": "string", "predicate": "string", "object": "string", "fact": "string", "confidence": 0.0}]
}

Rules:
- Extract ALL meaningful named entities — be thorough, not just the most obvious ones
- subject and object must be entity names from your entities list
- Skip bare markdown formatting artifacts and meaningless placeholders
- person: named humans, roles, contacts (use "User" for the person writing these notes)
- project: software projects, apps, products, stores, businesses, brands, repositories
- tool: libraries, frameworks, CLIs, APIs, databases, services, platforms, skills, integrations
- concept: ideas, patterns, methodologies, markets, locations, business domains, strategies
- preference: explicit rules, constraints, or strong preferences ("always use X", "never do Y")
- predicates should be short action verbs: uses, prefers, owns, maintains, built_with, integrates, targets, sells_to, located_in, depends_on, manages

Example input: "User prefers TypeScript. The second-brain project uses Next.js and SQLite."
Example output: {"entities":[{"name":"User","type":"person","summary":"The developer"},{"name":"second-brain","type":"project","summary":"Next.js knowledge management app"},{"name":"TypeScript","type":"tool","summary":"Programming language"},{"name":"Next.js","type":"tool","summary":"React framework"},{"name":"SQLite","type":"tool","summary":"Embedded database"}],"relations":[{"subject":"User","predicate":"prefers","object":"TypeScript","fact":"User prefers TypeScript","confidence":0.95},{"subject":"second-brain","predicate":"uses","object":"Next.js","fact":"second-brain uses Next.js","confidence":0.9},{"subject":"second-brain","predicate":"uses","object":"SQLite","fact":"second-brain uses SQLite","confidence":0.9}]}`;

function validateExtractionResult(data: unknown): LLMExtractionResult {
  if (!data || typeof data !== "object") return { entities: [], relations: [] };
  const d = data as Record<string, unknown>;

  const entities: LLMEntity[] = Array.isArray(d.entities)
    ? (d.entities as unknown[])
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .filter((e) => typeof e.name === "string" && e.name.length > 0)
        .map((e) => ({
          name: String(e.name).trim(),
          type: VALID_ENTITY_TYPES.has(String(e.type)) ? String(e.type) : "concept",
          summary: typeof e.summary === "string" ? e.summary.trim().slice(0, 200) : "",
        }))
    : [];

  const relations: LLMRelation[] = Array.isArray(d.relations)
    ? (d.relations as unknown[])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .filter(
          (r) =>
            typeof r.subject === "string" && r.subject.length > 0 &&
            typeof r.predicate === "string" && r.predicate.length > 0 &&
            typeof r.object === "string" && r.object.length > 0
        )
        .map((r) => ({
          subject: String(r.subject).trim(),
          predicate: String(r.predicate).trim(),
          object: String(r.object).trim(),
          fact:
            typeof r.fact === "string" && r.fact.trim()
              ? r.fact.trim().slice(0, 300)
              : `${r.subject} ${r.predicate} ${r.object}`,
          confidence:
            typeof r.confidence === "number"
              ? Math.min(1, Math.max(0, r.confidence))
              : 0.75,
        }))
    : [];

  return { entities, relations };
}

async function resolveOpenAiKey(): Promise<string | undefined> {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const envPath = join(getOpenClawHome(), ".env");
    const raw = await readFile(envPath, "utf-8");
    const match = raw.match(/^OPENAI_API_KEY=(.+)$/m);
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function extractEntitiesFromFile(
  content: string
): Promise<LLMExtractionResult> {
  const apiKey = await resolveOpenAiKey();
  if (!apiKey) return { entities: [], relations: [] };

  const truncated = content.slice(0, 8000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: truncated },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return { entities: [], relations: [] };
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return { entities: [], relations: [] };
    return validateExtractionResult(JSON.parse(raw) as unknown);
  } catch {
    return { entities: [], relations: [] };
  }
}

function canonicalEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function buildLlmGraph(
  files: BootstrapFile[],
  agents: CliAgentRow[]
): Promise<KnowledgeGraph & { extractionError?: string }> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const ids = new Set<string>();
  const edgeIds = new Set<string>();

  const pushEdge = (partial: Omit<GraphEdge, "id">, hint: string) => {
    let id = hint;
    let suffix = 2;
    while (edgeIds.has(id)) id = `${hint}-${suffix++}`;
    edgeIds.add(id);
    edges.push({ id, ...partial });
  };

  // Root node
  const root = buildGraphNode(
    {
      id: "memory-core",
      label: "OpenClaw Memory Core",
      kind: "system",
      summary: "Knowledge graph extracted from memory files via LLM.",
      confidence: 1,
      source: "bootstrap",
      tags: ["memory", "core"],
      x: 40,
      y: 80,
    },
    0,
    ids
  );
  nodes.push(root);

  const openAiKey = await resolveOpenAiKey();
  const hasApiKey = Boolean(openAiKey);
  let extractionError: string | undefined;
  if (!hasApiKey) {
    extractionError =
      "OPENAI_API_KEY not configured. Set it to enable LLM knowledge extraction.";
  }

  // Entity dedup map: canonicalName → nodeId
  const entityMap = new Map<string, string>();

  const ensureEntity = (
    name: string,
    type: string,
    summary: string,
    sourceFile: string
  ): string | null => {
    if (!name) return null;
    const canon = canonicalEntityName(name);
    if (!canon) return null;
    if (entityMap.has(canon)) return entityMap.get(canon)!;

    const entityNode = buildGraphNode(
      {
        id: `entity-${slug(name)}`,
        label: name,
        kind: type,
        summary: summary.slice(0, 200),
        confidence: 0.85,
        source: sourceFile,
        tags: [type],
        x: 400 + (nodes.length % 5) * 240,
        y: 80 + Math.floor(nodes.length / 5) * 120,
      },
      nodes.length,
      ids
    );
    nodes.push(entityNode);
    entityMap.set(canon, entityNode.id);
    return entityNode.id;
  };

  // Process files
  if (hasApiKey) {
    for (const file of files) {
      const result = await extractEntitiesFromFile(file.content);

      for (const entity of result.entities) {
        ensureEntity(entity.name, entity.type, entity.summary, file.name);
      }

      for (const rel of result.relations) {
        const sourceId = entityMap.get(canonicalEntityName(rel.subject));
        const targetId = entityMap.get(canonicalEntityName(rel.object));
        if (!sourceId || !targetId || sourceId === targetId) continue;

        pushEdge(
          {
            source: sourceId,
            target: targetId,
            relation: rel.predicate,
            weight: clamp01(rel.confidence, 0.75),
            evidence: file.name,
            fact: rel.fact,
          },
          `edge-${slug(rel.subject)}-${slug(rel.predicate)}-${slug(rel.object)}`
        );
      }
    }
  }

  // Agent nodes
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
        tags: ["agent", ...(isDefault ? ["default"] : [])],
        x: 40,
        y: 260 + agentIdx * 120,
      },
      nodes.length,
      ids
    );
    nodes.push(agentNode);
    pushEdge(
      { source: root.id, target: agentNode.id, relation: "managed_by", weight: 0.9, evidence: agentId },
      `edge-${root.id}-${agentNode.id}`
    );
  });

  // Template if nothing was extracted
  if (nodes.length <= 1 + agents.length) {
    const sampleA = buildGraphNode(
      {
        id: "entity-user-preferences",
        label: "User Preferences",
        kind: "preference",
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
      { id: "edge-root-sample-a", source: root.id, target: sampleA.id, relation: "tracks", weight: 0.8, evidence: "" },
      { id: "edge-root-sample-b", source: root.id, target: sampleB.id, relation: "tracks", weight: 0.8, evidence: "" }
    );
  }

  const graph = normalizeGraph({ nodes, edges });
  return extractionError ? { ...graph, extractionError } : graph;
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

    let extractionError: string | undefined;

    if (raw && !forceBootstrap) {
      graph = normalizeGraph(JSON.parse(raw));
      // Inject any agents that are missing from the saved graph
      const existingIds = new Set(graph.nodes.map((n) => n.id));
      const existingEdgeIds = new Set(graph.edges.map((e) => e.id));
      const rootId = graph.nodes.find((n) => n.id === "memory-core")?.id ?? "memory-core";
      const injectNodes: GraphNode[] = [];
      const injectEdges: GraphEdge[] = [];

      agents.forEach((agent, idx) => {
        const nodeId = `agent-${slug(String(agent.id || idx))}`;
        if (existingIds.has(nodeId)) return;
        existingIds.add(nodeId);
        injectNodes.push({
          id: nodeId, label: safeAgentName(agent), kind: "agent",
          summary: "OpenClaw agent.", confidence: 0.95, source: "agents",
          tags: ["agent"], x: 40, y: 280 + idx * 120,
        });
        const edgeId = `edge-root-agent-${nodeId}`;
        if (!existingEdgeIds.has(edgeId)) {
          injectEdges.push({ id: edgeId, source: rootId, target: nodeId, relation: "managed_by", weight: 0.9, evidence: String(agent.id || "") });
        }
      });

      if (injectNodes.length > 0) {
        graph = normalizeGraph({ ...graph, nodes: [...graph.nodes, ...injectNodes], edges: [...graph.edges, ...injectEdges] });
      }
    } else {
      const memoryMd = (await readOptional(MEMORY_MD_PATH)) || "";
      const indexed = await readIndexedMemoryFiles(30);
      const fallbackFiles = indexed.length ? [] : await readRecentJournalFiles(10);
      const indexedOrFallback = indexed.length ? indexed : fallbackFiles;
      // Include MEMORY.md as seed if not already indexed
      const seedFiles: BootstrapFile[] = [];
      if (memoryMd.trim()) {
        seedFiles.push({ name: "MEMORY.md", content: memoryMd, source: "filesystem" });
      }
      const indexedNames = new Set(seedFiles.map((f) => f.name));
      for (const f of indexedOrFallback) {
        if (!indexedNames.has(f.name)) { seedFiles.push(f); indexedNames.add(f.name); }
      }
      const extraWorkspace = workspaceRootFiles.filter((f) => !indexedNames.has(f.name));
      for (const f of extraWorkspace) seedFiles.push(f);

      const llmResult = await buildLlmGraph(seedFiles, agents);
      extractionError = llmResult.extractionError;
      graph = llmResult;
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
      bootstrap: bootstrapInfo
        ? { ...bootstrapInfo, ...(extractionError ? { error: extractionError } : {}) }
        : undefined,
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
