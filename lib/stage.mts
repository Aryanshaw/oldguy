// The stage driver: builds a chapter's page (index.html) from its template's fixed layout, the video's shape, the
// chapter's timing and its scene pieces. A template's stage.html is layout only: CSS and five markers. Everything that
// moves (who is speaking, which caption word is up, when a source chip shows, the background loop) is written here
// from the timing record, so a template holds no timing code at all.
//
// stage.html is a fragment: any <style> blocks (which may use [data-shape="9:16"] selectors), then markup holding
// these markers, each on its own line:
//   <!-- oldguy:background -->  the template's background loop, if it has one
//   <!-- oldguy:slot -->        the chapter's scene, drawn at 1920x1080 and scaled into the shape's slot box
//   <!-- oldguy:speakers -->    one element per speaker (.og-speaker .og-speaker-<side>)
//   <!-- oldguy:captions -->    .og-cap elements, one per line or per word, by the template's pace
//   <!-- oldguy:chips -->       .og-chip elements, the file:line sources of each claim line
// Only the slot marker is required. explainer's stage is the slot marker alone, and for explainer at 16:9 the page is
// byte for byte what oldguy built before templates existed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { renderPiece, KIT_DIR, GSAP_NAME } from './pieces.mts';
import { SHAPES, slotBox } from './template.mts';
import type { Shape, Template } from './template.mts';
import type { Timing } from './word-times.mts';

// A scene piece placed in time (the shape lib/chapter.mts's pieceWindows returns).
type StagePiece = { piece: string; params: unknown; startS: number; durationS: number; beatsS: number[] };
// What buildStagePage takes. `stage` is the stage.html text (read from the template folder when left out).
type StageInput = { id: string; template: Template; shape: Shape; timing: Timing; pieces: StagePiece[]; stage?: string };
// The stage.html split into its styles and its markup lines.
type StageParts = { css: string; lines: string[] };

const MARKERS = ['background', 'slot', 'speakers', 'captions', 'chips'] as const;
// The scene kit draws every piece on a stage of this size; the slot scales it.
const SCENE_W = 1920;
const SCENE_H = 1080;

// Escapes text for HTML element content and attribute values.
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A number of seconds as the timeline writes it: at most three decimals.
function sec(n: number): string {
  return String(Number(n.toFixed(3)));
}

// Splits stage.html into its styles and its markup lines, and checks the markers: known names, each at most once,
// alone on its line, and the slot present.
function splitStage(stage: string): StageParts {
  let css = '';
  const markup = stage.replace(/<style>([\s\S]*?)<\/style>/gi, (_, body: string) => {
    css += body.trim() ? `${body.trim()}\n` : '';
    return '';
  });
  const lines = markup.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  const seen = new Set<string>();
  for (const m of markup.matchAll(/<!--\s*oldguy:([a-z-]+)\s*-->/g)) {
    if (!(MARKERS as readonly string[]).includes(m[1])) throw new Error(`stage.html: unknown marker oldguy:${m[1]}; use ${MARKERS.join(', ')}`);
    if (seen.has(m[1])) throw new Error(`stage.html: marker oldguy:${m[1]} appears twice`);
    seen.add(m[1]);
  }
  for (const line of lines) {
    if (/<!--\s*oldguy:/.test(line) && !/^\s*<!--\s*oldguy:[a-z-]+\s*-->\s*$/.test(line)) throw new Error(`stage.html: a marker must be alone on its line: ${line.trim()}`);
  }
  if (!seen.has('slot')) throw new Error('stage.html: the <!-- oldguy:slot --> marker is required');
  return { css: css.trimEnd(), lines };
}

// The marker a markup line holds, or null for an ordinary line.
function markerOf(line: string): string | null {
  const m = /^\s*<!--\s*oldguy:([a-z-]+)\s*-->\s*$/.exec(line);
  return m ? m[1] : null;
}

// The slot: the rendered pieces as they are when the slot is the whole 1920x1080 frame, otherwise a box at the slot's
// place holding a 1920x1080 stage scaled to fit it (centred), so no scene piece needs to know the shape.
function slotHtml(pieceHtml: string[], t: Template, shape: Shape): string[] {
  const [x, y, w, h] = slotBox(t, shape);
  if (x === 0 && y === 0 && w === SCENE_W && h === SCENE_H) return pieceHtml;
  const scale = Math.min(w / SCENE_W, h / SCENE_H);
  const ox = (w - SCENE_W * scale) / 2;
  const oy = (h - SCENE_H * scale) / 2;
  return [
    `<div class="og-slot" style="position: absolute; left: ${x}px; top: ${y}px; width: ${w}px; height: ${h}px; overflow: hidden;">`,
    `<div class="og-slot-stage" style="position: absolute; left: ${sec(ox)}px; top: ${sec(oy)}px; width: ${SCENE_W}px; height: ${SCENE_H}px; transform: scale(${Number(scale.toFixed(6))}); transform-origin: 0 0;">`,
    ...pieceHtml,
    '</div>',
    '</div>',
  ];
}

