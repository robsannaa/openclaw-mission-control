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
  KeyRound,
  ArrowRight,
  ExternalLink,
  Eye,
  EyeOff,
  Check,
  Loader2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TypingDots } from "@/components/typing-dots";
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

type ChatBootstrapResponse = {
  agents?: Agent[];
  models?: Array<{ key?: string; name?: string }>;
};

/* ── Agent display helpers ──────────────────────── */

/** Show a friendly display name: use agent name, but if it's just the raw ID, show model instead */
function agentDisplayName(agent: Agent): string {
  if (agent.name && agent.name !== agent.id) return agent.name;
  return formatModel(agent.model);
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

function possessiveLabel(name: string) {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function createChatSessionKey(agentId: string) {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `agent:${agentId}:mission-control:${suffix}`;
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
        className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-200"
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
      className="my-2 border-l-2 border-emerald-300 pl-3 text-xs italic opacity-90 dark:border-emerald-500/40"
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
      className="text-emerald-700 underline decoration-emerald-300/70 hover:text-emerald-600 dark:text-emerald-300 dark:decoration-emerald-500/40 dark:hover:text-emerald-200"
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

/* ── Inline API key setup ─────────────────────── */

const PROVIDERS = [
  { id: "openai", emoji: "🟢", name: "OpenAI", hint: "ChatGPT, GPT-4o", keyHint: "sk-...", url: "https://platform.openai.com/api-keys" },
  { id: "anthropic", emoji: "🟣", name: "Anthropic", hint: "Claude", keyHint: "sk-ant-...", url: "https://console.anthropic.com/settings/keys" },
  { id: "google", emoji: "🔵", name: "Google", hint: "Gemini", keyHint: "AIza...", url: "https://aistudio.google.com/apikey" },
  { id: "openrouter", emoji: "🟠", name: "OpenRouter", hint: "Many models", keyHint: "sk-or-...", url: "https://openrouter.ai/keys" },
] as const;

/** Default model to use for each provider (matches onboarding-wizard.tsx) */
const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "anthropic/claude-sonnet-4-20250514",
  openai: "openai/gpt-4o",
  google: "google/gemini-2.0-flash",
  openrouter: "openrouter/anthropic/claude-sonnet-4",
};

function ApiKeySetup({ onKeySaved, compact }: { onKeySaved: () => void; compact?: boolean }) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const provider = PROVIDERS.find((p) => p.id === selectedProvider);

  useEffect(() => {
    if (selectedProvider) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [selectedProvider]);

  const handleSave = useCallback(async () => {
    if (!selectedProvider || !key.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auth-provider", provider: selectedProvider, token: key.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        // Also set this provider's default model as the primary so
        // chat works immediately instead of falling back to an
        // unconfigured provider (e.g. Anthropic when only OpenAI has a key).
        const defaultModel = PROVIDER_DEFAULT_MODELS[selectedProvider];
        if (defaultModel) {
          fetch("/api/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "set-primary", model: defaultModel }),
          }).catch(() => {/* best-effort */});
        }
        setSuccess(true);
        setTimeout(() => onKeySaved(), 600);
      } else {
        setError(data.error || "That key didn\u2019t work. Double-check you copied the full key and try again.");
      }
    } catch {
      setError("Can\u2019t connect to OpenClaw right now. Check the sidebar \u2014 if the gateway shows \u201coffline,\u201d click it to restart.");
    }
    setSaving(false);
  }, [selectedProvider, key, onKeySaved]);

  if (success) {
    return (
      <div className={cn(
        "flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 animate-modal-in",
        compact && "p-4"
      )}>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20">
          <Check className="h-4 w-4 text-emerald-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Connected!</p>
          <p className="text-xs text-muted-foreground">Loading your models...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full", compact && "max-w-full")}>
      {!compact && (
        <>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-brand)] text-[var(--accent-brand-on)] shadow-sm">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                Add your API key
              </h3>
              <p className="text-xs text-muted-foreground">
                One-time setup &middot; takes 30 seconds
              </p>
            </div>
          </div>
          <p className="mb-5 text-xs leading-relaxed text-muted-foreground">
            An API key is a password that lets your agent connect to an AI
            service (like ChatGPT or Claude). Pick a provider, grab a key, and paste it below.
          </p>
        </>
      )}

      {/* Provider selector */}
      <div className={cn("grid grid-cols-2 gap-2", compact ? "mb-3" : "mb-5")}>
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setSelectedProvider(selectedProvider === p.id ? null : p.id);
              setKey("");
              setError(null);
              setShowKey(false);
            }}
            className={cn(
              "group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all",
              selectedProvider === p.id
                ? "border-[var(--accent-brand-border)] bg-[var(--accent-brand-subtle)] shadow-sm"
                : "border-foreground/8 bg-muted/40 hover:border-[var(--accent-brand-border)] hover:bg-[var(--accent-brand-subtle)] hover:shadow-sm"
            )}
          >
            <span className="text-base">{p.emoji}</span>
            <div className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-foreground/80">{p.name}</span>
              <span className="block text-[11px] text-muted-foreground/60">{p.hint}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Key input (revealed after picking a provider) */}
      {selectedProvider && provider && (
        <div className="animate-modal-in space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-foreground/80">
              Paste your {provider.name} key
            </label>
            <a
              href={provider.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-[var(--accent-brand-text)] hover:underline"
            >
              Get a key <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => { setKey(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) handleSave(); }}
                placeholder={provider.keyHint}
                className="w-full rounded-lg border border-foreground/10 bg-card px-3 py-2 pr-9 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-[var(--accent-brand-border)] focus:ring-1 focus:ring-[var(--accent-brand-ring)]"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/40 hover:text-foreground/60"
                tabIndex={-1}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!key.trim() || saving}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-all",
                key.trim() && !saving
                  ? "bg-[var(--accent-brand)] text-[var(--accent-brand-on)] shadow-sm hover:opacity-90 hover:shadow-md"
                  : "bg-muted text-muted-foreground/60"
              )}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              {saving ? "Saving..." : "Connect"}
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>
      )}
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
  modelsLoaded,
  onKeySaved,
  isPostOnboarding,
  onClearPostOnboarding,
}: {
  agentId: string;
  agentName: string;
  agentEmoji: string;
  agentModel: string;
  isSelected: boolean;
  isVisible: boolean;
  availableModels: Array<{ key: string; name: string }>;
  modelsLoaded: boolean;
  onKeySaved: () => void;
  isPostOnboarding: boolean;
  onClearPostOnboarding: () => void;
}) {
  const timeFormat = useSyncExternalStore(
    subscribeTimeFormatPreference,
    getTimeFormatSnapshot,
    getTimeFormatServerSnapshot,
  );
  const modelStorageKey = `mc-chat-model:${agentId}`;
  const [inputValue, setInputValue] = useState("");
  const [chatSessionKey, setChatSessionKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return createChatSessionKey(agentId);
  });
  const [modelOverride, setModelOverride] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(modelStorageKey) || null;
    } catch {
      return null;
    }
  });
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);

  // Whether the agent model is known (not the placeholder "unknown" value)
  const agentModelKnown = agentModel.includes("/");

  // Whether the agent's default model provider has a configured API key
  const defaultModelAvailable = useMemo(() => {
    if (!modelsLoaded || availableModels.length === 0 || !agentModelKnown) return false;
    const defaultProvider = agentModel.split("/")[0]; // e.g. "anthropic"
    return availableModels.some((m) => m.key.split("/")[0] === defaultProvider);
  }, [modelsLoaded, availableModels, agentModel, agentModelKnown]);

  const manualChatModel = useMemo(() => {
    const requested = modelOverride?.trim() || null;
    if (!requested) return null;
    if (!modelsLoaded || availableModels.length === 0) return requested;
    return availableModels.some((m) => m.key === requested) ? requested : null;
  }, [availableModels, modelOverride, modelsLoaded]);

  const automaticChatModel = useMemo(() => {
    if (manualChatModel) return null;
    if (!modelsLoaded || availableModels.length === 0 || !agentModelKnown) return null;
    if (defaultModelAvailable) return null;
    const preferredDefaults = Object.values(PROVIDER_DEFAULT_MODELS);
    return (
      availableModels.find((m) => preferredDefaults.includes(m.key))?.key ||
      availableModels[0]?.key ||
      null
    );
  }, [
    agentModelKnown,
    availableModels,
    defaultModelAvailable,
    manualChatModel,
    modelsLoaded,
  ]);

  const activeChatModel = manualChatModel ?? automaticChatModel;
  const modelOverrideSource = manualChatModel
    ? "manual"
    : automaticChatModel
      ? "automatic"
      : "agent";
  const activeChatModelLabel = activeChatModel
    ? formatModel(activeChatModel)
    : `${possessiveLabel(agentName)} setup`;
  const agentSetupLabel = agentModelKnown ? formatModel(agentModel) : "unknown";

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (modelOverride && (!modelsLoaded || availableModels.some((m) => m.key === modelOverride))) {
        localStorage.setItem(modelStorageKey, modelOverride);
      } else {
        localStorage.removeItem(modelStorageKey);
      }
    } catch {
      // Ignore storage failures; they should not block chat.
    }
  }, [availableModels, modelOverride, modelStorageKey, modelsLoaded]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.isArray(files) ? files : Array.from(files);
    if (list.length) setAttachedFiles((prev) => [...prev, ...list]);
  }, []);

  const ensureChatSessionKey = useCallback(() => {
    const existing = chatSessionKey.trim();
    if (existing) return existing;
    const next = createChatSessionKey(agentId);
    setChatSessionKey(next);
    return next;
  }, [agentId, chatSessionKey]);

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

  // Create transport for chat requests. Per-request fields are attached via sendMessage.
  const transport = useMemo(
    () =>
      new TextStreamChatTransport({
        api: "/api/chat",
      }),
    []
  );

  const { messages, sendMessage, status, setMessages, error } = useChat({
    transport,
  });

  const isLoading = status === "submitted" || status === "streaming";
  const noApiKeys = modelsLoaded && availableModels.length === 0;

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

  const sendWithActiveModel = useCallback(
    async (
      payload: {
        text: string;
        files?: Array<{ type: "file"; mediaType: string; filename?: string; url: string }>;
      },
    ) => {
      const sessionKey = ensureChatSessionKey();
      await sendMessage(payload, {
        body: activeChatModel
          ? { agentId, model: activeChatModel, sessionKey }
          : { agentId, sessionKey },
      });
    },
    [activeChatModel, agentId, ensureChatSessionKey, sendMessage],
  );

  const retryLastUserMessage = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const retryText =
      lastUser.parts
        ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("") || "";
    if (retryText) void sendWithActiveModel({ text: retryText });
  }, [messages, sendWithActiveModel]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    const hasFiles = attachedFiles.length > 0;
    if ((!text && !hasFiles) || isLoading || noApiKeys) return;
    onClearPostOnboarding();
    setInputValue("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    const fileParts = hasFiles ? await filesToUIParts(attachedFiles) : undefined;
    setAttachedFiles([]);
    await sendWithActiveModel(
      { text: text || "", files: fileParts },
    );
  }, [
    attachedFiles,
    inputValue,
    isLoading,
    noApiKeys,
    onClearPostOnboarding,
    sendWithActiveModel,
  ]);

  const clearChat = useCallback(() => {
    setMessages([]);
    prevMsgCountRef.current = 0;
    setChatSessionKey(createChatSessionKey(agentId));
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [agentId, setMessages]);

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
          noApiKeys ? (
            /* ── No API keys — inline setup ── */
            <div className="flex h-full items-center justify-center px-4 md:px-6">
              <div className="relative w-full max-w-md animate-modal-in">
                <div className="pointer-events-none absolute -inset-12 rounded-full bg-[var(--accent-brand)] opacity-[0.04] blur-3xl" />
                <div className="relative rounded-2xl border border-[var(--accent-brand-border)]/60 bg-card p-6 shadow-lg shadow-[var(--accent-brand-ring)]/10">
                  <ApiKeySetup onKeySaved={onKeySaved} />
                </div>
              </div>
            </div>
          ) : (
            /* ── Normal empty state — ready to chat ── */
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
                {(activeChatModel || agentModelKnown) && (
                  <p className="mt-0.5 text-xs text-muted-foreground/60">
                    {activeChatModel
                      ? `This chat will use ${activeChatModelLabel}.`
                      : `This chat follows ${possessiveLabel(agentName)} setup (${agentSetupLabel}).`}
                  </p>
                )}
                {activeChatModel && modelOverrideSource === "automatic" && !defaultModelAvailable && agentModelKnown && (
                  <p className="mt-2 max-w-xs text-[11px] leading-relaxed text-amber-500/70">
                    Mission Control temporarily switched this chat from {agentSetupLabel}
                    to {activeChatModelLabel} because the agent&apos;s setup isn&apos;t
                    ready right now.
                  </p>
                )}
              </div>
              {/* Quick prompts */}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {(isPostOnboarding
                  ? [
                      "Say hello!",
                      "What can you do?",
                      "Tell me a joke",
                      "Help me get started",
                    ]
                  : [
                      "What did you do today?",
                      "Check my scheduled tasks",
                      "Summarize recent activity",
                      "What tasks are pending?",
                    ]
                ).map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => {
                      onClearPostOnboarding();
                      void sendWithActiveModel({ text: prompt });
                    }}
                    className="rounded-lg border border-foreground/10 bg-muted/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/70"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )
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
                          ? "text-right text-stone-400 dark:text-stone-500"
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

            {/* Loading indicator — only when waiting for first token, not during streaming */}
            {status === "submitted" && (
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
                    {activeChatModel
                      ? `${agentName} is thinking with ${activeChatModelLabel}...`
                      : `${agentName} is thinking...`}
                  </span>
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              /No API key found|api[._-]key|auth.profiles|FailoverError|Configure auth|unauthorized|invalid.*key|401/i.test(error.message) ? (
                /* Friendly API key error — inline setup */
                <div className="mb-6 overflow-hidden rounded-xl border border-[var(--accent-brand-border)]/60 bg-card p-4 shadow-sm animate-modal-in">
                  <div className="mb-3 flex items-center gap-2">
                    <KeyRound className="h-3.5 w-3.5 text-[var(--accent-brand-text)]" />
                    <span className="text-xs font-medium text-[var(--accent-brand-text)]">Your agent needs an API key to reply</span>
                  </div>
                  <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                    The AI provider rejected the request. This usually means your API key
                    is missing, expired, or doesn&apos;t have enough credits. Add or update it below.
                  </p>
                  <ApiKeySetup onKeySaved={onKeySaved} compact />
                </div>
              ) : /avoid sending your message with a different model|switch this chat back to the agent setup|could not use .* because the OpenClaw gateway/i.test(error.message) ? (
                <div className="mb-6 rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-violet-500">
                      Your selected chat model was protected
                    </span>
                    <button
                      type="button"
                      onClick={retryLastUserMessage}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-violet-500 transition-colors hover:bg-violet-500/10"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Try again
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-violet-500/80">
                    Mission Control stopped the request instead of sending it with the wrong model.
                    You can try again, or switch this chat back to the agent setup below.
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-violet-500/60">
                    {error.message}
                  </p>
                </div>
              ) : /timeout|timed out|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(error.message) ? (
                /* Connection / network error */
                <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-amber-400">
                      Connection problem
                    </span>
                    <button
                      type="button"
                      onClick={retryLastUserMessage}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/10"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Try again
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-amber-400/70">
                    Could not reach the AI provider. Check that your internet connection is
                    working and that the OpenClaw gateway is online (green dot in the sidebar).
                  </p>
                </div>
              ) : /rate.?limit|429|quota|exceeded|billing/i.test(error.message) ? (
                /* Rate limit / quota error */
                <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-amber-400">
                      Usage limit reached
                    </span>
                    <button
                      type="button"
                      onClick={retryLastUserMessage}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/10"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Try again
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-amber-400/70">
                    Your AI provider says you&apos;ve hit a usage or billing limit. Wait a minute
                    and try again, or check your plan&apos;s dashboard to add credits.
                  </p>
                </div>
              ) : (
                /* Generic error — still helpful */
                <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-red-400">
                      Something went wrong
                    </span>
                    <button
                      type="button"
                      onClick={retryLastUserMessage}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Try again
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-red-400/70">
                    {error.message}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-red-400/50">
                    If this keeps happening, try switching models (brain icon below),
                    or visit the Doctor page from the sidebar to run a system check.
                  </p>
                </div>
              )
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
                placeholder={noApiKeys ? "Add an API key to start chatting..." : `Message ${agentName}...`}
                rows={1}
                disabled={isLoading || noApiKeys}
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
                    title={
                      activeChatModel
                        ? `This chat uses ${activeChatModelLabel}`
                        : `This chat follows ${possessiveLabel(agentName)} setup (${agentSetupLabel})`
                    }
                    className={cn(
                      "flex h-7 items-center gap-1 rounded-md px-1.5 text-xs transition-colors",
                      activeChatModel
                        ? "bg-violet-500/10 text-violet-400"
                        : "text-muted-foreground/40 hover:bg-muted hover:text-foreground/70"
                    )}
                  >
                    <Brain className="h-3.5 w-3.5" />
                    <span className="hidden text-xs sm:inline">
                      {activeChatModel
                        ? `Chat: ${activeChatModelLabel}`
                        : `Chat: ${agentSetupLabel}`}
                    </span>
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
                          !activeChatModel
                            ? "bg-violet-500/10 text-violet-600 dark:text-violet-300"
                            : "text-foreground/80 hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <Brain className="h-3.5 w-3.5 shrink-0" />
                        Use agent setup ({agentSetupLabel})
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
                            activeChatModel === m.key
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
              {activeChatModel && (
                <div className="flex items-center justify-between gap-2 border-t border-foreground/8 px-3 pb-2 pt-1.5 text-[11px] sm:px-4">
                  <p className="min-w-0 truncate text-muted-foreground/60">
                    {modelOverrideSource === "automatic"
                      ? `Temporary chat model: ${activeChatModelLabel}. Agent setup is ${agentSetupLabel}.`
                      : `Chat model: ${activeChatModelLabel}. Agent setup: ${agentSetupLabel}.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setModelOverride(null);
                    }}
                    className="shrink-0 text-[11px] font-medium text-violet-500/80 transition-colors hover:text-violet-500"
                  >
                    Use agent setup
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={(!inputValue.trim() && attachedFiles.length === 0) || isLoading || noApiKeys}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                (inputValue.trim() || attachedFiles.length > 0) && !isLoading && !noApiKeys
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
          Press Enter to send, Shift+Enter for a new line. You can also attach files.
        </p>
      </div>
    </div>
  );
}

/* ── Main chat view with agent selector ────────── */

const isHosted = process.env.NEXT_PUBLIC_AGENTBAY_HOSTED === "true";

export function ChatView({ isVisible = true }: { isVisible?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("main");
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [availableModels, setAvailableModels] = useState<Array<{ key: string; name: string }>>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Warm-up state: friendly loading for new users ──
  const [warmupExpired, setWarmupExpired] = useState(false);
  const mountedAtRef = useRef(0);
  const warmingUp = !warmupExpired && agents.length === 0;

  // ── Post-onboarding first-time prompts ──
  const [isPostOnboarding, setIsPostOnboarding] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("mc-post-onboarding") === "1"; } catch { return false; }
  });

  const clearPostOnboarding = useCallback(() => {
    if (!isPostOnboarding) return;
    setIsPostOnboarding(false);
    try { localStorage.removeItem("mc-post-onboarding"); } catch {}
  }, [isPostOnboarding]);

  // Track which agents have been "opened" (we'll mount their ChatPanel forever)
  const [mountedAgents, setMountedAgents] = useState<Set<string>>(
    new Set(["main"])
  );

  // Fetch chat bootstrap data on mount (gateway config + sessions only)
  const bootstrapLoadedRef = useRef(false);
  const fetchBootstrap = useCallback(() => {
    // Only show loading spinner on initial fetch, not on background polls.
    // Setting loading on every poll clears the agent dropdown momentarily.
    if (!bootstrapLoadedRef.current) setAgentsLoading(true);
    fetch("/api/chat/bootstrap", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: ChatBootstrapResponse) => {
        const agentList = data.agents || [];
        const modelList = Array.isArray(data.models) ? data.models : [];
        setAgents(agentList);
        setAvailableModels(
          modelList
            .map((m) => ({
              key: String(m.key ?? ""),
              name: String(m.name ?? m.key ?? ""),
            }))
            .filter((m) => m.key)
        );
        bootstrapLoadedRef.current = true;
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
        setModelsLoaded(true);
        setAgentsLoading(false);
      })
      .catch(() => {
        setModelsLoaded(true);
        setAgentsLoading(false);
      });
  }, [selectedAgent]);

  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  // End warm-up after 20s timeout
  useEffect(() => {
    const remaining = 20_000 - (Date.now() - mountedAtRef.current);
    const t = setTimeout(() => setWarmupExpired(true), Math.max(remaining, 0));
    return () => clearTimeout(t);
  }, []);

  // Fetch agents: fast-poll (2s) during warm-up, normal (30s) otherwise
  useEffect(() => {
    queueMicrotask(() => {
      if (isVisible) void fetchBootstrap();
    });
    const ms = warmingUp ? 2000 : 30000;
    const interval = setInterval(() => {
      if (isVisible && document.visibilityState === "visible") {
        void fetchBootstrap();
      }
    }, ms);
    return () => clearInterval(interval);
  }, [fetchBootstrap, isVisible, warmingUp]);

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
      <div className="shrink-0 border-b border-stone-200 bg-stone-50 px-4 py-4 md:px-6 dark:border-stone-700 dark:bg-stone-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {/* Agent dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  "border-stone-200 bg-white text-stone-700 hover:bg-stone-100 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                )}
              >
                <span className="text-xs">
                  {currentAgent?.emoji || "🤖"}
                </span>
                <span className="font-medium">
                  {currentAgent ? agentDisplayName(currentAgent) : selectedAgent}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" />
              </button>

              {agentDropdownOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-60 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-xl dark:border-stone-700 dark:bg-stone-800">
                  {agentsLoading ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {warmingUp ? "Starting up..." : "Loading agents..."}
                    </div>
                  ) : agents.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No agents available
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
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
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
                            {formatModel(agent.model)}
                            {agent.sessionCount > 0 && (
                              <> &bull; {agent.sessionCount} chat{agent.sessionCount !== 1 ? "s" : ""}</>
                            )}
                          </span>
                        </div>
                        {agent.id === selectedAgent && (
                          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
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
              <div className="flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 dark:border-stone-700 dark:bg-stone-800">
                <Cpu className="h-3 w-3 text-stone-400 dark:text-stone-500" />
                <span className="text-xs text-stone-500 dark:text-stone-300">
                  Agent setup: {formatModel(currentAgent.model)}
                </span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 text-xs text-stone-400 dark:text-stone-500">
            <span>
              {agents.length} agent{agents.length !== 1 ? "s" : ""}
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
      {!agentsLoading && agents.length === 0 ? (
        warmingUp ? (
          /* ── Warm-up: agent is starting ── */
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/80 text-xl">
              🤖
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">
                Getting your agent ready
                <TypingDots size="sm" className="ml-1 text-muted-foreground" />
              </h3>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
                This usually only takes a few seconds.
              </p>
            </div>
          </div>
        ) : isHosted ? (
          /* ── Hosted post-warm-up: friendly fallback ── */
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/80 text-xl">
              🤖
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">
                Your agent isn&apos;t available yet
              </h3>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
                Try refreshing the page. If the problem persists, please contact support.
              </p>
            </div>
            <button
              type="button"
              onClick={fetchBootstrap}
              className="flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-muted/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/70"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        ) : (
          /* ── Self-hosted: existing guidance ── */
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/80 text-xl">
              🤖
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">
                No agents found
              </h3>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
                Your agent hasn&apos;t started yet. Check that the gateway is online
                (green dot in the sidebar), then refresh this page.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={fetchBootstrap}
                className="flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-muted/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/70"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
              <a
                href="/doctor"
                className="flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-muted/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground/70"
              >
                <Cpu className="h-3 w-3" />
                Run Doctor
              </a>
            </div>
          </div>
        )
      ) : (
        Array.from(mountedAgents).map((agentId) => {
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
              modelsLoaded={modelsLoaded}
              onKeySaved={fetchBootstrap}
              isPostOnboarding={isPostOnboarding}
              onClearPostOnboarding={clearPostOnboarding}
            />
          );
        })
      )}
    </div>
  );
}
