"use client";

import { cn } from "@/lib/utils";

type TypingDotsProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE_MAP = {
  sm: {
    wrapper: "gap-0.5",
    dot: "h-1 w-1",
  },
  md: {
    wrapper: "gap-1",
    dot: "h-1.5 w-1.5",
  },
  lg: {
    wrapper: "gap-1.5",
    dot: "h-2 w-2",
  },
} as const;

export function TypingDots({ size = "md", className }: TypingDotsProps) {
  const styles = SIZE_MAP[size];

  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex items-center", styles.wrapper, className)}
    >
      <span
        className={cn("animate-bounce-dot rounded-full bg-current", styles.dot)}
        style={{ animationDelay: "0ms" }}
      />
      <span
        className={cn("animate-bounce-dot rounded-full bg-current", styles.dot)}
        style={{ animationDelay: "150ms" }}
      />
      <span
        className={cn("animate-bounce-dot rounded-full bg-current", styles.dot)}
        style={{ animationDelay: "300ms" }}
      />
    </span>
  );
}
