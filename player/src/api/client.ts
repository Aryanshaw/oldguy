import type { AppState, ChapterSource, Shape, StoredEvent, TemplatesInfo } from '@/types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const NO_ANSWER = 'the server did not answer';
const ODD_ANSWER = 'the server sent an unexpected answer';

async function send(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(0, NO_ANSWER);
  }
}

async function failure(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') return new ApiError(res.status, body.error);
  } catch {
    // fall through
  }
  return new ApiError(res.status, ODD_ANSWER);
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await send(url, init);
  if (!res.ok) throw await failure(res);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, ODD_ANSWER);
  }
}

function post<T>(url: string, body: unknown): Promise<T> {
  return json<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getState(): Promise<AppState> {
  return json<AppState>('/api/state');
}

export async function postMessage(body: {
  type: 'message' | 'make_video' | 'just_text' | 'retry_chapter' | 'remake';
  text?: string;
  context?: { chapter_id: string; t: number };
  /** make_video only: the id of the reply to turn into a chapter. */
  ref?: string;
  /** remake only: the template and shape to make the whole video again in. */
  template?: string;
  shape?: Shape;
}): Promise<StoredEvent> {
  const res = await post<{ event: StoredEvent }>('/api/message', body);
  return res.event;
}

export function getTemplates(): Promise<TemplatesInfo> {
  return json<TemplatesInfo>('/api/templates');
}

export function postExport(
  dest: string,
  mode: 'full' | 'drafts',
): Promise<{ file: string; files: string[]; skipped: { id: string; reason: string }[] }> {
  return post('/api/export', { dest, mode });
}

export async function getSources(id: string): Promise<ChapterSource[]> {
  const res = await json<{ sources: ChapterSource[] }>(`/chapters/${encodeURIComponent(id)}/sources`);
  return res.sources;
}

export async function getCaptionsText(id: string): Promise<string | null> {
  const res = await send(`/chapters/${encodeURIComponent(id)}/captions`);
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res);
  return res.text();
}

export const videoUrl = (id: string): string => `/chapters/${encodeURIComponent(id)}/video`;
export const posterUrl = (id: string): string => `/chapters/${encodeURIComponent(id)}/poster`;
