"use client";
/* eslint-disable @next/next/no-img-element */

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  Send,
  User,
  RefreshCw,
  ChevronDown,
  Cpu,
  Circle,
  Trash2,
  Paperclip,
  X,
  Brain,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { addUnread, clearUnread, setChatActive } from "@/lib/chat-store";
import {
  getTimeFormatServerSnapshot,
  getTimeFormatSnapshot,
  subscribeTimeFormatPreference,
  withTimeFormat,
  type TimeFormatPreference,
} from "@/lib/time-format-preference";

/* ── types ─────────────────────────────────────── */

type Agent = {
  id: string;
  name: string;
  emoji: string;
  model: string;
  isDefault: boolean;
  workspace: string;
  sessionCount: number;
  lastActive: number | null;
};

/* ── Agent display helpers ──────────────────────── */

/** Show a friendly display name: use agent name, but if it's just the raw ID, show model instead */
function agentDisplayName(agent: Agent): string {
  if (agent.name && agent.name !== agent.id) return agent.name;
  return formatModel(agent.model);
}

function agentSubtitle(agent: Agent): string {
  if (agent.name && agent.name !== agent.id) return formatModel(agent.model);
  return agent.id;
}

function formatTime(d: Date | undefined, timeFormat: TimeFormatPreference) {
  if (!d) return "";
  return d.toLocaleTimeString(
    "en-US",
    withTimeFormat({ hour: "numeric", minute: "2-digit" }, timeFormat),
  );
}

function formatModel(model: string) {
  const parts = model.split("/");
  return parts[parts.length - 1] || model;
}

/** Convert File[] to FileUIPart[] (data URLs) for sendMessage */
async function filesToUIParts(files: File[]): Promise<Array<{ type: "file"; mediaType: string; filename?: string; url: string }>> {
  return Promise.all(
    files.map(
      (file): Promise<{ type: "file"; mediaType: string; filename?: string; url: string }> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              type: "file",
              mediaType: file.type || "application/octet-stream",
              filename: file.name,
              url: reader.result as string,
            });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        })
    )
  );
}

/* ── Full markdown renderer for messages (tables, lists, code, etc.) ───────── */

const chatMarkdownComponents: React.ComponentProps<
  typeof ReactMarkdown
