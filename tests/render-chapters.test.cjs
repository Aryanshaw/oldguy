'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderChapters, renderArgs, checkArgs } = require('../lib/render-chapters.mts');
const { HYPERFRAMES_VERSION } = require('../lib/hyperframes.mts');
const { buildRecord } = require('../lib/build-record.mts');
const { scaffoldChapter } = require('../lib/chapter.mts');
const { narrateChapter } = require('../lib/narrate.mts');
const { loadTemplate } = require('../lib/template.mts');
// The one-call narrator path these tests drive: the shipped explainer without silence between sentences.
const ONE_CALL = (() => { const t = loadTemplate('explainer'); return { ...t, pace: { ...t.pace, line_gap_ms: 0, voice_speed: 1 } }; })();

const CHANGED = 'chapter changed after narrate: fix the spec, delete the chapter folder, then scaffold, audit and narrate again';

const GOOD_SOURCE = { id: 's1', file: 'app.js', lines: [1, 1], quote: 'start()' };
const CLAIM = { text: 'It calls start.', kind: 'claim', source_ids: ['s1'] };

// Makes a repo with app.js and an empty chapters folder, both removed after the test.
function workspace(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-render-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'app.js'), 'start()\n');
  const chapters = path.join(base, 'chapters');
  fs.mkdirSync(chapters);
  return { repo, chapters };
}

// Writes one chapter folder with matching narration.txt; `narrated` adds the files and build.json narrate would have written.
function addChapter(chapters, id, { sources = [GOOD_SOURCE], narrated = true, narration = `${CLAIM.text}\n`, scene = [] } = {}) {
  const dir = path.join(chapters, id);
  fs.mkdirSync(dir);
  const chapter = { id, title: id, sources, sentences: [CLAIM], scene };
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify(chapter));
  fs.writeFileSync(path.join(dir, 'narration.txt'), narration);
  if (narrated) {
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(dir, 'narration.wav'), 'RIFF');
    for (const name of ['beats.json', 'captions.vtt', 'captions.json', 'gsap.min.js']) fs.writeFileSync(path.join(dir, name), `${name} from narrate`);
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

// A layout check that always passes, for tests about the other gates.
const passCheck = async () => ({ code: 0, stdout: '', stderr: '' });

// A pretend layout check that records the folders it was asked about and answers with the given result.
function fakeCheck(answer = { code: 0, stdout: '', stderr: '' }) {
  const dirs = [];
  return { dirs, check: async (dir) => { dirs.push(dir); return answer; } };
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
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 2, render: async (c) => seen.push(c) });
  assert.deepEqual(results, [{ id: 'intro', status: 'ready', attempts: 1 }, { id: 'retry', status: 'ready', attempts: 1 }]);
  assert.deepEqual(seen.find((c) => c.id === 'intro'), { id: 'intro', dir });
});

test('a chapter that fails the audit is never rendered and is failed with the audit lines', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'bad', { sources: [{ ...GOOD_SOURCE, quote: 'stop()' }] });
  addChapter(chapters, 'good');
  const { render, calls } = fakeRender();
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 2, render });
  assert.deepEqual(calls, ['good']);
  assert.deepEqual(results[0], { id: 'bad', status: 'failed', reason: 'audit: s1: quote not on lines 1-1' });
  assert.equal(results[1].status, 'ready');
});

test('a chapter with no index.html is failed as not narrated and not rendered', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'draft', { narrated: false });
  const { render, calls } = fakeRender();
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render });
  assert.deepEqual(calls, []);
  assert.deepEqual(results, [{ id: 'draft', status: 'failed', reason: 'not narrated yet (no index.html); run oldguy narrate first' }]);
});

test('an unreadable chapter.json is failed with the reason, the others still render', async (t) => {
  const { repo, chapters } = workspace(t);
  fs.mkdirSync(path.join(chapters, 'broken'));
  fs.writeFileSync(path.join(chapters, 'broken', 'chapter.json'), '{ nope');
  addChapter(chapters, 'fine');
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: async () => {} });
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
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 2, render });
  assert.deepEqual(results, [{ id: 'a', status: 'ready', attempts: 2 }, { id: 'b', status: 'ready', attempts: 1 }]);
  assert.deepEqual(calls.filter((c) => c === 'a').length, 2);
});

test('a render that keeps failing is failed with its error as the reason', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'a');
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: async () => { throw new Error('out of memory'); } });
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
  await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render });
  assert.equal(most, 1);
});

test('folders without chapter.json and loose files are ignored; results follow folder name order', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'zeta');
  addChapter(chapters, 'alpha');
  fs.mkdirSync(path.join(chapters, 'notes'));
  fs.writeFileSync(path.join(chapters, 'README.txt'), 'x');
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: async () => {} });
  assert.deepEqual(results.map((r) => r.id), ['alpha', 'zeta']);
});

