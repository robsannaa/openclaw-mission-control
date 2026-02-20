"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bug,
  CheckCircle2,
  CircleX,
  Copy,
  ExternalLink,
  Globe,
  Play,
  Plug,
  RefreshCw,
  RotateCw,
  Square,
} from "lucide-react";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";

type RelaySnapshot = {
  status: {
    enabled?: boolean;
    profile?: string;
    running?: boolean;
    cdpReady?: boolean;
    cdpHttp?: boolean;
    cdpPort?: number;
    cdpUrl?: string;
    detectedBrowser?: string | null;
    detectedExecutablePath?: string | null;
    detectError?: string | null;
    attachOnly?: boolean;
    color?: string;
  } | null;
  profiles?: Array<{
    name: string;
    cdpPort?: number;
    cdpUrl?: string;
    color?: string;
    running?: boolean;
    tabCount?: number;
    isDefault?: boolean;
    isRemote?: boolean;
  }>;
  tabs?: Array<Record<string, unknown>>;
  extension: {
    path: string | null;
    resolvedPath: string | null;
    manifestPath: string | null;
    installed: boolean;
    manifestName: string | null;
    manifestVersion: string | null;
    error: string | null;
  };
  health: {
    installed: boolean;
    running: boolean;
    cdpReady: boolean;
    tabConnected: boolean;
    relayReady: boolean;
  };
  errors: {
    status: string | null;
    profiles: string | null;
    tabs: string | null;
  };
};

type RelayGetResponse = {
  ok: boolean;
  profile?: string | null;
  snapshot?: RelaySnapshot;
  docsUrl?: string;
  error?: string;
};

type RelayPostResponse = {
  ok: boolean;
  action?: string;
  result?: Record<string, unknown>;
  snapshot?: RelaySnapshot;
  error?: string;
};

