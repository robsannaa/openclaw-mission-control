"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  SlidersHorizontal,
  Radio,
  Bell,
  Info,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  ExternalLink,
  Trash2,
  RotateCcw,
  Check,
  Clock,
  Globe,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SectionBody,
  SectionHeader,
  SectionLayout,
} from "@/components/section-layout";
import { LoadingState } from "@/components/ui/loading-state";
import {
  setAutoRestartOnChanges,
  subscribeAutoRestartPreference,
  getAutoRestartSnapshot,
  getAutoRestartServerSnapshot,
} from "@/lib/auto-restart-preference";
import { chatStore } from "@/lib/chat-store";

/* ── Types ────────────────────────────────────────── */

type OnboardData = {
  installed: boolean;
  configured: boolean;
  version: string | null;
  gatewayUrl: string;
  home: string;
};

type SystemGateway = {
  port?: number | string;
  mode?: string;
  version?: string;
  authMode?: "token" | "password";
  tokenConfigured?: boolean;
  allowTailscale?: boolean;
};

type SystemData = {
  gateway?: SystemGateway;
  stats?: Record<string, number>;
};

type SettingsData = {
  timezone: string;
  configHash: string;
};

type ResetScope = "config" | "credentials" | "sessions" | "all";

/* ── Timezone list ───────────────────────────────── */

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "Pacific/Auckland",
  "UTC",
];

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/* ── Component ────────────────────────────────────── */

