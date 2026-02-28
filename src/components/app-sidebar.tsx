"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  LayoutGrid,
  Clock,
  Calendar,
  Brain,
  FolderOpen,
  Users,
  Radio,
  Cpu,
  Settings,
} from "lucide-react";

const navItems: { section: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { section: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { section: "tasks", label: "Tasks", icon: LayoutGrid },
  { section: "cron", label: "Cron Jobs", icon: Clock },
  { section: "calendar", label: "Calendar", icon: Calendar },
  { section: "channels", label: "Channels", icon: Radio },
  { section: "memory", label: "Memory", icon: Brain },
  { section: "docs", label: "Docs", icon: FolderOpen },
  { section: "agents", label: "Agents", icon: Users },
  { section: "models", label: "Models", icon: Cpu },
  { section: "config", label: "Config", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const first = (pathname || "/")
    .split("/")
    .filter(Boolean)[0] || "tasks";
  const aliases: Record<string, string> = {
    memories: "memory",
    documents: "docs",
    settings: "config",
  };
  const section = aliases[first] || first;

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-foreground/10 bg-secondary">
      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={"/" + item.section}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                section === item.section
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground/90"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-foreground/10 p-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-sm font-bold text-violet-400">
          N
        </div>
      </div>
    </aside>
  );
}
