import { useEffect, useRef, useState } from 'react';
import { getTemplates, postMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import type { Shape, TemplatesInfo } from '@/types';

const SHAPE_NAME: Record<Shape, string> = { '16:9': 'wide', '9:16': 'tall', '1:1': 'square' };

type Choice = { template: string; title: string; shape: Shape };

/** Every template and shape the video could be remade as, except the one it already is. */
export function remakeChoices(info: TemplatesInfo): Choice[] {
  return info.templates.flatMap((t) =>
    t.shapes
      .filter((s) => !(t.id === info.current.template && s === info.current.shape))
      .map((shape) => ({ template: t.id, title: t.title, shape })),
  );
}

/**
 * "Remake as…": lists the other templates and shapes and asks Claude (a remake event over the chat bridge) to make the
 * whole video again in the one picked. The old video stays playable; Claude replies in the chat with the new link.
 */
export function RemakeMenu() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<TemplatesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || info) return;
    getTemplates().then(setInfo, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, info]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function pick(c: Choice) {
    setBusy(true);
    setError(null);
    try {
      await postMessage({ type: 'remake', template: c.template, shape: c.shape });
      setAsked(c);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (asked) {
    return (
      <span role="status" className="bd rounded-full bg-og-cream px-3 py-1 text-xs font-black text-og-black">
        Remaking as {asked.title} · {asked.shape}…
      </span>
    );
  }

  const choices = info ? remakeChoices(info) : [];
  return (
    <div ref={box} className="relative">
      <Button variant="plain" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        Remake as…
      </Button>
      {open && (
        <div
          role="menu"
          className="bd sh absolute right-0 top-full z-20 mt-2 flex w-64 flex-col gap-1 rounded-[10px] bg-og-white p-2"
        >
          {!info && !error && <p className="px-2 py-1 text-xs font-bold opacity-70">Loading templates…</p>}
          {info && choices.length === 0 && <p className="px-2 py-1 text-xs font-bold opacity-70">No other template or shape.</p>}
          {choices.map((c) => (
            <button
              key={`${c.template}:${c.shape}`}
              role="menuitem"
              type="button"
              disabled={busy}
              onClick={() => void pick(c)}
              className="cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-sm font-bold hover:bg-og-yellow disabled:opacity-50"
            >
              {c.title} · {c.shape} <span className="text-xs opacity-60">({SHAPE_NAME[c.shape]})</span>
            </button>
          ))}
          {error && (
            <p role="alert" className="min-w-0 rounded-[6px] bg-og-red px-2 py-1 text-xs font-bold text-og-black [overflow-wrap:anywhere]">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
