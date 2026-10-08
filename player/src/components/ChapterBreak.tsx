import { useEffect, useState } from 'react';
import { getCaptionsText } from '@/api/client';
import { parseVtt } from '@/lib/vtt';
import type { Chapter } from '@/types';
import type { Player } from './usePlayer';

/** The chapter's closing line: its last sentence, rebuilt from the captions (a long sentence spans several cues),
 * or null while loading or when it has none. */
function useClosingLine(chapterId: string | null): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    setLine(null);
    if (!chapterId) return;
    let live = true;
    getCaptionsText(chapterId)
      .then((t) => (t === null ? [] : parseVtt(t)))
      .catch(() => [])
      .then((cues) => {
        const text = cues.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
        const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[`])/);
        if (live) setLine(sentences[sentences.length - 1] || null);
      });
    return () => {
      live = false;
    };
  }, [chapterId]);
  return line;
}

/**
 * Shown over the stage when a chapter has played to its end and the next one waits: the finished chapter's title and
 * closing line, a moment to let it settle, then replay it or go on.
 */
export function ChapterBreak({ player, chapters }: { player: Player; chapters: Chapter[] }) {
  const finished = chapters.find((c) => c.id === player.held) ?? null;
  const next = chapters.find((c) => c.id === player.position?.chapterId) ?? null;
  const line = useClosingLine(finished?.id ?? null);
  if (!finished || !next || player.state === 'playing') return null;
  return (
    <div
      role="dialog"
      aria-label={`${finished.title} finished`}
      className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-og-black/85 p-8 text-center"
    >
      <p className="text-xs font-black uppercase tracking-[0.2em] text-og-yellow">Chapter done</p>
      <h3 className="max-w-[80%] text-2xl font-black text-og-cream">{finished.title}</h3>
      {line && <p className="max-w-[70%] text-base font-bold text-og-yellow">{line}</p>}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={player.replay}
          className="bd cursor-pointer rounded-[10px] bg-og-white px-4 py-2 text-sm font-black text-og-black active:translate-y-[2px]"
        >
          ↺ Replay
        </button>
        <button
          type="button"
          autoFocus
          onClick={player.play}
          className="bd sh cursor-pointer rounded-[10px] bg-og-yellow px-4 py-2 text-sm font-black text-og-black active:translate-y-[2px] active:shadow-none"
        >
          Next: {next.title} ▶
        </button>
      </div>
    </div>
  );
}
