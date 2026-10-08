import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTemplates, postMessage } from '@/api/client';
import type { TemplateCard, TemplatesInfo } from '@/types';
import { TemplatesButton } from './TemplateGallery';

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  getTemplates: vi.fn(),
  postMessage: vi.fn(),
}));

const card = (over: Partial<TemplateCard>): TemplateCard => ({
  id: 'x', title: 'X', description: 'd', shapes: ['16:9'], tags: [], voices: [{ id: 'narrator', voice: 'af_heart' }],
  captions: 'none', chapter_seconds: [20, 40], sample: false, poster: false, ...over,
});
const tags = ['calm', 'diagrams', 'reel', 'gameplay', 'analogy', 'whiteboard', 'podcast', 'characters', 'noir', 'lab'];
const INFO: TemplatesInfo = {
  current: { template: 'explainer', shape: '9:16' },
  templates: [
    card({ id: 'explainer', title: 'Explainer', description: 'A calm narrator.', shapes: ['16:9', '9:16', '1:1'], tags: tags.slice(0, 5), sample: true, poster: true }),
    card({ id: 'duo', title: 'Two voices', description: 'One asks, one explains.', shapes: ['16:9', '9:16'], tags: tags.slice(2),
      voices: [{ id: 'kid', voice: 'bm_george' }, { id: 'dad', voice: 'am_adam' }], captions: 'word', chapter_seconds: [30, 60] }),
    card({ id: 'tutor', title: 'Tutor', description: 'A professor on a blackboard.', shapes: ['16:9'], tags: ['diagrams'], voices: [{ id: 'professor', voice: 'bm_george' }], captions: 'line' }),
  ],
};

beforeEach(() => {
  vi.mocked(getTemplates).mockResolvedValue(INFO);
  vi.mocked(postMessage).mockResolvedValue({ id: 'evt_1', ts: 't', type: 'remake' } as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Opens the gallery from the header button and waits for the templates.
async function open() {
  render(<TemplatesButton />);
  await userEvent.click(screen.getByRole('button', { name: 'Templates' }));
  await screen.findByRole('button', { name: /Two voices/, pressed: false });
  return screen.getByRole('dialog');
}

describe('template gallery', () => {
  it('opens from Templates and says what this video is now', async () => {
    const dialog = await open();
    expect(within(dialog).getByText(/Explainer · Tall 9:16/)).toBeInTheDocument();
    expect(within(dialog).getByText('3 templates')).toBeInTheDocument();
    expect(within(dialog).getByText('In use')).toBeInTheDocument();
  });

  it('shows the poster for a template with one, and "Preview coming" otherwise', async () => {
    const dialog = await open();
    expect(within(dialog).getAllByAltText('Explainer preview')[0]).toHaveAttribute('src', '/api/templates/explainer/poster');
    expect(within(dialog).getAllByText('Preview coming').length).toBeGreaterThan(0);
  });

  it('filters by search and facets, counts what matches, and clears', async () => {
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Search templates'), 'professor');
    expect(within(dialog).getByText('1 of 3 templates match')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear filters' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Two voices/ }));
    expect(within(dialog).getByText('1 of 3 templates match')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear filters' }));
    const rail = within(dialog).getByRole('navigation', { name: 'Filters' });
    await userEvent.click(within(rail).getByRole('radio', { name: /Square 1:1/ }));
    const cards = [...dialog.querySelectorAll<HTMLElement>('[data-template]')].map((b) => b.dataset.template);
    expect(cards).toEqual(['explainer']);
    expect(within(dialog).getByText('1 of 3 templates match')).toBeInTheDocument();
  });

  it('shows 8 styles in a fixed list, the rest behind Show all', async () => {
    const dialog = await open();
    const styles = within(dialog).getByRole('group', { name: 'Style' });
    expect(within(styles).getAllByRole('checkbox')).toHaveLength(8);
    await userEvent.click(within(styles).getByRole('button', { name: 'Show all 10 styles' }));
    expect(within(styles).getAllByRole('checkbox')).toHaveLength(10);
  });

  it('shows the selected template in detail and remakes it in the chosen shape', async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: /Two voices/ }));
    const detail = within(dialog).getByRole('complementary', { name: 'Selected template' });
    expect(within(detail).getByText('Kid (British male), Dad (American male)')).toBeInTheDocument();
    expect(within(detail).getByText('Word by word')).toBeInTheDocument();
    expect(within(detail).getByText('About 30 to 60 seconds')).toBeInTheDocument();
    expect(within(detail).getByRole('radio', { name: 'Tall 9:16' })).toBeChecked();
    await userEvent.click(within(detail).getByRole('radio', { name: 'Wide 16:9' }));
    await userEvent.click(within(detail).getByRole('button', { name: 'Remake as Two voices' }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'remake', template: 'duo', shape: '16:9' });
    expect(await screen.findByRole('status')).toHaveTextContent('Remaking as Two voices · 16:9…');
  });

  it('shows the poster in detail and mounts the clip only on Play sample', async () => {
    const dialog = await open();
    const detail = within(dialog).getByRole('complementary', { name: 'Selected template' });
    expect(detail.querySelector('video')).toBeNull();
    await userEvent.click(within(detail).getByRole('button', { name: '▶ Play sample' }));
    expect(within(detail).getByLabelText('Explainer sample')).toHaveAttribute('src', '/api/templates/explainer/sample');
  });

  it('will not remake into the look the video already has', async () => {
    const dialog = await open();
    const detail = within(dialog).getByRole('complementary', { name: 'Selected template' });
    expect(within(detail).getByRole('button', { name: 'This is the current look' })).toBeDisabled();
    await userEvent.click(within(detail).getByRole('radio', { name: 'Square 1:1' }));
    expect(within(detail).getByRole('button', { name: 'Remake as Explainer' })).toBeEnabled();
  });

  it('shows a refused remake inline, and a failed load with Try again', async () => {
    vi.mocked(postMessage).mockRejectedValue(new Error('unknown template "duo"'));
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: /Two voices/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remake as Two voices' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('unknown template "duo"');
    cleanup();
    vi.mocked(getTemplates).mockRejectedValueOnce(new Error('the server did not answer'));
    render(<TemplatesButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Templates' }));
    expect(await screen.findByText(/Could not load the templates: the server did not answer/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('3 templates')).toBeInTheDocument();
  });
});
