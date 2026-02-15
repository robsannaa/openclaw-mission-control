"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  Send,
  User,
  Loader2,
  RefreshCw,
  ChevronDown,
  Cpu,
  Circle,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { addUnread, clearUnread, setChatActive } from "@/lib/chat-store";

/* ── types ─────────────────────────────────────── */

type Agent = {
  id: string;
  name: string;
  model: string;
  workspace: string;
  sessionCount: number;
  lastActive: number | null;
};

/* ── Agent icon/color mapping ──────────────────── */

const AGENT_COLORS: Record<string, string> = {
  main: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  gilfoyle: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

const AGENT_EMOJIS: Record<string, string> = {
  main: "🦞",
  gilfoyle: "💀",
};

function agentColor(id: string) {
  return (
    AGENT_COLORS[id] || "bg-blue-500/20 text-blue-300 border-blue-500/30"
  );
}

function agentEmoji(id: string) {
  return AGENT_EMOJIS[id] || "🤖";
}

function formatTime(d: Date | undefined) {
  if (!d) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatModel(model: string) {
  const parts = model.split("/");
  return parts[parts.length - 1] || model;
}

/* ── Markdown-lite renderer for messages ───────── */

function MessageContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${i}`}
            className="my-2 overflow-x-auto rounded-lg bg-card p-3 text-[12px] leading-relaxed text-foreground/70"
          >
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    if (line.trim() === "") {
      elements.push(<br key={`br-${i}`} />);
    } else {
      elements.push(
        <p key={`p-${i}`} className="leading-relaxed">
          <InlineFormatted text={line} />
        </p>
      );
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre
        key="code-end"
        className="my-2 overflow-x-auto rounded-lg bg-card p-3 text-[12px] leading-relaxed text-foreground/70"
      >
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
  }

  return <div className="space-y-1">{elements}</div>;
}

function InlineFormatted({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-muted px-1.5 py-0.5 text-[12px] text-violet-300"
        >
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      parts.push(
        <strong key={key++} className="font-semibold text-foreground">
          {boldMatch[1]}
        </strong>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) {
      parts.push(
        <em key={key++} className="italic text-foreground/70">
          {italicMatch[1]}
        </em>
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push(
        <a
          key={key++}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-400 underline decoration-violet-500/30 hover:text-violet-300"
        >
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }
    parts.push(remaining[0]);
    remaining = remaining.slice(1);
  }

  return <>{parts}</>;
}

/* ── Chat panel for a single agent ─────────────── */
/* These are always mounted; hidden via CSS when not selected */

function ChatPanel({
  agentId,
  agentName,
  agentModel,
  isSelected,
  isVisible,
}: {
  agentId: string;
  agentName: string;
  agentModel: string;
  isSelected: boolean;
  isVisible: boolean;
}) {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevMsgCountRef = useRef(0);

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
    if (!text || isLoading) return;
    setInputValue("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    await sendMessage({ text });
  }, [inputValue, isLoading, sendMessage]);

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
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/80 text-3xl">
              {agentEmoji(agentId)}
            </div>
            <div className="text-center">
              <h3 className="text-base font-semibold text-foreground/90">
                Chat with {agentName}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Send a message to start a conversation with your agent.
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/60">
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
                    setInputValue(prompt);
                    setTimeout(() => inputRef.current?.focus(), 50);
                  }}
                  className="rounded-lg border border-foreground/[0.06] bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/70"
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
              const text =
                message.parts
                  ?.filter(
                    (p): p is { type: "text"; text: string } =>
                      p.type === "text"
                  )
                  .map((p) => p.text)
                  .join("") || "";
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
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm",
                      isUser
                        ? "bg-muted/80 text-foreground/70"
                        : cn("border", agentColor(agentId))
                    )}
                  >
                    {isUser ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <span className="text-base">
                        {agentEmoji(agentId)}
                      </span>
                    )}
                  </div>

                  {/* Message bubble */}
                  <div
                    className={cn(
                      "max-w-[80%] rounded-xl px-4 py-3 text-[13px]",
                      isUser
                        ? "bg-violet-600/20 text-foreground/90"
                        : "bg-muted/80 text-foreground/70"
                    )}
                  >
                    <MessageContent text={text} />
                    <div
                      className={cn(
                        "mt-2 text-[10px]",
                        isUser
                          ? "text-right text-violet-400/40"
                          : "text-muted-foreground/60"
                      )}
                    >
                      {formatTime(
                        "createdAt" in message
                          ? (message as unknown as { createdAt: Date })
                              .createdAt
                          : new Date()
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
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm",
                    agentColor(agentId)
                  )}
                >
                  <span className="text-base">{agentEmoji(agentId)}</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-muted/80 px-4 py-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-[12px] text-muted-foreground">
                    {agentName} is thinking...
                  </span>
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
                <span className="text-[12px] text-red-400">
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
                  className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-500/10"
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

      {/* ── Input area ──────────────────────────── */}
      <div className="shrink-0 border-t border-foreground/[0.06] bg-card/60 px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-3">
          <div className="flex flex-1 items-end rounded-xl border border-foreground/[0.08] bg-card px-4 py-3 focus-within:border-violet-500/30 focus-within:ring-1 focus-within:ring-violet-500/20">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${agentName}...`}
              rows={1}
              disabled={isLoading}
              className="max-h-[200px] flex-1 resize-none bg-transparent text-[13px] text-foreground/90 outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
            />
          </div>

          {/* Clear button (only when there are messages) */}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              title="Clear conversation"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-muted/80 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground/70"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            className={cn(
              "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl transition-colors",
              inputValue.trim() && !isLoading
                ? "bg-violet-600 text-white hover:bg-violet-500"
                : "bg-muted text-muted-foreground/60"
            )}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted-foreground/40">
          Messages are sent to your OpenClaw agent. Press Enter to send,
          Shift+Enter for new line.
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
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
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
    fetchAgents();
    const interval = setInterval(fetchAgents, 30000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

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
      <div className="shrink-0 border-b border-foreground/[0.06] bg-card/60 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Agent dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
                  "border-foreground/[0.08] bg-card hover:bg-muted"
                )}
              >
                <span className="text-lg">
                  {agentEmoji(selectedAgent)}
                </span>
                <span className="font-medium text-foreground/90">
                  {currentAgent?.name || selectedAgent}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>

              {agentDropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[240px] overflow-hidden rounded-lg border border-foreground/[0.08] bg-card/95 py-1 shadow-xl backdrop-blur-sm">
                  {agentsLoading ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Discovering agents...
                    </div>
                  ) : agents.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
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
                        <span className="text-lg">
                          {agentEmoji(agent.id)}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium">
                              {agent.name}
                            </span>
                            {agent.lastActive &&
                              Date.now() - agent.lastActive < 300000 && (
                                <Circle className="h-2 w-2 fill-emerald-400 text-emerald-400" />
                              )}
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {formatModel(agent.model)} &bull;{" "}
                            {agent.sessionCount} session
                            {agent.sessionCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {agent.id === selectedAgent && (
                          <span className="text-[10px] text-violet-400">
                            active
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Model badge */}
            {currentAgent && (
              <div className="flex items-center gap-1.5 rounded-md border border-foreground/[0.06] bg-muted/60 px-2 py-1">
                <Cpu className="h-3 w-3 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">
                  {formatModel(currentAgent.model)}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
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
            agentName={agent?.name || agentId}
            agentModel={agent?.model || "unknown"}
            isSelected={agentId === selectedAgent}
            isVisible={isVisible}
          />
        );
      })}
    </div>
  );
}
