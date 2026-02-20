/**
 * In-memory broadcast for kanban updates.
 * When the server writes kanban.json (PUT or POST init), it notifies all
 * SSE subscribers so clients can refetch without polling.
 * Works on any install (Mac, VPC) — no Redis or file watcher required.
 */

export type KanbanLiveEvent = { type: "kanban-updated" };

const subscribers = new Set<(event: KanbanLiveEvent) => void>();

export function subscribeKanban(send: (event: KanbanLiveEvent) => void): () => void {
  subscribers.add(send);
  return () => subscribers.delete(send);
}

export function notifyKanbanUpdated(): void {
  const event: KanbanLiveEvent = { type: "kanban-updated" };
  for (const send of subscribers) {
    try {
      send(event);
    } catch {
      subscribers.delete(send);
    }
  }
}