test('narration.txt edited after the audit: never rendered, failed with the redo-the-chapter message', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'edited', { narration: 'It calls stop.\n' });
  addChapter(chapters, 'extra', { narration: `${CLAIM.text} And then more.\n` });
  addChapter(chapters, 'spacing', { narration: '  It   calls\r\nstart.\r\n' });
  const { render, calls } = fakeRender();
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render });
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
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: async () => {} });
  assert.match(results[0].reason, /^narration\.txt no longer matches/);
});

test('a chapter folder named like an option reaches the renderer as an absolute path', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, '--evil');
  const seen = [];
  // a relative chapters folder is the case where path.join would have produced a bare "--evil"
  const results = await renderChapters(path.relative(process.cwd(), chapters), { root: repo, check: passCheck, cap: 1, render: async (c) => seen.push(c) });
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
  await narrateChapter(dir, { run, venvPython: '/py', template: ONE_CALL, whisperAvailable: false });
  return { repo, chapters, dir };
}

// Renders the chapters folder with a recording fake and returns the one result plus whether render was called.
async function renderOnce(repo, chapters) {
  const { render, calls } = fakeRender();
  const [result] = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render });
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
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: async () => {} });
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
  const [result] = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render });
  assert.equal(result.status, 'failed');
  assert.deepEqual(seenOld, [false, false]);
  assert.equal(fs.existsSync(mp4), false);
});

test('stale video: a chapter that fails its checks keeps its chapter.mp4 untouched', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'bad', { sources: [{ ...GOOD_SOURCE, quote: 'stop()' }] });
  fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'old video');
  const { render, calls } = fakeRender();
  const [result] = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render });
  assert.equal(result.status, 'failed');
  assert.deepEqual(calls, []);
  assert.equal(fs.readFileSync(path.join(dir, 'chapter.mp4'), 'utf8'), 'old video');
});

test('stale video: a dry run deletes nothing', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'a');
  fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'old video');
  const [result] = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: async () => {}, dryRun: true });
  assert.equal(result.status, 'ready');
  assert.equal(fs.readFileSync(path.join(dir, 'chapter.mp4'), 'utf8'), 'old video');
});

test('checkArgs: the pinned hyperframes check on the chapter folder, as an argv array', () => {
  assert.deepEqual(checkArgs('/w/chapters/intro'), ['--yes', 'hyperframes@0.8.112', 'check', '/w/chapters/intro']);
});

test('layout check: a failing check blocks the render, keeps the old video, and gives its first output line', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'a');
  fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'old video');
  const { check, dirs } = fakeCheck({ code: 1, stdout: '\n  clipped_text: .og-code overflows\nmore detail\n', stderr: 'later' });
  const { render, calls } = fakeRender();
  const [result] = await renderChapters(chapters, { root: repo, cap: 1, render, check });
  assert.deepEqual(result, { id: 'a', status: 'failed', reason: 'layout check failed: clipped_text: .og-code overflows' });
  assert.deepEqual(calls, []);
  assert.deepEqual(dirs, [dir]);
  assert.equal(fs.readFileSync(path.join(dir, 'chapter.mp4'), 'utf8'), 'old video');
});

test('layout check: with no output the reason names the exit code', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'a');
  const { check } = fakeCheck({ code: 2, stdout: '', stderr: '' });
  const [result] = await renderChapters(chapters, { root: repo, cap: 1, render: async () => {}, check });
  assert.equal(result.reason, 'layout check failed: exit code 2');
});

test('layout check: a passing check lets the render run, on the chapter\'s absolute folder', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'a');
  const { check, dirs } = fakeCheck();
  const { render, calls } = fakeRender();
  const [result] = await renderChapters(chapters, { root: repo, cap: 1, render, check });
  assert.deepEqual(result, { id: 'a', status: 'ready', attempts: 1 });
  assert.deepEqual(calls, ['a']);
  assert.deepEqual(dirs, [dir]);
});

test('layout check runs last: narration text, claim audit and build record all stop a chapter before it', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'edited', { narration: 'It calls stop.\n' });
  addChapter(chapters, 'unaudited', { sources: [{ ...GOOD_SOURCE, quote: 'stop()' }] });
  const changed = addChapter(chapters, 'changed');
  fs.writeFileSync(path.join(changed, 'index.html'), '<!doctype html><p>edited by hand</p>');
  const { check, dirs } = fakeCheck({ code: 1, stdout: 'should never be read', stderr: '' });
  const results = await renderChapters(chapters, { root: repo, cap: 1, render: async () => {}, check });
  assert.deepEqual(dirs, []);
  assert.equal(results.find((r) => r.id === 'changed').reason, CHANGED);
  assert.match(results.find((r) => r.id === 'edited').reason, /^narration\.txt no longer matches/);
  assert.match(results.find((r) => r.id === 'unaudited').reason, /^audit: /);
});

