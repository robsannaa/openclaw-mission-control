/**
 * Chat store — combines two systems:
 *
 * 1. **Chat View unread tracking** (legacy) — used by ChatView, Sidebar, page.tsx
 *    to track unread messages from the full agent chat section.
 *
 * 2. **Ping Agent chat** (new) — persistent global chat panel that survives
 *    view changes, with browser notification support.
 */

/* ═══════════════════════════════════════════════════
 * PART 1: Chat View unread tracking (legacy exports)
 * ═══════════════════════════════════════════════════ */

type Listener = () => void;

let _unreadCount = 0;
let _unreadByAgent: Record<string, number> = {};
let _chatActive = false;
const _listeners = new Set<Listener>();

export function getChatUnreadCount(): number {
  return _unreadCount;
}

export function getUnreadByAgent(): Record<string, number> {
  return { ..._unreadByAgent };
}

export function isChatActive(): boolean {
  return _chatActive;
}

export function setChatActive(active: boolean): void {
  _chatActive = active;
  if (active) {
    _unreadCount = 0;
    _unreadByAgent = {};
    _notifyLegacy();
  }
}

export function addUnread(agentId: string, agentName: string): void {
  if (_chatActive) return;
  _unreadCount++;
  _unreadByAgent[agentId] = (_unreadByAgent[agentId] || 0) + 1;
  _notifyLegacy();

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("openclaw:chat-message", {
        detail: { agentId, agentName },
      })
    );
  }
}

export function clearUnread(agentId?: string): void {
  if (agentId) {
    const count = _unreadByAgent[agentId] || 0;
    _unreadCount = Math.max(0, _unreadCount - count);
    delete _unreadByAgent[agentId];
  } else {
    _unreadCount = 0;
    _unreadByAgent = {};
  }
  _notifyLegacy();
}

export function subscribeChatStore(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function _notifyLegacy(): void {
  for (const l of _listeners) {
    try { l(); } catch { /* ignore */ }
  }
}

/* ═══════════════════════════════════════════════════
 * PART 2: Ping Agent persistent chat panel
 * ═══════════════════════════════════════════════════ */

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  timestamp: number;
  agentId?: string;
};

export type PingChatState = {
  messages: ChatMessage[];
  agentId: string;
  sending: boolean;
  open: boolean;
  unread: number;
};

/* ── localStorage persistence ── */

const STORAGE_KEY = "openclaw-ping-chat";
const MAX_PERSISTED_MESSAGES = 200; // keep last 200 messages
const MAX_MESSAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type PersistedState = {
  messages: ChatMessage[];
  agentId: string;
  unread: number;
};

function loadPersistedState(): Partial<PersistedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedState;
    // Prune old messages (older than 7 days)
    const cutoff = Date.now() - MAX_MESSAGE_AGE_MS;
    const messages = (parsed.messages || []).filter(
      (m) => m.timestamp > cutoff
    );
    return {
      messages,
      agentId: parsed.agentId || "",
      unread: parsed.unread || 0,
    };
  } catch {
    return {};
  }
}

