"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Info,
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
  source?: "manual" | "channel" | "agent" | "provider";
  provider?: "caldav";
  providerAccountId?: string;
  readOnly?: boolean;
};

type ProviderAccount = {
  id: string;
  type: "caldav";
  label: string;
  serverUrl: string;
  calendarUrl: string;
  username: string;
  cutoffDate?: string;
  enabled: boolean;
  hasSecret?: boolean;
  lastSyncAt?: string;
  lastError?: string;
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
  providers?: ProviderAccount[];
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

function toDateInputValue(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function startOfMonthGrid(viewMonth: Date): Date {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const day = first.getDay();
  return new Date(first.getFullYear(), first.getMonth(), first.getDate() - day);
}

function startOfWeek(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
}

function weekLabel(date: Date): string {
  const start = startOfWeek(date);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
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

function badgeForItem(item: CalendarItem, accountLabelById?: Record<string, string>): { label: string; className: string; Icon: typeof Bell } {
  const base = badgeForType(item.type);
  if (item.type !== "task" && (item.source === "provider" || item.readOnly)) {
    const accountLabel = item.providerAccountId ? accountLabelById?.[item.providerAccountId] : undefined;
    return {
      label: accountLabel || (item.provider === "caldav" ? "CalDAV" : "Imported"),
      className: "border-pink-500/30 bg-pink-500/15 text-pink-200",
      Icon: base.Icon,
    };
  }
  return base;
}

const CALENDAR_INPUT_CLASS =
  "rounded-lg border border-foreground/15 bg-muted/70 px-3 py-2 text-sm text-foreground/90 shadow-inner outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-sky-500/35 focus:bg-background/90";

const PROVIDER_INPUT_CLASS =
  "h-10 w-full rounded-lg border border-foreground/15 bg-muted/70 px-3 py-2 text-sm text-foreground/90 shadow-inner outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-sky-500/35 focus:bg-background/90";

export function CalendarView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newDueAt, setNewDueAt] = useState("");
  const [newKind, setNewKind] = useState<"reminder" | "event">("reminder");
  const [saving, setSaving] = useState(false);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [openInfoKey, setOpenInfoKey] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editKind, setEditKind] = useState<"reminder" | "event">("reminder");
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [runningAction, setRunningAction] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerSyncingId, setProviderSyncingId] = useState<string | null>(null);
  const [providerTesting, setProviderTesting] = useState(false);
  const [providerPreset, setProviderPreset] = useState<"icloud" | "google">("icloud");
  const [providerMessage, setProviderMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [providerRowMessage, setProviderRowMessage] = useState<Record<string, { type: "ok" | "err"; text: string }>>({});
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<{
    label: string;
    serverUrl: string;
    calendarUrl: string;
    username: string;
    cutoffDate: string;
    password: string;
  }>({ label: "", serverUrl: "", calendarUrl: "", username: "", cutoffDate: "", password: "" });
  const [providerEditSaving, setProviderEditSaving] = useState(false);
  const [hiddenProviderAccountIds, setHiddenProviderAccountIds] = useState<Set<string>>(new Set());
  const [purgeConfirmProviderId, setPurgeConfirmProviderId] = useState<string | null>(null);
  const [purgingProviderId, setPurgingProviderId] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState({
    label: "",
    serverUrl: "https://caldav.icloud.com",
    calendarUrl: "",
    username: "",
    password: "",
    cutoffDate: "",
  });

  const tab = (searchParams.get("tab") || "").toLowerCase();
  const providerTabActive = tab === "providers";

  const accountLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of payload?.providers || []) map[p.id] = p.label;
    return map;
  }, [payload?.providers]);

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

  useEffect(() => {
    if (!openMenuKey && !openInfoKey) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-calendar-floating='true']")) return;
      setOpenMenuKey(null);
      setOpenInfoKey(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuKey(null);
        setOpenInfoKey(null);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openInfoKey, openMenuKey]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    const entries = (payload?.entries || []).filter((entry) => {
      if (entry.source !== "provider") return true;
      if (!entry.providerAccountId) return true;
      return !hiddenProviderAccountIds.has(entry.providerAccountId);
    });
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
  }, [hiddenProviderAccountIds, payload]);

  const filteredUpcoming = useMemo(() => {
    return (payload?.upcoming || []).filter((item) => {
      if (item.type === "task") return true;
      if (item.source !== "provider") return true;
      if (!item.providerAccountId) return true;
      return !hiddenProviderAccountIds.has(item.providerAccountId);
    });
  }, [hiddenProviderAccountIds, payload?.upcoming]);

  const providerToPurge = useMemo(
    () => (payload?.providers || []).find((provider) => provider.id === purgeConfirmProviderId) || null,
    [payload?.providers, purgeConfirmProviderId]
  );

  const monthDays = useMemo(() => {
    const start = startOfMonthGrid(viewDate);
    const days: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return days;
  }, [viewDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(viewDate);
    return Array.from({ length: 7 }, (_, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    );
  }, [viewDate]);

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
          notes: newNotes.trim() || undefined,
          dueAt: newDueAt,
        }),
      });
      setNewTitle("");
      setNewNotes("");
      setNewDueAt("");
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [newDueAt, newKind, newNotes, newTitle, refresh]);

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

  const setCalendarTab = useCallback((nextTab: "events" | "providers") => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === "events") params.delete("tab");
    else params.set("tab", "providers");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [pathname, router, searchParams]);

  const testProvider = useCallback(async () => {
    setProviderTesting(true);
    setProviderMessage(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "provider-test",
          type: "caldav",
          serverUrl: providerForm.serverUrl,
          calendarUrl: providerForm.calendarUrl,
          username: providerForm.username,
          password: providerForm.password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Test failed (${res.status})`);
      }
      if (typeof data?.calendarUrl === "string" && data.calendarUrl.trim()) {
        setProviderForm((p) => ({ ...p, calendarUrl: data.calendarUrl }));
      }
      setProviderMessage({ type: "ok", text: "Connection successful. You can now save this provider." });
    } catch (err) {
      setProviderMessage({ type: "err", text: String(err instanceof Error ? err.message : err) });
    } finally {
      setProviderTesting(false);
    }
  }, [providerForm.calendarUrl, providerForm.password, providerForm.serverUrl, providerForm.username]);

  const saveProvider = useCallback(async () => {
    if (!providerForm.label.trim() || !providerForm.serverUrl.trim() || !providerForm.username.trim() || !providerForm.password.trim()) return;
    setProviderSaving(true);
    setProviderMessage(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "provider-add",
          type: "caldav",
          label: providerForm.label,
          serverUrl: providerForm.serverUrl,
          calendarUrl: providerForm.calendarUrl,
          username: providerForm.username,
          password: providerForm.password,
          cutoffDate: providerForm.cutoffDate || undefined,
          enabled: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
      setProviderForm((p) => ({ ...p, password: "", label: "", calendarUrl: "", cutoffDate: "" }));
      setProviderMessage({ type: "ok", text: "Provider saved." });
      await refresh();
    } catch (err) {
      setProviderMessage({ type: "err", text: String(err instanceof Error ? err.message : err) });
    } finally {
      setProviderSaving(false);
    }
  }, [providerForm, refresh]);

  const syncProvider = useCallback(async (accountId: string) => {
    setProviderSyncingId(accountId);
    setProviderRowMessage((prev) => ({ ...prev, [accountId]: { type: "ok", text: "Syncing..." } }));
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "provider-sync", accountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Sync failed (${res.status})`);
      }
      setProviderRowMessage((prev) => ({
        ...prev,
        [accountId]: { type: "ok", text: `Imported ${Number(data?.imported || 0)} events.` },
      }));
      await refresh();
    } catch (err) {
      setProviderRowMessage((prev) => ({
        ...prev,
        [accountId]: { type: "err", text: String(err instanceof Error ? err.message : err) },
      }));
      await refresh();
    } finally {
      setProviderSyncingId(null);
    }
  }, [refresh]);

  const deleteProvider = useCallback(async (accountId: string) => {
    if (!window.confirm("Delete this provider account? Imported read-only events will remain unless resynced.")) return;
    await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "provider-delete", accountId }),
    });
    await refresh();
  }, [refresh]);

  const purgeProvider = useCallback(async (accountId: string) => {
    setPurgingProviderId(accountId);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "provider-purge", accountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setProviderRowMessage((prev) => ({
          ...prev,
          [accountId]: { type: "err", text: data?.error || `Purge failed (${res.status})` },
        }));
        return;
      }
      setProviderRowMessage((prev) => ({
        ...prev,
        [accountId]: { type: "ok", text: `Purged ${Number(data?.removed || 0)} local events.` },
      }));
      await refresh();
    } finally {
      setPurgingProviderId(null);
      setPurgeConfirmProviderId(null);
    }
  }, [refresh]);

  const startEditProvider = useCallback((provider: ProviderAccount) => {
    setEditingProviderId(provider.id);
    setEditingProvider({
      label: provider.label,
      serverUrl: provider.serverUrl,
      calendarUrl: provider.calendarUrl,
      username: provider.username,
      cutoffDate: toDateInputValue(provider.cutoffDate),
      password: "",
    });
  }, []);

  const saveEditProvider = useCallback(async (provider: ProviderAccount) => {
    const nextLabel = editingProvider.label.trim();
    if (!nextLabel || !editingProvider.username.trim()) return;
    setProviderEditSaving(true);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "provider-add",
          id: provider.id,
          type: provider.type,
          label: nextLabel,
          serverUrl: editingProvider.serverUrl,
          calendarUrl: editingProvider.calendarUrl,
          username: editingProvider.username,
          password: editingProvider.password,
          cutoffDate: editingProvider.cutoffDate || undefined,
          enabled: provider.enabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Update failed (${res.status})`);
      }
      setEditingProviderId(null);
      setEditingProvider({ label: "", serverUrl: "", calendarUrl: "", username: "", cutoffDate: "", password: "" });
      await refresh();
    } finally {
      setProviderEditSaving(false);
    }
  }, [editingProvider, refresh]);

  const isCompletedItem = useCallback((item: CalendarItem): boolean => {
    if (item.type === "task") return item.status === "done";
    return item.status === "done";
  }, []);

  const requestToggleComplete = useCallback((item: CalendarItem) => {
    if (item.type === "task") return;
    if (item.source === "provider" || item.readOnly) return;
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
    if (item.source === "provider" || item.readOnly) return;
    setEditItemId(item.id);
    setEditTitle(item.title);
    setEditNotes(item.notes || "");
    setEditDueAt(toDateTimeLocalValue(item.dueAt));
    setEditKind(item.type);
  }, []);

  const closeEditModal = useCallback(() => {
    if (savingEdit) return;
    setEditItemId(null);
    setEditTitle("");
    setEditNotes("");
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
        notes: editNotes.trim() || undefined,
        dueAt: editDueAt,
        kind: editKind,
      });
      closeEditModal();
    } finally {
      setSavingEdit(false);
    }
  }, [closeEditModal, editDueAt, editItemId, editKind, editNotes, editTitle, patchEntry]);

  const itemScopedKey = useCallback((scope: "month" | "week" | "upcoming", id: string) => {
    return `${scope}:${id}`;
  }, []);

  const renderItemControls = useCallback((item: CalendarItem, scope: "month" | "week" | "upcoming") => {
    if (item.type === "task") return null;
    const isProviderReadOnly = item.source === "provider" || item.readOnly;
    const key = itemScopedKey(scope, item.id);
    const infoOpen = openInfoKey === key;
    const menuOpen = openMenuKey === key;
    const badge = badgeForItem(item, accountLabelById);

    return (
      <div className="relative flex items-center gap-0.5" data-calendar-floating="true">
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setOpenInfoKey((prev) => (prev === key ? null : key));
              setOpenMenuKey(null);
            }}
            className="rounded p-0.5 text-muted-foreground/80 outline-none ring-0 transition-colors hover:bg-background/70 hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            aria-label="Show item details"
          >
            <Info className="h-3 w-3" />
          </button>
          {infoOpen && (
            <div className="absolute -right-2 top-full z-20 mt-1.5 w-64 rounded-lg border border-foreground/20 bg-card px-3 py-2 text-foreground shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150">
              <div className="absolute -top-1 right-3 h-2 w-2 rotate-45 border-l border-t border-foreground/20 bg-card" />
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="text-xs font-medium leading-snug">{item.title}</p>
                <button
                  type="button"
                  onClick={() => setOpenInfoKey(null)}
                  className="rounded p-0.5 text-muted-foreground/80 outline-none ring-0 hover:bg-foreground/10 hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                  aria-label="Close details"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {item.notes && <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{badge.label} • {formatDateTime(item.dueAt)}</p>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setOpenMenuKey((prev) => (prev === key ? null : key));
              setOpenInfoKey(null);
            }}
            className="rounded p-0.5 text-muted-foreground/80 outline-none ring-0 transition-colors hover:bg-background/70 hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Open item actions"
          >
            <MoreVertical className="h-3 w-3" />
          </button>
          {menuOpen && (
            <div className="absolute -right-2 top-full z-20 mt-1.5 w-32 rounded-md border border-foreground/20 bg-card p-1 shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150">
              <div className="absolute -top-1 right-3 h-2 w-2 rotate-45 border-l border-t border-foreground/20 bg-card" />
            <button
              type="button"
              onClick={() => {
                setOpenMenuKey(null);
                openEditModal(item);
              }}
              disabled={isProviderReadOnly}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-foreground/90 outline-none ring-0 hover:bg-foreground/10 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            >
              <Pencil className="h-3 w-3" />
              {isProviderReadOnly ? "Read-only" : "Edit"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenMenuKey(null);
                requestToggleComplete(item);
              }}
              disabled={isProviderReadOnly}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-emerald-300 outline-none ring-0 hover:bg-emerald-500/10 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            >
              <Check className="h-3 w-3" />
              {isCompletedItem(item) ? "Undo" : "Complete"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenMenuKey(null);
                requestDelete(item);
              }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-red-300 outline-none ring-0 hover:bg-red-500/10 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            >
              <Trash2 className="h-3 w-3" />
              {isProviderReadOnly ? "Delete local" : "Delete"}
            </button>
          </div>
          )}
        </div>
      </div>
    );
  }, [accountLabelById, isCompletedItem, itemScopedKey, openEditModal, openInfoKey, openMenuKey, requestDelete, requestToggleComplete]);

  if (loading) return <LoadingState label="Loading calendar..." />;

  return (
    <SectionLayout>
      <div className="shrink-0 border-b border-foreground/10 px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold text-foreground">Calendar</h2>
            <p className="text-sm text-muted-foreground">Tasks, reminders, and events in one timeline.</p>
            <div className="mt-2 inline-flex items-center rounded-md border border-foreground/10 bg-background/70 p-0.5">
              <button
                type="button"
                onClick={() => setCalendarTab("events")}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  !providerTabActive ? "bg-sky-300/20 text-sky-100" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Events
              </button>
              <button
                type="button"
                onClick={() => setCalendarTab("providers")}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  providerTabActive ? "bg-sky-300/20 text-sky-100" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Providers
              </button>
            </div>
          </div>
          <div className="inline-flex items-center gap-2">
            {!providerTabActive && (
            <div className="inline-flex items-center rounded-md border border-foreground/10 bg-background/70 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("month")}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  viewMode === "month"
                    ? "bg-sky-300/20 text-sky-100"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Month
              </button>
              <button
                type="button"
                onClick={() => setViewMode("week")}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  viewMode === "week"
                    ? "bg-sky-300/20 text-sky-100"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Week
              </button>
            </div>
            )}
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
              onClick={() =>
                setViewDate((d) =>
                  viewMode === "month"
                    ? new Date(d.getFullYear(), d.getMonth() - 1, 1)
                    : new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7)
                )
              }
              className="rounded-md border border-foreground/10 p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-40 text-center text-sm font-medium text-foreground">
              {viewMode === "month" ? monthLabel(viewDate) : weekLabel(viewDate)}
            </span>
            <button
              type="button"
              onClick={() =>
                setViewDate((d) =>
                  viewMode === "month"
                    ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
                    : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
                )
              }
              className="rounded-md border border-foreground/10 p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {!providerTabActive && (
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_220px_180px_140px]">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add reminder or event title"
            className={CALENDAR_INPUT_CLASS}
          />
          <input
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Brief description (optional)"
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
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {providerTabActive ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-foreground/10 bg-card/30 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Add Provider</h3>
              <div className="mt-2 inline-flex items-center rounded-md border border-foreground/10 bg-background/70 p-0.5">
                <button
                  type="button"
                  onClick={() => setProviderPreset("icloud")}
                  className={cn(
                    "rounded px-2 py-1 text-xs transition-colors",
                    providerPreset === "icloud" ? "bg-sky-300/20 text-sky-100" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  iCloud
                </button>
                <button
                  type="button"
                  onClick={() => setProviderPreset("google")}
                  className={cn(
                    "rounded px-2 py-1 text-xs transition-colors",
                    providerPreset === "google" ? "bg-sky-300/20 text-sky-100" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Google
                </button>
              </div>

              {providerPreset === "google" ? (
                <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  Google Calendar provider UI is coming soon in a later version.
                  <div className="mt-2 text-amber-100/90">
                    Planned required fields: Google account email, app-specific password, and calendar collection URL.
                  </div>
                </div>
              ) : (
              <>
              <div className="mt-1 space-y-1 text-xs text-muted-foreground/80">
                <p>iCloud quick setup:</p>
                <p>- Server: <code className="rounded bg-foreground/10 px-1">https://caldav.icloud.com</code></p>
                <p>- Username: your Apple ID</p>
                <p>- Password: Apple app-specific password</p>
                <p>- Calendar URL: optional (auto-discovered)</p>
                <p>Note: iCloud/Apple Reminders are not imported in this version (events only).</p>
                <p>Read-only import. Password is encrypted and stored under OpenClaw credentials.</p>
              </div>
              <div className="mt-3 grid items-start gap-3 md:grid-cols-2">
                <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  <span>Account label</span>
                  <input
                    value={providerForm.label}
                    onChange={(e) => setProviderForm((p) => ({ ...p, label: e.target.value }))}
                    placeholder="e.g. iCloud Personal"
                    className={PROVIDER_INPUT_CLASS}
                  />
                </label>
                <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  <span>Server URL</span>
                  <input
                    value={providerForm.serverUrl}
                    onChange={(e) => setProviderForm((p) => ({ ...p, serverUrl: e.target.value }))}
                    placeholder="https://caldav.icloud.com"
                    className={PROVIDER_INPUT_CLASS}
                  />
                </label>
                <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  <span>Calendar URL (optional)</span>
                  <input
                    value={providerForm.calendarUrl}
                    onChange={(e) => setProviderForm((p) => ({ ...p, calendarUrl: e.target.value }))}
                    placeholder="Auto-discovered when empty"
                    className={PROVIDER_INPUT_CLASS}
                  />
                </label>
                <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  <span>Username / Apple ID</span>
                  <input
                    value={providerForm.username}
                    onChange={(e) => setProviderForm((p) => ({ ...p, username: e.target.value }))}
                    placeholder="you@icloud.com"
                    className={PROVIDER_INPUT_CLASS}
                  />
                </label>
                <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  <span>App-specific password</span>
                  <input
                    type="password"
                    value={providerForm.password}
                    onChange={(e) => setProviderForm((p) => ({ ...p, password: e.target.value }))}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    className={PROVIDER_INPUT_CLASS}
                  />
                </label>
                <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  <span>Cut-off date (optional)</span>
                  <input
                    type="date"
                    value={providerForm.cutoffDate}
                    onChange={(e) => setProviderForm((p) => ({ ...p, cutoffDate: e.target.value }))}
                    className={PROVIDER_INPUT_CLASS}
                  />
                  <span className="block text-[11px] text-muted-foreground/70">Imports only events on/after this date.</span>
                </label>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void testProvider()}
                  disabled={providerTesting}
                  className="rounded-md border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                  {providerTesting ? "Testing..." : "Test"}
                </button>
                <button
                  type="button"
                  onClick={() => void saveProvider()}
                  disabled={providerSaving}
                  className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 disabled:opacity-60"
                >
                  {providerSaving ? "Saving..." : "Save Provider"}
                </button>
              </div>
              </>
              )}
              {providerMessage && (
                <p className={cn("mt-2 text-xs", providerMessage.type === "ok" ? "text-emerald-300" : "text-red-300")}>{providerMessage.text}</p>
              )}
            </div>

            <div className="rounded-lg border border-foreground/10 bg-card/30 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Configured Providers</h3>
              <div className="mt-2 space-y-2">
                {(payload?.providers || []).length === 0 && (
                  <p className="text-sm text-muted-foreground/70">No providers configured.</p>
                )}
                {(payload?.providers || []).map((provider) => (
                  <div
                    key={provider.id}
                    className={cn(
                      "rounded-md border border-foreground/10 bg-background/60 px-3 py-2",
                      editingProviderId === provider.id ? "block" : "flex flex-wrap items-center gap-2"
                    )}
                  >
                    <span className="rounded-full border border-slate-400/30 bg-slate-400/10 px-1.5 py-0.5 text-xs text-slate-300">{provider.type.toUpperCase()}</span>
                    {editingProviderId === provider.id ? (
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="grid items-start gap-3 md:grid-cols-2">
                          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                            <span>Account label</span>
                            <input
                              value={editingProvider.label}
                              onChange={(e) => setEditingProvider((prev) => ({ ...prev, label: e.target.value }))}
                              placeholder="Account label"
                              className={PROVIDER_INPUT_CLASS}
                            />
                          </label>
                          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                            <span>Cut-off date (optional)</span>
                            <input
                              value={editingProvider.cutoffDate}
                              onChange={(e) => setEditingProvider((prev) => ({ ...prev, cutoffDate: e.target.value }))}
                              type="date"
                              className={PROVIDER_INPUT_CLASS}
                            />
                          </label>
                          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                            <span>Server URL</span>
                            <input
                              value={editingProvider.serverUrl}
                              onChange={(e) => setEditingProvider((prev) => ({ ...prev, serverUrl: e.target.value }))}
                              placeholder="Server URL"
                              className={PROVIDER_INPUT_CLASS}
                            />
                          </label>
                          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                            <span>Calendar URL</span>
                            <input
                              value={editingProvider.calendarUrl}
                              onChange={(e) => setEditingProvider((prev) => ({ ...prev, calendarUrl: e.target.value }))}
                              placeholder="Calendar URL"
                              className={PROVIDER_INPUT_CLASS}
                            />
                          </label>
                          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                            <span>Username</span>
                            <input
                              value={editingProvider.username}
                              onChange={(e) => setEditingProvider((prev) => ({ ...prev, username: e.target.value }))}
                              placeholder="Username"
                              className={PROVIDER_INPUT_CLASS}
                            />
                          </label>
                          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                            <span>New password (optional)</span>
                            <input
                              value={editingProvider.password}
                              onChange={(e) => setEditingProvider((prev) => ({ ...prev, password: e.target.value }))}
                              placeholder="Leave empty to keep current"
                              type="password"
                              className={PROVIDER_INPUT_CLASS}
                            />
                          </label>
                        </div>
                        <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void saveEditProvider(provider)}
                          disabled={providerEditSaving || !editingProvider.label.trim()}
                          className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300 disabled:opacity-60"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProviderId(null);
                            setEditingProvider({ label: "", serverUrl: "", calendarUrl: "", username: "", cutoffDate: "", password: "" });
                          }}
                          className="rounded border border-foreground/20 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          Cancel
                        </button>
                        </div>
                      </div>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{provider.label}</span>
                    )}
                    {editingProviderId !== provider.id && (
                      <>
                        {providerRowMessage[provider.id] ? (
                          <span
                            className={cn(
                              "text-xs",
                              providerRowMessage[provider.id].type === "ok" ? "text-emerald-300" : "text-red-300"
                            )}
                          >
                            {providerRowMessage[provider.id].text}
                            {providerRowMessage[provider.id].type === "ok" && provider.lastSyncAt ? ` - ${formatDateTime(provider.lastSyncAt)}` : ""}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/70">{provider.lastSyncAt ? `Last sync ${formatDateTime(provider.lastSyncAt)}` : "Never synced"}</span>
                        )}
                        {provider.lastError && !providerRowMessage[provider.id] && (
                          <span className="text-xs text-red-300">{provider.lastError}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => void syncProvider(provider.id)}
                          disabled={providerSyncingId === provider.id}
                          className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300 disabled:opacity-60"
                        >
                          {providerSyncingId === provider.id ? "Syncing..." : "Sync"}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditProvider(provider)}
                          className="rounded border border-foreground/20 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setPurgeConfirmProviderId(provider.id)}
                          disabled={purgingProviderId === provider.id}
                          className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300 disabled:opacity-60"
                        >
                          {purgingProviderId === provider.id ? "Purging..." : "Purge Events"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteProvider(provider.id)}
                          className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-300"
                        >
                          Delete Provider
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
        <>
        {!providerTabActive && (payload?.providers || []).length > 0 && (
          <div className="mb-3 rounded-lg border border-foreground/10 bg-card/30 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Provider Filters</p>
            <div className="flex flex-wrap items-center gap-2">
              {(payload?.providers || []).map((provider) => {
                const hidden = hiddenProviderAccountIds.has(provider.id);
                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => {
                      setHiddenProviderAccountIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(provider.id)) next.delete(provider.id);
                        else next.add(provider.id);
                        return next;
                      });
                    }}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs transition-colors",
                      hidden
                        ? "border-foreground/20 bg-background/60 text-muted-foreground"
                        : "border-pink-500/30 bg-pink-500/15 text-pink-200"
                    )}
                  >
                    {hidden ? "Show" : "Hide"} {provider.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {viewMode === "month" ? (
            <div className="grid gap-1 rounded-lg border border-foreground/10 bg-card/30 p-2 md:grid-cols-7">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => (
                <div key={w} className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {w}
                </div>
              ))}
              {monthDays.map((day) => {
                const dayK = toDayKey(day);
                const items = itemsByDay.get(dayK) || [];
                const inMonth = day.getMonth() === viewDate.getMonth();
                return (
                  <div key={dayK} className={cn("min-h-28 rounded-md border border-foreground/10 bg-background/50 p-2", !inMonth && "opacity-45") }>
                    <div className="mb-1 text-xs font-medium text-foreground/80">{day.getDate()}</div>
                    <div className="space-y-1">
                      {items.slice(0, 3).map((item) => {
                        const badge = badgeForItem(item, accountLabelById);
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
                              >
                                <div className="flex items-center gap-1">
                                  <Icon className="h-3 w-3 shrink-0" />
                                  <span className={cn("min-w-0 flex-1 truncate", isCompletedItem(item) && "line-through")}>
                                    {truncateTitle(item.title, 30)}
                                  </span>
                                  <span className="shrink-0 text-[10px] font-medium text-foreground/85">{formatTimeOnly(item.dueAt)}</span>
                                  {isCompletedItem(item) && <Check className="h-3 w-3 shrink-0" />}
                                  {renderItemControls(item, "month")}
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
          ) : (
            <div className="grid gap-1 rounded-lg border border-foreground/10 bg-card/30 p-2 md:grid-cols-7">
              {weekDays.map((day) => {
                const dayK = toDayKey(day);
                const items = itemsByDay.get(dayK) || [];
                return (
                  <div key={dayK} className="min-h-64 rounded-md border border-foreground/10 bg-background/50 p-2">
                    <div className="mb-2 border-b border-foreground/10 pb-1 text-xs font-medium text-foreground/85">
                      {day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </div>
                    <div className="space-y-1">
                      {items.map((item) => {
                        const badge = badgeForItem(item, accountLabelById);
                        const Icon = badge.Icon;
                        return (
                          <div
                                key={item.id}
                                className={cn(
                                  "rounded border px-1.5 py-1 text-[11px]",
                                  isCompletedItem(item)
                                    ? "border-foreground/15 bg-foreground/5 text-muted-foreground"
                                    : badge.className
                                )}
                              >
                                <div className="flex items-center gap-1">
                                  <Icon className="h-3 w-3 shrink-0" />
                                  <span className={cn("min-w-0 flex-1 truncate", isCompletedItem(item) && "line-through")}>
                                    {truncateTitle(item.title, 34)}
                                  </span>
                                  <span className="shrink-0 text-[10px] font-medium text-foreground/85">{formatTimeOnly(item.dueAt)}</span>
                                  {isCompletedItem(item) && <Check className="h-3 w-3 shrink-0" />}
                                  {renderItemControls(item, "week")}
                                </div>
                              </div>
                        );
                      })}
                      {items.length === 0 && (
                        <p className="text-[11px] text-muted-foreground/60">No items</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        <div className="mt-4 rounded-lg border border-foreground/10 bg-card/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            <CalendarDays className="h-3.5 w-3.5" />
            Upcoming Events
          </div>
          <div className="space-y-2">
            {filteredUpcoming.length === 0 && (
              <p className="text-sm text-muted-foreground/70">No upcoming items.</p>
            )}
            {filteredUpcoming.map((item) => {
              const badge = badgeForItem(item, accountLabelById);
              const Icon = badge.Icon;
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
                  {renderItemControls(item, "upcoming")}
                </div>
              );
            })}
          </div>
        </div>
        </>
        )}
      </div>

      {providerToPurge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-xl border border-foreground/10 bg-card p-4 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Purge imported events</h3>
              <button
                type="button"
                onClick={() => purgingProviderId == null && setPurgeConfirmProviderId(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                aria-label="Close purge confirmation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Remove all imported events for this provider from Mission Control?
            </p>
            <p className="mt-2 rounded-md border border-foreground/10 bg-background/60 px-2 py-1 text-sm text-foreground/90">
              {providerToPurge.label}
            </p>
            <p className="mt-2 text-xs text-muted-foreground/80">
              This only removes local imported events. Running Sync again may re-import events that still exist on the provider.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPurgeConfirmProviderId(null)}
                disabled={purgingProviderId != null}
                className="rounded-md border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void purgeProvider(providerToPurge.id)}
                disabled={purgingProviderId != null}
                className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 disabled:opacity-60"
              >
                {purgingProviderId != null ? "Purging..." : "Purge events"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  : (pendingAction.item.source === "provider" || pendingAction.item.readOnly)
                    ? "This will remove the imported item locally from Mission Control. If it still exists on CalDAV, a future sync will import it again."
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

              <label className="block text-xs text-muted-foreground">
                Description
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                  placeholder="Optional details"
                  className={cn("mt-1 w-full resize-none", CALENDAR_INPUT_CLASS)}
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
