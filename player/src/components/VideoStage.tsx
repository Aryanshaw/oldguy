import { playable } from '@/lib/timeline';
import type { Chapter, Shape } from '@/types';
import { Captions } from './Captions';
import { ChapterBreak } from './ChapterBreak';
import type { Player } from './usePlayer';

// The stage box for each shape. A tall or square video is capped in height so it fits beside the chat, and centred.
const SHAPE_CLASS: Record<Shape, string> = {
  '16:9': 'aspect-video w-full',
  '9:16': 'mx-auto aspect-[9/16] h-[min(72vh,760px)] max-w-full',
  '1:1': 'mx-auto aspect-square h-[min(72vh,760px)] max-w-full',
};

export function VideoStage({
  player,
  chapters,
  captionsOn,
  shape = '16:9',
}: {
  player: Player;
  chapters: Chapter[];
  captionsOn: boolean;
  shape?: Shape;
}) {
  const none = playable(chapters).length === 0;
  const waiting = chapters.some((c) => c.status === 'rendering' || c.status === 'pending');
  const showPlay = !none && (player.state === 'blocked' || player.state === 'idle');
  // The idle element stays composited (opacity 0, not visibility hidden) so it is already decoded at the swap.
  const idle = { opacity: 0, pointerEvents: 'none' } as const;
  return (
    <div data-shape={shape} className={`bd sh-lg relative ${SHAPE_CLASS[shape]} overflow-hidden rounded-[14px] bg-og-black`}>
      <video
        ref={player.refA}
        playsInline
        className="absolute inset-0 h-full w-full"
        style={player.visible === 'a' ? { opacity: 1 } : idle}
        aria-hidden={player.visible === 'a' ? undefined : true}
      />
      <video
        ref={player.refB}
        playsInline
        className="absolute inset-0 h-full w-full"
        style={player.visible === 'b' ? { opacity: 1 } : idle}
        aria-hidden={player.visible === 'b' ? undefined : true}
      />
      {none ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-lg font-black text-og-cream">
          {waiting ? 'The first chapter is rendering.' : 'Nothing to play yet.'}
        </div>
      ) : (
        <Captions chapterId={player.position?.chapterId ?? null} offset={player.position?.offset ?? 0} on={captionsOn} />
      )}
      <ChapterBreak player={player} chapters={chapters} />
      {showPlay && (
        <button
          type="button"
          aria-label="Play video"
          onClick={player.play}
          className="bd sh absolute left-1/2 top-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-og-yellow text-3xl text-og-black"
        >
          <span aria-hidden="true">▶</span>
        </button>
      )}
    </div>
  );
}