>["components"] = {
  p: ({ children, ...props }) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-xs" {...props}>
      {children}
    </p>
  ),
  h1: ({ children, ...props }) => (
    <h1 className="mb-2 mt-3 text-xs font-semibold first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="mb-2 mt-3 text-xs font-semibold first:mt-0" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="mb-1.5 mt-2 text-xs font-medium first:mt-0" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="mb-1 mt-2 text-xs font-medium first:mt-0" {...props}>
      {children}
    </h4>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-2 list-inside list-disc space-y-0.5 text-xs" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-2 list-inside list-decimal space-y-0.5 text-xs" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="text-xs" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-semibold" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic opacity-90" {...props}>
      {children}
    </em>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className={cn("block p-0", className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-violet-300"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }) => (
    <pre
      className="my-2 overflow-x-auto rounded-lg bg-card p-3 text-xs leading-relaxed"
      {...props}
    >
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="my-2 border-l-2 border-violet-500/40 pl-3 text-xs italic opacity-90"
      {...props}
    >
      {children}
    </blockquote>
  ),
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-violet-400 underline decoration-violet-500/30 hover:text-violet-300"
      {...props}
    >
      {children}
    </a>
  ),
  hr: (props) => <hr className="my-3 border-foreground/10" {...props} />,
  table: ({ children, ...props }) => (
    <div className="my-3 w-full overflow-x-auto">
      <table className="min-w-full border-collapse border border-foreground/10 text-xs" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => <thead {...props}>{children}</thead>,
  tbody: ({ children, ...props }) => <tbody {...props}>{children}</tbody>,
  tr: ({ children, ...props }) => (
    <tr className="border-b border-foreground/10" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => (
    <th
      className="border border-foreground/10 bg-muted/60 px-2 py-1.5 text-left font-medium"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border border-foreground/10 px-2 py-1.5" {...props}>
      {children}
    </td>
  ),
};

function MessageContent({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="space-y-1 [&>*:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ── Chat panel for a single agent ─────────────── */
/* These are always mounted; hidden via CSS when not selected */

function ChatPanel({
  agentId,
  agentName,
  agentEmoji: emoji,
  agentModel,
  isSelected,
  isVisible,
  availableModels,
}: {
  agentId: string;
  agentName: string;
  agentEmoji: string;
  agentModel: string;
  isSelected: boolean;
  isVisible: boolean;
  availableModels: Array<{ key: string; name: string }>;
}) {
  const timeFormat = useSyncExternalStore(
    subscribeTimeFormatPreference,
    getTimeFormatSnapshot,
    getTimeFormatServerSnapshot,
  );
  const [inputValue, setInputValue] = useState("");
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.isArray(files) ? files : Array.from(files);
    if (list.length) setAttachedFiles((prev) => [...prev, ...list]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      e.dataTransfer.dropEffect = "copy";
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const files = e.dataTransfer.files;
    if (files?.length) addFiles(files);
  }, [addFiles]);

  // Close model menu on click outside
  useEffect(() => {
    if (!modelMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [modelMenuOpen]);

  // Create transport that sends agentId alongside messages
  const transport = useMemo(
    () =>
      new TextStreamChatTransport({
        api: "/api/chat",
        body: { agentId },
      }),
    [agentId]
  );

  const { messages, sendMessage, status, setMessages, error } = useChat({
    transport,
  });

  const isLoading = status === "submitted" || status === "streaming";

  // ── Detect new assistant messages → trigger unread notification ──
  useEffect(() => {
    const count = messages.length;
    if (count > prevMsgCountRef.current) {
      // Find any new assistant messages
      const newMsgs = messages.slice(prevMsgCountRef.current);
      for (const m of newMsgs) {
        if (m.role === "assistant") {
          // Only add unread if the chat tab isn't visible,
          // or this specific agent panel isn't the one being viewed
          if (!isVisible || !isSelected) {
            addUnread(agentId, agentName);
          }
        }
      }
    }
    prevMsgCountRef.current = count;
  }, [messages, isVisible, isSelected, agentId, agentName]);

  // Auto-scroll (only when this panel is visible)
  useEffect(() => {
    if (isSelected && isVisible) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, status, isSelected, isVisible]);

  // Focus input when this panel becomes selected + visible
  useEffect(() => {
    if (isSelected && isVisible) {
      // Small delay to let DOM settle after CSS swap
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isSelected, isVisible]);

  // Clear unread for this agent when the panel becomes visible and selected
  useEffect(() => {
    if (isSelected && isVisible) {
      clearUnread(agentId);
    }
  }, [isSelected, isVisible, agentId]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    const hasFiles = attachedFiles.length > 0;
    if ((!text && !hasFiles) || isLoading) return;
    setInputValue("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    const fileParts = hasFiles ? await filesToUIParts(attachedFiles) : undefined;
    setAttachedFiles([]);
    await sendMessage(
      { text: text || "", files: fileParts },
      { body: { model: modelOverride ?? undefined } }
    );
  }, [inputValue, isLoading, attachedFiles, modelOverride, sendMessage]);

  const clearChat = useCallback(() => {
    setMessages([]);
    prevMsgCountRef.current = 0;
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [setMessages]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      const target = e.target;
      target.style.height = "auto";
      target.style.height = Math.min(target.scrollHeight, 200) + "px";
    },
    []
  );

  return (
    <div
      className={cn(
        "flex flex-1 flex-col overflow-hidden",
        !isSelected && "hidden"
      )}
    >
      {/* ── Messages area ───────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4 md:px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/80 text-xl">
              {emoji}
            </div>
            <div className="text-center">
              <h3 className="text-xs font-semibold text-foreground/90">
                Chat with {agentName}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Send a message to start a conversation with your agent.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground/60">
                Powered by {formatModel(agentModel)}
              </p>
            </div>
            {/* Quick prompts */}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {[
                "What did you do today?",
                "Check my cron jobs",
                "Summarize recent activity",
                "What tasks are pending?",
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => {
                    sendMessage({ text: prompt });
                  }}
                  className="rounded-lg border border-foreground/10 bg-muted/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/70"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6">
            {messages.map((message) => {
              const isUser = message.role === "user";
              const parts = message.parts ?? [];
              const text =
                parts
                  .filter(
                    (
                      p
                    ): p is Extract<(typeof parts)[number], { type: "text" }> =>
                      p.type === "text"
                  )
                  .map((p) => p.text)
                  .join("") || "";
              const fileParts = parts.filter(
                (
                  p
                ): p is Extract<(typeof parts)[number], { type: "file" }> =>
                  p.type === "file"
              );
              const imageParts = fileParts.filter(
                (p) => p.url && /^image\//i.test(p.mediaType ?? "")
              );
              const otherFileParts = fileParts.filter(
                (p) => !p.url || !/^image\//i.test(p.mediaType ?? "")
              );
              return (
                <div
                  key={message.id}
                  className={cn(
                    "mb-6 flex gap-3",
                    isUser ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs",
                      isUser
                        ? "bg-muted/80 text-foreground/70"
                        : "border border-violet-500/30 bg-violet-500/10"
                    )}
                  >
                    {isUser ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <span className="text-sm">
                        {emoji}
                      </span>
                    )}
                  </div>

                  {/* Message bubble */}
                  <div
                    className={cn(
                      "max-w-md rounded-xl px-4 py-3 text-xs",
                      isUser
                        ? "bg-accent text-foreground"
                        : "bg-muted/80 text-foreground/70"
                    )}
                  >
                    {text ? <MessageContent text={text} /> : null}
                    {imageParts.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {imageParts.map((p, i) =>
                          p.url ? (
                            <img
                              key={i}
                              src={p.url}
                              alt={p.filename ?? "Attached image"}
                              className="max-h-48 max-w-full rounded-lg border border-foreground/10 object-contain"
                            />
                          ) : null
                        )}
                      </div>
                    )}
                    {otherFileParts.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {otherFileParts.map((p, i) => (
                          <span
                            key={i}
                            className="rounded bg-muted/80 px-1.5 py-0.5 text-xs opacity-90"
                          >
                            📎 {p.filename ?? "file"}
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      className={cn(
                        "mt-2 text-xs",
                        isUser
                          ? "text-right text-violet-400/40"
                          : "text-muted-foreground/60"
                      )}
                    >
                      {formatTime(
                        "createdAt" in message
                          ? (message as unknown as { createdAt: Date })
                              .createdAt
                          : new Date(),
                        timeFormat,
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Loading indicator */}
            {isLoading && (
              <div className="mb-6 flex gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-xs"
                >
                  <span className="text-sm">{emoji}</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-muted/80 px-4 py-3">
                  <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {agentName} is thinking...
                  </span>
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
<span className="text-xs text-red-400">
                {error.message}
              </span>
                <button
                  type="button"
                  onClick={() => {
                    const lastUser = [...messages]
                      .reverse()
                      .find((m) => m.role === "user");
                    if (lastUser) {
                      const retryText =
                        lastUser.parts
                          ?.filter(
                            (p): p is { type: "text"; text: string } =>
                              p.type === "text"
                          )
                          .map((p) => p.text)
                          .join("") || "";
                      if (retryText) sendMessage({ text: retryText });
                    }
                  }}
                  className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area (drag-and-drop zone) ─────── */}
      <div
        className={cn(
          "shrink-0 border-t border-foreground/10 bg-card/60 px-4 py-3 transition-colors",
          isDraggingOver && "bg-violet-500/10 border-violet-500/20"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="mx-auto max-w-3xl space-y-2">
          {/* Attached files preview */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {attachedFiles.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1 rounded-md border border-foreground/10 bg-muted/60 px-2 py-1 text-xs"
                >
                  <Paperclip className="h-3 w-3 text-muted-foreground/60" />
                  <span className="max-w-32 truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachedFiles((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="rounded p-0.5 text-muted-foreground/40 hover:bg-muted hover:text-foreground"
                    aria-label="Remove file"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {/* Input row: textarea with inline actions */}
          <div className="flex min-w-0 items-end gap-2 sm:gap-3">
            <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-foreground/10 bg-card focus-within:border-violet-500/30 focus-within:ring-1 focus-within:ring-violet-500/20">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${agentName}...`}
                rows={1}
                disabled={isLoading}
                className="max-h-48 flex-1 resize-none bg-transparent px-3 pt-2.5 pb-1 text-xs text-foreground/90 outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 sm:px-4"
              />
              {/* Inline toolbar */}
              <div className="flex items-center gap-1 px-2 pb-1.5 sm:px-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach files"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground/70"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </button>
                <div className="relative" ref={modelMenuRef}>
                  <button
                    type="button"
                    onClick={() => setModelMenuOpen((open) => !open)}
                    title={modelOverride ? formatModel(modelOverride) : `Model: ${formatModel(agentModel)}`}
                    className={cn(
                      "flex h-7 items-center gap-1 rounded-md px-1.5 text-xs transition-colors",
                      modelOverride
                        ? "bg-violet-500/10 text-violet-400"
                        : "text-muted-foreground/40 hover:bg-muted hover:text-foreground/70"
                    )}
                  >
                    <Brain className="h-3.5 w-3.5" />
                    {modelOverride && (
                      <span className="hidden text-xs sm:inline">{formatModel(modelOverride)}</span>
                    )}
                  </button>
                  {modelMenuOpen && (
                    <div className="absolute left-0 bottom-full z-50 mb-1 min-w-48 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-xl backdrop-blur-sm animate-enter">
                      <button
                        type="button"
                        onClick={() => {
                          setModelOverride(null);
                          setModelMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                          !modelOverride
                            ? "bg-violet-500/10 text-violet-600 dark:text-violet-300"
                            : "text-foreground/80 hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <Brain className="h-3.5 w-3.5 shrink-0" />
                        Default ({formatModel(agentModel)})
                      </button>
                      {availableModels.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => {
                            setModelOverride(m.key);
                            setModelMenuOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                            modelOverride === m.key
                              ? "bg-violet-500/10 text-violet-600 dark:text-violet-300"
                              : "text-foreground/80 hover:bg-muted hover:text-foreground"
                          )}
                        >
                          <Cpu className="h-3.5 w-3.5 shrink-0" />
                          {formatModel(m.name)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={clearChat}
                    title="Clear conversation"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground/70"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={(!inputValue.trim() && attachedFiles.length === 0) || isLoading}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                (inputValue.trim() || attachedFiles.length > 0) && !isLoading
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground/60"
              )}
            >
              {isLoading ? (
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
                </span>
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground/40">
          Messages are sent to your OpenClaw agent. You can send text, attachments only, or both. Press Enter to send, Shift+Enter for new line.
        </p>
      </div>
    </div>
  );
}

/* ── Main chat view with agent selector ────────── */

export function ChatView({ isVisible = true }: { isVisible?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("main");
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [availableModels, setAvailableModels] = useState<Array<{ key: string; name: string }>>([]);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Track which agents have been "opened" (we'll mount their ChatPanel forever)
  const [mountedAgents, setMountedAgents] = useState<Set<string>>(
    new Set(["main"])
  );

  // Fetch agents on mount (auto-discovery)
  const fetchAgents = useCallback(() => {
    setAgentsLoading(true);
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        const agentList = data.agents || [];
        setAgents(agentList);
        if (
          agentList.length > 0 &&
          !agentList.find((a: Agent) => a.id === selectedAgent)
        ) {
          setSelectedAgent(agentList[0].id);
          setMountedAgents((prev) => {
            const next = new Set(prev);
            next.add(agentList[0].id);
            return next;
          });
        }
        setAgentsLoading(false);
      })
      .catch(() => setAgentsLoading(false));
  }, [selectedAgent]);

  useEffect(() => {
    queueMicrotask(() => {
      if (isVisible) void fetchAgents();
    });
    const interval = setInterval(() => {
      if (isVisible && document.visibilityState === "visible") {
        void fetchAgents();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchAgents, isVisible]);

  useEffect(() => {
    fetch("/api/models?scope=configured", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data.models) ? data.models : [];
        setAvailableModels(
          list
            .map((m: { key?: string; name?: string }) => ({
              key: String(m.key ?? ""),
              name: String(m.name ?? m.key ?? ""),
            }))
            .filter((m: { key: string }) => m.key)
        );
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const tick = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [isVisible]);

  // When user selects an agent, ensure it's in the mounted set
  const selectAgent = useCallback((agentId: string) => {
    setSelectedAgent(agentId);
    setMountedAgents((prev) => {
      const next = new Set(prev);
      next.add(agentId);
      return next;
    });
    setAgentDropdownOpen(false);
    // Clear unread for this agent since user is looking at it
    clearUnread(agentId);
  }, []);

  // Mark chat as active when visible
  useEffect(() => {
    setChatActive(isVisible);
  }, [isVisible]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!agentDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setAgentDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [agentDropdownOpen]);

  const currentAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgent),
    [agents, selectedAgent]
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Top bar: agent selector ─────────────── */}
      <div className="shrink-0 border-b border-foreground/10 bg-card/60 px-4 md:px-6 py-3">
        <div className="flex items-center justify-between overflow-x-auto">
          <div className="flex items-center gap-3">
            {/* Agent dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors",
                  "border-foreground/10 bg-card hover:bg-muted"
                )}
              >
                <span className="text-xs">
                  {currentAgent?.emoji || "🤖"}
                </span>
                <span className="font-medium text-foreground/90">
                  {currentAgent ? agentDisplayName(currentAgent) : selectedAgent}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>

              {agentDropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-60 overflow-hidden rounded-lg border border-foreground/10 bg-card/95 py-1 shadow-xl backdrop-blur-sm">
                  {agentsLoading ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      Discovering agents...
                    </div>
                  ) : agents.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No agents found
                    </div>
                  ) : (
                    agents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => selectAgent(agent.id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                          agent.id === selectedAgent
                            ? "bg-violet-500/10 text-violet-300"
                            : "text-foreground/70 hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <span className="text-xs">
                          {agent.emoji || "🤖"}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">
                              {agentDisplayName(agent)}
                            </span>
                            {agent.lastActive &&
                              now - agent.lastActive < 300000 && (
                                <Circle className="h-2 w-2 fill-emerald-400 text-emerald-400" />
                              )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {agentSubtitle(agent)} &bull; {formatModel(agent.model)} &bull;{" "}
                            {agent.sessionCount} session
                            {agent.sessionCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {agent.id === selectedAgent && (
                          <span className="text-xs text-violet-400">
                            active
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Model / agent ID badge */}
            {currentAgent && (
              <div className="flex items-center gap-1.5 rounded-md border border-foreground/10 bg-muted/60 px-2 py-1">
                <Cpu className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {agentSubtitle(currentAgent)}
                  {currentAgent.name !== currentAgent.id && ` · ${formatModel(currentAgent.model)}`}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
            <span>
              {agents.length} agent{agents.length !== 1 ? "s" : ""} discovered
            </span>
          </div>
        </div>
      </div>

      {/*
       * ── Agent chat panels ──────────────────────
       * All opened agents are always mounted. Only the selected one is visible.
       * This ensures chat state (messages, streams) persist across tab switches
       * and agent switches.
       */}
      {Array.from(mountedAgents).map((agentId) => {
        const agent = agents.find((a) => a.id === agentId);
        return (
          <ChatPanel
            key={agentId}
            agentId={agentId}
            agentName={agent ? agentDisplayName(agent) : agentId}
            agentEmoji={agent?.emoji || "🤖"}
            agentModel={agent?.model || "unknown"}
            isSelected={agentId === selectedAgent}
            isVisible={isVisible}
            availableModels={availableModels}
          />
        );
      })}
    </div>
  );
}
