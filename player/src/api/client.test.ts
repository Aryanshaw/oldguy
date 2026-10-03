import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  getCaptionsText,
  getSources,
  getState,
  postExport,
  postMessage,
  posterUrl,
  videoUrl,
} from '@/api/client';
import { appState } from '@/test/fixtures';

const reply = (status: number, body: string) =>
  Promise.resolve(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => vi.unstubAllGlobals());

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('did not reject');
}

describe('getState', () => {
  it('returns the parsed body', async () => {
    const fetchMock = vi.fn(() => reply(200, JSON.stringify(appState)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getState()).toEqual(appState);
    expect(fetchMock).toHaveBeenCalledWith('/api/state', undefined);
  });
  it('rejects with the server text and status', async () => {
    vi.stubGlobal('fetch', () => reply(500, '{"error":"x"}'));
    const e = await failure(getState());
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(500);
    expect(e.message).toBe('x');
  });
  it('rejects on a non-JSON error body', async () => {
    vi.stubGlobal('fetch', () => reply(502, '<html>bad gateway</html>'));
    const e = await failure(getState());
    expect(e.status).toBe(502);
    expect(e.message).toBe('the server sent an unexpected answer');
  });
  it('rejects with status 0 on a network failure', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const e = await failure(getState());
    expect(e.status).toBe(0);
    expect(e.message).toBe('the server did not answer');
  });
});

describe('postMessage', () => {
  it('sends JSON and returns the event', async () => {
    const event = { id: 'evt_2', ts: 't', type: 'message', text: 'hi' };
    const fetchMock = vi.fn((_u: string, _i?: RequestInit) => reply(200, JSON.stringify({ event })));
    vi.stubGlobal('fetch', fetchMock);
    const body = { type: 'message' as const, text: 'hi', context: { chapter_id: 'overview', t: 3 } };
    expect(await postMessage(body)).toEqual(event);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/message');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual(body);
  });
});

describe('postExport', () => {
  it('passes dest and mode', async () => {
    const out = { file: 'a.mp4', files: ['a.mp4'], skipped: [] };
    const fetchMock = vi.fn((_u: string, _i?: RequestInit) => reply(200, JSON.stringify(out)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await postExport('/tmp/out', 'drafts')).toEqual(out);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/export');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ dest: '/tmp/out', mode: 'drafts' });
  });
  it('rejects a 409 with the server text', async () => {
    vi.stubGlobal('fetch', () => reply(409, '{"error":"an export is already running"}'));
    const e = await failure(postExport('/tmp/out', 'full'));
    expect(e.status).toBe(409);
    expect(e.message).toBe('an export is already running');
  });
});

describe('captions and sources', () => {
  it('getCaptionsText returns null on 404 and the text on 200', async () => {
    vi.stubGlobal('fetch', () => reply(404, '{"error":"not found"}'));
    expect(await getCaptionsText('overview')).toBeNull();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('WEBVTT\n', { status: 200 })));
    expect(await getCaptionsText('overview')).toBe('WEBVTT\n');
  });
  it('getSources returns [] for an empty list', async () => {
    vi.stubGlobal('fetch', () => reply(200, '{"sources":[]}'));
    expect(await getSources('overview')).toEqual([]);
  });
  it('builds media urls', () => {
    expect(videoUrl('a')).toBe('/chapters/a/video');
    expect(posterUrl('a')).toBe('/chapters/a/poster');
  });
});
