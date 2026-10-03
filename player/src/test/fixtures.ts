import type { AppState, Chapter } from '@/types';

const ch = (c: Partial<Chapter> & Pick<Chapter, 'id' | 'title'>): Chapter => ({
  parent_id: null,
  status: 'ready',
  quality: 'full',
  duration_s: 42,
  poster: `${c.id}/poster.jpg`,
  question: null,
  ...c,
});

export const appState: AppState = {
  manifest: {
    version: 1,
    title: 'How the cache works',
    slug: 'how-the-cache-works',
    chapters: [
      ch({ id: 'overview', title: 'Overview', duration_s: 48.5 }),
      ch({
        id: 'eviction',
        title: 'Eviction',
        status: 'rendering',
        quality: 'draft',
        duration_s: null,
        poster: null,
      }),
      ch({
        id: 'ttl-detail',
        title: 'Why TTLs matter',
        parent_id: 'overview',
        status: 'pending',
        quality: 'draft',
        duration_s: null,
        poster: null,
        question: 'Why do entries expire?',
      }),
      ch({ id: 'writes', title: 'Write path', status: 'failed', duration_s: null, poster: null }),
      ch({ id: 'metrics', title: 'Metrics', status: 'stale', duration_s: 30 }),
    ],
  },
  thread: [
    {
      id: 'evt_1',
      ts: '2026-10-03T10:00:00.000Z',
      role: 'viewer',
      text: 'Why do entries expire?',
      context: { chapter_id: 'overview', t: 12.5 },
    },
    {
      id: 'rep_1',
      ts: '2026-10-03T10:00:05.000Z',
      role: 'claude',
      in_reply_to: 'evt_1',
      text: 'Entries expire so stale data does not live forever.',
      sources: [{ file: 'src/cache/ttl.ts', lines: '12-20' }],
    },
  ],
  claude_connected: true,
  now: 1790000000000,
};

export const sampleSources = [
  { file: 'src/cache/ttl.ts', lines: [12, 20] as [number, number], quote: 'const ttl = opts.ttl ?? DEFAULT_TTL;' },
];
