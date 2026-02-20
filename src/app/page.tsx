"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { DashboardView } from "@/components/dashboard-view";
import { TasksView } from "@/components/tasks-view";
import { CronView } from "@/components/cron-view";
import { SessionsView } from "@/components/sessions-view";
import { ChannelsView } from "@/components/channels-view";
import { MemoryView } from "@/components/memory-view";
import { DocsView } from "@/components/docs-view";
import { ConfigEditor } from "@/components/config-editor";
import { SkillsView } from "@/components/skills-view";
import { ChatView } from "@/components/chat-view";
import { LogsView } from "@/components/logs-view";
import { ModelsView } from "@/components/models-view";
import { AudioView } from "@/components/audio-view";
import { VectorView } from "@/components/vector-view";
import { AgentsView } from "@/components/agents-view";
import { UsageView } from "@/components/usage-view";
import { TerminalView } from "@/components/terminal-view";
import { PermissionsView } from "@/components/permissions-view";
import { TailscaleView } from "@/components/tailscale-view";
import { BrowserRelayView } from "@/components/browser-relay-view";
import { AccountsKeysView } from "@/components/accounts-keys-view";
import { CalendarView } from "@/components/calendar-view";
import { WebSearchView } from "@/components/web-search-view";
import { OpenClawUpdateBanner } from "@/components/openclaw-update-banner";
import { setChatActive } from "@/lib/chat-store";

function SectionContent({ section }: { section: string }) {
  switch (section) {
    case "dashboard":
      return <DashboardView />;
    case "agents":
      return <AgentsView />;
    case "tasks":
      return <TasksView />;
    case "cron":
      return <CronView />;
    case "sessions":
      return <SessionsView />;
    case "channels":
      return <ChannelsView />;
    case "system":
      // Backward-compat alias for older links/bookmarks.
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
      return <CalendarView />;
    case "search":
      return <WebSearchView />;
    default:
      return <DashboardView />;
  }
}

function MainContent() {
  const searchParams = useSearchParams();
  const section = searchParams.get("section") || "dashboard";
  const isChatSection = section === "chat";

  // Track chat tab visibility for notification system
  useEffect(() => {
    setChatActive(isChatSection);
    return () => setChatActive(false);
  }, [isChatSection]);

  return (
    <>
      {/*
       * ChatView is ALWAYS mounted so chat state persists across tab switches.
       * When not on the chat tab, it's hidden via CSS (not unmounted).
       */}
      <div
        className={isChatSection ? "flex flex-1 flex-col overflow-hidden" : "hidden"}
      >
        <ChatView isVisible={isChatSection} />
      </div>

      {/* All other views: update banner + section content */}
      {!isChatSection && (
        <>
          <OpenClawUpdateBanner />
          <SectionContent section={section} />
        </>
      )}
    </>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
          Loading...
        </div>
      }
    >
      <MainContent />
    </Suspense>
  );
}
