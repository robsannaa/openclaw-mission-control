"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SectionWidth = "full" | "wide" | "content" | "narrow";
export type SectionPadding = "none" | "compact" | "regular" | "roomy";

const SECTION_WIDTH_CLASS: Record<SectionWidth, string> = {
  full: "w-full",
  wide: "mx-auto w-full max-w-7xl",
  content: "mx-auto w-full max-w-6xl",
  narrow: "mx-auto w-full max-w-5xl",
};

const SECTION_PADDING_CLASS: Record<SectionPadding, string> = {
  none: "",
  compact: "px-4 py-4 md:px-6",
  regular: "px-4 py-5 md:px-6",
  roomy: "px-4 py-6 md:px-6",
};

type SectionLayoutProps = {
  children: ReactNode;
  className?: string;
};

export function SectionLayout({ children, className }: SectionLayoutProps) {
  return <div className={cn("flex flex-1 flex-col overflow-hidden", className)}>{children}</div>;
}

type SectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  metaClassName?: string;
  actionsClassName?: string;
  bordered?: boolean;
};

export function SectionHeader({
  title,
  description,
  meta,
  actions,
  className,
  titleClassName,
  descriptionClassName,
  metaClassName,
  actionsClassName,
  bordered = true,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "shrink-0 px-4 py-4 md:px-6",
        bordered && "border-b border-border/60",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={cn("text-xs font-semibold text-foreground", titleClassName)}>{title}</h1>
          {description ? (
            <p className={cn("mt-0.5 text-muted-foreground", descriptionClassName ?? "text-sm")}>{description}</p>
          ) : null}
          {meta ? <p className={cn("mt-1 text-xs text-muted-foreground/80", metaClassName)}>{meta}</p> : null}
        </div>
        {actions ? <div className={cn("flex shrink-0 items-center gap-2", actionsClassName)}>{actions}</div> : null}
      </div>
    </div>
  );
}

type SectionBodyProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  width?: SectionWidth;
  padding?: SectionPadding;
};

export function SectionBody({
  children,
  className,
  innerClassName,
  width = "wide",
  padding = "regular",
}: SectionBodyProps) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", SECTION_PADDING_CLASS[padding], className)}>
      <div className={cn(SECTION_WIDTH_CLASS[width], innerClassName)}>{children}</div>
    </div>
  );
}
