// A chapter folder: creating it from a spec, timing its scene pieces, and building its root composition.
import fs from 'node:fs';
import path from 'node:path';
import { splitSentences } from './sentences.mts';
import * as title from '../scene-kit/title.mts';
import * as steps from '../scene-kit/steps.mts';
import * as codeCard from '../scene-kit/code-card.mts';
import * as callout from '../scene-kit/callout.mts';
import * as flow from '../scene-kit/flow.mts';
import * as design from '../scene-kit/design.mts';
import type { Rendered } from '../scene-kit/shared.mts';

// One source a chapter cites: where it lives, which lines, and the exact text quoted from them.
type ChapterSource = { id: string; file: string; lines: [number, number]; quote: string };
// One narrated sentence: a claim must cite sources, a framing sentence carries no claim.
type ChapterSentence = { text: string; kind: 'claim' | 'framing'; source_ids: string[] };
// One scene piece shown while a sentence is spoken: the piece name, its params and the sentence index it starts on.
type ChapterScene = { piece: string; params: unknown; beat: number };
// The chapter.json that `oldguy scaffold` writes.
type ChapterSpec = { id: string; title: string; sources: ChapterSource[]; sentences: ChapterSentence[]; scene: ChapterScene[] };
// What `oldguy scaffold` is handed: a spec that has not been checked yet.
type ScaffoldInput = { root: string; id: unknown; title: unknown; sources: unknown; sentences: unknown; scene: unknown };
// A scene piece placed in time: which piece, its params, when it starts and how long it lasts, and when every sentence
// of the chapter starts (seconds; the flow piece shows its steps on later sentences).
type PieceWindow = { piece: string; params: unknown; startS: number; durationS: number; beatsS: number[] };
// The timed sentences a chapter's pieces are laid against.
type TimedBeat = { start: number };

const KIT_DIR = path.join(import.meta.dirname, '..', 'scene-kit');
// GSAP 3.14.2 from the npm package, kept in the repo (see scene-kit/vendor/README.md). Narrate copies it into the
// chapter folder and the page loads it from there, so checking and rendering a chapter need no network.
const GSAP_NAME = 'gsap.min.js';
const GSAP_FILE = path.join(KIT_DIR, 'vendor', GSAP_NAME);
const MAX_ID_LENGTH = 60;

// The scene pieces a chapter may use, by the name written in chapter.json.
const PIECES: Record<string, { render: (params: unknown, opts: unknown) => Rendered }> = {
  title,
  steps,
  'code-card': codeCard,
  callout,
  flow,
  design,
};

// Turns a free-text id into a folder name: lower-case a-z0-9 words joined by single hyphens, never starting with a digit.
function slugChapterId(raw: unknown): string {
  const text = String(raw ?? '');
  // a slash means someone passed a path; refuse it rather than quietly rewrite it into something else
  if (/[\\/]/.test(text)) throw new Error(`chapter id "${text}" looks like a path; give a plain name`);
  const slug = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-0-9]+/, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/, '');
  if (!slug) throw new Error(`chapter id "${text}" is empty once reduced to letters, digits and hyphens`);
  return slug;
}

// Splits narration into sentences and insists on exactly one per listed sentence (one sentence per beat).
function narrationSentences(text: string, expected: number): string[] {
  const sentences = splitSentences(text);
  if (sentences.length !== expected) {
    throw new Error(`narration has ${sentences.length} sentences but the chapter lists ${expected}; each listed sentence must be exactly one sentence`);
  }
  return sentences;
}

// Collapses every whitespace run to one space, so line endings and double spaces never count as an edit.
function normaliseText(text: unknown): string {
  return String(text).replace(/\s+/g, ' ').trim();
}

// Refuses narration that is not the audited chapter.json sentences joined by spaces: unaudited words must never be spoken.
function checkNarrationText(narration: string, sentences: { text: string }[]): void {
  const expected = normaliseText(sentences.map((s) => s.text).join(' '));
  if (normaliseText(narration) !== expected) {
    throw new Error('narration.txt no longer matches chapter.json: fix the spec, delete the chapter folder, then scaffold, audit and narrate again');
  }
}

// Renders one piece with the scene kit; an unknown piece name is an error that lists the ones that exist.
function renderPiece({ piece, params }: { piece: string; params: unknown }, window: unknown): Rendered {
  if (!Object.hasOwn(PIECES, piece)) {
    throw new Error(`unknown piece "${piece}"; use one of ${Object.keys(PIECES).join('|')}`);
  }
  return PIECES[piece].render(params, window);
}

