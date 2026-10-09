'use strict';
// Scenes compiled by `oldguy shots` may be up to 600 KB; scenes written by hand stay at 100 KB. Only scaffold marks a
// scene as compiled, after compiling the chapter's shots again and getting the same bytes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const design = require('../scene-kit/design.mts');
const { scaffoldChapter } = require('../lib/chapter.mts');

const FIXTURE = path.join(__dirname, 'fixtures', 'flat-art');
const WIN = { startS: 0, durationS: 10, idPrefix: 'p0', beatsS: [0, 5] };

// A valid hand-written scene padded with flat shapes to about kb kilobytes.
function bigScene(kb) {
  const rects = Array.from({ length: Math.ceil((kb * 1024) / 60) }, (_, i) => `<rect x="${i % 1900}" y="${i % 1000}" width="9" height="9" fill="#FF6B57"/>`).join('\n');
  return `<div id="a"><svg viewBox="0 0 1920 1080">${rects}</svg></div>\n<script data-oldguy-timeline>\ntl.from("#a", {opacity: 0, duration: 0.4}, beat(1));\n</script>`;
}

test('the design piece takes 150 KB only from a scene marked as compiled', () => {
  const html = bigScene(150);
  assert.ok(Buffer.byteLength(html) > 150 * 1024);
  assert.throws(() => design.render({ html }, WIN), /design: the scene is over 100 KB/);
  assert.doesNotThrow(() => design.render({ html, fromShots: true }, WIN));
  assert.throws(() => design.render({ html: bigScene(610), fromShots: true }, WIN), /design: the scene is over 600 KB/);
  // only exactly true counts
  assert.throws(() => design.render({ html, fromShots: 'yes' }, WIN), /over 100 KB/);
});

// The one-chapter shot list the CLI tests use; its last shot echoes its first.
function shots() {
  return {
    id: 'the-bell', metaphor: 'a shop bell', example: 'cart checkout', ground: 'indigo', title: 'The order',
    shots: [
      { beat: 0, ground: { id: 'room-corner', color: 'indigo' }, props: [{ id: 'shop-counter', at: 'center', focus: true }], keep: ['shop-counter'] },
      { beat: 1, props: [{ id: 'bell', on: 'shop-counter.top', focus: true }], keep: ['shop-counter', 'bell'] },
      { beat: 2, props: [{ id: 'shop-counter', at: 'center', focus: true }] },
    ],
  };
}

// An art folder like the fixture, with a bell drawing of about 140 KB, so the compiled scene is about 150 KB.
function bigArt(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-big-art-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const file = path.join(dir, 'props', 'bell.svg');
  const rects = Array.from({ length: 2400 }, (_, i) => `<rect x="${6 + (i % 140)}" y="${112 + (i % 20)}" width="8" height="8" fill="#D9A520"/>`).join('\n');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</svg>', `${rects}\n</svg>`));
  return dir;
}

// A video folder holding the shot list and a spec whose design piece reads scenes/the-bell.html.
function video(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-big-scene-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const sub of ['shots', 'scenes']) fs.mkdirSync(path.join(root, sub));
  fs.writeFileSync(path.join(root, 'shots', 'the-bell.json'), JSON.stringify(shots()));
  return root;
}

// Scaffolds the-bell from scenes/the-bell.html, with these extra design params.
function scaffold(root, params = {}) {
  return scaffoldChapter({
    root, id: 'the-bell', title: 'The order', sources: [],
    sentences: ['A shop has a counter.', 'A bell sits on it.', 'The counter waits.'].map((text) => ({ text, kind: 'framing', source_ids: [] })),
    scene: [{ piece: 'design', params: { file: 'scenes/the-bell.html', ...params }, beat: 0 }],
  });
}

test('scaffold takes a 150 KB scene compiled from the shots, and refuses the same size written by hand', (t) => {
  const art = bigArt(t);
  const before = process.env.OLDGUY_ART_DIR;
  process.env.OLDGUY_ART_DIR = art;
  t.after(() => { if (before === undefined) delete process.env.OLDGUY_ART_DIR; else process.env.OLDGUY_ART_DIR = before; });
  const { loadCatalog } = require('../lib/catalog.mts');
  const { compileChapter } = require('../lib/shots.mts');
  const scene = compileChapter(shots(), loadCatalog());
  const kb = Buffer.byteLength(scene) / 1024;
  assert.ok(kb > 140 && kb < 200, `compiled scene is ${kb} KB`);

  // compiled: scaffold compiles the shots again, gets the same bytes, and marks the scene
  const ok = video(t);
  fs.writeFileSync(path.join(ok, 'scenes', 'the-bell.html'), scene);
  const dir = scaffold(ok);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8')).scene[0].params.fromShots, true);

  // by hand: one byte different from what the shots compile to, so it is held to 100 KB
  const hand = video(t);
  fs.writeFileSync(path.join(hand, 'scenes', 'the-bell.html'), scene.replace('<div id="fa-the-bell"', '<div  id="fa-the-bell"'));
  assert.throws(() => scaffold(hand), /scene\[0\]: design: the scene is over 100 KB/);

  // by hand with no shot list at all
  const none = video(t);
  fs.rmSync(path.join(none, 'shots', 'the-bell.json'));
  fs.writeFileSync(path.join(none, 'scenes', 'the-bell.html'), scene);
  assert.throws(() => scaffold(none), /over 100 KB/);

  // and a spec may not claim the mark
  const claim = video(t);
  fs.writeFileSync(path.join(claim, 'scenes', 'the-bell.html'), bigScene(150));
  assert.throws(() => scaffold(claim, { fromShots: true }), /scene\[0\]: "fromShots" is set by oldguy scaffold/);
});
