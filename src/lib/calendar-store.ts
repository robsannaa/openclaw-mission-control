import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

export type CalendarEntryKind = "reminder" | "event";
export type CalendarEntryStatus = "scheduled" | "sent" | "done" | "cancelled" | "failed";

export type CalendarEntry = {
  id: string;
  kind: CalendarEntryKind;
  title: string;
  notes?: string;
  dueAt: string;
  status: CalendarEntryStatus;
  createdAt: string;
  updatedAt: string;
  source: "manual" | "channel" | "agent" | "provider";
  channel?: string;
  agentId?: string;
  provider?: "caldav";
  providerAccountId?: string;
  externalId?: string;
  readOnly?: boolean;
  lastSyncedAt?: string;
  deliveredAt?: string;
  lastError?: string;
  previousStatus?: CalendarEntryStatus;
};

type CalendarStore = {
  version: 1;
  entries: CalendarEntry[];
};

type KanbanTaskLike = {
  id?: number | string;
  title?: string;
  description?: string;
  dueAt?: string;
  dueDate?: string;
  due?: string;
  column?: string;
  priority?: string;
};

export type CalendarTaskDue = {
  id: string;
  kind: "task";
  title: string;
  notes?: string;
  dueAt: string;
  status: "open" | "done";
  priority?: string;
};