// A pretend renderer that writes a chapter.mp4 like the real one, and records each chapter it rendered.
function videoRender() {
  const calls = [];
  return { calls, render: async ({ id, dir }) => { calls.push(id); fs.writeFileSync(path.join(dir, 'chapter.mp4'), `video of ${id}`); } };
}

// The sha256 of a chapter's build.json bytes, as render.json records it.
function buildSha(dir) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(dir, 'build.json'))).digest('hex');
}

// Rewrites the narrated files and build.json as a fresh narrate would, so the build gate still passes but build.json differs.
function renarrate(dir) {
  fs.writeFileSync(path.join(dir, 'narration.wav'), 'RIFF new take');
  const chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(buildRecord(chapter, (name) => fs.readFileSync(path.join(dir, name)))));
}

test('--only renders exactly the named chapters, in the order given', async (t) => {
  const { repo, chapters } = workspace(t);
  for (const id of ['alpha', 'beta', 'gamma']) addChapter(chapters, id);
  const { render, calls } = videoRender();
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render, only: ['gamma', 'alpha'] });
  assert.deepEqual(results.map((r) => [r.id, r.status]), [['gamma', 'ready'], ['alpha', 'ready']]);
  assert.deepEqual(calls, ['gamma', 'alpha']);
  assert.equal(fs.existsSync(path.join(chapters, 'beta', 'chapter.mp4')), false);
});

test('--only with an unknown id reports it as no such chapter and still renders the others', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'alpha');
  const { render, calls } = videoRender();
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render, only: ['nope', 'alpha'] });
  assert.deepEqual(results, [{ id: 'nope', status: 'failed', reason: 'no such chapter' }, { id: 'alpha', status: 'ready', attempts: 1 }]);
  assert.deepEqual(calls, ['alpha']);
});

test('render.json: written after a successful render with the sha256 of build.json', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'a');
  const seenRecord = [];
  const render = async ({ dir: d }) => { seenRecord.push(fs.existsSync(path.join(d, 'render.json'))); fs.writeFileSync(path.join(d, 'chapter.mp4'), 'v'); };
  await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render });
  assert.deepEqual(seenRecord, [false]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'render.json'), 'utf8')), { build_sha256: buildSha(dir) });
});

test('render.json: a render that fails leaves no record, and an old record is removed before the attempt', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'a');
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: 'stale' }));
  const [result] = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: async () => { throw new Error('chrome crashed'); } });
  assert.equal(result.status, 'failed');
  assert.equal(fs.existsSync(path.join(dir, 'render.json')), false);
});

test('a chapter already rendered from the same build.json is skipped: no check, no render, video kept', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'a');
  await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: videoRender().render });
  const { check, dirs } = fakeCheck();
  const { render, calls } = videoRender();
  const [result] = await renderChapters(chapters, { root: repo, check, cap: 1, render });
  assert.deepEqual(result, { id: 'a', status: 'ready', skipped: true });
  assert.deepEqual([calls, dirs], [[], []]);
  assert.equal(fs.readFileSync(path.join(dir, 'chapter.mp4'), 'utf8'), 'video of a');
});

test('a skipped chapter still has to pass the audit: a repo change blocks it', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'a');
  await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: videoRender().render });
  fs.writeFileSync(path.join(repo, 'app.js'), 'stop()\n');
  const [result] = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: videoRender().render });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /^audit: /);
});

test('a changed build.json (re-narrated chapter) renders again, removing the old video first', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'a');
  await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: videoRender().render });
  renarrate(dir);
  const sawOld = [];
  const render = async () => { sawOld.push(fs.existsSync(path.join(dir, 'chapter.mp4'))); fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'new'); };
  const [result] = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render });
  assert.deepEqual(result, { id: 'a', status: 'ready', attempts: 1 });
  assert.deepEqual(sawOld, [false]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'render.json'), 'utf8')).build_sha256, buildSha(dir));
});

test('a missing video or a garbage render.json means render runs', async (t) => {
  const { repo, chapters } = workspace(t);
  const dir = addChapter(chapters, 'a');
  await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: videoRender().render });
  fs.rmSync(path.join(dir, 'chapter.mp4'));
  let r = videoRender();
  await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: r.render });
  assert.deepEqual(r.calls, ['a']);
  fs.writeFileSync(path.join(dir, 'render.json'), '{ nope');
  r = videoRender();
  await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: r.render });
  assert.deepEqual(r.calls, ['a']);
});

