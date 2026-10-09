import { useEffect, useMemo, useRef, useState } from 'react';
import { getTemplates, postMessage, templatePosterUrl, templateSampleUrl } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  CAPTION_LABEL,
  SHAPE_LABEL,
  VOICE_LABEL,
  allTags,
  emptyFilters,
  facetCounts,
  hasFilters,
  matches,
  tagLabel,
  voiceLabel,
  type CaptionKind,
  type Filters,
  type VoiceKind,
} from '@/lib/templateFilter';
import type { Shape, TemplateCard, TemplatesInfo } from '@/types';

const SHAPES: Shape[] = ['16:9', '9:16', '1:1'];
const VOICE_KINDS: VoiceKind[] = ['narrator', 'one', 'many'];
const CAPTION_KINDS: CaptionKind[] = ['none', 'line', 'word'];
/** Style tags shown before "Show all". */
const TAGS_SHOWN = 8;

type Asked = { template: string; title: string; shape: Shape };

/** True when the viewer asked for less motion; previews then never start on their own. */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Returns a copy of the set with the value added or removed. */
function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** The header control: "Templates" opens the gallery; after a remake was asked for, a note says which. */
export function TemplatesButton() {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState<Asked | null>(null);
  return (
    <>
      {asked && (
        <span role="status" className="bd rounded-full bg-og-cream px-3 py-1 text-xs font-black text-og-black">
          Remaking as {asked.title} · {asked.shape}…
        </span>
      )}
      <Button variant="plain" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Templates
      </Button>
      <TemplateGallery
        open={open}
        onClose={() => setOpen(false)}
        onRemade={(a) => {
          setAsked(a);
          setOpen(false);
        }}
      />
    </>
  );
}

/**
 * The template gallery: every template with a preview, filtered by search and a fixed rail of facets (shape, voices,
 * captions, style), and a detail panel for the one selected, from which the whole video can be remade in it.
 */
