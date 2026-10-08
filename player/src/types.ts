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

export type Shape = '16:9' | '9:16' | '1:1';

export interface Manifest {
  version: 1;
  title: string;
  slug: string;
  /** How the video is told; absent on videos made before templates (explainer at 16:9). */
  template?: string;
  shape?: Shape;
  chapters: Chapter[];
}

/** One template in the gallery: what it is, who speaks, its rhythm, and whether it ships a preview. */
export interface TemplateCard {
  id: string;
  title: string;
  description: string;
  shapes: Shape[];
  tags: string[];
  voices: { id: string; voice: string }[];
  captions: 'none' | 'line' | 'word';
  chapter_seconds: [number, number];
  /** true when /api/templates/<id>/sample serves a preview clip, and /poster its first frame. */
  sample: boolean;
  poster: boolean;
}

/** GET /api/templates: the video's own template and shape, and every template it could be remade as. */
export interface TemplatesInfo {
  current: { template: string; shape: Shape };
  templates: TemplateCard[];
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
