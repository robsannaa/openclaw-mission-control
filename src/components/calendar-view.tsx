"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Plus,
} from "lucide-react";
import { SectionLayout } from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { cn } from "@/lib/utils";

type CalendarEntry = {
  id: string;
  kind: "reminder" | "event";
  title: string;
  notes?: string;
  dueAt: string;
  endAt?: string;
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
  vendor?: "icloud" | "google";
  label: string;
  serverUrl: string;
  calendarUrl: string;
  calendarId?: string;
  discoveredCollections?: Array<{
    url: string;
    name?: string;
    components?: Array<"VEVENT" | "VTODO">;
  }>;
  selectedCalendarUrls?: string[];
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
  googleOAuth?: {
    configured: boolean;
    connected?: boolean;
    tokenExpiresAt?: string;
    clientId?: string;
    redirectUri?: string;
  };
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

function formatTimeRange(startIso: string, endIso?: string): string {
  const start = formatTimeOnly(startIso);
  if (!start) return "";
  if (!endIso) return start;
  const end = formatTimeOnly(endIso);
  if (!end) return start;
  return `${start} - ${end}`;
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

function parseLocalDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toAllDayLocal(value: string): string {
  const dt = parseLocalDateTime(value);
  if (!dt) return "";
  return `${String(dt.getFullYear()).padStart(4, "0")}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}T00:00`;
}

function isMidnightLocal(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getHours() === 0 && d.getMinutes() === 0;
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
      className: "border-sky-500/35 bg-sky-500/15 text-sky-700 dark:text-sky-200",
      Icon: CalendarClock,
    };
  }
  return {
    label: "Task",
    className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
    Icon: ListChecks,
  };
}

