import { useEffect, useRef } from 'react';
import { fmt, globalTime, total } from '@/lib/timeline';
import type { Chapter } from '@/types';
import type { Player } from './usePlayer';

const typing = (t: EventTarget | null): boolean => {
  if (!(t instanceof Element)) return false;
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'DIALOG' ||
    t.closest('dialog') !== null ||
    (t as HTMLElement).isContentEditable === true
  );
};

export function Controls({
  player,
  chapters,
  captionsOn,
  onToggleCaptions,
}: {
  player: Player;
  chapters: Chapter[];
  captionsOn: boolean;
  onToggleCaptions: () => void;
}) {
  const latest = useRef({ player, onToggleCaptions });
  latest.current = { player, onToggleCaptions };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const { player: p, onToggleCaptions: cc } = latest.current;
      switch (e.key) {
        case ' ':
          if (e.target instanceof Element && e.target.closest('button')) return; // the button handles its own Space
          e.preventDefault();
          p.toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          p.step(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          p.step(5);
          break;
        case '[':
          p.jump(-1);
          break;
        case ']':
          p.jump(1);
          break;
        case 'c':
        case 'C':
          cc();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const playing = player.state === 'playing';
  const current = chapters.find((c) => c.id === player.position?.chapterId);
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={player.toggle}
        className="bd sh flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-yk-yellow text-lg text-yk-black active:translate-y-[2px] active:shadow-none"
      >
        <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
      </button>
      <h2 className="min-w-0 flex-1 truncate font-black text-yk-black">{current?.title ?? ''}</h2>
      <span className="rounded-[6px] bg-yk-black px-2 py-1 text-xs font-bold tabular-nums text-yk-cream">
        {fmt(globalTime(chapters, player.position))} / {fmt(total(chapters))}
      </span>
      <button
        type="button"
        aria-pressed={captionsOn}
        onClick={onToggleCaptions}
        className={`bd cursor-pointer rounded-[10px] px-3 py-1 text-xs font-black text-yk-black ${captionsOn ? 'bg-yk-yellow' : 'bg-yk-white'}`}
      >
        CC
      </button>
    </div>
  );
}
