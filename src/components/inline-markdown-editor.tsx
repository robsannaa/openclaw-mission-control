"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { marked } from "marked";
import TurndownService from "turndown";
import { cn } from "@/lib/utils";

/* ── configure marked (markdown → HTML) ──────────── */
marked.setOptions({ gfm: true, breaks: true });

/* ── configure turndown (HTML → markdown) ────────── */
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});
// Keep table HTML as markdown tables
turndown.addRule("tableCell", {
  filter: ["th", "td"],
  replacement: (content) => ` ${content.trim()} |`,
});
turndown.addRule("tableRow", {
  filter: "tr",
  replacement: (content) => `|${content}\n`,
});
turndown.addRule("table", {
  filter: "table",
  replacement: (_content, node) => {
    const rows = Array.from((node as HTMLTableElement).rows);
    if (rows.length === 0) return "";
    const lines: string[] = [];
    rows.forEach((row, i) => {
      const cells = Array.from(row.cells).map((c) => c.textContent?.trim() || "");
      lines.push("| " + cells.join(" | ") + " |");
      if (i === 0) {
        lines.push("| " + cells.map(() => "---").join(" | ") + " |");
      }
    });
    return "\n" + lines.join("\n") + "\n";
  },
});
// Strikethrough
turndown.addRule("strikethrough", {
  filter: ["del", "s"],
  replacement: (content) => `~~${content}~~`,
});

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

/* ── component ───────────────────────────────────── */

export function InlineMarkdownEditor({
  content,
  onContentChange,
  onBlur,
  onSave,
  className,
  placeholder = "Click to start writing...",
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isEditingRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedMd = useRef(content);

  /* Convert markdown → HTML and set innerHTML when content prop changes
     (but NOT while the user is actively editing) */
  useEffect(() => {
    if (isEditingRef.current || !editorRef.current) return;
    const html = marked.parse(content, { async: false }) as string;
    editorRef.current.innerHTML = html || `<p class="empty-placeholder">${placeholder}</p>`;
    lastSavedMd.current = content;
  }, [content, placeholder]);

  /* Focus handler — just update visual state */
  const handleFocus = useCallback(() => {
    setIsFocused(true);
    isEditingRef.current = true;
    // If content is empty/placeholder, clear it for typing
    if (editorRef.current) {
      const ph = editorRef.current.querySelector(".empty-placeholder");
      if (ph) {
        editorRef.current.innerHTML = "";
      }
    }
  }, []);

  /* Input handler — debounced markdown conversion + save */
  const handleInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!editorRef.current) return;
      const html = editorRef.current.innerHTML;
      if (!html || html === "<br>" || html === "<div><br></div>") {
        if (lastSavedMd.current !== "") {
          lastSavedMd.current = "";
          onContentChange("");
        }
        return;
      }
      const md = turndown.turndown(html);
      if (md !== lastSavedMd.current) {
        lastSavedMd.current = md;
        onContentChange(md);
      }
    }, 1200);
  }, [onContentChange]);

  /* Blur handler — final save */
  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      const isEmpty = !html || html === "<br>" || html === "<div><br></div>";
      const md = isEmpty ? "" : turndown.turndown(html);
      if (md !== lastSavedMd.current) {
        lastSavedMd.current = md;
        onContentChange(md);
      }
    }
    setIsFocused(false);
    isEditingRef.current = false;
    onBlur?.();
  }, [onContentChange, onBlur]);

  /* Keyboard shortcuts */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        editorRef.current?.blur();
        return;
      }
      // Cmd+S / Ctrl+S — flush and save immediately
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        e.stopPropagation();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!editorRef.current) return;
        const html = editorRef.current.innerHTML;
        const isEmpty = !html || html === "<br>" || html === "<div><br></div>";
        const md = isEmpty ? "" : turndown.turndown(html);
        if (md !== lastSavedMd.current) {
          lastSavedMd.current = md;
          onContentChange(md);
        }
        onSave?.(md);
        return;
      }
    },
    [onContentChange, onSave]
  );

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onFocus={handleFocus}
      onBlur={handleBlur}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="textbox"
      aria-label="Markdown editor"
      className={cn(
        "md-editor min-h-[200px] rounded-lg px-4 py-3 outline-none transition-all",
        isFocused
          ? "ring-1 ring-violet-500/20 bg-card/60"
          : "hover:bg-muted/30 cursor-text",
        className
      )}
    />
  );
}
