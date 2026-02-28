import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { getDefaultWorkspace } from "@/lib/paths";
import {
  deleteCalendarEntry,
  parseChannelReminder,
  patchCalendarEntry,
  readCalendarEntries,
  readTaskDueDates,
  runReminderDispatch,
  upsertCalendarEntry,
  writeCalendarEntries,
  type CalendarEntry,
  type CalendarEntryStatus,
} from "@/lib/calendar-store";

export const dynamic = "force-dynamic";

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

async function ensureCalendarMemoryFiles(workspace: string): Promise<void> {
  await mkdir(workspace, { recursive: true });
  const reminderPath = join(workspace, "REMINDER.md");
  const eventPath = join(workspace, "EVENT.md");
  const reminderDoc = `# Reminders (calendar-events.json)

This workspace uses \`calendar-events.json\` for reminders/events used by Mission Control calendar.

## Rules
- Add reminders as objects in \`calendar-events.json\` with \`kind: "reminder"\`.
- Use ISO date-time in \`dueAt\` (e.g. \`2026-03-01T15:00:00Z\`), or date-only if needed.
- Keep \`status\` as \`scheduled\` when creating a new reminder.
- Set \`source\` to \`channel\` when the reminder comes from chat/channel messages.

## Example reminder object
\`\`\`json
{
  "id": "uuid",
  "kind": "reminder",
  "title": "Call Alex",
  "notes": "About the quarterly report",
  "dueAt": "2026-03-01T15:00:00Z",
  "status": "scheduled",
  "source": "channel",
  "channel": "telegram"
}
\`\`\`
`;

  const eventDoc = `# Events (calendar-events.json)

This workspace uses \`calendar-events.json\` for reminders/events used by Mission Control calendar.

## Rules
- Add appointments/events as objects in \`calendar-events.json\` with \`kind: "event"\`.
- Use ISO date-time in \`dueAt\`.
- Keep \`status\` as \`scheduled\` when creating a new event.
- Include clear title and optional notes.

## Example event object
\`\`\`json
{
  "id": "uuid",
  "kind": "event",
  "title": "Dentist appointment",
  "notes": "Bring insurance card",
  "dueAt": "2026-03-05T09:30:00Z",
  "status": "scheduled",
  "source": "manual"
}
\`\`\`
`;

  try {
    await readFile(reminderPath, "utf-8");
  } catch {
    await writeFile(reminderPath, reminderDoc, "utf-8");
  }

  try {
    await readFile(eventPath, "utf-8");
  } catch {
    await writeFile(eventPath, eventDoc, "utf-8");
  }
}

function formatEntryForCalendar(entry: CalendarEntry) {
  return {
    ...entry,
    day: dayKey(entry.dueAt),
  };
}

function formatTaskForCalendar(task: Awaited<ReturnType<typeof readTaskDueDates>>[number]) {
  return {
    ...task,
    day: dayKey(task.dueAt),
  };
}

export async function GET() {
  try {
    const workspace = await getDefaultWorkspace();
    await ensureCalendarMemoryFiles(workspace);

    const entries = await readCalendarEntries(workspace);
    const taskDue = await readTaskDueDates(workspace);

    const combined = [
      ...entries.map((e) => ({ ...formatEntryForCalendar(e), type: e.kind })),
      ...taskDue.map((t) => ({ ...formatTaskForCalendar(t), type: "task" as const })),
    ].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

    const now = Date.now();
    const upcoming = combined
      .filter((item) => {
        if (item.type === "task") return item.status !== "done";
        return item.status === "scheduled" || item.status === "sent";
      })
      .filter((item) => new Date(item.dueAt).getTime() >= now - 30 * 60000)
      .slice(0, 5);

    return NextResponse.json({
      ok: true,
      entries: entries.map(formatEntryForCalendar),
      taskDue: taskDue.map(formatTaskForCalendar),
      upcoming,
      workspace,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspace = await getDefaultWorkspace();
    const body = await request.json();
    const action = String(body?.action || "");

    if (action === "init") {
      await ensureCalendarMemoryFiles(workspace);
      return NextResponse.json({ ok: true });
    }

    if (action === "dispatch") {
      const entries = await readCalendarEntries(workspace);
      const nowIso = new Date().toISOString();
      const { updated, dispatched } = runReminderDispatch(entries, nowIso);
      if (dispatched.length > 0) {
        await writeCalendarEntries(workspace, updated);
      }
      return NextResponse.json({ ok: true, dispatched: dispatched.length, entries: updated });
    }

    if (action === "channel-message") {
      const text = String(body?.text || "");
      const parsed = parseChannelReminder(text);
      if (!parsed) {
        return NextResponse.json({ ok: false, error: "No reminder/event detected in message" }, { status: 400 });
      }
      const created = await upsertCalendarEntry(workspace, {
        kind: parsed.kind,
        title: parsed.title,
        notes: typeof body?.notes === "string" ? body.notes : undefined,
        dueAt: parsed.dueAt,
        status: "scheduled",
        source: "channel",
        channel: typeof body?.channel === "string" ? body.channel : undefined,
        agentId: typeof body?.agentId === "string" ? body.agentId : undefined,
      });
      return NextResponse.json({ ok: true, entry: formatEntryForCalendar(created) });
    }

    if (action === "create") {
      const kind = body?.kind === "event" ? "event" : "reminder";
      const title = String(body?.title || "").trim();
      const dueAt = String(body?.dueAt || "").trim();
      if (!title || !dueAt) {
        return NextResponse.json({ error: "title and dueAt required" }, { status: 400 });
      }
      const created = await upsertCalendarEntry(workspace, {
        kind,
        title,
        notes: typeof body?.notes === "string" ? body.notes : undefined,
        dueAt,
        status: "scheduled",
        source: "manual",
      });
      return NextResponse.json({ ok: true, entry: formatEntryForCalendar(created) });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const workspace = await getDefaultWorkspace();
    const body = await request.json();
    const id = String(body?.id || "").trim();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const patch: {
      kind?: "reminder" | "event";
      title?: string;
      notes?: string;
      dueAt?: string;
      status?: CalendarEntryStatus;
      previousStatus?: CalendarEntryStatus | null;
    } = {};
    if (typeof body?.title === "string") patch.title = body.title;
    if (typeof body?.notes === "string") patch.notes = body.notes;
    if (typeof body?.dueAt === "string") patch.dueAt = body.dueAt;
    if (body?.kind === "reminder" || body?.kind === "event") patch.kind = body.kind;
    if (typeof body?.status === "string") patch.status = body.status as CalendarEntryStatus;
    if (body?.previousStatus === null) patch.previousStatus = null;
    if (typeof body?.previousStatus === "string") patch.previousStatus = body.previousStatus as CalendarEntryStatus;

    const patched = await patchCalendarEntry(workspace, id, patch);
    if (!patched) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, entry: formatEntryForCalendar(patched) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const workspace = await getDefaultWorkspace();
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get("id") || "").trim();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const ok = await deleteCalendarEntry(workspace, id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
