import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import type { StreamHandlers } from '@/api/stream';
import { appState } from '@/test/fixtures';
import type { AppState, StoredEvent } from '@/types';
import { createStore } from './store';

function setup(opts: { getState?: () => Promise<AppState>; postMessage?: (b: any) => Promise<StoredEvent> } = {}) {
  let h!: StreamHandlers;
  const close = vi.fn();
  const openStream = vi.fn((handlers: StreamHandlers) => {
    h = handlers;
    return { close };
  });
  const getState = vi.fn(opts.getState ?? (() => Promise.resolve(appState)));
  const postMessage = vi.fn(opts.postMessage ?? (() => Promise.resolve({ id: 'evt_9', ts: 'T9', type: 'message' } as StoredEvent)));
  const store = createStore({ getState, postMessage, openStream } as any);
  return { store, getState, postMessage, openStream, close, handlers: () => h };
}
const started = async (s = setup()) => {
  s.store.start();
  await vi.waitFor(() => expect(s.store.get().link).not.toBe('loading'));
  return s;
};

describe('store', () => {
  it('loads state then opens the stream', async () => {
    const s = setup();
    expect(s.store.get().link).toBe('loading');
    s.store.start();
    await vi.waitFor(() => expect(s.openStream).toHaveBeenCalled());
    const snap = s.store.get();
    expect(snap.link).toBe('open');
    expect(snap.manifest).toEqual(appState.manifest);
    expect(snap.thread).toEqual(appState.thread);
    expect(snap.claudeConnected).toBe(true);
  });

  it('403 on first load gives forbidden; other failures give error; retry tries again', async () => {
    let fail: unknown = new ApiError(403, 'no');
    const s = setup({ getState: () => (fail ? Promise.reject(fail) : Promise.resolve(appState)) });
    s.store.start();
    await vi.waitFor(() => expect(s.store.get().link).toBe('forbidden'));
    expect(s.openStream).not.toHaveBeenCalled();
    fail = new ApiError(500, 'boom');
    s.store.retry();
    await vi.waitFor(() => expect(s.store.get().link).toBe('error'));
    expect(s.store.get().error).toBe('boom');
    fail = null;
    s.store.retry();
    await vi.waitFor(() => expect(s.store.get().link).toBe('open'));
    expect(s.store.get().error).toBeNull();
    expect(s.openStream).toHaveBeenCalledTimes(1);
  });

  it('onState replaces manifest, thread and claudeConnected', async () => {
    const s = await started();
    s.handlers().onState({ ...appState, thread: [], claude_connected: false, manifest: { ...appState.manifest, title: 'New' } });
    const snap = s.store.get();
    expect(snap.manifest?.title).toBe('New');
    expect(snap.thread).toEqual([]);
    expect(snap.claudeConnected).toBe(false);
  });

  it('a reply arriving twice appears once', async () => {
    const s = await started();
    const r = { id: 'rep_2', ts: 'T', role: 'claude' as const, text: 'hi' };
    s.handlers().onReply(r);
    s.handlers().onReply(r);
    expect(s.store.get().thread.filter((e) => e.id === 'rep_2')).toHaveLength(1);
  });

  it('onChapter replaces manifest and stores failReasons when id and reason are given', async () => {
    const s = await started();
    const manifest = { ...appState.manifest, chapters: [] };
    s.handlers().onChapter({ op: 'update', manifest });
    expect(s.store.get().manifest?.chapters).toEqual([]);
    expect(s.store.get().failReasons).toEqual({});
    s.handlers().onChapter({ op: 'failed', id: 'writes', reason: 'folder missing', manifest });
    expect(s.store.get().failReasons).toEqual({ writes: 'folder missing' });
  });

  it('ask appends the returned event as a viewer entry; a following state does not duplicate', async () => {
    const s = await started();
    const ctx = { chapter_id: 'overview', t: 3 };
    s.postMessage.mockResolvedValueOnce({ id: 'evt_9', ts: 'T9', type: 'message', text: 'q?', context: ctx });
    await s.store.ask('q?', ctx);
    expect(s.postMessage).toHaveBeenCalledWith({ type: 'message', text: 'q?', context: ctx });
    const last = s.store.get().thread.at(-1);
    expect(last).toEqual({ id: 'evt_9', ts: 'T9', text: 'q?', context: ctx, role: 'viewer' });
    s.handlers().onState({ ...appState, thread: [...appState.thread, last!] });
    expect(s.store.get().thread.filter((e) => e.id === 'evt_9')).toHaveLength(1);
  });

  it('ask does not duplicate when the state event beat the response', async () => {
    const s = await started();
    s.handlers().onState({
      ...appState,
      thread: [...appState.thread, { id: 'evt_9', ts: 'T9', role: 'viewer', text: 'q?' }],
    });
    await s.store.ask('q?');
    expect(s.store.get().thread.filter((e) => e.id === 'evt_9')).toHaveLength(1);
  });

  it('ask rejection leaves the thread unchanged and rethrows', async () => {
    const err = new ApiError(500, 'bad');
    const s = await started(setup({ postMessage: () => Promise.reject(err) }));
    const before = s.store.get();
    await expect(s.store.ask('x')).rejects.toBe(err);
    expect(s.store.get()).toBe(before);
  });

  it('press posts, records sent[key], and does not touch the thread', async () => {
    const s = await started();
    const ctx = { chapter_id: 'overview', t: 1 };
    await s.store.press('make_video', 'k1', ctx, 'rep_4');
    expect(s.postMessage).toHaveBeenCalledWith({ type: 'make_video', context: ctx, ref: 'rep_4' });
    expect(s.store.get().sent).toEqual({ k1: true });
    expect(s.store.get().thread).toEqual(appState.thread);
  });

  it('press of a key that is pending or already sent posts nothing', async () => {
    let resolve!: (e: StoredEvent) => void;
    const s = await started(setup({ postMessage: () => new Promise<StoredEvent>((r) => (resolve = r)) }));
    const first = s.store.press('make_video', 'mv:1');
    await s.store.press('make_video', 'mv:1');
    expect(s.postMessage).toHaveBeenCalledTimes(1);
    resolve({ id: 'evt_2', ts: 'T', type: 'make_video' });
    await first;
    await s.store.press('make_video', 'mv:1');
    expect(s.postMessage).toHaveBeenCalledTimes(1);
    expect(s.store.get().sent).toEqual({ 'mv:1': true });
  });

  it('a failed press can be pressed again', async () => {
    const post = vi.fn().mockRejectedValueOnce(new ApiError(500, 'bad')).mockResolvedValue({ id: 'evt_3', ts: 'T', type: 'just_text' });
    const s = await started(setup({ postMessage: post }));
    await expect(s.store.press('just_text', 'jt:a')).rejects.toBeInstanceOf(ApiError);
    await s.store.press('just_text', 'jt:a');
    expect(post).toHaveBeenCalledTimes(2);
    expect(s.store.get().sent).toEqual({ 'jt:a': true });
  });

  it('press rejection does not record sent and rethrows', async () => {
    const s = await started(setup({ postMessage: () => Promise.reject(new ApiError(500, 'bad')) }));
    await expect(s.store.press('just_text', 'k')).rejects.toBeInstanceOf(ApiError);
    expect(s.store.get().sent).toEqual({});
  });

  it('stream status gone, reconnecting, then a fresh state returns to open', async () => {
    const s = await started();
    s.handlers().onStatus('reconnecting');
    expect(s.store.get().link).toBe('reconnecting');
    s.handlers().onState(appState);
    expect(s.store.get().link).toBe('open');
    s.handlers().onStatus('gone');
    expect(s.store.get().link).toBe('gone');
  });

  it('stop closes the stream and ignores a load still in flight', async () => {
    const s = await started();
    s.store.stop();
    expect(s.close).toHaveBeenCalled();

    let resolve!: (a: AppState) => void;
    const p = setup({ getState: () => new Promise((r) => (resolve = r)) });
    p.store.start();
    p.store.stop();
    resolve(appState);
    await Promise.resolve();
    await Promise.resolve();
    expect(p.openStream).not.toHaveBeenCalled();
    expect(p.store.get().link).toBe('loading');
  });

  it('get() is stable until something changes; subscribers are called once per change', async () => {
    const s = await started();
    const a = s.store.get();
    expect(s.store.get()).toBe(a);
    const fn = vi.fn();
    const off = s.store.subscribe(fn);
    s.handlers().onReply({ id: 'r', ts: 'T', role: 'claude', text: 'x' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.store.get()).not.toBe(a);
    s.handlers().onStatus('open');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    s.handlers().onReply({ id: 'r2', ts: 'T', role: 'claude', text: 'x' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('accepts a manifest with zero chapters', async () => {
    const s = await started(setup({ getState: () => Promise.resolve({ ...appState, manifest: { ...appState.manifest, chapters: [] } }) }));
    expect(s.store.get().link).toBe('open');
    expect(s.store.get().manifest?.chapters).toEqual([]);
  });
});
