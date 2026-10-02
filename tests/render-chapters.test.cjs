'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderChapters, renderArgs } = require('../lib/render-chapters.cjs');
const { HYPERFRAMES_VERSION } = require('../lib/hyperframes.cjs');
const { buildRecord } = require('../lib/build-record.cjs');
const { scaffoldChapter } = require('../lib/chapter.cjs');
const { narrateChapter } = require('../lib/narrate.cjs');

const CHANGED = 'chapter changed after narrate: fix the spec, delete the chapter folder, then scaffold, audit and narrate again';

const GOOD_SOURCE = { id: 's1', file: 'app.js', lines: [1, 1], quote: 'start()' };
const CLAIM = { text: 'It calls start.', kind: 'claim', source_ids: ['s1'] };

// Makes a repo with app.js and an empty chapters folder, both removed after the test.
function workspace(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-render-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'app.js'), 'start()\n');
  const chapters = path.join(base, 'chapters');
  fs.mkdirSync(chapters);
  return { repo, chapters };
}

// Writes one chapter folder with matching narration.txt; `narrated` adds the files and build.json narrate would have written.
function addChapter(chapters, id, { sources = [GOOD_SOURCE], narrated = true, narration = `${CLAIM.text}\n` } = {}) {
  const dir = path.join(chapters, id);
  fs.mkdirSync(dir);
  const chapter = { id, title: id, sources, sentences: [CLAIM], scene: [] };
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify(chapter));
  fs.writeFileSync(path.join(dir, 'narration.txt'), narration);
  if (narrated) {
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(dir, 'narration.wav'), 'RIFF');
    const record = buildRecord(chapter, (name) => fs.readFileSync(path.join(dir, name)));
    fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(record));
  }
  return dir;
}

// A pretend renderer that records each chapter it was asked to render and can fail chosen ones.
function fakeRender(failOnce = []) {
  const calls = [];
  const render = async (chapter) => {
    calls.push(chapter.id);
    if (failOnce.includes(chapter.id) && calls.filter((c) => c === chapter.id).length === 1) throw new Error('chrome crashed');
  };
  return { render, calls };
}

test('renderArgs: pinned hyperframes via npx --yes, draft quality, 2 workers, chapter.mp4 inside the chapter', () => {
  assert.equal(HYPERFRAMES_VERSION, '0.8.112');
  assert.deepEqual(renderArgs('/w/chapters/intro'), ['--yes', 'hyperframes@0.8.112', 'render', '/w/chapters/intro', '-q', 'draft', '-w', '2', '-o', '/w/chapters/intro/chapter.mp4']);
});

test('chapters that pass the audit and are narrated are rendered and ready', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'intro');
  addChapter(chapters, 'retry');
  const seen = [];
  const results = await renderChapters(chapters, { root: repo, cap: 2, render: async (c) => seen.push(c) });
  assert.deepEqual(results, [{ id: 'intro', status: 'ready', attempts: 1 }, { id: 'retry', status: 'ready', attempts: 1 }]);
  assert.deepEqual(seen.find((c) => c.id === 'intro'), { id: 'intro', dir });
});

test('a chapter that fails the audit is never rendered and is failed with the audit lines', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'bad', { sources: [{ ...GOOD_SOURCE, quote: 'stop()' }] });
  addChapter(chapters, 'good');
  const { render, calls } = fakeRender();
  const results = await renderChapters(chapters, { root: repo, cap: 2, render });
  assert.deepEqual(calls, ['good']);
  assert.deepEqual(results[0], { id: 'bad', status: 'failed', reason: 'audit: s1: quote not on lines 1-1' });
  assert.equal(results[1].status, 'ready');
});

test('a chapter with no index.html is failed as not narrated and not rendered', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'draft', { narrated: false });
  const { render, calls } = fakeRender();
  const results = await renderChapters(chapters, { root: repo, cap: 1, render });
  assert.deepEqual(calls, []);
  assert.deepEqual(results, [{ id: 'draft', status: 'failed', reason: 'not narrated yet (no index.html); run yap narrate first' }]);
});

test('an unreadable chapter.json is failed with the reason, the others still render', async (t) => {
  const { repo, chapters } = workspace(t);
  fs.mkdirSync(path.join(chapters, 'broken'));
  fs.writeFileSync(path.join(chapters, 'broken', 'chapter.json'), '{ nope');
  addChapter(chapters, 'fine');
  const results = await renderChapters(chapters, { root: repo, cap: 1, render: async () => {} });
  assert.equal(results[0].id, 'broken');
  assert.equal(results[0].status, 'failed');
  assert.match(results[0].reason, /cannot read chapter.json/);
  assert.deepEqual(results[1], { id: 'fine', status: 'ready', attempts: 1 });
});

test('the render scheduler is used: one failed render is retried once and ends ready', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'a');
  addChapter(chapters, 'b');
  const { render, calls } = fakeRender(['a']);
  const results = await renderChapters(chapters, { root: repo, cap: 2, render });
  assert.deepEqual(results, [{ id: 'a', status: 'ready', attempts: 2 }, { id: 'b', status: 'ready', attempts: 1 }]);
  assert.deepEqual(calls.filter((c) => c === 'a').length, 2);
});

