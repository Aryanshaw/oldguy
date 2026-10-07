import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '@/engine/engine';
import { createStore } from '@/state/store';
import type { AppState } from '@/types';
import { App } from './App';

vi.mock('@/components/usePlayer', async (orig) => {
  const real = await orig<typeof import('@/components/usePlayer')>();
  return { ...real, usePlayer: (c: never) => real.usePlayer(c, () => fakeEngine as unknown as Engine) };
});
vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  getCaptionsText: vi.fn(async () => null),
  getSources: vi.fn(async () => []),
}));

const fakeEngine = {
  setChapters() {},
  play: async () => {},
  pause() {},
  seek() {},
  destroy() {},
  position: () => null,
  state: () => 'idle' as const,
  visible: () => 'a' as const,
  on: () => () => {},
};

const state = (chapters: AppState['manifest']['chapters'] = [], connected = true): AppState => ({
  manifest: { version: 1, title: 'How the cache works', slug: 's', chapters },
  thread: [],
  claude_connected: connected,
  now: 0,
});

function make(s: AppState | Error) {
  const closeStream = vi.fn();
  const getState = vi.fn(async () => {
    if (s instanceof Error) throw s;
    return s;
  });
  const postMessage = vi.fn(async (b: { type: string }) => ({ id: 'e1', ts: 't', type: b.type }));
  const store = createStore({
    getState,
    postMessage: postMessage as never,
    openStream: () => ({ close: closeStream }),
  });
  return { store, getState, closeStream, postMessage };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('App', () => {
  it('starts the store once on mount and stops it on unmount', async () => {
    const { store, getState, closeStream } = make(state());
    const { unmount } = render(<App store={store} />);
    await screen.findByText('How the cache works');
    expect(getState).toHaveBeenCalledTimes(1);
    unmount();
    expect(closeStream).toHaveBeenCalled();
  });
  it('shows Loading before the state arrives', () => {
    const { store } = make(state());
    render(<App store={store} />);
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });
  it('renders with a manifest of zero chapters', async () => {
    const { store } = make(state([]));
    render(<App store={store} />);
    expect(await screen.findByText('Nothing to play yet.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sources' })).toBeInTheDocument();
  });
  it('pill follows claude_connected', async () => {
    const { store } = make(state([], false));
    render(<App store={store} />);
    expect(await screen.findByText('Claude not connected')).toBeInTheDocument();
  });
  it('a failed state load shows the error and Try again reloads', async () => {
    const { store, getState } = make(new Error('boom'));
    render(<App store={store} />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
  });
  it('a 403 shows the expired-link text', async () => {
    const { store } = make(Object.assign(new Error('x'), { status: 403 }));
    render(<App store={store} />);
    expect(await screen.findByText('This link has expired. Open the link printed by Yap again.')).toBeInTheDocument();
  });
  it('always shows the side panel, with no collapse button', async () => {
    const { store } = make(state([]));
    render(<App store={store} />);
    expect(await screen.findByRole('tab', { name: 'Chat' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /panel/i })).toBeNull();
  });
  it('stacks under 1000px, side by side from 1000px', async () => {
    const { store } = make(state([]));
    const { container } = render(<App store={store} />);
    await screen.findByText('How the cache works');
    const grid = container.querySelector('[data-layout]')!;
    expect(grid.className).toMatch(/grid-cols-1/);
    expect(grid.className).toMatch(/min-\[1000px\]:grid-cols-\[minmax\(0,1fr\)_360px\]/);
  });
  it('failed chapter Retry sends retry_chapter and then reads retry asked', async () => {
    const ch = { id: 'w', title: 'Write path', parent_id: null, status: 'failed' as const, quality: 'full' as const, duration_s: null, poster: null, question: null };
    const { store, postMessage } = make(state([ch]));
    render(<App store={store} />);
    const group = await screen.findByRole('group', { name: 'Chapters' });
    await userEvent.click(within(group).getByRole('button', { name: 'Write path, failed, retry' }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'retry_chapter', context: { chapter_id: 'w', t: 0 } });
    expect(await within(group).findByRole('button', { name: 'Write path, retry asked' })).toBeInTheDocument();
  });
  it('opens the export dialog from the header', async () => {
    const { store } = make(state([]));
    const { container } = render(<App store={store} />);
    await screen.findByText('How the cache works');
    expect(container.querySelector('dialog')).not.toHaveAttribute('open');
    await userEvent.click(screen.getAllByRole('button', { name: 'Export' })[0]);
    expect(container.querySelector('dialog')).toHaveAttribute('open');
    act(() => {});
  });
});