test('force renders an already-rendered chapter again', async (t) => {
  const { repo, chapters } = workspace(t);
  addChapter(chapters, 'a');
  await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: videoRender().render });
  const { render, calls } = videoRender();
  const [result] = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render, force: true });
  assert.deepEqual(result, { id: 'a', status: 'ready', attempts: 1 });
  assert.deepEqual(calls, ['a']);
});

test('a dry run reports skips, writes no render.json and touches no video', async (t) => {
  const { repo, chapters } = workspace(t);
  const done = addChapter(chapters, 'done');
  const fresh = addChapter(chapters, 'fresh');
  await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: videoRender().render, only: ['done'] });
  const before = fs.readFileSync(path.join(done, 'render.json'), 'utf8');
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render: async () => {}, dryRun: true });
  assert.deepEqual(results, [{ id: 'done', status: 'ready', skipped: true }, { id: 'fresh', status: 'ready', attempts: 1 }]);
  assert.equal(fs.readFileSync(path.join(done, 'render.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(fresh, 'render.json')), false);
  assert.equal(fs.readFileSync(path.join(done, 'chapter.mp4'), 'utf8'), 'video of done');
});

test('a code-card line that differs from the repository fails the audit gate and is never rendered', async (t) => {
  const { repo, chapters } = workspace(t);
  const card = (text) => [{ piece: 'code-card', params: { file: 'app.js', lines: [{ no: 1, text }] }, beat: 0 }];
  addChapter(chapters, 'reworded', { scene: card('begin()') });
  addChapter(chapters, 'exact', { scene: card('start()') });
  const { render, calls } = fakeRender();
  const results = await renderChapters(chapters, { root: repo, check: passCheck, cap: 1, render });
  assert.deepEqual(calls, ['exact']);
  assert.deepEqual(results.find((r) => r.id === 'reworded'),
    { id: 'reworded', status: 'failed', reason: 'audit: scene[0] line 1: text differs from the repository line' });
});

test('build.json: beats.json, captions.vtt, captions.json or gsap.min.js edited after narrate is refused', async (t) => {
  for (const name of ['beats.json', 'captions.vtt', 'captions.json', 'gsap.min.js']) {
    const { repo, chapters, dir } = await narratedChapter(t);
    fs.appendFileSync(path.join(dir, name), name === 'captions.vtt' ? '\n99:00.000 --> 99:01.000\nUnchecked words\n' : ' ');
    const { result, called } = await renderOnce(repo, chapters);
    assert.deepEqual(result, { id: 'jobs', status: 'failed', reason: CHANGED }, name);
    assert.equal(called, false);
  }
});

test('build.json: a missing beats.json, captions.vtt, captions.json or gsap.min.js is refused', async (t) => {
  for (const name of ['beats.json', 'captions.vtt', 'captions.json', 'gsap.min.js']) {
    const { repo, chapters, dir } = await narratedChapter(t);
    fs.rmSync(path.join(dir, name));
    const { result, called } = await renderOnce(repo, chapters);
    assert.equal(result.reason, CHANGED, name);
    assert.equal(called, false);
  }
});

test('build.json: an old record (version 1, 2 or none) is refused even when its fingerprints still match', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  const current = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
  // the version 1 shape: only the chapter text, narration.txt, narration.wav and index.html
  const old = { chapter: current.sha256.chapter, 'narration.txt': current.sha256['narration.txt'],
    'narration.wav': current.sha256['narration.wav'], 'index.html': current.sha256['index.html'] };
  for (const record of [{ sha256: old }, { version: 1, sha256: old }, { version: 1, sha256: current.sha256 }, { version: 2, sha256: current.sha256 }]) {
    fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(record));
    const { result, called } = await renderOnce(repo, chapters);
    assert.equal(result.reason, CHANGED, JSON.stringify(record));
    assert.equal(called, false);
  }
});

test('build.json: the recorded commit is part of the fingerprint', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  const file = path.join(dir, 'build.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(record.verified_against_commit, null);
  for (const commit of ['a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', 'not-a-commit']) {
    fs.writeFileSync(file, JSON.stringify({ ...record, verified_against_commit: commit }));
    const { result, called } = await renderOnce(repo, chapters);
    assert.equal(result.reason, CHANGED, commit);
    assert.equal(called, false);
  }
  const { verified_against_commit: _drop, ...without } = record;
  fs.writeFileSync(file, JSON.stringify(without));
  assert.equal((await renderOnce(repo, chapters)).result.reason, CHANGED);
});

test('build.json: a chapter narrated with a commit renders', async (t) => {
  const { repo, chapters, dir } = await narratedChapter(t);
  const chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'));
  const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(buildRecord(chapter, (name) => fs.readFileSync(path.join(dir, name)), sha)));
  assert.deepEqual((await renderOnce(repo, chapters)).result, { id: 'jobs', status: 'ready', attempts: 1 });
});
