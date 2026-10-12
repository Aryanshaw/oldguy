import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '@/state/store';
import type { AppState, Chapter, ThreadEntry } from '@/types';
import { ChatTab } from './ChatTab';

afterEach(cleanup);

const ch = (id: string, over: Partial<Chapter> = {}): Chapter => ({
  id,
  title: `Title ${id}`,
  parent_id: null,
  status: 'ready',
  quality: 'full',
  duration_s: 60,
  poster: null,
  question: null,
  ...over,
});
const viewer = (id: string, text: string): ThreadEntry => ({ id, ts: '2026-01-01T00:00:00Z', role: 'viewer', text });
const claude = (id: string, text: string, over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id,
  ts: '2026-01-01T00:00:01Z',
  role: 'claude',
  text,
  ...over,
});

async function setup(
  thread: ThreadEntry[] = [],
  opts: { connected?: boolean; chapters?: Chapter[]; position?: { chapterId: string; offset: number } | null } = {},
) {
  const chapters = opts.chapters ?? [ch('a')];
  const state: AppState = {
    manifest: { version: 1, title: 'T', slug: 't', chapters },
    thread,
    claude_connected: opts.connected ?? true,
    now: 0,
  };
  const postMessage = vi.fn(async (b: { type: string; text?: string; context?: ThreadEntry['context'] }) => ({
    id: `e${postMessage.mock.calls.length}`,
    ts: '2026-01-01T00:01:00Z',
    type: b.type,
    text: b.text,
    context: b.context,
  }));
  const store = createStore({
    getState: async () => state,
    postMessage: postMessage as never,
    openStream: () => ({ close() {} }),
  });
  store.start();
  await waitFor(() => expect(store.get().link).toBe('open'));
  const position = opts.position === undefined ? { chapterId: 'a', offset: 7 } : opts.position;
  render(<ChatTab store={store} position={position} chapters={chapters} />);
  return { store, postMessage, user: userEvent.setup() };
}