// The background loop: back-to-back muted clips of the template's footage covering the chapter, the first starting
// at an offset taken from the chapter id, so neighbouring chapters do not open on the same frame.
function backgroundHtml(id: string, t: Template, durationS: number): string[] {
  if (!t.background || !t.background_seconds) return [];
  const length = t.background_seconds;
  const offset = crypto.createHash('sha256').update(id).digest().readUInt32BE(0) % Math.max(1, Math.floor(length * 10)) / 10;
  const src = t.background;
  const clips: string[] = [];
  let at = 0;
  let from = offset;
  for (let n = 0; at < durationS - 1e-6; n++) {
    const take = Math.min(length - from, durationS - at);
    // full frame and cropped to cover it by default (square footage serves every shape); a stage may restyle .og-bg-clip
    clips.push(`<video id="og-bg-${n}" class="og-bg-clip" src="${esc(src)}" muted playsinline data-start="${sec(at)}" data-duration="${sec(take)}" data-media-start="${sec(from)}" data-track-index="1" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"></video>`);
    at += take;
    from = 0;
  }
  return clips;
}

// The speakers: one element per speaker, its idle picture and (if it has one) its talking picture.
function speakersHtml(t: Template): string[] {
  return t.speakers.map((s) => {
    // both pictures fill the speaker's box on top of each other, so swapping them never moves the character
    const fit = 'style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: contain;"';
    const idle = s.image ? `<img class="og-speaker-idle" src="${esc(s.image)}" alt="" ${fit} />` : '';
    const talk = s.talking ? `<img class="og-speaker-talk" src="${esc(s.talking)}" alt="" ${fit} />` : '';
    return `<div id="og-sp-${s.id}" class="og-speaker og-speaker-${s.side}" data-speaker="${s.id}">${idle}${talk}</div>`;
  });
}

// The text a caption shows: the words as spoken, without the backticks used to mark code names.
function captionText(text: string): string {
  return esc(text.replace(/`/g, ''));
}

// The captions: one element per line or per word, by the template's pace (none for explainer).
function captionsHtml(t: Template, timing: Timing): string[] {
  if (t.pace.captions === 'line') return timing.lines.map((l, i) => `<div id="og-cap-${i}" class="og-cap og-cap-line">${captionText(l.text)}</div>`);
  if (t.pace.captions === 'word') return timing.words.map((w, i) => `<div id="og-cap-${i}" class="og-cap og-cap-word">${captionText(w.text.replace(/[.,;:!?]+$/, ''))}</div>`);
  return [];
}

// The source chips: on each claim line, the file:line of every source it cites.
function chipsHtml(timing: Timing): string[] {
  return timing.lines.flatMap((l, i) => (l.kind === 'claim' && l.chips.length ? [`<div id="og-chip-${i}" class="og-chip">${esc(l.chips.join(' · '))}</div>`] : []));
}

// The timeline lines for everything the driver placed: speaker swaps and talking, caption and chip windows.
function stageTimeline(t: Template, timing: Timing, markers: Set<string>): string[] {
  const tl: string[] = [];
  // shows an element for [start, end): hidden from the start of the chapter, shown at start, hidden again at end
  const window = (sel: string, start: number, end: number) => {
    tl.push(`tl.set(${JSON.stringify(sel)}, {opacity: 0}, 0);`, `tl.set(${JSON.stringify(sel)}, {opacity: 1}, ${sec(start)});`);
    if (end < timing.durationS) tl.push(`tl.set(${JSON.stringify(sel)}, {opacity: 0}, ${sec(end)});`);
  };
  if (markers.has('speakers') && t.speakers.length) {
    tl.push('tl.set(".og-speaker", {opacity: 0}, 0);', 'tl.set(".og-speaker-talk", {opacity: 0}, 0);');
    timing.lines.forEach((l) => {
      if (!l.speaker) return;
      const me = `#og-sp-${l.speaker}`;
      const others = t.speakers.filter((s) => s.id !== l.speaker).map((s) => `#og-sp-${s.id}`);
      tl.push(`tl.set(${JSON.stringify(me)}, {opacity: 1}, ${sec(l.start)});`);
      if (others.length) tl.push(`tl.set(${JSON.stringify(others.join(', '))}, {opacity: 0}, ${sec(l.start)});`);
      const s = t.speakers.find((x) => x.id === l.speaker);
      if (s && s.talking) {
        // the talking picture is up while the line is spoken, the idle one between lines
        tl.push(`tl.set("${me} .og-speaker-talk", {opacity: 1}, ${sec(l.start)});`, `tl.set("${me} .og-speaker-talk", {opacity: 0}, ${sec(l.end)});`);
      } else {
        // a small bob while speaking, so it is clear who talks
        const bobs = Math.max(1, Math.floor((l.end - l.start) / 0.36) * 2 - 1);
        tl.push(`tl.fromTo(${JSON.stringify(me)}, {y: 0}, {y: -14, duration: 0.18, repeat: ${bobs}, yoyo: true}, ${sec(l.start)});`);
      }
    });
  }
  if (markers.has('captions')) {
    if (t.pace.captions === 'line') timing.lines.forEach((l, i) => window(`#og-cap-${i}`, l.start, l.end));
    if (t.pace.captions === 'word') timing.words.forEach((w, i) => window(`#og-cap-${i}`, w.start, w.end));
  }
  if (markers.has('chips')) {
    timing.lines.forEach((l, i) => {
      if (l.kind === 'claim' && l.chips.length) window(`#og-chip-${i}`, l.start, l.end);
    });
  }
  return tl;
}

