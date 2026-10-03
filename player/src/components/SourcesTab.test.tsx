import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '@/state/store';
import type { AppState, Chapter, ChapterSource, ThreadEntry } from '@/types';

vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), getSources: vi.fn() }));
import { getSources } from '@/api/client';
import { SourcesTab } from './SourcesTab';

const mocked = vi.mocked(getSources);
afterEach(() => {
  cleanup();
  mocked.mockReset();
});

const ch = (id: string): Chapter => ({
  id, title: `Title ${id}`, parent_id: null, status: 'ready', quality: 'full', duration_s: 60, poster: null, question: null,
});
const chapters = [ch('a'), ch('b')];

async function mount(thread: ThreadEntry[] = [], chapterId = 'a') {
  const state: AppState = { manifest: { version: 1, title: 'T', slug: 't', chapters }, thread, claude_connected: true, now: 0 };
  const store = createStore({ getState: async () => state, openStream: () => ({ close() {} }) });
  store.start();
  await waitFor(() => expect(store.get().link).toBe('open'));
  const view = render(<SourcesTab store={store} position={{ chapterId, offset: 0 }} chapters={chapters} />);
  const go = (id: string) =>
    view.rerender(<SourcesTab store={store} position={{ chapterId: id, offset: 0 }} chapters={chapters} />);
  return { go };
}
const src = (file: string, a: number, b: number, quote: string): ChapterSource => ({ file, lines: [a, b], quote });

describe('SourcesTab', () => {
  it('lists the chapter entries under the chapter title', async () => {
    mocked.mockResolvedValue([src('x.ts', 1, 5, 'the quote')]);
    await mount();
    expect(await screen.findByText('x.ts:1-5')).toBeInTheDocument();
    expect(screen.getByText('the quote')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Title a' })).toBeInTheDocument();
  });

  it('switches when the chapter changes and caches per id', async () => {
    mocked.mockImplementation(async (id) => [src(`${id}.ts`, 1, 2, 'q')]);
    const { go } = await mount();
    await screen.findByText('a.ts:1-2');
    go('b');
    await screen.findByText('b.ts:1-2');
    expect(screen.queryByText('a.ts:1-2')).toBeNull();
    go('a');
    await screen.findByText('a.ts:1-2');
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('a late response for an old chapter does not overwrite the current one', async () => {
    let late!: (v: ChapterSource[]) => void;
    mocked.mockImplementation((id) =>
      id === 'a' ? new Promise((r) => { late = r; }) : Promise.resolve([src('b.ts', 1, 2, 'q')]),
    );
    const { go } = await mount();
    go('b');
    await screen.findByText('b.ts:1-2');
    await act(async () => late([src('stale.ts', 9, 9, 'old')]));
    expect(screen.getByText('b.ts:1-2')).toBeInTheDocument();
    expect(screen.queryByText('stale.ts:9-9')).toBeNull();
  });

  it('shows the empty text for []', async () => {
    mocked.mockResolvedValue([]);
    await mount();
    expect(await screen.findByText('This chapter lists no sources.')).toBeInTheDocument();
    expect(screen.queryByText('From answers')).toBeNull();
  });

  it('survives a rejected getSources', async () => {
    mocked.mockRejectedValue(new Error('boom'));
    await mount();
    expect((await screen.findByText('Could not load sources.')).className).toMatch(/bg-yk-red/);
  });

  it('wraps a 300-character file path', async () => {
    const file = 'p/'.repeat(150);
    mocked.mockResolvedValue([src(file, 1, 2, 'q')]);
    await mount();
    expect((await screen.findByText(`${file}:1-2`)).className).toMatch(/break-words|overflow-wrap:anywhere/);
  });

  it('lists From answers for claude entries with sources', async () => {
    mocked.mockResolvedValue([]);
    await mount([
      { id: 'c1', ts: 't', role: 'claude', text: 'x', sources: [{ file: 'm.ts', lines: '4-9' }] },
      { id: 'c2', ts: 't', role: 'claude', text: 'y' },
    ]);
    expect(await screen.findByRole('heading', { name: 'From answers' })).toBeInTheDocument();
    expect(screen.getByText('m.ts:4-9')).toBeInTheDocument();
  });
});