// Checks each scene entry: a known piece with params the kit accepts, on a whole beat index that moves forward.
function checkScene(scene: unknown, sentenceCount: number): void {
  if (!Array.isArray(scene)) throw new Error('"scene" must be a list');
  let previousBeat = -1;
  const entries: unknown[] = scene;
  entries.forEach((item, i) => {
    // an entry may be anything the JSON held; the beat test below and renderPiece reject every shape that is not a usable piece
    const entry = item as ChapterScene;
    const beat = entry && entry.beat;
    if (!Number.isInteger(beat) || beat < 0 || beat >= sentenceCount || beat <= previousBeat) {
      throw new Error(`scene[${i}]: beat must be a whole sentence index from 0 to ${sentenceCount - 1}, after the previous piece's beat`);
    }
    previousBeat = beat;
    // a throwaway render lets the scene kit itself reject bad params (such as an unknown pointTo); sentence i "starts" at
    // second i, and the window runs to the next piece's beat, so a flow step on a sentence outside its piece is refused
    const next = (entries[i + 1] as ChapterScene | undefined)?.beat;
    const endBeat = typeof next === 'number' && Number.isInteger(next) && next > beat && next <= sentenceCount ? next : sentenceCount;
    const beatsS = Array.from({ length: sentenceCount }, (_, n) => n);
    try {
      renderPiece(entry, { startS: beat, durationS: endBeat - beat, idPrefix: 'check', beatsS });
    } catch (err) {
      // renderPiece only throws Error objects
      throw new Error(`scene[${i}]: ${(err as Error).message}`);
    }
  });
}

// Checks every entry is exactly one sentence and that the joined narration splits back into those same entries,
// so beats, scene pieces and claim labels all point at the same sentence; returns the joined narration.
function checkSentences(sentences: unknown): string {
  if (!Array.isArray(sentences) || sentences.length === 0) throw new Error('"sentences" must be a non-empty list');
  const entries: unknown[] = sentences;
  const rawTexts: string[] = [];
  const texts = entries.map((s, i) => {
    const raw = s ? (s as { text?: unknown }).text : undefined;
    if (typeof raw !== 'string' || !raw.trim()) throw new Error(`sentences[${i}] needs non-empty "text"`);
    rawTexts.push(raw);
    const text = normaliseText(raw);
    const parts = splitSentences(text);
    if (parts.length !== 1 || parts[0] !== text) {
      throw new Error(`sentences[${i}] is not exactly one sentence (it reads as ${parts.length}): "${text}"`);
    }
    return text;
  });
  const narration = rawTexts.join(' ');
  // an entry with no end mark runs into the next one once joined, which moves every later beat
  const spoken = splitSentences(narration);
  const drift = texts.findIndex((text, i) => spoken[i] !== text);
  if (drift !== -1) throw new Error(`sentences[${drift}] does not stay one sentence once joined with the next; end it with . ! or ?`);
  return narration;
}

// Replaces each design piece's {"file": "scenes/x.html"} with the file's text as {"html": ...}, so chapter.json holds
// the whole scene (and build.json fingerprints it). The file must sit inside the video folder.
function inlineSceneFiles(scene: unknown, root: string): unknown {
  if (!Array.isArray(scene)) return scene;
  const entries: unknown[] = scene;
  return entries.map((item, i) => {
    // only a design entry with a "file" changes; checkScene checks every entry's shape right after
    const entry = item as { piece?: unknown; params?: { file?: unknown; html?: unknown } } | null;
    const params = entry && entry.piece === 'design' ? entry.params : undefined;
    if (!params || params.file === undefined) return item;
    const { file, ...rest } = params;
    if (typeof file !== 'string' || !file) throw new Error(`scene[${i}]: design "file" must be a path inside ${root}`);
    const base = path.resolve(root);
    const full = path.resolve(base, file);
    const rel = path.relative(base, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`scene[${i}]: design file ${file} is outside ${root}`);
    let html: string;
    try {
      html = fs.readFileSync(full, 'utf8');
    } catch {
      throw new Error(`scene[${i}]: cannot read design file ${file}`);
    }
    return { ...entry, params: { ...rest, html } };
  });
}

