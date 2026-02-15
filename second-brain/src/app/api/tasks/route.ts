import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { getDefaultWorkspace } from "@/lib/paths";

async function getKanbanPath(): Promise<string> {
  const ws = await getDefaultWorkspace();
  return join(ws, "kanban.json");
}

async function getTasksMemoryPath(): Promise<string> {
  const ws = await getDefaultWorkspace();
  return join(ws, "TASKS.md");
}

const DEFAULT_COLUMNS = [
  { id: "backlog", title: "Backlog", color: "#6b7280" },
  { id: "in-progress", title: "In Progress", color: "#f59e0b" },
  { id: "review", title: "Review", color: "#8b5cf6" },
  { id: "done", title: "Done", color: "#10b981" },
];

/* ── GET — read existing board ────────────────────── */

export async function GET() {
  try {
    const kanbanPath = await getKanbanPath();
    const raw = await readFile(kanbanPath, "utf-8");
    const data = JSON.parse(raw);
    return NextResponse.json({ ...data, _fileExists: true });
  } catch {
    // Return empty kanban if file doesn't exist
    return NextResponse.json({
      columns: DEFAULT_COLUMNS,
      tasks: [],
      _fileExists: false,
    });
  }
}

/* ── PUT — save board ─────────────────────────────── */

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.columns || !body.tasks) {
      return NextResponse.json(
        { error: "columns and tasks required" },
        { status: 400 }
      );
    }
    const kanbanPath = await getKanbanPath();
    // Strip internal fields before saving
    const { _fileExists, ...saveData } = body;
    await writeFile(kanbanPath, JSON.stringify(saveData, null, 2), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Tasks PUT error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ── POST — initialize board + teach agent ────────── */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action;

    if (action !== "init") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const ws = await getDefaultWorkspace();
    const kanbanPath = join(ws, "kanban.json");
    const tasksMemoryPath = join(ws, "TASKS.md");

    // Ensure workspace directory exists
    await mkdir(dirname(kanbanPath), { recursive: true });

    // ── 1. Create kanban.json with smart starter tasks ──

    const starterBoard = {
      columns: DEFAULT_COLUMNS,
      tasks: body.starterTasks || [
        {
          id: 1,
          title: "Explore the Dashboard",
          description:
            "Check out the Mission Control dashboard to see your agents, cron jobs, system health, and more.",
          column: "in-progress",
          priority: "medium",
        },
        {
          id: 2,
          title: "Ask your agent to add a task",
          description:
            'Try chatting with your agent and say: "Add a task to review my weekly reports". It will update this board automatically.',
          column: "backlog",
          priority: "high",
        },
        {
          id: 3,
          title: "Set up your first cron job",
          description:
            "Automate a recurring task — like a daily summary or weekly check-in. Go to Cron Jobs to see what's running.",
          column: "backlog",
          priority: "low",
        },
      ],
    };

    await writeFile(
      kanbanPath,
      JSON.stringify(starterBoard, null, 2),
      "utf-8"
    );

    // ── 2. Create TASKS.md — agent instructions ──
    // This file lives in the workspace so the agent reads it as context.
    // It teaches the agent how to interact with the kanban board.

    const tasksMemory = `# Task Board (kanban.json)

This workspace has a **Kanban task board** stored at \`kanban.json\` in this directory.
The user manages it through Mission Control (the dashboard app) and expects you to interact with it too.

## Structure

\`\`\`json
{
  "columns": [
    { "id": "backlog", "title": "Backlog", "color": "#6b7280" },
    { "id": "in-progress", "title": "In Progress", "color": "#f59e0b" },
    { "id": "review", "title": "Review", "color": "#8b5cf6" },
    { "id": "done", "title": "Done", "color": "#10b981" }
  ],
  "tasks": [
    {
      "id": 1,
      "title": "Task name",
      "description": "Optional description",
      "column": "backlog",
      "priority": "high | medium | low",
      "assignee": "optional name"
    }
  ]
}
\`\`\`

## How to Use

- **Read tasks:** Parse \`kanban.json\` to know what's on the board.
- **Add a task:** Append to the \`tasks\` array with a new unique \`id\` (increment from highest existing id). Default to \`"backlog"\` column if not specified.
- **Move a task:** Change the \`column\` field (e.g. from \`"backlog"\` to \`"in-progress"\`).
- **Complete a task:** Move it to \`"done"\`.
- **Update a task:** Modify \`title\`, \`description\`, \`priority\`, or \`assignee\`.
- **Delete a task:** Remove it from the array.
- **Always save** the full JSON back to \`kanban.json\` after changes.

## Guidelines

- When the user asks you to "add a task" or "remind me to...", create a task on this board.
- When you finish work that corresponds to a task, move it to "done".
- Proactively suggest moving tasks that seem completed based on context.
- Keep task titles concise (under 60 chars). Put details in description.
- Use priority: \`high\` = urgent, \`medium\` = normal, \`low\` = someday.
- The \`assignee\` field is optional — use the user's name or an agent name if relevant.
`;

    await writeFile(tasksMemoryPath, tasksMemory, "utf-8");

    return NextResponse.json({
      ok: true,
      kanbanPath,
      tasksMemoryPath,
      board: { ...starterBoard, _fileExists: true },
    });
  } catch (err) {
    console.error("Tasks POST (init) error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
