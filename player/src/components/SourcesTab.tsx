import { useEffect, useRef, useState } from 'react';
import { getSources } from '@/api/client';
import type { Position } from '@/lib/timeline';
import type { createStore } from '@/state/store';
import { useStore } from '@/state/store';
import type { Chapter, ChapterSource } from '@/types';

const WRAP = 'break-words [overflow-wrap:anywhere]';

type Loaded = { id: string; list: ChapterSource[] | null }; // null = failed

export function SourcesTab({
  store,
  position,
  chapters,
}: {
  store: ReturnType<typeof createStore>;
  position: Position | null;
  chapters: Chapter[];
}) {
  const thread = useStore(store, (s) => s.thread);
  const id = position?.chapterId ?? null;
  const cache = useRef(new Map<string, ChapterSource[]>());
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!id) return;
    const hit = cache.current.get(id);
    if (hit) {
      setLoaded({ id, list: hit });
      return;
    }
    let live = true;
    getSources(id).then(
      (list) => {
        cache.current.set(id, list);
        if (live) setLoaded({ id, list });
      },
      () => {
        if (live) setLoaded({ id, list: null });
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  const current = id && loaded?.id === id ? loaded : null;
  const title = chapters.find((c) => c.id === id)?.title;
  const answers = thread.filter((e) => e.role === 'claude' && e.sources && e.sources.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <section className="flex flex-col gap-2">
        {title && <h3 className={`text-sm font-black ${WRAP}`}>{title}</h3>}
        {current === null ? null : current.list === null ? (
          <p className="text-sm font-bold">Could not load sources.</p>
        ) : current.list.length === 0 ? (
          <p className="text-sm font-bold opacity-70">This chapter lists no sources.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {current.list.map((s, i) => (
              <li key={i} className="bd flex flex-col gap-1 rounded-[10px] bg-yk-white px-3 py-2">
                <span className={`font-mono text-xs font-bold ${WRAP}`}>{`${s.file}:${s.lines[0]}-${s.lines[1]}`}</span>
                <span className={`text-[13px] ${WRAP}`}>{s.quote}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {answers.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-black">From answers</h3>
          <ul className="flex flex-col gap-1.5">
            {answers.flatMap((e) =>
              (e.sources ?? []).map((s, j) => (
                <li key={`${e.id}:${j}`} className={`font-mono text-xs font-bold ${WRAP}`}>{`${s.file}:${s.lines}`}</li>
              )),
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
