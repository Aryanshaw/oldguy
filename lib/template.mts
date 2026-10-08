// A video template: a folder templates/<id>/ that says how a verified explanation is told (voices, characters, stage,
// pace, script rules). This module reads and checks one; nothing else in oldguy reads template.json directly.
import fs from 'node:fs';
import path from 'node:path';
import { KOKORO_VOICES, DEFAULT_NARRATOR_VOICE } from './voices.mts';

const SHAPE_LIST = ['16:9', '9:16', '1:1'] as const;
const CAPTION_MODES = ['none', 'line', 'word'] as const;
const VISUAL_BEATS = ['sentence', 'line', 'keyword'] as const;
const SIDES = ['left', 'right', 'center'] as const;

// The frame a video is made in: wide, tall or square.
type Shape = (typeof SHAPE_LIST)[number];
// How the stage shows captions: not at all (today's look), one line at a time, or one word at a time.
type CaptionMode = (typeof CAPTION_MODES)[number];
// What a scene piece is timed to: its sentence, its line, or a keyword inside its line.
type VisualBeat = (typeof VISUAL_BEATS)[number];
// One on-screen character: its id (used as a sentence's `speaker`), its voice, where it stands, and its pictures.
type Speaker = { id: string; voice: string; side: (typeof SIDES)[number]; image?: string; talking?: string };
// How fast and in what rhythm a template tells things. A missing max_words_per_line means no cap.
type Pace = {
  voice_speed: number | Record<string, number>;
  line_gap_ms: number;
  max_words_per_line?: number;
  captions: CaptionMode;
  visual_beat: VisualBeat;
  chapter_seconds: [number, number];
};
// A file a template uses: in the folder, or downloaded on first use (url, sha256 and bytes then required).
type Asset = { path: string; url?: string; sha256?: string; bytes?: number };
// Where the creative slot sits in one shape's frame, in pixels: [x, y, width, height].
type SlotBox = [number, number, number, number];
// A loaded and checked template; `dir` is the folder it was read from. A shape with no slot box uses the whole frame.
type Template = {
  id: string;
  version: number;
  title: string;
  description: string;
  shapes: Shape[];
  default_shape: Shape;
  speakers: Speaker[];
  narrator_voice: string;
  pace: Pace;
  assets: Asset[];
  background?: string;
  background_seconds?: number;
  slots?: Partial<Record<Shape, SlotBox>>;
  dir: string;
};

// The pixel size of each shape.
const SHAPES: Record<Shape, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1440, height: 1440 },
};
// The template every video uses unless it names another.
const DEFAULT_TEMPLATE = 'explainer';
const DEFAULT_SHAPE: Shape = '16:9';
const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
// The files every template folder must hold besides template.json.
const REQUIRED_FILES = ['template.md', 'stage.html'];

// The folder the templates live in: templates/ at the plugin root, or OLDGUY_TEMPLATES_DIR when set (a contributor
// trying a template folder in progress, and the tests).
function templatesRoot(): string {
  const override = process.env.OLDGUY_TEMPLATES_DIR;
  return override && path.isAbsolute(override) ? override : path.join(import.meta.dirname, '..', 'templates');
}

// True when the value is a plain object (not null, not a list).
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// True when the value is one of the listed strings.
function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v);
}

