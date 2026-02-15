"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Brain,
  Search,
  ChevronRight,
  ChevronDown,
  Trash2,
  Copy,
  Pencil,
  ClipboardCopy,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineMarkdownEditor } from "./inline-markdown-editor";

type CtxMenuState = { x: number; y: number; entry: DailyEntry } | null;

type DailyEntry = { name: string; date: string; size?: number; words?: number; mtime?: string };
type MemoryMd = { content: string; words: number; size: number; mtime?: string } | null;

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function formatAgo(d?: string) {
  if (!d) return "";
  const now = new Date();
  const diff = now.getTime() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `about ${hours}h ago`;
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

const PERIOD_ORDER = ["Today", "Yesterday", "This Week", "This Month"] as const;

function getPeriodKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "Other";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This Week";
  if (days < 30) return "This Month";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function groupByPeriod(entries: DailyEntry[]): { key: string; entries: DailyEntry[] }[] {
  const groups: Record<string, DailyEntry[]> = {};
  for (const e of entries) {
    const key = getPeriodKey(e.date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }
  const ordered: { key: string; entries: DailyEntry[] }[] = [];
  for (const key of PERIOD_ORDER) {
    if (groups[key]?.length) ordered.push({ key, entries: groups[key] });
  }
  const restKeys = Object.keys(groups).filter(
    (k) => !PERIOD_ORDER.includes(k as (typeof PERIOD_ORDER)[number])
  );
  restKeys.sort((a, b) => {
    const dateA = groups[a]?.[0]?.date ?? "";
    const dateB = groups[b]?.[0]?.date ?? "";
    return dateB.localeCompare(dateA);
  });
  for (const key of restKeys) {
    if (groups[key]?.length) ordered.push({ key, entries: groups[key] });
  }
  return ordered;
}

export function MemoryView() {
  const [daily, setDaily] = useState<DailyEntry[]>([]);
  const [memoryMd, setMemoryMd] = useState<MemoryMd>(null);
  const [selected, setSelected] = useState<"memory" | string | null>("memory");
  const [detailContent, setDetailContent] = useState<string | null>(null);
  const [detailMeta, setDetailMeta] = useState<{
    title: string;
    words?: number;
    size?: number;
    fileKey: "memory" | string;
    mtime?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | null>(null);
  const [collapsedPeriods, setCollapsedPeriods] = useState<Set<string>>(new Set());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitializedCollapse = useRef(false);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState>(null);
  const [renaming, setRenaming] = useState<DailyEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<DailyEntry | null>(null);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const saveContent = useCallback(
    async (content: string) => {
      if (!detailMeta) return;
      setSaveStatus("saving");
      try {
        const body =
          detailMeta.fileKey === "memory"
            ? { content }
            : { file: detailMeta.fileKey, content };
        const res = await fetch("/api/memory", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          setDetailContent(content);
          setDetailMeta((m) =>
            m
              ? {
                  ...m,
                  words: data.words || content.split(/\s+/).filter(Boolean).length,
                  size: data.size || new TextEncoder().encode(content).length,
                }
              : null
          );
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus(null), 2000);
        } else {
          setSaveStatus("unsaved");
        }
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [detailMeta]
  );

  const handleContentChange = useCallback(
    (newMarkdown: string) => {
      setSaveStatus("unsaved");
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveContent(newMarkdown);
      }, 300); // short since editor already debounces
    },
    [saveContent]
  );

  // Cmd+S: flush pending debounce and save immediately
  const handleSave = useCallback(
    (markdown: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveContent(markdown);
    },
    [saveContent]
  );

  // Close context menu on click outside / escape
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ctxMenu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: DailyEntry) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY, entry });
    },
    []
  );

  const deleteEntry = useCallback(
    async (entry: DailyEntry) => {
      try {
        const res = await fetch(
          `/api/memory?file=${encodeURIComponent(entry.name)}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (data.ok) {
          setDaily((prev) => prev.filter((d) => d.name !== entry.name));
          if (selected === entry.name) {
            setSelected("memory");
            setDetailContent(memoryMd?.content ?? null);
            if (memoryMd) {
              setDetailMeta({
                title: "Long-Term Memory",
                words: memoryMd.words,
                size: memoryMd.size,
                fileKey: "memory",
                mtime: memoryMd.mtime,
              });
            }
          }
          setActionMsg({ ok: true, msg: `Deleted ${entry.name}` });
        } else {
          setActionMsg({ ok: false, msg: data.error || "Delete failed" });
        }
      } catch {
        setActionMsg({ ok: false, msg: "Delete failed" });
      }
      setConfirmDelete(null);
      setTimeout(() => setActionMsg(null), 3000);
    },
    [selected, memoryMd]
  );

  const renameEntry = useCallback(
    async (entry: DailyEntry, newName: string) => {
      if (!newName.trim() || newName === entry.name) {
        setRenaming(null);
        return;
      }
      try {
        const res = await fetch("/api/memory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", file: entry.name, newName }),
        });
        const data = await res.json();
        if (data.ok) {
          setDaily((prev) =>
            prev.map((d) =>
              d.name === entry.name ? { ...d, name: data.file } : d
            )
          );
          if (selected === entry.name) {
            setSelected(data.file);
            setDetailMeta((m) => (m ? { ...m, fileKey: data.file, title: data.file } : null));
          }
          setActionMsg({ ok: true, msg: `Renamed to ${data.file}` });
        } else {
          setActionMsg({ ok: false, msg: data.error || "Rename failed" });
        }
      } catch {
        setActionMsg({ ok: false, msg: "Rename failed" });
      }
      setRenaming(null);
      setTimeout(() => setActionMsg(null), 3000);
    },
    [selected]
  );

  const duplicateEntry = useCallback(async (entry: DailyEntry) => {
    try {
      const res = await fetch("/api/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "duplicate", file: entry.name }),
      });
      const data = await res.json();
      if (data.ok) {
        // Refresh to pick up new file
        fetch("/api/memory")
          .then((r) => r.json())
          .then((d) => setDaily(d.daily || []));
        setActionMsg({ ok: true, msg: `Duplicated as ${data.file}` });
      } else {
        setActionMsg({ ok: false, msg: data.error || "Duplicate failed" });
      }
    } catch {
      setActionMsg({ ok: false, msg: "Duplicate failed" });
    }
    setTimeout(() => setActionMsg(null), 3000);
  }, []);

  const copyEntryName = useCallback((entry: DailyEntry) => {
    navigator.clipboard.writeText(entry.name).then(() => {
      setActionMsg({ ok: true, msg: "Filename copied to clipboard" });
      setTimeout(() => setActionMsg(null), 2000);
    });
  }, []);

  useEffect(() => {
    fetch("/api/memory")
      .then((r) => r.json())
      .then((data) => {
        setDaily(data.daily || []);
        setMemoryMd(data.memoryMd || null);
        if (data.memoryMd) {
          setDetailContent(data.memoryMd.content);
          setDetailMeta({
            title: "Long-Term Memory",
            words: data.memoryMd.words,
            size: data.memoryMd.size,
            fileKey: "memory",
            mtime: data.memoryMd.mtime,
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filteredDaily = search
    ? daily.filter(
        (e) =>
          e.date.toLowerCase().includes(search.toLowerCase()) ||
          e.name.toLowerCase().includes(search.toLowerCase())
      )
    : daily;
  const periodGroups = groupByPeriod(filteredDaily);

  const periodGroupKeys = periodGroups.map((g) => g.key).join(",");
  useEffect(() => {
    if (loading || periodGroups.length === 0 || hasInitializedCollapse.current) return;
    hasInitializedCollapse.current = true;
    setCollapsedPeriods((prev) => {
      const next = new Set(prev);
      periodGroups.forEach(({ key }) => {
        if (key !== "Today" && key !== "Yesterday" && key !== "This Week") next.add(key);
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, periodGroupKeys]);

  const loadFile = (file: string, title: string) => {
    // Flush any pending save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSelected(file);
    setSaveStatus(null);
    fetch(`/api/memory?file=${encodeURIComponent(file)}`)
      .then((r) => r.json())
      .then((data) => {
        setDetailContent(data.content);
        setDetailMeta({
          title,
          words: data.words,
          size: data.size,
          fileKey: file,
        });
      })
      .catch(() => {
        setDetailContent("Failed to load.");
        setDetailMeta({ title, fileKey: file });
      });
  };

  const togglePeriod = (key: string) => {
    setCollapsedPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const isExpanded = (key: string) => !collapsedPeriods.has(key);

  return (
    <>
      {/* Left panel: search + memory list */}
      <div className="flex w-[340px] shrink-0 flex-col overflow-hidden border-r border-foreground/[0.06] bg-card/60">
        <div className="shrink-0 p-3">
          <div className="flex items-center gap-2 rounded-lg border border-foreground/[0.08] bg-card px-3 py-2 text-sm text-muted-foreground">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              placeholder="Search memory..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {/* Long-Term Memory card */}
          {memoryMd && (
            <button
              type="button"
              onClick={() => {
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                setSelected("memory");
                setSaveStatus(null);
                setDetailContent(memoryMd.content);
                setDetailMeta({
                  title: "Long-Term Memory",
                  words: memoryMd.words,
                  size: memoryMd.size,
                  fileKey: "memory",
                  mtime: memoryMd.mtime,
                });
              }}
              className={cn(
                "mb-4 flex w-full flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors",
                selected === "memory"
                  ? "border-violet-500/30 bg-violet-500/10 ring-1 ring-violet-400/20"
                  : "border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10"
              )}
            >
              <div className="flex items-center gap-2 text-violet-300">
                <Brain className="h-4 w-4" />
                <span className="text-sm font-medium">Long-Term Memory</span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {memoryMd.words} words &bull; {formatAgo(memoryMd.mtime) || "Updated recently"}
              </span>
            </button>
          )}

          {/* Daily Journal section */}
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Daily Journal
            </span>
            <span className="rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {filteredDaily.length}
            </span>
          </div>

          {loading ? (
            <p className="mt-4 px-1 text-sm text-muted-foreground/60">Loading...</p>
          ) : (
            <div className="mt-2 space-y-0">
              {periodGroups.map(({ key, entries: entriesInGroup }) => {
                const expanded = isExpanded(key);
                return (
                  <div key={key} className="border-b border-foreground/[0.04] last:border-0">
                    <button
                      type="button"
                      onClick={() => togglePeriod(key)}
                      className="flex w-full items-center gap-1.5 py-2 text-left text-[11px] font-medium text-muted-foreground hover:text-muted-foreground"
                    >
                      {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>
                        {key} ({entriesInGroup.length})
                      </span>
                    </button>
                    {expanded && (
                      <div className="space-y-0.5 pb-2 pl-5">
                        {entriesInGroup.map((e) => {
                          const isRenaming = renaming?.name === e.name;
                          const isDeleting = confirmDelete?.name === e.name;

                          if (isDeleting) {
                            return (
                              <div
                                key={e.name}
                                className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-1.5"
                              >
                                <Trash2 className="h-3 w-3 shrink-0 text-red-400" />
                                <span className="flex-1 truncate text-[12px] text-red-300">
                                  Delete {e.name}?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => deleteEntry(e)}
                                  className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-500"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDelete(null)}
                                  className="text-[10px] text-muted-foreground hover:text-foreground/70"
                                >
                                  Cancel
                                </button>
                              </div>
                            );
                          }

                          if (isRenaming) {
                            return (
                              <div
                                key={e.name}
                                className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-card px-3 py-1.5"
                              >
                                <Pencil className="h-3 w-3 shrink-0 text-violet-400" />
                                <input
                                  value={renameValue}
                                  onChange={(ev) =>
                                    setRenameValue(ev.target.value)
                                  }
                                  onKeyDown={(ev) => {
                                    if (ev.key === "Enter")
                                      renameEntry(e, renameValue);
                                    if (ev.key === "Escape")
                                      setRenaming(null);
                                  }}
                                  onBlur={() => renameEntry(e, renameValue)}
                                  className="flex-1 bg-transparent text-[13px] text-foreground/90 outline-none"
                                  autoFocus
                                />
                              </div>
                            );
                          }

                          return (
                            <button
                              key={e.name}
                              type="button"
                              onClick={() => loadFile(e.name, e.date)}
                              onContextMenu={(ev) =>
                                handleContextMenu(ev, e)
                              }
                              className={cn(
                                "flex w-full justify-between rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                                selected === e.name
                                  ? "bg-muted text-violet-300"
                                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground/70"
                              )}
                            >
                              <span className="text-[13px]">
                                {(() => {
                                  const d = new Date(e.date);
                                  return isNaN(d.getTime())
                                    ? e.date
                                    : d.toLocaleDateString("en-US", {
                                        weekday: "short",
                                        month: "short",
                                        day: "numeric",
                                      });
                                })()}
                              </span>
                              <span className="text-[11px] text-muted-foreground/60">
                                {e.words ?? 0}w
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: memory content */}
      <div className="flex flex-1 flex-col overflow-hidden bg-background/40">
        {detailMeta ? (
          <>
            <div className="shrink-0 border-b border-foreground/[0.06] px-6 py-4">
              <div className="flex items-center gap-3">
                <Brain className="h-4 w-4 text-violet-400" />
                <h2 className="text-base font-semibold text-foreground">
                  {detailMeta.title}
                </h2>
                {saveStatus === "saving" && (
                  <span className="text-[11px] text-muted-foreground">Saving...</span>
                )}
                {saveStatus === "saved" && (
                  <span className="text-[11px] text-emerald-500">Saved</span>
                )}
                {saveStatus === "unsaved" && (
                  <span className="text-[11px] text-amber-500">Unsaved</span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground/60">
                {detailMeta.words != null && `${detailMeta.words} words`}
                {detailMeta.size != null && ` \u2022 ${formatBytes(detailMeta.size)}`}
                {" \u2022 Click to edit \u2022 "}
                <kbd className="rounded bg-muted px-1 py-0.5 text-[9px] font-mono text-muted-foreground">
                  &#8984;S
                </kbd>{" "}
                to save
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {detailContent != null ? (
                <InlineMarkdownEditor
                  key={detailMeta?.fileKey || "memory"}
                  content={detailContent}
                  onContentChange={handleContentChange}
                  onSave={handleSave}
                  placeholder="Click to start writing..."
                />
              ) : null}
            </div>
          </>
        ) : !loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
            Select a memory entry
          </div>
        ) : null}
      </div>

      {/* ── Context menu ──────────────────────────── */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-foreground/[0.08] bg-card/95 py-1 shadow-xl backdrop-blur-sm"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 200),
            top: Math.min(ctxMenu.y, window.innerHeight - 220),
          }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => {
              loadFile(ctxMenu.entry.name, ctxMenu.entry.date);
              setCtxMenu(null);
            }}
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            Open
          </button>
          <div className="mx-2 my-1 h-px bg-foreground/[0.06]" />
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => {
              setRenaming(ctxMenu.entry);
              setRenameValue(ctxMenu.entry.name);
              setCtxMenu(null);
            }}
          >
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            Rename
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => {
              duplicateEntry(ctxMenu.entry);
              setCtxMenu(null);
            }}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            Duplicate
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => {
              copyEntryName(ctxMenu.entry);
              setCtxMenu(null);
            }}
          >
            <ClipboardCopy className="h-3.5 w-3.5 text-muted-foreground" />
            Copy Filename
          </button>
          <div className="mx-2 my-1 h-px bg-foreground/[0.06]" />
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
            onClick={() => {
              setConfirmDelete(ctxMenu.entry);
              setCtxMenu(null);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}

      {/* ── Toast notification ────────────────────── */}
      {actionMsg && (
        <div
          className={cn(
            "fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-2.5 text-[13px] shadow-lg backdrop-blur-sm transition-all",
            actionMsg.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          )}
        >
          {actionMsg.msg}
        </div>
      )}
    </>
  );
}
