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

function emitPing() {
  pingListeners.forEach((fn) => { try { fn(); } catch { /* */ } });
  // Persist on every state change (debounced writes are overkill for this size)
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
  },

  async send(prompt: string) {
    if (!prompt.trim() || !pingState.agentId || pingState.sending) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: prompt.trim(),
      timestamp: Date.now(),
      agentId: pingState.agentId,
    };

    pingState = { ...pingState, messages: [...pingState.messages, userMsg], sending: true };
    emitPing();

    const agentId = pingState.agentId;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: agentId,
          messages: [
            {
              role: "user",
              id: userMsg.id,
              parts: [{ type: "text", text: userMsg.text }],
            },
          ],
        }),
      });

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: text.trim(),
        timestamp: Date.now(),
        agentId,
      };

      const isStillOpen = pingState.open;
      pingState = {
        ...pingState,
        messages: [...pingState.messages, assistantMsg],
        sending: false,
        unread: isStillOpen ? 0 : pingState.unread + 1,
      };
      emitPing();

      if (!isStillOpen) {
        chatStore._notify(agentId, text.trim());
      }
    } catch (err) {
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "error",
        text: String(err),
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
