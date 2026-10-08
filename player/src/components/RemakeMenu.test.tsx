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
    { id: 'explainer', title: 'Explainer', shapes: ['16:9', '9:16', '1:1'] },
    { id: 'tutor', title: 'Tutor', shapes: ['16:9', '9:16'] },
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
  it('opens the list from the server and posts a remake event for the one picked', async () => {
    render(<RemakeMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Remake as…' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Explainer · 9:16 (tall)',
      'Explainer · 1:1 (square)',
      'Tutor · 16:9 (wide)',
      'Tutor · 9:16 (tall)',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: /Tutor · 9:16/ }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'remake', template: 'tutor', shape: '9:16' });
    expect(await screen.findByRole('status')).toHaveTextContent('Remaking as Tutor · 9:16…');
    expect(screen.queryByRole('button', { name: 'Remake as…' })).toBeNull();
  });

  it('shows the server refusal and keeps the menu open', async () => {
    vi.mocked(postMessage).mockRejectedValue(new Error('unknown template "tutor"'));
    render(<RemakeMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Remake as…' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Tutor · 16:9/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unknown template "tutor"');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