// Builds the chapter page: one root of the shape's size, the theme and the stage's styles, the stage markup with its
// markers filled, the narration, and one paused GSAP timeline holding the pieces' and the stage's animation.
function buildStagePage({ id, template, shape, timing, pieces, stage }: StageInput): string {
  // the id lands in an attribute and a script, so only an already-slugged id is accepted
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`composition id "${id}" must be a slug (a-z, 0-9, hyphens)`);
  const durationS = timing.durationS;
  if (typeof durationS !== 'number' || !Number.isFinite(durationS) || durationS <= 0) throw new Error('composition duration must be a number of seconds above 0');
  if (!template.shapes.includes(shape)) throw new Error(`template ${template.id} has no ${shape} layout; it offers ${template.shapes.join(', ')}`);
  const { width: W, height: H } = SHAPES[shape];
  const parts = splitStage(stage ?? fs.readFileSync(path.join(template.dir, 'stage.html'), 'utf8'));
  const markers = new Set(parts.lines.map(markerOf).filter((m): m is string => m !== null));
  const theme = fs.readFileSync(path.join(KIT_DIR, 'theme.css'), 'utf8');
  const rendered = pieces.map((p, i) => renderPiece(p, { startS: p.startS, durationS: p.durationS, idPrefix: `p${i}`, beatsS: p.beatsS }));
  const fill: Record<string, string[]> = {
    background: backgroundHtml(id, template, durationS),
    slot: slotHtml(rendered.map((r) => r.html), template, shape),
    speakers: speakersHtml(template),
    captions: captionsHtml(template, timing),
    chips: chipsHtml(timing),
  };
  const body = parts.lines.flatMap((line) => {
    const m = markerOf(line);
    return m === null ? [line] : fill[m];
  });
  // a stage with its own styles may style each shape, so the root says which shape it is
  const shapeAttr = parts.css ? ` data-shape="${shape}"` : '';
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8" />',
    `<meta name="viewport" content="width=${W}, height=${H}" />`,
    `<title>${id}</title>`,
    `<script src="${GSAP_NAME}"></script>`,
    // the stage is a fixed box of the shape's size the pieces are laid over
    '<style>',
    `html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: var(--og-black); }`,
    `#root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: var(--og-black); }`,
    theme,
    ...(parts.css ? [parts.css] : []),
    '</style>',
    '</head>',
    '<body>',
    `<div id="root" data-composition-id="${id}" data-start="0" data-width="${W}" data-height="${H}" data-duration="${durationS}"${shapeAttr}>`,
    ...body,
    // the narration sits beside index.html; Hyperframes plays it on its own track (an audio element needs an id or it is silent)
    `<audio id="narration" src="narration.wav" data-start="0" data-duration="${durationS}" data-track-index="10" data-volume="1"></audio>`,
    '</div>',
    '<script>',
    'const tl = gsap.timeline({ paused: true });',
    ...rendered.map((r) => r.timeline).filter(Boolean),
    ...stageTimeline(template, timing, markers),
    `window.__timelines[${JSON.stringify(id)}] = tl;`,
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// The asset files a page built for this template loads, as template-relative paths: the background and the speakers'
// pictures. The page names them by those same paths, so narrate copies each to the same place under the chapter folder.
function stageAssets(t: Template): string[] {
  const files = new Set<string>();
  if (t.background) files.add(t.background);
  for (const s of t.speakers) {
    if (s.image) files.add(s.image);
    if (s.talking) files.add(s.talking);
  }
  return [...files];
}

export { buildStagePage, splitStage, stageAssets };
export type { StageInput, StagePiece };