test('a render that keeps failing is failed with its error as the reason', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'a');
  const results = await renderChapters(chapters, { root: repo, cap: 1, render: async () => { throw new Error('out of memory'); } });
  assert.deepEqual(results, [{ id: 'a', status: 'failed', attempts: 2, reason: 'out of memory' }]);
});

test('the cap limits how many renders run at once', async (t) => {
  const { repo, chapters } = workspace(t);
  for (const id of ['a', 'b', 'c']) addChapter(chapters, id);
  let inFlight = 0;
  let most = 0;
  // each render yields once so overlapping renders would be seen
  const render = async () => {
    most = Math.max(most, ++inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight--;
  };
  await renderChapters(chapters, { root: repo, cap: 1, render });
  assert.equal(most, 1);
});

test('folders without chapter.json and loose files are ignored; results follow folder name order', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'zeta');
  addChapter(chapters, 'alpha');
  fs.mkdirSync(path.join(chapters, 'notes'));
  fs.writeFileSync(path.join(chapters, 'README.txt'), 'x');
  const results = await renderChapters(chapters, { root: repo, cap: 1, render: async () => {} });
  assert.deepEqual(results.map((r) => r.id), ['alpha', 'zeta']);
});

test('narration.txt edited after the audit: never rendered, failed with the redo-the-chapter message', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'edited', { narration: 'It calls stop.\n' });
  addChapter(chapters, 'extra', { narration: `${CLAIM.text} And then more.\n` });
  addChapter(chapters, 'spacing', { narration: '  It   calls\r\nstart.\r\n' });
  const { render, calls } = fakeRender();
  const results = await renderChapters(chapters, { root: repo, cap: 1, render });
  assert.deepEqual(calls, ['spacing']);
  for (const r of results.slice(0, 2)) {
    assert.equal(r.status, 'failed');
    assert.match(r.reason, /narration\.txt no longer matches chapter\.json: fix the spec, delete the chapter folder, then scaffold, audit and narrate again/);
  }
  assert.equal(results[2].status, 'ready');
});

test('the narration check runs before the claim audit', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'both', { sources: [{ ...GOOD_SOURCE, quote: 'stop()' }], narration: 'Something else.\n' });
  const results = await renderChapters(chapters, { root: repo, cap: 1, render: async () => {} });
  assert.match(results[0].reason, /^narration\.txt no longer matches/);
});

test('a chapter folder named like an option reaches the renderer as an absolute path', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, '--evil');
  const seen = [];
  // a relative chapters folder is the case where path.join would have produced a bare "--evil"
  const results = await renderChapters(path.relative(process.cwd(), chapters), { root: repo, cap: 1, render: async (c) => seen.push(c) });
  assert.equal(results[0].status, 'ready');
  assert.equal(seen[0].dir, path.join(chapters, '--evil'));
  assert.ok(path.isAbsolute(seen[0].dir));
  const args = renderArgs(seen[0].dir);
  assert.ok(args[3].startsWith('/') && args.at(-1).startsWith('/'), args.join(' '));
});

// Three framing sentences (no sources needed) matching the spike-3 narration, with one title piece.
const FRAMING = [
  'A job starts when you press a button.',
  'The planner checks the request, then saves a pending row in the database.',
  'A worker later picks that row up and runs it.',
].map((text) => ({ text, kind: 'framing', source_ids: [] }));

// Scaffolds and narrates a real chapter (tts faked with the spike WAV), so build.json comes from narrate itself.
async function narratedChapter(t) {
  const { repo, chapters } = workspace(t);
  const dir = scaffoldChapter({
    root: path.dirname(chapters), id: 'jobs', title: 'Jobs', sources: [], sentences: FRAMING,
    scene: [{ piece: 'title', params: { heading: 'Jobs' }, beat: 0 }],
  });
  const run = async (cmd, args) => {
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'narration.wav'), args[args.indexOf('-o') + 1]);
    return { code: 0, stdout: '{}', stderr: '' };
  };
  await narrateChapter(dir, { run, venvPython: '/py', whisperAvailable: false });
  return { repo, chapters, dir };
}

// Renders the chapters folder with a recording fake and returns the one result plus whether render was called.
async function renderOnce(repo, chapters) {
  const { render, calls } = fakeRender();
  const [result] = await renderChapters(chapters, { root: repo, cap: 1, render });
  return { result, called: calls.length > 0 };
}

// Reads and rewrites chapter.json through a change function.
function editChapter(dir, change) {
  const file = path.join(dir, 'chapter.json');
  const chapter = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(chapter);
  fs.writeFileSync(file, JSON.stringify(chapter, null, 2));
}

test('build.json: an untouched narrated chapter renders', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  assert.ok(fs.existsSync(path.join(dir, 'build.json')));
  const { result, called } = await renderOnce(repo, chapters);
  assert.deepEqual(result, { id: 'jobs', status: 'ready', attempts: 1 });
  assert.equal(called, true);
});