export function asIso(input: string): string | null {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toDateOnlyStartIso(input: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  return new Date(y, mo - 1, da, 9, 0, 0, 0).toISOString();
}

export function resolveDueAt(input: string): string | null {
  return asIso(input) || toDateOnlyStartIso(input);
}

function calendarPath(workspace: string): string {
  return join(workspace, "calendar-events.json");
}

export async function readCalendarEntries(workspace: string): Promise<CalendarEntry[]> {
  try {
    const raw = await readFile(calendarPath(workspace), "utf-8");
    const parsed = JSON.parse(raw) as Partial<CalendarStore>;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return entries
      .filter((e): e is CalendarEntry => Boolean(e && typeof e === "object" && typeof (e as CalendarEntry).id === "string"))
      .filter((e) => Boolean(resolveDueAt(e.dueAt)));
  } catch {
    return [];
  }
}

export async function writeCalendarEntries(workspace: string, entries: CalendarEntry[]): Promise<void> {
  await mkdir(workspace, { recursive: true });
  const payload: CalendarStore = { version: 1, entries };
  await writeFile(calendarPath(workspace), JSON.stringify(payload, null, 2), "utf-8");
}

export async function upsertCalendarEntry(
  workspace: string,
  payload: Omit<CalendarEntry, "id" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<CalendarEntry> {
  const entries = await readCalendarEntries(workspace);
  const now = new Date().toISOString();
  const dueAt = resolveDueAt(payload.dueAt);
  if (!dueAt) throw new Error("Invalid dueAt");

  const next: CalendarEntry = {
    id: payload.id || randomUUID(),
    kind: payload.kind,
    title: payload.title.trim(),
    notes: payload.notes?.trim() || undefined,
    dueAt,
    status: payload.status,
    source: payload.source,
    channel: payload.channel,
    agentId: payload.agentId,
    provider: payload.provider,
    providerAccountId: payload.providerAccountId,
    externalId: payload.externalId,
    readOnly: payload.readOnly,
    lastSyncedAt: payload.lastSyncedAt,
    deliveredAt: payload.deliveredAt,
    lastError: payload.lastError,
    createdAt: now,
    updatedAt: now,
  };

  const existingIdx = entries.findIndex((e) => e.id === next.id);
  if (existingIdx >= 0) {
    const existing = entries[existingIdx];
    entries[existingIdx] = {
      ...existing,
      ...next,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  } else {
    entries.push(next);
  }

  await writeCalendarEntries(workspace, entries);
  return existingIdx >= 0 ? entries[existingIdx] : next;
}

export async function patchCalendarEntry(
  workspace: string,
  id: string,
  patch: Partial<Pick<CalendarEntry, "kind" | "title" | "notes" | "dueAt" | "status" | "lastError" | "deliveredAt">> & {
    previousStatus?: CalendarEntryStatus | null;
  }
): Promise<CalendarEntry | null> {
  const entries = await readCalendarEntries(workspace);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const current = entries[idx];
  const now = new Date().toISOString();
  const nextDueAt = patch.dueAt != null ? resolveDueAt(patch.dueAt) : current.dueAt;
  if (!nextDueAt) throw new Error("Invalid dueAt");
  const next: CalendarEntry = { ...current, dueAt: nextDueAt, updatedAt: now };

  if (patch.kind === "reminder" || patch.kind === "event") {
    next.kind = patch.kind;
  }

  if (typeof patch.title === "string") {
    const trimmed = patch.title.trim();
    if (trimmed) next.title = trimmed;
  }
  if (typeof patch.notes === "string") {
    next.notes = patch.notes.trim() || undefined;
  }
  if (typeof patch.status === "string") {
    next.status = patch.status as CalendarEntryStatus;
  }
  if (typeof patch.lastError === "string") {
    next.lastError = patch.lastError;
  }
  if (typeof patch.deliveredAt === "string") {
    next.deliveredAt = patch.deliveredAt;
  }
  if (patch.previousStatus === null) {
    delete next.previousStatus;
  } else if (typeof patch.previousStatus === "string") {
    next.previousStatus = patch.previousStatus;
  }

  entries[idx] = next;
  await writeCalendarEntries(workspace, entries);
  return next;
}

export async function deleteCalendarEntry(workspace: string, id: string): Promise<boolean> {
  const entries = await readCalendarEntries(workspace);
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) return false;
  await writeCalendarEntries(workspace, next);
  return true;
}

export async function readTaskDueDates(workspace: string): Promise<CalendarTaskDue[]> {
  const path = join(workspace, "kanban.json");
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as { tasks?: KanbanTaskLike[] };
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const out: CalendarTaskDue[] = [];
    for (const task of tasks) {
      const dueRaw =
        typeof task.dueAt === "string" && task.dueAt.trim()
          ? task.dueAt
          : typeof task.dueDate === "string" && task.dueDate.trim()
            ? task.dueDate
            : typeof task.due === "string" && task.due.trim()
              ? task.due
              : "";
      if (!dueRaw) continue;
      const dueAt = resolveDueAt(dueRaw);
      if (!dueAt) continue;
      const id = String(task.id ?? randomUUID());
      out.push({
        id: `task:${id}`,
        kind: "task",
        title: String(task.title || `Task ${id}`),
        notes: typeof task.description === "string" ? task.description : undefined,
        dueAt,
        status: String(task.column || "").toLowerCase() === "done" ? "done" : "open",
        priority: typeof task.priority === "string" ? task.priority : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function parseChannelReminder(text: string): {
  kind: CalendarEntryKind;
  title: string;
  dueAt: string;
} | null {
  const clean = String(text || "").trim();
  if (!clean) return null;

  const iso = /(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/i.exec(clean);
  if (!iso) return null;
  const date = iso[1];
  const time = iso[2] || "09:00";
  const dueAt = resolveDueAt(`${date} ${time}`);
  if (!dueAt) return null;

  const lower = clean.toLowerCase();
  const kind: CalendarEntryKind = lower.includes("appointment") || lower.includes("meeting")
    ? "event"
    : "reminder";

  const withoutLead = clean
    .replace(/^\s*(remind me to|set (a )?reminder to|add reminder to)\s*/i, "")
    .replace(/\s*(on|at)\s*\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?.*$/i, "")
    .trim();

  const title = withoutLead || clean;
  return { kind, title, dueAt };
}

export function runReminderDispatch(entries: CalendarEntry[], nowIso = new Date().toISOString()): {
  updated: CalendarEntry[];
  dispatched: CalendarEntry[];
} {
  const now = new Date(nowIso).getTime();
  const dispatched: CalendarEntry[] = [];
  const updated = entries.map((entry) => {
    if (entry.kind !== "reminder") return entry;
    if (entry.status !== "scheduled") return entry;
    const due = new Date(entry.dueAt).getTime();
    if (Number.isNaN(due) || due > now) return entry;
    const next: CalendarEntry = {
      ...entry,
      status: "sent",
      deliveredAt: nowIso,
      updatedAt: nowIso,
    };
    dispatched.push(next);
    return next;
  });
  return { updated, dispatched };
}
