import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine, EngineState } from '@/engine/engine';
import type { Position } from '@/lib/timeline';
import type { Chapter } from '@/types';
import { Controls } from './Controls';
import { VideoStage } from './VideoStage';
import { useCaptionsPref, usePlayer, type CreateEngine } from './usePlayer';

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  getCaptionsText: vi.fn(),
}));
import { getCaptionsText } from '@/api/client';
const getCaps = vi.mocked(getCaptionsText);

const ch = (id: string, over: Partial<Chapter> = {}): Chapter => ({
  id,
  title: id.toUpperCase(),
  parent_id: null,
  status: 'ready',
  quality: 'full',
  duration_s: 64,
  poster: null,
  question: null,
  ...over,
});

function fakeEngine() {
  const fns: Record<string, Set<(d?: unknown) => void>> = { time: new Set(), chapter: new Set(), state: new Set(), error: new Set() };
  let st: EngineState = 'idle';
  let pos: Position | null = null;
  const e = {
    setChapters: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    seek: vi.fn(),
    destroy: vi.fn(),
    position: () => pos,
    state: () => st,
    visible: () => 'a' as const,
    on: (ev: string, fn: (d?: unknown) => void) => {
      fns[ev].add(fn);
      return () => fns[ev].delete(fn);
    },
    // test helpers
    setState(s: EngineState) {
      st = s;
      act(() => fns.state.forEach((f) => f(s)));
    },
    setPos(p: Position | null) {
      pos = p;
      act(() => {
        fns.chapter.forEach((f) => f(p?.chapterId));
        fns.time.forEach((f) => f(p));
      });
    },
    fail(id: string) {
      act(() => fns.error.forEach((f) => f(id)));
    },
    tick(offset: number) {
      pos = { chapterId: pos!.chapterId, offset };
      act(() => fns.time.forEach((f) => f(pos)));
    },
    listeners: () => Object.values(fns).reduce((n, s) => n + s.size, 0),
  };
  return e;
}

let eng: ReturnType<typeof fakeEngine>;
const create: CreateEngine = () => eng as unknown as Engine;

let lastBroken: string[] = [];
function Harness({ chapters }: { chapters: Chapter[] }) {
  const player = usePlayer(chapters, create);
  lastBroken = player.broken;
  const [on, toggle] = useCaptionsPref();
  return (
    <>
      <VideoStage player={player} chapters={chapters} captionsOn={on} />
      <Controls player={player} chapters={chapters} captionsOn={on} onToggleCaptions={toggle} />
      <input aria-label="typing" />
    </>
  );
}

const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nfirst line\n\n00:00:02.500 --> 00:00:05.000\nsecond line\n';
const key = (k: string, target: Element | Window = window) => fireEvent.keyDown(target, { key: k });

beforeEach(() => {
  eng = fakeEngine();
  getCaps.mockReset();
  getCaps.mockResolvedValue(VTT);
  localStorage.clear();
});
afterEach(cleanup);

describe('video stacking', () => {
  it('hides the idle element with opacity 0 and aria-hidden, never with visibility hidden', () => {
    const { container } = render(<Harness chapters={[ch('a')]} />);
    const [a, b] = Array.from(container.querySelectorAll('video'));
    expect(a.style.opacity).toBe('1');
    expect(a.hasAttribute('aria-hidden')).toBe(false);
    expect(b.style.opacity).toBe('0');
    expect(b.style.pointerEvents).toBe('none');
    expect(b.getAttribute('aria-hidden')).toBe('true');
    for (const v of [a, b]) expect(v.style.visibility).not.toBe('hidden');
  });
});

describe('empty state', () => {
  it('says the first chapter is rendering when one is rendering or pending', () => {
    render(<Harness chapters={[ch('a', { status: 'rendering', duration_s: null })]} />);
    expect(screen.getByText('The first chapter is rendering.')).toBeInTheDocument();
    cleanup();
    render(<Harness chapters={[ch('a', { status: 'pending', duration_s: null })]} />);
    expect(screen.getByText('The first chapter is rendering.')).toBeInTheDocument();
  });
  it('says nothing to play yet otherwise', () => {
    render(<Harness chapters={[ch('a', { status: 'failed', duration_s: null })]} />);
    expect(screen.getByText('Nothing to play yet.')).toBeInTheDocument();
    expect(screen.queryByText('The first chapter is rendering.')).toBeNull();
  });
});

