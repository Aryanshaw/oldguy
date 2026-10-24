import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, pickExportFolder, postExport } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const KEY = 'oldguy.exportDest';
const BAD_PATH = 'Choose a folder, or type its full path';
// A full path: /x on macOS and Linux, C:\x on Windows.
const FULL_PATH = /^(\/|[A-Za-z]:[\\/])/;

type Result = Awaited<ReturnType<typeof postExport>>;

function readDest(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [dest, setDest] = useState(readDest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(null);
      setConflict(false);
      setResult(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  /** Opens the computer's folder picker and fills the field; answers the folder, or null when none was chosen. */
  async function choose(): Promise<string | null> {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      const { dest: picked } = await pickExportFolder();
      if (picked) setDest(picked);
      return picked;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function run(mode: 'full' | 'drafts') {
    let path = dest.trim();
    if (!path) path = (await choose()) ?? '';
    if (!path) return;
    if (!FULL_PATH.test(path)) {
      setError(BAD_PATH);
      setConflict(false);
      return;
    }
    try {
      localStorage.setItem(KEY, path);
    } catch {
      /* storage unavailable */
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await postExport(path, mode));
      setConflict(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="bd sh-lg m-auto w-[min(520px,calc(100vw-32px))] rounded-[14px] bg-og-cream p-6 text-og-black backdrop:bg-og-black/50"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void run('full');
        }}
        className="flex flex-col gap-3"
      >
        <h2 className="text-lg font-black">Export</h2>
        <label htmlFor={id} className="text-sm font-black">
          Folder
        </label>
        <div className="flex gap-2">
          <Input
            id={id}
            value={dest}
            placeholder="Choose a folder"
            onChange={(e) => setDest(e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
          <Button variant="plain" disabled={busy} onClick={() => void choose()}>
            Choose…
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm font-bold break-words [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
        {result && (
          <div className="text-sm font-bold">
            <p className="font-black">Saved</p>
            <ul className="list-disc pl-5 break-words [overflow-wrap:anywhere]">
              {result.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {result.skipped.length > 0 && (
              <>
                <p className="mt-2 font-black">Left out:</p>
                <ul className="list-disc pl-5">
                  {result.skipped.map((s) => (
                    <li key={s.id}>
                      {s.id}: {s.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="plain" onClick={() => {
              ref.current?.close();
              onClose();
            }}>
            Cancel
          </Button>
          {conflict && (
            <Button variant="plain" disabled={busy} onClick={() => void run('drafts')}>
              {busy ? 'Exporting' : 'Export drafts'}
            </Button>
          )}
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? 'Exporting' : 'Export'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
