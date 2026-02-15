"use client";

import { useTheme } from "next-themes";
import { useEffect, useState, useRef } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Prevent hydration mismatch
  useEffect(() => setMounted(true), []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!mounted) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card">
        <div className="h-3.5 w-3.5" />
      </div>
    );
  }

  const currentTheme = THEMES.find((t) => t.value === theme) || THEMES[2];
  const CurrentIcon = currentTheme.icon;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
          open
            ? "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300"
            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
        aria-label={`Theme: ${currentTheme.label}`}
        title={`Theme: ${currentTheme.label}`}
      >
        <CurrentIcon className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-36 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-2xl backdrop-blur-sm">
          {THEMES.map((t) => {
            const Icon = t.icon;
            const isActive = theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  setTheme(t.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors",
                  isActive
                    ? "bg-violet-500/10 text-violet-600 dark:text-violet-300"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="font-medium">{t.label}</span>
                {isActive && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-400" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