describe('usePlayer lifecycle', () => {
  it('creates once, sets chapters on change, destroys on unmount with no leftover listeners', () => {
    const { rerender, unmount } = render(<Harness chapters={[ch('a')]} />);
    const n = eng.setChapters.mock.calls.length;
    rerender(<Harness chapters={[ch('a'), ch('b')]} />);
    expect(eng.setChapters.mock.calls.length).toBe(n + 1);
    unmount();
    expect(eng.destroy).toHaveBeenCalledTimes(1);
    expect(eng.listeners()).toBe(0);
  });
});

describe('broken chapters', () => {
  it('collects engine error ids without duplicates and clears the listener on unmount', () => {
    const { unmount } = render(<Harness chapters={[ch('a'), ch('b')]} />);
    expect(lastBroken).toEqual([]);
    eng.fail('b');
    eng.fail('b');
    eng.fail('a');
    expect(lastBroken).toEqual(['b', 'a']);
    unmount();
    expect(eng.listeners()).toBe(0);
  });
});

describe('broken chapters after a re-render', () => {
  it('drops an id once its chapter is no longer ready, and keeps ids that are still ready', () => {
    const { rerender } = render(<Harness chapters={[ch('a'), ch('b')]} />);
    eng.fail('a');
    eng.fail('b');
    expect(lastBroken).toEqual(['a', 'b']);
    rerender(<Harness chapters={[ch('a'), ch('b', { status: 'rendering', duration_s: null })]} />);
    expect(lastBroken).toEqual(['a']);
    // the re-rendered chapter becomes playable again and is not marked broken
    rerender(<Harness chapters={[ch('a'), ch('b')]} />);
    expect(lastBroken).toEqual(['a']);
  });
});