// True when the value is a finite number within [lo, hi].
function numberIn(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

// True when a relative asset path stays inside the template folder.
function insideFolder(p: string): boolean {
  if (!p || path.isAbsolute(p) || p.includes('\\')) return false;
  return !path.posix.normalize(p).split('/').includes('..');
}

// Lists every problem with the speakers: unique slug ids, known voices, a side, and pictures that are listed assets.
function speakerErrors(speakers: unknown, assetPaths: Set<string>): string[] {
  if (!Array.isArray(speakers)) return ['speakers must be a list (empty for a narrator)'];
  const errs: string[] = [];
  const seen = new Set<unknown>();
  const list: unknown[] = speakers;
  list.forEach((s, i) => {
    const at = `speakers[${i}]`;
    if (!isObject(s)) { errs.push(`${at} must be an object`); return; }
    if (typeof s.id !== 'string' || !SLUG.test(s.id)) errs.push(`${at}.id must be a slug (a-z, 0-9, hyphens)`);
    else if (seen.has(s.id)) errs.push(`${at}.id "${s.id}" is a duplicate`);
    seen.add(s.id);
    if (!oneOf(KOKORO_VOICES, s.voice)) errs.push(`${at}.voice "${String(s.voice)}" is not a Kokoro voice (${KOKORO_VOICES.join(', ')})`);
    if (!oneOf(SIDES, s.side)) errs.push(`${at}.side must be one of ${SIDES.join(', ')}`);
    for (const pic of ['image', 'talking'] as const) {
      if (s[pic] === undefined) continue;
      if (typeof s[pic] !== 'string' || !assetPaths.has(s[pic])) errs.push(`${at}.${pic} must name a listed asset`);
    }
  });
  return errs;
}

// Lists every problem with the pace block (spec 3.1); speaker ids are needed to check per-speaker speeds.
function paceErrors(pace: unknown, speakerIds: string[]): string[] {
  if (!isObject(pace)) return ['pace must be an object'];
  const errs: string[] = [];
  const speed = pace.voice_speed;
  if (isObject(speed)) {
    for (const id of speakerIds) if (!numberIn(speed[id], 0.5, 2)) errs.push(`pace.voice_speed.${id} must be a number from 0.5 to 2`);
    for (const key of Object.keys(speed)) if (!speakerIds.includes(key)) errs.push(`pace.voice_speed.${key} names no speaker`);
  } else if (!numberIn(speed, 0.5, 2)) {
    errs.push('pace.voice_speed must be a number from 0.5 to 2, or one per speaker');
  }
  if (!numberIn(pace.line_gap_ms, 0, 2000)) errs.push('pace.line_gap_ms must be a number from 0 to 2000');
  if (pace.max_words_per_line !== undefined && !(Number.isInteger(pace.max_words_per_line) && numberIn(pace.max_words_per_line, 3, 200))) {
    errs.push('pace.max_words_per_line must be a whole number of 3 or more');
  }
  if (!oneOf(CAPTION_MODES, pace.captions)) errs.push(`pace.captions must be one of ${CAPTION_MODES.join(', ')}`);
  if (!oneOf(VISUAL_BEATS, pace.visual_beat)) errs.push(`pace.visual_beat must be one of ${VISUAL_BEATS.join(', ')}`);
  const secs = pace.chapter_seconds;
  if (!Array.isArray(secs) || secs.length !== 2 || !numberIn(secs[0], 1, 3600) || !numberIn(secs[1], 1, 3600) || secs[0] > secs[1]) {
    errs.push('pace.chapter_seconds must be [min, max] seconds with min ≤ max');
  }
  return errs;
}

// Lists every problem with the assets: paths inside the folder, present on disk, or downloadable with sha256 and bytes.
function assetErrors(assets: unknown, dir: string): string[] {
  if (!Array.isArray(assets)) return ['assets must be a list'];
  const errs: string[] = [];
  const list: unknown[] = assets;
  list.forEach((a, i) => {
    const at = `assets[${i}]`;
    if (!isObject(a) || typeof a.path !== 'string' || !insideFolder(a.path)) { errs.push(`${at}.path must be a relative path inside the template folder`); return; }
    if (a.url === undefined) {
      if (!fs.existsSync(path.join(dir, a.path))) errs.push(`${at}: ${a.path} is not in the template folder (give url, sha256 and bytes to download it)`);
      return;
    }
    if (typeof a.url !== 'string' || !/^https:\/\//.test(a.url)) errs.push(`${at}.url must be an https URL`);
    if (typeof a.sha256 !== 'string' || !SHA256.test(a.sha256)) errs.push(`${at}.sha256 must be 64 lower-case hex characters`);
    if (!(Number.isInteger(a.bytes) && typeof a.bytes === 'number' && a.bytes > 0)) errs.push(`${at}.bytes must be a whole number above 0`);
  });
  return errs;
}

// Lists every problem with the slot boxes: one per listed shape at most, each a box with a size inside that frame.
function slotErrors(slots: unknown, shapes: unknown): string[] {
  if (slots === undefined) return [];
  if (!isObject(slots)) return ['slots must be an object of shape: [x, y, width, height]'];
  const errs: string[] = [];
  for (const [key, box] of Object.entries(slots)) {
    if (!oneOf(SHAPE_LIST, key) || !Array.isArray(shapes) || !shapes.includes(key)) { errs.push(`slots.${key} is not one of the template's shapes`); continue; }
    const { width, height } = SHAPES[key];
    const ok = Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === 'number' && Number.isFinite(n))
      && box[0] >= 0 && box[1] >= 0 && box[2] > 0 && box[3] > 0 && box[0] + box[2] <= width && box[1] + box[3] <= height;
    if (!ok) errs.push(`slots.${key} must be [x, y, width, height] inside the ${width}x${height} frame`);
  }
  return errs;
}

// Checks a parsed template.json read from `dir`; returns every problem found ([] when it is valid).
function validateTemplate(raw: unknown, dir: string): string[] {
  if (!isObject(raw)) return ['template.json must hold an object'];
  const errs: string[] = [];
  const folder = path.basename(dir);
  if (typeof raw.id !== 'string' || !SLUG.test(raw.id)) errs.push('id must be a slug (a-z, 0-9, hyphens)');
  else if (raw.id !== folder) errs.push(`id "${raw.id}" must match its folder name "${folder}"`);
  if (!(Number.isInteger(raw.version) && typeof raw.version === 'number' && raw.version > 0)) errs.push('version must be a whole number above 0');
  for (const f of ['title', 'description'] as const) if (typeof raw[f] !== 'string' || !raw[f]) errs.push(`${f} must be non-empty text`);
  const shapes = raw.shapes;
  if (!Array.isArray(shapes) || shapes.length === 0 || !shapes.every((s) => oneOf(SHAPE_LIST, s)) || new Set(shapes).size !== shapes.length) {
    errs.push(`shapes must be a non-empty list of distinct shapes from ${SHAPE_LIST.join(', ')}`);
  } else if (!(shapes as unknown[]).includes(raw.default_shape)) {
    errs.push('default_shape must be one of the listed shapes');
  }
  if (raw.narrator_voice !== undefined && !oneOf(KOKORO_VOICES, raw.narrator_voice)) errs.push(`narrator_voice "${String(raw.narrator_voice)}" is not a Kokoro voice`);
  const listed: unknown[] = Array.isArray(raw.assets) ? raw.assets.filter(isObject).map((a) => a.path) : [];
  const assetPaths = new Set(listed.filter((p): p is string => typeof p === 'string'));
  errs.push(...assetErrors(raw.assets, dir));
  errs.push(...speakerErrors(raw.speakers, assetPaths));
  const ids = Array.isArray(raw.speakers) ? raw.speakers.filter(isObject).map((s) => s.id).filter((id): id is string => typeof id === 'string') : [];
  errs.push(...paceErrors(raw.pace, ids));
  errs.push(...slotErrors(raw.slots, raw.shapes));
  if (raw.background !== undefined && (typeof raw.background !== 'string' || !assetPaths.has(raw.background))) errs.push('background must name a listed asset');
  if (raw.background !== undefined && !numberIn(raw.background_seconds, 1, 36000)) errs.push('background_seconds must give the background loop\'s length in seconds');
  if (raw.background === undefined && raw.background_seconds !== undefined) errs.push('background_seconds needs a background');
  for (const name of REQUIRED_FILES) if (!fs.existsSync(path.join(dir, name))) errs.push(`${name} is missing from the template folder`);
  return errs;
}

// Lists the template ids found under root: folders holding a template.json, sorted, the default first.
function templateIds(root: string = templatesRoot()): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'template.json')));
  } catch {
    return [];
  }
  return names.sort((a, b) => (a === DEFAULT_TEMPLATE ? -1 : b === DEFAULT_TEMPLATE ? 1 : a.localeCompare(b)));
}

