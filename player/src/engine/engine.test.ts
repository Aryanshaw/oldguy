import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '@/types';
import { asVideo, makeFakeVideo, type FakeVideo } from '@/test/fakeVideo';
import { createEngine, type Engine } from './engine';

const ch = (id: string, over: Partial<Chapter> = {}): Chapter => ({
  id,
  title: id,
  parent_id: null,
  status: 'ready',
  quality: 'full',
  duration_s: 30,
  poster: null,
  question: null,
  ...over,
});
const url = (id: string) => `/v/${id}.mp4`;
const flush = () => new Promise((r) => setTimeout(r, 0));

let a: FakeVideo;
let b: FakeVideo;
let e: Engine;
const [c0, c1, c2, c3] = ['c0', 'c1', 'c2', 'c3'].map((id) => ch(id));

beforeEach(() => {
  a = makeFakeVideo();
  b = makeFakeVideo();
  e = createEngine({ a: asVideo(a), b: asVideo(b), urlFor: url });
});

describe('engine', () => {
  it('loads first chapter into a and preloads the next into b', () => {
    e.setChapters([c1, c2, c3]);
    expect(a.src).toBe(url('c1'));
    expect(b.src).toBe(url('c2'));
    expect(b.preload).toBe('auto');
    expect(e.position()).toEqual({ chapterId: 'c1', offset: 0 });
    expect(e.state()).toBe('idle');
  });

  it('swaps on ended, plays the new element, preloads the one after', async () => {
    const onChapter = vi.fn();
    e.setChapters([c1, c2, c3]);
    e.on('chapter', onChapter);
    await e.play();
    expect(a.paused).toBe(false);
    a.fire('ended');
    expect(e.visible()).toBe('b');
    expect(b.paused).toBe(false);
    expect(a.src).toBe(url('c3'));
    expect(onChapter).toHaveBeenCalledWith('c2');
    expect(e.position()?.chapterId).toBe('c2');
  });

  it('ended on the last chapter gives ended at its duration; play restarts from the first', async () => {
    e.setChapters([c1, c2]);
    await e.play();
    a.fire('ended');
    b.fire('ended');
    expect(e.state()).toBe('ended');
    expect(e.position()).toEqual({ chapterId: 'c2', offset: 30 });
    await e.play();
    expect(e.position()?.chapterId).toBe('c1');
    expect(e.state()).toBe('playing');
    expect(e.visible() === 'a' ? a.paused : b.paused).toBe(false);
  });

  it('uses the real element duration for the end position when known', async () => {
    e.setChapters([c1]);
    await e.play();
    a.duration = 31.4;
    a.fire('ended');
    expect(e.position()).toEqual({ chapterId: 'c1', offset: 31.4 });
  });

  it('seek within the current chapter sets currentTime without swapping', () => {
    e.setChapters([c1, c2, c3]);
    e.seek({ chapterId: 'c1', offset: 12 });
    expect(a.currentTime).toBe(12);
    expect(e.visible()).toBe('a');
  });

  it('seek to another chapter waits for canplay, then swaps and plays', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    e.seek({ chapterId: 'c3', offset: 5 });
    expect(b.src).toBe(url('c3'));
    expect(e.visible()).toBe('a');
    b.fire('canplay');
    expect(e.visible()).toBe('b');
    expect(b.currentTime).toBe(5);
    expect(b.paused).toBe(false);
    expect(a.paused).toBe(true);
  });

  it('a newer seek cancels an older pending one', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    e.seek({ chapterId: 'c3', offset: 5 });
    e.seek({ chapterId: 'c2', offset: 7 });
    b.fire('canplay');
    expect(e.position()?.chapterId).toBe('c2');
    expect(b.src).toBe(url('c2'));
    b.fire('canplay');
    expect(e.visible()).toBe('b');
    expect(b.currentTime).toBe(7);
  });

  it('a late canplay for a superseded seek does nothing', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    e.seek({ chapterId: 'c3', offset: 5 });
    e.seek({ chapterId: 'c1', offset: 2 }); // same chapter: cancels pending
    b.fire('canplay');
    expect(e.visible()).toBe('a');
    expect(a.currentTime).toBe(2);
  });

  it('ignores a seek to a chapter that is not playable', () => {
    e.setChapters([c1, ch('c2', { status: 'rendering' }), c3]);
    e.seek({ chapterId: 'c2', offset: 1 });
    e.seek({ chapterId: 'nope', offset: 1 });
    expect(b.src).toBe(url('c3'));
    expect(e.position()).toEqual({ chapterId: 'c1', offset: 0 });
  });

  it('Review Focus 2: inserting a chapter before the playhead keeps position and does not touch the visible element', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    a.fire('ended'); // now playing c2 on b
    b.currentTime = 10;
    const setSrc = vi.fn();
    const orig = Object.getOwnPropertyDescriptor(b, 'src')!;
    Object.defineProperty(b, 'src', { get: orig.get, set: (v) => { setSrc(v); orig.set!.call(b, v); }, configurable: true });
    e.setChapters([c0, c1, c2, c3]);
    expect(e.position()).toEqual({ chapterId: 'c2', offset: 10 });
    expect(setSrc).not.toHaveBeenCalled();
    expect(b.currentTime).toBe(10);
    expect(b.paused).toBe(false);
    expect(a.src).toBe(url('c3'));
  });

  it('Review Focus 2: a stale preloaded chapter is replaced by the one after it', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    expect(b.src).toBe(url('c2'));
    e.setChapters([c1, ch('c2', { status: 'stale' }), c3]);
    expect(b.src).toBe(url('c3'));
    expect(a.paused).toBe(false);
    expect(e.position()?.chapterId).toBe('c1');
  });

  it('Review Focus 2: removing the current chapter moves on and keeps playing; with nothing after it ends', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    a.fire('ended'); // c2 on b, a holds c3
    e.setChapters([c1, c3]);
    expect(e.position()).toEqual({ chapterId: 'c3', offset: 0 });
    expect(e.state()).toBe('playing');
    const vis = e.visible() === 'a' ? a : b;
    expect(vis.src).toBe(url('c3'));
    expect(vis.paused).toBe(false);

    e.setChapters([c1]);
    expect(e.state()).toBe('ended');
    expect(e.position()?.chapterId).toBe('c1');
    expect(a.paused && b.paused).toBe(true);
  });

  it('removing the current chapter when the next is not preloaded loads it into the visible element', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    e.setChapters([c3]);
    expect(e.position()).toEqual({ chapterId: 'c3', offset: 0 });
    expect(e.state()).toBe('playing');
    expect((e.visible() === 'a' ? a : b).paused).toBe(false);
  });

  it('setChapters([]) goes idle, clears sources, and play resolves doing nothing', async () => {
    e.setChapters([c1, c2]);
    await e.play();
    e.setChapters([]);
    expect(e.state()).toBe('idle');
    expect(e.position()).toBeNull();
    expect(a.src).toBe('');
    expect(b.src).toBe('');
    const calls = a.playCalls + b.playCalls;
    await expect(e.play()).resolves.toBeUndefined();
    expect(a.playCalls + b.playCalls).toBe(calls);
  });

  it('a chapter that turns ready and is next in order becomes the preloaded one', () => {
    e.setChapters([c1, ch('c2', { status: 'rendering' }), c3]);
    expect(b.src).toBe(url('c3'));
    e.setChapters([c1, c2, c3]);
    expect(b.src).toBe(url('c2'));
    expect(a.src).toBe(url('c1'));
  });

  it('a browser-blocked play() gives state blocked without throwing', async () => {
    e.setChapters([c1, c2]);
    a.blockPlay = true;
    await expect(e.play()).resolves.toBeUndefined();
    expect(e.state()).toBe('blocked');
  });

  it('a play() that resolves after a pause cannot flip state back to playing', async () => {
    e.setChapters([c1, c2]);
    const p = e.play();
    e.pause();
    await p;
    expect(e.state()).toBe('paused');
  });

  it('error on the visible element emits the id and moves to the next chapter', async () => {
    const onError = vi.fn();
    e.setChapters([c1, c2, c3]);
    e.on('error', onError);
    await e.play();
    a.fire('error');
    expect(onError).toHaveBeenCalledWith('c1');
    expect(e.position()?.chapterId).toBe('c2');
    expect(e.visible()).toBe('b');
    expect(b.paused).toBe(false);
  });

  it('error on the idle element emits the id and preloads the one after', () => {
    const onError = vi.fn();
    e.setChapters([c1, c2, c3]);
    e.on('error', onError);
    b.fire('error');
    expect(onError).toHaveBeenCalledWith('c2');
    expect(b.src).toBe(url('c3'));
    expect(e.position()?.chapterId).toBe('c1');
  });

  it('time events carry the current position', async () => {
    const onTime = vi.fn();
    e.setChapters([c1, c2]);
    e.on('time', onTime);
    await e.play();
    a.currentTime = 3.5;
    a.fire('timeupdate');
    expect(onTime).toHaveBeenLastCalledWith({ chapterId: 'c1', offset: 3.5 });
  });

  it('unsubscribe stops events', () => {
    const fn = vi.fn();
    e.setChapters([c1]);
    const off = e.on('time', fn);
    off();
    a.fire('timeupdate');
    expect(fn).not.toHaveBeenCalled();
  });

  it('destroy removes every listener and clears both sources', () => {
    const fn = vi.fn();
    e.setChapters([c1, c2]);
    e.on('time', fn);
    expect(a.listenerCount() + b.listenerCount()).toBeGreaterThan(0);
    e.destroy();
    expect(a.listenerCount()).toBe(0);
    expect(b.listenerCount()).toBe(0);
    expect(a.src).toBe('');
    expect(b.src).toBe('');
    expect(() => e.setChapters([c1])).not.toThrow();
    expect(a.src).toBe('');
  });

  it('never reassigns an unchanged src', () => {
    e.setChapters([c1, c2, c3]);
    const setSrc = vi.fn();
    for (const v of [a, b]) {
      const d = Object.getOwnPropertyDescriptor(v, 'src')!;
      Object.defineProperty(v, 'src', { get: d.get, set: (x) => { setSrc(x); d.set!.call(v, x); }, configurable: true });
    }
    e.setChapters([c1, c2, c3]);
    e.setChapters([{ ...c1 }, { ...c2, title: 'renamed' }, c3]);
    expect(setSrc).not.toHaveBeenCalled();
  });

  it('a pending seek target is not clobbered by setChapters', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    e.seek({ chapterId: 'c3', offset: 5 });
    e.setChapters([c1, c2, c3, ch('c4')]);
    expect(b.src).toBe(url('c3'));
    b.fire('canplay');
    expect(e.position()).toEqual({ chapterId: 'c3', offset: 5 });
    expect(a.src).toBe(url('c4'));
  });
});

