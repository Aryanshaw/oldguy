import type { MouseEvent } from 'react';
import { posterUrl } from '@/api/client';
import { blocks, fmt, type Position } from '@/lib/timeline';
import { cn } from '@/lib/utils';
import type { Chapter } from '@/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface TimelineProps {
  chapters: Chapter[];
  position: Position | null;
  failReasons: Record<string, string>;
  /** Ready chapters whose video failed to load in the browser. */
  broken?: string[];
  /** Store keys (`rt:<id>`) of retries already asked. */
  retried?: string[];
  onSeek: (p: Position) => void;
  onRetry: (id: string) => void;
}

type Look = 'played' | 'current' | 'upcoming' | 'rendering' | 'pending' | 'failed' | 'stale';

const BASE =
  'relative flex h-full min-w-0 basis-0 items-center gap-[6px] overflow-hidden rounded-[10px] bd px-[10px] text-left text-[12px] font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-yk-orange';

const LOOK: Record<Look, string> = {
  played: 'bg-yk-black text-yk-cream cursor-pointer',
  current: 'bg-yk-white sh -translate-y-1 cursor-pointer',
  upcoming: 'bg-yk-white cursor-pointer',
  rendering: 'yk-stripes cursor-not-allowed',
  pending: 'bg-yk-white border-dashed cursor-not-allowed',
  failed: 'bg-yk-red cursor-pointer',
  stale: 'bg-yk-white border-dashed border-[#8a8472] cursor-not-allowed',
};

const LABEL: Partial<Record<Look, string>> = {
  rendering: 'rendering',
  pending: 'waiting',
  failed: 'failed, retry',
  stale: 'out of date',
};

const STATE_WORDS: Record<Look, string> = {
  played: 'played',
  current: 'current',
  upcoming: 'upcoming',
  rendering: 'rendering',
  pending: 'waiting',
  failed: 'failed, retry',
  stale: 'out of date',
};

const hasDuration = (c: Chapter): c is Chapter & { duration_s: number } =>
  typeof c.duration_s === 'number' && Number.isFinite(c.duration_s) && c.duration_s > 0;

export function Timeline({ chapters, position, failReasons, broken = [], retried = [], onSeek, onRetry }: TimelineProps) {
  const items = blocks(chapters);
  const curIdx = position ? chapters.findIndex((c) => c.id === position.chapterId && c.status === 'ready') : -1;

  return (
    <TooltipProvider delayDuration={150}>
      <div role="group" aria-label="Chapters" className="flex h-[42px] gap-2 pt-1">
        {items.map(({ chapter: c, weight, followUp }, i) => {
          const isBroken = c.status === 'ready' && broken.includes(c.id);
          const look: Look = isBroken
            ? 'failed'
            : c.status !== 'ready'
              ? c.status
              : i === curIdx
                ? 'current'
                : curIdx >= 0 && i < curIdx
                  ? 'played'
                  : 'upcoming';
          const asked = look === 'failed' && retried.includes('rt:' + c.id);
          const disabled = look === 'rendering' || look === 'pending' || look === 'stale';
          const draft = c.quality === 'draft';
          const dur = hasDuration(c) ? c.duration_s : null;
          const reason = isBroken ? 'The video could not be loaded.' : look === 'failed' ? failReasons[c.id] : undefined;
          const fill = look === 'current' && dur && position ? Math.min(100, Math.max(0, (position.offset / dur) * 100)) : 0;
          const name = [
            c.title,
            asked ? 'retry asked' : STATE_WORDS[look],
            ...(followUp && (look === 'upcoming' || look === 'played' || look === 'current') ? ['follow-up'] : []),
            ...(draft ? ['draft'] : []),
            ...(dur !== null ? [fmt(dur)] : []),
          ].join(', ');

          const click = (e: MouseEvent<HTMLButtonElement>) => {
            if (disabled) return;
            if (look === 'failed') return onRetry(c.id);
            let offset = 0;
            if (look === 'current' && dur) {
              const r = e.currentTarget.getBoundingClientRect();
              if (r.width > 0) offset = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur;
            }
            onSeek({ chapterId: c.id, offset });
          };

          return (
            <Tooltip key={c.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={name}
                  aria-disabled={disabled || undefined}
                  data-look={look}
                  onClick={click}
                  style={{ flexGrow: weight }}
                  className={cn(
                    BASE,
                    LOOK[look],
                    followUp && look !== 'failed' && look !== 'rendering' && look !== 'played' && 'border-dashed',
                    followUp && look === 'upcoming' && 'bg-[#FFD9A8]',
                  )}
                >
                  {look === 'current' && (
                    <span
                      data-fill
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 bg-yk-yellow"
                      style={{ width: `${fill}%` }}
                    />
                  )}
                  <span className={cn('relative min-w-0 truncate', look === 'stale' && 'line-through')}>{c.title}</span>
                  {draft && (
                    <span className="relative shrink-0 rounded-[4px] bg-yk-black px-[5px] text-[10px] text-yk-cream">draft</span>
                  )}
                  {(asked || LABEL[look]) && (
                    <span
                      className={cn(
                        'relative ml-auto shrink-0 whitespace-nowrap',
                        look === 'rendering' && 'rounded-[4px] bg-yk-black px-[6px] py-px text-yk-cream',
                      )}
                    >
                      {asked ? 'retry asked' : LABEL[look]}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent className="flex max-w-[260px] flex-col gap-1">
                <span className="break-words">{c.title}</span>
                {dur !== null && <span className="font-medium">{fmt(dur)}</span>}
                {c.poster !== null && (
                  <img src={posterUrl(c.id)} alt="" className="w-full rounded-[4px]" />
                )}
                {reason && <span className="font-medium break-words">{reason}</span>}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
