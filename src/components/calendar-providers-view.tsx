"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Link2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Upload } from "lucide-react";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type ProviderAccount = {
  id: string;
  type: "caldav";
  vendor?: "icloud" | "google";
  label: string;
  serverUrl: string;
  calendarUrl: string;
  calendarId?: string;
  discoveredCollections?: Array<{ url: string; name?: string; components?: Array<"VEVENT" | "VTODO"> }>;
  selectedCalendarUrls?: string[];
  username: string;
  cutoffDate?: string;
  enabled: boolean;
  lastSyncAt?: string;
  lastError?: string;
};

type ApiPayload = {
  providers?: ProviderAccount[];
  entries?: Array<{ source?: string; providerAccountId?: string }>;
  upcoming?: Array<{ type?: string; source?: string }>;
  googleOAuth?: {
    configured: boolean;
    connected?: boolean;
    tokenExpiresAt?: string;
    clientId?: string;
    redirectUri?: string;
  };
};

const INPUT_CLASS =
  "h-10 w-full rounded-lg border border-foreground/15 bg-muted/70 px-3 py-2 text-sm text-foreground/90 shadow-inner outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/25 focus:bg-background/90";

function formatDateTime(iso?: string): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ProviderBadge({ vendor }: { vendor: "icloud" | "google" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px]",
        vendor === "google"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200"
      )}
    >
      {vendor === "google" ? "Google" : "iCloud"}
    </span>
  );
}

function isPlannedIcloudVtodoCollection(vendor: "icloud" | "google", components?: Array<"VEVENT" | "VTODO">): boolean {
  return vendor === "icloud" && Boolean(components?.includes("VTODO"));
}

