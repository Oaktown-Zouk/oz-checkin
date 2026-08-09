import type { ServerResponse } from "node:http";

const clients = new Set<ServerResponse>();

export function addSseClient(res: ServerResponse): void {
  clients.add(res);
}

export function removeSseClient(res: ServerResponse): void {
  clients.delete(res);
}

// Called on graceful shutdown — SSE connections are intentionally long-lived and never
// close on their own, so without this, closing the HTTP server would hang waiting for
// them to end naturally.
export function closeAllSseClients(): void {
  for (const client of clients) {
    client.end();
  }
  clients.clear();
}

// Fire-and-forget: tells every connected tab "something changed, go refetch." No
// payload needed beyond a debug-friendly reason — at this app's scale (~1k students) a
// full refetch is cheap, so there's no reason to diff and ship what changed.
export function broadcastChange(reason: string): void {
  const payload = `event: changed\ndata: ${JSON.stringify({ reason })}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}
