import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type ApiWarningBadgeProps = {
  warning?: string | null;
  degraded?: boolean;
  className?: string;
};

export function ApiWarningBadge({ warning, degraded = false, className }: ApiWarningBadgeProps) {
  const text = typeof warning === "string" ? warning.trim() : "";
  if (!degraded && !text) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300",
        className
      )}
      title={text || "Some data could not be loaded. Showing fallback values."}
    >
      <AlertTriangle className="h-3 w-3" />
      Degraded
    </span>
  );
}