export function CalendarProvidersView() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [latestImportedByProvider, setLatestImportedByProvider] = useState<Record<string, number>>({});

  const [vendorTab, setVendorTab] = useState<"icloud" | "google" | "zoho">("icloud");
  const [form, setForm] = useState({
    label: "",
    serverUrl: "https://caldav.icloud.com",
    calendarUrl: "",
    calendarId: "",
    username: "",
    password: "",
    cutoffDate: "",
  });
  const [testedCollections, setTestedCollections] = useState<Array<{ url: string; name?: string; components?: Array<"VEVENT" | "VTODO"> }>>([]);
  const [selectedCollectionUrls, setSelectedCollectionUrls] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: "delete" | "purge";
    provider: ProviderAccount;
  } | null>(null);

  const [googleClientImporting, setGoogleClientImporting] = useState(false);
  const [googleClientFileName, setGoogleClientFileName] = useState("");

  const [editForm, setEditForm] = useState<{
    vendor: "icloud" | "google";
    label: string;
    serverUrl: string;
    calendarUrl: string;
    calendarId: string;
    username: string;
    password: string;
    cutoffDate: string;
    discoveredCollections: Array<{ url: string; name?: string; components?: Array<"VEVENT" | "VTODO"> }>;
    selectedCalendarUrls: string[];
  }>({
    vendor: "icloud",
    label: "",
    serverUrl: "",
    calendarUrl: "",
    calendarId: "",
    username: "",
    password: "",
    cutoffDate: "",
    discoveredCollections: [],
    selectedCalendarUrls: [],
  });

  const googleCallbackUri = payload?.googleOAuth?.redirectUri
    || ((typeof window !== "undefined" ? window.location.origin : "") + "/api/calendar/google/callback");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/calendar", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || "Failed to load providers");
    setPayload(data);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await refresh();
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const providers = payload?.providers || [];
  const accountsCount = providers.filter((p) => p.enabled).length;
  const healthyCount = providers.filter((p) => p.enabled && !p.lastError).length;
  const latestSyncProvider = useMemo(() => {
    const withSync = providers.filter((p) => p.lastSyncAt);
    withSync.sort((a, b) => new Date(b.lastSyncAt || 0).getTime() - new Date(a.lastSyncAt || 0).getTime());
    return withSync[0];
  }, [providers]);
  const importedCountByProvider = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of payload?.entries || []) {
      if (entry.source !== "provider" || !entry.providerAccountId) continue;
      counts[entry.providerAccountId] = (counts[entry.providerAccountId] || 0) + 1;
    }
    return counts;
  }, [payload?.entries]);

  const testProvider = useCallback(async () => {
    if (vendorTab === "zoho") {
      setMessage({ type: "err", text: "Zoho provider support is Planned and not implemented yet." });
      return;
    }
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "provider-test",
          type: "caldav",
          vendor: vendorTab,
          serverUrl: form.serverUrl,
          calendarUrl: form.calendarUrl,
          calendarId: vendorTab === "google" ? form.calendarId || form.username : "",
          username: form.username,
          password: vendorTab === "google" ? "" : form.password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Test failed (${res.status})`);
      setForm((prev) => ({ ...prev, calendarUrl: data.calendarUrl || prev.calendarUrl }));
      setTestedCollections(Array.isArray(data.discoveredCollections) ? data.discoveredCollections : []);
      const nextSelected: string[] = Array.isArray(data.selectedCalendarUrls)
        ? data.selectedCalendarUrls.filter((url: unknown): url is string => typeof url === "string")
        : [];
      const nextCollections: Array<{ url: string; name?: string; components?: Array<"VEVENT" | "VTODO"> }> = Array.isArray(data.discoveredCollections)
        ? data.discoveredCollections
        : [];
      setSelectedCollectionUrls(
        vendorTab === "icloud"
          ? nextSelected.filter((url) => !nextCollections.some((c) => c.url === url && isPlannedIcloudVtodoCollection("icloud", c.components)))
          : nextSelected
      );
      setMessage({ type: "ok", text: "Connection OK. Collections discovered." });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }, [form, vendorTab]);

  const saveProvider = useCallback(async () => {
    if (vendorTab === "zoho") {
      setMessage({ type: "err", text: "Zoho provider support is Planned and not implemented yet." });
      return;
    }
    if (!form.label.trim() || !form.serverUrl.trim() || !form.username.trim()) return;
    if (vendorTab !== "google" && !form.password.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "provider-add",
          type: "caldav",
          vendor: vendorTab,
          label: form.label,
          serverUrl: form.serverUrl,
          calendarUrl: form.calendarUrl,
          calendarId: vendorTab === "google" ? form.calendarId || form.username : "",
          username: form.username,
          password: vendorTab === "google" ? "" : form.password,
          cutoffDate: form.cutoffDate || undefined,
          selectedCalendarUrls: (vendorTab === "icloud"
            ? selectedCollectionUrls.filter((url) => !testedCollections.some((c) => c.url === url && isPlannedIcloudVtodoCollection("icloud", c.components)))
            : selectedCollectionUrls),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Save failed (${res.status})`);
      setMessage({ type: "ok", text: "Provider saved." });
      setForm((prev) => ({ ...prev, label: "", calendarUrl: "", calendarId: "", cutoffDate: "", password: "" }));
      setTestedCollections([]);
      setSelectedCollectionUrls([]);
      await refresh();
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }, [form, refresh, selectedCollectionUrls, testedCollections, vendorTab]);

  const importGoogleOAuthClientFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setGoogleClientFileName(file.name);
    setGoogleClientImporting(true);
    setMessage(null);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { web?: { client_id?: string; client_secret?: string } };
      const clientId = String(parsed?.web?.client_id || "").trim();
      const clientSecret = String(parsed?.web?.client_secret || "").trim();
      if (!clientId || !clientSecret) throw new Error("Invalid client_secret.json: expected web.client_id and web.client_secret.");

      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "google-oauth-config-set", clientId, clientSecret, redirectUri: googleCallbackUri }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Import failed (${res.status})`);
      setMessage({ type: "ok", text: "Google OAuth client imported." });
      await refresh();
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setGoogleClientImporting(false);
    }
  }, [googleCallbackUri, refresh]);

  const syncProvider = useCallback(async (id: string) => {
    setSyncingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "provider-sync", accountId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Sync failed (${res.status})`);
      setLatestImportedByProvider((prev) => ({
        ...prev,
        [id]: Number.isFinite(Number(data?.imported)) ? Number(data.imported) : 0,
      }));
      setMessage({ type: "ok", text: data?.message || "Sync complete." });
      await refresh();
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncingId(null);
    }
  }, [refresh]);

  const discoverProvider = useCallback(async (id: string) => {
    setDiscoveringId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "provider-discover", accountId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Discover failed (${res.status})`);
      setMessage({ type: "ok", text: "Collections discovered." });
      await refresh();
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setDiscoveringId(null);
    }
  }, [refresh]);

  const purgeProvider = useCallback(async (id: string) => {
    setPurgingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "provider-purge", accountId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Purge failed (${res.status})`);
      setMessage({ type: "ok", text: data?.message || "Imported events purged." });
      await refresh();
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPurgingId(null);
    }
  }, [refresh]);

  const deleteProvider = useCallback(async (id: string) => {
    setMessage(null);
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "provider-delete", accountId: id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      setMessage({ type: "err", text: data?.error || `Delete failed (${res.status})` });
      return;
    }
    setMessage({ type: "ok", text: "Provider deleted." });
    await refresh();
  }, [refresh]);

  const beginEdit = useCallback((provider: ProviderAccount) => {
    setEditingId(provider.id);
    setEditForm({
      vendor: provider.vendor === "google" ? "google" : "icloud",
      label: provider.label,
      serverUrl: provider.serverUrl,
      calendarUrl: provider.calendarUrl,
      calendarId: provider.calendarId || "",
      username: provider.username,
      password: "",
      cutoffDate: provider.cutoffDate ? provider.cutoffDate.slice(0, 10) : "",
      discoveredCollections: provider.discoveredCollections || [],
      selectedCalendarUrls: (provider.selectedCalendarUrls || []).filter(
        (url) => !((provider.discoveredCollections || []).some((c) => c.url === url && isPlannedIcloudVtodoCollection(provider.vendor === "google" ? "google" : "icloud", c.components)))
      ),
    });
  }, []);

  const saveEdit = useCallback(async (provider: ProviderAccount) => {
    setEditSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "provider-add",
          id: provider.id,
          type: provider.type,
          vendor: editForm.vendor,
          label: editForm.label,
          serverUrl: editForm.serverUrl,
          calendarUrl: editForm.calendarUrl,
          calendarId: editForm.vendor === "google" ? editForm.calendarId || editForm.username : "",
          discoveredCollections: editForm.discoveredCollections,
          selectedCalendarUrls: (editForm.vendor === "icloud"
            ? editForm.selectedCalendarUrls.filter((url) => !editForm.discoveredCollections.some((c) => c.url === url && isPlannedIcloudVtodoCollection("icloud", c.components)))
            : editForm.selectedCalendarUrls),
          username: editForm.username,
          password: editForm.password,
          cutoffDate: editForm.cutoffDate || undefined,
          enabled: provider.enabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Save failed (${res.status})`);
      setMessage({ type: "ok", text: "Provider updated." });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setEditSaving(false);
    }
  }, [editForm, refresh]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const confirmDestructiveAction = useCallback(async () => {
    if (!confirmAction) return;
    if (confirmAction.type === "delete") {
      await deleteProvider(confirmAction.provider.id);
    } else {
      await purgeProvider(confirmAction.provider.id);
    }
    setConfirmAction(null);
  }, [confirmAction, deleteProvider, purgeProvider]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading providers...</div>;
  }

  return (
    <SectionLayout>
      <SectionHeader
        title="Calendar Providers"
        description="Provider control plane for account sync, discovery, and lifecycle actions."
        actions={
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Refresh
          </button>
        }
      />

      <SectionBody width="content" innerClassName="space-y-4">
        {message && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm",
              message.type === "ok"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
            )}
          >
            {message.type === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <CircleAlert className="h-4 w-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-foreground/10 bg-card/40">
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Accounts</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">{accountsCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">Enabled sync accounts</p>
              </div>
              <div className="rounded-2xl border border-foreground/10 bg-background/70 p-3">
                <Link2 className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-foreground/10 bg-card/40">
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Provider Health</p>
                <p className="mt-2 text-3xl font-semibold text-foreground">{healthyCount}/{providers.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">Accounts without sync errors</p>
              </div>
              <div className="rounded-2xl border border-foreground/10 bg-background/70 p-3">
                <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-foreground/10 bg-card/40">
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Last Sync</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{latestSyncProvider?.label || "No recent sync"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(latestSyncProvider?.lastSyncAt)}</p>
              </div>
              <div className="rounded-2xl border border-foreground/10 bg-background/70 p-3">
                <RefreshCw className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-foreground/10 bg-card/40">
            <div className="px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Sync Activity</p>
              <div className="mt-2 space-y-1.5">
                {providers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No configured providers.</p>
                ) : (
                  providers.map((provider) => {
                    const runCount = latestImportedByProvider[provider.id];
                    const totalCount = importedCountByProvider[provider.id] || 0;
                    return (
                      <div key={provider.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-foreground/90">{provider.label}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {runCount != null ? `${runCount} this sync` : `${totalCount} total`}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="rounded-2xl border border-foreground/10 bg-card/30">
            <div className="space-y-4 px-5 py-5">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Provider Control Pane</h3>
                <p className="mt-1 text-sm text-muted-foreground">Connected providers are imported into the timeline. Reminder parity and provider write-back controls are still planned.</p>
              </div>

              {providers.map((provider) => {
                const vendor = provider.vendor === "google" ? "google" : "icloud";
                return (
                  <div key={provider.id} className="rounded-2xl border border-foreground/10 bg-background/50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{provider.label}</p>
                      <ProviderBadge vendor={vendor} />
                      <span className="rounded-full border border-foreground/15 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground">{provider.type.toUpperCase()}</span>
                      <span className="text-xs text-muted-foreground">Last sync: {formatDateTime(provider.lastSyncAt)}</span>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm">
                      <div className="flex items-center justify-between rounded-xl border border-foreground/10 bg-card px-3 py-2">
                        <span className="text-foreground/90">Provider enabled</span>
                        <Switch checked={provider.enabled} disabled />
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-foreground/10 bg-card px-3 py-2">
                        <span className="text-foreground/90">Import events</span>
                        <Switch checked disabled />
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-foreground/10 bg-card px-3 py-2">
                        <span className="text-foreground/90">Import reminders (VTODO)</span>
                        <span className="flex items-center gap-2">
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">Planned</span>
                          <Switch checked={false} disabled />
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-foreground/10 bg-card px-3 py-2">
                        <span className="text-foreground/90">Write-back preference</span>
                        <span className="flex items-center gap-2">
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">Planned</span>
                          <Switch checked={false} disabled />
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      <button type="button" onClick={() => void syncProvider(provider.id)} disabled={syncingId === provider.id} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300 disabled:opacity-60">{syncingId === provider.id ? "Syncing..." : "Sync"}</button>
                        <button type="button" onClick={() => setConfirmAction({ type: "purge", provider })} disabled={purgingId === provider.id} className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300 disabled:opacity-60">{purgingId === provider.id ? "Purging..." : "Purge"}</button>
                        <button type="button" onClick={() => beginEdit(provider)} className="rounded border border-foreground/20 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground"><Pencil className="mr-1 inline h-3 w-3" />Edit</button>
                        <button type="button" onClick={() => setConfirmAction({ type: "delete", provider })} className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-300"><Trash2 className="mr-1 inline h-3 w-3" />Delete</button>
                    </div>

                    {provider.lastError && <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-300">{provider.lastError}</p>}

                    {editingId === provider.id && (
                      <div className="mt-3 space-y-3 rounded-xl border border-foreground/10 bg-background/40 p-3">
                        <div className="grid gap-2 md:grid-cols-2">
                          <input className={INPUT_CLASS} value={editForm.label} onChange={(e) => setEditForm((p) => ({ ...p, label: e.target.value }))} placeholder="Label" />
                          <input className={INPUT_CLASS} value={editForm.serverUrl} onChange={(e) => setEditForm((p) => ({ ...p, serverUrl: e.target.value }))} placeholder="Server URL" />
                          <input className={INPUT_CLASS} value={editForm.calendarUrl} onChange={(e) => setEditForm((p) => ({ ...p, calendarUrl: e.target.value }))} placeholder="Calendar URL" />
                          <input className={INPUT_CLASS} value={editForm.username} onChange={(e) => setEditForm((p) => ({ ...p, username: e.target.value }))} placeholder="Username" />
                        </div>

                        <div className="space-y-2 rounded-xl border border-foreground/10 bg-card p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-foreground/90">Collections</p>
                            <button
                              type="button"
                              onClick={() => void discoverProvider(provider.id)}
                              disabled={discoveringId === provider.id}
                              className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300 disabled:opacity-60"
                            >
                              {discoveringId === provider.id ? "Discovering..." : "Discover"}
                            </button>
                          </div>
                          {editForm.discoveredCollections.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No collections discovered yet.</p>
                          ) : (
                            editForm.discoveredCollections.map((collection) => {
                              const plannedVtodo = isPlannedIcloudVtodoCollection(editForm.vendor, collection.components);
                              const checked = plannedVtodo ? false : editForm.selectedCalendarUrls.includes(collection.url);
                              const components = (collection.components || []).join(", ") || "Unknown";
                              return (
                                <div key={collection.url} className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs text-foreground/90">
                                      {collection.name || collection.url}
                                      {plannedVtodo && (
                                        <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">Planned</span>
                                      )}
                                    </p>
                                    <p className="truncate text-[10px] text-muted-foreground">{components}</p>
                                  </div>
                                  <Switch
                                    checked={checked}
                                    disabled={plannedVtodo}
                                    onCheckedChange={(next) => {
                                      if (plannedVtodo) return;
                                      setEditForm((prev) => ({
                                        ...prev,
                                        selectedCalendarUrls: next
                                          ? [...new Set([...prev.selectedCalendarUrls, collection.url])]
                                          : prev.selectedCalendarUrls.filter((u) => u !== collection.url),
                                      }));
                                    }}
                                  />
                                </div>
                              );
                            })
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => void saveEdit(provider)} disabled={editSaving} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300 disabled:opacity-60">{editSaving ? "Saving..." : "Save"}</button>
                          <button type="button" onClick={() => setEditingId(null)} className="rounded border border-foreground/20 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {providers.length === 0 && (
                <div className="rounded-2xl border border-foreground/10 bg-card/30 p-6 text-center text-sm text-muted-foreground">No providers configured yet.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-foreground/10 bg-card/30">
            <div className="space-y-4 px-5 py-5">
              <h3 className="text-sm font-semibold text-foreground">Add account</h3>

              <div className="inline-flex items-center rounded-md border border-foreground/10 bg-background/70 p-0.5">
                <button type="button" onClick={() => { setVendorTab("icloud"); setForm((p) => ({ ...p, serverUrl: "https://caldav.icloud.com", calendarUrl: "", calendarId: "" })); }} className={cn("rounded px-2 py-1 text-xs transition-colors", vendorTab === "icloud" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>iCloud</button>
                <button type="button" onClick={() => { setVendorTab("google"); setForm((p) => ({ ...p, serverUrl: "https://apidata.googleusercontent.com/caldav/v2", calendarUrl: "" })); }} className={cn("rounded px-2 py-1 text-xs transition-colors", vendorTab === "google" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Google</button>
                <button
                  type="button"
                  onClick={() => {
                    setVendorTab("zoho");
                    setMessage({ type: "err", text: "Zoho provider support is Planned and not implemented yet." });
                  }}
                  className={cn("rounded px-2 py-1 text-xs transition-colors", vendorTab === "zoho" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  Zoho
                </button>
              </div>

              {vendorTab === "zoho" && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  Zoho integration is <span className="font-semibold">Planned</span>. Setup controls are not active yet.
                </div>
              )}

              {vendorTab === "google" && (
                <div className="rounded-xl border border-foreground/10 bg-background/50 p-3 text-xs text-foreground/85 space-y-1">
                  <p>OAuth client: {payload?.googleOAuth?.configured ? "Configured" : "Not configured"}</p>
                  <p>OAuth status: {payload?.googleOAuth?.connected ? "Connected" : "Not connected"}</p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a href="/api/calendar/google/start" className={cn("rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-emerald-300", !payload?.googleOAuth?.configured && "pointer-events-none opacity-60")}>{payload?.googleOAuth?.connected ? "Reconnect Google" : "Connect Google"}</a>
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-foreground/10 bg-background/60 px-3 py-1.5 text-muted-foreground hover:text-foreground">
                      <Upload className="h-3 w-3" /> {googleClientImporting ? "Importing..." : "Upload client_secret.json"}
                      <input type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0] || null; void importGoogleOAuthClientFile(file); event.currentTarget.value = ""; }} />
                    </label>
                  </div>
                  {googleClientFileName && <p>Last file: {googleClientFileName}</p>}
                  <p>Callback: <code>{googleCallbackUri}</code></p>
                </div>
              )}

              <div className="grid gap-2">
                <input disabled={vendorTab === "zoho"} className={cn(INPUT_CLASS, vendorTab === "zoho" && "opacity-60")} value={form.label} onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} placeholder="Account label" />
                <input disabled={vendorTab === "zoho"} className={cn(INPUT_CLASS, vendorTab === "zoho" && "opacity-60")} value={form.serverUrl} onChange={(e) => setForm((p) => ({ ...p, serverUrl: e.target.value }))} placeholder="Server URL" />
                {vendorTab === "icloud" && <input className={INPUT_CLASS} value={form.calendarUrl} onChange={(e) => setForm((p) => ({ ...p, calendarUrl: e.target.value }))} placeholder="Calendar URL (optional)" />}
                {vendorTab === "google" && <input className={INPUT_CLASS} value={form.calendarId} onChange={(e) => setForm((p) => ({ ...p, calendarId: e.target.value }))} placeholder="Calendar ID (optional)" />}
                {vendorTab !== "zoho" && <input className={INPUT_CLASS} value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))} placeholder={vendorTab === "google" ? "Google account" : "Apple ID"} />}
                {vendorTab === "icloud" && <input className={INPUT_CLASS} type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder="App-specific password" />}
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Cut-off date (optional)</span>
                  <div className={cn(vendorTab === "zoho" && "pointer-events-none opacity-60")}>
                    <DateTimePicker
                      dateOnly
                      value={form.cutoffDate || ""}
                      onChange={(value) => setForm((p) => ({ ...p, cutoffDate: value || "" }))}
                    />
                  </div>
                </div>
              </div>

              {testedCollections.length > 0 && (
                <div className="space-y-2 rounded-xl border border-foreground/10 bg-background/50 p-3">
                  <p className="text-xs font-medium text-foreground/90">Collections</p>
                  {testedCollections.map((collection) => {
                    const plannedVtodo = isPlannedIcloudVtodoCollection(vendorTab === "google" ? "google" : "icloud", collection.components);
                    const checked = plannedVtodo ? false : selectedCollectionUrls.includes(collection.url);
                    const components = (collection.components || []).join(", ") || "Unknown";
                    return (
                      <div key={collection.url} className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-foreground/90">
                            {collection.name || collection.url}
                            {plannedVtodo && (
                              <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">Planned</span>
                            )}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">{components}</p>
                        </div>
                        <Switch
                          checked={checked}
                          disabled={plannedVtodo}
                          onCheckedChange={(next) => {
                            if (plannedVtodo) return;
                            setSelectedCollectionUrls((prev) => next
                              ? [...new Set([...prev, collection.url])]
                              : prev.filter((u) => u !== collection.url));
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void testProvider()} disabled={vendorTab === "zoho" || testing || (vendorTab === "google" && !payload?.googleOAuth?.connected)} className="rounded-md border border-foreground/10 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60">{testing ? "Testing..." : "Test"}</button>
                <button type="button" onClick={() => void saveProvider()} disabled={vendorTab === "zoho" || saving || (vendorTab === "google" && !payload?.googleOAuth?.connected)} className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 disabled:opacity-60"><Plus className="h-3 w-3" /> {saving ? "Saving..." : "Save Provider"}</button>
              </div>
            </div>
          </div>
        </div>

        {confirmAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl border border-foreground/10 bg-card p-4 shadow-2xl">
              <h3 className="text-sm font-semibold text-foreground">
                {confirmAction.type === "delete" ? "Delete provider" : "Purge imported items"}
              </h3>
              <p className="mt-2 text-xs text-muted-foreground">
                {confirmAction.type === "delete"
                  ? "This removes the provider account and its stored credentials. This action cannot be undone."
                  : "This removes imported copies from Mission Control only; source provider events remain."}
              </p>
              <p className="mt-2 text-xs text-foreground/80">Provider: {confirmAction.provider.label}</p>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  disabled={Boolean(purgingId) || Boolean(syncingId)}
                  className="rounded-md border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDestructiveAction()}
                  disabled={Boolean(purgingId) || Boolean(syncingId)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60",
                    confirmAction.type === "delete"
                      ? "border border-red-500/30 bg-red-500/10 text-red-300"
                      : "border border-amber-500/30 bg-amber-500/10 text-amber-300"
                  )}
                >
                  {confirmAction.type === "delete" ? "Delete provider" : "Purge imports"}
                </button>
              </div>
            </div>
          </div>
        )}
      </SectionBody>
    </SectionLayout>
  );
}
