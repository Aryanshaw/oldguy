'use strict';
// The manifest model: the ordered list of a video's chapters. Pure data functions, plus load/save.
// Only the local server writes manifest.json to disk; everything here returns new objects and never edits its input.
const nodeFs = require('node:fs');
const path = require('node:path');
const { slugChapterId } = require('./chapter.cjs');

const STATUSES = ['pending', 'rendering', 'ready', 'failed', 'stale'];
const QUALITIES = ['draft', 'full'];
const PATH_FIELDS = ['video', 'poster', 'captions'];
// Every field a chapter row may have, with the value it gets when the caller leaves it out.
const ROW_DEFAULTS = {
  id: undefined, title: undefined, parent_id: null, placement_reason: null, status: 'pending', quality: 'draft',
  duration_s: null, video: null, poster: null, captions: null, question: null, build_sha256: null, verified_against_commit: null,
};
const ROW_FIELDS = Object.keys(ROW_DEFAULTS);

// Makes an empty manifest for a new video.
function newManifest({ title, slug, audience }) {
  return { version: 1, title, slug, audience, verified_against_commit: null, chapters: [] };
}

// True when the id is exactly what the Phase 1 slug rule would produce (the rule throws on junk, which means "not valid").
function isValidId(id) {
  if (typeof id !== 'string') return false;
  try { return slugChapterId(id) === id; } catch { return false; }
}

// True for a safe relative path string: not absolute, no backslashes, no ".." segment.
function isSafeRelativePath(p) {
  if (typeof p !== 'string' || p === '') return false;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('\\')) return false;
  return !p.split('/').includes('..');
}

// Lists every problem with one chapter row (position i, ids seen so far, all ids for parent lookups).
function rowErrors(row, i, allIds) {
  const errs = [];
  const at = `chapters[${i}]`;
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return [`${at} is not an object`];
  for (const key of Object.keys(row)) if (!ROW_FIELDS.includes(key)) errs.push(`${at} has unknown field "${key}"`);
  if (!isValidId(row.id)) errs.push(`${at}.id "${row.id}" is not a valid chapter id`);
  if (typeof row.title !== 'string' || !row.title) errs.push(`${at}.title must be a non-empty string`);
  if (!STATUSES.includes(row.status)) errs.push(`${at}.status "${row.status}" must be one of ${STATUSES.join(', ')}`);
  if (!QUALITIES.includes(row.quality)) errs.push(`${at}.quality "${row.quality}" must be one of ${QUALITIES.join(', ')}`);
  if (row.parent_id !== null && !allIds.includes(row.parent_id)) errs.push(`${at}.parent_id "${row.parent_id}" names no chapter`);
  if (row.duration_s !== null && !(typeof row.duration_s === 'number' && Number.isFinite(row.duration_s) && row.duration_s >= 0)) {
    errs.push(`${at}.duration_s must be null or a number of seconds, 0 or more`);
  }
  for (const f of PATH_FIELDS) {
    if (row[f] !== null && !isSafeRelativePath(row[f])) errs.push(`${at}.${f} must be null or a relative path with no ".." and no backslashes`);
  }
  return errs;
}

// Checks a whole manifest and lists every problem found (not just the first).
function validateManifest(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['manifest is not an object'] };
  const errors = [];
  if (obj.version !== 1) errors.push(`version must be 1, got ${JSON.stringify(obj.version)}`);
  for (const f of ['title', 'slug', 'audience']) {
    if (typeof obj[f] !== 'string' || !obj[f]) errors.push(`${f} must be a non-empty string`);
  }
  if (!Array.isArray(obj.chapters)) {
    errors.push('chapters must be an array');
    return { ok: false, errors };
  }
  const allIds = obj.chapters.map((r) => (r && typeof r === 'object' ? r.id : undefined));
  obj.chapters.forEach((row, i) => {
    errors.push(...rowErrors(row, i, allIds));
    if (allIds.indexOf(row && row.id) !== i) errors.push(`chapters[${i}].id "${row && row.id}" is a duplicate`);
  });
  return { ok: errors.length === 0, errors };
}

// Returns the manifest if it is valid, otherwise throws one plain Error listing the problems.
function assertValid(m) {
  const { ok, errors } = validateManifest(m);
  if (!ok) throw new Error(`invalid manifest: ${errors.join('; ')}`);
  return m;
}

// Adds a chapter right after the chapter named by `after`, or at the end when `after` is left out.
function insertChapter(m, row, { after } = {}) {
  for (const key of Object.keys(row)) if (!ROW_FIELDS.includes(key)) throw new Error(`unknown chapter field "${key}"`);
  const full = { ...ROW_DEFAULTS, ...row };
  let at = m.chapters.length;
  if (after !== undefined) {
    const idx = m.chapters.findIndex((c) => c.id === after);
    if (idx === -1) throw new Error(`cannot insert after "${after}": no such chapter`);
    at = idx + 1;
  }
  const chapters = [...m.chapters.slice(0, at), full, ...m.chapters.slice(at)];
  return assertValid({ ...m, chapters });
}

// Puts the chapters in the order given; the list must name every existing chapter exactly once.
function reorderChapters(m, ids) {
  const have = m.chapters.map((c) => c.id);
  const sameSet = ids.length === have.length && new Set(ids).size === ids.length && ids.every((id) => have.includes(id));
  if (!sameSet) throw new Error(`reorder must list each existing chapter exactly once (have: ${have.join(', ')})`);
  return { ...m, chapters: ids.map((id) => m.chapters.find((c) => c.id === id)) };
}

// Changes some fields of one chapter; unknown fields, the id, and invalid values are refused.
function setChapterFields(m, id, patch) {
  const idx = m.chapters.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`no chapter "${id}"`);
  for (const key of Object.keys(patch)) {
    if (!ROW_FIELDS.includes(key)) throw new Error(`unknown chapter field "${key}"`);
    if (key === 'id') throw new Error('a chapter id cannot be changed');
  }
  const chapters = m.chapters.map((c, i) => (i === idx ? { ...c, ...patch } : c));
  return assertValid({ ...m, chapters });
}

// Works out each chapter's start and end second from order and duration; a missing duration counts as 0 and is flagged.
function timeline(m) {
  let t = 0;
  return m.chapters.map((c) => {
    const missing = c.duration_s === null;
    const start = t;
    t += missing ? 0 : c.duration_s;
    return missing ? { id: c.id, start, end: t, missing: true } : { id: c.id, start, end: t };
  });
}

// Writes the manifest atomically: temp file in the same folder, then rename. Refuses an invalid manifest.
// On any failure the temp file is removed and the old manifest is left untouched. `fs` can be injected for tests.
function saveManifest(file, m, { fs = nodeFs } = {}) {
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
function loadManifest(file) {
  let text;
  try { text = nodeFs.readFileSync(file, 'utf8'); } catch (err) {
    throw new Error(`cannot read manifest ${file}: ${err.code === 'ENOENT' ? 'file not found' : err.message}`);
  }
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error(`manifest ${file} is not valid JSON`); }
  const { ok, errors } = validateManifest(obj);
  if (!ok) throw new Error(`manifest ${file} is invalid: ${errors.join('; ')}`);
  return obj;
}

module.exports = { newManifest, validateManifest, insertChapter, reorderChapters, setChapterFields, timeline, saveManifest, loadManifest };
