// Type-only checks (never run, never imported): `npm run check` fails if a shared data shape drifts from what the
// server sends and the player will read. Each line below must stay true.
import type { ChapterStatus, Manifest, ManifestRow, insertChapter } from './manifest.mts';
import type { ScanStatus, ScannedChapter } from './chapter-scan.mts';
import type { ThreadEntry, ViewerEvent, Reply } from './events.mts';
import type { StreamEvent } from './sse.mts';

// True only when A and B are exactly the same type.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
// A compile error unless the argument is `true`.
type Expect<T extends true> = T;

type _Checks = [
  Expect<Equal<ChapterStatus, 'pending' | 'rendering' | 'ready' | 'failed' | 'stale'>>,
  Expect<Equal<ScanStatus, 'ready' | 'stale' | 'rendering' | 'pending'>>,
  Expect<Equal<ManifestRow['poster'], string | null>>,
  Expect<Equal<ManifestRow['duration_s'], number | null>>,
  Expect<Equal<ManifestRow['status'], ChapterStatus>>,
  Expect<Equal<Manifest['chapters'], ManifestRow[]>>,
  Expect<Equal<ScannedChapter['status'], ScanStatus>>,
  // a full row can be handed to insertChapter
  Expect<ManifestRow extends Parameters<typeof insertChapter>[1] ? true : false>,
  Expect<Equal<StreamEvent['event'], 'state' | 'chapter' | 'reply' | 'ping'>>,
  Expect<Equal<Extract<StreamEvent, { event: 'state' }>['data']['manifest'], Manifest>>,
  Expect<Equal<Extract<StreamEvent, { event: 'state' }>['data']['thread'], ThreadEntry[]>>,
  Expect<Equal<Extract<StreamEvent, { event: 'reply' }>['data'], Reply & { role: 'claude' }>>,
  Expect<Equal<ThreadEntry['role'], 'viewer' | 'claude'>>,
  Expect<Equal<ViewerEvent['id'], string>>,
];
export type { _Checks };
