"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Bell,
  CalendarClock,
  ListChecks,
  Check,
  MoreVertical,
  Pencil,
  Trash2,
  X,
  RefreshCw,
} from "lucide-react";
import { SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { ThemedSelect } from "@/components/ui/themed-select";
import { cn } from "@/lib/utils";

type CalendarEntry = {
  id: string;
  kind: "reminder" | "event";
  title: string;
  notes?: string;
  dueAt: string;
  day: string;
  status: "scheduled" | "sent" | "done" | "cancelled" | "failed";
  previousStatus?: "scheduled" | "sent" | "cancelled" | "failed";
};

type TaskDue = {
  id: string;
  kind: "task";
  title: string;
  notes?: string;
  dueAt: string;
  day: string;
  status: "open" | "done";
  priority?: string;
};

type CalendarItem =
  | (CalendarEntry & { type: "reminder" | "event" })
  | (TaskDue & { type: "task" });

type ApiPayload = {
  entries: CalendarEntry[];
  taskDue: TaskDue[];
  upcoming: CalendarItem[];
};

type PendingAction =
  | { type: "complete" | "undo"; item: CalendarItem }
  | { type: "delete"; item: CalendarItem }
  | null;

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function truncateTitle(value: string, max = 34): string {
  const input = String(value || "").trim();
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function toDateTimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${da}T${hh}:${mm}`;
}

function startOfMonthGrid(viewMonth: Date): Date {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const day = first.getDay();
  return new Date(first.getFullYear(), first.getMonth(), first.getDate() - day);
}

function badgeForType(type: CalendarItem["type"]): { label: string; className: string; Icon: typeof Bell } {
  if (type === "reminder") {
    return {
      label: "Reminder",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
      Icon: Bell,
    };
  }
  if (type === "event") {
    return {
      label: "Event",
      className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
      Icon: CalendarClock,
    };
  }
  return {
    label: "Task",
    className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
    Icon: ListChecks,
  };
}

const CALENDAR_INPUT_CLASS =
  "rounded-lg border border-foreground/15 bg-muted/70 px-3 py-2 text-sm text-foreground/90 shadow-inner outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-sky-500/35 focus:bg-background/90";

export function CalendarView() {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [newTitle, setNewTitle] = useState("");
  const [newDueAt, setNewDueAt] = useState("");
  const [newKind, setNewKind] = useState<"reminder" | "event">("reminder");
  const [saving, setSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editKind, setEditKind] = useState<"reminder" | "event">("reminder");
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [runningAction, setRunningAction] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/calendar", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Failed to load calendar");
    setPayload(data);
  }, []);

  const runDispatch = useCallback(async () => {
    await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dispatch" }),
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "init" }),
        });
        await runDispatch();
        await refresh();
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const timer = setInterval(() => {
      void runDispatch().then(refresh).catch(() => {});
    }, 60000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [refresh, runDispatch]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    const entries = payload?.entries || [];
    const taskDue = payload?.taskDue || [];
    const merged: CalendarItem[] = [
      ...entries.map((e) => ({ ...e, type: e.kind })),
      ...taskDue.map((t) => ({ ...t, type: "task" as const })),
    ];
    for (const item of merged) {
      const day = item.day;
      if (!map.has(day)) map.set(day, []);
      map.get(day)?.push(item);
    }
    map.forEach((items) => {
      items.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    });
    return map;
  }, [payload]);

  const monthDays = useMemo(() => {
    const start = startOfMonthGrid(viewMonth);
    const days: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return days;
  }, [viewMonth]);

  const createItem = useCallback(async () => {
    if (!newTitle.trim() || !newDueAt.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          kind: newKind,
          title: newTitle.trim(),
          dueAt: newDueAt,
        }),
      });
      setNewTitle("");
      setNewDueAt("");
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [newDueAt, newKind, newTitle, refresh]);

  const patchEntry = useCallback(async (id: string, patch: Record<string, unknown>) => {
    await fetch("/api/calendar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    await refresh();
  }, [refresh]);

  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await runDispatch();
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh, runDispatch]);

  const isCompletedItem = useCallback((item: CalendarItem): boolean => {
    if (item.type === "task") return item.status === "done";
    return item.status === "done";
  }, []);

  const requestToggleComplete = useCallback((item: CalendarItem) => {
    if (item.type === "task") return;
    setPendingAction({ type: isCompletedItem(item) ? "undo" : "complete", item });
  }, [isCompletedItem]);

  const requestDelete = useCallback((item: CalendarItem) => {
    if (item.type === "task") return;
    setPendingAction({ type: "delete", item });
  }, []);

  const confirmPendingAction = useCallback(async () => {
    if (!pendingAction) return;
    const { type, item } = pendingAction;
    if (item.type === "task") {
      setPendingAction(null);
      return;
    }
    setRunningAction(true);
    try {
      if (type === "complete") {
        await patchEntry(item.id, { status: "done", previousStatus: item.status });
      } else if (type === "undo") {
        const restoreStatus = item.previousStatus || "scheduled";
        await patchEntry(item.id, { status: restoreStatus, previousStatus: null });
      } else {
        await fetch(`/api/calendar?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
        await refresh();
      }
      setPendingAction(null);
    } finally {
      setRunningAction(false);
    }
  }, [patchEntry, pendingAction, refresh]);

  const openEditModal = useCallback((item: CalendarItem) => {
    if (item.type === "task") return;
    setEditItemId(item.id);
    setEditTitle(item.title);
    setEditDueAt(toDateTimeLocalValue(item.dueAt));
    setEditKind(item.type);
  }, []);

  const closeEditModal = useCallback(() => {
    if (savingEdit) return;
    setEditItemId(null);
    setEditTitle("");
    setEditDueAt("");
    setEditKind("reminder");
  }, [savingEdit]);

  const submitEditModal = useCallback(async () => {
    if (!editItemId) return;
    const trimmed = editTitle.trim();
    if (!trimmed || !editDueAt.trim()) return;
    setSavingEdit(true);
    try {
      await patchEntry(editItemId, {
        title: trimmed,
        dueAt: editDueAt,
        kind: editKind,
      });
      closeEditModal();
    } finally {
      setSavingEdit(false);
    }
  }, [closeEditModal, editDueAt, editItemId, editKind, editTitle, patchEntry]);

  if (loading) return <LoadingState label="Loading calendar..." />;

  return (
    <SectionLayout>
      <div className="shrink-0 border-b border-foreground/10 px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold text-foreground">Calendar</h2>
            <p className="text-sm text-muted-foreground">Tasks, reminders, and events in one timeline.</p>
          </div>
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => void manualRefresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-md border border-foreground/10 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              aria-label="Refresh calendar"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="rounded-md border border-foreground/10 p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-40 text-center text-sm font-medium text-foreground">{monthLabel(viewMonth)}</span>
            <button
              type="button"
              onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="rounded-md border border-foreground/10 p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_220px_180px_140px]">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add reminder or event title"
            className={CALENDAR_INPUT_CLASS}
          />
          <DateTimePicker
            value={newDueAt}
            onChange={setNewDueAt}
            placeholder="Pick date & time"
          />
          <ThemedSelect
            value={newKind}
            onChange={(value) => setNewKind(value === "event" ? "event" : "reminder")}
            options={[{ value: "reminder", label: "Reminder" }, { value: "event", label: "Event" }]}
            className="w-full"
          />
          <button
            type="button"
            onClick={() => void createItem()}
            disabled={saving || !newTitle.trim() || !newDueAt.trim()}
            className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 disabled:opacity-60"
          >
            {saving ? "Adding..." : "Add"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="grid gap-1 rounded-lg border border-foreground/10 bg-card/30 p-2 md:grid-cols-7">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
            <div key={w} className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {w}
            </div>
          ))}
          {monthDays.map((day) => {
            const dayK = toDayKey(day);
            const items = itemsByDay.get(dayK) || [];
            const inMonth = day.getMonth() === viewMonth.getMonth();
            return (
              <div key={dayK} className={cn("min-h-28 rounded-md border border-foreground/10 bg-background/50 p-2", !inMonth && "opacity-45") }>
                <div className="mb-1 text-xs font-medium text-foreground/80">{day.getDate()}</div>
                <div className="space-y-1">
                  {items.slice(0, 3).map((item) => {
                    const badge = badgeForType(item.type);
                    const Icon = badge.Icon;
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[11px]",
                          isCompletedItem(item)
                            ? "border-foreground/15 bg-foreground/5 text-muted-foreground"
                            : badge.className
                        )}
                        title={`${item.title} · ${formatDateTime(item.dueAt)}`}
                      >
                        <div className="flex items-center gap-1">
                          <Icon className="h-3 w-3 shrink-0" />
                          <span className={cn("min-w-0 flex-1 truncate", isCompletedItem(item) && "line-through")}>
                            {truncateTitle(item.title, 30)}
                          </span>
                          <span className="shrink-0 text-[10px] font-medium text-foreground/85">{formatTimeOnly(item.dueAt)}</span>
                          {isCompletedItem(item) && <Check className="h-3 w-3 shrink-0" />}
                          {item.type !== "task" && (
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setOpenMenuId((prev) => (prev === item.id ? null : item.id))}
                                className="rounded p-0.5 text-muted-foreground/80 hover:bg-background/70 hover:text-foreground"
                                aria-haspopup="menu"
                                aria-expanded={openMenuId === item.id}
                                aria-label="Open item actions"
                              >
                                <MoreVertical className="h-3 w-3" />
                              </button>
                              {openMenuId === item.id && (
                                <div className="absolute right-0 z-20 mt-1 w-32 rounded-md border border-foreground/20 bg-card p-1 shadow-xl">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      openEditModal(item);
                                    }}
                                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-foreground/90 hover:bg-foreground/10"
                                  >
                                    <Pencil className="h-3 w-3" />
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      requestToggleComplete(item);
                                    }}
                                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-emerald-300 hover:bg-emerald-500/10"
                                  >
                                    <Check className="h-3 w-3" />
                                    {isCompletedItem(item) ? "Undo" : "Complete"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      requestDelete(item);
                                    }}
                                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-red-300 hover:bg-red-500/10"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {items.length > 3 && (
                    <div className="text-[11px] text-muted-foreground/70">+{items.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-lg border border-foreground/10 bg-card/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            <CalendarDays className="h-3.5 w-3.5" />
            Upcoming Events
          </div>
          <div className="space-y-2">
            {(payload?.upcoming || []).length === 0 && (
              <p className="text-sm text-muted-foreground/70">No upcoming items.</p>
            )}
            {(payload?.upcoming || []).map((item) => {
              const badge = badgeForType(item.type);
              const Icon = badge.Icon;
              const canQuickActions = item.type !== "task";
              return (
                <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border border-foreground/10 bg-background/60 px-3 py-2">
                  <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs", badge.className)}>
                    <Icon className="h-3 w-3" />
                    {badge.label}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate text-sm text-foreground/90", isCompletedItem(item) && "text-muted-foreground line-through")}>
                    {truncateTitle(item.title, 52)}
                  </span>
                  {isCompletedItem(item) && <Check className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-xs text-muted-foreground/70">{formatDateTime(item.dueAt)}</span>
                  {canQuickActions && (
                    <>
                      <button
                        type="button"
                        onClick={() => requestToggleComplete(item)}
                        className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300"
                      >
                        {isCompletedItem(item) ? "Undo" : "Complete"}
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDelete(item)}
                        className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-300"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {pendingAction && pendingAction.item.type !== "task" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-xl border border-foreground/10 bg-card p-4 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {pendingAction.type === "complete"
                  ? "Complete item"
                  : pendingAction.type === "undo"
                    ? "Undo completion"
                    : "Delete item"}
              </h3>
              <button
                type="button"
                onClick={() => !runningAction && setPendingAction(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                aria-label="Close confirmation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm text-muted-foreground">
              {pendingAction.type === "complete"
                ? "This will keep the item on the calendar as completed (greyed out with a checkmark) and remove it from Upcoming."
                : pendingAction.type === "undo"
                  ? "This will restore the item to its state before completion and add it back to Upcoming if relevant."
                  : "This will permanently remove the item from the calendar and Upcoming."}
            </p>
            <p className="mt-2 rounded-md border border-foreground/10 bg-background/60 px-2 py-1 text-sm text-foreground/90">
              {pendingAction.item.title}
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={runningAction}
                className="rounded-md border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmPendingAction()}
                disabled={runningAction}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60",
                  pendingAction.type === "complete" || pendingAction.type === "undo"
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border border-red-500/30 bg-red-500/10 text-red-300"
                )}
              >
                {runningAction
                  ? pendingAction.type === "complete"
                    ? "Completing..."
                    : pendingAction.type === "undo"
                      ? "Undoing..."
                      : "Deleting..."
                  : pendingAction.type === "complete"
                    ? "Complete"
                    : pendingAction.type === "undo"
                      ? "Undo"
                      : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editItemId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-xl border border-foreground/10 bg-card p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Edit calendar item</h3>
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-md p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                aria-label="Close editor"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs text-muted-foreground">
                Title
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className={cn("mt-1 w-full", CALENDAR_INPUT_CLASS)}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="block text-xs text-muted-foreground">
                  <p>Date & time</p>
                  <DateTimePicker
                    value={editDueAt}
                    onChange={setEditDueAt}
                    className="mt-1 w-full"
                  />
                </div>
                <div className="block text-xs text-muted-foreground">
                  <p>Type</p>
                  <ThemedSelect
                    value={editKind}
                    onChange={(value) => setEditKind(value === "event" ? "event" : "reminder")}
                    options={[{ value: "reminder", label: "Reminder" }, { value: "event", label: "Event" }]}
                    className="mt-1 w-full"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-md border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitEditModal()}
                disabled={savingEdit || !editTitle.trim() || !editDueAt.trim()}
                className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 disabled:opacity-60"
              >
                {savingEdit ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SectionLayout>
  );
}
