import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, postExport } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const KEY = 'yap.exportDest';
const BAD_PATH = 'Type the full path of a folder, starting with /';

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

  async function run(mode: 'full' | 'drafts') {
    const path = dest.trim();
    if (!path.startsWith('/')) {
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
      className="bd sh-lg m-auto w-[min(520px,calc(100vw-32px))] rounded-[14px] bg-yk-cream p-6 text-yk-black backdrop:bg-yk-black/50"
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
          Folder (full path)
        </label>
        <Input
          id={id}
          value={dest}
          placeholder="/Users/you/Desktop"
          onChange={(e) => setDest(e.target.value)}
          disabled={busy}
          autoComplete="off"
        />
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
