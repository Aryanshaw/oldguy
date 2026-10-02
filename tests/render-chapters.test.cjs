'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderChapters, renderArgs } = require('../lib/render-chapters.cjs');

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

// Writes one chapter folder; `narrated` adds the index.html that narrate would have written.
function addChapter(chapters, id, { sources = [GOOD_SOURCE], narrated = true } = {}) {
  const dir = path.join(chapters, id);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify({ id, title: id, sources, sentences: [CLAIM], scene: [] }));
  if (narrated) fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
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

test('renderArgs: npx hyperframes render, draft quality, 2 workers, chapter.mp4 inside the chapter', () => {
  assert.deepEqual(renderArgs('/w/chapters/intro'), ['hyperframes', 'render', '/w/chapters/intro', '-q', 'draft', '-w', '2', '-o', '/w/chapters/intro/chapter.mp4']);
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
