// Live updates to open browser tabs: a hub that keeps the open event streams (SSE) and sends each one the same events.

import type { ServerResponse } from 'node:http';

// The "state" event: the whole picture the browser needs.
type StatePayload = {
  manifest: unknown; // tightened to Manifest in Task 3
  thread: unknown[]; // viewer messages and Claude's replies, in time order, each with a role
  claude_connected: boolean;
  now: number;
};

// The "chapter" event: a chapter list change, with the changed chapter's id and a reason when there is one.
type ChapterPayload = {
  op: string;
  id?: string;
  reason?: string;
  manifest: unknown; // tightened to Manifest in Task 3
};

// The "reply" event: Claude's stored answer to a viewer event.
type ReplyPayload = {
  id: string;
  ts: string;
  in_reply_to: string;
  text: string;
  sources?: { file: string; lines: unknown }[];
  role: 'claude';
};

// The "ping" event: the time the hub sent it, so a dead connection shows up.
type PingPayload = { now: number };

// The four events the server sends, each with its payload.
type StreamEvent =
  | { event: 'state'; data: StatePayload }
  | { event: 'chapter'; data: ChapterPayload }
  | { event: 'reply'; data: ReplyPayload }
  | { event: 'ping'; data: PingPayload };

// The name of an event, and the payload that goes with a given name.
type StreamEventName = StreamEvent['event'];
type StreamData<E extends StreamEventName> = Extract<StreamEvent, { event: E }>['data'];

// Sends one event to one client (or to all, for the hub's broadcast).
type Send = <E extends StreamEventName>(event: E, data: StreamData<E>) => void;

// The hub: adds a client stream (returning a sender for it), broadcasts, counts clients and closes everything.
type Hub = { add: (res: ServerResponse) => Send; broadcast: Send; size: () => number; close: () => void };

// Options for the hub: how often the ping goes out, in milliseconds.
type HubOptions = { pingMs?: number };

// Turns one event into the exact text sent on the wire. JSON.stringify never leaves a raw newline in the data.
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Makes a hub. pingMs is how often a "ping" goes to every client so a dead connection shows up.
function createHub({ pingMs = 15000 }: HubOptions = {}): Hub {
  // A client that has this many unsent bytes waiting is not reading; it is dropped (a browser reconnects and gets fresh state).
  const MAX_BACKLOG = 1024 * 1024;
  const clients = new Set<ServerResponse>();

  // Forgets a client (its socket closed or failed).
  function drop(res: ServerResponse): void {
    clients.delete(res);
  }

  // Sends one frame to one client; if the write fails the client is dropped, never thrown at the caller.
  function sendTo(res: ServerResponse, event: string, data: unknown): void {
    try {
      res.write(frame(event, data));
      if (res.writableLength > MAX_BACKLOG) throw new Error('client is not reading');
    } catch {
      drop(res);
      try { if (res.destroy) res.destroy(); } catch { /* already gone */ }
    }
  }

  // Sends an event to every connected client.
  function broadcast<E extends StreamEventName>(event: E, data: StreamData<E>): void {
    for (const res of [...clients]) sendTo(res, event, data);
  }

  // The ping timer is unref()ed so an idle hub never keeps the process alive.
  const timer = setInterval(() => broadcast('ping', { now: Date.now() }), pingMs);
  timer.unref();

  // Starts a stream on a response: writes the SSE headers, tracks the client, and returns a sender for that client only.
  function add(res: ServerResponse): Send {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    clients.add(res);
    res.on('close', () => drop(res));
    res.on('error', () => drop(res));
    return (event, data) => sendTo(res, event, data);
  }

  // Stops the timer and ends every open stream so the server can shut down.
  function close(): void {
    clearInterval(timer);
    for (const res of [...clients]) {
      drop(res);
      try { res.end(); } catch { /* already gone */ }
    }
  }

  return { add, broadcast, size: () => clients.size, close };
}

export { createHub };
export type { Hub, StreamEvent, StreamEventName, StreamData, Send, HubOptions, StatePayload, ChapterPayload, ReplyPayload, PingPayload };
