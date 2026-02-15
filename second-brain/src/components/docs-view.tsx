"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Search,
  FileText,
  Hash,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Trash2,
  Copy,
  Pencil,
  ClipboardCopy,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineMarkdownEditor } from "./inline-markdown-editor";

/* ── types ─────────────────────────────────────── */

type Doc = {
  path: string;
  name: string;
  mtime: string;
  size: number;
  tag: string;
  workspace: string;
  ext: string;
};

type WorkspaceGroup = {
  name: string;
  label: string;
  docs: Doc[];
};

type ContextMenuState = {
  x: number;
  y: number;
  doc: Doc;
} | null;

/* ── helpers ───────────────────────────────────── */

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function formatAgo(d: string | Date) {
  const now = new Date();
  const diff = now.getTime() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins > 1 ? "s" : ""} ago`;
  if (hours < 24) return `about ${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Friendly workspace label: workspace -> Clawbert, workspace-gilfoyle -> Gilfoyle */
function workspaceLabel(name: string): string {
  if (name === "workspace") return "Clawbert (main)";
  const suffix = name.replace(/^workspace-?/, "");
  return suffix ? suffix.charAt(0).toUpperCase() + suffix.slice(1) : name;
}

const WORKSPACE_ICONS: Record<string, string> = {
  workspace: "🦞",
  "workspace-gilfoyle": "💀",
};

const TAG_COLORS: Record<string, string> = {
  Journal: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  Other: "bg-zinc-600/20 text-zinc-400 border-zinc-500/30",
  Notes: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Content: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  Newsletters: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  "YouTube Scripts": "bg-red-500/20 text-red-300 border-red-500/30",
};

/* ── component ─────────────────────────────────── */

export function DocsView() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [allExts, setAllExts] = useState<string[]>([]);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [words, setWords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [extFilter, setExtFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Save state
  const [saveStatus, setSaveStatus] = useState<
    "saved" | "saving" | "unsaved" | null
  >(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);
  const [renaming, setRenaming] = useState<Doc | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Doc | null>(null);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const fetchDocs = useCallback(() => {
    setLoading(true);
    fetch("/api/docs")
      .then((r) => r.json())
      .then((data) => {
        setDocs(data.docs || []);
        setAllTags(data.tags || []);
        setAllExts(data.extensions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

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

  /* ── save & edit ──────────────────────────────── */

  const saveContent = useCallback(
    async (docPath: string, newContent: string) => {
      setSaveStatus("saving");
      try {
        const res = await fetch("/api/docs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: docPath, content: newContent }),
        });
        if (res.ok) {
          const data = await res.json();
          setContent(newContent);
          setWords(
            data.words || newContent.split(/\s+/).filter(Boolean).length
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
    []
  );

  const handleContentChange = useCallback(
    (newMarkdown: string) => {
      setSaveStatus("unsaved");
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (selected) {
        saveTimeoutRef.current = setTimeout(() => {
          saveContent(selected.path, newMarkdown);
        }, 300); // short delay since editor already debounces
      }
    },
    [selected, saveContent]
  );

  // Cmd+S: flush pending debounce and save immediately
  const handleSave = useCallback(
    (markdown: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (selected) {
        saveContent(selected.path, markdown);
      }
    },
    [selected, saveContent]
  );

  const loadDoc = (doc: Doc) => {
    // Flush any pending save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSelected(doc);
    setSaveStatus(null);
    setContent(null);
    fetch(`/api/docs?path=${encodeURIComponent(doc.path)}`)
      .then((r) => r.json())
      .then((data) => {
        setContent(data.content ?? "");
        setWords(data.words ?? 0);
      })
      .catch(() => setContent("Failed to load."));
  };

  /* ── file operations ────────────────────────────── */

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, doc: Doc) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY, doc });
    },
    []
  );

  const deleteDoc = useCallback(
    async (doc: Doc) => {
      try {
        const res = await fetch(
          `/api/docs?path=${encodeURIComponent(doc.path)}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (data.ok) {
          setDocs((prev) => prev.filter((d) => d.path !== doc.path));
          if (selected?.path === doc.path) {
            setSelected(null);
            setContent(null);
          }
          setActionMsg({ ok: true, msg: `Deleted ${doc.name}` });
        } else {
          setActionMsg({ ok: false, msg: data.error || "Delete failed" });
        }
      } catch {
        setActionMsg({ ok: false, msg: "Delete failed" });
      }
      setConfirmDelete(null);
      setTimeout(() => setActionMsg(null), 3000);
    },
    [selected]
  );

  const renameDoc = useCallback(
    async (doc: Doc, newName: string) => {
      if (!newName.trim() || newName === doc.name) {
        setRenaming(null);
        return;
      }
      try {
        const res = await fetch("/api/docs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", path: doc.path, newName }),
        });
        const data = await res.json();
        if (data.ok) {
          // Update in list
          setDocs((prev) =>
            prev.map((d) =>
              d.path === doc.path
                ? { ...d, path: data.path, name: newName }
                : d
            )
          );
          if (selected?.path === doc.path) {
            setSelected({ ...doc, path: data.path, name: newName });
          }
          setActionMsg({ ok: true, msg: `Renamed to ${newName}` });
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

  const duplicateDoc = useCallback(
    async (doc: Doc) => {
      try {
        const res = await fetch("/api/docs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "duplicate", path: doc.path }),
        });
        const data = await res.json();
        if (data.ok) {
          // Refresh the list to pick up the new file
          fetchDocs();
          setActionMsg({ ok: true, msg: `Duplicated as ${data.name}` });
        } else {
          setActionMsg({ ok: false, msg: data.error || "Duplicate failed" });
        }
      } catch {
        setActionMsg({ ok: false, msg: "Duplicate failed" });
      }
      setTimeout(() => setActionMsg(null), 3000);
    },
    [fetchDocs]
  );

  const copyPath = useCallback((doc: Doc) => {
    navigator.clipboard.writeText(doc.path).then(() => {
      setActionMsg({ ok: true, msg: "Path copied to clipboard" });
      setTimeout(() => setActionMsg(null), 2000);
    });
  }, []);

  /* ── filtered & grouped ──────────────────────── */

  const filtered = useMemo(
    () =>
      docs.filter((d) => {
        const matchSearch =
          !search ||
          d.name.toLowerCase().includes(search.toLowerCase()) ||
          d.path.toLowerCase().includes(search.toLowerCase());
        const matchTag = !tagFilter || d.tag === tagFilter;
        const matchExt = !extFilter || d.ext === extFilter;
        return matchSearch && matchTag && matchExt;
      }),
    [docs, search, tagFilter, extFilter]
  );

  const workspaceGroups: WorkspaceGroup[] = useMemo(() => {
    const map = new Map<string, Doc[]>();
    for (const doc of filtered) {
      const wsName = doc.workspace;
      if (!map.has(wsName)) map.set(wsName, []);
      map.get(wsName)!.push(doc);
    }
    return Array.from(map.entries()).map(([name, wsDocs]) => ({
      name,
      label: workspaceLabel(name),
      docs: wsDocs,
    }));
  }, [filtered]);

  const toggleCollapse = (ws: string) =>
    setCollapsed((prev) => ({ ...prev, [ws]: !prev[ws] }));

  /* ── render ──────────────────────────────────── */

  return (
    <>
      {/* Left panel */}
      <div className="flex w-[360px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-[#0c0c10]/60">
        <div className="shrink-0 space-y-3 p-3">
          {/* Search */}
          <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-zinc-900/80 px-3 py-2 text-sm text-zinc-400">
            <Search className="h-4 w-4 shrink-0 text-zinc-500" />
            <input
              placeholder="Search documents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
            />
          </div>

          {/* Tag filter pills */}
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                  tagFilter === tag
                    ? TAG_COLORS[tag] || TAG_COLORS.Other
                    : "border-white/[0.06] bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-400"
                )}
              >
                {tag}
              </button>
            ))}
          </div>

          {/* File type chips */}
          <div className="flex flex-wrap gap-1.5">
            <Hash className="h-3.5 w-3.5 text-zinc-600" />
            {allExts.map((ext) => (
              <button
                key={ext}
                type="button"
                onClick={() => setExtFilter(extFilter === ext ? null : ext)}
                className={cn(
                  "rounded border px-2 py-0.5 text-[11px] font-mono transition-colors",
                  extFilter === ext
                    ? "border-violet-500/30 bg-violet-500/15 text-violet-300"
                    : "border-white/[0.06] bg-zinc-800/40 text-zinc-500 hover:text-zinc-400"
                )}
              >
                {ext}
              </button>
            ))}
          </div>
        </div>

        {/* Document list grouped by workspace */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <p className="px-3 py-4 text-sm text-zinc-600">Loading...</p>
          ) : workspaceGroups.length === 0 ? (
            <p className="px-3 py-4 text-sm text-zinc-600">
              No documents found
            </p>
          ) : (
            <div className="space-y-1">
              {workspaceGroups.map((ws) => {
                const isCollapsed = collapsed[ws.name] || false;
                const icon = WORKSPACE_ICONS[ws.name] || "📁";
                return (
                  <div key={ws.name}>
                    {/* Workspace header */}
                    <button
                      type="button"
                      onClick={() => toggleCollapse(ws.name)}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-zinc-800/40"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                      )}
                      <span className="text-base">{icon}</span>
                      <span className="text-[12px] font-semibold text-zinc-300">
                        {ws.label}
                      </span>
                      <span className="text-[11px] text-zinc-600">
                        {ws.docs.length}
                      </span>
                    </button>

                    {/* Docs in this workspace */}
                    {!isCollapsed && (
                      <div className="space-y-0.5 pl-4">
                        {ws.docs.map((doc) => {
                          const isSelected = selected?.path === doc.path;
                          const isRenaming = renaming?.path === doc.path;
                          const isDeleting = confirmDelete?.path === doc.path;
                          // Show relative path inside workspace
                          const relPath = doc.path
                            .replace(`${ws.name}/`, "")
                            .replace(`/${doc.name}`, "");
                          const showSubpath =
                            relPath && relPath !== doc.name;

                          if (isDeleting) {
                            return (
                              <div
                                key={doc.path}
                                className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2.5"
                              >
                                <Trash2 className="h-3.5 w-3.5 shrink-0 text-red-400" />
                                <span className="flex-1 truncate text-[12px] text-red-300">
                                  Delete {doc.name}?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => deleteDoc(doc)}
                                  className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-500"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDelete(null)}
                                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                >
                                  Cancel
                                </button>
                              </div>
                            );
                          }

                          if (isRenaming) {
                            return (
                              <div
                                key={doc.path}
                                className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-zinc-900/80 px-3 py-2"
                              >
                                <Pencil className="h-3 w-3 shrink-0 text-violet-400" />
                                <input
                                  value={renameValue}
                                  onChange={(e) =>
                                    setRenameValue(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      renameDoc(doc, renameValue);
                                    if (e.key === "Escape")
                                      setRenaming(null);
                                  }}
                                  onBlur={() =>
                                    renameDoc(doc, renameValue)
                                  }
                                  className="flex-1 bg-transparent text-[13px] text-zinc-200 outline-none"
                                  autoFocus
                                />
                              </div>
                            );
                          }

                          return (
                            <button
                              key={doc.path}
                              type="button"
                              onClick={() => loadDoc(doc)}
                              onContextMenu={(e) =>
                                handleContextMenu(e, doc)
                              }
                              className={cn(
                                "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                                isSelected
                                  ? "bg-zinc-800/80 ring-1 ring-white/[0.06]"
                                  : "hover:bg-zinc-800/40"
                              )}
                            >
                              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
                              <div className="min-w-0 flex-1">
                                <span
                                  className={cn(
                                    "block truncate text-[13px] font-medium",
                                    isSelected
                                      ? "text-zinc-100"
                                      : "text-zinc-300"
                                  )}
                                >
                                  {doc.name}
                                </span>
                                {showSubpath && (
                                  <span className="block truncate text-[10px] text-zinc-600">
                                    {relPath}
                                  </span>
                                )}
                                <div className="mt-1 flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                                      TAG_COLORS[doc.tag] || TAG_COLORS.Other
                                    )}
                                  >
                                    {doc.tag}
                                  </span>
                                  <span className="text-[10px] text-zinc-600">
                                    {formatAgo(doc.mtime)}
                                  </span>
                                </div>
                              </div>
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

      {/* Right panel: preview / editor */}
      <div className="flex flex-1 flex-col overflow-hidden bg-[#08080c]/40">
        {selected ? (
          <>
            {/* Header */}
            <div className="shrink-0 border-b border-white/[0.06] px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="text-base">
                  {WORKSPACE_ICONS[selected.workspace] || "📁"}
                </span>
                <h2 className="text-base font-semibold text-zinc-100">
                  {selected.name}
                </h2>
                <span
                  className={cn(
                    "rounded border px-2 py-0.5 text-[11px] font-medium",
                    TAG_COLORS[selected.tag] || TAG_COLORS.Other
                  )}
                >
                  {selected.tag}
                </span>
                {saveStatus === "saving" && (
                  <span className="text-[11px] text-zinc-500">Saving...</span>
                )}
                {saveStatus === "saved" && (
                  <span className="text-[11px] text-emerald-500">Saved</span>
                )}
                {saveStatus === "unsaved" && (
                  <span className="text-[11px] text-amber-500">Unsaved</span>
                )}
              </div>
              <p className="mt-1 flex items-center gap-2 text-[12px] text-zinc-600">
                <span className="rounded bg-zinc-800/50 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  {workspaceLabel(selected.workspace)}
                </span>
                {formatBytes(selected.size)} &bull; {words} words &bull;
                Modified {formatAgo(selected.mtime)} &bull;
                <kbd className="rounded bg-zinc-800/80 px-1 py-0.5 text-[9px] font-mono text-zinc-500">
                  &#8984;S
                </kbd>{" "}
                to save
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {content != null ? (
                <InlineMarkdownEditor
                  key={selected.path}
                  content={content}
                  onContentChange={handleContentChange}
                  onSave={handleSave}
                  placeholder="Click to start writing..."
                />
              ) : (
                <div className="flex items-center justify-center py-12 text-sm text-zinc-600">
                  Loading...
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-zinc-600">
            <FolderOpen className="h-8 w-8 text-zinc-700" />
            <p className="text-sm">Select a document</p>
            <p className="text-[11px] text-zinc-700">
              Documents are grouped by workspace/agent
            </p>
          </div>
        )}
      </div>

      {/* ── Context menu ──────────────────────────── */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-white/[0.08] bg-zinc-900/95 py-1 shadow-xl backdrop-blur-sm"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 200),
            top: Math.min(ctxMenu.y, window.innerHeight - 260),
          }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            onClick={() => {
              loadDoc(ctxMenu.doc);
              setCtxMenu(null);
            }}
          >
            <ExternalLink className="h-3.5 w-3.5 text-zinc-500" />
            Open
          </button>
          <div className="mx-2 my-1 h-px bg-white/[0.06]" />
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            onClick={() => {
              setRenaming(ctxMenu.doc);
              setRenameValue(ctxMenu.doc.name);
              setCtxMenu(null);
            }}
          >
            <Pencil className="h-3.5 w-3.5 text-zinc-500" />
            Rename
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            onClick={() => {
              duplicateDoc(ctxMenu.doc);
              setCtxMenu(null);
            }}
          >
            <Copy className="h-3.5 w-3.5 text-zinc-500" />
            Duplicate
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            onClick={() => {
              copyPath(ctxMenu.doc);
              setCtxMenu(null);
            }}
          >
            <ClipboardCopy className="h-3.5 w-3.5 text-zinc-500" />
            Copy Path
          </button>
          <div className="mx-2 my-1 h-px bg-white/[0.06]" />
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
            onClick={() => {
              setConfirmDelete(ctxMenu.doc);
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