function badgeForItem(
  item: CalendarItem,
  accountLabelById?: Record<string, string>,
  accountVendorById?: Record<string, "icloud" | "google">
): { label: string; className: string; Icon: typeof Bell } {
  const base = badgeForType(item.type);
  if (item.type !== "task" && (item.source === "provider" || item.readOnly)) {
    const accountLabel = item.providerAccountId ? accountLabelById?.[item.providerAccountId] : undefined;
    const accountVendor = item.providerAccountId ? accountVendorById?.[item.providerAccountId] : undefined;
    const providerClassName = accountVendor === "google"
      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
      : "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-200";
    return {
      label: accountLabel || (item.provider === "caldav" ? "CalDAV" : "Imported"),
      className: providerClassName,
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
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createDueAt, setCreateDueAt] = useState("");
  const [createEndAt, setCreateEndAt] = useState("");
  const [createAllDay, setCreateAllDay] = useState(false);
  const [createKind, setCreateKind] = useState<"reminder" | "event">("event");
  const [createProviderId, setCreateProviderId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [openInfoKey, setOpenInfoKey] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editEndAt, setEditEndAt] = useState("");
  const [editAllDay, setEditAllDay] = useState(false);
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
    vendor: "icloud" | "google";
    label: string;
    serverUrl: string;
    calendarUrl: string;
    calendarId: string;
    discoveredCollections: Array<{ url: string; name?: string; components?: Array<"VEVENT" | "VTODO"> }>;
    selectedCalendarUrls: string[];
    username: string;
    cutoffDate: string;
    password: string;
  }>({ vendor: "icloud", label: "", serverUrl: "", calendarUrl: "", calendarId: "", discoveredCollections: [], selectedCalendarUrls: [], username: "", cutoffDate: "", password: "" });
  const [providerEditSaving, setProviderEditSaving] = useState(false);
  const [providerDiscoveringId, setProviderDiscoveringId] = useState<string | null>(null);
  const [hiddenProviderAccountIds, setHiddenProviderAccountIds] = useState<Set<string>>(new Set());
  const [purgeConfirmProviderId, setPurgeConfirmProviderId] = useState<string | null>(null);
  const [purgingProviderId, setPurgingProviderId] = useState<string | null>(null);
  const [googleClientFileName, setGoogleClientFileName] = useState("");
  const [googleClientImporting, setGoogleClientImporting] = useState(false);
  const [providerForm, setProviderForm] = useState({
    label: "",
    serverUrl: "https://caldav.icloud.com",
    calendarUrl: "",
    calendarId: "",
    username: "",
    password: "",
    cutoffDate: "",
  });

  const googleCallbackUri = "http://127.0.0.1:3333/api/calendar/google/callback";

  const providerTabActive = false;
  const googleOAuthQuery: string = "";

  const accountLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of payload?.providers || []) map[p.id] = p.label;
    return map;
  }, [payload?.providers]);

  const accountVendorById = useMemo(() => {
    const map: Record<string, "icloud" | "google"> = {};
    for (const p of payload?.providers || []) map[p.id] = p.vendor === "google" ? "google" : "icloud";
    return map;
  }, [payload?.providers]);

  const enabledProviders = useMemo(() => {
    return (payload?.providers || []).filter((provider) => provider.enabled);
  }, [payload?.providers]);

  const configuredProvidersForPreset = useMemo(() => {
    return (payload?.providers || []).filter((provider) => {
      const vendor = provider.vendor === "google" ? "google" : "icloud";
      return vendor === providerPreset;
    });
  }, [payload?.providers, providerPreset]);

  const resetCreateForm = useCallback(() => {
    setCreateTitle("");
    setCreateNotes("");
    setCreateDueAt("");
    setCreateEndAt("");
    setCreateAllDay(false);
    setCreateKind("event");
    setCreateProviderId("");
    setCreateError(null);
  }, []);

  useEffect(() => {
    if (!createProviderId) return;
    if (!enabledProviders.some((provider) => provider.id === createProviderId)) {
      setCreateProviderId("");
    }
  }, [createProviderId, enabledProviders]);

  useEffect(() => {
    if (createKind === "reminder" && createProviderId) {
      setCreateProviderId("");
    }
  }, [createKind, createProviderId]);

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
    if (!createTitle.trim() || !createDueAt.trim()) return;
    if (createKind === "event" && !createEndAt.trim()) {
      setCreateError("End date/time is required for events.");
      return;
    }
    const normalizedStart = createAllDay ? toAllDayLocal(createDueAt) : createDueAt;
    const normalizedEnd = createAllDay ? toAllDayLocal(createEndAt) : createEndAt;
    if (createKind === "event") {
      const start = parseLocalDateTime(normalizedStart);
      const end = parseLocalDateTime(normalizedEnd);
      if (!start || !end) {
        setCreateError("Start and end date/time are required for events.");
        return;
      }
      if (end.getTime() < start.getTime()) {
        setCreateError("End date/time cannot be before start date/time.");
        return;
      }
    }
    if (createKind === "reminder" && createProviderId) {
      setCreateError("Saving reminders to provider is not supported yet.");
      return;
    }
    setSaving(true);
    setCreateError(null);
    const selectedProviderId = createKind === "event" ? createProviderId : "";
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          kind: createKind,
          title: createTitle.trim(),
          notes: createNotes.trim() || undefined,
          dueAt: normalizedStart,
          endAt: createKind === "event" ? normalizedEnd : undefined,
          saveToProvider: Boolean(selectedProviderId),
          providerAccountId: selectedProviderId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Create failed (${res.status})`);
      }
      resetCreateForm();
      setCreateOpen(false);
      await refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [createAllDay, createDueAt, createEndAt, createKind, createNotes, createProviderId, createTitle, refresh, resetCreateForm]);

  const patchEntry = useCallback(async (id: string, patch: Record<string, unknown>) => {
    const res = await fetch("/api/calendar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `Update failed (${res.status})`);
    }
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
          vendor: providerPreset,
          serverUrl: providerForm.serverUrl,
          calendarUrl: providerForm.calendarUrl,
          calendarId: providerPreset === "google" ? providerForm.calendarId || providerForm.username : "",
          username: providerForm.username,
          password: providerPreset === "google" ? "" : providerForm.password,
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
  }, [providerForm.calendarId, providerForm.calendarUrl, providerForm.password, providerForm.serverUrl, providerForm.username, providerPreset]);

  const saveProvider = useCallback(async () => {
    if (!providerForm.label.trim() || !providerForm.serverUrl.trim() || !providerForm.username.trim()) return;
    if (providerPreset !== "google" && !providerForm.password.trim()) return;
    setProviderSaving(true);
    setProviderMessage(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "provider-add",
          type: "caldav",
          vendor: providerPreset,
          label: providerForm.label,
          serverUrl: providerForm.serverUrl,
          calendarUrl: providerForm.calendarUrl,
          calendarId: providerPreset === "google" ? providerForm.calendarId || providerForm.username : "",
          username: providerForm.username,
          password: providerPreset === "google" ? "" : providerForm.password,
          cutoffDate: providerForm.cutoffDate || undefined,
          enabled: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
      setProviderForm((p) => ({ ...p, password: "", label: "", calendarUrl: "", calendarId: "", cutoffDate: "" }));
      setProviderMessage({ type: "ok", text: "Provider saved." });
      await refresh();
    } catch (err) {
      setProviderMessage({ type: "err", text: String(err instanceof Error ? err.message : err) });
    } finally {
      setProviderSaving(false);
    }
  }, [providerForm, providerPreset, refresh]);

  const importGoogleOAuthClientFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setGoogleClientFileName(file.name);
    setGoogleClientImporting(true);
    setProviderMessage(null);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as {
        web?: {
          client_id?: string;
          client_secret?: string;
          redirect_uris?: string[];
        };
      };

      const clientId = String(parsed?.web?.client_id || "").trim();
      const clientSecret = String(parsed?.web?.client_secret || "").trim();
      const redirectUris = Array.isArray(parsed?.web?.redirect_uris) ? parsed.web.redirect_uris : [];
      if (!clientId || !clientSecret) {
        throw new Error("Invalid client_secret.json: expected web.client_id and web.client_secret.");
      }

      const hasCallback = redirectUris.includes(googleCallbackUri);
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "google-oauth-config-set",
          clientId,
          clientSecret,
          redirectUri: googleCallbackUri,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Import failed (${res.status})`);
      }

      setProviderMessage({
        type: "ok",
        text: hasCallback
          ? "Google OAuth client imported and saved to OpenClaw secrets."
          : "Google OAuth client imported to OpenClaw secrets. Add the callback URI in Google Console redirect URIs before connecting.",
      });
      await refresh();
    } catch (err) {
      setProviderMessage({ type: "err", text: String(err instanceof Error ? err.message : err) });
    } finally {
      setGoogleClientImporting(false);
    }
  }, [refresh]);

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
      vendor: provider.vendor === "google" ? "google" : "icloud",
      label: provider.label,
      serverUrl: provider.serverUrl,
      calendarUrl: provider.calendarUrl,
      calendarId: provider.calendarId || "",
      discoveredCollections: provider.discoveredCollections || [],
      selectedCalendarUrls:
        (provider.selectedCalendarUrls && provider.selectedCalendarUrls.length > 0)
          ? provider.selectedCalendarUrls
          : (provider.discoveredCollections || [])
            .filter((c) => {
              const source = `${c.name || ""} ${c.url}`.toLowerCase();
              return !(
                source.includes("birth")
                || source.includes("holiday")
                || source.includes("%40virtual")
                || source.includes("tasks")
                || source.includes("reminders")
              );
            })
            .map((c) => c.url),
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
          vendor: editingProvider.vendor,
          label: nextLabel,
          serverUrl: editingProvider.serverUrl,
          calendarUrl: editingProvider.calendarUrl,
          calendarId: editingProvider.vendor === "google" ? editingProvider.calendarId || editingProvider.username : "",
          discoveredCollections: editingProvider.discoveredCollections,
          selectedCalendarUrls: editingProvider.selectedCalendarUrls,
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
      setEditingProvider({ vendor: "icloud", label: "", serverUrl: "", calendarUrl: "", calendarId: "", discoveredCollections: [], selectedCalendarUrls: [], username: "", cutoffDate: "", password: "" });
      await refresh();
    } finally {
      setProviderEditSaving(false);
    }
  }, [editingProvider, refresh]);

  const discoverProviderCollectionsFor = useCallback(async (provider: ProviderAccount) => {
    setProviderDiscoveringId(provider.id);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "provider-discover", accountId: provider.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Discover failed (${res.status})`);
      }
      setProviderRowMessage((prev) => ({
        ...prev,
        [provider.id]: {
          type: "ok",
          text: `Discovered ${Number(data?.provider?.discoveredCollections?.length || 0)} collection(s).`,
        },
      }));
      if (editingProviderId === provider.id && data?.provider) {
        const discoveredCollections = Array.isArray(data.provider.discoveredCollections) ? data.provider.discoveredCollections : [];
        const selectedCalendarUrls = Array.isArray(data.provider.selectedCalendarUrls) ? data.provider.selectedCalendarUrls : [];
        setEditingProvider((prev) => ({
          ...prev,
          discoveredCollections,
          selectedCalendarUrls,
        }));
      }
      await refresh();
    } catch (err) {
      setProviderRowMessage((prev) => ({
        ...prev,
        [provider.id]: {
          type: "err",
          text: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setProviderDiscoveringId(null);
    }
  }, [editingProviderId, refresh]);

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
    setCalendarError(null);
    try {
      if (type === "complete") {
        await patchEntry(item.id, { status: "done", previousStatus: item.status });
      } else if (type === "undo") {
        const restoreStatus = item.previousStatus || "scheduled";
        await patchEntry(item.id, { status: restoreStatus, previousStatus: null });
      } else {
        const res = await fetch(`/api/calendar?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `Delete failed (${res.status})`);
        }
        await refresh();
      }
      setPendingAction(null);
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningAction(false);
    }
  }, [patchEntry, pendingAction, refresh]);

  const openEditModal = useCallback((item: CalendarItem) => {
    if (item.type === "task") return;
    setCalendarError(null);
    setEditItemId(item.id);
    setEditTitle(item.title);
    setEditNotes(item.notes || "");
    setEditDueAt(toDateTimeLocalValue(item.dueAt));
    setEditEndAt(item.type === "event" ? toDateTimeLocalValue(item.endAt || "") : "");
    setEditAllDay(item.type === "event" && isMidnightLocal(item.dueAt) && (!!item.endAt && isMidnightLocal(item.endAt)));
    setEditKind(item.type);
  }, []);

  const closeEditModal = useCallback(() => {
    if (savingEdit) return;
    setCalendarError(null);
    setEditItemId(null);
    setEditTitle("");
    setEditNotes("");
    setEditDueAt("");
    setEditEndAt("");
    setEditAllDay(false);
    setEditKind("reminder");
  }, [savingEdit]);

  const submitEditModal = useCallback(async () => {
    if (!editItemId) return;
    const trimmed = editTitle.trim();
    if (!trimmed || !editDueAt.trim()) return;
    if (editKind === "event" && !editEndAt.trim()) {
      setCalendarError("End date/time is required for events.");
      return;
    }
    const normalizedStart = editAllDay ? toAllDayLocal(editDueAt) : editDueAt;
    const normalizedEnd = editKind === "event" ? (editAllDay ? toAllDayLocal(editEndAt) : editEndAt) : "";
    if (editKind === "event") {
      const start = parseLocalDateTime(normalizedStart);
      const end = parseLocalDateTime(normalizedEnd);
      if (!start || !end) {
        setCalendarError("Start and end date/time are required for events.");
        return;
      }
      if (end.getTime() < start.getTime()) {
        setCalendarError("End date/time cannot be before start date/time.");
        return;
      }
    }
    setSavingEdit(true);
    setCalendarError(null);
    try {
      await patchEntry(editItemId, {
        title: trimmed,
        notes: editNotes.trim() || undefined,
        dueAt: normalizedStart,
        endAt: editKind === "event" ? normalizedEnd : "",
        kind: editKind,
      });
      closeEditModal();
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEdit(false);
    }
  }, [closeEditModal, editAllDay, editDueAt, editEndAt, editItemId, editKind, editNotes, editTitle, patchEntry]);

  const itemScopedKey = useCallback((scope: "month" | "week" | "upcoming", id: string) => {
    return `${scope}:${id}`;
  }, []);

  const renderItemControls = useCallback((item: CalendarItem, scope: "month" | "week" | "upcoming") => {
    if (item.type === "task") return null;
    const key = itemScopedKey(scope, item.id);
    const infoOpen = openInfoKey === key;
    const menuOpen = openMenuKey === key;
    const badge = badgeForItem(item, accountLabelById, accountVendorById);

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
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-foreground/90 outline-none ring-0 hover:bg-foreground/10 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenMenuKey(null);
                requestToggleComplete(item);
              }}
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
              Delete
            </button>
          </div>
          )}
        </div>
      </div>
    );
  }, [accountLabelById, accountVendorById, isCompletedItem, itemScopedKey, openEditModal, openInfoKey, openMenuKey, requestDelete, requestToggleComplete]);

  if (loading) return <LoadingState label="Loading calendar..." />;

  return (
    <SectionLayout>
      <div className="shrink-0 border-b border-foreground/10 px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold text-foreground">Calendar</h2>
            <p className="text-sm text-muted-foreground">Tasks, reminders, and events in one timeline.</p>
            <p className="mt-2 text-xs text-muted-foreground/70">Manage integrations in <a className="text-emerald-300 hover:text-emerald-200" href="/calendar/providers">Calendar Providers</a>.</p>
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
                    ? "bg-card text-foreground shadow-sm"
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
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Week
              </button>
            </div>
            )}
            {!providerTabActive && (
              <>
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
              </>
            )}
          </div>
        </div>

        {!providerTabActive && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
          {(payload?.providers || []).map((provider) => {
            const hidden = hiddenProviderAccountIds.has(provider.id);
            const providerClassName = provider.vendor === "google"
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
              : "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-200";
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
                    : providerClassName
                )}
              >
                {hidden ? "Show" : "Hide"} {provider.label}
              </button>
            );
          })}
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
          >
            <Plus className="h-3.5 w-3.5" />
            Create
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
                  onClick={() => {
                    setProviderPreset("icloud");
                    setProviderForm((prev) => ({
                      ...prev,
                      serverUrl: "https://caldav.icloud.com",
                      calendarUrl: "",
                      calendarId: "",
                    }));
                  }}
                  className={cn(
                    "rounded px-2 py-1 text-xs transition-colors",
                    providerPreset === "icloud" ? "bg-sky-300/20 text-sky-100" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  iCloud
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProviderPreset("google");
                    setProviderForm((prev) => ({
                      ...prev,
                      serverUrl: "https://apidata.googleusercontent.com/caldav/v2",
                      calendarUrl: "",
                    }));
                  }}
                  className={cn(
                    "rounded px-2 py-1 text-xs transition-colors",
                    providerPreset === "google" ? "bg-sky-300/20 text-sky-100" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Google
                </button>
              </div>

              <>
              <div className="mt-1 space-y-1 text-xs text-muted-foreground/80">
                {providerPreset === "icloud" ? (
                  <>
                    <p>iCloud quick setup:</p>
                    <p>- Server: <code className="rounded bg-foreground/10 px-1">https://caldav.icloud.com</code></p>
                    <p>- Username: your Apple ID</p>
                    <p>- Password: Apple app-specific password</p>
                    <p>- Calendar URL: optional (auto-discovered)</p>
                    <p>Note: iCloud reminders are imported when a discovered collection supports VTODO.</p>
                  </>
                ) : (
                  <>
                    <p>Google CalDAV quick setup:</p>
                    <p>- Server: <code className="rounded bg-foreground/10 px-1">https://apidata.googleusercontent.com/caldav/v2</code></p>
                    <p>- Auth: OAuth 2.0 required by Google</p>
                    <p>- Upload Google <code className="rounded bg-foreground/10 px-1">client_secret.json</code> to store client credentials in OpenClaw secrets</p>
                    <p>- Calendar ID: optional, defaults to your account email (primary calendar)</p>
                    <p>- Note: Google CalDAV supports events; reminders/tasks require Google Tasks API.</p>
                    <p>- Callback URI: <code className="rounded bg-foreground/10 px-1">{googleCallbackUri}</code></p>
                    <p>Note: OAuth connect/sync flow is the next step after uploading client credentials.</p>
                  </>
                )}
                <p>Read-only import. Password is encrypted and stored under OpenClaw credentials.</p>
              </div>
              {providerPreset === "google" && (
                <div className="mt-3 rounded-md border border-sky-500/25 bg-sky-500/10 p-3">
                  <p className="text-xs text-sky-100/90">
                    OAuth client status: {payload?.googleOAuth?.configured ? "Configured" : "Not configured"}
                  </p>
                  <p className="mt-1 text-xs text-sky-100/90">
                    OAuth connection: {payload?.googleOAuth?.connected ? "Connected" : "Not connected"}
                  </p>
                  {payload?.googleOAuth?.tokenExpiresAt && (
                    <p className="mt-1 text-[11px] text-sky-100/80">Access token expires: {formatDateTime(payload.googleOAuth.tokenExpiresAt)}</p>
                  )}
                  {payload?.googleOAuth?.clientId && (
                    <p className="mt-1 text-[11px] text-sky-100/80">Client ID: {payload.googleOAuth.clientId}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a
                      href="/api/calendar/google/start"
                      className={cn(
                        "rounded-md border border-sky-500/30 bg-background/40 px-3 py-1.5 text-xs text-sky-100/90 hover:bg-background/60",
                        !payload?.googleOAuth?.configured && "pointer-events-none opacity-60"
                      )}
                    >
                      {payload?.googleOAuth?.connected ? "Reconnect Google" : "Connect Google"}
                    </a>
                  </div>
                  {googleOAuthQuery === "connected" && (
                    <p className="mt-2 text-xs text-emerald-300">Google OAuth connected successfully.</p>
                  )}
                  {googleOAuthQuery === "oauth-error" && (
                    <p className="mt-2 text-xs text-red-300">Google OAuth connection failed. Check the callback URI and try again.</p>
                  )}
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-sky-500/30 bg-background/40 px-3 py-1.5 text-xs text-sky-100/90 hover:bg-background/60">
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        void importGoogleOAuthClientFile(file);
                        event.currentTarget.value = "";
                      }}
                    />
                    {googleClientImporting ? "Importing..." : "Upload client_secret.json"}
                  </label>
                  {googleClientFileName && (
                    <p className="mt-1 text-[11px] text-sky-100/80">Last file: {googleClientFileName}</p>
                  )}
                </div>
              )}
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
                {providerPreset === "icloud" ? (
                  <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                    <span>Calendar URL (optional)</span>
                    <input
                      value={providerForm.calendarUrl}
                      onChange={(e) => setProviderForm((p) => ({ ...p, calendarUrl: e.target.value }))}
                      placeholder="Auto-discovered when empty"
                      className={PROVIDER_INPUT_CLASS}
                    />
                  </label>
                ) : (
                  <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
                    <span>Calendar URL</span>
                    <p className="rounded-lg border border-foreground/15 bg-muted/40 px-3 py-2 text-foreground/80">
                      Auto-selected from discovered Google collections
                    </p>
                  </div>
                )}
                {providerPreset === "google" && (
                  <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                    <span>Calendar ID (optional)</span>
                    <input
                      value={providerForm.calendarId}
                      onChange={(e) => setProviderForm((p) => ({ ...p, calendarId: e.target.value }))}
                      placeholder="Defaults to account email"
                      className={PROVIDER_INPUT_CLASS}
                    />
                  </label>
                )}
                <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                  <span>{providerPreset === "google" ? "Username / Google account" : "Username / Apple ID"}</span>
                  <input
                    value={providerForm.username}
                    onChange={(e) => setProviderForm((p) => ({ ...p, username: e.target.value }))}
                    placeholder={providerPreset === "google" ? "you@gmail.com" : "you@icloud.com"}
                    className={PROVIDER_INPUT_CLASS}
                  />
                </label>
                {providerPreset !== "google" && (
                  <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                    <span>Apple app-specific password</span>
                    <input
                      type="password"
                      value={providerForm.password}
                      onChange={(e) => setProviderForm((p) => ({ ...p, password: e.target.value }))}
                      placeholder="xxxx-xxxx-xxxx-xxxx"
                      className={PROVIDER_INPUT_CLASS}
                    />
                  </label>
                )}
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
                  disabled={providerTesting || (providerPreset === "google" && !payload?.googleOAuth?.connected)}
                  className="rounded-md border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                  {providerTesting ? "Testing..." : "Test"}
                </button>
                <button
                  type="button"
                  onClick={() => void saveProvider()}
                  disabled={providerSaving || (providerPreset === "google" && !payload?.googleOAuth?.connected)}
                  className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 disabled:opacity-60"
                >
                  {providerSaving ? "Saving..." : "Save Provider"}
                </button>
              </div>
              </>
              {providerMessage && (
                <p className={cn("mt-2 text-xs", providerMessage.type === "ok" ? "text-emerald-300" : "text-red-300")}>{providerMessage.text}</p>
              )}
            </div>

            <div className="rounded-lg border border-foreground/10 bg-card/30 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Configured Providers</h3>
              <div className="mt-2 space-y-2">
                {configuredProvidersForPreset.length === 0 && (
                  <p className="text-sm text-muted-foreground/70">No {providerPreset === "google" ? "Google" : "iCloud"} providers configured.</p>
                )}
                {configuredProvidersForPreset.map((provider) => (
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
                            <span>Provider vendor</span>
                            <div className="inline-flex items-center rounded-md border border-foreground/10 bg-background/70 p-0.5">
                              <button
                                type="button"
                                onClick={() => setEditingProvider((prev) => ({ ...prev, vendor: "icloud", serverUrl: "https://caldav.icloud.com", calendarId: "" }))}
                                className={cn(
                                  "rounded px-2 py-1 text-xs transition-colors",
                                  editingProvider.vendor === "icloud"
                                    ? "bg-sky-300/20 text-sky-100"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                iCloud
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingProvider((prev) => ({ ...prev, vendor: "google", serverUrl: "https://apidata.googleusercontent.com/caldav/v2" }))}
                                className={cn(
                                  "rounded px-2 py-1 text-xs transition-colors",
                                  editingProvider.vendor === "google"
                                    ? "bg-sky-300/20 text-sky-100"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                Google
                              </button>
                            </div>
                          </label>
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
                          {editingProvider.vendor === "google" && (
                            <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                              <span>Calendar ID (optional)</span>
                              <input
                                value={editingProvider.calendarId}
                                onChange={(e) => setEditingProvider((prev) => ({ ...prev, calendarId: e.target.value }))}
                                placeholder="Defaults to account email"
                                className={PROVIDER_INPUT_CLASS}
                              />
                            </label>
                          )}
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
                        <div className="space-y-1 rounded-md border border-foreground/10 bg-background/40 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-foreground/90">Collections</p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingProvider((prev) => ({
                                  ...prev,
                                  selectedCalendarUrls: prev.discoveredCollections
                                    .filter((c) => {
                                      const source = `${c.name || ""} ${c.url}`.toLowerCase();
                                      return !(
                                        source.includes("birth")
                                        || source.includes("holiday")
                                        || source.includes("%40virtual")
                                        || source.includes("tasks")
                                        || source.includes("reminders")
                                      );
                                    })
                                    .map((c) => c.url),
                                }))}
                                className="text-[11px] text-sky-300 hover:text-sky-200"
                              >
                                Select defaults
                              </button>
                              <button
                                type="button"
                                onClick={() => void discoverProviderCollectionsFor(provider)}
                                disabled={providerDiscoveringId === provider.id}
                                className="text-[11px] text-sky-300 hover:text-sky-200 disabled:opacity-60"
                              >
                                {providerDiscoveringId === provider.id ? "Discovering..." : "Discover"}
                              </button>
                            </div>
                          </div>
                          {editingProvider.discoveredCollections.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground/75">No discovered collections yet. Click Discover.</p>
                          ) : (
                            <div className="space-y-1">
                              {editingProvider.discoveredCollections.map((collection) => {
                                const selected = editingProvider.selectedCalendarUrls.includes(collection.url);
                                const isBirthdays = `${collection.name || ""} ${collection.url}`.toLowerCase().includes("birth");
                                const comps = (collection.components || []).join(", ") || "Unknown";
                                return (
                                  <label key={collection.url} className="flex items-start gap-2 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-foreground/5">
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      onChange={(e) => {
                                        setEditingProvider((prev) => {
                                          const next = new Set(prev.selectedCalendarUrls);
                                          if (e.target.checked) next.add(collection.url);
                                          else next.delete(collection.url);
                                          return { ...prev, selectedCalendarUrls: Array.from(next) };
                                        });
                                      }}
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-foreground/90">{collection.name || collection.url}</span>
                                      <span className="block truncate text-[10px]">{comps}{isBirthdays ? " • birthdays" : ""}</span>
                                      <span className="block truncate text-[10px] text-muted-foreground/70">{collection.url}</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
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
                            setEditingProvider({ vendor: "icloud", label: "", serverUrl: "", calendarUrl: "", calendarId: "", discoveredCollections: [], selectedCalendarUrls: [], username: "", cutoffDate: "", password: "" });
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
                        const badge = badgeForItem(item, accountLabelById, accountVendorById);
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
                                  <span className="shrink-0 text-[10px] font-medium text-foreground/85">{formatTimeRange(item.dueAt, item.type === "task" ? undefined : item.endAt)}</span>
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
                        const badge = badgeForItem(item, accountLabelById, accountVendorById);
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
                                  <span className="shrink-0 text-[10px] font-medium text-foreground/85">{formatTimeRange(item.dueAt, item.type === "task" ? undefined : item.endAt)}</span>
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
              const badge = badgeForItem(item, accountLabelById, accountVendorById);
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
                  <span className="text-xs text-muted-foreground/70">{formatDateTime(item.dueAt)}{item.type !== "task" ? ` (${formatTimeRange(item.dueAt, item.endAt)})` : ""}</span>
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

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-foreground/10 bg-card p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Create calendar item</h3>
              <button
                type="button"
                onClick={() => {
                  if (saving) return;
                  setCreateOpen(false);
                  resetCreateForm();
                }}
                className="rounded-md p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                aria-label="Close create modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs text-muted-foreground">
                Title
                <input
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className={cn("mt-1 w-full", CALENDAR_INPUT_CLASS)}
                  placeholder="Reminder or event title"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                Description
                <textarea
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  rows={2}
                  placeholder="Optional details"
                  className={cn("mt-1 w-full resize-none", CALENDAR_INPUT_CLASS)}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="block text-xs text-muted-foreground">
                  <p>Type</p>
                  <div className="mt-1 inline-flex items-center rounded-md border border-foreground/10 bg-background/70 p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateKind("event");
                        if (!createEndAt && createDueAt) setCreateEndAt(createDueAt);
                      }}
                      className={cn(
                        "rounded px-2 py-1 text-xs transition-colors",
                        createKind === "event" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Event
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateKind("reminder");
                        setCreateEndAt("");
                        setCreateAllDay(false);
                        setCreateProviderId("");
                      }}
                      className={cn(
                        "rounded px-2 py-1 text-xs transition-colors",
                        createKind === "reminder" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Reminder
                    </button>
                  </div>
                </div>

                <div className="block text-xs text-muted-foreground">
                  <p>All day event</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (createKind !== "event") return;
                      const next = !createAllDay;
                      setCreateAllDay(next);
                      if (next) {
                        if (createDueAt) {
                          const normalizedStart = toAllDayLocal(createDueAt);
                          setCreateDueAt(normalizedStart);
                          setCreateEndAt((prev) => {
                            const normalizedPrev = toAllDayLocal(prev);
                            if (!normalizedPrev) return normalizedStart;
                            const s = parseLocalDateTime(normalizedStart);
                            const p = parseLocalDateTime(normalizedPrev);
                            if (!s || !p || p.getTime() < s.getTime()) return normalizedStart;
                            return normalizedPrev;
                          });
                        } else {
                          setCreateEndAt("");
                        }
                      }
                    }}
                    disabled={createKind !== "event"}
                    className={cn(
                      "mt-1 inline-flex rounded-md border p-0.5 text-xs transition-colors",
                      createKind !== "event"
                        ? "cursor-not-allowed border-foreground/10 bg-background/40 text-muted-foreground/50"
                        : "border-foreground/10 bg-background/70"
                    )}
                    aria-pressed={createAllDay}
                  >
                    <span
                      className={cn(
                        "rounded px-2 py-1",
                        createAllDay ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                      )}
                    >
                      On
                    </span>
                    <span
                      className={cn(
                        "rounded px-2 py-1",
                        !createAllDay ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                      )}
                    >
                      Off
                    </span>
                  </button>
                </div>
              </div>

              <div className={cn("grid gap-3", createKind === "event" ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
                <div className="block text-xs text-muted-foreground">
                  <p>Start</p>
                  <DateTimePicker
                    value={createDueAt}
                    onChange={(next) => {
                      setCreateDueAt(next);
                      if (createKind === "event" && createAllDay) {
                        const normalizedStart = toAllDayLocal(next);
                        setCreateEndAt((prev) => {
                          const normalizedPrev = toAllDayLocal(prev);
                          if (!normalizedPrev) return normalizedStart;
                          const s = parseLocalDateTime(normalizedStart);
                          const p = parseLocalDateTime(normalizedPrev);
                          if (!s || !p || p.getTime() < s.getTime()) return normalizedStart;
                          return normalizedPrev;
                        });
                      }
                    }}
                    dateOnly={createAllDay}
                    className="mt-1 w-full"
                  />
                </div>

              {createKind === "event" && (
                <div className="block text-xs text-muted-foreground">
                  <p>End</p>
                  <DateTimePicker
                    value={createEndAt}
                    onChange={setCreateEndAt}
                    dateOnly={createAllDay}
                    minValue={createDueAt}
                    className="mt-1 w-full"
                  />
                </div>
              )}
              </div>

              <div className="space-y-2 rounded-xl border border-foreground/10 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground/90">Save to provider</p>
                  <a
                    href="/calendar/providers"
                    className="text-xs text-emerald-300 hover:text-emerald-200"
                  >
                    Configure providers
                  </a>
                </div>

                {enabledProviders.length === 0 ? (
                  <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                    No providers configured. Configure at least one provider to save externally.
                  </p>
                ) : createKind === "reminder" ? (
                  <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                    Saving reminders to provider is not supported yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {enabledProviders.map((provider) => {
                      const selected = createProviderId === provider.id;
                      const vendor = provider.vendor === "google" ? "Google" : "iCloud";
                      return (
                        <button
                          key={provider.id}
                          type="button"
                          onClick={() => setCreateProviderId((prev) => (prev === provider.id ? "" : provider.id))}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                            selected
                              ? "border-emerald-500/30 bg-emerald-500/10 text-foreground"
                              : "border-foreground/10 bg-card/50 text-muted-foreground hover:text-foreground"
                          )}
                          aria-pressed={selected}
                        >
                          <span className="truncate">
                            {provider.label}
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">{vendor}</span>
                          </span>
                          <span className={cn("rounded px-2 py-0.5", selected ? "bg-card text-foreground" : "text-muted-foreground")}>
                            {selected ? "On" : "Off"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {createError && (
                <p className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-400">
                  {createError}
                </p>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (saving) return;
                  setCreateOpen(false);
                  resetCreateForm();
                }}
                className="rounded-md border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createItem()}
                disabled={saving || !createTitle.trim() || !createDueAt.trim() || (createKind === "event" && !createEndAt.trim())}
                className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 disabled:opacity-60"
              >
                {saving ? "Creating..." : "Create"}
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
                  : (pendingAction.item.source === "provider")
                    ? "This will delete the item from both Mission Control and the connected provider calendar."
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

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="block text-xs text-muted-foreground">
                  <p>Type</p>
                  <div className="mt-1 inline-flex items-center rounded-md border border-foreground/10 bg-background/70 p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditKind("event");
                        if (!editEndAt && editDueAt) setEditEndAt(editDueAt);
                      }}
                      className={cn(
                        "rounded px-2 py-1 text-xs transition-colors",
                        editKind === "event" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Event
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditKind("reminder");
                        setEditEndAt("");
                        setEditAllDay(false);
                      }}
                      className={cn(
                        "rounded px-2 py-1 text-xs transition-colors",
                        editKind === "reminder" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Reminder
                    </button>
                  </div>
                </div>

                <div className="block text-xs text-muted-foreground">
                  <p>All day event</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (editKind !== "event") return;
                      const next = !editAllDay;
                      setEditAllDay(next);
                      if (next) {
                        if (editDueAt) {
                          const normalizedStart = toAllDayLocal(editDueAt);
                          setEditDueAt(normalizedStart);
                          setEditEndAt((prev) => {
                            const normalizedPrev = toAllDayLocal(prev);
                            if (!normalizedPrev) return normalizedStart;
                            const s = parseLocalDateTime(normalizedStart);
                            const p = parseLocalDateTime(normalizedPrev);
                            if (!s || !p || p.getTime() < s.getTime()) return normalizedStart;
                            return normalizedPrev;
                          });
                        } else {
                          setEditEndAt("");
                        }
                      }
                    }}
                    disabled={editKind !== "event"}
                    className={cn(
                      "mt-1 inline-flex rounded-md border p-0.5 text-xs transition-colors",
                      editKind !== "event"
                        ? "cursor-not-allowed border-foreground/10 bg-background/40 text-muted-foreground/50"
                        : "border-foreground/10 bg-background/70"
                    )}
                    aria-pressed={editAllDay}
                  >
                    <span
                      className={cn(
                        "rounded px-2 py-1",
                        editAllDay ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                      )}
                    >
                      On
                    </span>
                    <span
                      className={cn(
                        "rounded px-2 py-1",
                        !editAllDay ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                      )}
                    >
                      Off
                    </span>
                  </button>
                </div>
              </div>

              <div className={cn("grid gap-3", editKind === "event" ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
                <div className="block text-xs text-muted-foreground">
                  <p>Start</p>
                  <DateTimePicker
                    value={editDueAt}
                    onChange={(next) => {
                      setEditDueAt(next);
                      if (editKind === "event" && editAllDay) {
                        const normalizedStart = toAllDayLocal(next);
                        setEditEndAt((prev) => {
                          const normalizedPrev = toAllDayLocal(prev);
                          if (!normalizedPrev) return normalizedStart;
                          const s = parseLocalDateTime(normalizedStart);
                          const p = parseLocalDateTime(normalizedPrev);
                          if (!s || !p || p.getTime() < s.getTime()) return normalizedStart;
                          return normalizedPrev;
                        });
                      }
                    }}
                    dateOnly={editAllDay}
                    className="mt-1 w-full"
                  />
                </div>

                {editKind === "event" && (
                  <div className="block text-xs text-muted-foreground">
                    <p>End</p>
                    <DateTimePicker
                      value={editEndAt}
                      onChange={setEditEndAt}
                      dateOnly={editAllDay}
                      minValue={editDueAt}
                      className="mt-1 w-full"
                    />
                  </div>
                )}
              </div>

              {calendarError && (
                <p className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-400">
                  {calendarError}
                </p>
              )}
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
                disabled={savingEdit || !editTitle.trim() || !editDueAt.trim() || (editKind === "event" && !editEndAt.trim())}
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
