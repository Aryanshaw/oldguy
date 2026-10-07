import { useSyncExternalStore } from 'react';
import { getState as defaultGetState, postMessage as defaultPostMessage } from '@/api/client';
import { openStream as defaultOpenStream, type StreamHandlers } from '@/api/stream';
import type { Manifest, ThreadEntry } from '@/types';

export type Link = 'loading' | 'open' | 'reconnecting' | 'gone' | 'forbidden' | 'error';

export interface Snapshot {
  link: Link;
  error: string | null;
  manifest: Manifest | null;
  thread: ThreadEntry[];
  claudeConnected: boolean;
  failReasons: Record<string, string>;
  sent: Record<string, true>;
}

type Context = { chapter_id: string; t: number };

export function createStore(
  deps: {
    getState?: typeof defaultGetState;
    postMessage?: typeof defaultPostMessage;
    openStream?: (h: StreamHandlers) => { close(): void };
  } = {},
) {
  const fetchState = deps.getState ?? defaultGetState;
  const post = deps.postMessage ?? defaultPostMessage;
  const open = deps.openStream ?? ((h: StreamHandlers) => defaultOpenStream(h));

  let snap: Snapshot = {
    link: 'loading',
    error: null,
    manifest: null,
    thread: [],
    claudeConnected: false,
    failReasons: {},
    sent: {},
  };
  const subs = new Set<() => void>();
  let stream: { close(): void } | null = null;
  // Bumped by start() and stop() so a load that finished late is ignored.
  let run = 0;
  // Keys of button presses whose request is still in flight.
  const pending = new Set<string>();

  const set = (patch: Partial<Snapshot>) => {
    const next = { ...snap, ...patch };
    if ((Object.keys(patch) as (keyof Snapshot)[]).every((k) => Object.is(next[k], snap[k]))) return;
    snap = next;
    for (const fn of [...subs]) fn();
  };
  const withEntry = (e: ThreadEntry): ThreadEntry[] =>
    snap.thread.some((t) => t.id === e.id) ? snap.thread : [...snap.thread, e];

  const handlers: StreamHandlers = {
    onState: (s) =>
      set({
        manifest: s.manifest,
        thread: s.thread,
        claudeConnected: s.claude_connected,
        link: snap.link === 'gone' ? 'gone' : 'open',
        error: null,
      }),
    onReply: (r) => {
      const thread = withEntry(r);
      if (thread !== snap.thread) set({ thread });
    },
    onChapter: (e) =>
      set({
        manifest: e.manifest,
        failReasons:
          e.id && e.reason ? { ...snap.failReasons, [e.id]: e.reason } : snap.failReasons,
      }),
    onStatus: (s) => set({ link: s }),
  };

  function start() {
    stream?.close();
    stream = null;
    const mine = ++run;
    set({ link: 'loading', error: null });
    fetchState().then(
      (s) => {
        if (mine !== run) return;
        handlers.onState(s);
        stream = open(handlers);
      },
      (e: unknown) => {
        if (mine !== run) return;
        const status = (e as { status?: number } | null)?.status;
        set(
          status === 403
            ? { link: 'forbidden', error: null }
            : { link: 'error', error: e instanceof Error ? e.message : String(e) },
        );
      },
    );
  }

  function stop() {
    run += 1;
    stream?.close();
    stream = null;
  }

  return {
    start,
    stop,
    retry: start,
    get: () => snap,
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    async ask(text: string, context?: Context): Promise<void> {
      const ev = await post({ type: 'message', text, context });
      const thread = withEntry({
        id: ev.id,
        ts: ev.ts,
        text: ev.text ?? text,
        context: ev.context ?? context,
        role: 'viewer',
      });
      if (thread !== snap.thread) set({ thread });
    },
    async press(
      kind: 'make_video' | 'just_text' | 'retry_chapter',
      key: string,
      context?: Context,
      ref?: string,
    ): Promise<void> {
      // One request per key: a double click must not ask Claude twice. A failed press frees the key for another try.
      if (pending.has(key) || snap.sent[key]) return;
      pending.add(key);
      try {
        await post(ref === undefined ? { type: kind, context } : { type: kind, context, ref });
        set({ sent: { ...snap.sent, [key]: true } });
      } finally {
        pending.delete(key);
      }
    },
  };
}

/** `pick` must return a stable value (a field of the snapshot, not a fresh object). */
export function useStore<T>(store: ReturnType<typeof createStore>, pick: (s: Snapshot) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(store.get()));
}
