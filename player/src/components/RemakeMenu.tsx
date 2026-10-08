import { useEffect, useRef, useState } from 'react';
import { getTemplates, postMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import type { Shape, TemplatesInfo } from '@/types';

const SHAPE_NAME: Record<Shape, string> = { '16:9': 'Wide', '9:16': 'Tall', '1:1': 'Square' };

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
 * "Remake as…": one block per template (its name and what it is like) with a button for each shape it offers; the
 * video's own template and shape is marked and cannot be picked. Picking one asks Claude (a remake event over the chat
 * bridge) to make the whole video again in it. The old video stays playable; Claude replies in the chat with the link.
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

  return (
    <div ref={box} className="relative">
      <Button variant="plain" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        Remake as…
      </Button>
      {open && (
        <div
          role="menu"
          className="bd sh absolute right-0 top-full z-20 mt-2 flex max-h-[70vh] w-80 flex-col gap-2 overflow-y-auto rounded-[10px] bg-og-white p-2"
        >
          {!info && !error && <p className="px-2 py-1 text-xs font-bold opacity-70">Loading templates…</p>}
          {info?.templates.map((t) => (
            <section key={t.id} data-template={t.id} className="flex flex-col gap-1.5 rounded-[8px] bg-og-cream px-3 py-2">
              <p className="text-sm font-black text-og-black">{t.title}</p>
              <p className="text-xs font-bold text-og-black/70">{t.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {t.shapes.map((shape) => {
                  const current = t.id === info.current.template && shape === info.current.shape;
                  return (
                    <button
                      key={shape}
                      role="menuitem"
                      type="button"
                      disabled={busy || current}
                      aria-label={`${t.title} · ${shape}${current ? ' (this video)' : ''}`}
                      onClick={() => void pick({ template: t.id, title: t.title, shape })}
                      className={`bd cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-black text-og-black disabled:cursor-default ${current ? 'bg-og-yellow' : 'bg-og-white hover:bg-og-yellow'} disabled:opacity-100`}
                    >
                      {SHAPE_NAME[shape]} {shape}
                      {current && ' · this video'}
                    </button>
                  );
                })}
              </div>
            </section>
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
