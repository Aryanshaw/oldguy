import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Notice } from './Notice';

afterEach(cleanup);

describe('Notice', () => {
  it('loading shows Loading', () => {
    render(<Notice link="loading" error={null} onRetry={() => {}} />);
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });
  it('error shows the message and Try again calls retry', async () => {
    const retry = vi.fn();
    render(<Notice link="error" error="the server did not answer" onRetry={retry} />);
    expect(screen.getByText('the server did not answer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it('forbidden', () => {
    render(<Notice link="forbidden" error={null} onRetry={() => {}} />);
    expect(screen.getByText('This link has expired. Open the link printed by Yap again.')).toBeInTheDocument();
  });
  it('gone', () => {
    render(<Notice link="gone" error={null} onRetry={() => {}} />);
    expect(screen.getByText("Yap's server stopped. Run /yap again and open the new link.")).toBeInTheDocument();
  });
  it('reconnecting is a slim banner', () => {
    render(<Notice link="reconnecting" error={null} onRetry={() => {}} />);
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
  });
  it('open shows nothing', () => {
    const { container } = render(<Notice link="open" error={null} onRetry={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
