"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Upload, Plus, Pencil, Trash2 } from "lucide-react";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { DateTimePicker } from "@/components/ui/date-time-picker";
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
  googleOAuth?: {
    configured: boolean;
    connected?: boolean;
    tokenExpiresAt?: string;
    clientId?: string;
    redirectUri?: string;
  };
};

type ProvidersTab = "overview" | "setup";

const PROVIDER_INPUT_CLASS =
  "h-10 w-full rounded-lg border border-foreground/15 bg-muted/70 px-3 py-2 text-sm text-foreground/90 shadow-inner outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-sky-500/35 focus:bg-background/90";

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

export function CalendarProvidersView() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [tab, setTab] = useState<ProvidersTab>("overview");
  const [vendorTab, setVendorTab] = useState<"icloud" | "google">("icloud");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [googleClientImporting, setGoogleClientImporting] = useState(false);
  const [googleClientFileName, setGoogleClientFileName] = useState("");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

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

  const googleCallbackUri = "http://127.0.0.1:3333/api/calendar/google/callback";

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

  const testProvider = useCallback(async () => {
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
      const discovered = Array.isArray(data.discoveredCollections) ? data.discoveredCollections : [];
      const selected = Array.isArray(data.selectedCalendarUrls) ? data.selectedCalendarUrls : [];
      setTestedCollections(discovered);
      setSelectedCollectionUrls(selected);
      setMessage({ type: "ok", text: "Connection OK. Collections discovered." });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }, [form, vendorTab]);

  const saveProvider = useCallback(async () => {
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
          selectedCalendarUrls: selectedCollectionUrls,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Save failed (${res.status})`);
      setMessage({ type: "ok", text: "Provider saved." });
      setForm((prev) => ({ ...prev, label: "", calendarUrl: "", calendarId: "", cutoffDate: "", password: "" }));
      setTestedCollections([]);
      setSelectedCollectionUrls([]);
      await refresh();
      setTab("overview");
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }, [form, refresh, selectedCollectionUrls, vendorTab]);

  const importGoogleOAuthClientFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setGoogleClientFileName(file.name);
    setGoogleClientImporting(true);
    setMessage(null);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { web?: { client_id?: string; client_secret?: string; redirect_uris?: string[] } };
      const clientId = String(parsed?.web?.client_id || "").trim();
      const clientSecret = String(parsed?.web?.client_secret || "").trim();
      if (!clientId || !clientSecret) throw new Error("Invalid client_secret.json: expected web.client_id and web.client_secret.");

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
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Import failed (${res.status})`);
      setMessage({ type: "ok", text: "Google OAuth client imported." });
      await refresh();
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setGoogleClientImporting(false);
    }
  }, [refresh]);

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
      selectedCalendarUrls: provider.selectedCalendarUrls || [],
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
          selectedCalendarUrls: editForm.selectedCalendarUrls,
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

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading providers...</div>;
  }

  return (
    <SectionLayout>
      <SectionHeader
        title="Calendar Providers"
        description="Manage external calendar connections, discovery, and sync behavior."
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
        <div className="inline-flex rounded-lg border border-border bg-muted p-1">
          {(["overview", "setup"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize",
                tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {id}
            </button>
          ))}
        </div>

        {message && (
          <div className={cn("rounded-lg border px-3 py-2 text-xs", message.type === "ok" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-red-500/20 bg-red-500/10 text-red-400")}>
            {message.text}
          </div>
        )}

        {tab === "overview" && (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-foreground/10 bg-card/40 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground/70">Configured</p>
                <p className="mt-2 text-2xl font-semibold">{providers.length}</p>
              </div>
              <div className="rounded-lg border border-foreground/10 bg-card/40 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground/70">Google OAuth</p>
                <p className="mt-2 text-sm">{payload?.googleOAuth?.connected ? "Connected" : payload?.googleOAuth?.configured ? "Configured" : "Not configured"}</p>
                {payload?.googleOAuth?.tokenExpiresAt && <p className="mt-1 text-xs text-muted-foreground">Token: {formatDateTime(payload.googleOAuth.tokenExpiresAt)}</p>}
              </div>
              <div className="rounded-lg border border-foreground/10 bg-card/40 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground/70">Last Sync</p>
                <p className="mt-2 text-sm">{providers.find((p) => p.lastSyncAt)?.label || "No recent sync"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(providers.find((p) => p.lastSyncAt)?.lastSyncAt)}</p>
              </div>
            </div>

            <div className="space-y-3">
              {providers.map((provider) => (
                <div key={provider.id} className="rounded-lg border border-foreground/10 bg-card/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">{provider.label}</span>
                    <span className="rounded-full border border-foreground/15 bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground">{provider.type.toUpperCase()}</span>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        (provider.vendor || "icloud") === "google"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200"
                      )}
                    >
                      {(provider.vendor || "icloud") === "google" ? "Google" : "iCloud"}
                    </span>
                    <span className="text-xs text-muted-foreground">Last sync: {formatDateTime(provider.lastSyncAt)}</span>
                    <button type="button" onClick={() => void syncProvider(provider.id)} disabled={syncingId === provider.id} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300 disabled:opacity-60">{syncingId === provider.id ? "Syncing..." : "Sync"}</button>
                    <button type="button" onClick={() => void discoverProvider(provider.id)} disabled={discoveringId === provider.id} className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300 disabled:opacity-60">{discoveringId === provider.id ? "Discovering..." : "Discover"}</button>
                    <button type="button" onClick={() => beginEdit(provider)} className="rounded border border-foreground/20 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground"><Pencil className="mr-1 inline h-3 w-3" />Edit</button>
                    <button type="button" onClick={() => void purgeProvider(provider.id)} disabled={purgingId === provider.id} className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300 disabled:opacity-60">{purgingId === provider.id ? "Purging..." : "Purge"}</button>
                    <button type="button" onClick={() => void deleteProvider(provider.id)} className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-300"><Trash2 className="mr-1 inline h-3 w-3" />Delete</button>
                  </div>
                  {provider.lastError && <p className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-400">{provider.lastError}</p>}

                  {editingId === provider.id && (
                    <div className="mt-3 space-y-2 rounded-md border border-foreground/10 bg-background/40 p-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <input className={PROVIDER_INPUT_CLASS} value={editForm.label} onChange={(e) => setEditForm((p) => ({ ...p, label: e.target.value }))} placeholder="Label" />
                        <input className={PROVIDER_INPUT_CLASS} value={editForm.serverUrl} onChange={(e) => setEditForm((p) => ({ ...p, serverUrl: e.target.value }))} placeholder="Server URL" />
                        <input className={PROVIDER_INPUT_CLASS} value={editForm.calendarUrl} onChange={(e) => setEditForm((p) => ({ ...p, calendarUrl: e.target.value }))} placeholder="Calendar URL" />
                        <input className={PROVIDER_INPUT_CLASS} value={editForm.username} onChange={(e) => setEditForm((p) => ({ ...p, username: e.target.value }))} placeholder="Username" />
                      </div>
                      {editForm.discoveredCollections.length > 0 && (
                        <div className="space-y-1 rounded-md border border-foreground/10 bg-background/50 p-2">
                          {editForm.discoveredCollections.map((collection) => {
                            const checked = editForm.selectedCalendarUrls.includes(collection.url);
                            return (
                              <label key={collection.url} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <input type="checkbox" checked={checked} onChange={(e) => setEditForm((prev) => ({ ...prev, selectedCalendarUrls: e.target.checked ? [...new Set([...prev.selectedCalendarUrls, collection.url])] : prev.selectedCalendarUrls.filter((u) => u !== collection.url) }))} />
                                <span className="truncate">{collection.name || collection.url}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => void saveEdit(provider)} disabled={editSaving} className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300 disabled:opacity-60">{editSaving ? "Saving..." : "Save"}</button>
                        <button type="button" onClick={() => setEditingId(null)} className="rounded border border-foreground/20 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {providers.length === 0 && (
                <div className="rounded-lg border border-foreground/10 bg-card/30 p-6 text-center text-sm text-muted-foreground">No providers configured yet.</div>
              )}
            </div>
          </>
        )}

        {tab === "setup" && (
          <div className="space-y-3 rounded-lg border border-foreground/10 bg-card/30 p-4">
            <div className="inline-flex items-center rounded-md border border-foreground/10 bg-background/70 p-0.5">
              <button type="button" onClick={() => { setVendorTab("icloud"); setForm((p) => ({ ...p, serverUrl: "https://caldav.icloud.com", calendarUrl: "", calendarId: "" })); }} className={cn("rounded px-2 py-1 text-xs transition-colors", vendorTab === "icloud" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>iCloud</button>
              <button type="button" onClick={() => { setVendorTab("google"); setForm((p) => ({ ...p, serverUrl: "https://apidata.googleusercontent.com/caldav/v2", calendarUrl: "" })); }} className={cn("rounded px-2 py-1 text-xs transition-colors", vendorTab === "google" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Google</button>
            </div>

            {vendorTab === "google" && (
              <div className="rounded-lg border border-foreground/10 bg-card/40 p-3 text-xs text-foreground/85 space-y-1">
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

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-xs text-muted-foreground"><span>Account label</span><input className={PROVIDER_INPUT_CLASS} value={form.label} onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} /></label>
              <label className="space-y-1 text-xs text-muted-foreground"><span>Server URL</span><input className={PROVIDER_INPUT_CLASS} value={form.serverUrl} onChange={(e) => setForm((p) => ({ ...p, serverUrl: e.target.value }))} /></label>
              {vendorTab === "icloud" && <label className="space-y-1 text-xs text-muted-foreground"><span>Calendar URL (optional)</span><input className={PROVIDER_INPUT_CLASS} value={form.calendarUrl} onChange={(e) => setForm((p) => ({ ...p, calendarUrl: e.target.value }))} /></label>}
              {vendorTab === "google" && <label className="space-y-1 text-xs text-muted-foreground"><span>Calendar ID (optional)</span><input className={PROVIDER_INPUT_CLASS} value={form.calendarId} onChange={(e) => setForm((p) => ({ ...p, calendarId: e.target.value }))} placeholder="Defaults to account email" /></label>}
              <label className="space-y-1 text-xs text-muted-foreground"><span>Username</span><input className={PROVIDER_INPUT_CLASS} value={form.username} onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))} /></label>
              {vendorTab === "icloud" && <label className="space-y-1 text-xs text-muted-foreground"><span>App-specific password</span><input className={PROVIDER_INPUT_CLASS} type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} /></label>}
              <div className="space-y-1 text-xs text-muted-foreground"><span>Cut-off date (optional)</span><DateTimePicker value={form.cutoffDate ? `${form.cutoffDate}T00:00` : ""} onChange={(value) => setForm((p) => ({ ...p, cutoffDate: value ? value.slice(0, 10) : "" }))} /></div>
            </div>

            {testedCollections.length > 0 && (
              <div className="rounded-md border border-foreground/10 bg-background/50 p-2">
                <p className="text-xs font-medium text-foreground/90">Discovered collections</p>
                <div className="mt-1 space-y-1">
                  {testedCollections.map((collection) => {
                    const checked = selectedCollectionUrls.includes(collection.url);
                    const comps = (collection.components || []).join(", ") || "Unknown";
                    return (
                      <label key={collection.url} className="flex items-start gap-2 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-foreground/5">
                        <input type="checkbox" checked={checked} onChange={(e) => setSelectedCollectionUrls((prev) => e.target.checked ? [...new Set([...prev, collection.url])] : prev.filter((u) => u !== collection.url))} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-foreground/90">{collection.name || collection.url}</span><span className="block truncate text-[10px]">{comps}</span></span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
                <button type="button" onClick={() => void testProvider()} disabled={testing || (vendorTab === "google" && !payload?.googleOAuth?.connected)} className="rounded-md border border-foreground/10 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60">{testing ? "Testing..." : "Test"}</button>
                <button type="button" onClick={() => void saveProvider()} disabled={saving || (vendorTab === "google" && !payload?.googleOAuth?.connected)} className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 disabled:opacity-60"><Plus className="h-3 w-3" /> {saving ? "Saving..." : "Save Provider"}</button>
              </div>
            </div>
        )}

        
      </SectionBody>
    </SectionLayout>
  );
}
