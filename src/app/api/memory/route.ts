import { NextRequest, NextResponse } from "next/server";
import {
  readdir,
  readFile,
  writeFile,
  stat,
  unlink,
  rename,
  copyFile,
} from "fs/promises";
import { join, extname, basename } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDefaultWorkspaceSync } from "@/lib/paths";
import { runCli, runCliJson } from "@/lib/openclaw";

const WORKSPACE = getDefaultWorkspaceSync();
const exec = promisify(execFile);

// All root-level .md files are included dynamically — no fixed allowlist.

type VectorState = "indexed" | "stale" | "not_indexed" | "unknown";

type MemoryStatusRow = {
  agentId?: string;
  status?: {
    workspaceDir?: string;
    dbPath?: string;
    files?: number;
    chunks?: number;
    dirty?: boolean;
    provider?: string;
    model?: string;
  };
  scan?: {
    issues?: string[];
    totalFiles?: number;
  };
};

type CliAgentRow = {
  id?: string;
  name?: string;
  identityName?: string;
  workspace?: string;
  isDefault?: boolean;
};

type WorkspaceMemoryFile = {
  exists: boolean;
  fileName: "MEMORY.md" | "memory.md";
  path: string;
  content: string;
  words: number;
  size: number;
  mtime?: string;
  hasAltCaseFile: boolean;
};

function stripTemplateHints(raw: string): string {
  return raw.replace(/\s*_\(.*?\)_?\s*/g, " ").replace(/\s+/g, " ").trim();
}

function safeAgentName(agent: CliAgentRow): string {
  const identity = stripTemplateHints(String(agent.identityName || "")).trim();
  if (identity) return identity;
  const name = stripTemplateHints(String(agent.name || "")).trim();
  if (name) return name;
  return String(agent.id || "agent");
}

