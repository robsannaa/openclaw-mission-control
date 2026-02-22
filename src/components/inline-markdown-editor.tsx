"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/* ── types ────────────────────────────────────────── */

type Props = {
  /** The markdown source string */
  content: string;
  /** Called with the new markdown string when content changes (debounced) */
  onContentChange: (markdown: string) => void;
  /** Called once on blur after final save */
  onBlur?: () => void;
  /** Called on Cmd+S — receives current markdown; return value ignored */
  onSave?: (markdown: string) => void;
  /** Extra classes for the container */
  className?: string;
  /** Placeholder when content is empty */
  placeholder?: string;
};

/* ── Preview styling (matches MarkdownContent / docs) ── */

const previewComponents = {
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<"h1">) => (
    <h1 className="mb-3 mt-6 text-base font-semibold text-foreground first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<"h2">) => (
    <h2 className="mb-2 mt-5 text-sm font-semibold text-violet-600 dark:text-violet-400 first:mt-0" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<"h3">) => (
    <h3 className="mb-2 mt-4 text-sm font-semibold text-foreground/90 first:mt-0" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }: React.ComponentPropsWithoutRef<"h4">) => (
    <h4 className="mb-1.5 mt-3 text-sm font-medium text-foreground/70 first:mt-0" {...props}>
      {children}
    </h4>
  ),
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<"p">) => (
    <p className="mb-2 text-sm leading-relaxed text-muted-foreground" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<"ul">) => (
    <ul className="my-2 list-inside list-disc space-y-1 pl-4 text-muted-foreground" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<"ol">) => (
    <ol className="my-2 list-inside list-decimal space-y-1 pl-4 text-muted-foreground" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: React.ComponentPropsWithoutRef<"li">) => (
    <li className="text-sm text-muted-foreground" {...props}>
      {children}
    </li>
  ),
  code: ({ children, ...props }: React.ComponentPropsWithoutRef<"code">) => (
    <code
      className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-xs text-foreground/80"
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<"pre">) => (
    <pre
      className="my-3 overflow-x-auto rounded-lg bg-foreground/[0.04] p-3 text-xs text-foreground/80"
      {...props}
    >
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      className="my-2 border-l-2 border-violet-500/40 pl-4 italic text-muted-foreground"
      {...props}
    >
      {children}
    </blockquote>
  ),
  a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<"a">) => (
    <a
      href={href}
      className="text-violet-600 dark:text-violet-400 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<"table">) => (
    <div className="my-3 overflow-x-auto">
      <table className="min-w-full border-collapse border border-foreground/10 text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.ComponentPropsWithoutRef<"th">) => (
    <th className="border border-foreground/10 bg-foreground/[0.04] px-3 py-2 text-left text-sm font-medium" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.ComponentPropsWithoutRef<"td">) => (
    <td className="border border-foreground/10 px-3 py-2 text-sm text-muted-foreground" {...props}>
      {children}
    </td>
  ),
  hr: (props: React.ComponentPropsWithoutRef<"hr">) => <hr className="my-4 border-foreground/10" {...props} />,
  strong: ({ children, ...props }: React.ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold text-foreground/90" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }: React.ComponentPropsWithoutRef<"em">) => (
    <em className="italic text-foreground/80" {...props}>
      {children}
    </em>
  ),
};

/* ── component ───────────────────────────────────── */

export function InlineMarkdownEditor({
  content,
  onContentChange,
  onBlur,
  onSave,
  className,
  placeholder = "Write your markdown here…",
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localValue, setLocalValue] = useState(content);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef(content);

  // Sync local value when content prop changes (e.g. load new doc)
  useEffect(() => {
    if (content !== lastEmittedRef.current) {
      lastEmittedRef.current = content;
      setLocalValue(content);
    }
  }, [content]);

  const emitChange = useCallback(
    (md: string) => {
      if (md === lastEmittedRef.current) return;
      lastEmittedRef.current = md;
      onContentChange(md);
    },
    [onContentChange]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setLocalValue(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => emitChange(value), 400);
    },
    [emitChange]
  );

  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (lastEmittedRef.current !== localValue) {
      lastEmittedRef.current = localValue;
      onContentChange(localValue);
    }
    onBlur?.();
  }, [localValue, onContentChange, onBlur]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        textareaRef.current?.blur();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (lastEmittedRef.current !== localValue) {
          lastEmittedRef.current = localValue;
          onContentChange(localValue);
        }
        onSave?.(localValue);
      }
    },
    [localValue, onContentChange, onSave]
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] overflow-hidden",
        className
      )}
    >
      <textarea
        ref={textareaRef}
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        spellCheck={true}
        className={cn(
          "min-h-[12rem] w-full resize-y rounded-none border-0 bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50",
          "focus:outline-none focus:ring-0",
          "font-mono leading-relaxed caret-violet-500"
        )}
        aria-label="Markdown editor"
      />
      <div className="border-t border-foreground/[0.06] bg-card/30 px-4 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Preview
        </p>
        <div className="min-h-[6rem] overflow-y-auto text-left">
          {localValue.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={previewComponents}>
              {localValue}
            </ReactMarkdown>
          ) : (
            <p className="text-sm italic text-muted-foreground/50">Nothing to preview yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
