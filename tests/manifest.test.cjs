const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../lib/manifest.cjs');

// Freezes an object and everything inside it, so any accidental edit throws.
function deepFreeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}
// A manifest with three chapters: a, b (child of a), c.
function sample() {
  let m = M.newManifest({ title: 'T', slug: 't', audience: 'beginner' });
  m = M.insertChapter(m, { id: 'a', title: 'A', duration_s: 10 });
  m = M.insertChapter(m, { id: 'c', title: 'C', duration_s: 5 });
  m = M.insertChapter(m, { id: 'b', title: 'B', parent_id: 'a', duration_s: 2.5 }, { after: 'a' });
  return m;
}
const ids = (m) => m.chapters.map((c) => c.id);
// Makes a temp folder and removes it after the test body.
function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-manifest-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('newManifest has version 1 and no chapters', () => {
  const m = M.newManifest({ title: 'T', slug: 't', audience: 'beginner' });
  assert.equal(m.version, 1);
  assert.deepEqual(m.chapters, []);
  assert.equal(M.validateManifest(m).ok, true);
});

test('insertChapter appends by default and fills defaults', () => {
  const m = sample();
  assert.deepEqual(ids(m), ['a', 'b', 'c']);
  assert.equal(m.chapters[0].status, 'pending');
  assert.equal(m.chapters[0].quality, 'draft');
  assert.equal(m.chapters[0].video, null);
});

test('insertChapter after a parent puts it right behind it', () => {
  assert.deepEqual(ids(sample()), ['a', 'b', 'c']);
});

test('insertChapter after an unknown id throws a clear error', () => {
  assert.throws(() => M.insertChapter(sample(), { id: 'x', title: 'X' }, { after: 'nope' }), /no such chapter/);
});

test('insertChapter rejects duplicates, bad ids, unknown fields, dangling parents', () => {
  const m = sample();
  assert.throws(() => M.insertChapter(m, { id: 'a', title: 'again' }), /duplicate/);
  assert.throws(() => M.insertChapter(m, { id: 'Bad Id', title: 'x' }), /not a valid chapter id/);
  assert.throws(() => M.insertChapter(m, { id: '9lives', title: 'x' }), /not a valid chapter id/);
  assert.throws(() => M.insertChapter(m, { id: 'x/y', title: 'x' }), /not a valid chapter id/);
  assert.throws(() => M.insertChapter(m, { id: 'x', title: 'x', color: 'red' }), /unknown chapter field/);
  assert.throws(() => M.insertChapter(m, { id: 'x', title: 'x', parent_id: 'ghost' }), /names no chapter/);
});

test('reorderChapters accepts a permutation and rejects missing, extra or duplicate ids', () => {
  const m = sample();
  assert.deepEqual(ids(M.reorderChapters(m, ['c', 'a', 'b'])), ['c', 'a', 'b']);
  assert.throws(() => M.reorderChapters(m, ['a', 'b']), /exactly once/);
  assert.throws(() => M.reorderChapters(m, ['a', 'b', 'c', 'd']), /exactly once/);
  assert.throws(() => M.reorderChapters(m, ['a', 'a', 'b']), /exactly once/);
  assert.throws(() => M.reorderChapters(m, ['a', 'b', 'z']), /exactly once/);
});

test('setChapterFields updates fields and rejects unknown fields, bad values, id changes, unknown chapters', () => {
  const m = sample();
  const n = M.setChapterFields(m, 'a', { status: 'ready', quality: 'full', build_sha256: 'abc' });
  assert.equal(n.chapters[0].status, 'ready');
  assert.equal(n.chapters[0].build_sha256, 'abc');
  assert.throws(() => M.setChapterFields(m, 'a', { nope: 1 }), /unknown chapter field/);
  assert.throws(() => M.setChapterFields(m, 'a', { status: 'done' }), /status/);
  assert.throws(() => M.setChapterFields(m, 'a', { id: 'z' }), /cannot be changed/);
  assert.throws(() => M.setChapterFields(m, 'zz', { status: 'ready' }), /no chapter/);
  assert.throws(() => M.setChapterFields(m, 'a', { video: '../x.mp4' }), /relative path/);
});

