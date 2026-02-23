"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { DashboardView } from "@/components/dashboard-view";
import { ChatView } from "@/components/chat-view";
import { OpenClawUpdateBanner } from "@/components/openclaw-update-banner";
import { setChatActive } from "@/lib/chat-store";

function SectionLoading() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
      Loading...
    </div>
  );
}

const TasksView = dynamic(
  () => import("@/components/tasks-view").then((m) => m.TasksView),
  { loading: () => <SectionLoading /> }
);
const CronView = dynamic(
  () => import("@/components/cron-view").then((m) => m.CronView),
  { loading: () => <SectionLoading /> }
);
const HeartbeatView = dynamic(
  () => import("@/components/heartbeat-view").then((m) => m.HeartbeatView),
  { loading: () => <SectionLoading /> }
);
const SessionsView = dynamic(
  () => import("@/components/sessions-view").then((m) => m.SessionsView),
  { loading: () => <SectionLoading /> }
);
const ChannelsView = dynamic(
  () => import("@/components/channels-view").then((m) => m.ChannelsView),
  { loading: () => <SectionLoading /> }
);
const MemoryView = dynamic(
  () => import("@/components/memory-view").then((m) => m.MemoryView),
  { loading: () => <SectionLoading /> }
);
const DocsView = dynamic(
  () => import("@/components/docs-view").then((m) => m.DocsView),
  { loading: () => <SectionLoading /> }
);
const ConfigEditor = dynamic(
  () => import("@/components/config-editor").then((m) => m.ConfigEditor),
  { loading: () => <SectionLoading /> }
);
const SkillsView = dynamic(
  () => import("@/components/skills-view").then((m) => m.SkillsView),
  { loading: () => <SectionLoading /> }
);
const LogsView = dynamic(
  () => import("@/components/logs-view").then((m) => m.LogsView),
  { loading: () => <SectionLoading /> }
);
const ModelsView = dynamic(
  () => import("@/components/models-view").then((m) => m.ModelsView),
  { loading: () => <SectionLoading /> }
);
const AudioView = dynamic(
  () => import("@/components/audio-view").then((m) => m.AudioView),
  { loading: () => <SectionLoading /> }
);
const VectorView = dynamic(
  () => import("@/components/vector-view").then((m) => m.VectorView),
  { loading: () => <SectionLoading /> }
);
const AgentsView = dynamic(
  () => import("@/components/agents-view").then((m) => m.AgentsView),
  { loading: () => <SectionLoading /> }
);
const UsageView = dynamic(
  () => import("@/components/usage-view").then((m) => m.UsageView),
  { loading: () => <SectionLoading /> }
);
const TerminalView = dynamic(
  () => import("@/components/terminal-view").then((m) => m.TerminalView),
  { loading: () => <SectionLoading /> }
);
const PermissionsView = dynamic(
  () => import("@/components/permissions-view").then((m) => m.PermissionsView),
  { loading: () => <SectionLoading /> }
);
const TailscaleView = dynamic(
  () => import("@/components/tailscale-view").then((m) => m.TailscaleView),
  { loading: () => <SectionLoading /> }
);
const BrowserRelayView = dynamic(
  () => import("@/components/browser-relay-view").then((m) => m.BrowserRelayView),
  { loading: () => <SectionLoading /> }
);
const AccountsKeysView = dynamic(
  () => import("@/components/accounts-keys-view").then((m) => m.AccountsKeysView),
  { loading: () => <SectionLoading /> }
);
const WebSearchView = dynamic(
  () => import("@/components/web-search-view").then((m) => m.WebSearchView),
  { loading: () => <SectionLoading /> }
);
const SettingsView = dynamic(
  () => import("@/components/settings-view").then((m) => m.SettingsView),
  { loading: () => <SectionLoading /> }
);

export type DashboardSection =
  | "dashboard"
  | "chat"
  | "agents"
  | "tasks"
  | "cron"
  | "heartbeat"
  | "sessions"
  | "channels"
  | "system"
  | "memory"
  | "docs"
  | "config"
  | "skills"
  | "models"
  | "accounts"
  | "audio"
  | "vectors"
  | "logs"
  | "usage"
  | "terminal"
  | "permissions"
  | "tailscale"
  | "browser"
  | "calendar"
  | "search"
  | "settings";

function SectionContent({ section }: { section: DashboardSection }) {
  switch (section) {
    case "dashboard":
      return <DashboardView />;
    case "agents":
      return <AgentsView />;
    case "tasks":
      return <TasksView />;
    case "cron":
      return <CronView />;
    case "heartbeat":
      return <HeartbeatView />;
    case "sessions":
      return <SessionsView />;
    case "channels":
      return <ChannelsView />;
    case "system":
      return <ChannelsView />;
    case "memory":
      return <MemoryView />;
    case "docs":
      return <DocsView />;
    case "config":
      return <ConfigEditor />;
    case "skills":
      return <SkillsView />;
    case "models":
      return <ModelsView />;
    case "accounts":
      return <AccountsKeysView />;
    case "audio":
      return <AudioView />;
    case "vectors":
      return <VectorView />;
    case "logs":
      return <LogsView />;
    case "usage":
      return <UsageView />;
    case "terminal":
      return <TerminalView />;
    case "permissions":
      return <PermissionsView />;
    case "tailscale":
      return <TailscaleView />;
    case "browser":
      return <BrowserRelayView />;
    case "calendar":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <p className="text-sm font-medium">Calendar</p>
          <p className="text-xs">Coming soon</p>
        </div>
      );
    case "search":
      return <WebSearchView />;
    case "settings":
      return <SettingsView />;
    default:
      return <DashboardView />;
  }
}

export function RouteSectionView({ section }: { section: DashboardSection }) {
  const isChatSection = section === "chat";

  useEffect(() => {
    setChatActive(isChatSection);
    return () => setChatActive(false);
  }, [isChatSection]);

  return (
    <>
      <div
        className={isChatSection ? "flex flex-1 flex-col overflow-hidden" : "hidden"}
      >
        <ChatView isVisible={isChatSection} />
      </div>

      {!isChatSection && (
        <>
          <OpenClawUpdateBanner />
          <SectionContent section={section} />
        </>
      )}
    </>
  );
}
