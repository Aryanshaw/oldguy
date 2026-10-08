// The manifest model: the ordered list of a video's chapters. Pure data functions, plus load/save.
// Only the local server writes manifest.json to disk; everything here returns new objects and never edits its input.
import nodeFs from 'node:fs';
import path from 'node:path';
import { slugChapterId } from './chapter.mts';
import { isShape } from './template.mts';
import type { Shape } from './template.mts';

// The states a chapter can be in; the type is derived from this list so the two cannot drift apart.
const STATUSES = ['pending', 'rendering', 'ready', 'failed', 'stale'] as const;
const QUALITIES = ['draft', 'full'] as const;
const PATH_FIELDS = ['video', 'poster', 'captions'] as const;

// One of the five chapter states.
type ChapterStatus = (typeof STATUSES)[number];
// Whether a chapter's video is a quick draft or the full-quality render.
type Quality = (typeof QUALITIES)[number];
// One chapter's entry in the manifest, exactly as written to manifest.json.
type ManifestRow = {
  id: string;
  title: string;
  parent_id: string | null;
  placement_reason: string | null;
  status: ChapterStatus;
  quality: Quality;
  duration_s: number | null;
  video: string | null;
  poster: string | null;
  captions: string | null;
  question: string | null;
  build_sha256: string | null;
  verified_against_commit: string | null;
};
// The manifest.json file: the video's details and its chapters in story order. `template` and `shape` say how the
// video is told; a manifest from before templates has neither and means explainer at 16:9.
type Manifest = {
  version: 1;
  title: string;
  slug: string;
  audience: string;
  verified_against_commit: string | null;
  template?: string;
  shape?: Shape;
  chapters: ManifestRow[];
};
// A chapter to add: the id and title are required, every other field falls back to its default.
type NewRow = Pick<ManifestRow, 'id' | 'title'> & Partial<ManifestRow>;
// One chapter's place on the video's clock, in seconds; `missing` marks a chapter whose length is not known yet.
type TimelineEntry = { id: string; start: number; end: number; missing?: true };
// The file functions saveManifest uses, so a test can hand in broken ones.
type ManifestFs = Pick<typeof nodeFs, 'writeFileSync' | 'renameSync' | 'rmSync'>;

// Every field a chapter row may have, with the value it gets when the caller leaves it out.
const ROW_DEFAULTS: Omit<ManifestRow, 'id' | 'title'> & { id: undefined; title: undefined } = {
  id: undefined, title: undefined, parent_id: null, placement_reason: null, status: 'pending', quality: 'draft',
  duration_s: null, video: null, poster: null, captions: null, question: null, build_sha256: null, verified_against_commit: null,
};
const ROW_FIELDS = Object.keys(ROW_DEFAULTS);

// Turns any value into text on one line (whitespace runs become one space) so error messages stay single-line.
function show(v: unknown): string {
  return String(v).replace(/\s+/g, ' ');
}

// True when the list holds the value; the value may be anything, which is why this takes `unknown`.
function listHas(list: readonly unknown[], value: unknown): boolean {
  return list.includes(value);
}

// Makes an empty manifest for a new video; the template and shape are recorded only when given.
function newManifest({ title, slug, audience, template, shape }: { title: string; slug: string; audience: string; template?: string; shape?: Shape }): Manifest {
  const base = { version: 1 as const, title, slug, audience, verified_against_commit: null };
  return template === undefined ? { ...base, chapters: [] } : { ...base, template, shape: shape ?? '16:9', chapters: [] };
}

// True when the id is exactly what the Phase 1 slug rule would produce (the rule throws on junk, which means "not valid").
function isValidId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  try { return slugChapterId(id) === id; } catch { return false; }
}

// True for a safe relative path string: not absolute, no backslashes, no ".." segment.
function isSafeRelativePath(p: unknown): boolean {
  if (typeof p !== 'string' || p === '') return false;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('\\')) return false;
  return !p.split('/').includes('..');
}

