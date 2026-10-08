// A chapter folder: creating it from a spec, timing its scene pieces, and building its root composition.
import fs from 'node:fs';
import path from 'node:path';
import { splitSentences } from './sentences.mts';
import { renderPiece, GSAP_NAME, GSAP_FILE } from './pieces.mts';
import { buildStagePage } from './stage.mts';
import { loadTemplate, DEFAULT_TEMPLATE } from './template.mts';
import { checkAgainstTemplate } from './template-checks.mts';
import type { Template } from './template.mts';

// One source a chapter cites: where it lives, which lines, and the exact text quoted from them.
type ChapterSource = { id: string; file: string; lines: [number, number]; quote: string };
// One narrated sentence: a claim must cite sources, a framing sentence carries no claim. `speaker` names the template
// character who says it; it is absent for the narrator.
type ChapterSentence = { text: string; kind: 'claim' | 'framing'; source_ids: string[]; speaker?: string };
// One scene piece shown while a sentence is spoken: the piece name, its params and the sentence index it starts on.
// `word`, when given, starts the piece on that word of its sentence instead of the sentence's start.
type ChapterScene = { piece: string; params: unknown; beat: number; word?: string };
// The chapter.json that `oldguy scaffold` writes.
type ChapterSpec = { id: string; title: string; sources: ChapterSource[]; sentences: ChapterSentence[]; scene: ChapterScene[] };
// What `oldguy scaffold` is handed: a spec that has not been checked yet, and the video's template (its rules are checked
// too when given).
type ScaffoldInput = { root: string; id: unknown; title: unknown; sources: unknown; sentences: unknown; scene: unknown; template?: Template };
// A scene piece placed in time: which piece, its params, when it starts and how long it lasts, and when every sentence
// of the chapter starts (seconds; the flow piece shows its steps on later sentences).
type PieceWindow = { piece: string; params: unknown; startS: number; durationS: number; beatsS: number[] };
// The timed sentences a chapter's pieces are laid against.
type TimedBeat = { start: number };

const MAX_ID_LENGTH = 60;

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
function scaffoldChapter({ root, id, title, sources, sentences, scene: given, template }: ScaffoldInput): string {
  const slug = slugChapterId(id);
  if (typeof title !== 'string' || !title.trim()) throw new Error('"title" must be non-empty text');
  if (!Array.isArray(sources)) throw new Error('"sources" must be a list');
  const narration = checkSentences(sentences);
  const scene = inlineSceneFiles(given, root);
  // checkSentences just proved this is a non-empty list
  checkScene(scene, (sentences as unknown[]).length);
  if (template) {
    // checkSentences proved a list of objects with text; the template's own rules come last, all at once
    const broken = checkAgainstTemplate(sentences as ChapterSentence[], scene, template);
    if (broken.length) throw new Error(broken.map((f) => `${f.id}: ${f.reason}`).join('; '));
  }

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
// `anchor(beat, word)` moves a piece that names a word to that word's time (the stage's keyword timing); without it
// every piece starts on its sentence.
function pieceWindows(scene: ChapterScene[], beats: TimedBeat[], durationS: number, anchor?: (beat: number, word?: string) => number): PieceWindow[] {
  const beatsS = beats.map((b) => b.start);
  const starts = scene.map((entry) => (anchor && entry.word !== undefined ? anchor(entry.beat, entry.word) : beats[entry.beat].start));
  return scene.map((entry, i) => {
    const startS = starts[i];
    const endS = i + 1 < scene.length ? starts[i + 1] : durationS;
    return { piece: entry.piece, params: entry.params, startS, durationS: Number((endS - startS).toFixed(3)), beatsS };
  });
}

// Builds the standalone chapter page as oldguy always has: explainer at 16:9, one 1920x1080 root, the theme, GSAP (from
// the copy beside index.html), and every piece on one paused timeline. The stage driver does the work; this stays as the
// name older code and tests use.
function buildRootComposition({ id, durationS, pieces }: { id: unknown; durationS: unknown; pieces: PieceWindow[] }): string {
  // checked here as before, so a bad id or length gives the same message whoever calls
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`composition id "${id}" must be a slug (a-z, 0-9, hyphens)`);
  if (typeof durationS !== 'number' || !Number.isFinite(durationS) || durationS <= 0) throw new Error('composition duration must be a number of seconds above 0');
  return buildStagePage({ id, template: loadTemplate(DEFAULT_TEMPLATE), shape: '16:9', timing: { durationS, lines: [], words: [] }, pieces });
}

export {
  slugChapterId, scaffoldChapter, checkScene, checkSentences, checkNarrationText, buildRootComposition, pieceWindows, roundUpTenth, narrationSentences,
  GSAP_NAME, GSAP_FILE,
};
export type { ChapterSource, ChapterSentence, ChapterScene, ChapterSpec, ScaffoldInput, PieceWindow, TimedBeat };
