import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';

afterEach(cleanup);

describe('Header', () => {
  it('shows the logo, title and tagline', () => {
    render(<Header title="How the cache works" connected onExport={() => {}} />);
    expect(screen.getByText('oldguy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How the cache works' })).toBeInTheDocument();
    expect(screen.getByText('Ask the old guy. Claude yaps. You watch.')).toBeInTheDocument();
  });
  it('shows the old guy mascot as decoration, hidden from screen readers', () => {
    const { container } = render(<Header title="T" connected onExport={() => {}} />);
    const mascot = container.querySelector('[data-mascot]');
    expect(mascot).not.toBeNull();
    expect(mascot).toHaveAttribute('aria-hidden', 'true');
  });
  it('pill follows claudeConnected', () => {
    const { rerender } = render(<Header title="T" connected onExport={() => {}} />);
    expect(screen.getByText('Claude connected')).toBeInTheDocument();
    rerender(<Header title="T" connected={false} onExport={() => {}} />);
    expect(screen.getByText('Claude not connected')).toBeInTheDocument();
  });
  it('Export button calls onExport', async () => {
    const onExport = vi.fn();
    render(<Header title="T" connected onExport={onExport} />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
  it('shows the template label only when given, and the remake control beside Export', () => {
    const { container, rerender } = render(<Header title="T" connected onExport={() => {}} />);
    expect(container.querySelector('[data-template-label]')).toBeNull();
    rerender(<Header title="T" connected onExport={() => {}} label="tutor · 9:16" remake={<button type="button">Remake as…</button>} />);
    expect(screen.getByText('tutor · 9:16')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remake as…' })).toBeInTheDocument();
  });
});