// Lists every problem with one chapter row (position i, ids seen so far, all ids for parent lookups).
function rowErrors(row: unknown, i: number, allIds: unknown[]): string[] {
  const errs: string[] = [];
  const at = `chapters[${i}]`;
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return [`${at} is not an object`];
  // the row is a plain object here; each field is checked below before anything relies on it
  const r = row as Record<string, unknown>;
  for (const key of Object.keys(r)) if (!ROW_FIELDS.includes(key)) errs.push(`${at} has unknown field "${show(key)}"`);
  if (!isValidId(r.id)) errs.push(`${at}.id "${show(r.id)}" is not a valid chapter id`);
  if (typeof r.title !== 'string' || !r.title) errs.push(`${at}.title must be a non-empty string`);
  if (!listHas(STATUSES, r.status)) errs.push(`${at}.status "${show(r.status)}" must be one of ${STATUSES.join(', ')}`);
  if (!listHas(QUALITIES, r.quality)) errs.push(`${at}.quality "${show(r.quality)}" must be one of ${QUALITIES.join(', ')}`);
  if (r.parent_id !== null && !allIds.includes(r.parent_id)) errs.push(`${at}.parent_id "${show(r.parent_id)}" names no chapter`);
  if (r.duration_s !== null && !(typeof r.duration_s === 'number' && Number.isFinite(r.duration_s) && r.duration_s >= 0)) {
    errs.push(`${at}.duration_s must be null or a number of seconds, 0 or more`);
  }
  for (const f of PATH_FIELDS) {
    if (r[f] !== null && !isSafeRelativePath(r[f])) errs.push(`${at}.${f} must be null or a relative path with no ".." and no backslashes`);
  }
  return errs;
}

// Reports each chapter whose chain of parents leads back to itself (a chapter that is its own parent counts).
// Ids that are missing or point at nothing end the walk quietly; other checks report those.
function parentLoopErrors(chapters: unknown[]): string[] {
  const parentOf = new Map<unknown, unknown>();
  for (const c of chapters) {
    if (c && typeof c === 'object') {
      const row = c as { id?: unknown; parent_id?: unknown };
      if (!parentOf.has(row.id)) parentOf.set(row.id, row.parent_id);
    }
  }
  const errs: string[] = [];
  for (const [id] of parentOf) {
    const seen = new Set<unknown>([id]);
    for (let cur = parentOf.get(id); parentOf.has(cur); cur = parentOf.get(cur)) {
      if (cur === id) { errs.push(`chapter "${show(id)}" is its own ancestor (parent cycle)`); break; }
      if (seen.has(cur)) break;
      seen.add(cur);
    }
  }
  return errs;
}

// The id of something that should be a chapter row; a missing or non-object row has none.
function idOf(row: unknown): unknown {
  return row && typeof row === 'object' ? (row as { id?: unknown }).id : undefined;
}

// Checks a whole manifest and lists every problem found (not just the first).
function validateManifest(obj: unknown): { ok: boolean; errors: string[] } {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['manifest is not an object'] };
  // a plain object: every field is checked below before it is used
  const m = obj as Record<string, unknown>;
  const errors: string[] = [];
  if (m.version !== 1) errors.push(`version must be 1, got ${JSON.stringify(m.version)}`);
  for (const f of ['title', 'slug', 'audience']) {
    if (typeof m[f] !== 'string' || !m[f]) errors.push(`${f} must be a non-empty string`);
  }
  if (m.template !== undefined && !(typeof m.template === 'string' && /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(m.template))) {
    errors.push('template must be a template id (a slug)');
  }
  if (m.shape !== undefined && !isShape(m.shape)) errors.push('shape must be 16:9, 9:16 or 1:1');
  if ((m.template === undefined) !== (m.shape === undefined)) errors.push('template and shape are given together or not at all');
  if (!Array.isArray(m.chapters)) {
    errors.push('chapters must be an array');
    return { ok: false, errors };
  }
  const chapters: unknown[] = m.chapters;
  const allIds = chapters.map(idOf);
  chapters.forEach((row, i) => {
    errors.push(...rowErrors(row, i, allIds));
    // `row && row.id` in the original: a falsy row stands for itself
    const rowId = row ? (row as { id?: unknown }).id : row;
    if (allIds.indexOf(rowId) !== i) errors.push(`chapters[${i}].id "${show(rowId)}" is a duplicate`);
  });
  errors.push(...parentLoopErrors(chapters));
  return { ok: errors.length === 0, errors };
}

// Returns the manifest if it is valid, otherwise throws one plain Error listing the problems.
function assertValid(m: unknown): Manifest {
  const { ok, errors } = validateManifest(m);
  if (!ok) throw new Error(`invalid manifest: ${errors.join('; ')}`);
  // validateManifest just proved every field of the shape
  return m as Manifest;
}

