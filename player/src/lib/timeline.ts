import type { Chapter } from '@/types';

export interface Position {
  chapterId: string;
  offset: number;
}

const MIN_SHARE = 0.04;

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

export function blocks(chapters: Chapter[]): { chapter: Chapter; weight: number; followUp: boolean }[] {
  if (chapters.length === 0) return [];
  const known = chapters.map(dur).filter((d) => d > 0);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const weights = chapters.map((c) => dur(c) || mean);
  // Raise thin blocks to MIN_SHARE of the (growing) sum; settles in a few passes.
  if (weights.length * MIN_SHARE < 1) {
    for (let i = 0; i < 100; i++) {
      const floor = MIN_SHARE * weights.reduce((a, b) => a + b, 0);
      let changed = false;
      for (let j = 0; j < weights.length; j++) {
        if (weights[j] < floor) {
          weights[j] = floor;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  return chapters.map((chapter, i) => ({ chapter, weight: weights[i], followUp: chapter.parent_id != null }));
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
