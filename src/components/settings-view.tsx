"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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

/* ── Component ────────────────────────────────────── */

export function SettingsView() {
  const [onboard, setOnboard] = useState<OnboardData | null>(null);
  const [system, setSystem] = useState<SystemData | null>(null);
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

  useEffect(() => {
    Promise.all([
      fetch("/api/onboard", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/system", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]).then(([onboardRes, systemRes]) => {
      setOnboard(onboardRes);
      setSystem(systemRes);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <SectionLayout>
        <SectionHeader title="Settings" />
        <LoadingState label="Loading settings..." />
      </SectionLayout>
    );
  }

  const gw = system?.gateway;

  return (
    <SectionLayout>
      <SectionHeader
        title="Settings"
        description="Manage preferences, gateway configuration, and diagnostics."
      />
      <SectionBody width="content" padding="regular" innerClassName="space-y-4 pb-8">
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
              <div className="inline-flex rounded-lg border border-foreground/10 bg-card/70 p-0.5">
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
                          ? "bg-violet-500/20 text-violet-300"
                          : "text-muted-foreground/70 hover:text-foreground/80",
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
