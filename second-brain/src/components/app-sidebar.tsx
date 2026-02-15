"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  FileText,
  CheckSquare,
  Crown,
  Calendar,
  Briefcase,
  Brain,
  FolderOpen,
  Users,
  Building2,
  UserCircle,
} from "lucide-react";

const navItems: { section: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { section: "tasks", label: "Tasks", icon: LayoutGrid },
  { section: "content", label: "Content", icon: FileText },
  { section: "approvals", label: "Approvals", icon: CheckSquare },
  { section: "council", label: "Council", icon: Crown },
  { section: "calendar", label: "Calendar", icon: Calendar },
  { section: "projects", label: "Projects", icon: Briefcase },
  { section: "memory", label: "Memory", icon: Brain },
  { section: "docs", label: "Docs", icon: FolderOpen },
  { section: "people", label: "People", icon: Users },
  { section: "office", label: "Office", icon: Building2 },
  { section: "team", label: "Team", icon: UserCircle },
];

export function AppSidebar() {
  const searchParams = useSearchParams();
  const section = searchParams.get("section") || "tasks";

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-white/10 bg-zinc-950">
      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={"/?section=" + item.section}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                section === item.section
                  ? "bg-violet-600/20 text-violet-300"
                  : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-2xl font-bold text-violet-400">
          N
        </div>
      </div>
    </aside>
  );
}
