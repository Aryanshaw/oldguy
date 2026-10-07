import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '@/types';
import { Timeline } from './Timeline';

const ch = (id: string, over: Partial<Chapter> = {}): Chapter => ({
  id,
  title: `Title ${id}`,
  parent_id: null,
  status: 'ready',
  quality: 'full',
  duration_s: 64,
  poster: null,
  question: null,
  ...over,
});

afterEach(cleanup);

function setup(chapters: Chapter[], extra: Partial<React.ComponentProps<typeof Timeline>> = {}) {
  const onSeek = vi.fn();
  const onRetry = vi.fn();
  const utils = render(
    <Timeline
      chapters={chapters}
      position={{ chapterId: 'b', offset: 0 }}
      failReasons={{}}
      onSeek={onSeek}
      onRetry={onRetry}
      {...extra}
    />,
  );
  return { onSeek, onRetry, ...utils };
}
const block = (name: RegExp | string) => screen.getByRole('button', { name });

describe('looks', () => {
  it('played: black with cream text', () => {
    setup([ch('a'), ch('b'), ch('c')]);
    const el = block('Title a, played, 1:04');
    expect(el).toHaveClass('bg-yk-black', 'text-yk-cream');
    expect(el.dataset.look).toBe('played');
  });
  it('current: white, yellow fill at offset/duration, lifted with sh', () => {
    setup([ch('a'), ch('b'), ch('c')], { position: { chapterId: 'b', offset: 16 } });
    const el = block('Title b, current, 1:04');
    expect(el).toHaveClass('bg-yk-white', 'sh', '-translate-y-1');
    const fill = el.querySelector('[data-fill]') as HTMLElement;
    expect(fill).toHaveClass('bg-yk-yellow');
    expect(fill.style.width).toBe('25%');
  });
  it('current fill is clamped and survives a null duration', () => {
    setup([ch('b', { duration_s: null })], { position: { chapterId: 'b', offset: 5 } });
    expect((document.querySelector('[data-fill]') as HTMLElement).style.width).toBe('0%');
  });
  it('upcoming: white', () => {
    setup([ch('a'), ch('b'), ch('c')]);
    const el = block('Title c, upcoming, 1:04');
    expect(el).toHaveClass('bg-yk-white');
    expect(el).not.toHaveClass('border-dashed');
  });
  it('follow-up: dashed border, pale orange ground', () => {
    setup([ch('a'), ch('b'), ch('c', { parent_id: 'a' })]);
    const el = block('Title c, upcoming, follow-up, 1:04');
    expect(el).toHaveClass('border-dashed', 'bg-[#FFD9A8]');
  });
  it('rendering: stripes, label, disabled', () => {
    setup([ch('a'), ch('b', { status: 'rendering', duration_s: null })], { position: null });
    const el = block('Title b, rendering');
    expect(el).toHaveClass('yk-stripes');
    expect(el).toHaveAttribute('aria-disabled', 'true');
    expect(el).toHaveTextContent('rendering');
  });
  it('pending: white, dashed, label waiting, disabled', () => {
    setup([ch('a'), ch('b', { status: 'pending', duration_s: null })], { position: null });
    const el = block('Title b, waiting');
    expect(el).toHaveClass('bg-yk-white', 'border-dashed');
    expect(el).toHaveAttribute('aria-disabled', 'true');
    expect(el).toHaveTextContent('waiting');
  });
  it('failed: red, label failed, retry', () => {
    setup([ch('a'), ch('b', { status: 'failed', duration_s: null })], { position: null });
    const el = block('Title b, failed, retry');
    expect(el).toHaveClass('bg-yk-red');
    expect(el).toHaveTextContent('failed, retry');
    expect(el).not.toHaveAttribute('aria-disabled', 'true');
  });
  it('stale: white, dashed grey, struck title, label, disabled', () => {
    setup([ch('a'), ch('b', { status: 'stale' })], { position: null });
    const el = block('Title b, out of date, 1:04');
    expect(el).toHaveClass('bg-yk-white', 'border-dashed', 'border-[#8a8472]');
    expect(el).toHaveAttribute('aria-disabled', 'true');
    expect(el).toHaveTextContent('out of date');
    expect(screen.getByText('Title b')).toHaveClass('line-through');
  });
  it('draft tag only for drafts', () => {
    setup([ch('a', { quality: 'draft' }), ch('b'), ch('c')]);
    expect(screen.getAllByText('draft')).toHaveLength(1);
    expect(block(/^Title a/)).toHaveTextContent('draft');
    expect(block(/^Title a/).getAttribute('aria-label')).toContain('draft');
  });
  it('failed block whose retry was asked reads retry asked', () => {
    setup([ch('a'), ch('b', { status: 'failed', duration_s: null })], { position: null, retried: ['rt:b'] });
    const el = block('Title b, retry asked');
    expect(el).toHaveTextContent('retry asked');
    expect(el).not.toHaveTextContent('failed, retry');
  });
  it('broken ready block renders as failed', () => {
    setup([ch('a'), ch('b'), ch('c')], { broken: ['c'] });
    const el = block('Title c, failed, retry, 1:04');
    expect(el).toHaveClass('bg-yk-red');
    expect(el).toHaveTextContent('failed, retry');
  });
  it('each clip is as wide as its length (6 px a second) and shares spare room by length', () => {
    setup([ch('a', { duration_s: 60 }), ch('b', { duration_s: 120 }), ch('c', { duration_s: 5 })]);
    const clip = (name: RegExp) => block(name).closest<HTMLElement>('[data-clip]')!;
    expect(clip(/^Title a/).style.flexBasis).toBe('360px');
    expect(clip(/^Title b/).style.flexBasis).toBe('720px');
    expect(clip(/^Title c/).style.flexBasis).toBe('140px');
    expect(clip(/^Title b/).style.flexGrow).toBe('120');
    expect(clip(/^Title a/).style.flexShrink).toBe('0');
  });
  it('the track scrolls sideways instead of squeezing clips', () => {
    const { container } = setup([ch('a'), ch('b')]);
    expect(container.querySelector('[data-track]')).toHaveClass('overflow-x-auto');
  });
  it('the ruler labels video time across clips and the playhead sits in the current clip', () => {
    const { container } = setup([ch('a', { duration_s: 20 }), ch('b', { duration_s: 20 })], {
      position: { chapterId: 'b', offset: 5 },
    });
    expect(container.textContent).toContain('0:15');
    expect(container.textContent).toContain('0:30');
    const head = container.querySelectorAll('[data-playhead]');
    expect(head).toHaveLength(1);
    expect(head[0].closest('[data-clip]')).toBe(block(/^Title b/).closest('[data-clip]'));
  });
});

