import { useEffect, useRef, useState } from 'react';
import { getCaptionsText } from '@/api/client';
import { cueAt, parseVtt } from '@/lib/vtt';
import type { Cue } from '@/types';

export function Captions({ chapterId, offset, on }: { chapterId: string | null; offset: number; on: boolean }) {
  const cache = useRef(new Map<string, Cue[]>());
  const [cues, setCues] = useState<Cue[]>([]);

  useEffect(() => {
    if (!on || !chapterId) {
      setCues([]);
      return;
    }
    const hit = cache.current.get(chapterId);
    if (hit) {
      setCues(hit);
      return;
    }
    setCues([]);
    let live = true;
    getCaptionsText(chapterId)
      .then((t) => (t === null ? [] : parseVtt(t)))
      .catch(() => [] as Cue[])
      .then((list) => {
        cache.current.set(chapterId, list);
        if (live) setCues(list);
      });
    return () => {
      live = false;
    };
  }, [chapterId, on]);

  if (!on) return null;
  const cue = cueAt(cues, Number.isFinite(offset) ? offset : 0);
  if (!cue || cue.text === '') return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[14%] flex justify-center px-4">
      <p
        aria-live="off"
        className="max-w-[80%] whitespace-pre-line rounded-[6px] bg-yk-black px-3 py-1 text-center text-base font-bold text-yk-yellow"
      >
        {cue.text}
      </p>
    </div>
  );
}
