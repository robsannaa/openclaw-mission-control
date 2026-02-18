import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Header, AgentChatPanel } from "@/components/header";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { ThemeProvider } from "@/components/theme-provider";
import { ChatNotificationToast } from "@/components/chat-notification-toast";
import { RestartAnnouncementBar } from "@/components/restart-announcement-bar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mission Control — OpenClaw GUI Dashboard for Local AI Agents",
  description:
    "Mission Control is the open-source OpenClaw GUI and AI agent dashboard. " +
    "Monitor, chat with, and manage your local AI agents, models, cron jobs, " +
    "vector memory, and skills — all from a single local AI management tool " +
    "that runs entirely on your machine.",
  keywords: [
    "OpenClaw GUI",
    "AI agent dashboard",
    "local AI management tool",
    "OpenClaw dashboard",
    "AI agent manager",
    "local AI assistant",
    "OpenClaw Mission Control",
    "self-hosted AI dashboard",
    "AI agent monitoring",
    "open source AI GUI",
    "AI model management",
    "AI cron jobs",
    "vector memory dashboard",
    "LLM management tool",
    "private AI",
  ],
  manifest: "/manifest.json",
  applicationName: "Mission Control",
  authors: [{ name: "OpenClaw" }],
  creator: "OpenClaw",
  publisher: "OpenClaw",
  category: "technology",
  openGraph: {
    type: "website",
    siteName: "Mission Control — OpenClaw GUI",
    title: "Mission Control — The AI Agent Dashboard for OpenClaw",
    description:
      "Monitor, chat with, and manage your local AI agents from one sleek dashboard. " +
      "Open-source, self-hosted, zero cloud. The ultimate OpenClaw GUI.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Mission Control — OpenClaw GUI & AI Agent Dashboard",
    description:
      "Open-source local AI management tool. Monitor agents, models, cron jobs, " +
      "vector memory and more — entirely on your machine.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mission Control",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#7c3aed",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/icons/icon-192.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-mono antialiased`}
      >
        <ThemeProvider>
          <KeyboardShortcuts />
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <Header />
              <RestartAnnouncementBar />
              <main className="flex flex-1 overflow-hidden">
                {children}
              </main>
            </div>
          </div>
          <AgentChatPanel />
          <ChatNotificationToast />
        </ThemeProvider>
      </body>
    </html>
  );
}
