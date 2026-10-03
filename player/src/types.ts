export type Status = 'pending' | 'rendering' | 'ready' | 'failed' | 'stale';

export interface Chapter {
  id: string;
  title: string;
  parent_id: string | null;
  status: Status;
  quality: 'draft' | 'full';
  duration_s: number | null;
  poster: string | null;
  question: string | null;
}

export interface Manifest {
  version: 1;
  title: string;
  slug: string;
  chapters: Chapter[];
}

/** "12" or "12-20", as sent in replies. */
export interface SourceRef {
  file: string;
  lines: string;
}

export interface ThreadEntry {
  id: string;
  ts: string;
  role: 'viewer' | 'claude';
  text: string;
  in_reply_to?: string;
  sources?: SourceRef[];
  context?: { chapter_id: string; t: number };
}

export interface AppState {
  manifest: Manifest;
  thread: ThreadEntry[];
  claude_connected: boolean;
  now: number;
}

export interface ChapterSource {
  file: string;
  lines: [number, number];
  quote: string;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}
