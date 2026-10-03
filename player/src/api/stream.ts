import { getState as defaultGetState } from '@/api/client';
import type { AppState, Manifest, ThreadEntry } from '@/types';

export interface StreamHandlers {
  onState(s: AppState): void;
  onReply(r: ThreadEntry): void;
  onChapter(e: { op: string; id?: string; reason?: string; manifest: Manifest }): void;
  onStatus(s: 'open' | 'reconnecting' | 'gone'): void;
}

const SILENCE_MS = 40_000;
const MAX_FAILURES = 5;
const DELAYS_MS = [1000, 2000, 4000, 8000];

export function openStream(
  h: StreamHandlers,
  deps: {
    EventSource?: typeof EventSource;
    setTimeout?: typeof setTimeout;
    getState?: typeof defaultGetState;
  } = {},
): { close(): void } {
  const ES = deps.EventSource ?? EventSource;
  const later = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const fetchState = deps.getState ?? defaultGetState;

  let source: EventSource | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let closed = false;
  let isOpen = false;

  const stopWatchdog = () => {
    if (watchdog !== undefined) clearTimeout(watchdog);
    watchdog = undefined;
  };
  const armWatchdog = () => {
    stopWatchdog();
    watchdog = later(() => fail(), SILENCE_MS) as ReturnType<typeof setTimeout>;
  };
  const dropSource = () => {
    stopWatchdog();
    if (source) {
      source.onerror = null;
      source.close();
      source = null;
    }
  };
  const gone = () => {
    closed = true;
    dropSource();
    h.onStatus('gone');
  };

  const heard = () => {
    if (!isOpen) {
      isOpen = true;
      h.onStatus('open');
    }
    armWatchdog();
  };

  const listen = (es: EventSource, name: string, fn: (data: any) => void) => {
    es.addEventListener(name, (ev: Event) => {
      if (closed || es !== source) return;
      heard();
      if (name === 'ping') {
        failures = 0;
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse((ev as MessageEvent).data as string);
      } catch {
        return;
      }
      fn(data);
    });
  };

  function connect() {
    if (closed) return;
    const es = new ES('/api/stream');
    source = es;
    es.onopen = () => {
      if (closed || es !== source) return;
      heard();
    };
    es.onerror = () => {
      if (es === source) fail();
    };
    listen(es, 'state', (d) => h.onState(d as AppState));
    listen(es, 'reply', (d) => h.onReply(d as ThreadEntry));
    listen(es, 'chapter', (d) => h.onChapter(d));
    listen(es, 'ping', () => {});
    armWatchdog();
  }

  function fail() {
    if (closed) return;
    dropSource();
    isOpen = false;
    failures += 1;
    h.onStatus('reconnecting');
    if (failures >= MAX_FAILURES) return gone();
    scheduleRetry();
  }

  function scheduleRetry() {
    const delay = DELAYS_MS[Math.min(failures - 1, DELAYS_MS.length - 1)];
    retry = later(attempt, delay) as ReturnType<typeof setTimeout>;
  }

  async function attempt() {
    retry = undefined;
    if (closed) return;
    let state: AppState;
    try {
      state = await fetchState();
    } catch (e) {
      if (closed) return;
      if ((e as { status?: number }).status === 403) return gone();
      failures += 1;
      if (failures >= MAX_FAILURES) return gone();
      return scheduleRetry();
    }
    if (closed) return;
    h.onState(state);
    connect();
  }

  connect();

  return {
    close() {
      closed = true;
      if (retry !== undefined) clearTimeout(retry);
      retry = undefined;
      dropSource();
    },
  };
}
