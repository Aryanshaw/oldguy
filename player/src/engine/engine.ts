import type { Chapter } from '@/types';
import { neighbour, playable, type Position } from '@/lib/timeline';

export type EngineState = 'idle' | 'playing' | 'paused' | 'blocked' | 'ended'; // blocked = browser refused autoplay

export interface Engine {
  setChapters(chapters: Chapter[]): void;
  play(): Promise<void>;
  pause(): void;
  seek(p: Position): void;
  position(): Position | null;
  state(): EngineState;
  visible(): 'a' | 'b';
  on(ev: 'time' | 'chapter' | 'state' | 'error', fn: (detail?: unknown) => void): () => void;
  destroy(): void;
}

type Ev = 'time' | 'chapter' | 'state' | 'error';

/**
 * Two <video> elements: one visible, one idle and preloading the next playable chapter.
 * Position is always {chapterId, offset}; global seconds are never stored.
 */
export function createEngine(o: { a: HTMLVideoElement; b: HTMLVideoElement; urlFor: (id: string) => string }): Engine {
  let vis = o.a;
  let idle = o.b;
  let chapters: Chapter[] = [];
  let cur: string | null = null;
  let st: EngineState = 'idle';
  let atEnd = false; // finished the last chapter: position reports its duration
  let destroyed = false;
  let playGen = 0; // invalidates play() promises that settle late
  let seekGen = 0; // invalidates pending seeks
  let pending: { id: string; offset: number; gen: number } | null = null;
  let errored = new Set<string>(); // chapters whose element failed; skipped when picking the next one

  const assigned = new Map<HTMLVideoElement, string | null>([[o.a, null], [o.b, null]]);
  const listeners: Record<Ev, Set<(d?: unknown) => void>> = {
    time: new Set(),
    chapter: new Set(),
    state: new Set(),
    error: new Set(),
  };
  const emit = (ev: Ev, detail?: unknown) => {
    for (const fn of [...listeners[ev]]) fn(detail);
  };

  const setState = (s: EngineState) => {
    if (st === s) return;
    st = s;
    emit('state', s);
  };

  /** Assign an element's source only when the chapter changed; null clears it. */
  function setSrc(el: HTMLVideoElement, id: string | null) {
    if (assigned.get(el) === id) return;
    assigned.set(el, id);
    if (id === null) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      return;
    }
    el.preload = 'auto';
    el.src = o.urlFor(id);
  }

  const chapterOf = (id: string | null) => chapters.find((c) => c.id === id) ?? null;
  const isPlayable = (id: string) => playable(chapters).some((c) => c.id === id);

  function nextOf(id: string): Chapter | null {
    let n = neighbour(chapters, id, 1);
    while (n && errored.has(n.id)) n = neighbour(chapters, n.id, 1);
    return n;
  }

  /** Keep the idle element on the next playable chapter, unless it is holding a pending seek target. */
  function ensureIdle() {
    if (pending) return;
    setSrc(idle, cur ? (nextOf(cur)?.id ?? null) : null);
  }

  function position(): Position | null {
    if (!cur) return null;
    if (atEnd) {
      const d = vis.duration;
      const fallback = chapterOf(cur)?.duration_s;
      return { chapterId: cur, offset: Number.isFinite(d) && d > 0 ? d : (fallback ?? vis.currentTime) };
    }
    return { chapterId: cur, offset: vis.currentTime };
  }

  const emitTime = () => emit('time', position());

  /** Start the visible element; a stale result (paused, swapped, newer play) is ignored. */
  function startPlay(): Promise<void> {
    const gen = ++playGen;
    const el = vis;
    setState('playing');
    return el.play().then(
      () => {
        if (gen === playGen && el === vis && st !== 'playing') setState('playing');
      },
      () => {
        if (gen === playGen && el === vis) setState('blocked');
      },
    );
  }

  /** Swap roles; the old visible element goes idle and is repointed by ensureIdle. */
  function swap() {
    vis.pause();
    [vis, idle] = [idle, vis];
  }

  /** Put a chapter on the visible element right now (restart, or the current chapter vanished). */
  function loadVisible(id: string, offset: number) {
    ++seekGen;
    pending = null;
    if (assigned.get(idle) === id) {
      swap();
    } else {
      vis.pause();
      setSrc(vis, id);
    }
    if (offset > 0) vis.currentTime = offset;
    cur = id;
    atEnd = false;
    ensureIdle();
    emit('chapter', id);
    emitTime();
  }

  /** The current chapter finished or failed: move on, or end if it was the last. */
  function advance() {
    if (!cur) return;
    const next = nextOf(cur);
    if (!next) {
      ++playGen;
      vis.pause();
      atEnd = true;
      setState('ended');
      emitTime();
      return;
    }
    const wasPlaying = st === 'playing';
    setSrc(idle, next.id);
    swap();
    cur = next.id;
    atEnd = false;
    ensureIdle();
    emit('chapter', next.id);
    if (wasPlaying) void startPlay();
    emitTime();
  }

  function commitPending() {
    if (!pending) return;
    const { id, offset } = pending;
    const wasPlaying = st === 'playing';
    pending = null;
    ++seekGen;
    swap();
    if (Math.abs(vis.currentTime - offset) > 0.01) vis.currentTime = offset;
    cur = id;
    atEnd = false;
    ensureIdle();
    emit('chapter', id);
    if (wasPlaying) void startPlay();
    else setState('paused');
    emitTime();
  }

  const onCanPlay = (el: HTMLVideoElement) => () => {
    if (destroyed || !pending || el !== idle) return;
    if (pending.gen !== seekGen || assigned.get(el) !== pending.id) return;
    commitPending();
  };
  const onEnded = (el: HTMLVideoElement) => () => {
    if (destroyed || el !== vis || pending) return; // a pending seek will take over
    advance();
  };
  const onTimeUpdate = (el: HTMLVideoElement) => () => {
    if (destroyed || el !== vis) return;
    emitTime();
  };
  const onError = (el: HTMLVideoElement) => () => {
    if (destroyed) return;
    const id = assigned.get(el);
    if (!id) return; // cleared element
    errored.add(id);
    emit('error', id);
    if (el === vis) {
      advance();
    } else {
      if (pending && pending.id === id) {
        ++seekGen;
        pending = null;
      }
      setSrc(idle, null);
      ensureIdle();
    }
  };

  const handlers = [o.a, o.b].map((el) => ({
    el,
    list: [
      ['canplay', onCanPlay(el)],
      ['ended', onEnded(el)],
      ['timeupdate', onTimeUpdate(el)],
      ['error', onError(el)],
    ] as const,
  }));
  for (const h of handlers) for (const [n, fn] of h.list) h.el.addEventListener(n, fn);

  function setChapters(next: Chapter[]) {
    if (destroyed) return;
    const old = chapters;
    chapters = next;
    errored = new Set();
    const list = playable(next);

    if (list.length === 0) {
      ++playGen;
      ++seekGen;
      pending = null;
      cur = null;
      atEnd = false;
      vis.pause();
      idle.pause();
      setSrc(vis, null);
      setSrc(idle, null);
      setState('idle');
      return;
    }

    if (pending && !isPlayable(pending.id)) {
      ++seekGen;
      pending = null;
    }

    if (cur === null) {
      cur = list[0].id;
      setSrc(vis, cur);
      ensureIdle();
      emit('chapter', cur);
      emitTime();
      return;
    }

    if (isPlayable(cur)) {
      ensureIdle();
      return;
    }

    // The current chapter stopped being playable: continue with the next one that still is, in the old order.
    const wasPlaying = st === 'playing';
    const i = old.findIndex((c) => c.id === cur);
    const successor = i < 0 ? undefined : old.slice(i + 1).find((c) => isPlayable(c.id));
    if (successor) {
      loadVisible(successor.id, 0);
      if (wasPlaying) void startPlay();
      else if (st === 'playing') setState('paused');
    } else {
      // Nothing after it: stop on the last playable chapter, at its end.
      ++playGen;
      loadVisible(list[list.length - 1].id, 0);
      atEnd = true;
      setState('ended');
      emitTime();
    }
  }

  function play(): Promise<void> {
    if (destroyed || !cur) return Promise.resolve();
    if (st === 'ended') {
      const first = playable(chapters)[0];
      if (!first) return Promise.resolve();
      if (cur === first.id) {
        atEnd = false;
        vis.currentTime = 0;
        emitTime();
      } else {
        loadVisible(first.id, 0);
      }
    }
    return startPlay();
  }

  function pause() {
    if (destroyed || !cur) return;
    ++playGen;
    vis.pause();
    if (st === 'playing' || st === 'blocked') setState('paused');
  }

  function seek(p: Position) {
    if (destroyed || !isPlayable(p.chapterId)) return;
    const offset = Number.isFinite(p.offset) && p.offset > 0 ? p.offset : 0;
    if (p.chapterId === cur) {
      ++seekGen;
      pending = null;
      vis.currentTime = offset;
      if (atEnd) {
        atEnd = false;
        setState('paused');
      }
      ensureIdle();
      emitTime();
      return;
    }
    const gen = ++seekGen;
    pending = { id: p.chapterId, offset, gen };
    const alreadyLoaded = assigned.get(idle) === p.chapterId;
    setSrc(idle, p.chapterId);
    idle.currentTime = offset;
    if (alreadyLoaded && (idle.readyState ?? 0) >= 3) commitPending();
  }

  return {
    setChapters,
    play,
    pause,
    seek,
    position,
    state: () => st,
    visible: () => (vis === o.a ? 'a' : 'b'),
    on(ev, fn) {
      listeners[ev].add(fn);
      return () => listeners[ev].delete(fn);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ++playGen;
      ++seekGen;
      pending = null;
      for (const h of handlers) for (const [n, fn] of h.list) h.el.removeEventListener(n, fn);
      for (const s of Object.values(listeners)) s.clear();
      setSrc(o.a, null);
      setSrc(o.b, null);
    },
  };
}
