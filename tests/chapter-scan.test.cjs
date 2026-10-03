'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256 } = require('../lib/build-record.mts');
const S = require('../lib/chapter-scan.cjs');

const COMMIT = 'a'.repeat(40);

// Makes a temp folder, runs the test body with it, and removes it after.
function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-scan-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// Writes a chapter folder with every Phase 1 file; opts can skip the mp4 or render record.
function makeChapter(root, id, opts = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify({ id, title: `Title ${id}` }));
  fs.writeFileSync(path.join(dir, 'beats.json'), JSON.stringify({ durationS: 12.5, beats: [] }));
  const build = JSON.stringify({ version: opts.version ?? 2, verified_against_commit: COMMIT, sha256: {} });
  fs.writeFileSync(path.join(dir, 'build.json'), build);
  if (opts.mp4 !== false) fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'video');
  if (opts.render !== false) fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(build) }));
  return dir;
}
// Scans one chapter folder.
const scan = (dir) => S.scanChapter(dir);

test('a complete chapter is ready and carries its details', () => withTmp((root) => {
  const dir = makeChapter(root, 'intro');
  fs.writeFileSync(path.join(dir, 'poster.jpg'), 'jpg');
  const c = scan(dir);
  assert.equal(c.status, 'ready');
  assert.equal(c.id, 'intro');
  assert.equal(c.title, 'Title intro');
  assert.equal(c.durationS, 12.5);
  assert.equal(c.verifiedAgainstCommit, COMMIT);
  assert.equal(c.buildSha256, sha256(fs.readFileSync(path.join(dir, 'build.json'))));
  assert.equal(c.hasPoster, true);
  assert.deepEqual(c.issues, []);
}));

test('mp4 without render.json is stale', () => withTmp((root) => {
  assert.equal(scan(makeChapter(root, 'a', { render: false })).status, 'stale');
}));

test('render.json naming a different build is stale', () => withTmp((root) => {
  const dir = makeChapter(root, 'a');
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: 'f'.repeat(64) }));
  assert.equal(scan(dir).status, 'stale');
}));

test('editing build.json after render makes the chapter stale', () => withTmp((root) => {
  const dir = makeChapter(root, 'a');
  fs.appendFileSync(path.join(dir, 'build.json'), ' ');
  assert.equal(scan(dir).status, 'stale');
}));

test('unreadable render.json is stale with an issue, never a throw', () => withTmp((root) => {
  const dir = makeChapter(root, 'a');
  fs.writeFileSync(path.join(dir, 'render.json'), '{nope');
  const c = scan(dir);
  assert.equal(c.status, 'stale');
  assert.ok(c.issues.length >= 1);
}));

test('no mp4 is pending; a work folder makes it rendering', () => withTmp((root) => {
  const dir = makeChapter(root, 'a', { mp4: false, render: false });
  assert.equal(scan(dir).status, 'pending');
  fs.mkdirSync(path.join(dir, 'work-123'));
  assert.equal(scan(dir).status, 'rendering');
}));

test('a scaffolded chapter with only chapter.json is pending with issues, no throw', () => withTmp((root) => {
  const dir = path.join(root, 'a');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify({ id: 'a', title: 'A' }));
  const c = scan(dir);
  assert.equal(c.status, 'pending');
  assert.equal(c.durationS, null);
  assert.equal(c.buildSha256, null);
  assert.ok(c.issues.length >= 1);
}));

test('transient folders do not change the status', () => withTmp((root) => {
  const dir = makeChapter(root, 'a');
  fs.mkdirSync(path.join(dir, '.narrate-x'));
  fs.mkdirSync(path.join(dir, 'snapshots'));
  assert.equal(scan(dir).status, 'ready');
}));

test('chapter.mp4 symlinked outside the folder is never ready and adds an issue', () => withTmp((root) => {
  const dir = makeChapter(root, 'a', { mp4: false });
  const outside = path.join(root, 'outside.mp4');
  fs.writeFileSync(outside, 'video');
  fs.symlinkSync(outside, path.join(dir, 'chapter.mp4'));
  const c = scan(dir);
  assert.equal(c.status, 'pending');
  assert.ok(c.issues.some((i) => /outside/.test(i)));
  fs.mkdirSync(path.join(dir, 'work-1'));
  assert.equal(scan(dir).status, 'rendering');
}));

test('chapter.mp4 symlinked to a file inside the folder is still ready', () => withTmp((root) => {
  const dir = makeChapter(root, 'a', { mp4: false });
  fs.writeFileSync(path.join(dir, 'real.mp4'), 'video');
  fs.symlinkSync(path.join(dir, 'real.mp4'), path.join(dir, 'chapter.mp4'));
  assert.equal(scan(dir).status, 'ready');
}));

test('build.json version 1 is stale with the older-version issue', () => withTmp((root) => {
  const c = scan(makeChapter(root, 'a', { version: 1 }));
  assert.equal(c.status, 'stale');
  assert.ok(c.issues.includes('narrated with an older version'));
}));

test('durationS comes from beats.json; missing or bad gives null and an issue', () => withTmp((root) => {
  const dir = makeChapter(root, 'a');
  fs.rmSync(path.join(dir, 'beats.json'));
  let c = scan(dir);
  assert.equal(c.durationS, null);
  assert.ok(c.issues.length >= 1);
  fs.writeFileSync(path.join(dir, 'beats.json'), JSON.stringify({ durationS: -3 }));
  c = scan(dir);
  assert.equal(c.durationS, null);
  assert.ok(c.issues.length >= 1);
}));

test('readOrder: absent is null with no issue', () => withTmp((root) => {
  assert.deepEqual(S.readOrder(root), { ids: null, issues: [] });
}));