test('build.json: rewriting chapter.json with other key order and spacing is not a change', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  const chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'));
  const reorder = (o) => Object.fromEntries(Object.entries(o).reverse());
  const shuffled = { ...reorder(chapter), sentences: chapter.sentences.map(reorder), scene: chapter.scene.map(reorder) };
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify(shuffled));
  assert.equal((await renderOnce(repo, chapters)).result.status, 'ready');
});

test('build.json: the finding scenario, text fixed in chapter.json AND narration.txt after narrate, is refused', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  editChapter(dir, (c) => { c.sentences[0].text = 'A job begins when you press a button.'; });
  const file = path.join(dir, 'narration.txt');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('starts', 'begins'));
  const { result, called } = await renderOnce(repo, chapters);
  assert.deepEqual(result, { id: 'jobs', status: 'failed', reason: CHANGED });
  assert.equal(called, false);
});

test('build.json: an edited sentence kind or sources in chapter.json is refused', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  editChapter(dir, (c) => { c.sentences[2].source_ids = []; c.sentences[2].kind = 'framing'; c.sentences[1].source_ids = []; c.sentences[1].note = 'x'; });
  const { result, called } = await renderOnce(repo, chapters);
  assert.equal(result.reason, CHANGED);
  assert.equal(called, false);
});

test('build.json: an edited scene is refused', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  editChapter(dir, (c) => { c.scene[0].params.heading = 'Something else'; });
  const { result, called } = await renderOnce(repo, chapters);
  assert.equal(result.reason, CHANGED);
  assert.equal(called, false);
});

test('build.json: narration.txt bytes changed (whitespace the text check allows) is refused', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  fs.appendFileSync(path.join(dir, 'narration.txt'), '  \n');
  const { result, called } = await renderOnce(repo, chapters);
  assert.equal(result.reason, CHANGED);
  assert.equal(called, false);
});

test('build.json: a replaced narration.wav is refused', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  const wav = fs.readFileSync(path.join(dir, 'narration.wav'));
  wav[wav.length - 1] ^= 1;
  fs.writeFileSync(path.join(dir, 'narration.wav'), wav);
  const { result, called } = await renderOnce(repo, chapters);
  assert.equal(result.reason, CHANGED);
  assert.equal(called, false);
});

test('build.json: a hand-edited index.html is refused', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Jobs</h1>', 'Unchecked words</h1>'));
  const { result, called } = await renderOnce(repo, chapters);
  assert.equal(result.reason, CHANGED);
  assert.equal(called, false);
});

test('build.json: missing, garbage or the wrong shape is refused', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  const file = path.join(dir, 'build.json');
  const good = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bad = [
    null,
    '{ not json',
    JSON.stringify([]),
    JSON.stringify({ sha256: {} }),
    JSON.stringify({ sha256: { ...good.sha256, 'index.html': 'abc' } }),
    JSON.stringify({ sha256: { ...good.sha256, extra: good.sha256['index.html'] } }),
  ];
  for (const content of bad) {
    if (content === null) fs.rmSync(file);
    else fs.writeFileSync(file, content);
    const { result, called } = await renderOnce(repo, chapters);
    assert.equal(result.reason, CHANGED, String(content));
    assert.equal(called, false);
  }
});

test('the build check runs after the claim audit', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'both', { sources: [{ ...GOOD_SOURCE, quote: 'stop()' }] });
  fs.rmSync(path.join(dir, 'build.json'));
  const results = await renderChapters(chapters, { root: repo, cap: 1, render: async () => {} });
  assert.match(results[0].reason, /^audit: /);
});

test('stale video: an existing chapter.mp4 is removed before rendering, so a failed render leaves none', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'a');
  const mp4 = path.join(dir, 'chapter.mp4');
  fs.writeFileSync(mp4, 'old video');
  const seenOld = [];
  const render = async () => {
    seenOld.push(fs.existsSync(mp4));
    throw new Error('chrome crashed');
  };
  const [result] = await renderChapters(chapters, { root: repo, cap: 1, render });
  assert.equal(result.status, 'failed');
  assert.deepEqual(seenOld, [false, false]);
  assert.equal(fs.existsSync(mp4), false);
});

test('stale video: a chapter that fails its checks keeps its chapter.mp4 untouched', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'bad', { sources: [{ ...GOOD_SOURCE, quote: 'stop()' }] });
  fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'old video');
  const { render, calls } = fakeRender();
  const [result] = await renderChapters(chapters, { root: repo, cap: 1, render });
  assert.equal(result.status, 'failed');
  assert.deepEqual(calls, []);
  assert.equal(fs.readFileSync(path.join(dir, 'chapter.mp4'), 'utf8'), 'old video');
});

test('stale video: a dry run deletes nothing', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'a');
  fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'old video');
  const [result] = await renderChapters(chapters, { root: repo, cap: 1, render: async () => {}, dryRun: true });
  assert.equal(result.status, 'ready');
  assert.equal(fs.readFileSync(path.join(dir, 'chapter.mp4'), 'utf8'), 'old video');
});