async function getCliAgents(): Promise<CliAgentRow[]> {
  try {
    const rows = await runCliJson<CliAgentRow[]>(["agents", "list"], 12000);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function getMemoryStatuses(): Promise<MemoryStatusRow[]> {
  try {
    const rows = await runCliJson<MemoryStatusRow[]>(["memory", "status"], 12000);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function readWorkspaceMemoryFile(
  workspaceDir: string,
  includeContent = true
): Promise<WorkspaceMemoryFile> {
  const upperPath = join(workspaceDir, "MEMORY.md");
  const lowerPath = join(workspaceDir, "memory.md");

  const upper = await stat(upperPath)
    .then((s) => (s.isFile() ? s : null))
    .catch(() => null);
  const lower = await stat(lowerPath)
    .then((s) => (s.isFile() ? s : null))
    .catch(() => null);

  // On case-insensitive filesystems (macOS/Windows), both paths can stat the same file → same inode
  const hasAltCaseFile = Boolean(upper && lower && upper.ino !== lower.ino);

  if (!upper && !lower) {
    return {
      exists: false,
      fileName: "MEMORY.md",
      path: upperPath,
      content: "",
      words: 0,
      size: 0,
      hasAltCaseFile,
    };
  }

  const useUpper = Boolean(upper);
  const chosenPath = useUpper ? upperPath : lowerPath;
  const chosenStat = useUpper ? upper : lower;
  const content = includeContent ? await readFile(chosenPath, "utf-8") : "";

  return {
    exists: true,
    fileName: useUpper ? "MEMORY.md" : "memory.md",
    path: chosenPath,
    content,
    words: includeContent ? content.split(/\s+/).filter(Boolean).length : 0,
    size: chosenStat?.size || (includeContent ? Buffer.byteLength(content, "utf-8") : 0),
    mtime: chosenStat?.mtime.toISOString(),
    hasAltCaseFile,
  };
}

async function getIndexedMemoryFilesByWorkspace(
  statuses: MemoryStatusRow[]
): Promise<Map<string, Map<string, { mtime: number; size: number }>>> {
  const out = new Map<string, Map<string, { mtime: number; size: number }>>();

  await Promise.all(
    statuses.map(async (row) => {
      const workspaceDir = String(row.status?.workspaceDir || "").trim();
      const dbPath = String(row.status?.dbPath || "").trim();
      if (!workspaceDir || !dbPath) return;

      try {
        const { stdout } = await exec(
          "sqlite3",
          [dbPath, "select path, mtime, size from files;"],
          { timeout: 12000 }
        );

        const map = new Map<string, { mtime: number; size: number }>();
        for (const line of stdout.split("\n")) {
          const rowText = line.trim();
          if (!rowText) continue;
          const [path, mtimeRaw, sizeRaw] = rowText.split("|");
          if (!path || !mtimeRaw || !sizeRaw) continue;
          const name = basename(path);
          const mtime = Number(mtimeRaw);
          const size = Number(sizeRaw);
          if (!Number.isFinite(mtime) || !Number.isFinite(size)) continue;
          map.set(name, { mtime, size });
        }
        out.set(workspaceDir, map);
      } catch {
        // ignore per-workspace db failures
      }
    })
  );

  return out;
}

function findIndexedHit(
  indexed: Map<string, { mtime: number; size: number }>,
  fileName: string
): { mtime: number; size: number } | null {
  const direct = indexed.get(fileName);
  if (direct) return direct;
  const needle = fileName.toLowerCase();
  for (const [name, value] of indexed.entries()) {
    if (name.toLowerCase() === needle) return value;
  }
  return null;
}

function resolveVectorState(
  indexed: Map<string, { mtime: number; size: number }> | null,
  entry: { name: string; mtime?: string; size?: number }
): VectorState {
  if (!indexed) return "unknown";
  const hit = findIndexedHit(indexed, entry.name);
  if (!hit) return "not_indexed";
  if (!entry.mtime || typeof entry.size !== "number") return "indexed";
  const fileMtime = new Date(entry.mtime).getTime();
  if (!Number.isFinite(fileMtime)) return "indexed";
  // SQLite stores fractional ms; tolerate tiny drift from FS/stat rounding.
  const mtimeClose = Math.abs(hit.mtime - fileMtime) <= 2;
  const sizeSame = hit.size === entry.size;
  return mtimeClose && sizeSame ? "indexed" : "stale";
}

function resolveAgentWorkspace(agentId: string, agents: CliAgentRow[]): string {
  const hit = agents.find((a) => String(a.id || "") === agentId);
  return String(hit?.workspace || WORKSPACE);
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { file, content } = body;
    const agentMemory = String(body.agentMemory || "").trim();

    if (typeof content !== "string") {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }

    if (agentMemory) {
      const agents = await getCliAgents();
      const agent = agents.find((a) => String(a.id || "") === agentMemory);
      if (!agent) {
        return NextResponse.json({ error: `unknown agent: ${agentMemory}` }, { status: 400 });
      }

      const workspaceDir = String(agent.workspace || WORKSPACE);
      const memoryFile = await readWorkspaceMemoryFile(workspaceDir, false);
      await writeFile(memoryFile.path, content, "utf-8");

      const words = content.split(/\s+/).filter(Boolean).length;
      const size = Buffer.byteLength(content, "utf-8");
      return NextResponse.json({
        ok: true,
        agentId: agentMemory,
        file: memoryFile.fileName,
        path: memoryFile.path,
        workspace: workspaceDir,
        words,
        size,
      });
    }

    if (file) {
      const safePath = String(file).replace(/\.\./g, "").replace(/^\/+/, "");
      if (!safePath.endsWith(".md")) {
        return NextResponse.json({ error: "invalid file" }, { status: 400 });
      }
      const fullPath = join(WORKSPACE, "memory", safePath);
      await writeFile(fullPath, content, "utf-8");
      const words = content.split(/\s+/).filter(Boolean).length;
      const size = Buffer.byteLength(content, "utf-8");
      return NextResponse.json({ ok: true, file: safePath, words, size });
    }

    const memoryFile = await readWorkspaceMemoryFile(WORKSPACE, false);
    await writeFile(memoryFile.path, content, "utf-8");
    const words = content.split(/\s+/).filter(Boolean).length;
    const size = Buffer.byteLength(content, "utf-8");
    return NextResponse.json({
      ok: true,
      file: memoryFile.fileName,
      path: memoryFile.path,
      words,
      size,
    });
  } catch (err) {
    console.error("Memory PUT error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** DELETE a memory journal file */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get("file");
    if (!file) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    const safePath = String(file).replace(/\.\./g, "").replace(/^\/+/, "");
    if (!safePath.endsWith(".md")) {
      return NextResponse.json({ error: "invalid file" }, { status: 400 });
    }
    const fullPath = join(WORKSPACE, "memory", safePath);
    const s = await stat(fullPath);
    if (!s.isFile()) {
      return NextResponse.json({ error: "not a file" }, { status: 400 });
    }
    await unlink(fullPath);
    return NextResponse.json({ ok: true, file: safePath, deleted: true });
  } catch (err) {
    console.error("Memory DELETE error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** PATCH - rename or duplicate a memory journal file */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, file: fileName, newName } = body as {
      action: "rename" | "duplicate";
      file: string;
      newName?: string;
    };
    if (!fileName || !action) {
      return NextResponse.json({ error: "action and file required" }, { status: 400 });
    }
    const safePath = String(fileName).replace(/\.\./g, "").replace(/^\/+/, "");
    const fullPath = join(WORKSPACE, "memory", safePath);

    if (action === "rename") {
      if (!newName) {
        return NextResponse.json({ error: "newName required" }, { status: 400 });
      }
      const sanitized = newName.replace(/[/\\:*?"<>|]/g, "").trim();
      if (!sanitized) {
        return NextResponse.json({ error: "invalid name" }, { status: 400 });
      }
      const newFullPath = join(WORKSPACE, "memory", sanitized);
      await rename(fullPath, newFullPath);
      return NextResponse.json({ ok: true, file: sanitized, oldFile: safePath });
    }

    if (action === "duplicate") {
      const ext = extname(safePath);
      const base = basename(safePath, ext);
      let suffix = 1;
      let dupPath: string;
      do {
        dupPath = join(
          WORKSPACE,
          "memory",
          `${base} (copy${suffix > 1 ? ` ${suffix}` : ""})${ext}`
        );
        suffix++;
      } while (
        await stat(dupPath)
          .then(() => true)
          .catch(() => false)
      );
      await copyFile(fullPath, dupPath);
      const dupName = basename(dupPath);
      return NextResponse.json({ ok: true, file: dupName });
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("Memory PATCH error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** POST - trigger memory indexing */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action || "");
    if (action !== "index-memory") {
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }

    const file = typeof body.file === "string" ? body.file : null;
    const force = !!body.force;
    const agentId = String(body.agentId || "").trim();

    if (file) {
      const safePath = file.replace(/\.\./g, "").replace(/^\/+/, "");
      if (!safePath.endsWith(".md")) {
        return NextResponse.json({ error: "invalid file" }, { status: 400 });
      }
    }

    const args = ["memory", "index"];
    if (agentId) args.push("--agent", agentId);
    if (force) args.push("--force");
    await runCli(args, force ? 60000 : 30000);

    let vectorState: VectorState | undefined;
    if (file) {
      const safePath = file.replace(/\.\./g, "").replace(/^\/+/, "");
      try {
        const agents = agentId ? await getCliAgents() : [];
        const workspaceDir = agentId ? resolveAgentWorkspace(agentId, agents) : WORKSPACE;
        const isTopLevelMemory = /^memory\.md$/i.test(safePath);

        let fullPath: string;
        if (isTopLevelMemory) {
          const memoryFile = await readWorkspaceMemoryFile(workspaceDir, false);
          fullPath = memoryFile.path;
        } else {
          fullPath = join(workspaceDir, "memory", safePath);
        }

        const s = await stat(fullPath);
        const statuses = await getMemoryStatuses();
        const indexedByWorkspace = await getIndexedMemoryFilesByWorkspace(statuses);
        const indexed = indexedByWorkspace.get(workspaceDir) || null;
        vectorState = resolveVectorState(indexed, {
          name: basename(fullPath),
          mtime: s.mtime.toISOString(),
          size: s.size,
        });
      } catch {
        vectorState = undefined;
      }
    }

    return NextResponse.json({
      ok: true,
      action,
      file,
      agentId: agentId || null,
      vectorState,
      force,
    });
  } catch (err) {
    console.error("Memory POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");
  const agentMemory = searchParams.get("agentMemory");
  const workspaceRoot = searchParams.get("workspaceRoot") === "1";

  try {
    if (file) {
      const safePath = file.replace(/\.\./g, "").replace(/^\/+/, "");
      if (!safePath.endsWith(".md")) {
        return NextResponse.json({ error: "invalid file" }, { status: 400 });
      }
      const fullPath = workspaceRoot
        ? join(WORKSPACE, safePath)
        : join(WORKSPACE, "memory", safePath);
      const content = await readFile(fullPath, "utf-8");
      const s = await stat(fullPath);
      const words = content.split(/\s+/).filter(Boolean).length;
      const size = Buffer.byteLength(content, "utf-8");
      return NextResponse.json({ content, words, size, file: safePath, mtime: s.mtime.toISOString() });
    }

    if (agentMemory) {
      const agents = await getCliAgents();
      const agent = agents.find((a) => String(a.id || "") === agentMemory);
      if (!agent) {
        return NextResponse.json({ error: `unknown agent: ${agentMemory}` }, { status: 400 });
      }

      const workspaceDir = String(agent.workspace || WORKSPACE);
      const memoryFile = await readWorkspaceMemoryFile(workspaceDir, true);
      const statuses = await getMemoryStatuses();
      const indexedByWorkspace = await getIndexedMemoryFilesByWorkspace(statuses);
      const indexed = indexedByWorkspace.get(workspaceDir) || null;
      const vectorState = memoryFile.exists
        ? resolveVectorState(indexed, {
            name: memoryFile.fileName,
            mtime: memoryFile.mtime,
            size: memoryFile.size,
          })
        : "not_indexed";

      const status = statuses.find((s) => String(s.agentId || "") === agentMemory);

      return NextResponse.json({
        agentId: String(agent.id || agentMemory),
        agentName: safeAgentName(agent),
        isDefault: Boolean(agent.isDefault),
        workspace: workspaceDir,
        exists: memoryFile.exists,
        fileName: memoryFile.fileName,
        path: memoryFile.path,
        hasAltCaseFile: memoryFile.hasAltCaseFile,
        content: memoryFile.content,
        words: memoryFile.words,
        size: memoryFile.size,
        mtime: memoryFile.mtime,
        vectorState,
        dirty: Boolean(status?.status?.dirty),
        indexedFiles: Number(status?.status?.files || 0),
        indexedChunks: Number(status?.status?.chunks || 0),
        scanIssues: Array.isArray(status?.scan?.issues) ? status?.scan?.issues : [],
      });
    }

    const memoryDir = join(WORKSPACE, "memory");
    const list: { name: string; date: string; size?: number; words?: number; mtime?: string }[] = [];
    try {
      const entries = await readdir(memoryDir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name)
        .sort()
        .reverse();

      for (const name of files.slice(0, 50)) {
        try {
          const fullPath = join(memoryDir, name);
          const content = await readFile(fullPath, "utf-8");
          const s = await stat(fullPath);
          const words = content.split(/\s+/).filter(Boolean).length;
          // Extract the date portion (YYYY-MM-DD) from filenames like 2026-02-14-1139.md
          const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})/);
          const date = dateMatch ? dateMatch[1] : name.replace(".md", "");
          list.push({
            name,
            date,
            size: Buffer.byteLength(content, "utf-8"),
            words,
            mtime: s.mtime.toISOString(),
          });
        } catch {
          const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})/);
          list.push({ name, date: dateMatch ? dateMatch[1] : name.replace(".md", "") });
        }
      }
    } catch {
      // memory/ may not exist
    }

    const statuses = await getMemoryStatuses();
    const indexedByWorkspace = await getIndexedMemoryFilesByWorkspace(statuses);

    const dailyWithVector = list.map((entry) => ({
      ...entry,
      vectorState: resolveVectorState(indexedByWorkspace.get(WORKSPACE) || null, entry),
    }));

    const coreMemory = await readWorkspaceMemoryFile(WORKSPACE, true);
    const coreVectorState = coreMemory.exists
      ? resolveVectorState(indexedByWorkspace.get(WORKSPACE) || null, {
          name: coreMemory.fileName,
          mtime: coreMemory.mtime,
          size: coreMemory.size,
        })
      : "not_indexed";

    const agents = await getCliAgents();
    const agentMemoryFiles = await Promise.all(
      agents
        .filter((a) => String(a.id || "").trim().length > 0)
        .map(async (agent) => {
          const agentId = String(agent.id || "");
          const workspaceDir = String(agent.workspace || WORKSPACE);
          const memoryFile = await readWorkspaceMemoryFile(workspaceDir, false);
          const status = statuses.find((s) => String(s.agentId || "") === agentId);
          const vectorState = memoryFile.exists
            ? resolveVectorState(indexedByWorkspace.get(workspaceDir) || null, {
                name: memoryFile.fileName,
                mtime: memoryFile.mtime,
                size: memoryFile.size,
              })
            : "not_indexed";

          return {
            agentId,
            agentName: safeAgentName(agent),
            isDefault: Boolean(agent.isDefault),
            workspace: workspaceDir,
            exists: memoryFile.exists,
            fileName: memoryFile.fileName,
            path: memoryFile.path,
            hasAltCaseFile: memoryFile.hasAltCaseFile,
            words: memoryFile.words,
            size: memoryFile.size,
            mtime: memoryFile.mtime,
            vectorState,
            dirty: Boolean(status?.status?.dirty),
            indexedFiles: Number(status?.status?.files || 0),
            indexedChunks: Number(status?.status?.chunks || 0),
            provider: String(status?.status?.provider || ""),
            model: String(status?.status?.model || ""),
            scanIssues: Array.isArray(status?.scan?.issues) ? status?.scan?.issues : [],
          };
        })
    );

    agentMemoryFiles.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.agentName.localeCompare(b.agentName);
    });

    // Workspace root reference files (VERSA_BRAND_PROFILE.md, AGENTS.md, etc.)
    const workspaceFiles: {
      name: string;
      path: string;
      exists: boolean;
      size: number;
      mtime?: string;
      words: number;
      vectorState: VectorState;
    }[] = [];
    try {
      const rootEntries = await readdir(WORKSPACE, { withFileTypes: true });
      const rootMdFiles = rootEntries
        .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "MEMORY.md" && e.name !== "memory.md")
        .map((e) => e.name)
        .sort();
      for (const name of rootMdFiles) {
        const fullPath = join(WORKSPACE, name);
        try {
          const content = await readFile(fullPath, "utf-8");
          const s = await stat(fullPath);
          workspaceFiles.push({
            name,
            path: fullPath,
            exists: true,
            size: s.size,
            mtime: s.mtime.toISOString(),
            words: content.split(/\s+/).filter(Boolean).length,
            vectorState: resolveVectorState(indexedByWorkspace.get(WORKSPACE) || null, {
              name,
              mtime: s.mtime.toISOString(),
              size: s.size,
            }),
          });
        } catch {
          workspaceFiles.push({ name, path: fullPath, exists: false, size: 0, words: 0, vectorState: "not_indexed" });
        }
      }
    } catch {
      // workspace dir unreadable
    }

    return NextResponse.json({
      daily: dailyWithVector,
      memoryMd: coreMemory.exists
        ? {
            content: coreMemory.content,
            words: coreMemory.words,
            size: coreMemory.size,
            mtime: coreMemory.mtime,
            fileName: coreMemory.fileName,
            path: coreMemory.path,
            hasAltCaseFile: coreMemory.hasAltCaseFile,
            vectorState: coreVectorState,
          }
        : null,
      agentMemoryFiles,
      workspaceFiles,
      docsContext: {
        memoryFile: "MEMORY.md or memory.md",
        journalDir: "memory/*.md",
        note:
          "MEMORY.md is user-managed long-term memory; memory/*.md are rolling journal files indexed for retrieval.",
      },
    });
  } catch (err) {
    console.error("Memory API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