test('timeline adds durations in order and flags missing durations', () => {
  const m = M.setChapterFields(sample(), 'b', { duration_s: null });
  assert.deepEqual(M.timeline(m), [
    { id: 'a', start: 0, end: 10 },
    { id: 'b', start: 10, end: 10, missing: true },
    { id: 'c', start: 10, end: 15 },
  ]);
});

test('validateManifest lists every problem', () => {
  const bad = {
    version: 2, title: 'T', slug: 't', audience: 'x',
    chapters: [
      { ...row('a'), status: 'bogus' },
      { ...row('a'), parent_id: 'ghost' },
      { ...row('c'), video: 'chapters/../../etc/passwd' },
      { ...row('d'), poster: '/abs/p.jpg', captions: 'a\\b.vtt' },
    ],
  };
  const { ok, errors } = M.validateManifest(bad);
  assert.equal(ok, false);
  const all = errors.join('\n');
  for (const needle of ['version', 'status "bogus"', 'duplicate', 'names no chapter', 'chapters[2].video', 'chapters[3].poster', 'chapters[3].captions']) {
    assert.match(all, new RegExp(needle.replace(/[[\]]/g, '\\$&')));
  }
});
// A complete valid row for validateManifest tests.
function row(id) {
  return { id, title: id, parent_id: null, placement_reason: null, status: 'ready', quality: 'full', duration_s: 1, video: null, poster: null, captions: null, question: null, build_sha256: null, verified_against_commit: null };
}

test('model functions never change their input', () => {
  const m = deepFreeze(sample());
  const before = JSON.parse(JSON.stringify(m));
  M.insertChapter(m, { id: 'z', title: 'Z' }, { after: 'a' });
  M.reorderChapters(m, ['c', 'b', 'a']);
  M.setChapterFields(m, 'a', { status: 'ready' });
  M.timeline(m);
  M.validateManifest(m);
  assert.deepEqual(m, before);
});

test('saveManifest writes valid JSON, leaves no temp file, and two saves stay valid', () => withTmp((dir) => {
  const file = path.join(dir, 'manifest.json');
  M.saveManifest(file, sample());
  M.saveManifest(file, M.setChapterFields(sample(), 'a', { status: 'ready' }));
  assert.deepEqual(fs.readdirSync(dir), ['manifest.json']);
  assert.equal(M.loadManifest(file).chapters[0].status, 'ready');
}));

test('a crash between write and rename leaves the old manifest intact and no temp file', () => withTmp((dir) => {
  const file = path.join(dir, 'manifest.json');
  M.saveManifest(file, sample());
  const old = fs.readFileSync(file, 'utf8');
  const crashing = { ...fs, renameSync() { throw new Error('simulated crash'); } };
  assert.throws(() => M.saveManifest(file, M.setChapterFields(sample(), 'a', { status: 'failed' }), { fs: crashing }), /simulated crash/);
  assert.equal(fs.readFileSync(file, 'utf8'), old);
  assert.deepEqual(fs.readdirSync(dir), ['manifest.json']);
}));

test('saveManifest refuses an invalid manifest and writes nothing', () => withTmp((dir) => {
  const file = path.join(dir, 'manifest.json');
  assert.throws(() => M.saveManifest(file, { version: 9, chapters: [] }), /invalid manifest/);
  assert.deepEqual(fs.readdirSync(dir), []);
}));

test('loadManifest gives a plain Error for a missing file, garbage, and an invalid manifest', () => withTmp((dir) => {
  const file = path.join(dir, 'manifest.json');
  assert.throws(() => M.loadManifest(file), (e) => e.constructor === Error && /file not found/.test(e.message));
  fs.writeFileSync(file, '{not json');
  assert.throws(() => M.loadManifest(file), (e) => e.constructor === Error && /not valid JSON/.test(e.message) && !e.message.includes('\n'));
  fs.writeFileSync(file, '{"version":2}');
  assert.throws(() => M.loadManifest(file), (e) => e.constructor === Error && /invalid/.test(e.message));
}));