test('readOrder drops duplicates and non-slug entries', () => withTmp((root) => {
  fs.writeFileSync(path.join(root, 'order.json'), JSON.stringify({ chapters: ['b', 'a', 'b', 'Bad Id', 7] }));
  const r = S.readOrder(root);
  assert.deepEqual(r.ids, ['b', 'a']);
}));

test('readOrder: garbage JSON or wrong shape is null with an issue', () => withTmp((root) => {
  fs.writeFileSync(path.join(root, 'order.json'), '{garbage');
  let r = S.readOrder(root);
  assert.equal(r.ids, null);
  assert.equal(r.issues.length, 1);
  fs.writeFileSync(path.join(root, 'order.json'), JSON.stringify({ chapters: 'x' }));
  r = S.readOrder(root);
  assert.equal(r.ids, null);
  assert.equal(r.issues.length, 1);
}));

test('scanProject: order.json first, unknown ids ignored, rest alphabetical', () => withTmp((root) => {
  const ch = path.join(root, 'chapters');
  for (const id of ['alpha', 'beta', 'gamma', 'delta']) makeChapter(ch, id);
  fs.writeFileSync(path.join(root, 'order.json'), JSON.stringify({ chapters: ['gamma', 'ghost', 'gamma', 'beta'] }));
  const p = S.scanProject(root);
  assert.deepEqual(p.order, ['gamma', 'beta', 'alpha', 'delta']);
  assert.deepEqual(p.chapters.map((c) => c.id), p.order);
}));

test('scanProject: no order.json is alphabetical; no chapters folder is empty', () => withTmp((root) => {
  assert.deepEqual(S.scanProject(root), { order: [], chapters: [], issues: [] });
  makeChapter(path.join(root, 'chapters'), 'b');
  makeChapter(path.join(root, 'chapters'), 'a');
  assert.deepEqual(S.scanProject(root).order, ['a', 'b']);
}));

test('scanProject skips non-slug folders and plain files with an issue', () => withTmp((root) => {
  const ch = path.join(root, 'chapters');
  makeChapter(ch, 'good');
  makeChapter(ch, 'Not A Slug');
  fs.writeFileSync(path.join(ch, 'stray.txt'), 'x');
  const p = S.scanProject(root);
  assert.deepEqual(p.order, ['good']);
  assert.ok(p.issues.some((i) => i.includes('Not A Slug')));
}));

test('scanProject reports a garbage order.json and still lists folders', () => withTmp((root) => {
  makeChapter(path.join(root, 'chapters'), 'a');
  fs.writeFileSync(path.join(root, 'order.json'), 'nope');
  const p = S.scanProject(root);
  assert.deepEqual(p.order, ['a']);
  assert.equal(p.issues.length, 1);
}));

test('a broken chapter.mp4 link is never ready, adds an issue, and follows the no-video rule', () => withTmp((root) => {
  const dir = makeChapter(root, 'a', { mp4: false });
  fs.symlinkSync(path.join(root, 'nowhere.mp4'), path.join(dir, 'chapter.mp4'));
  let c = scan(dir);
  assert.equal(c.status, 'pending');
  assert.ok(c.issues.some((i) => /broken link/.test(i)));
  fs.mkdirSync(path.join(dir, 'work-1'));
  assert.equal(scan(dir).status, 'rendering');
}));

test('a chapter.mp4 that is a directory is never ready, adds an issue, and follows the no-video rule', () => withTmp((root) => {
  const dir = makeChapter(root, 'a', { mp4: false });
  fs.mkdirSync(path.join(dir, 'chapter.mp4'));
  let c = scan(dir);
  assert.equal(c.status, 'pending');
  assert.ok(c.issues.some((i) => /not a regular file/.test(i)));
  fs.mkdirSync(path.join(dir, 'work-1'));
  assert.equal(scan(dir).status, 'rendering');
}));

test('a symlinked chapter folder is skipped by scanProject with an issue that says it is a link', () => withTmp((root) => {
  const ch = path.join(root, 'chapters');
  makeChapter(ch, 'good');
  makeChapter(path.join(root, 'elsewhere'), 'other');
  fs.symlinkSync(path.join(root, 'elsewhere', 'other'), path.join(ch, 'linked'));
  const p = S.scanProject(root);
  assert.deepEqual(p.order, ['good']);
  assert.ok(p.issues.some((i) => i.includes('linked') && /is a link/.test(i)));
}));

test('scanChapter refuses a symlinked chapter folder: pending with a link issue, never ready', () => withTmp((root) => {
  const real = makeChapter(path.join(root, 'elsewhere'), 'other');
  const link = path.join(root, 'linked');
  fs.symlinkSync(real, link);
  const c = scan(link);
  assert.equal(c.status, 'pending');
  assert.ok(c.issues.some((i) => /is a link/.test(i)));
}));

test('an in-folder link target whose name starts with two dots is not mistaken for outside', () => withTmp((root) => {
  const dir = makeChapter(root, 'a', { mp4: false });
  fs.writeFileSync(path.join(dir, '..video.mp4'), 'video');
  fs.symlinkSync(path.join(dir, '..video.mp4'), path.join(dir, 'chapter.mp4'));
  assert.equal(scan(dir).status, 'ready');
}));

test('scanProject reports why chapters/ cannot be listed when it is a file', () => withTmp((root) => {
  fs.writeFileSync(path.join(root, 'chapters'), 'not a folder');
  const p = S.scanProject(root);
  assert.deepEqual(p.order, []);
  assert.deepEqual(p.chapters, []);
  assert.equal(p.issues.length, 1);
  assert.match(p.issues[0], /chapters/);
}));
