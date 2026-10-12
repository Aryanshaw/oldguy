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
  on(ev: Ev, fn: (detail?: unknown) => void): () => void;
  destroy(): void;
}

/** 'hold' fires with the finished chapter's id when holdAtEnd stopped playback between two chapters. */
type Ev = 'time' | 'chapter' | 'state' | 'error' | 'hold';

/**
 * Two <video> elements: one visible, one idle and preloading the next playable chapter.
 * Position is always {chapterId, offset}; global seconds are never stored.
 * With holdAtEnd, a chapter that plays to its end loads the next one paused at its start, so the viewer gets a moment
 * to settle before going on.
 */
export function createEngine(o: { a: HTMLVideoElement; b: HTMLVideoElement; urlFor: (id: string) => string; holdAtEnd?: boolean }): Engine {
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
  let visEnded = false; // the visible chapter finished while a seek was pending
  const errored = new Set<string>(); // broken chapters: unplayable until an update shows them not ready

  const assigned = new Map<HTMLVideoElement, string | null>([[o.a, null], [o.b, null]]);
  const listeners: Record<Ev, Set<(d?: unknown) => void>> = {
    time: new Set(),
    chapter: new Set(),
    state: new Set(),
    error: new Set(),
    hold: new Set(),
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
  /** Playable chapters minus the ones that failed to load: the only list chapter-picking paths may use. */
  const usable = (list: Chapter[]) => playable(list).filter((c) => !errored.has(c.id));
  const isPlayable = (id: string) => usable(chapters).some((c) => c.id === id);

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
    visEnded = false;
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

  /** The current chapter finished or failed: move on, or end if it was the last. `hold` keeps the next one paused. */
  function advance(hold = false) {
    if (!cur || pending) return; // a pending seek owns the idle element and will take over
    const next = nextOf(cur);
    if (!next) {
      ++playGen;
      vis.pause();
      atEnd = true;
      visEnded = false;
      setState('ended');
      emitTime();
      return;
    }
    visEnded = false;
    const wasPlaying = st === 'playing';
    const finished = cur;
    setSrc(idle, next.id);
    swap();
    cur = next.id;
    atEnd = false;
    ensureIdle();
    emit('chapter', next.id);
    if (wasPlaying && hold) {
      ++playGen;
      setState('paused');
      emit('hold', finished);
    } else if (wasPlaying) void startPlay();
    emitTime();
  }

  /** A pending seek was dropped without committing: if the visible chapter already finished or broke, move on. */
  function recover() {
    if (pending || !cur) return;
    if (visEnded || errored.has(cur)) advance();
    else if (atEnd && st !== 'ended') {
      // The last chapter had finished and the seek that would have moved on is gone (whether play() was pressed or not).
      ++playGen;
      vis.pause();
      setState('ended');
      emitTime();
    }
  }

  function commitPending() {
    if (!pending) return;
    visEnded = false;
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
    if (destroyed || el !== vis) return;
    visEnded = true;
    advance(o.holdAtEnd === true); // no-op while a seek is pending; recover() picks it up if the seek is dropped
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
      const hadPending = pending?.id === id;
      if (hadPending) {
        ++seekGen;
        pending = null;
      }
      setSrc(idle, null);
      ensureIdle();
      if (hadPending) recover();
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
    for (const c of next) if (c.status !== 'ready') errored.delete(c.id);
    const list = usable(next);

    if (list.length === 0) {
      ++playGen;
      ++seekGen;
      pending = null;
      cur = null;
      atEnd = false;
      visEnded = false;
      vis.pause();
      idle.pause();
      setSrc(vis, null);
      setSrc(idle, null);
      setState('idle');
      return;
    }

    let dropped = false;
    if (pending && !isPlayable(pending.id)) {
      ++seekGen;
      pending = null;
      dropped = true;
    }

    if (cur === null) {
      cur = list[0].id;
      setSrc(vis, cur);
      ensureIdle();
      emit('chapter', cur);
      emitTime();
      return;
    }

    if (playable(next).some((c) => c.id === cur)) {
      ensureIdle();
      if (dropped) recover();
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
    if (pending) {
      // A seek is waiting on canplay: let commitPending start playback at its target, never the chapter it leaves.
      ++playGen;
      setState('playing');
      return Promise.resolve();
    }
    if (st === 'ended') {
      const first = usable(chapters)[0];
      if (!first) return Promise.resolve();
      if (cur === first.id) {
        atEnd = false;
        visEnded = false;
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
      if (visEnded) {
        visEnded = false;
        if (st === 'playing') void startPlay();
      }
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