function formatObject(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function statusPill(label: string, ok: boolean) {
  return (
    <span
      className={
        ok
          ? "inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300"
          : "inline-flex items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-1 text-xs text-zinc-300"
      }
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

export function BrowserRelayView() {
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<RelaySnapshot | null>(null);
  const [profile, setProfile] = useState<string>("");
  const [docsUrl, setDocsUrl] = useState(
    "https://docs.openclaw.ai/tools/browser#chrome-extension-relay-use-your-existing-chrome"
  );
  const [testUrl, setTestUrl] = useState("https://example.com");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionOutput, setActionOutput] = useState("");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const qs = profile ? `?profile=${encodeURIComponent(profile)}` : "";
        const res = await fetch(`/api/browser/relay${qs}`, { cache: "no-store" });
        const data = (await res.json()) as RelayGetResponse;
        if (!res.ok || !data.ok || !data.snapshot) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setSnapshot(data.snapshot);
        if (data.docsUrl) setDocsUrl(data.docsUrl);

        const statusProfile = (data.snapshot.status?.profile || "").trim();
        if (!profile && statusProfile) {
          setProfile(statusProfile);
          return;
        }
        if (!profile && !statusProfile && (data.snapshot.profiles || []).length > 0) {
          const first = data.snapshot.profiles?.[0]?.name || "";
          if (first) setProfile(first);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [profile]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 10000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const runAction = useCallback(
    async (action: string, payload?: Record<string, unknown>) => {
      setActionBusy(action);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/browser/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            profile: profile || null,
            ...(payload || {}),
          }),
        });
        const data = (await res.json()) as RelayPostResponse;
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (data.snapshot) setSnapshot(data.snapshot);
        setActionOutput(formatObject(data.result || ""));
        setNotice(`Action "${action}" completed.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActionBusy(null);
      }
    },
    [profile]
  );

  const copyPath = useCallback(async () => {
    const path = snapshot?.extension?.resolvedPath || snapshot?.extension?.path || "";
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setNotice("Extension path copied to clipboard.");
    } catch {
      setError("Failed to copy extension path.");
    }
  }, [snapshot]);

  const activeTabs = snapshot?.tabs || [];
  const selectedProfile = profile || snapshot?.status?.profile || "";
  const topIssues = useMemo(() => {
    const issues: string[] = [];
    if (!snapshot) return issues;
    if (!snapshot.extension.installed) {
      issues.push("Extension is not installed. Run Install Extension and load unpacked in Chrome.");
    }
    if (!snapshot.health.running) {
      issues.push("Relay is not attached to a tab. Click the OpenClaw extension icon on an active tab.");
    }
    if (!snapshot.health.cdpReady) {
      issues.push("CDP is not ready. Check Chrome launch flags and profile settings.");
    }
    if (!snapshot.health.tabConnected) {
      issues.push("No connected tabs detected for this profile.");
    }
    if (snapshot.errors.status) issues.push(`Status error: ${snapshot.errors.status}`);
    if (snapshot.errors.tabs) issues.push(`Tabs error: ${snapshot.errors.tabs}`);
    if (snapshot.extension.error) issues.push(`Extension error: ${snapshot.extension.error}`);
    return issues.slice(0, 4);
  }, [snapshot]);

  return (
    <SectionLayout>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2 text-sm">
            <Globe className="h-4 w-4" />
            Browser Relay
          </span>
        }
        description="Debug Chrome extension relay connectivity and run browser control actions."
        descriptionClassName="text-sm text-muted-foreground"
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
            disabled={loading || actionBusy !== null}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      <SectionBody width="narrow" className="space-y-4">
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Relay health</p>
            <div className="flex flex-wrap gap-2">
              {loading && !snapshot ? (
                <>
                  <span className="h-6 w-24 animate-pulse rounded-full bg-muted" />
                  <span className="h-6 w-24 animate-pulse rounded-full bg-muted" />
                </>
              ) : (
                <>
                  {statusPill("Extension", Boolean(snapshot?.health.installed))}
                  {statusPill("Running", Boolean(snapshot?.health.running))}
                  {statusPill("CDP Ready", Boolean(snapshot?.health.cdpReady))}
                  {statusPill("Tab Connected", Boolean(snapshot?.health.tabConnected))}
                  {statusPill("Relay Ready", Boolean(snapshot?.health.relayReady))}
                </>
              )}
            </div>
          </div>

          {loading && !snapshot ? (
            <div className="space-y-2">
              <div className="h-4 w-64 animate-pulse rounded bg-muted" />
              <div className="h-4 w-56 animate-pulse rounded bg-muted" />
              <div className="h-4 w-60 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Profile: <code>{selectedProfile || "default"}</code></p>
              <p>CDP URL: <code>{snapshot?.status?.cdpUrl || "unknown"}</code></p>
              <p>Browser: <code>{snapshot?.status?.detectedBrowser || "unknown"}</code></p>
              <p>Executable: <code>{snapshot?.status?.detectedExecutablePath || "unknown"}</code></p>
              <p>Attach-only mode: <code>{snapshot?.status?.attachOnly ? "yes" : "no"}</code></p>
              <p>Connected tabs: <code>{activeTabs.length}</code></p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Extension</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runAction("install-extension")}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                disabled={loading || actionBusy !== null}
              >
                {actionBusy === "install-extension" ? "Installing..." : "Install / Repair"}
              </button>
              <button
                type="button"
                onClick={() => void copyPath()}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
                disabled={loading || !snapshot?.extension.path}
              >
                <Copy className="h-3 w-3" />
                Copy Path
              </button>
              <a
                href={docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Docs <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Path: <code>{snapshot?.extension.path || "unknown"}</code></p>
            <p>Resolved path: <code>{snapshot?.extension.resolvedPath || "unknown"}</code></p>
            <p>Manifest: <code>{snapshot?.extension.manifestName || "unknown"}</code> {snapshot?.extension.manifestVersion ? `(${snapshot.extension.manifestVersion})` : ""}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-4">
          <p className="mb-3 text-sm font-medium text-foreground">Controls</p>

          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <label className="space-y-1 md:min-w-56 md:max-w-56">
              <span className="text-xs text-muted-foreground">Profile</span>
              <select
                value={selectedProfile}
                onChange={(e) => setProfile(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                disabled={loading || actionBusy !== null}
              >
                {(snapshot?.profiles || []).map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}{p.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 md:min-w-56 md:max-w-56">
              <span className="text-xs text-muted-foreground">Test URL</span>
              <input
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="https://example.com"
                disabled={loading || actionBusy !== null}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runAction("start")}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              disabled={loading || actionBusy !== null}
            >
              <Play className="h-3.5 w-3.5" /> Start
            </button>
            <button
              type="button"
              onClick={() => void runAction("stop")}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              disabled={loading || actionBusy !== null}
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
            <button
              type="button"
              onClick={() => void runAction("restart")}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              disabled={loading || actionBusy !== null}
            >
              <RotateCw className="h-3.5 w-3.5" /> Restart
            </button>
            <button
              type="button"
              onClick={() => void runAction("open-test-tab", { url: testUrl })}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              disabled={loading || actionBusy !== null}
            >
              <Globe className="h-3.5 w-3.5" /> Open Test Tab
            </button>
            <button
              type="button"
              onClick={() => void runAction("snapshot-test")}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              disabled={loading || actionBusy !== null}
            >
              <Bug className="h-3.5 w-3.5" /> Snapshot Test
            </button>
          </div>

          {actionOutput && (
            <pre className="mt-3 max-h-52 overflow-auto rounded-md border border-border bg-background p-2 text-xs text-muted-foreground">
              {actionOutput}
            </pre>
          )}
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-4">
          <p className="mb-3 text-sm font-medium text-foreground">Connected tabs</p>
          {activeTabs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No connected tabs for this profile.</p>
          ) : (
            <div className="space-y-2">
              {activeTabs.slice(0, 20).map((tab, i) => (
                <div key={`${String(tab.targetId || tab.id || i)}`} className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
                  <p className="font-medium text-foreground">{String(tab.title || tab.url || tab.targetId || "Tab")}</p>
                  <p className="mt-1 text-muted-foreground">{String(tab.url || "")}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {topIssues.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-amber-200">
              <Plug className="h-4 w-4" />
              Quick diagnostics
            </div>
            <ul className="space-y-1 text-xs text-amber-100">
              {topIssues.map((issue, i) => (
                <li key={`${issue}-${i}`}>- {issue}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            {notice}
          </div>
        )}
      </SectionBody>
    </SectionLayout>
  );
}
