'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkLesson, sceneTexts, exampleWords } = require('../lib/lesson.mts');

const BIN = path.join(__dirname, '..', 'bin', 'oldguy.cjs');

// A chapter that follows every rule, about the todo "buy milk".
function good(id, extra = {}) {
  return {
    id,
    sentences: [
      { text: 'You type buy milk and press Add.' },
      { text: 'The form sends the todo to the server.' },
      { text: 'So nothing is saved until the server answers.' },
    ],
    scenes: ['<div class="og-kicker">Add a todo</div><div class="lane">Browser</div><div>buy milk</div>'],
    ...extra,
  };
}

// The reasons of every finding, for short assertions.
const reasons = (findings) => findings.map((f) => `${f.id}: ${f.reason}`);

test('a video that follows one example with a So line per chapter and labels on screen passes', () => {
  assert.deepEqual(checkLesson({ example: 'the todo "buy milk"', chapters: [good('form'), good('server')] }), []);
});

test('a chapter without a So line, with a long sentence, or with too many sentences is named', () => {
  const long = 'The handler reads the body and checks the title and then it writes the row and then it sends the reply back to the browser that asked for it.';
  const c = good('save', { sentences: [{ text: long }, ...Array.from({ length: 8 }, () => ({ text: 'The todo is short.' }))] });
  const r = reasons(checkLesson({ example: 'todo', chapters: [c] }));
  assert.ok(r.some((x) => /save sentence 0: 29 words; at most 25/.test(x)), r.join('\n'));
  assert.ok(r.some((x) => /save: 9 sentences; at most 8/.test(x)), r.join('\n'));
  assert.ok(r.some((x) => /save: no sentence starts with "So"/.test(x)), r.join('\n'));
});

test('pointing at another chapter by position or a time is refused; naming the thing is fine', () => {
  const c = good('reply', { sentences: [
    { text: 'In the next chapter the todo is saved.' },
    { text: 'At 1:30 the todo appears.' },
    { text: 'So the todo row from the form is still waiting.' },
  ] });
  const r = reasons(checkLesson({ example: 'todo', chapters: [c] }));
  assert.equal(r.filter((x) => /points at another chapter or a time/.test(x)).length, 2, r.join('\n'));
});

test('the running example must be named in script.md and followed through most chapters', () => {
  assert.match(reasons(checkLesson({ example: null, chapters: [good('a')] }))[0], /names no running example/);
  const off = { id: 'off', sentences: [{ text: 'So the server starts.' }], scenes: [] };
  const r = reasons(checkLesson({ example: 'buy milk', chapters: [good('a'), off, { ...off, id: 'off2' }] }));
  assert.ok(r.some((x) => /not mentioned in off, off2/.test(x)), r.join('\n'));
  assert.deepEqual(reasons(checkLesson({ example: 'buy milk', chapters: [good('a'), good('b'), good('c'), off] })), [], 'one chapter in four may leave it');
  assert.deepEqual(exampleWords('the todo "Buy milk"'), ['todo', 'buy', 'milk']);
});

test('a sentence on screen is refused, code and styles are not read, and the planned badge appears once', () => {
  assert.deepEqual(sceneTexts('<style>.a{}</style><pre>const a = b + c + d + e + f + g + h + i;</pre><div>Label</div>'), ['Label']);
  const wordy = good('w', { scenes: ['<div class="caption">The form sends the todo to the server and waits for it.</div>'] });
  assert.match(reasons(checkLesson({ example: 'todo', chapters: [wordy] }))[0], /on-screen text "The form sends.*" is 12 words; show a label of at most 8/);
  const planned = (id) => good(id, { scenes: ['<div class="og-planned">Planned</div><div>buy milk</div>'] });
  assert.match(reasons(checkLesson({ example: 'milk', chapters: [planned('a'), planned('b')] }))[0], /planned badge is in 2 chapters \(a, b\); say it once/);
});

test('oldguy lesson reads order.json, the specs and their scenes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-lesson-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'specs'));
  fs.mkdirSync(path.join(dir, 'scenes'));
  fs.writeFileSync(path.join(dir, 'order.json'), '{"chapters":["form","gone"]}');
  fs.writeFileSync(path.join(dir, 'script.md'), '# add a todo\nexample: the todo "buy milk"\n');
  fs.writeFileSync(path.join(dir, 'scenes', 'form.html'), good('form').scenes[0]);
  fs.writeFileSync(path.join(dir, 'specs', 'form.json'), JSON.stringify({ sentences: good('form').sentences, scene: [{ piece: 'design', params: { file: 'scenes/form.html' }, beat: 0 }] }));
  const run = () => spawnSync(process.execPath, [BIN, 'lesson', '--dir', dir], { encoding: 'utf8' });
  let r = run();
  assert.equal(r.status, 1);
  assert.equal(r.stdout, 'gone: specs/gone.json is missing or not JSON\n');
  fs.writeFileSync(path.join(dir, 'order.json'), '{"chapters":["form"]}');
  r = run();
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.stdout, 'lesson ok\n');
  assert.equal(spawnSync(process.execPath, [BIN, 'lesson'], { encoding: 'utf8' }).status, 2);
});
