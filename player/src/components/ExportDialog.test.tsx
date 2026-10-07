import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), postExport: vi.fn() }));
import { ApiError, postExport } from '@/api/client';
import { ExportDialog } from './ExportDialog';

const post = vi.mocked(postExport);
const MSG = 'Type the full path of a folder, starting with /';

beforeEach(() => {
  post.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

function setup(open = true) {
  const onClose = vi.fn();
  const utils = render(<ExportDialog open={open} onClose={onClose} />);
  return { onClose, user: userEvent.setup(), ...utils };
}
const field = () => screen.getByLabelText('Folder (full path)');
const exportBtn = () => screen.getByRole('button', { name: /^Export(ing)?$/ });

describe('ExportDialog', () => {
  it('is a native dialog opened with showModal, and the field has the placeholder', () => {
    const { container } = setup();
    expect(container.querySelector('dialog')).toHaveAttribute('open');
    expect(field()).toHaveAttribute('placeholder', '/Users/you/Desktop');
  });
  it('stays closed while open is false', () => {
    const { container } = setup(false);
    expect(container.querySelector('dialog')).not.toHaveAttribute('open');
  });
  it('Cancel closes it', async () => {
    const { user, onClose, container } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(container.querySelector('dialog')).not.toHaveAttribute('open');
    expect(onClose).toHaveBeenCalled();
  });
  it('Escape (the dialog cancel/close event) reports closed', () => {
    const { onClose, container } = setup();
    const d = container.querySelector('dialog')!;
    d.removeAttribute('open');
    fireEvent(d, new Event('close'));
    expect(onClose).toHaveBeenCalled();
  });
  it.each(['', '   ', 'relative/path', '~/x'])('refuses %j and sends nothing', async (v) => {
    const { user } = setup();
    if (v.trim()) await user.type(field(), v);
    await user.click(exportBtn());
    expect(screen.getByText(MSG)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  it('sends full first and lists files and skipped chapters', async () => {
    post.mockResolvedValue({
      file: '/d/x.html',
      files: ['/d/x.html', '/d/x.mp4'],
      skipped: [{ id: 'writes', reason: 'not rendered' }],
    });
    const { user } = setup();
    await user.type(field(), '/Users/me/Out');
    await user.click(exportBtn());
    expect(post).toHaveBeenCalledWith('/Users/me/Out', 'full');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('/d/x.html')).toBeInTheDocument();
    expect(screen.getByText('/d/x.mp4')).toBeInTheDocument();
    expect(screen.getByText('Left out:')).toBeInTheDocument();
    expect(screen.getByText(/writes/)).toHaveTextContent('not rendered');
  });
  it('no Left out line when nothing was skipped', async () => {
    post.mockResolvedValue({ file: '/a', files: ['/a'], skipped: [] });
    const { user } = setup();
    await user.type(field(), '/a');
    await user.click(exportBtn());
    await screen.findByText('Saved');
    expect(screen.queryByText('Left out:')).toBeNull();
  });
  it('a 409 shows the server text and Export drafts, which sends drafts', async () => {
    post.mockRejectedValueOnce(new ApiError(409, 'Some chapters are drafts'));
    post.mockResolvedValueOnce({ file: '/a', files: ['/a'], skipped: [] });
    const { user } = setup();
    await user.type(field(), '/a');
    await user.click(exportBtn());
    expect(await screen.findByText('Some chapters are drafts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export drafts' }));
    expect(post).toHaveBeenLastCalledWith('/a', 'drafts');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
  it.each([400, 503])('a %i shows the server text and no Export drafts', async (status) => {
    post.mockRejectedValue(new ApiError(status, `server said ${status}`));
    const { user } = setup();
    await user.type(field(), '/a');
    await user.click(exportBtn());
    expect(await screen.findByText(`server said ${status}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export drafts' })).toBeNull();
  });
  it('disables both buttons and reads Exporting while a request runs', async () => {
    post.mockRejectedValueOnce(new ApiError(409, 'drafts'));
    let release: (v: { file: string; files: string[]; skipped: [] }) => void = () => {};
    post.mockReturnValueOnce(new Promise((r) => (release = r)));
    const { user } = setup();
    await user.type(field(), '/a');
    await user.click(exportBtn());
    await user.click(await screen.findByRole('button', { name: 'Export drafts' }));
    const busy = screen.getAllByRole('button', { name: 'Exporting' });
    expect(busy).toHaveLength(2);
    for (const b of busy) expect(b).toBeDisabled();
    release({ file: '/a', files: ['/a'], skipped: [] });
    await screen.findByText('Saved');
  });
  it('remembers the path and restores it', async () => {
    post.mockResolvedValue({ file: '/a', files: ['/a'], skipped: [] });
    const first = setup();
    await first.user.type(field(), '/keep/me');
    await first.user.click(exportBtn());
    await screen.findByText('Saved');
    expect(localStorage.getItem('oldguy.exportDest')).toBe('/keep/me');
    cleanup();
    setup();
    expect(field()).toHaveValue('/keep/me');
  });
  it('survives a throwing localStorage', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('no');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('no');
    });
    post.mockResolvedValue({ file: '/a', files: ['/a'], skipped: [] });
    const { user } = setup();
    await user.type(field(), '/a');
    await user.click(exportBtn());
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    get.mockRestore();
    set.mockRestore();
  });
});