describe('thread', () => {
  it('empty thread shows the empty text', async () => {
    await setup();
    expect(screen.getByText('Ask about anything in this video.')).toBeInTheDocument();
  });

  it('viewer entries are yellow bubbles, claude entries white cards', async () => {
    await setup([viewer('v1', 'hello?'), claude('c1', 'hi there')]);
    expect(screen.getByText('hello?').closest('[data-role]')).toHaveAttribute('data-role', 'viewer');
    expect(screen.getByText('hello?').className).toMatch(/bg-og-yellow/);
    expect(screen.getByText('hi there').closest('[data-role]')).toHaveAttribute('data-role', 'claude');
    expect(screen.getByText('hi there').parentElement?.className).toMatch(/bg-og-white/);
  });

  it('claude sources render as file:lines chips', async () => {
    await setup([claude('c1', 'see', { sources: [{ file: 'src/a.ts', lines: '12-20' }, { file: 'b.ts', lines: '3' }] })]);
    expect(screen.getByText('src/a.ts:12-20')).toBeInTheDocument();
    expect(screen.getByText('b.ts:3')).toBeInTheDocument();
  });

  it('a viewer bubble holding a long URL stays inside its column', async () => {
    const text = 'see https://customszone3.gov.in/Content/images/pdf/Form-very-long-path-without-spaces.pdf please';
    await setup([viewer('v1', text)]);
    const bubble = screen.getByText(text);
    expect(bubble.className).toMatch(/min-w-0/);
    expect(bubble.className).not.toMatch(/break-words/);
  });

  it('a 4,000-character message with no spaces wraps; script text is literal', async () => {
    const long = 'x'.repeat(4000);
    await setup([viewer('v1', long), claude('c1', '<script>alert(1)</script>')]);
    // anywhere (not break-word) is what lets a flex child shrink below its longest word; break-words would override it
    expect(screen.getByText(long).className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(screen.getByText(long).className).not.toMatch(/break-words/);
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
  });
});

describe('make this a video', () => {
  it('is not shown under an answer Claude did not offer as a video', async () => {
    await setup([claude('c1', 'got it'), claude('c2', 'no', { offer_video: false })]);
    expect(screen.queryByRole('button', { name: 'Make this a video' })).toBeNull();
  });

  it('posts once with the entry context and the reply id as ref, then flips to Asked for a video', async () => {
    const ctx = { chapter_id: 'a', t: 3 };
    const { postMessage, user } = await setup([claude('c1', 'answer', { context: ctx, offer_video: true })]);
    await user.click(screen.getByRole('button', { name: 'Make this a video' }));
    const done = await screen.findByRole('button', { name: 'Asked for a video' });
    expect(done).toBeDisabled();
    await user.click(done);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: 'make_video', context: ctx, ref: 'c1' });
  });

  it('stays Asked for a video after a reload when the server says it was already asked', async () => {
    const { postMessage } = await setup([claude('c1', 'answer', { offer_video: true, video_asked: true })]);
    expect(screen.getByRole('button', { name: 'Asked for a video' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Make this a video' })).toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('just text', () => {
  const rendering = ch('r', { status: 'rendering', question: 'Why X?' });

  it('shows only for a rendering chapter with a question', async () => {
    await setup([], {
      chapters: [
        ch('a'),
        rendering,
        ch('p', { status: 'pending', question: 'Q pending' }),
        ch('r2', { status: 'rendering', question: null }),
      ],
    });
    expect(screen.getByText('Making a chapter for: Why X?')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Just text' })).toHaveLength(1);
    expect(screen.queryByText(/Q pending/)).toBeNull();
  });

  it('presses just_text with t: 0 then reads Asked for text', async () => {
    const { postMessage, user } = await setup([], { chapters: [ch('a'), rendering] });
    await user.click(screen.getByRole('button', { name: 'Just text' }));
    const done = await screen.findByRole('button', { name: 'Asked for text' });
    expect(done).toBeDisabled();
    expect(postMessage).toHaveBeenCalledWith({ type: 'just_text', context: { chapter_id: 'r', t: 0 } });
  });
});

describe('connection', () => {
  const notice = "Claude isn't connected.";
  it('shows the notice and waiting for viewer messages newer than the last claude reply', async () => {
    await setup([viewer('v0', 'old'), claude('c1', 'r'), viewer('v1', 'new1'), viewer('v2', 'new2')], { connected: false });
    expect(screen.getByText(notice)).toBeInTheDocument();
    expect(screen.getAllByText('waiting')).toHaveLength(2);
  });
  it('shows neither when connected', async () => {
    await setup([viewer('v1', 'hi')]);
    expect(screen.queryByText(notice)).toBeNull();
    expect(screen.queryByText('waiting')).toBeNull();
  });
});

describe('composer', () => {
  it('Enter sends with context, clears the field, Shift+Enter does not send', async () => {
    const { postMessage, user } = await setup();
    const box = screen.getByRole('textbox');
    await user.type(box, 'one{Shift>}{Enter}{/Shift}two');
    expect(postMessage).not.toHaveBeenCalled();
    expect(box).toHaveValue('one\ntwo');
    await user.type(box, '{Enter}');
    await waitFor(() => expect(box).toHaveValue(''));
    expect(postMessage).toHaveBeenCalledWith({ type: 'message', text: 'one\ntwo', context: { chapter_id: 'a', t: 7 } });
    expect(await screen.findByText('one two', { normalizer: (s) => s.replace(/\s+/g, ' ') })).toBeInTheDocument();
  });

  it('omits context when there is no position', async () => {
    const { postMessage, user } = await setup([], { position: null });
    await user.type(screen.getByRole('textbox'), 'hi{Enter}');
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'message', text: 'hi', context: undefined }));
  });

  it('whitespace-only text does not send', async () => {
    const { postMessage, user } = await setup();
    await user.type(screen.getByRole('textbox'), '   {Enter}');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('a rejected ask keeps the text and shows the error', async () => {
    const { postMessage, user } = await setup();
    postMessage.mockRejectedValueOnce(new Error('Server said no'));
    const box = screen.getByRole('textbox');
    await user.type(box, 'keep me');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const err = await screen.findByText('Server said no');
    expect(err.className).toMatch(/bg-og-red/);
    expect(box).toHaveValue('keep me');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled();
  });

  it('disables Ask while sending', async () => {
    const { postMessage, user } = await setup();
    let release!: () => void;
    postMessage.mockImplementationOnce(
      () => new Promise((r) => { release = () => r({ id: 'z', ts: 't', type: 'message', text: 'q' } as never); }),
    );
    await user.type(screen.getByRole('textbox'), 'q');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()); // empty field
  });

  it('shows a counter after 3,500 characters', async () => {
    const { user } = await setup();
    const box = screen.getByRole('textbox');
    expect(box).toHaveAttribute('maxlength', '4000');
    await user.type(box, 'a'.repeat(10));
    expect(screen.queryByText(/\/ ?4,?000/)).toBeNull();
    await user.clear(box);
    await user.click(box);
    await user.paste('a'.repeat(3501));
    expect(screen.getByText('3501/4000')).toBeInTheDocument();
  });
});
