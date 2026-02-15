"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Pencil,
  X,
  Check,
  ListChecks,
  Sparkles,
  FileJson,
  ArrowRight,
  Lightbulb,
  Loader2,
  Rocket,
  Bot,
  Brain,
  CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── types ─────────────────────────────────────── */

type Column = { id: string; title: string; color: string };
type Task = {
  id: number;
  title: string;
  description?: string;
  column: string;
  priority: string;
  assignee?: string;
};
type KanbanData = { columns: Column[]; tasks: Task[]; _fileExists?: boolean };

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-blue-500",
};
const PRIORITY_TEXT: Record<string, string> = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-blue-400",
};
const PRIORITIES = ["high", "medium", "low"];

/* ── component ─────────────────────────────────── */

export function TasksView() {
  const [data, setData] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | null>(null);
  const [addingToColumn, setAddingToColumn] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<number | null>(null);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  /* ── persist helpers ───────────────────────────── */

  const persist = useCallback((newData: KanbanData) => {
    setData(newData);
    setSaveStatus("saving");
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newData),
        });
        if (res.ok) {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus(null), 2000);
        }
      } catch { /* retry next save */ }
    }, 500);
  }, []);

  /* ── task CRUD ─────────────────────────────────── */

  const addTask = useCallback(
    (task: Omit<Task, "id">) => {
      if (!data) return;
      const maxId = data.tasks.reduce((m, t) => Math.max(m, t.id), 0);
      const newData = {
        ...data,
        tasks: [...data.tasks, { ...task, id: maxId + 1 }],
      };
      persist(newData);
    },
    [data, persist]
  );

  const updateTask = useCallback(
    (id: number, updates: Partial<Task>) => {
      if (!data) return;
      const newData = {
        ...data,
        tasks: data.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      };
      persist(newData);
    },
    [data, persist]
  );

  const moveTask = useCallback(
    (id: number, direction: "left" | "right") => {
      if (!data) return;
      const task = data.tasks.find((t) => t.id === id);
      if (!task) return;
      const colIdx = data.columns.findIndex((c) => c.id === task.column);
      const newIdx =
        direction === "right"
          ? Math.min(colIdx + 1, data.columns.length - 1)
          : Math.max(colIdx - 1, 0);
      if (newIdx === colIdx) return;
      updateTask(id, { column: data.columns[newIdx].id });
    },
    [data, updateTask]
  );

  const deleteTask = useCallback(
    (id: number) => {
      if (!data) return;
      const newData = {
        ...data,
        tasks: data.tasks.filter((t) => t.id !== id),
      };
      persist(newData);
    },
    [data, persist]
  );

  /* ── rendering ─────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
        Loading tasks...
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
            <ListChecks className="h-7 w-7 text-red-400" />
          </div>
          <h2 className="text-[16px] font-semibold text-foreground/90">
            Could not load Kanban board
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Something went wrong while loading your tasks. This could be a
            temporary issue. Try refreshing the page.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-foreground/[0.06] px-4 py-2 text-[12px] font-medium text-foreground/70 transition-colors hover:bg-foreground/[0.1]"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const { columns, tasks } = data;
  const fileExists = data._fileExists !== false;
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.column === "done").length;
  const inProgress = tasks.filter((t) => t.column === "in-progress").length;
  const completionPct =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  /* ── Onboarding empty state ── */
  if (totalTasks === 0) {
    return (
      <BoardOnboarding
        fileExists={fileExists}
        columns={columns}
        onBoardCreated={(board) => setData(board)}
        addingToColumn={addingToColumn}
        setAddingToColumn={setAddingToColumn}
        addTask={addTask}
      />
    );
  }

  /* ── Normal board view ── */
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Stats header */}
      <div className="shrink-0 space-y-3 px-6 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-5 text-[13px]">
            <span>
              <strong className="text-lg font-semibold text-foreground">
                {totalTasks}
              </strong>{" "}
              <span className="text-muted-foreground">Total</span>
            </span>
            <span>
              <strong className="text-lg font-semibold text-foreground">
                {inProgress}
              </strong>{" "}
              <span className="text-muted-foreground">In progress</span>
            </span>
            <span>
              <strong className="text-lg font-semibold text-foreground">
                {doneTasks}
              </strong>{" "}
              <span className="text-muted-foreground">Done</span>
            </span>
            <span>
              <strong className="text-lg font-semibold text-foreground">
                {completionPct}%
              </strong>{" "}
              <span className="text-muted-foreground">Completion</span>
            </span>
          </div>
          {saveStatus && (
            <span
              className={cn(
                "text-[11px]",
                saveStatus === "saving" ? "text-muted-foreground" : "text-emerald-500"
              )}
            >
              {saveStatus === "saving" ? "Saving..." : "Saved"}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground/60">
          Source: workspace/kanban.json &bull; {totalTasks} tasks across{" "}
          {columns.length} columns
          <span className="ml-2 text-muted-foreground/40/60 italic select-none" title="You know it's true.">
            &mdash; added because every dude on X is flexing their Kanban board, so <strong>maybe</strong> it&apos;s not BS after all
          </span>
        </p>
      </div>

      {/* Kanban columns */}
      <div className="flex flex-1 gap-5 overflow-x-auto px-6 pb-6">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => t.column === col.id);
          return (
            <div key={col.id} className="flex min-w-[280px] flex-1 flex-col">
              <div className="mb-3 flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: col.color }}
                />
                <h3 className="text-[13px] font-semibold text-foreground/70">
                  {col.title}
                </h3>
                <span className="text-[12px] text-muted-foreground/60">
                  {colTasks.length}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() =>
                    setAddingToColumn(
                      addingToColumn === col.id ? null : col.id
                    )
                  }
                  className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground/70"
                  title={`Add task to ${col.title}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Inline add form */}
              {addingToColumn === col.id && (
                <AddTaskInline
                  column={col.id}
                  onAdd={(task) => {
                    addTask(task);
                    setAddingToColumn(null);
                  }}
                  onCancel={() => setAddingToColumn(null)}
                />
              )}

              <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto">
                {colTasks.length === 0 && addingToColumn !== col.id ? (
                  <div className="flex items-center justify-center rounded-lg border border-dashed border-foreground/[0.06] py-8 text-[12px] text-muted-foreground/60">
                    No tasks
                  </div>
                ) : (
                  colTasks.map((task) =>
                    editingTask === task.id ? (
                      <EditTaskInline
                        key={task.id}
                        task={task}
                        columns={columns}
                        onSave={(updates) => {
                          updateTask(task.id, updates);
                          setEditingTask(null);
                        }}
                        onCancel={() => setEditingTask(null)}
                        onDelete={() => {
                          deleteTask(task.id);
                          setEditingTask(null);
                        }}
                      />
                    ) : (
                      <TaskCard
                        key={task.id}
                        task={task}
                        columns={columns}
                        onEdit={() => setEditingTask(task.id)}
                        onMove={(dir) => moveTask(task.id, dir)}
                        onDelete={() => deleteTask(task.id)}
                      />
                    )
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── TaskCard ────────────────────────────────────── */

function TaskCard({
  task,
  columns,
  onEdit,
  onMove,
  onDelete,
}: {
  task: Task;
  columns: Column[];
  onEdit: () => void;
  onMove: (dir: "left" | "right") => void;
  onDelete: () => void;
}) {
  const colIdx = columns.findIndex((c) => c.id === task.column);
  const canLeft = colIdx > 0;
  const canRight = colIdx < columns.length - 1;

  return (
    <div className="group rounded-lg border border-foreground/[0.06] bg-card p-3.5 transition-colors hover:border-foreground/[0.12]">
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
            PRIORITY_COLORS[task.priority] || "bg-zinc-500"
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground/90">{task.title}</p>
          {task.description && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
              {task.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <span
              className={cn(
                "font-medium capitalize",
                PRIORITY_TEXT[task.priority] || "text-muted-foreground"
              )}
            >
              {task.priority}
            </span>
            {task.assignee && (
              <>
                <span className="text-muted-foreground/40">&bull;</span>
                <span className="text-muted-foreground">{task.assignee}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Action bar -- visible on hover */}
      <div className="mt-2 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          disabled={!canLeft}
          onClick={() => onMove("left")}
          className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground/70 disabled:opacity-30"
          title="Move left"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canRight}
          onClick={() => onMove("right")}
          className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground/70 disabled:opacity-30"
          title="Move right"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onEdit}
          className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground/70"
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-red-500/20 hover:text-red-400"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ── AddTaskInline ───────────────────────────────── */

function AddTaskInline({
  column,
  onAdd,
  onCancel,
}: {
  column: string;
  onAdd: (t: Omit<Task, "id">) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (!title.trim()) return;
    onAdd({
      title: title.trim(),
      description: desc.trim() || undefined,
      column,
      priority,
      assignee: assignee.trim() || undefined,
    });
  };

  return (
    <div className="mb-2.5 rounded-lg border border-violet-500/30 bg-card p-3.5">
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Task title..."
        className="mb-2 w-full bg-transparent text-[13px] font-medium text-foreground/90 outline-none placeholder:text-muted-foreground/60"
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="mb-2 w-full resize-none bg-transparent text-[12px] leading-5 text-muted-foreground outline-none placeholder:text-muted-foreground/60"
      />
      <div className="flex items-center gap-2">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="rounded border border-foreground/[0.08] bg-muted px-2 py-1 text-[11px] text-muted-foreground outline-none"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          placeholder="Assignee"
          className="flex-1 rounded border border-foreground/[0.08] bg-muted px-2 py-1 text-[11px] text-muted-foreground outline-none placeholder:text-muted-foreground/60"
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-muted-foreground hover:text-foreground/70"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!title.trim()}
          className="rounded bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* ── BoardOnboarding ─────────────────────────────── */

function BoardOnboarding({
  fileExists,
  columns,
  onBoardCreated,
  addingToColumn,
  setAddingToColumn,
  addTask,
}: {
  fileExists: boolean;
  columns: Column[];
  onBoardCreated: (board: KanbanData) => void;
  addingToColumn: string | null;
  setAddingToColumn: (col: string | null) => void;
  addTask: (task: Omit<Task, "id">) => void;
}) {
  const [initializing, setInitializing] = useState(false);
  const [initStep, setInitStep] = useState(0); // 0=idle, 1=creating board, 2=teaching agent, 3=done

  const initBoard = useCallback(async () => {
    setInitializing(true);
    setInitStep(1);

    try {
      // Animate through steps
      await new Promise((r) => setTimeout(r, 600));
      setInitStep(2);

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "init" }),
      });

      if (!res.ok) throw new Error("Failed to initialize");
      const data = await res.json();

      setInitStep(3);
      await new Promise((r) => setTimeout(r, 800));

      // Transition to the board
      onBoardCreated(data.board);
    } catch {
      setInitializing(false);
      setInitStep(0);
    }
  }, [onBoardCreated]);

  // --- Initializing animation ---
  if (initializing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="relative">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-violet-500/10">
            {initStep < 3 ? (
              <Loader2 className="h-9 w-9 animate-spin text-violet-400" />
            ) : (
              <CheckCircle className="h-9 w-9 text-emerald-400" />
            )}
          </div>
        </div>

        <div className="text-center">
          <h2 className="text-[18px] font-semibold text-foreground">
            {initStep === 3 ? "You're all set!" : "Setting up your board..."}
          </h2>
          <div className="mt-5 space-y-3">
            <StepIndicator
              step={1}
              current={initStep}
              label="Creating kanban.json"
              sublabel="Board with 4 columns: Backlog, In Progress, Review, Done"
            />
            <StepIndicator
              step={2}
              current={initStep}
              label="Teaching your agent about the board"
              sublabel="Writing TASKS.md so your agent can manage tasks"
            />
            <StepIndicator
              step={3}
              current={initStep}
              label="Adding starter tasks"
              sublabel="A few helpful tasks to get you oriented"
            />
          </div>
        </div>
      </div>
    );
  }

  // --- First-time onboarding (no file) ---
  if (!fileExists) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-xl px-6 py-12">
            {/* Hero */}
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10">
                <ListChecks className="h-8 w-8 text-violet-400" />
              </div>
              <h1 className="text-[22px] font-semibold text-foreground">
                Task Board
              </h1>
              <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-muted-foreground">
                A Kanban board that both you and your agents can manage.
                Add tasks here or just ask your agent &mdash; it all stays in sync.
              </p>
            </div>

            {/* What you get */}
            <div className="mt-8 space-y-3">
              <FeatureRow
                icon={FileJson}
                iconColor="text-sky-400"
                title="kanban.json"
                desc="A simple JSON file in your workspace. Portable, version-controlled, no lock-in."
              />
              <FeatureRow
                icon={Bot}
                iconColor="text-violet-400"
                title="Agent-aware"
                desc='Your agent learns about the board instantly. Say "add a task" in chat and it appears here.'
              />
              <FeatureRow
                icon={Brain}
                iconColor="text-emerald-400"
                title="Bidirectional"
                desc="Tasks you add show up for the agent. Tasks the agent adds show up for you. Always in sync."
              />
            </div>

            {/* Board preview */}
            <div className="mt-8">
              <p className="mb-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Your board columns
              </p>
              <div className="flex gap-2">
                {columns.map((col) => (
                  <div
                    key={col.id}
                    className="flex flex-1 items-center gap-2 rounded-lg border border-foreground/[0.04] bg-foreground/[0.02] px-3 py-2.5"
                  >
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: col.color }}
                    />
                    <span className="text-[12px] font-medium text-foreground/70">
                      {col.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={initBoard}
                className="flex items-center gap-2.5 rounded-xl bg-violet-600 px-7 py-3.5 text-[14px] font-medium text-white shadow-lg shadow-violet-500/20 transition-all hover:bg-violet-500 hover:shadow-violet-500/30 active:scale-[0.98]"
              >
                <Rocket className="h-4.5 w-4.5" />
                Set Up Task Board
              </button>
              <p className="max-w-xs text-center text-[11px] leading-relaxed text-muted-foreground/60">
                Creates <code className="rounded bg-foreground/[0.04] px-1 text-[10px]">kanban.json</code>
                {" "}&amp;{" "}
                <code className="rounded bg-foreground/[0.04] px-1 text-[10px]">TASKS.md</code>
                {" "}in your workspace.{" "}
                One click, zero config.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Board exists but is empty ---
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-lg px-6 py-12">
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
              <CheckCircle className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="text-[20px] font-semibold text-foreground">
              Board is clear
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
              All tasks done! Add a new one or ask your agent to add tasks for you.
            </p>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => setAddingToColumn("backlog")}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-[14px] font-medium text-white shadow-lg shadow-violet-500/20 transition-all hover:bg-violet-500 hover:shadow-violet-500/30"
            >
              <Plus className="h-4.5 w-4.5" />
              Add a task
            </button>
            <p className="text-[11px] text-muted-foreground/60">
              Or tell your agent: &ldquo;Add a task to&hellip;&rdquo;
            </p>
          </div>

          {addingToColumn && (
            <div className="mx-auto mt-6 max-w-sm">
              <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                Adding to: <span className="text-violet-400 capitalize">{addingToColumn}</span>
              </p>
              <AddTaskInline
                column={addingToColumn}
                onAdd={(task) => {
                  addTask(task);
                  setAddingToColumn(null);
                }}
                onCancel={() => setAddingToColumn(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── FeatureRow (onboarding) ─────────────────────── */

function FeatureRow({
  icon: Icon,
  iconColor,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3.5 rounded-xl border border-foreground/[0.04] bg-foreground/[0.02] p-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04]">
        <Icon className={cn("h-4 w-4", iconColor)} />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground/90">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

/* ── StepIndicator (init animation) ──────────────── */

function StepIndicator({
  step,
  current,
  label,
  sublabel,
}: {
  step: number;
  current: number;
  label: string;
  sublabel: string;
}) {
  const isDone = current > step;
  const isActive = current === step;
  const isPending = current < step;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg px-4 py-2.5 transition-all duration-300",
        isDone && "bg-emerald-500/5",
        isActive && "bg-violet-500/5",
        isPending && "opacity-40"
      )}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center">
        {isDone ? (
          <CheckCircle className="h-5 w-5 text-emerald-400" />
        ) : isActive ? (
          <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
        ) : (
          <div className="h-2 w-2 rounded-full bg-zinc-600" />
        )}
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "text-[13px] font-medium",
            isDone ? "text-emerald-300" : isActive ? "text-foreground/90" : "text-muted-foreground"
          )}
        >
          {label}
        </p>
        <p className="text-[11px] text-muted-foreground/60">{sublabel}</p>
      </div>
    </div>
  );
}

/* ── EditTaskInline ──────────────────────────────── */

function EditTaskInline({
  task,
  columns,
  onSave,
  onCancel,
  onDelete,
}: {
  task: Task;
  columns: Column[];
  onSave: (updates: Partial<Task>) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description || "");
  const [priority, setPriority] = useState(task.priority);
  const [column, setColumn] = useState(task.column);
  const [assignee, setAssignee] = useState(task.assignee || "");

  const save = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: desc.trim() || undefined,
      priority,
      column,
      assignee: assignee.trim() || undefined,
    });
  };

  return (
    <div className="rounded-lg border border-violet-500/30 bg-card p-3.5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onCancel();
        }}
        className="mb-2 w-full bg-transparent text-[13px] font-medium text-foreground/90 outline-none placeholder:text-muted-foreground/60"
        autoFocus
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Description"
        rows={2}
        className="mb-2 w-full resize-none bg-transparent text-[12px] leading-5 text-muted-foreground outline-none placeholder:text-muted-foreground/60"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="rounded border border-foreground/[0.08] bg-muted px-2 py-1 text-[11px] text-muted-foreground outline-none"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={column}
          onChange={(e) => setColumn(e.target.value)}
          className="rounded border border-foreground/[0.08] bg-muted px-2 py-1 text-[11px] text-muted-foreground outline-none"
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          placeholder="Assignee"
          className="flex-1 rounded border border-foreground/[0.08] bg-muted px-2 py-1 text-[11px] text-muted-foreground outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-red-500/20 hover:text-red-400"
          title="Delete task"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground/70"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!title.trim()}
          className="flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
        >
          <Check className="h-3 w-3" /> Save
        </button>
      </div>
    </div>
  );
}
