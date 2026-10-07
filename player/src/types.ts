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
  /** true when Claude offered to turn this answer into a chapter; only then is the button shown. */
  offer_video?: boolean;
  /** true when the viewer already asked for this answer's video (kept across reloads by the server). */
  video_asked?: boolean;
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

export interface StoredEvent {
  id: string;
  ts: string;
  type: 'message' | 'make_video' | 'just_text' | 'retry_chapter';
  text?: string;
  context?: { chapter_id: string; t: number };
}
