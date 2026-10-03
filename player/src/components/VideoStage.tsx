import { playable } from '@/lib/timeline';
import type { Chapter } from '@/types';
import { Captions } from './Captions';
import type { Player } from './usePlayer';

export function VideoStage({ player, chapters, captionsOn }: { player: Player; chapters: Chapter[]; captionsOn: boolean }) {
  const none = playable(chapters).length === 0;
  const waiting = chapters.some((c) => c.status === 'rendering' || c.status === 'pending');
  const showPlay = !none && (player.state === 'blocked' || player.state === 'idle');
  // The idle element stays composited (opacity 0, not visibility hidden) so it is already decoded at the swap.
  const idle = { opacity: 0, pointerEvents: 'none' } as const;
  return (
    <div className="bd sh-lg relative aspect-video w-full overflow-hidden rounded-[14px] bg-yk-black">
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
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-lg font-black text-yk-cream">
          {waiting ? 'The first chapter is rendering.' : 'Nothing to play yet.'}
        </div>
      ) : (
        <Captions chapterId={player.position?.chapterId ?? null} offset={player.position?.offset ?? 0} on={captionsOn} />
      )}
      {showPlay && (
        <button
          type="button"
          aria-label="Play video"
          onClick={player.play}
          className="bd sh absolute left-1/2 top-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-yk-yellow text-3xl text-yk-black"
        >
          <span aria-hidden="true">▶</span>
        </button>
      )}
    </div>
  );
}
