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
import {
  deleteCalendarProvider,
  markCalendarProviderStatus,
  purgeProviderEvents,
  readCalendarProviderSecret,
  readCalendarProviders,
  syncCalDavProvider,
  testCalDavConnection,
  testOrDiscoverCalDavConnection,
  upsertCalendarProvider,
} from "@/lib/calendar-providers";

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
  const calendarPath = join(workspace, "CALENDAR.md");
  const reminderPath = join(workspace, "REMINDER.md");
  const eventPath = join(workspace, "EVENT.md");
  const calendarDoc = `# Calendar Playbook (Mission Control)

This workspace uses a local calendar system for reminders/events shown in Mission Control.

## Source of truth

- Primary source: \`calendar-events.json\` in this workspace.
- \`REMINDER.md\` and \`EVENT.md\` define object shapes/rules.
- \`TASKS.md\` remains separate and should not be rewritten for calendar operations.

## Core policy

- When user asks to create a reminder/appointment/event, always write it to \`calendar-events.json\`.
- When user asks about upcoming/next events, read \`calendar-events.json\` first.
- Do not rely only on Google Calendar unless user explicitly asks for it.
- If using external calendar tools, still mirror the item into \`calendar-events.json\`.

## Time handling

- Default timezone: \`America/New_York\` unless user says otherwise.
- Convert natural language dates/times into a concrete ISO datetime in \`dueAt\`.
- If user says only date (no time), default to \`09:00\` local time.
`;
  const reminderDoc = `# Reminders (calendar-events.json)

This workspace uses \`calendar-events.json\` for reminders/events used by Mission Control calendar.

## Priority order
- Follow \`CALENDAR.md\` first for behavior/policy.
- Use this file for reminder-specific schema details.
- Keep \`TASKS.md\` separate unless user explicitly asks to create/update tasks.

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

## Priority order
- Follow \`CALENDAR.md\` first for behavior/policy.
- Use this file for event-specific schema details.
- Keep \`TASKS.md\` separate unless user explicitly asks to create/update tasks.

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
    await readFile(calendarPath, "utf-8");
  } catch {
    await writeFile(calendarPath, calendarDoc, "utf-8");
  }

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
    const providers = await readCalendarProviders(workspace);

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
      providers: providers.map((p) => ({
        ...p,
        secretRef: p.secretRef ? `${p.secretRef.slice(0, 10)}***` : "",
        hasSecret: Boolean(p.secretRef),
      })),
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

    if (action === "providers-list") {
      const providers = await readCalendarProviders(workspace);
      return NextResponse.json({
        ok: true,
        providers: providers.map((p) => ({
          ...p,
          secretRef: p.secretRef ? `${p.secretRef.slice(0, 10)}***` : "",
          hasSecret: Boolean(p.secretRef),
        })),
      });
    }

    if (action === "provider-test") {
      const type = body?.type === "caldav" ? "caldav" : "caldav";
      if (type !== "caldav") {
        return NextResponse.json({ ok: false, error: "Only CalDAV is currently supported" }, { status: 400 });
      }
      const serverUrl = String(body?.serverUrl || body?.calendarUrl || "https://caldav.icloud.com").trim();
      const calendarUrl = String(body?.calendarUrl || "").trim();
      const username = String(body?.username || "").trim();
      const cutoffDate = String(body?.cutoffDate || "").trim();
      const password = String(body?.password || "").trim();
      if (!username || !password) {
        return NextResponse.json({ ok: false, error: "username and password are required" }, { status: 400 });
      }
      const result = await testOrDiscoverCalDavConnection({ serverUrl, calendarUrl, username }, password);
      return NextResponse.json({ ok: true, calendarUrl: result.calendarUrl });
    }

    if (action === "provider-add") {
      const type = body?.type === "caldav" ? "caldav" : "caldav";
      const id = typeof body?.id === "string" ? body.id : undefined;
      const label = String(body?.label || "").trim();
      const serverUrl = String(body?.serverUrl || body?.calendarUrl || "https://caldav.icloud.com").trim();
      let calendarUrl = String(body?.calendarUrl || "").trim();
      const username = String(body?.username || "").trim();
      const cutoffDate = String(body?.cutoffDate || "").trim();
      const password = String(body?.password || "").trim();
      if (!label || !username || (!id && !password)) {
        return NextResponse.json({ ok: false, error: "label and username are required (password required for new provider)" }, { status: 400 });
      }
      const existing = id ? (await readCalendarProviders(workspace)).find((p) => p.id === id) : undefined;
      if (id && !existing) {
        return NextResponse.json({ ok: false, error: "Provider account not found" }, { status: 404 });
      }
      const secretForDiscovery = password || (existing ? (await readCalendarProviderSecret(existing.secretRef)) || "" : "");
      if (!calendarUrl || /^https?:\/\/[^/]+\/?$/i.test(calendarUrl)) {
        if (!secretForDiscovery) {
          return NextResponse.json({ ok: false, error: "Password is required to discover calendar URL" }, { status: 400 });
        }
        const discovered = await testOrDiscoverCalDavConnection({ serverUrl, calendarUrl, username }, secretForDiscovery);
        calendarUrl = discovered.calendarUrl;
      }
      const account = await upsertCalendarProvider(workspace, {
        id,
        type,
        label,
        serverUrl,
        calendarUrl,
        username,
        cutoffDate: cutoffDate || undefined,
        enabled: body?.enabled !== false,
        secret: password,
        secretRef: existing?.secretRef,
      });
      return NextResponse.json({
        ok: true,
        provider: {
          ...account,
          secretRef: account.secretRef ? `${account.secretRef.slice(0, 10)}***` : "",
          hasSecret: true,
        },
      });
    }

    if (action === "provider-sync") {
      const accountId = String(body?.accountId || "").trim();
      if (!accountId) {
        return NextResponse.json({ ok: false, error: "accountId required" }, { status: 400 });
      }
      const providers = await readCalendarProviders(workspace);
      const account = providers.find((p) => p.id === accountId);
      if (!account) {
        return NextResponse.json({ ok: false, error: "Provider account not found" }, { status: 404 });
      }
      if (account.type !== "caldav") {
        return NextResponse.json({ ok: false, error: "Only CalDAV sync currently supported" }, { status: 400 });
      }
      try {
        const imported = await syncCalDavProvider(workspace, account);
        await markCalendarProviderStatus(workspace, account.id, {
          lastSyncAt: new Date().toISOString(),
          lastError: null,
        });
        return NextResponse.json({ ok: true, imported });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markCalendarProviderStatus(workspace, account.id, { lastError: message });
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
      }
    }

    if (action === "provider-delete") {
      const accountId = String(body?.accountId || "").trim();
      if (!accountId) {
        return NextResponse.json({ ok: false, error: "accountId required" }, { status: 400 });
      }
      const ok = await deleteCalendarProvider(workspace, accountId);
      if (!ok) return NextResponse.json({ ok: false, error: "Provider account not found" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (action === "provider-purge") {
      const accountId = String(body?.accountId || "").trim();
      if (!accountId) {
        return NextResponse.json({ ok: false, error: "accountId required" }, { status: 400 });
      }
      const removed = await purgeProviderEvents(workspace, accountId);
      return NextResponse.json({ ok: true, removed });
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