describe('engine fix round 1', () => {
  it('F1a: visible errors during a pending seek, playback continues at the seek target', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    e.seek({ chapterId: 'c3', offset: 5 });
    a.fire('error');
    expect(b.src).toBe(url('c3'));
    b.fire('canplay');
    expect(e.position()).toEqual({ chapterId: 'c3', offset: 5 });
    expect(e.visible()).toBe('b');
    expect(e.state()).toBe('playing');
    expect(b.paused).toBe(false);
    b.fire('ended');
    expect(e.state()).toBe('ended');
  });

  it('F1b: pending target errors after the visible chapter ended, engine advances', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    e.seek({ chapterId: 'c3', offset: 5 });
    a.fire('ended');
    b.fire('error');
    expect(e.position()?.chapterId).toBe('c2');
    expect(e.visible()).toBe('b');
    expect(e.state()).toBe('playing');
    expect(b.paused).toBe(false);
  });

  it('F1c: pending target made unplayable by setChapters after the visible ended, engine advances', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    e.seek({ chapterId: 'c3', offset: 5 });
    a.fire('ended');
    e.setChapters([c1, c2]);
    expect(e.position()?.chapterId).toBe('c2');
    expect(e.state()).toBe('playing');
    expect((e.visible() === 'a' ? a : b).paused).toBe(false);
  });

  it('F2: seek then play after the last chapter ended starts at the seek target', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    a.fire('ended');
    b.fire('ended');
    a.fire('ended');
    expect(e.state()).toBe('ended');
    e.seek({ chapterId: 'c2', offset: 4 });
    await e.play();
    const idleEl = e.visible() === 'a' ? b : a;
    idleEl.fire('canplay');
    expect(e.position()).toEqual({ chapterId: 'c2', offset: 4 });
    expect(e.state()).toBe('playing');
    expect((e.visible() === 'a' ? a : b).paused).toBe(false);
  });

  it('F3: an errored chapter stays skipped across unrelated setChapters, with no second error', async () => {
    const onError = vi.fn();
    e.setChapters([c1, c2, c3]);
    e.on('error', onError);
    await e.play();
    b.fire('error');
    expect(b.src).toBe(url('c3'));
    e.setChapters([c1, { ...c2 }, c3, ch('c4')]);
    expect(b.src).toBe(url('c3'));
    expect(onError).toHaveBeenCalledTimes(1);
    e.seek({ chapterId: 'c2', offset: 1 });
    expect(b.src).toBe(url('c3'));
  });

  it('F3: an errored chapter is playable again after an update shows it not ready, then ready', async () => {
    e.setChapters([c1, c2, c3]);
    await e.play();
    b.fire('error');
    e.setChapters([c1, ch('c2', { status: 'rendering' }), c3]);
    e.setChapters([c1, c2, c3]);
    expect(b.src).toBe(url('c2'));
  });
});

void flush;