// Adds a chapter right after the chapter named by `after`, or at the end when `after` is left out.
function insertChapter(m: Manifest, row: NewRow, { after }: { after?: string } = {}): Manifest {
  for (const key of Object.keys(row)) if (!ROW_FIELDS.includes(key)) throw new Error(`unknown chapter field "${show(key)}"`);
  const full = { ...ROW_DEFAULTS, ...row };
  let at = m.chapters.length;
  if (after !== undefined) {
    const idx = m.chapters.findIndex((c) => c.id === after);
    if (idx === -1) throw new Error(`cannot insert after "${show(after)}": no such chapter`);
    at = idx + 1;
  }
  const chapters = [...m.chapters.slice(0, at), full, ...m.chapters.slice(at)];
  return assertValid({ ...m, chapters });
}

// Puts the chapters in the order given; the list must name every existing chapter exactly once.
function reorderChapters(m: Manifest, ids: string[]): Manifest {
  const have = m.chapters.map((c) => c.id);
  const sameSet = ids.length === have.length && new Set(ids).size === ids.length && ids.every((id) => have.includes(id));
  if (!sameSet) throw new Error(`reorder must list each existing chapter exactly once (have: ${show(have.join(', '))})`);
  // the check above proved every id names an existing chapter, so each lookup finds one
  return { ...m, chapters: ids.map((id) => m.chapters.find((c) => c.id === id) as ManifestRow) };
}

// Takes one chapter out of the story; a chapter that another names as its parent stays.
function removeChapter(m: Manifest, id: string): Manifest {
  if (!m.chapters.some((c) => c.id === id)) throw new Error(`no chapter "${show(id)}"`);
  const child = m.chapters.find((c) => c.parent_id === id);
  if (child) throw new Error(`chapter "${show(id)}" is the parent of "${show(child.id)}"; remove that one first`);
  return assertValid({ ...m, chapters: m.chapters.filter((c) => c.id !== id) });
}

// Changes some fields of one chapter; unknown fields, the id, and invalid values are refused.
function setChapterFields(m: Manifest, id: string, patch: Partial<ManifestRow>): Manifest {
  const idx = m.chapters.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`no chapter "${show(id)}"`);
  for (const key of Object.keys(patch)) {
    if (!ROW_FIELDS.includes(key)) throw new Error(`unknown chapter field "${show(key)}"`);
    if (key === 'id') throw new Error('a chapter id cannot be changed');
  }
  const chapters = m.chapters.map((c, i) => (i === idx ? { ...c, ...patch } : c));
  return assertValid({ ...m, chapters });
}

// Works out each chapter's start and end second from order and duration; a missing duration counts as 0 and is flagged.
function timeline(m: Manifest): TimelineEntry[] {
  let t = 0;
  return m.chapters.map((c) => {
    const length = c.duration_s;
    const start = t;
    t += length === null ? 0 : length;
    return length === null ? { id: c.id, start, end: t, missing: true } : { id: c.id, start, end: t };
  });
}

// Writes the manifest atomically: temp file in the same folder, then rename. Refuses an invalid manifest.
// On any failure the temp file is removed and the old manifest is left untouched. `fs` can be injected for tests.
function saveManifest(file: string, m: unknown, { fs = nodeFs }: { fs?: ManifestFs } = {}): void {
  assertValid(m);
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing more to clean */ }
    throw err;
  }
}

// Reads and checks a manifest file. Always throws a plain Error with a one-line message (never a raw SyntaxError):
// missing file, invalid JSON, or the validation problems joined.
function loadManifest(file: string): Manifest {
  let text: string;
  try { text = nodeFs.readFileSync(file, 'utf8'); } catch (err) {
    // a failed read always throws a system error with a code and a message
    const e = err as NodeJS.ErrnoException;
    throw new Error(`cannot read manifest ${show(file)}: ${e.code === 'ENOENT' ? 'file not found' : show(e.message)}`);
  }
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { throw new Error(`manifest ${show(file)} is not valid JSON`); }
  const { ok, errors } = validateManifest(obj);
  if (!ok) throw new Error(`manifest ${show(file)} is invalid: ${errors.join('; ')}`);
  // validateManifest just proved the shape
  return obj as Manifest;
}

export { STATUSES, newManifest, validateManifest, insertChapter, reorderChapters, removeChapter, setChapterFields, timeline, saveManifest, loadManifest };
export type { ChapterStatus, Quality, ManifestRow, Manifest, NewRow, TimelineEntry, ManifestFs };