describe('clicks', () => {
  it('seeks to offset 0 on an upcoming ready block', () => {
    const { onSeek } = setup([ch('a'), ch('b'), ch('c')]);
    fireEvent.click(block(/^Title c/), { clientX: 50 });
    expect(onSeek).toHaveBeenCalledWith({ chapterId: 'c', offset: 0 });
  });
  it('seeks to offset 0 on a played block', () => {
    const { onSeek } = setup([ch('a'), ch('b')]);
    fireEvent.click(block(/^Title a/));
    expect(onSeek).toHaveBeenCalledWith({ chapterId: 'a', offset: 0 });
  });
  it('seeks to 16 at 25% of the current 64 s block', () => {
    const { onSeek } = setup([ch('a'), ch('b')]);
    const el = block(/^Title b/);
    el.getBoundingClientRect = () => ({ left: 100, width: 400, right: 500, top: 0, bottom: 0, height: 0, x: 100, y: 0, toJSON() {} });
    fireEvent.click(el, { clientX: 200 });
    expect(onSeek).toHaveBeenCalledWith({ chapterId: 'b', offset: 16 });
  });
  it('clamps a click outside the current block', () => {
    const { onSeek } = setup([ch('b')]);
    const el = block(/^Title b/);
    el.getBoundingClientRect = () => ({ left: 100, width: 400, right: 500, top: 0, bottom: 0, height: 0, x: 100, y: 0, toJSON() {} });
    fireEvent.click(el, { clientX: 9999 });
    expect(onSeek).toHaveBeenCalledWith({ chapterId: 'b', offset: 64 });
  });
  it.each(['rendering', 'pending', 'stale'] as const)('does nothing on %s', (status) => {
    const { onSeek, onRetry } = setup([ch('a'), ch('b', { status, duration_s: null })], { position: null });
    fireEvent.click(block(/^Title b/));
    expect(onSeek).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });
  it('calls onRetry with the id on failed, not onSeek', () => {
    const { onSeek, onRetry } = setup([ch('a'), ch('f', { status: 'failed', duration_s: null })], { position: null });
    fireEvent.click(block(/^Title f/));
    expect(onRetry).toHaveBeenCalledWith('f');
    expect(onSeek).not.toHaveBeenCalled();
  });
  it('calls onRetry for a broken ready block', () => {
    const { onSeek, onRetry } = setup([ch('a'), ch('b')], { broken: ['a'] });
    fireEvent.click(block(/^Title a/));
    expect(onRetry).toHaveBeenCalledWith('a');
    expect(onSeek).not.toHaveBeenCalled();
  });
});

