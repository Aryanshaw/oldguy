import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chapter, Shape } from '@/types';
import type { Player } from './usePlayer';
import { VideoStage } from './VideoStage';

vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), getCaptionsText: vi.fn().mockResolvedValue(null) }));

afterEach(cleanup);

// The parts of a player the stage reads, idle with nothing playing.
const player = {
  refA: createRef<HTMLVideoElement>(),
  refB: createRef<HTMLVideoElement>(),
  visible: 'a',
  state: 'idle',
  position: null,
  play: () => {},
} as unknown as Player;

const chapters: Chapter[] = [
  { id: 'a', title: 'A', parent_id: null, status: 'ready', quality: 'draft', duration_s: 10, poster: null, question: null },
];

// The stage box rendered for a shape (or none, the 16:9 default).
function stageFor(shape?: Shape): HTMLElement {
  const { container } = render(<VideoStage player={player} chapters={chapters} captionsOn={false} shape={shape} />);
  return container.querySelector('[data-shape]') as HTMLElement;
}

describe('VideoStage shape', () => {
  it('is wide by default, the full column width', () => {
    const box = stageFor();
    expect(box).toHaveAttribute('data-shape', '16:9');
    expect(box.className).toMatch(/aspect-video w-full/);
  });
  it('a tall video is 9:16, capped in height so it fits beside the chat, and centred', () => {
    const box = stageFor('9:16');
    expect(box.className).toMatch(/aspect-\[9\/16\]/);
    expect(box.className).toMatch(/h-\[min\(72vh,760px\)\]/);
    expect(box.className).toMatch(/mx-auto/);
    expect(box.className).toMatch(/max-w-full/);
  });
  it('a square video is 1:1 with the same cap', () => {
    const box = stageFor('1:1');
    expect(box.className).toMatch(/aspect-square/);
    expect(box.className).toMatch(/h-\[min\(72vh,760px\)\]/);
  });
});

describe('VideoStage chapter break', () => {
  const two: Chapter[] = [
    { ...chapters[0], id: 'form', title: 'What the form sends' },
    { ...chapters[0], id: 'save', title: 'Where it is saved' },
  ];

  it('after a chapter ends, shows its title and closing line with replay and next', async () => {
    const { getCaptionsText } = await import('@/api/client');
    vi.mocked(getCaptionsText).mockResolvedValueOnce('WEBVTT\n\n00:00.000 --> 00:02.000\nYou press Add.\n\n00:02.000 --> 00:03.000\nSo nothing is\n\n00:03.000 --> 00:04.000\nsaved yet.\n');
    const play = vi.fn();
    const replay = vi.fn();
    const held = { ...player, state: 'paused', held: 'form', position: { chapterId: 'save', offset: 0 }, play, replay } as unknown as Player;
    const { findByText, getByRole } = render(<VideoStage player={held} chapters={two} captionsOn={false} />);
    expect(getByRole('dialog', { name: 'What the form sends finished' })).toBeInTheDocument();
    expect(await findByText('So nothing is saved yet.')).toBeInTheDocument();
    getByRole('button', { name: 'Next: Where it is saved ▶' }).click();
    expect(play).toHaveBeenCalled();
    getByRole('button', { name: '↺ Replay' }).click();
    expect(replay).toHaveBeenCalled();
  });

  it('shows nothing while playing or when no chapter was held', () => {
    const playing = { ...player, state: 'playing', held: 'form', position: { chapterId: 'save', offset: 1 } } as unknown as Player;
    const { queryByRole, rerender } = render(<VideoStage player={playing} chapters={two} captionsOn={false} />);
    expect(queryByRole('dialog')).toBeNull();
    rerender(<VideoStage player={{ ...player, held: null } as unknown as Player} chapters={two} captionsOn={false} />);
    expect(queryByRole('dialog')).toBeNull();
  });
});