export function SettingsView() {
  const [onboard, setOnboard] = useState<OnboardData | null>(null);
  const [system, setSystem] = useState<SystemData | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Theme — hydration-safe
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Auto-restart preference from existing store
  const autoRestart = useSyncExternalStore(
    subscribeAutoRestartPreference,
    getAutoRestartSnapshot,
    getAutoRestartServerSnapshot,
  );

  // Banner reset feedback
  const [bannerReset, setBannerReset] = useState(false);

  // Chat clear feedback
  const [chatCleared, setChatCleared] = useState(false);

  // Notification permission
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setNotifPerm(Notification.permission);
    }
  }, []);

  // Timezone state
  const [tzSearch, setTzSearch] = useState("");
  const [tzSaving, setTzSaving] = useState(false);
  const [tzSaved, setTzSaved] = useState(false);
  const [tzDropdownOpen, setTzDropdownOpen] = useState(false);
  const [selectedTz, setSelectedTz] = useState("");

  // Reset state
  const [resetScope, setResetScope] = useState<ResetScope | null>(null);
  const [resetPreview, setResetPreview] = useState<string | null>(null);
  const [resetPreviewLoading, setResetPreviewLoading] = useState(false);
  const [resetExecuting, setResetExecuting] = useState(false);
  const [resetResult, setResetResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Gateway restart
  const [restarting, setRestarting] = useState(false);
  const [restartResult, setRestartResult] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "ok" | "err" } | null>(null);
  const showToast = useCallback((message: string, type: "ok" | "err") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/onboard", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/system", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]).then(([onboardRes, systemRes, settingsRes]) => {
      setOnboard(onboardRes);
      setSystem(systemRes);
      setSettings(settingsRes);
      if (settingsRes?.timezone) {
        setSelectedTz(settingsRes.timezone);
      } else {
        setSelectedTz(getLocalTimezone());
      }
      setLoading(false);
    });
  }, []);

  // Timezone save handler
  const handleSaveTimezone = useCallback(async (tz: string) => {
    setTzSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-timezone", timezone: tz }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSelectedTz(tz);
      setTzSaved(true);
      showToast(`Timezone set to ${tz}`, "ok");
      setTimeout(() => setTzSaved(false), 2000);
    } catch (err) {
      showToast(`Failed to save timezone: ${err}`, "err");
    } finally {
      setTzSaving(false);
      setTzDropdownOpen(false);
    }
  }, [showToast]);

  // Reset preview handler
  const handleResetPreview = useCallback(async (scope: ResetScope) => {
    setResetScope(scope);
    setResetPreview(null);
    setResetResult(null);
    setResetPreviewLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-preview", scope }),
      });
      const json = await res.json();
      setResetPreview(json.output || "No preview available.");
    } catch (err) {
      setResetPreview(`Error: ${err}`);
    } finally {
      setResetPreviewLoading(false);
    }
  }, []);

  // Reset execute handler
  const handleResetExecute = useCallback(async () => {
    if (!resetScope) return;
    setResetExecuting(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-execute", scope: resetScope }),
      });
      const json = await res.json();
      if (json.ok) {
        setResetResult({ ok: true, message: json.output || "Reset complete." });
        showToast("Reset completed successfully", "ok");
      } else {
        setResetResult({ ok: false, message: json.error || "Reset failed." });
        showToast("Reset failed", "err");
      }
    } catch (err) {
      setResetResult({ ok: false, message: String(err) });
      showToast("Reset failed", "err");
    } finally {
      setResetExecuting(false);
    }
  }, [resetScope, showToast]);

  // Gateway restart handler
  const handleRestartGateway = useCallback(async () => {
    setRestarting(true);
    setRestartResult(null);
    try {
      const res = await fetch("/api/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      const json = await res.json();
      if (json.ok || json.status === "restarting") {
        setRestartResult("Gateway is restarting...");
        showToast("Gateway restart initiated", "ok");
      } else {
        setRestartResult(`Failed: ${json.error || "Unknown error"}`);
        showToast("Gateway restart failed", "err");
      }
    } catch (err) {
      setRestartResult(`Error: ${err}`);
      showToast("Gateway restart failed", "err");
    } finally {
      setRestarting(false);
    }
  }, [showToast]);

  // Filtered timezone list
  const filteredTimezones = tzSearch
    ? COMMON_TIMEZONES.filter((tz) =>
        tz.toLowerCase().includes(tzSearch.toLowerCase()),
      )
    : COMMON_TIMEZONES;

  if (loading) {
    return (
      <SectionLayout>
        <SectionHeader title="Settings" />
        <LoadingState label="Loading settings..." />
      </SectionLayout>
    );
  }

  const gw = system?.gateway;
  const localTz = getLocalTimezone();

  return (
    <SectionLayout>
      <SectionHeader
        title={<span className="font-serif font-bold text-base">Settings</span>}
        description="Manage preferences, gateway configuration, and diagnostics."
      />
      <SectionBody width="content" padding="regular" innerClassName="space-y-4 pb-8">
        {/* Toast */}
        {toast && (
          <div
            className={cn(
              "fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-lg transition-all",
              toast.type === "ok"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : "border-red-500/20 bg-red-500/10 text-red-400",
            )}
          >
            {toast.message}
          </div>
        )}

        {/* ── General ──────────────────────────────── */}
        <SettingsSection
          title="General"
          icon={SlidersHorizontal}
          iconColor="text-violet-400"
          defaultOpen
        >
          {/* Theme */}
          <SettingRow
            label="Theme"
            description="Choose light, dark, or follow your system preference."
          >
            {mounted ? (
              <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
                {(
                  [
                    { value: "light", icon: Sun, label: "Light" },
                    { value: "dark", icon: Moon, label: "Dark" },
                    { value: "system", icon: Monitor, label: "System" },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const active = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTheme(opt.value)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        active
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />
            )}
          </SettingRow>

          {/* Timezone */}
          <SettingRow
            label="Timezone"
            description={`Used for scheduling, cron jobs, and time displays. ${selectedTz === localTz ? "Matches your browser." : `Browser: ${localTz}`}`}
          >
            <div className="relative">
              <button
                type="button"
                onClick={() => setTzDropdownOpen(!tzDropdownOpen)}
                disabled={tzSaving}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  tzSaved
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                    : "border-foreground/10 bg-card text-foreground/70 hover:bg-muted/80 hover:text-foreground",
                )}
              >
                {tzSaving ? (
                  <span className="flex items-center gap-1">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                  </span>
                ) : tzSaved ? (
                  <>
                    <Check className="h-3 w-3" />
                    Saved
                  </>
                ) : (
                  <>
                    <Globe className="h-3 w-3" />
                    {selectedTz.replace(/_/g, " ").split("/").pop() || selectedTz}
                  </>
                )}
              </button>

              {tzDropdownOpen && (
                <>
                  {/* Backdrop to close dropdown */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setTzDropdownOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card shadow-lg">
                    <div className="border-b border-border p-2">
                      <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1.5">
                        <Search className="h-3 w-3 text-muted-foreground" />
                        <input
                          type="text"
                          value={tzSearch}
                          onChange={(e) => setTzSearch(e.target.value)}
                          placeholder="Search timezones..."
                          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {/* Auto-detect option */}
                      <button
                        type="button"
                        onClick={() => handleSaveTimezone(localTz)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                          selectedTz === localTz && "text-emerald-400",
                        )}
                      >
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="flex-1">Auto-detect ({localTz.split("/").pop()})</span>
                        {selectedTz === localTz && <Check className="h-3 w-3" />}
                      </button>
                      <div className="my-1 border-t border-border" />
                      {filteredTimezones.map((tz) => (
                        <button
                          key={tz}
                          type="button"
                          onClick={() => handleSaveTimezone(tz)}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                            selectedTz === tz && "text-emerald-400",
                          )}
                        >
                          <span className="flex-1">{tz.replace(/_/g, " ")}</span>
                          {selectedTz === tz && <Check className="h-3 w-3" />}
                        </button>
                      ))}
                      {filteredTimezones.length === 0 && (
                        <p className="px-3 py-2 text-xs text-muted-foreground/50">No matching timezones</p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </SettingRow>

          {/* Auto-restart */}
          <SettingRow
            label="Auto-restart gateway on config changes"
            description="When enabled, the gateway restarts automatically after configuration changes instead of showing a prompt."
          >
            <ToggleSwitch
              checked={autoRestart}
              onChange={setAutoRestartOnChanges}
            />
          </SettingRow>

          {/* Re-run onboarding */}
          <SettingRow
            label="Onboarding wizard"
            description="Re-run the guided setup for model, API key, and channel configuration."
          >
            <Link
              href="/onboard"
              className="flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-card px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Run wizard
            </Link>
          </SettingRow>

          {/* Reset banners */}
          <SettingRow
            label="Dismissed banners"
            description="Restore previously dismissed dashboard banners and hints."
          >
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem("mc-onboard-dismissed");
                setBannerReset(true);
                setTimeout(() => setBannerReset(false), 2000);
              }}
              disabled={bannerReset}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                bannerReset
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                  : "border-foreground/10 bg-card text-foreground/70 hover:bg-muted/80 hover:text-foreground",
              )}
            >
              {bannerReset ? (
                <>
                  <Check className="h-3 w-3" />
                  Reset
                </>
              ) : (
                "Reset banners"
              )}
            </button>
          </SettingRow>
        </SettingsSection>

        {/* ── Gateway ──────────────────────────────── */}
        <SettingsSection
          title="Gateway"
          icon={Radio}
          iconColor="text-emerald-400"
          defaultOpen
        >
          <SettingRow
            label="Gateway URL"
            description="The endpoint where the OpenClaw gateway is accessible."
          >
            <span className="rounded-md bg-muted/50 px-2 py-1 font-mono text-xs text-foreground/70">
              {onboard?.gatewayUrl || "—"}
            </span>
          </SettingRow>

          <SettingRow
            label="Port"
            description="Gateway listening port."
          >
            <span className="font-mono text-xs text-foreground/70">
              {gw?.port || "—"}
            </span>
          </SettingRow>

          <SettingRow
            label="Auth mode"
            description="How the gateway authenticates incoming connections."
          >
            <Badge
              label={gw?.authMode || "Not configured"}
              color={gw?.authMode ? "emerald" : "zinc"}
            />
          </SettingRow>

          <SettingRow
            label="Auth token"
            description={
              gw?.tokenConfigured
                ? "Token is set. Run `openclaw config get gateway.auth.token` to view."
                : "No token configured. Set one in Config > gateway.auth.token."
            }
          >
            <Badge
              label={gw?.tokenConfigured ? "Configured" : "Not set"}
              color={gw?.tokenConfigured ? "emerald" : "amber"}
            />
          </SettingRow>

          <SettingRow
            label="Tailscale"
            description="Whether Tailscale connections are allowed."
          >
            <div className="flex items-center gap-2">
              <Badge
                label={gw?.allowTailscale === false ? "Disabled" : "Allowed"}
                color={gw?.allowTailscale === false ? "zinc" : "emerald"}
              />
              <Link
                href="/tailscale"
                className="text-xs text-violet-400 hover:underline"
              >
                Manage
              </Link>
            </div>
          </SettingRow>

          <SettingRow
            label="Transport mode"
            description="How Mission Control communicates with the gateway."
          >
            <Badge label={gw?.mode || "local"} color="blue" />
          </SettingRow>

          <SettingRow
            label="Restart gateway"
            description="Restart the gateway process. This briefly interrupts active sessions."
          >
            <button
              type="button"
              onClick={handleRestartGateway}
              disabled={restarting}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                restarting
                  ? "border-foreground/10 bg-foreground/5 text-muted-foreground cursor-wait"
                  : restartResult
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                    : "border-amber-500/20 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20",
              )}
            >
              {restarting ? (
                <span className="flex items-center gap-1">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                </span>
              ) : restartResult ? (
                <>
                  <Check className="h-3 w-3" />
                  Restarting
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3" />
                  Restart
                </>
              )}
            </button>
          </SettingRow>
        </SettingsSection>

        {/* ── Notifications & Chat ─────────────────── */}
        <SettingsSection
          title="Notifications & Chat"
          icon={Bell}
          iconColor="text-amber-400"
        >
          <SettingRow
            label="Browser notifications"
            description="Allow Mission Control to send desktop notifications for new messages."
          >
            {notifPerm === "unsupported" ? (
              <Badge label="Unsupported" color="zinc" />
            ) : notifPerm === "granted" ? (
              <Badge label="Enabled" color="emerald" />
            ) : notifPerm === "denied" ? (
              <Badge label="Blocked" color="red" />
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const result = await Notification.requestPermission();
                  setNotifPerm(result);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-card px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-muted/80 hover:text-foreground"
              >
                Request permission
              </button>
            )}
          </SettingRow>

          <SettingRow
            label="Chat history"
            description="Messages are kept locally in your browser. Last 200 messages, 7-day expiry."
          >
            <span className="text-xs text-muted-foreground/60">Browser-only</span>
          </SettingRow>

          <SettingRow
            label="Clear chat history"
            description="Remove all chat messages from local storage."
          >
            <button
              type="button"
              onClick={() => {
                chatStore.clearMessages();
                setChatCleared(true);
                setTimeout(() => setChatCleared(false), 2000);
              }}
              disabled={chatCleared}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                chatCleared
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                  : "border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20",
              )}
            >
              {chatCleared ? (
                <>
                  <Check className="h-3 w-3" />
                  Cleared
                </>
              ) : (
                <>
                  <Trash2 className="h-3 w-3" />
                  Clear history
                </>
              )}
            </button>
          </SettingRow>
        </SettingsSection>

        {/* ── Reset & Maintenance ─────────────────── */}
        <SettingsSection
          title="Reset & Maintenance"
          icon={ShieldAlert}
          iconColor="text-red-400"
        >
          <p className="text-xs text-muted-foreground/60 -mt-1 mb-3">
            Reset different parts of your OpenClaw installation. Each action shows a preview of what will be affected before executing.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  scope: "config" as ResetScope,
                  label: "Reset Configuration",
                  desc: "Restores openclaw.json to defaults. Keeps credentials and sessions.",
                  color: "amber",
                },
                {
                  scope: "credentials" as ResetScope,
                  label: "Reset Credentials",
                  desc: "Removes saved API keys and auth profiles. You'll need to re-enter them.",
                  color: "amber",
                },
                {
                  scope: "sessions" as ResetScope,
                  label: "Clear Sessions",
                  desc: "Removes all session history and JSONL files. Frees disk space.",
                  color: "amber",
                },
                {
                  scope: "all" as ResetScope,
                  label: "Full Reset",
                  desc: "Removes everything: config, credentials, and sessions. Like a fresh install.",
                  color: "red",
                },
              ] as const
            ).map((item) => (
              <button
                key={item.scope}
                type="button"
                onClick={() => handleResetPreview(item.scope)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  resetScope === item.scope
                    ? item.color === "red"
                      ? "border-red-500/30 bg-red-500/5"
                      : "border-amber-500/30 bg-amber-500/5"
                    : "border-foreground/10 hover:bg-foreground/[0.03]",
                )}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className={cn(
                    "h-3.5 w-3.5",
                    item.color === "red" ? "text-red-400" : "text-amber-400",
                  )} />
                  <p className="text-xs font-medium text-foreground/90">{item.label}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground/60">{item.desc}</p>
              </button>
            ))}
          </div>

          {/* Reset preview + confirm */}
          {resetScope && (
            <div className="mt-3 rounded-lg border border-foreground/10 bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold text-foreground/90">
                  {resetScope === "all" ? "Full Reset" : `Reset: ${resetScope}`} — Preview
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setResetScope(null);
                    setResetPreview(null);
                    setResetResult(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>

              {resetPreviewLoading ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-0.5">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                  </span>
                  Running preview...
                </div>
              ) : resetPreview ? (
                <div className="mt-3 max-h-40 overflow-y-auto rounded-md border border-foreground/[0.06] bg-muted/50 p-2.5 font-mono text-xs text-muted-foreground/80 leading-5">
                  {resetPreview.split("\n").map((line, i) => (
                    <div key={i}>{line || "\u00A0"}</div>
                  ))}
                </div>
              ) : null}

              {resetResult ? (
                <div className={cn(
                  "mt-3 rounded-md border p-2.5 text-xs",
                  resetResult.ok
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                    : "border-red-500/20 bg-red-500/10 text-red-400",
                )}>
                  {resetResult.message}
                </div>
              ) : resetPreview && !resetPreviewLoading ? (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleResetExecute}
                    disabled={resetExecuting}
                    className={cn(
                      "rounded-lg border px-4 py-2 text-xs font-medium transition-colors",
                      resetScope === "all"
                        ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20",
                      resetExecuting && "cursor-wait opacity-60",
                    )}
                  >
                    {resetExecuting ? "Executing..." : `Confirm ${resetScope === "all" ? "Full " : ""}Reset`}
                  </button>
                  <p className="text-xs text-muted-foreground/50">This action cannot be undone.</p>
                </div>
              ) : null}
            </div>
          )}
        </SettingsSection>

        {/* ── About & Diagnostics ──────────────────── */}
        <SettingsSection
          title="About & Diagnostics"
          icon={Info}
          iconColor="text-blue-400"
        >
          <SettingRow label="OpenClaw version">
            <span className="font-mono text-xs text-foreground/70">
              {onboard?.version || "—"}
            </span>
          </SettingRow>

          <SettingRow label="Gateway version">
            <span className="font-mono text-xs text-foreground/70">
              {gw?.version || "—"}
            </span>
          </SettingRow>

          <SettingRow label="Home directory">
            <span className="rounded-md bg-muted/50 px-2 py-1 font-mono text-xs text-foreground/70">
              {onboard?.home || "—"}
            </span>
          </SettingRow>

          <div className="flex flex-wrap gap-3 pt-1">
            <a
              href="https://docs.openclaw.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-card px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              Documentation
              <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href="https://github.com/openclaw/mission-control/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-card px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              Report an issue
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </SettingsSection>
      </SectionBody>
    </SectionLayout>
  );
}

/* ── Internal sub-components ─────────────────────── */

function SettingsSection({
  title,
  icon: Icon,
  iconColor,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="glass-subtle rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-foreground/5"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
          <Icon className={cn("h-4 w-4", iconColor)} />
          {title}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-foreground/10 px-4 py-4 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground/80">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground/60">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-violet-500" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "left-4" : "left-0.5",
        )}
      />
    </button>
  );
}

const BADGE_COLORS: Record<string, string> = {
  emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  amber: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  red: "border-red-500/20 bg-red-500/10 text-red-400",
  blue: "border-blue-500/20 bg-blue-500/10 text-blue-400",
  zinc: "border-foreground/10 bg-muted/50 text-muted-foreground",
};

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className={cn(
        "rounded-md border px-2 py-0.5 text-xs font-medium",
        BADGE_COLORS[color] || BADGE_COLORS.zinc,
      )}
    >
      {label}
    </span>
  );
}
