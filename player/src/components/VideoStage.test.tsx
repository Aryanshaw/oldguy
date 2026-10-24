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
