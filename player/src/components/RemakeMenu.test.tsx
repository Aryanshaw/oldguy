import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTemplates, postMessage } from '@/api/client';
import type { TemplatesInfo } from '@/types';
import { RemakeMenu, remakeChoices } from './RemakeMenu';

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  getTemplates: vi.fn(),
  postMessage: vi.fn(),
}));

const INFO: TemplatesInfo = {
  current: { template: 'explainer', shape: '16:9' },
  templates: [
    { id: 'explainer', title: 'Explainer', description: 'A calm narrator.', shapes: ['16:9', '9:16', '1:1'] },
    { id: 'tutor', title: 'Tutor', description: 'A professor builds it up.', shapes: ['16:9', '9:16'] },
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

describe('remakeChoices', () => {
  it('lists every template and shape except the one the video already is', () => {
    expect(remakeChoices(INFO).map((c) => `${c.template} ${c.shape}`)).toEqual([
      'explainer 9:16',
      'explainer 1:1',
      'tutor 16:9',
      'tutor 9:16',
    ]);
  });
});

describe('RemakeMenu', () => {
  it('shows one block per template, with its description and a button per shape; the current one is marked and off', async () => {
    render(<RemakeMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Remake as…' }));
    await screen.findAllByRole('menuitem');
    expect(screen.getByText('Explainer')).toBeInTheDocument();
    expect(screen.getByText('A professor builds it up.')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((i) => i.getAttribute('aria-label'))).toEqual([
      'Explainer · 16:9 (this video)',
      'Explainer · 9:16',
      'Explainer · 1:1',
      'Tutor · 16:9',
      'Tutor · 9:16',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Explainer · 16:9 (this video)' })).toBeDisabled();
  });

  it('posts a remake event for the shape picked, then shows the progress note', async () => {
    render(<RemakeMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Remake as…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Tutor · 9:16' }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'remake', template: 'tutor', shape: '9:16' });
    expect(await screen.findByRole('status')).toHaveTextContent('Remaking as Tutor · 9:16…');
    expect(screen.queryByRole('button', { name: 'Remake as…' })).toBeNull();
  });

  it('shows the server refusal and keeps the menu open', async () => {
    vi.mocked(postMessage).mockRejectedValue(new Error('unknown template "tutor"'));
    render(<RemakeMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Remake as…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Tutor · 16:9' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unknown template "tutor"');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