export function TemplateGallery({ open, onClose, onRemade }: { open: boolean; onClose: () => void; onRemade: (a: Asked) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<TemplatesInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [allStyles, setAllStyles] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    else if (!open && d.open) d.close?.();
  }, [open]);

  // the catalogue is read when the gallery first opens, and again after a failed read
  useEffect(() => {
    if (!open || info || loadError) return;
    getTemplates().then(
      (i) => {
        setInfo(i);
        setSelected((s) => s ?? i.current.template);
      },
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    );
  }, [open, info, loadError]);

  const all = info?.templates ?? [];
  const shown = useMemo(() => all.filter((t) => matches(t, filters)), [all, filters]);
  const counts = useMemo(() => facetCounts(all, filters), [all, filters]);
  const tags = useMemo(() => allTags(all), [all]);
  const card = all.find((t) => t.id === selected) ?? null;

  return (
    <dialog
      ref={ref}
      aria-labelledby="tg-title"
      onClose={onClose}
      onCancel={onClose}
      className="bd sh-lg fixed inset-0 m-auto h-[calc(100dvh-64px)] max-h-none w-[min(1320px,calc(100vw-64px))] max-w-none overflow-hidden rounded-[16px] bg-og-white p-0 text-og-black backdrop:bg-og-black/55"
    >
      {open && (
        <div className="grid h-full grid-rows-[auto_1fr]">
          <header className="flex items-end gap-6 border-b-3 border-og-black px-6 pb-4 pt-5">
            <div className="min-w-0">
              <h2 id="tg-title" className="text-[26px] font-black tracking-tight">
                Templates
              </h2>
              <p className="mt-1 text-sm font-bold text-og-black/70">
                {info ? (
                  <>
                    This video is{' '}
                    <b className="text-og-black">
                      {all.find((t) => t.id === info.current.template)?.title ?? info.current.template} · {SHAPE_LABEL[info.current.shape]}{' '}
                      {info.current.shape}
                    </b>
                    . The facts stay the same; only how it is told changes.
                  </>
                ) : (
                  'The facts stay the same; only how it is told changes.'
                )}
              </p>
            </div>
            <div className="ml-auto w-80">
              <label htmlFor="tg-search" className="mb-1.5 block text-xs font-black">
                Search templates
              </label>
              <input
                id="tg-search"
                type="search"
                value={filters.query}
                onChange={(e) => setFilters({ ...filters, query: e.target.value })}
                placeholder="Name, voice or style"
                className="bd w-full rounded-[10px] bg-og-white px-3 py-2 text-sm font-bold placeholder:text-og-black/55 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-og-black"
              />
            </div>
            <button
              type="button"
              aria-label="Close templates"
              onClick={onClose}
              className="bd size-10 shrink-0 cursor-pointer rounded-[10px] bg-og-white text-lg font-black hover:bg-og-yellow focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-og-black"
            >
              ✕
            </button>
          </header>

          <div className="grid min-h-0 grid-cols-[210px_minmax(0,1fr)_380px]">
            <FilterRail
              filters={filters}
              setFilters={setFilters}
              counts={counts}
              tags={allStyles ? tags : tags.slice(0, TAGS_SHOWN)}
              hiddenTags={allStyles ? 0 : Math.max(0, tags.length - TAGS_SHOWN)}
              onShowAll={() => setAllStyles(true)}
            />

            <section aria-label="Templates" className="min-w-0 overflow-y-auto px-6 pb-7 pt-4">
              {loadError ? (
                <div role="alert" className="flex flex-col items-start gap-3 pt-6">
                  <p className="text-sm font-bold">Could not load the templates: {loadError}</p>
                  <Button size="sm" onClick={() => setLoadError(null)}>
                    Try again
                  </Button>
                </div>
              ) : !info ? (
                <div aria-busy="true" className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-[18px] gap-y-6 pt-8">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="flex flex-col gap-2.5">
                      <div className="aspect-video rounded-[10px] bg-og-cream" />
                      <div className="h-4 w-2/3 rounded bg-og-cream" />
                      <div className="h-3 w-full rounded bg-og-cream" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <p className="mb-3.5 text-[13px] font-bold text-og-black/70">
                    <b className="text-og-black">
                      {shown.length === all.length ? `${all.length} templates` : `${shown.length} of ${all.length} templates match`}
                    </b>
                    {hasFilters(filters) && (
                      <button
                        type="button"
                        onClick={() => setFilters(emptyFilters())}
                        className="ml-2 cursor-pointer font-black text-og-black underline"
                      >
                        Clear filters
                      </button>
                    )}
                  </p>
                  {shown.length === 0 ? (
                    <p className="pt-10 text-sm font-bold">No template fits these filters. Clear one to see more.</p>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-[18px] gap-y-6">
                      {shown.map((t) => (
                        <Card
                          key={t.id}
                          t={t}
                          inUse={t.id === info.current.template}
                          selected={t.id === selected}
                          onSelect={() => setSelected(t.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            <aside aria-label="Selected template" className="min-w-0 overflow-y-auto border-l-3 border-og-black bg-og-cream px-[22px] pb-6 pt-5">
              {card && info ? (
                <Detail key={card.id} t={card} current={info.current} onRemade={onRemade} />
              ) : (
                <p className="pt-6 text-sm font-bold text-og-black/70">Pick a template to see it play.</p>
              )}
            </aside>
          </div>
        </div>
      )}
    </dialog>
  );
}

/** The fixed filter rail: one group per facet, every option with how many templates it would show. */
function FilterRail({
  filters,
  setFilters,
  counts,
  tags,
  hiddenTags,
  onShowAll,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  counts: ReturnType<typeof facetCounts>;
  tags: string[];
  hiddenTags: number;
  onShowAll: () => void;
}) {
  const row = 'flex cursor-pointer items-center gap-2 rounded-[8px] px-1.5 py-[5px] text-[13px] font-bold hover:bg-og-cream';
  const num = 'ml-auto text-xs tabular-nums text-og-black/70';
  const box = 'size-[15px] accent-og-black';
  return (
    <nav aria-label="Filters" className="flex min-w-0 flex-col gap-[18px] overflow-y-auto border-r-3 border-og-black py-[18px] pl-6 pr-4">
      <fieldset className="flex flex-col gap-0.5">
        <legend className="mb-1.5 text-xs font-black">Shape</legend>
        <label className={row}>
          <input type="radio" name="tg-shape" className={box} checked={filters.shape === 'all'} onChange={() => setFilters({ ...filters, shape: 'all' })} />
          All <span className={num}>{counts.shapeAll}</span>
        </label>
        {SHAPES.map((s) => (
          <label key={s} className={row}>
            <input type="radio" name="tg-shape" className={box} checked={filters.shape === s} onChange={() => setFilters({ ...filters, shape: s })} />
            {SHAPE_LABEL[s]} {s} <span className={num}>{counts.shape.get(s) ?? 0}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-0.5">
        <legend className="mb-1.5 text-xs font-black">Voices</legend>
        {VOICE_KINDS.map((v) => (
          <label key={v} className={row}>
            <input type="checkbox" className={box} checked={filters.voices.has(v)} onChange={() => setFilters({ ...filters, voices: toggle(filters.voices, v) })} />
            {VOICE_LABEL[v]} <span className={num}>{counts.voices.get(v) ?? 0}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-0.5">
        <legend className="mb-1.5 text-xs font-black">Captions</legend>
        {CAPTION_KINDS.map((c) => (
          <label key={c} className={row}>
            <input type="checkbox" className={box} checked={filters.captions.has(c)} onChange={() => setFilters({ ...filters, captions: toggle(filters.captions, c) })} />
            {CAPTION_LABEL[c]} <span className={num}>{counts.captions.get(c) ?? 0}</span>
          </label>
        ))}
      </fieldset>
      {tags.length > 0 && (
        <fieldset className="flex flex-col gap-0.5">
          <legend className="mb-1.5 text-xs font-black">Style</legend>
          {tags.map((tag) => (
            <label key={tag} className={row}>
              <input type="checkbox" className={box} checked={filters.tags.has(tag)} onChange={() => setFilters({ ...filters, tags: toggle(filters.tags, tag) })} />
              {tagLabel(tag)} <span className={num}>{counts.tags.get(tag) ?? 0}</span>
            </label>
          ))}
          {hiddenTags > 0 && (
            <button type="button" onClick={onShowAll} className="mt-1 cursor-pointer self-start px-1.5 py-1 text-xs font-black underline">
              Show all {tags.length + hiddenTags} styles
            </button>
          )}
        </fieldset>
      )}
    </nav>
  );
}

/** One template in the grid: its poster (the clip plays while hovered or focused), name, description and shapes. */
function Card({ t, inUse, selected, onSelect }: { t: TemplateCard; inUse: boolean; selected: boolean; onSelect: () => void }) {
  const [live, setLive] = useState(false);
  const canPlay = t.sample && !prefersReducedMotion();
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-template={t.id}
      onClick={onSelect}
      onMouseEnter={() => setLive(true)}
      onMouseLeave={() => setLive(false)}
      onFocus={() => setLive(true)}
      onBlur={() => setLive(false)}
      className={`-m-2 flex cursor-pointer flex-col gap-2.5 rounded-[12px] p-2 text-left transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-og-black ${selected ? 'bg-og-cream outline-3 outline-og-black' : ''}`}
    >
      <Preview t={t} play={live && canPlay} />
      <span className="flex items-center gap-2 text-base font-black">
        {t.title}
        {inUse && <span className="rounded-[6px] border-2 border-og-black bg-og-yellow px-1.5 text-[11px] font-black">In use</span>}
      </span>
      <span className="line-clamp-2 text-[13px] font-medium leading-snug text-og-black/70">{t.description}</span>
      <span className="text-xs font-bold text-og-black/70">{t.shapes.map((s) => SHAPE_LABEL[s]).join(' · ')}</span>
    </button>
  );
}

/**
 * A 16:9 preview box: the poster (or a striped "Preview coming" tile), with the clip laid over it while playing. The
 * poster stays mounted and the clip ignores the pointer, so a click that starts on the poster always lands on the card.
 */
function Preview({ t, play }: { t: TemplateCard; play: boolean }) {
  return (
    <span className="relative block aspect-video overflow-hidden rounded-[10px] bg-og-black">
      {t.poster ? (
        <img src={templatePosterUrl(t.id)} alt={`${t.title} preview`} loading="lazy" className="size-full object-contain" />
      ) : (
        <span className="og-stripes-static grid size-full place-items-center text-[13px] font-black text-og-cream">Preview coming</span>
      )}
      {play && (
        <video
          src={templateSampleUrl(t.id)}
          muted
          loop
          autoPlay
          playsInline
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full object-contain"
        />
      )}
    </span>
  );
}

/**
 * The detail preview: the poster, fitted whatever its shape, with a Play button; the clip (with controls and sound)
 * mounts only when asked, fitted the same way, so nothing downloads until someone wants to watch.
 */
function DetailPreview({ t }: { t: TemplateCard }) {
  const [playing, setPlaying] = useState(false);
  const box = 'bd relative grid h-[300px] place-items-center overflow-hidden rounded-[12px] bg-og-black';
  if (!t.sample && !t.poster) {
    return (
      <div className={box}>
        <span className="og-stripes-static grid size-full place-items-center text-sm font-black text-og-cream">Preview coming</span>
      </div>
    );
  }
  if (playing || !t.poster) {
    return (
      <div className={box}>
        <video
          src={templateSampleUrl(t.id)}
          controls
          autoPlay={playing}
          playsInline
          preload="metadata"
          aria-label={`${t.title} sample`}
          className="absolute inset-0 size-full object-contain"
        />
      </div>
    );
  }
  return (
    <div className={box}>
      <img
        src={templatePosterUrl(t.id)}
        alt={`${t.title} preview`}
        className="absolute inset-0 size-full object-contain"
      />
      {t.sample && (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="bd sh absolute bottom-3 left-3 cursor-pointer rounded-full bg-og-yellow px-4 py-1.5 text-sm font-black text-og-black active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-og-cream"
        >
          ▶ Play sample
        </button>
      )}
    </div>
  );
}

/** The selected template: its clip with controls, what it is like, a shape to pick, and the remake action. */
function Detail({ t, current, onRemade }: { t: TemplateCard; current: TemplatesInfo['current']; onRemade: (a: Asked) => void }) {
  const [shape, setShape] = useState<Shape>(t.shapes.includes(current.shape) ? current.shape : t.shapes[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCurrent = t.id === current.template && shape === current.shape;
  const voices = t.voices.map((v) => (v.id === 'narrator' ? `Narrator (${voiceLabel(v.voice)})` : `${tagLabel(v.id)} (${voiceLabel(v.voice)})`)).join(', ');

  async function remake() {
    setBusy(true);
    setError(null);
    try {
      await postMessage({ type: 'remake', template: t.id, shape });
      onRemade({ template: t.id, title: t.title, shape });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col gap-4">
      <DetailPreview t={t} />
      <div>
        <h3 className="text-2xl font-black tracking-tight">{t.title}</h3>
        <p className="mt-1 text-sm font-medium leading-relaxed">{t.description}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-[13px]">
        <dt className="font-black">Voices</dt>
        <dd className="font-medium">{voices}</dd>
        <dt className="font-black">Captions</dt>
        <dd className="font-medium">{CAPTION_LABEL[t.captions]}</dd>
        <dt className="font-black">Chapters</dt>
        <dd className="font-medium">
          About {t.chapter_seconds[0]} to {t.chapter_seconds[1]} seconds
        </dd>
      </dl>
      <fieldset>
        <legend className="mb-1.5 text-xs font-black">Shape</legend>
        <div className="bd inline-flex overflow-hidden rounded-[10px]">
          {t.shapes.map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-2 border-r-3 border-og-black px-3.5 py-2 text-[13px] font-black last:border-r-0 has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-og-black ${shape === s ? 'bg-og-yellow' : 'bg-og-white hover:bg-og-cream'}`}
            >
              <input type="radio" name="tg-detail-shape" className="sr-only" checked={shape === s} onChange={() => setShape(s)} />
              {SHAPE_LABEL[s]} {s}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-auto flex flex-col gap-2 pt-2">
        <Button className="w-full justify-center py-3 text-[15px]" disabled={busy || isCurrent} onClick={() => void remake()}>
          {isCurrent ? 'This is the current look' : `Remake as ${t.title}`}
        </Button>
        {error && (
          <p role="alert" className="min-w-0 rounded-[6px] bg-og-red px-2 py-1 text-xs font-bold [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
        <p className="text-xs font-bold text-og-black/70">Your current video stays playable. Claude replies in the chat with the new link.</p>
      </div>
    </div>
  );
}