describe('edge cases', () => {
  it('renders an empty bar for no chapters', () => {
    setup([], { position: null });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Chapters' })).toBeInTheDocument();
  });
  it('shows a hostile title as literal text and creates no element from it', () => {
    const title = '<img src=x onerror=alert(1)>';
    const { container } = setup([ch('a', { title })], { position: null });
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });
  it('truncates a 300-character title', () => {
    const title = 'x'.repeat(300);
    setup([ch('a', { title })], { position: null });
    const t = screen.getByText(title);
    expect(t).toHaveClass('truncate');
    expect(block(/^x+,/)).toHaveClass('h-full', 'overflow-hidden');
  });
});

describe('keyboard', () => {
  it('tabs through enabled blocks and Enter seeks', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { onSeek } = setup([ch('a'), ch('b', { status: 'rendering', duration_s: null }), ch('c')], { position: null });
    await user.tab();
    expect(block(/^Title a/)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSeek).toHaveBeenCalledWith({ chapterId: 'a', offset: 0 });
    await user.tab();
    await user.tab();
    expect(block(/^Title c/)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSeek).toHaveBeenLastCalledWith({ chapterId: 'c', offset: 0 });
  });
});

describe('tooltip', () => {
  it('shows full title, duration, poster and fail reason', async () => {
    setup([ch('a', { title: 'Long full title', poster: 'p.png' }), ch('f', { status: 'failed', duration_s: null })], {
      position: null,
      failReasons: { f: 'folder missing' },
    });
    fireEvent.focus(block(/^Long full title/));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Long full title');
    expect(tip).toHaveTextContent('1:04');
    cleanup();
  });
  it('renders the poster image only when poster is set', async () => {
    setup([ch('a', { poster: 'p.png' })], { position: null });
    fireEvent.focus(block(/^Title a/));
    await screen.findByRole('tooltip');
    expect(document.querySelector('img[src="/chapters/a/poster"]')).not.toBeNull();
  });
  it('omits the poster when null', async () => {
    setup([ch('a')], { position: null });
    fireEvent.focus(block(/^Title a/));
    await screen.findByRole('tooltip');
    expect(document.querySelector('img')).toBeNull();
  });
  it('shows the fail reason for a failed chapter', async () => {
    setup([ch('f', { status: 'failed', duration_s: null })], { position: null, failReasons: { f: 'folder missing' } });
    fireEvent.focus(block(/^Title f/));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('folder missing');
  });
  it('shows the load message for a broken ready chapter', async () => {
    setup([ch('a')], { position: null, broken: ['a'] });
    fireEvent.focus(block(/^Title a/));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('The video could not be loaded.');
  });
});
