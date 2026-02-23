"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";

type AccountsResponse = {
  generatedAt: number;
  configPath: string;
  configHash: string | null;
  sourceOfTruth: {
    gatewayConfig: boolean;
    channelsStatus: boolean;
    modelsStatus: boolean;
  };
  summary: {
    agents: number;
    modelProvidersConnected: number;
    modelProvidersTotal: number;
    authProfiles: number;
    channelAccounts: number;
    channelAccountsRunning: number;
    configEnvKeys: number;
    processEnvKeys: number;
    configSecrets: number;
    discoveredCredentials: number;
    discoveredCredentialServices: number;
  };
  agents: Array<{
    id: string;
    name: string;
    workspace: string | null;
    agentDir: string;
    model: string | null;
    isDefault: boolean;
  }>;
  modelAuthByAgent: Array<{
    agentId: string;
    storePath: string | null;
    shellEnvFallback: { enabled: boolean; appliedKeys: string[] };
    providers: Array<{
      provider: string;
      connected: boolean;
      effectiveKind: string | null;
      effectiveDetail: string | null;
      profileCount: number;
      oauthCount: number;
      tokenCount: number;
      apiKeyCount: number;
      labels: string[];
      envSource: string | null;
      envValue: string | null;
      modelsJsonSource: string | null;
    }>;
    oauthProfiles: Array<{
      profileId: string;
      provider: string;
      type: string;
      status: string;
      source: string;
      label: string;
      expiresAt: number | null;
      remainingMs: number | null;
    }>;
    unusableProfiles: Array<{
      profileId: string;
      provider: string;
      kind: string;
      until: number | null;
      remainingMs: number | null;
    }>;
  }>;
  channels: {
    chat: Record<string, string[]>;
    auth: Array<{ id: string; provider: string; type: string; isExternal: boolean }>;
    accounts: Array<{
      channel: string;
      accountId: string;
      enabled: boolean;
      configured: boolean;
      running: boolean;
      tokenSource: string | null;
      mode: string | null;
      lastError: string | null;
      probeOk: boolean | null;
      botId: string | null;
      botUsername: string | null;
      lastInboundAt: number | null;
      lastOutboundAt: number | null;
      lastProbeAt: number | null;
    }>;
  };
  envCredentials: {
    config: Array<{ key: string; value: string; source: string; redacted: boolean }>;
    process: Array<{ key: string; value: string; source: string; redacted: boolean }>;
  };
  skillCredentials: {
    skills: Array<{
      name: string;
      source: string;
      eligible: boolean;
      disabled: boolean;
      blockedByAllowlist: boolean;
      primaryEnv: string | null;
      requiredEnv: string[];
      missingEnv: string[];
      ready: boolean;
      env: Array<{
        key: string;
        present: boolean;
        source: string | null;
        value: string | null;
        redacted: boolean;
      }>;
    }>;
  };
  discoveredCredentials: {
    summary: {
      total: number;
      services: number;
      highConfidence: number;
    };
    entries: Array<{
      sourcePath: string;
      section: string | null;
      service: string | null;
      key: string;
      value: string;
      redacted: boolean;
      confidence: "high" | "medium";
    }>;
  };
  configSecrets: Array<{
    path: string;
    key: string;
    value: string;
    source: string;
    redacted: boolean;
  }>;
  warnings: string[];
};

type EnvEditorState = {
  editing: boolean;
  show: boolean;
  nextValue: string;
  confirmValue: string;
};

