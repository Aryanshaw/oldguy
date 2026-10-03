import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { openStream, type StreamHandlers } from '@/api/stream';
import { appState } from '@/test/fixtures';

class FakeES {
  static all: FakeES[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(public url: string) {
    FakeES.all.push(this);
  }
  addEventListener(n: string, fn: (e: MessageEvent) => void) {
    (this.listeners[n] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data: string) {
    this.listeners[name]?.forEach((f) => f({ data } as MessageEvent));
  }
}

function setup(getState = vi.fn().mockResolvedValue(appState)) {
  const h: StreamHandlers = {
    onState: vi.fn(),
    onReply: vi.fn(),
    onChapter: vi.fn(),
    onStatus: vi.fn(),
  };
  const s = openStream(h, {
    EventSource: FakeES as unknown as typeof EventSource,
    getState,
  });
  return { h, s, getState };
}
const last = () => FakeES.all[FakeES.all.length - 1];

beforeEach(() => {
  FakeES.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('openStream', () => {
  it('delivers state, reply and chapter with parsed data', () => {
    const { h } = setup();
    last().emit('state', JSON.stringify(appState));
    last().emit('reply', '{"id":"rep_2"}');
    last().emit('chapter', '{"op":"scan","manifest":{}}');
    expect(h.onState).toHaveBeenCalledWith(appState);
    expect(h.onReply).toHaveBeenCalledWith({ id: 'rep_2' });
    expect(h.onChapter).toHaveBeenCalledWith({ op: 'scan', manifest: {} });
    expect(h.onStatus).toHaveBeenCalledWith('open');
  });

  it('ignores a data line that is not JSON', () => {
    const { h } = setup();
    expect(() => last().emit('state', 'not json')).not.toThrow();
    expect(h.onState).not.toHaveBeenCalled();
  });

  it('reconnects after an error: reconnecting, getState, new source after 1 s', async () => {
    const { h, getState } = setup();
    const first = last();
    first.onerror?.();
    expect(h.onStatus).toHaveBeenCalledWith('reconnecting');
    expect(first.closed).toBe(true);
    expect(getState).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeES.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(h.onState).toHaveBeenCalledWith(appState);
    expect(FakeES.all).toHaveLength(2);
  });

  it('reports gone on a 403 and opens nothing more', async () => {
    const { h } = setup(vi.fn().mockRejectedValue(new ApiError(403, 'forbidden')));
    last().onerror?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.onStatus).toHaveBeenLastCalledWith('gone');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeES.all).toHaveLength(1);
  });

  it('reports gone after five failures, backing off 1, 2, 4, 8 s', async () => {
    const getState = vi.fn().mockRejectedValue(new ApiError(0, 'the server did not answer'));
    const { h } = setup(getState);
    last().onerror?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(getState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(getState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getState).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(getState).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8000);
    expect(getState).toHaveBeenCalledTimes(4);
    expect(h.onStatus).toHaveBeenLastCalledWith('gone');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getState).toHaveBeenCalledTimes(4);
    expect(FakeES.all).toHaveLength(1);
  });

  it('a ping resets the failure count', async () => {
    const getState = vi.fn().mockRejectedValueOnce(new ApiError(0, 'x')).mockResolvedValue(appState);
    const { h } = setup(getState);
    last().onerror?.();
    await vi.advanceTimersByTimeAsync(3000); // fail, then retry ok
    expect(FakeES.all).toHaveLength(2);
    last().emit('ping', '{"now":1}');
    last().onerror?.();
    await vi.advanceTimersByTimeAsync(1000); // delay is back to 1 s
    expect(FakeES.all).toHaveLength(3);
    expect(h.onStatus).not.toHaveBeenCalledWith('gone');
  });

  it('treats 40 s of silence as an error', async () => {
    const { h } = setup();
    await vi.advanceTimersByTimeAsync(39_999);
    expect(h.onStatus).not.toHaveBeenCalledWith('reconnecting');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.onStatus).toHaveBeenCalledWith('reconnecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeES.all).toHaveLength(2);
  });

  it('events keep the silence timer from firing', async () => {
    const { h } = setup();
    await vi.advanceTimersByTimeAsync(30_000);
    last().emit('ping', '{"now":1}');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.onStatus).not.toHaveBeenCalledWith('reconnecting');
  });

  it('close() stops timers and closes the source', async () => {
    const { h, getState, s } = setup();
    const src = last();
    s.close();
    expect(src.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.onStatus).not.toHaveBeenCalledWith('reconnecting');
    expect(getState).not.toHaveBeenCalled();
  });

  it('close() during a pending retry cancels it', async () => {
    const { getState, s } = setup();
    last().onerror?.();
    s.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getState).not.toHaveBeenCalled();
    expect(FakeES.all).toHaveLength(1);
  });
});
