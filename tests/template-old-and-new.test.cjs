'use strict';
// The old-and-new template: new guy left, old guy right (two ids, one voice), two distinct voices, word captions over
// a looping background, and the reacting poses and props inlined into stage.html (built by build-stage.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listTemplates } = require('../lib/template.mts');
const { buildStagePage, stageAssets } = require('../lib/stage.mts');

const ROOT = path.join(__dirname, '..', 'templates');
const t = listTemplates(ROOT).find((x) => x.id === 'old-and-new');

test('old-and-new: new guy left, old guy right, two different voices', () => {
  const byId = Object.fromEntries(t.speakers.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ['newguy', 'oldguy', 'oldguy-laughs']);
  assert.equal(byId.newguy.side, 'left');
  assert.equal(byId.oldguy.side, 'right');
  assert.equal(byId['oldguy-laughs'].side, 'right');
  assert.equal(byId['oldguy-laughs'].voice, byId.oldguy.voice);
  assert.notEqual(byId.newguy.voice, byId.oldguy.voice);
  // no talking picture, so the stage driver bobs the speaker while he talks
  for (const s of t.speakers) assert.equal(s.talking, undefined);
  assert.equal(t.pace.captions, 'word');
  assert.ok(t.pace.line_gap_ms >= 500);
});

test('old-and-new: the background loop ships in the folder, small and square', () => {
  assert.equal(t.background, 'assets/parkour.mp4');
  const size = fs.statSync(path.join(t.dir, t.background)).size;
  assert.ok(size <= 3 * 1024 * 1024);
  assert.ok(stageAssets(t).includes('assets/parkour.mp4'));
});

test('old-and-new: stage.html is stage.src.html with every picture inlined', () => {
  const src = fs.readFileSync(path.join(t.dir, 'stage.src.html'), 'utf8');
  const stage = fs.readFileSync(path.join(t.dir, 'stage.html'), 'utf8');
  const pics = [...src.matchAll(/PIC\(([a-z/-]+)\)/g)].map((m) => m[1]);
  assert.ok(pics.includes('newguy-react') && pics.includes('oldguy-react'));
  assert.ok(!/PIC\(/.test(stage), 'run node templates/old-and-new/build-stage.mjs');
  for (const name of pics) {
    const b64 = fs.readFileSync(path.join(t.dir, 'assets', `${name}.webp`)).toString('base64');
    assert.ok(stage.includes(b64), `${name} is not inlined; run node templates/old-and-new/build-stage.mjs`);
  }
});

test('old-and-new: a page swaps speakers and shows one caption word at a time', () => {
  const timing = {
    durationS: 4,
    lines: [
      { text: 'So it reads it all at once.', start: 0, end: 1.5, speaker: 'newguy', kind: 'framing', chips: [] },
      { text: 'Nope, one line at a time.', start: 2, end: 3.5, speaker: 'oldguy', kind: 'claim', chips: ['lib/narrate.mts:145'] },
    ],
    words: [
      { line: 0, text: 'So', start: 0, end: 0.5 },
      { line: 1, text: 'Nope,', start: 2, end: 2.5 },
    ],
  };
  for (const shape of t.shapes) {
    const page = buildStagePage({ id: 'demo', template: t, shape, timing, pieces: [] });
    assert.ok(page.includes('id="og-sp-newguy" class="og-speaker og-speaker-left"'));
    assert.ok(page.includes('id="og-cap-1" class="og-cap og-cap-word">Nope</div>'));
    assert.ok(page.includes('tl.fromTo("#og-sp-oldguy", {y: 0}, {y: -14'));
    assert.ok(page.includes('class="og-bg-clip" src="assets/parkour.mp4"'));
  }
});
