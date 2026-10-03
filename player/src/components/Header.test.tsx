import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';

afterEach(cleanup);

describe('Header', () => {
  it('shows the logo, title and tagline', () => {
    render(<Header title="How the cache works" connected onExport={() => {}} />);
    expect(screen.getByText('yap')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How the cache works' })).toBeInTheDocument();
    expect(screen.getByText('Claude yaps. You watch.')).toBeInTheDocument();
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
});