describe('play button', () => {
  it('calls play and flips its label to Pause when playing', async () => {
    render(<Harness chapters={[ch('a')]} />);
    eng.setPos({ chapterId: 'a', offset: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(eng.play).toHaveBeenCalled();
    eng.setState('playing');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });
  it('shows the big play button when blocked or idle', () => {
    render(<Harness chapters={[ch('a')]} />);
    expect(screen.getByRole('button', { name: 'Play video' })).toBeInTheDocument();
    eng.setState('playing');
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
    eng.setState('blocked');
    expect(screen.getByRole('button', { name: 'Play video' })).toBeInTheDocument();
  });
});

describe('time', () => {
  it('shows 0:00 / 0:00 and never NaN for null durations', () => {
    const { container } = render(<Harness chapters={[ch('a', { duration_s: null })]} />);
    eng.setPos({ chapterId: 'a', offset: NaN });
    expect(container.textContent).toContain('0:00 / 0:00');
    expect(container.textContent).not.toContain('NaN');
  });
  it('shows global time over total', () => {
    render(<Harness chapters={[ch('a', { duration_s: 60 }), ch('b', { duration_s: 275 })]} />);
    eng.setPos({ chapterId: 'b', offset: 65 });
    expect(screen.getByText('2:05 / 5:35')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});

describe('captions', () => {
  it('shows the cue for the offset, switches at 2.5, vanishes when off', async () => {
    render(<Harness chapters={[ch('a')]} />);
    eng.setPos({ chapterId: 'a', offset: 1 });
    expect(await screen.findByText('first line')).toBeInTheDocument();
    expect(screen.getByText('first line')).toHaveAttribute('aria-live', 'off');
    eng.tick(2.6);
    expect(screen.getByText('second line')).toBeInTheDocument();
    key('c');
    expect(screen.queryByText('second line')).toBeNull();
  });
  it('renders nothing for an empty cue', async () => {
    getCaps.mockResolvedValue('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<b></b>\n');
    const { container } = render(<Harness chapters={[ch('a')]} />);
    eng.setPos({ chapterId: 'a', offset: 1 });
    await waitFor(() => expect(getCaps).toHaveBeenCalled());
    expect(container.querySelector('[aria-live="off"]')).toBeNull();
  });
  it('shows nothing on 404 and does not refetch on every update', async () => {
    getCaps.mockResolvedValue(null);
    const { container } = render(<Harness chapters={[ch('a')]} />);
    eng.setPos({ chapterId: 'a', offset: 1 });
    await waitFor(() => expect(getCaps).toHaveBeenCalledTimes(1));
    eng.tick(2);
    eng.tick(3);
    await act(async () => {});
    expect(getCaps).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-live="off"]')).toBeNull();
  });
  it('shows nothing when the fetch rejects', async () => {
    getCaps.mockRejectedValue(new Error('boom'));
    const { container } = render(<Harness chapters={[ch('a')]} />);
    eng.setPos({ chapterId: 'a', offset: 1 });
    await waitFor(() => expect(getCaps).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(container.querySelector('[aria-live="off"]')).toBeNull();
  });
});

describe('keyboard', () => {
  it('Space toggles play, then pause', () => {
    render(<Harness chapters={[ch('a')]} />);
    eng.setPos({ chapterId: 'a', offset: 0 });
    key(' ');
    expect(eng.play).toHaveBeenCalledTimes(1);
    eng.setState('playing');
    key(' ');
    expect(eng.pause).toHaveBeenCalledTimes(1);
  });
  it('c flips aria-pressed and writes localStorage', () => {
    render(<Harness chapters={[ch('a')]} />);
    const cc = screen.getByRole('button', { name: 'CC' });
    expect(cc).toHaveAttribute('aria-pressed', 'true');
    key('c');
    expect(cc).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('yap.captions')).toBe('off');
    key('c');
    expect(cc).toHaveAttribute('aria-pressed', 'true');
  });
  it('ignores keys typed in an input', () => {
    render(<Harness chapters={[ch('a')]} />);
    eng.setPos({ chapterId: 'a', offset: 0 });
    const input = screen.getByLabelText('typing');
    for (const k of [' ', 'ArrowRight', 'ArrowLeft', '[', ']', 'c']) key(k, input);
    expect(eng.play).not.toHaveBeenCalled();
    expect(eng.seek).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'CC' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('ignores shortcuts while a dialog is open and works again after it closes', () => {
    const d = document.createElement('dialog');
    d.setAttribute('open', '');
    document.body.appendChild(d);
    render(<Harness chapters={[ch('a'), ch('b')]} />);
    eng.setPos({ chapterId: 'a', offset: 20 });
    for (const k of ['ArrowRight', ']', 'c', ' ']) key(k);
    expect(eng.seek).not.toHaveBeenCalled();
    expect(eng.play).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'CC' })).toHaveAttribute('aria-pressed', 'true');
    d.removeAttribute('open');
    key('ArrowRight');
    expect(eng.seek).toHaveBeenCalledTimes(1);
    key('c');
    expect(screen.getByRole('button', { name: 'CC' })).toHaveAttribute('aria-pressed', 'false');
    d.remove();
  });
  it('ArrowRight at 62s of a 64s chapter seeks to the next chapter at 3s', () => {
    render(<Harness chapters={[ch('a'), ch('b')]} />);
    eng.setPos({ chapterId: 'a', offset: 62 });
    key('ArrowRight');
    expect(eng.seek).toHaveBeenCalledWith({ chapterId: 'b', offset: 3 });
  });
  it('ArrowLeft steps back within the chapter and ArrowRight stays inside it', () => {
    render(<Harness chapters={[ch('a'), ch('b')]} />);
    eng.setPos({ chapterId: 'a', offset: 20 });
    key('ArrowLeft');
    expect(eng.seek).toHaveBeenLastCalledWith({ chapterId: 'a', offset: 15 });
    key('ArrowRight');
    expect(eng.seek).toHaveBeenLastCalledWith({ chapterId: 'a', offset: 25 });
  });
  it('[ and ] jump chapters; ] on the last chapter does nothing', () => {
    render(<Harness chapters={[ch('a'), ch('b')]} />);
    eng.setPos({ chapterId: 'a', offset: 10 });
    key(']');
    expect(eng.seek).toHaveBeenLastCalledWith({ chapterId: 'b', offset: 0 });
    eng.seek.mockClear();
    eng.setPos({ chapterId: 'b', offset: 10 });
    key(']');
    expect(eng.seek).not.toHaveBeenCalled();
    key('[');
    expect(eng.seek).toHaveBeenCalledWith({ chapterId: 'a', offset: 0 });
  });
  it('removes the window listener on unmount', () => {
    const { unmount } = render(<Harness chapters={[ch('a')]} />);
    unmount();
    key(' ');
    expect(eng.play).not.toHaveBeenCalled();
  });
  it('survives localStorage throwing', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    render(<Harness chapters={[ch('a')]} />);
    const cc = screen.getByRole('button', { name: 'CC' });
    expect(cc).toHaveAttribute('aria-pressed', 'true');
    key('c');
    expect(cc).toHaveAttribute('aria-pressed', 'false');
    get.mockRestore();
    set.mockRestore();
  });
});