function persistState(state: PingChatState): void {
  if (typeof window === "undefined") return;
  try {
    const toSave: PersistedState = {
      messages: state.messages.slice(-MAX_PERSISTED_MESSAGES),
      agentId: state.agentId,
      unread: state.unread,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/* ── Server snapshot (stable empty state for SSR) ── */

const SERVER_PING_SNAPSHOT: PingChatState = Object.freeze({
  messages: [],
  agentId: "",
  sending: false,
  open: false,
  unread: 0,
});

/* ── State initialization ── */

const persisted = loadPersistedState();

let pingState: PingChatState = {
  messages: persisted.messages || [],
  agentId: persisted.agentId || "",
  sending: false,
  open: false,
  unread: persisted.unread || 0,
};

const pingListeners = new Set<Listener>();

let _persistTimer: ReturnType<typeof setTimeout> | null = null;

function emitPing() {
  pingListeners.forEach((fn) => { try { fn(); } catch { /* */ } });
  // Debounce localStorage writes during rapid updates (e.g. streaming)
  if (!_persistTimer) {
    _persistTimer = setTimeout(() => {
      _persistTimer = null;
      persistState(pingState);
    }, 300);
  }
}

/** Flush pending persist immediately (call after send completes, clear, etc.) */
function flushPersist() {
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  persistState(pingState);
}

function notifyDesktop(title: string, text: string, tag: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  const preview = text.length > 120 ? text.slice(0, 117) + "…" : text;
  const n = new Notification(title, {
    body: preview,
    icon: "/favicon.ico",
    tag,
    requireInteraction: false,
  });

  n.onclick = () => {
    window.focus();
    chatStore.open();
    n.close();
  };

  setTimeout(() => n.close(), 8000);
}

export const chatStore = {
  getSnapshot(): PingChatState {
    return pingState;
  },

  getServerSnapshot(): PingChatState {
    return SERVER_PING_SNAPSHOT;
  },

  subscribe(listener: Listener): () => void {
    pingListeners.add(listener);
    return () => pingListeners.delete(listener);
  },

  open() {
    pingState = { ...pingState, open: true, unread: 0 };
    emitPing();
  },

  close() {
    pingState = { ...pingState, open: false };
    emitPing();
  },

  toggle() {
    if (pingState.open) chatStore.close();
    else chatStore.open();
  },

  setAgent(agentId: string) {
    pingState = { ...pingState, agentId };
    emitPing();
  },

  clearMessages() {
    pingState = { ...pingState, messages: [], unread: 0 };
    emitPing();
    flushPersist();
  },

  async send(prompt: string) {
    if (!prompt.trim() || !pingState.agentId || pingState.sending) return;

    // Capture agentId before any async work so setAgent() during flight
    // doesn't change which agent this request targets
    const agentId = pingState.agentId;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: prompt.trim(),
      timestamp: Date.now(),
      agentId,
    };

    pingState = { ...pingState, messages: [...pingState.messages, userMsg], sending: true };
    emitPing();
    const chatBody = JSON.stringify({
      agentId,
      messages: [
        {
          role: "user",
          id: userMsg.id,
          parts: [{ type: "text", text: userMsg.text }],
        },
      ],
    });

    try {
      // The /api/chat route already tries streaming via OpenResponses first
      // and falls back to CLI. It returns plain text (streamed or all-at-once).
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: chatBody,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(errBody || `${res.status} ${res.statusText}`);
      }

      // Read as a stream to show progressive text in the ping panel
      let text = "";
      const assistantMsgId = crypto.randomUUID();

      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let gotFirstChunk = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });

          // Clear 'sending' (typing indicator) once first chunk arrives
          // so the UI shows streaming text instead of "Agent is thinking..."
          if (!gotFirstChunk) {
            gotFirstChunk = true;
          }

          // Update the streaming message in-place for progressive display
          const streamingMsg: ChatMessage = {
            id: assistantMsgId,
            role: "assistant",
            text: text.trim(),
            timestamp: Date.now(),
            agentId,
          };
          const streamIdx = pingState.messages.findIndex((m) => m.id === assistantMsgId);
          const streamUpdated = [...pingState.messages];
          if (streamIdx >= 0) streamUpdated[streamIdx] = streamingMsg;
          else streamUpdated.push(streamingMsg);
          pingState = {
            ...pingState,
            messages: streamUpdated,
            sending: !gotFirstChunk,
          };
          // emitPing() debounces localStorage writes; UI updates are immediate
          emitPing();
        }

        // Flush persist after stream completes
        flushPersist();
      } else {
        text = await res.text();
      }

      // Finalize the message
      const trimmed = text.trim();
      if (!trimmed) {
        // Empty response — show as error instead of blank bubble
        throw new Error("Agent returned an empty response. The gateway may still be starting up — try again in a moment.");
      }

      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        text: trimmed,
        timestamp: Date.now(),
        agentId,
      };

      const isStillOpen = pingState.open;
      const finalIdx = pingState.messages.findIndex((m) => m.id === assistantMsgId);
      const finalUpdated = [...pingState.messages];
      if (finalIdx >= 0) finalUpdated[finalIdx] = assistantMsg;
      else finalUpdated.push(assistantMsg);
      pingState = {
        ...pingState,
        messages: finalUpdated,
        sending: false,
        unread: isStillOpen ? 0 : pingState.unread + 1,
      };
      emitPing();
      flushPersist();

      if (!isStillOpen) {
        chatStore._notify(agentId, trimmed);
      }
    } catch (err) {
      const rawErr = err instanceof Error ? err.message : String(err);
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "error",
        text: rawErr,
        timestamp: Date.now(),
        agentId,
      };

      const isStillOpen = pingState.open;
      pingState = {
        ...pingState,
        messages: [...pingState.messages, errMsg],
        sending: false,
        unread: isStillOpen ? 0 : pingState.unread + 1,
      };
      emitPing();
      flushPersist();

      if (!isStillOpen) {
        chatStore._notify(agentId, "Error getting response");
      }
    }
  },

  pushSystemMessage(text: string, opts?: { notifyDesktop?: boolean }) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: trimmed,
      timestamp: Date.now(),
      agentId: "mission-control",
    };

    const isStillOpen = pingState.open;
    pingState = {
      ...pingState,
      messages: [...pingState.messages, msg],
      unread: isStillOpen ? 0 : pingState.unread + 1,
    };
    emitPing();

    if (typeof window !== "undefined" && !isStillOpen) {
      window.dispatchEvent(
        new CustomEvent("openclaw:chat-message", {
          detail: { agentId: "mission-control", agentName: "Mission Control" },
        })
      );
    }

    if (!isStillOpen && opts?.notifyDesktop !== false) {
      notifyDesktop("Mission Control alert", trimmed, "openclaw-mission-control-alert");
    }
  },

  requestNotificationPermission() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  },

  _notify(agentId: string, text: string) {
    notifyDesktop(`Agent ${agentId} responded`, text, "openclaw-ping-chat");
  },
};
