import { describe, expect, test } from 'vitest';
import type { Chapter, Status } from '@/types';
import { blocks, clipTicks, clipWidth, fmt, globalTime, MIN_CLIP_PX, neighbour, playable, rulerScale, total } from './timeline';

const ch = (id: string, status: Status, duration_s: number | null, parent_id: string | null = null): Chapter => ({
  id,
  title: id,
  parent_id,
  status,
  quality: 'full',
  duration_s,
  poster: null,
  question: null,
});

const list = [
  ch('a', 'ready', 38),
  ch('r', 'rendering', 99),
  ch('b', 'ready', 52),
  ch('p', 'pending', 5),
  ch('c', 'ready', 60),
  ch('f', 'failed', 7),
  ch('s', 'stale', 8),
];

describe('playable / total', () => {
  test('playable keeps order and drops non-ready', () => {
    expect(playable(list).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
  test('total ignores non-ready and null', () => {
    expect(total([...list, ch('n', 'ready', null)])).toBe(150);
  });
});

describe('globalTime', () => {
  test('third ready chapter at offset 10 is 100, ignoring rendering one between', () => {
    expect(globalTime(list, { chapterId: 'c', offset: 10 })).toBe(100);
  });
  test('inserting a ready chapter before raises it by its duration', () => {
    const pos = { chapterId: 'c', offset: 10 };
    const next = [ch('x', 'ready', 20), ...list];
    expect(globalTime(next, pos)).toBe(120);
    expect(pos).toEqual({ chapterId: 'c', offset: 10 });
  });
  test('null, unknown id and non-playable give 0', () => {
    expect(globalTime(list, null)).toBe(0);
    expect(globalTime(list, { chapterId: 'zzz', offset: 3 })).toBe(0);
    expect(globalTime(list, { chapterId: 'r', offset: 3 })).toBe(0);
  });
});

describe('blocks', () => {
  test('all-null durations weigh 1 each', () => {
    const b = blocks([ch('a', 'ready', null), ch('b', 'pending', null)]);
    expect(b.map((x) => x.weight)).toEqual([1, 1]);
  });
  test('weight is the length in seconds, however short', () => {
    const b = blocks([ch('a', 'ready', 1), ch('b', 'ready', 300)]);
    expect(b.map((x) => x.weight)).toEqual([1, 300]);
  });
  test('start counts only playable chapters; others have none', () => {
    const b = blocks([ch('a', 'ready', 10), ch('p', 'pending', null), ch('c', 'ready', 30)]);
    expect(b.map((x) => x.start)).toEqual([0, null, 10]);
  });
  test('missing durations use the mean of those that have one', () => {
    const b = blocks([ch('a', 'ready', 10), ch('b', 'pending', null), ch('c', 'ready', 30)]);
    expect(b[1].weight).toBe(20);
  });
  test('followUp only when parent_id is set', () => {
    const b = blocks([ch('a', 'ready', 10), ch('b', 'ready', 10, 'a')]);
    expect(b.map((x) => x.followUp)).toEqual([false, true]);
  });
  test('empty list gives []', () => {
    expect(blocks([])).toEqual([]);
  });
});

describe('neighbour', () => {
  test('skips non-ready and returns null at the ends', () => {
    expect(neighbour(list, 'a', 1)?.id).toBe('b');
    expect(neighbour(list, 'c', -1)?.id).toBe('b');
    expect(neighbour(list, 'a', -1)).toBeNull();
    expect(neighbour(list, 'c', 1)).toBeNull();
  });
  test('from a non-playable or unknown id gives null', () => {
    expect(neighbour(list, 'zzz', 1)).toBeNull();
  });
});

describe('fmt', () => {
  test('formats', () => {
    expect(fmt(0)).toBe('0:00');
    expect(fmt(125)).toBe('2:05');
    expect(fmt(3725)).toBe('1:02:05');
    expect(fmt(NaN)).toBe('0:00');
    expect(fmt(-1)).toBe('0:00');
    expect(fmt(Infinity)).toBe('0:00');
  });
});

describe('clip sizing and ruler', () => {
  test('clips are 6 px per second with a 140 px floor', () => {
    expect(clipWidth(60)).toBe(360);
    expect(clipWidth(5)).toBe(MIN_CLIP_PX);
  });
  test('ruler gets coarser as the video grows', () => {
    expect(rulerScale(90)).toEqual({ step: 5, label: 15 });
    expect(rulerScale(238)).toEqual({ step: 10, label: 30 });
    expect(rulerScale(1200)).toEqual({ step: 30, label: 60 });
  });
  test('ticks land on whole steps inside the clip', () => {
    expect(clipTicks(25, 30, 10)).toEqual([
      { t: 30, at: 5 / 30 },
      { t: 40, at: 15 / 30 },
      { t: 50, at: 25 / 30 },
    ]);
    expect(clipTicks(0, 20, 10)).toEqual([{ t: 0, at: 0 }, { t: 10, at: 0.5 }]);
    expect(clipTicks(0, 0, 10)).toEqual([]);
  });
});
