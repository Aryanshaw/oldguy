'use strict';
// `oldguy shots`: checks a video folder's shots against the art library and writes the scenes, or lists the problems.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'oldguy.cjs');
const ART = path.join(__dirname, 'fixtures', 'flat-art');

// One chapter whose last shot echoes its first (it is both the first and the last chapter, so it is its own bookend).
function shots() {
  return {
    id: 'the-bell',
    metaphor: 'a shop bell',
    example: 'cart checkout',
    ground: 'indigo',
    title: 'The order',
    shots: [
      { beat: 0, ground: { id: 'room-corner', color: 'indigo' }, props: [{ id: 'shop-counter', at: 'center', focus: true }], keep: ['shop-counter'] },
      { beat: 1, cast: [{ who: 'body-a/coral', pose: 'stand', at: 'left' }], keep: ['shop-counter', 'body-a'] },
      {
        beat: 2,
        cast: [{ who: 'body-a/coral', pose: 'point', at: 'left' }],
        props: [{ id: 'bell', on: 'shop-counter.top', focus: true }],
        card: { title: 'THE ORDER', code: 'cart.checkout()', lit: 'checkout', src: 'shop.js:12', hang: 'bell.card' },
        chalk: [{ burst: 'bell' }, { sight: ['body-a.eye', 'bell'] }, { label: 'the bell = checkout', to: 'bell' }],
        camera: { move: 'push', to: 'bell', crop: 'mid' },
        keep: ['shop-counter', 'body-a', 'bell'],
      },
      { beat: 3, props: [{ id: 'shop-counter', at: 'center', focus: true }], cast: [{ who: 'oldguy', pose: 'shock', at: 'right', talk: true }] },
    ],
  };
}

// A video folder with order.json, the chapter's spec (sentences and sources) and its shots after `edit`.
function project(t, edit = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-shots-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const sub of ['specs', 'shots']) fs.mkdirSync(path.join(dir, sub));
  fs.writeFileSync(path.join(dir, 'order.json'), JSON.stringify({ chapters: ['the-bell'] }));
  const spec = {
    id: 'the-bell',
    title: 'The order',
    sources: [{ id: 's1', file: 'shop.js', lines: [10, 14], quote: 'cart.checkout()' }],
    sentences: ['A shop has a counter.', 'A customer walks up.', 'She rings the bell.', 'The old guy hears it.'].map((text) => ({ text, kind: 'framing', source_ids: [] })),
    scene: [{ piece: 'design', params: { file: 'scenes/the-bell.html' }, beat: 0 }],
  };
  fs.writeFileSync(path.join(dir, 'specs', 'the-bell.json'), JSON.stringify(spec));
  const s = shots();
  edit(s);
  fs.writeFileSync(path.join(dir, 'shots', 'the-bell.json'), JSON.stringify(s));
  return dir;
}

// Runs `oldguy shots` with the fixture art library.
function run(args) {
  return spawnSync(process.execPath, [BIN, 'shots', ...args], { encoding: 'utf8', env: { ...process.env, OLDGUY_ART_DIR: ART } });
}

test('good shots compile into scenes/<id>.html and print shots ok', (t) => {
  const dir = project(t);
  const r = run(['--dir', dir]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const scene = path.join(dir, 'scenes', 'the-bell.html');
  assert.equal(r.stdout, `shots ok\n${scene}\n`);
  assert.match(fs.readFileSync(scene, 'utf8'), /<script data-oldguy-timeline>/);
});

test('problems are listed under their chapter and the exit code is 1', (t) => {
  const dir = project(t, (s) => { s.shots[0].props[0].id = 'toaster'; delete s.metaphor; });
  const r = run(['--dir', dir]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, 'the-bell:\n  chapter needs "metaphor" (rule 09)\n  shot 0: prop "toaster" not in catalog; closest: "oven", "shop-counter"; or use a raw shot\n');
  assert.equal(fs.existsSync(path.join(dir, 'scenes')), false, 'nothing is written');
});

test('a missing shots file or spec is a problem of that chapter', (t) => {
  const dir = project(t);
  fs.rmSync(path.join(dir, 'shots', 'the-bell.json'));
  fs.rmSync(path.join(dir, 'specs', 'the-bell.json'));
  const r = run(['--dir', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^the-bell:\n  shots\/the-bell\.json is missing or not JSON\n  specs\/the-bell\.json is missing or not JSON: write the spec/);
});

test('usage mistakes exit 2 with one line', (t) => {
  assert.equal(run([]).status, 2);
  assert.match(run([]).stderr, /^oldguy shots: usage: oldguy shots --dir/);
  const dir = project(t);
  const r = run(['--dir', dir, '--show', 'nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--show nope: no such chapter in order\.json \(the-bell\)/);
  fs.rmSync(path.join(dir, 'order.json'));
  assert.match(run(['--dir', dir]).stderr, /no chapters in order\.json: run oldguy order first/);
});

// True when a headless Chromium is where `--show` looks for one.
function chromiumHere() {
  if (process.env.OLDGUY_CHROMIUM) return fs.existsSync(process.env.OLDGUY_CHROMIUM);
  const pw = '/opt/pw-browsers';
  return fs.existsSync(pw) && fs.readdirSync(pw).some((n) => n.startsWith('chromium'));
}

test('--show writes a contact sheet PNG of the chapter', { skip: !chromiumHere() && 'no headless Chromium here', timeout: 180000 }, (t) => {
  const dir = project(t);
  const r = run(['--dir', dir, '--show', 'the-bell']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const png = path.join(dir, 'shots', 'the-bell.png');
  assert.match(r.stdout, new RegExp(`contact sheet: ${png.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n$`));
  const bytes = fs.readFileSync(png);
  assert.deepEqual([...bytes.subarray(1, 4)].map((b) => String.fromCharCode(b)).join(''), 'PNG');
  // keep a copy for a look when asked
  if (process.env.OLDGUY_KEEP_SHEET) fs.copyFileSync(png, process.env.OLDGUY_KEEP_SHEET);
});
