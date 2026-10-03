import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngine, type Engine, type EngineState } from '@/engine/engine';
import { videoUrl } from '@/api/client';
import { neighbour, type Position } from '@/lib/timeline';
import type { Chapter } from '@/types';

export type CreateEngine = typeof createEngine;

const CAPTIONS_KEY = 'yap.captions';

export function usePlayer(chapters: Chapter[], create: CreateEngine = createEngine) {
  const refA = useRef<HTMLVideoElement>(null);
  const refB = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const createRef = useRef(create);
  createRef.current = create;

  const [visible, setVisible] = useState<'a' | 'b'>('a');
  const [state, setState] = useState<EngineState>('idle');
  const [position, setPosition] = useState<Position | null>(null);
  const [broken, setBroken] = useState<string[]>([]);

  useEffect(() => {
    const a = refA.current;
    const b = refB.current;
    if (!a || !b) return;
    const engine = createRef.current({ a, b, urlFor: videoUrl });
    engineRef.current = engine;
    setBroken([]);
    const sync = () => {
      setVisible(engine.visible());
      setState(engine.state());
      setPosition(engine.position());
    };
    const offs = [
      engine.on('time', () => setPosition(engine.position())),
      engine.on('chapter', sync),
      engine.on('state', () => setState(engine.state())),
      engine.on('error', (id) => {
        if (typeof id === 'string') setBroken((prev) => (prev.includes(id) ? prev : [...prev, id]));
      }),
    ];
    engine.setChapters(chaptersRef.current);
    sync();
    return () => {
      for (const off of offs) off();
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setChapters(chapters);
    // A re-rendered chapter leaves `ready` and comes back playable: forget its old failure.
    setBroken((prev) => {
      const next = prev.filter((id) => chapters.find((c) => c.id === id)?.status === 'ready');
      return next.length === prev.length ? prev : next;
    });
  }, [chapters]);

  const play = useCallback(() => void engineRef.current?.play(), []);
  const pause = useCallback(() => engineRef.current?.pause(), []);
  const toggle = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    if (e.state() === 'playing') e.pause();
    else void e.play();
  }, []);
  const seek = useCallback((p: Position) => engineRef.current?.seek(p), []);

  const step = useCallback((seconds: number) => {
    const e = engineRef.current;
    const p = e?.position();
    if (!e || !p) return;
    const list = chaptersRef.current;
    const dur = (id: string) => list.find((c) => c.id === id)?.duration_s ?? null;
    let id = p.chapterId;
    let offset = p.offset + seconds;
    if (seconds > 0) {
      const d = dur(id);
      if (d !== null && offset >= d) {
        const next = neighbour(list, id, 1);
        if (next) {
          id = next.id;
          offset -= d;
        } else offset = d;
      }
    } else if (offset < 0) {
      const prev = neighbour(list, id, -1);
      const pd = prev ? dur(prev.id) : null;
      if (prev && pd !== null) {
        id = prev.id;
        offset = Math.max(0, pd + offset);
      } else offset = 0;
    }
    e.seek({ chapterId: id, offset });
  }, []);

  const jump = useCallback((dir: 1 | -1) => {
    const e = engineRef.current;
    const p = e?.position();
    if (!e || !p) return;
    const n = neighbour(chaptersRef.current, p.chapterId, dir);
    if (n) e.seek({ chapterId: n.id, offset: 0 });
  }, []);

  return { refA, refB, visible, state, position, broken, play, pause, toggle, seek, step, jump };
}

export type Player = ReturnType<typeof usePlayer>;

function readCaptionsPref(): boolean {
  try {
    return localStorage.getItem(CAPTIONS_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Captions on/off, remembered in localStorage (default on). Storage failures are ignored. */
export function useCaptionsPref(): [boolean, () => void] {
  const [on, setOn] = useState(readCaptionsPref);
  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CAPTIONS_KEY, next ? 'on' : 'off');
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);
  return [on, toggle];
}