// Loads and checks one template; an unknown id names the ones that exist, a bad one lists every problem.
function loadTemplate(id: string, root: string = templatesRoot()): Template {
  const ids = templateIds(root);
  if (typeof id !== 'string' || !ids.includes(id)) throw new Error(`unknown template "${String(id)}"; use one of ${ids.join(', ')}`);
  const dir = path.join(root, id);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8'));
  } catch {
    throw new Error(`template ${id}: template.json is not valid JSON`);
  }
  const errs = validateTemplate(raw, dir);
  if (errs.length) throw new Error(`template ${id} is invalid: ${errs.join('; ')}`);
  // validateTemplate just proved every field of the shape
  const t = raw as Omit<Template, 'dir' | 'narrator_voice'> & { narrator_voice?: string };
  return { ...t, narrator_voice: t.narrator_voice ?? DEFAULT_NARRATOR_VOICE, dir };
}

// Loads every template under root, in templateIds order.
function listTemplates(root: string = templatesRoot()): Template[] {
  return templateIds(root).map((id) => loadTemplate(id, root));
}

// The voice and speed one sentence is spoken with: its speaker's, or the narrator's when it has none.
function voiceFor(t: Template, speaker: string | undefined): { voice: string; speed: number } {
  const speed = t.pace.voice_speed;
  if (speaker === undefined) return { voice: t.narrator_voice, speed: typeof speed === 'number' ? speed : 1 };
  const s = t.speakers.find((x) => x.id === speaker);
  if (!s) throw new Error(`template ${t.id} has no speaker "${speaker}"`);
  return { voice: s.voice, speed: typeof speed === 'number' ? speed : speed[speaker] };
}

// The slot box for a shape: the template's, or the whole frame.
function slotBox(t: Template, shape: Shape): SlotBox {
  const { width, height } = SHAPES[shape];
  return t.slots?.[shape] ?? [0, 0, width, height];
}

// True when the value is a shape name.
function isShape(v: unknown): v is Shape {
  return oneOf(SHAPE_LIST, v);
}

export {
  SHAPES, SHAPE_LIST, DEFAULT_TEMPLATE, DEFAULT_SHAPE, templatesRoot, templateIds, loadTemplate, listTemplates, validateTemplate,
  voiceFor, isShape, slotBox,
};
export type { Shape, Speaker, Pace, Asset, Template, CaptionMode, VisualBeat, SlotBox };