// Creates chapters/<slug>/ with chapter.json and narration.txt; checks everything first and never overwrites.
function scaffoldChapter({ root, id, title, sources, sentences, scene: given }: ScaffoldInput): string {
  const slug = slugChapterId(id);
  if (typeof title !== 'string' || !title.trim()) throw new Error('"title" must be non-empty text');
  if (!Array.isArray(sources)) throw new Error('"sources" must be a list');
  const narration = checkSentences(sentences);
  const scene = inlineSceneFiles(given, root);
  // checkSentences just proved this is a non-empty list
  checkScene(scene, (sentences as unknown[]).length);

  const chaptersDir = path.join(root, 'chapters');
  const dir = path.join(chaptersDir, slug);
  // the slug has no dots or slashes, but prove the folder sits inside chapters/ before writing anything
  if (path.dirname(dir) !== chaptersDir) throw new Error(`chapter id "${slug}" would leave the chapters folder`);
  fs.mkdirSync(chaptersDir, { recursive: true });
  try {
    fs.mkdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`chapter "${slug}" already exists: delete ${dir} and scaffold again`);
    throw err;
  }
  const chapter = { id: slug, title, sources, sentences, scene };
  fs.writeFileSync(path.join(dir, 'chapter.json'), `${JSON.stringify(chapter, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'narration.txt'), `${narration}\n`);
  return dir;
}

// Rounds a length in seconds up to the next tenth; an exact tenth stays (integer maths so 9.4 is not read as 9.400001).
function roundUpTenth(seconds: number): number {
  return Math.ceil(Math.round(seconds * 1e6) / 1e5) / 10;
}

// Gives each scene piece its time window: from its sentence's start to the next piece's start, the last to the end.
function pieceWindows(scene: ChapterScene[], beats: TimedBeat[], durationS: number): PieceWindow[] {
  const beatsS = beats.map((b) => b.start);
  return scene.map((entry, i) => {
    const startS = beats[entry.beat].start;
    const endS = i + 1 < scene.length ? beats[scene[i + 1].beat].start : durationS;
    return { piece: entry.piece, params: entry.params, startS, durationS: Number((endS - startS).toFixed(3)), beatsS };
  });
}

// Builds the standalone chapter page: one 1920x1080 root, the theme, GSAP (from the copy beside index.html), and every piece
// on one paused timeline.
function buildRootComposition({ id, durationS, pieces }: { id: unknown; durationS: unknown; pieces: PieceWindow[] }): string {
  // the id lands in an attribute and a script, so only an already-slugged id is accepted
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`composition id "${id}" must be a slug (a-z, 0-9, hyphens)`);
  if (typeof durationS !== 'number' || !Number.isFinite(durationS) || durationS <= 0) throw new Error('composition duration must be a number of seconds above 0');
  const theme = fs.readFileSync(path.join(KIT_DIR, 'theme.css'), 'utf8');
  const rendered = pieces.map((p, i) => renderPiece(p, { startS: p.startS, durationS: p.durationS, idPrefix: `p${i}`, beatsS: p.beatsS }));
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=1920, height=1080" />',
    `<title>${id}</title>`,
    `<script src="${GSAP_NAME}"></script>`,
    // the stage is a fixed 1920x1080 box the pieces are laid over
    '<style>',
    'html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: var(--yk-black); }',
    '#root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: var(--yk-black); }',
    theme,
    '</style>',
    '</head>',
    '<body>',
    `<div id="root" data-composition-id="${id}" data-start="0" data-width="1920" data-height="1080" data-duration="${durationS}">`,
    ...rendered.map((r) => r.html),
    // the narration sits beside index.html; Hyperframes plays it on its own track (an audio element needs an id or it is silent)
    `<audio id="narration" src="narration.wav" data-start="0" data-duration="${durationS}" data-track-index="10" data-volume="1"></audio>`,
    '</div>',
    '<script>',
    'const tl = gsap.timeline({ paused: true });',
    ...rendered.map((r) => r.timeline).filter(Boolean),
    `window.__timelines[${JSON.stringify(id)}] = tl;`,
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export {
  slugChapterId, scaffoldChapter, checkScene, checkSentences, checkNarrationText, buildRootComposition, pieceWindows, roundUpTenth, narrationSentences,
  GSAP_NAME, GSAP_FILE,
};
export type { ChapterSource, ChapterSentence, ChapterScene, ChapterSpec, ScaffoldInput, PieceWindow, TimedBeat };