function formatAgo(ts: number | null): string {
  if (!ts) return "n/a";
  const ms = Date.now() - ts;
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function masked(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function renderSecret(value: string, reveal: boolean, alreadyRedacted: boolean): string {
  if (alreadyRedacted) return value;
  return reveal ? value : masked(value);
}

function statusPill(ok: boolean, label: string) {
  return (
    <span
      className={
        ok
          ? "inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300"
          : "inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300"
      }
    >
      {ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldX className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

export function AccountsKeysView() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingEnvKey, setSavingEnvKey] = useState<string | null>(null);
  const [envEditors, setEnvEditors] = useState<Record<string, EnvEditorState>>({});
  const [data, setData] = useState<AccountsResponse | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts", { cache: "no-store" });
      const body = (await res.json()) as AccountsResponse & { error?: string };
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editableConfigEnvRows = useMemo(() => {
    if (!data) return [] as Array<{
      key: string;
      value: string;
      source: string;
      redacted: boolean;
      present: boolean;
    }>;
    const byKey = new Map<
      string,
      {
        key: string;
        value: string;
        source: string;
        redacted: boolean;
        present: boolean;
      }
    >();

    for (const item of data.envCredentials.config) {
      byKey.set(item.key, {
        key: item.key,
        value: item.value,
        source: item.source,
        redacted: item.redacted,
        present: true,
      });
    }

    for (const skill of data.skillCredentials.skills) {
      for (const env of skill.env) {
        if (byKey.has(env.key)) continue;
        byKey.set(env.key, {
          key: env.key,
          value: env.value || "",
          source: env.source || "missing",
          redacted: env.redacted,
          present: env.present,
        });
      }
    }

    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [data]);

  const getEnvEditor = useCallback(
    (key: string): EnvEditorState =>
      envEditors[key] || {
        editing: false,
        show: false,
        nextValue: "",
        confirmValue: "",
      },
    [envEditors]
  );

  const patchEnvEditor = useCallback((key: string, patch: Partial<EnvEditorState>) => {
    setEnvEditors((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {
          editing: false,
          show: false,
          nextValue: "",
          confirmValue: "",
        }),
        ...patch,
      } as EnvEditorState,
    }));
  }, []);

  const startEditEnvKey = useCallback((key: string) => {
    patchEnvEditor(key, { editing: true, nextValue: "", confirmValue: "" });
  }, [patchEnvEditor]);

  const cancelEditEnvKey = useCallback((key: string) => {
    patchEnvEditor(key, {
      editing: false,
      show: false,
      nextValue: "",
      confirmValue: "",
    });
  }, [patchEnvEditor]);

  const saveEnvKey = useCallback(
    async (key: string) => {
      const editor = getEnvEditor(key);
      const nextValue = editor.nextValue.trim();
      if (!nextValue) {
        setError(`New value for ${key} cannot be empty.`);
        return;
      }
      if (editor.nextValue !== editor.confirmValue) {
        setError(`Confirmation does not match for ${key}.`);
        return;
      }

      setSavingEnvKey(key);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update-env-key",
            key,
            value: editor.nextValue,
          }),
        });
        const body = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !body.ok) {
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        cancelEditEnvKey(key);
        setNotice(`Updated ${key}.`);
        await load(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingEnvKey(null);
      }
    },
    [cancelEditEnvKey, getEnvEditor, load]
  );

  return (
    <SectionLayout>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Accounts & Keys
          </span>
        }
        description="Complete visibility into channels, integrations, env keys, and discovered credential sources OpenClaw can access."
        meta={
          data
            ? `Last sync: ${new Date(data.generatedAt).toLocaleString()}`
            : "Loading source-of-truth snapshot…"
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRevealSecrets((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              disabled={!data}
            >
              {revealSecrets ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {revealSecrets ? "Hide Values" : "Reveal Values"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              disabled={busy}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        }
      />

      <SectionBody width="narrow" className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            {notice}
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-3">
            <div className="h-24 animate-pulse rounded-xl border border-border/70 bg-card" />
            <div className="h-48 animate-pulse rounded-xl border border-border/70 bg-card" />
            <div className="h-48 animate-pulse rounded-xl border border-border/70 bg-card" />
          </div>
        ) : null}

        {data ? (
          <>
            <div className="rounded-xl border border-border/70 bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {statusPill(data.sourceOfTruth.gatewayConfig, "Gateway Config")}
                {statusPill(data.sourceOfTruth.channelsStatus, "Channel Runtime")}
                {statusPill(data.sourceOfTruth.modelsStatus, "Model Auth Runtime")}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Agents</p>
                  <p className="mt-1 text-xs font-semibold">{data.summary.agents}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Model Providers Connected</p>
                  <p className="mt-1 text-xs font-semibold">
                    {data.summary.modelProvidersConnected}/{data.summary.modelProvidersTotal}
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Model Auth Profiles</p>
                  <p className="mt-1 text-xs font-semibold">{data.summary.authProfiles}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Channel Accounts Running</p>
                  <p className="mt-1 text-xs font-semibold">
                    {data.summary.channelAccountsRunning}/{data.summary.channelAccounts}
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Config Env Credentials</p>
                  <p className="mt-1 text-xs font-semibold">{data.summary.configEnvKeys}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Process Env Credentials</p>
                  <p className="mt-1 text-xs font-semibold">{data.summary.processEnvKeys}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Discovered External Credentials</p>
                  <p className="mt-1 text-xs font-semibold">
                    {data.summary.discoveredCredentials} ({data.summary.discoveredCredentialServices} services)
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-muted/30 p-3 sm:col-span-2">
                  <p className="text-xs text-muted-foreground">Discovered Config Secrets</p>
                  <p className="mt-1 text-xs font-semibold">{data.summary.configSecrets}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Cpu className="h-4 w-4" />
                  Model Provider Auth
                </h2>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {data.summary.modelProvidersConnected} of {data.summary.modelProvidersTotal} providers connected
                {data.summary.authProfiles > 0 && ` · ${data.summary.authProfiles} auth profiles`}
              </p>
              <a
                href="/models"
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Manage in Models →
              </a>
            </div>

            <div className="rounded-xl border border-border/70 bg-card p-4">
              <h2 className="text-xs font-semibold text-foreground">Channel Accounts</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Logged-in chat accounts, status, and auth source.
              </p>
              <div className="mt-3 space-y-2">
                {data.channels.accounts.map((acct) => (
                  <div
                    key={`${acct.channel}:${acct.accountId}`}
                    className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {acct.channel} / {acct.accountId}
                      </p>
                      <p className={acct.running ? "text-emerald-300" : "text-red-300"}>
                        {acct.running ? "running" : "stopped"}
                      </p>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      configured={String(acct.configured)} enabled={String(acct.enabled)} tokenSource={acct.tokenSource || "n/a"} mode={acct.mode || "n/a"}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      bot={acct.botUsername || "n/a"} ({acct.botId || "n/a"}) · probe={acct.probeOk == null ? "n/a" : String(acct.probeOk)} · inbound={formatAgo(acct.lastInboundAt)} · outbound={formatAgo(acct.lastOutboundAt)}
                    </p>
                    {acct.lastError ? (
                      <p className="mt-1 text-red-300">lastError: {acct.lastError}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-card p-4">
              <h2 className="text-xs font-semibold text-foreground">Discovered Credential Sources</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Generic detection from accessible files/notes/state (not provider hardcoded).
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                entries={data.discoveredCredentials.summary.total} · services={data.discoveredCredentials.summary.services} · high-confidence={data.discoveredCredentials.summary.highConfidence}
              </p>
              <div className="mt-3 space-y-2">
                {data.discoveredCredentials.entries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No additional credential entries discovered.</p>
                ) : null}
                {data.discoveredCredentials.entries.map((entry, idx) => (
                  <div
                    key={`${entry.sourcePath}:${entry.key}:${entry.service || "unknown"}:${idx}`}
                    className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {entry.service || "unknown service"} · {entry.key}
                      </p>
                      <span className={entry.confidence === "high" ? "text-emerald-300" : "text-amber-300"}>
                        {entry.confidence}
                      </span>
                    </div>
                    {entry.section ? (
                      <p className="mt-1 text-muted-foreground">
                        section: <code>{entry.section}</code>
                      </p>
                    ) : null}
                    <p className="mt-1 break-all text-muted-foreground">
                      source: <code>{entry.sourcePath}</code>
                    </p>
                    <p className="mt-1 break-all text-muted-foreground">
                      value: <code>{renderSecret(entry.value, revealSecrets, entry.redacted)}</code>
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-card p-4">
                <h2 className="text-xs font-semibold text-foreground">Config Env Credentials</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Vercel-style edit flow: current value plus double-entry confirmation.
                </p>
                <div className="mt-3 space-y-2">
                  {editableConfigEnvRows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No env credential keys discovered.</p>
                  ) : null}
                  {editableConfigEnvRows.map((item) => {
                    const editor = getEnvEditor(item.key);
                    const saving = savingEnvKey === item.key;
                    return (
                      <div
                        key={item.key}
                        className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-foreground">{item.key}</p>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => patchEnvEditor(item.key, { show: !editor.show })}
                              className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                            >
                              {editor.show ? "Hide" : "Show"}
                            </button>
                            {!editor.editing ? (
                              <button
                                type="button"
                                onClick={() => startEditEnvKey(item.key)}
                                className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                              >
                                {item.present ? "Edit" : "Set"}
                              </button>
                            ) : (
                              <>
                              <button
                                type="button"
                                onClick={() => void saveEnvKey(item.key)}
                                className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                                disabled={saving}
                              >
                                {saving ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelEditEnvKey(item.key)}
                                className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                              >
                                Cancel
                              </button>
                              </>
                            )}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          source: {item.source}
                        </p>
                        <div className="mt-2 space-y-1">
                          <label className="block">
                            <span className="text-xs text-muted-foreground">Current value</span>
                            <input
                              type={revealSecrets || editor.show ? "text" : "password"}
                              readOnly
                              value={
                                item.present
                                  ? renderSecret(
                                      item.value,
                                      revealSecrets || editor.show,
                                      item.redacted
                                    )
                                  : ""
                              }
                              placeholder={item.present ? "" : "Not set"}
                              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-muted-foreground"
                            />
                          </label>
                          {editor.editing && (
                            <>
                              <label className="block">
                                <span className="text-xs text-muted-foreground">New value</span>
                                <input
                                  type={editor.show ? "text" : "password"}
                                  value={editor.nextValue}
                                  onChange={(e) =>
                                    patchEnvEditor(item.key, { nextValue: e.target.value })
                                  }
                                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs"
                                />
                              </label>
                              <label className="block">
                                <span className="text-xs text-muted-foreground">Confirm new value</span>
                                <input
                                  type={editor.show ? "text" : "password"}
                                  value={editor.confirmValue}
                                  onChange={(e) =>
                                    patchEnvEditor(item.key, { confirmValue: e.target.value })
                                  }
                                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs"
                                />
                              </label>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-card p-4">
                <h2 className="text-xs font-semibold text-foreground">Process Env Credentials</h2>
                <div className="mt-3 space-y-1">
                  {data.envCredentials.process.map((item) => (
                    <p key={item.key} className="break-all text-xs text-muted-foreground">
                      <span className="text-foreground">{item.key}</span> ={" "}
                      <code>{renderSecret(item.value, revealSecrets, item.redacted)}</code>
                    </p>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-card p-4">
              <h2 className="text-xs font-semibold text-foreground">Config Secrets (Non-env)</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Credential-like fields discovered in parsed config (excluding <code>env</code>).
              </p>
              <div className="mt-3 max-h-96 space-y-1 overflow-y-auto">
                {data.configSecrets.map((secret) => (
                  <p key={secret.path} className="break-all text-xs text-muted-foreground">
                    <span className="text-foreground">{secret.path}</span> ={" "}
                    <code>{renderSecret(secret.value, revealSecrets, secret.redacted)}</code>
                  </p>
                ))}
              </div>
            </div>

            {data.warnings.length > 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300">
                <div className="mb-2 inline-flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Partial data warnings
                </div>
                {data.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </SectionBody>
    </SectionLayout>
  );
}
