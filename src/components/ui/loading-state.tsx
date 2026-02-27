"use client";

import { cn } from "@/lib/utils";

type LoadingStateProps = {
  label?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
};

const dotSize: Record<NonNullable<LoadingStateProps["size"]>, string> = {
  sm: "h-1 w-1",
  md: "h-1.5 w-1.5",
  lg: "h-2 w-2",
};

export function InlineSpinner({
  className,
  size = "sm",
}: {
  className?: string;
  size?: LoadingStateProps["size"];
}) {
  const dot = dotSize[size || "sm"];
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className={cn(dot, "animate-bounce rounded-full bg-current [animation-delay:0ms]")} />
      <span className={cn(dot, "animate-bounce rounded-full bg-current [animation-delay:150ms]")} />
      <span className={cn(dot, "animate-bounce rounded-full bg-current [animation-delay:300ms]")} />
    </span>
  );
}

export function LoadingState({
  label,
  className,
  size = "md",
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center gap-2.5 text-sm text-muted-foreground/70",
        className
      )}
    >
      <InlineSpinner size={size} />
      {label && <span>{label}</span>}
    </div>
  );
}
