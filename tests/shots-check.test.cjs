'use strict';
// A compiled shot scene, scaffolded into a real chapter and built into its page, passes `hyperframes check`. Needs the
// pinned Hyperframes (fetched by npx, usually from its cache) and its browser; skipped when that is not available.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadCatalog } = require('../lib/catalog.mts');
const { compileChapter } = require('../lib/shots.mts');
const { scaffoldChapter, pieceWindows, GSAP_FILE, GSAP_NAME } = require('../lib/chapter.mts');
const { buildStagePage } = require('../lib/stage.mts');
const { loadTemplate } = require('../lib/template.mts');
const { writeWav } = require('../lib/wav.mts');
const { HYPERFRAMES_VERSION } = require('../lib/hyperframes.mts');

const CAT = loadCatalog(path.join(__dirname, 'fixtures', 'flat-art'));
const HF = ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`];

// True when the pinned Hyperframes runs here (offline it can still come from the npx cache).
function hyperframesAvailable() {
  const r = spawnSync('npx', [...HF, '--version'], { encoding: 'utf8', timeout: 60000 });
  return r.status === 0 && r.stdout.trim() === HYPERFRAMES_VERSION;
}

const CHAPTER = {
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
    { beat: 3, cast: [{ who: 'oldguy', pose: 'shock', at: 'right', talk: true }] },
  ],
};

test('a compiled shot scene passes hyperframes check in a real chapter page', { skip: !hyperframesAvailable() && `hyperframes@${HYPERFRAMES_VERSION} is not available`, timeout: 600000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-shots-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scenes'));
  fs.writeFileSync(path.join(root, 'scenes', 'the-bell.html'), compileChapter(CHAPTER, CAT));
  const dir = scaffoldChapter({
    root,
    id: 'the-bell',
    title: 'The order',
    sources: [{ id: 's1', file: 'shop.js', lines: [10, 14], quote: 'cart.checkout()' }],
    sentences: [
      { text: 'A shop has a counter.', kind: 'framing', source_ids: [] },
      { text: 'A customer walks up to it.', kind: 'framing', source_ids: [] },
      { text: 'She rings the bell to order.', kind: 'framing', source_ids: [] },
      { text: 'The old guy hears it.', kind: 'framing', source_ids: [] },
    ],
    scene: [{ piece: 'design', params: { file: 'scenes/the-bell.html' }, beat: 0 }],
  });
  const chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'));
  const durationS = 16;
  const beats = [0, 4, 8, 12].map((start) => ({ start }));
  const page = buildStagePage({
    id: 'the-bell', template: loadTemplate('explainer'), shape: '16:9', timing: { durationS, lines: [], words: [] },
    pieces: pieceWindows(chapter.scene, beats, durationS),
  });
  fs.writeFileSync(path.join(dir, 'index.html'), page);
  fs.copyFileSync(GSAP_FILE, path.join(dir, GSAP_NAME));
  const rate = 24000;
  fs.writeFileSync(path.join(dir, 'narration.wav'), writeWav({ channels: 1, sampleRate: rate, bitsPerSample: 16 }, Buffer.alloc(rate * 2 * durationS)));
  const r = spawnSync('npx', [...HF, 'check', dir], { encoding: 'utf8', timeout: 540000 });
  assert.equal(r.status, 0, `hyperframes check failed:\n${r.stdout}\n${r.stderr}`);
});
