/**
 * Lightweight pub/sub store for chat unread state.
 * Shared across ChatView, Sidebar, and Header.
 *
 * No React context needed — just a simple module-level store
 * with subscribe/publish for cross-component communication.
 */

type Listener = () => void;

let _unreadCount = 0;
let _unreadByAgent: Record<string, number> = {};
let _chatActive = false; // is the chat tab currently visible?
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
    // Clear all unread when user opens chat
    _unreadCount = 0;
    _unreadByAgent = {};
    _notify();
  }
}

export function addUnread(agentId: string, agentName: string): void {
  if (_chatActive) return; // Don't count if user is looking at chat
  _unreadCount++;
  _unreadByAgent[agentId] = (_unreadByAgent[agentId] || 0) + 1;
  _notify();

  // Fire a custom event for toast notifications
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
  _notify();
}

export function subscribeChatStore(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function _notify(): void {
  for (const l of _listeners) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}
