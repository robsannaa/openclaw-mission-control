import { access, readFile, readdir } from "fs/promises";
import path from "path";
import { getDefaultWorkspaceSync } from "@/lib/paths";

const WORKSPACE_DIR = getDefaultWorkspaceSync();

type MemoryEntry = { date: string; content: string };
type KanbanColumn = {
  id?: string;
  title?: string;
  color?: string;
  [key: string]: unknown;
};

type KanbanTask = {
  id?: string;
  title?: string;
  description?: string;
  priority?: string;
  tags?: string[];
  assignee?: string;
  column?: string;
  [key: string]: unknown;
};

type KanbanData = {
  columns?: KanbanColumn[];
  tasks?: KanbanTask[];
  [key: string]: unknown;
};

export type WorkspaceSnapshot = {
  memories: MemoryEntry[];
  kanban: KanbanData | null;
  cronJobs: { name: string; schedule: string; enabled: boolean }[];
  workspaceFiles: {
    AGENTS: string | null;
    USER: string | null;
    SOUL: string | null;
    TOOLS: string | null;
    IDENTITY: string | null;
  };
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readWorkspaceFile(filename: string): Promise<string | null> {
  const filePath = path.join(WORKSPACE_DIR, filename);
  if (!(await fileExists(filePath))) return null;
  return readFile(filePath, "utf-8");
}

async function readMemories(): Promise<MemoryEntry[]> {
  const memoryDir = path.join(WORKSPACE_DIR, "memory");
  if (!(await fileExists(memoryDir))) return [];

  const files = await readdir(memoryDir);
  const markdownFiles = files.filter((file) => file.endsWith(".md"));

  const memories = await Promise.all(
    markdownFiles.map(async (file) => {
      const date = file.replace(".md", "");
      const content = await readFile(path.join(memoryDir, file), "utf-8");
      return { date, content };
    })
  );

  return memories;
}

async function readKanban(): Promise<KanbanData | null> {
  const raw = await readWorkspaceFile("kanban.json");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const [memories, kanban, AGENTS, USER, SOUL, TOOLS, IDENTITY] = await Promise.all([
    readMemories(),
    readKanban(),
    readWorkspaceFile("AGENTS.md"),
    readWorkspaceFile("USER.md"),
    readWorkspaceFile("SOUL.md"),
    readWorkspaceFile("TOOLS.md"),
    readWorkspaceFile("IDENTITY.md"),
  ]);

  return {
    memories,
    kanban,
    // Keep existing placeholder cron jobs behavior unchanged.
    cronJobs: [
      { name: "Morning Brief", schedule: "8:00 AM", enabled: true },
      { name: "Daily CEO Brief - Versa", schedule: "8:00 AM", enabled: true },
      { name: "System Health Check", schedule: "Every 6 hours", enabled: true },
      { name: "Keep Browser Running", schedule: "Every 5 min", enabled: true },
    ],
    workspaceFiles: {
      AGENTS,
      USER,
      SOUL,
      TOOLS,
      IDENTITY,
    },
  };
}
