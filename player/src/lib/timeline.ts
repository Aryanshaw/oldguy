import type { Chapter } from '@/types';

export interface Position {
  chapterId: string;
  offset: number;
}

const dur = (c: Chapter): number =>
  typeof c.duration_s === 'number' && Number.isFinite(c.duration_s) && c.duration_s > 0 ? c.duration_s : 0;

export const playable = (chapters: Chapter[]): Chapter[] => chapters.filter((c) => c.status === 'ready');

export function total(chapters: Chapter[]): number {
  return playable(chapters).reduce((s, c) => s + dur(c), 0);
}

export function globalTime(chapters: Chapter[], p: Position | null): number {
  if (!p) return 0;
  let acc = 0;
  for (const c of playable(chapters)) {
    if (c.id === p.chapterId) return acc + (Number.isFinite(p.offset) ? p.offset : 0);
    acc += dur(c);
  }
  return 0;
}

/** Timeline scale, like a video editor's: clips are this many pixels per second, never narrower than MIN_CLIP_PX. */
export const PX_PER_S = 6;
export const MIN_CLIP_PX = 140;

/** A clip's natural width in pixels; the track scrolls when the clips add up to more than the space. */
export const clipWidth = (seconds: number): number => Math.max(MIN_CLIP_PX, Math.round(seconds * PX_PER_S));

/**
 * One clip per chapter. `weight` is its length in seconds (the mean of the known ones when it has none yet);
 * `start` is where it begins in the played video, null for a chapter that is not playable.
 */
export function blocks(
  chapters: Chapter[],
): { chapter: Chapter; weight: number; start: number | null; followUp: boolean }[] {
  if (chapters.length === 0) return [];
  const known = chapters.map(dur).filter((d) => d > 0);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  let acc = 0;
  return chapters.map((chapter) => {
    const playableHere = chapter.status === 'ready';
    const start = playableHere ? acc : null;
    if (playableHere) acc += dur(chapter);
    return { chapter, weight: dur(chapter) || mean, start, followUp: chapter.parent_id != null };
  });
}

/** Ruler spacing for a video of `totalS` seconds: a tick every `step` s, a time label every `label` s. */
export function rulerScale(totalS: number): { step: number; label: number } {
  if (totalS <= 120) return { step: 5, label: 15 };
  if (totalS <= 600) return { step: 10, label: 30 };
  return { step: 30, label: 60 };
}

/** The ruler ticks inside one clip: each tick's time in the video and its place in the clip (0 to 1). */
export function clipTicks(start: number, seconds: number, step: number): { t: number; at: number }[] {
  const out: { t: number; at: number }[] = [];
  if (!(seconds > 0) || !(step > 0)) return out;
  for (let t = Math.ceil(start / step) * step; t < start + seconds; t += step) out.push({ t, at: (t - start) / seconds });
  return out;
}

export function neighbour(chapters: Chapter[], id: string, dir: 1 | -1): Chapter | null {
  const list = playable(chapters);
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return null;
  return list[i + dir] ?? null;
}

export function fmt(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
