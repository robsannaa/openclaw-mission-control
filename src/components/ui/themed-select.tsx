"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

type ThemedSelectProps = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  className?: string;
  menuClassName?: string;
  size?: "regular" | "compact";
};

export function ThemedSelect({
  value,
  options,
  onChange,
  className,
  menuClassName,
  size = "regular",
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between rounded-lg border border-foreground/15 bg-muted/70 text-foreground shadow-inner outline-none transition-colors hover:bg-background/85 focus:border-sky-300/45",
          size === "compact" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{active?.label || ""}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/80" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-foreground/10 bg-card p-1 shadow-xl",
            menuClassName
          )}
          role="listbox"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                option.value === value
                  ? "bg-sky-300/20 text-sky-100"
                  : "text-foreground/85 hover:bg-sky-300/15"
              )}
              role="option"
              aria-selected={option.value === value}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
