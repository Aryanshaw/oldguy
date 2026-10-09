'use strict';
// The old-and-new template: new guy left, old guy right (two ids, one voice), two distinct voices and no third
// speaker, big-word captions for values only, looping parkour footage toned down behind an opaque board, no source
// chips, and the reacting poses inlined into stage.html (built by build-stage.mjs).
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

test('old-and-new: looping parkour footage at normal speed, toned down behind an opaque board that is most of the frame', () => {
  assert.equal(t.background, 'assets/parkour.mp4');
  assert.equal(t.background_seconds, 12);
  assert.match(t.description, /over looping parkour gameplay/);
  const size = fs.statSync(path.join(t.dir, t.background)).size;
  assert.ok(size <= 3 * 1024 * 1024);
  assert.ok(stageAssets(t).includes('assets/parkour.mp4'));
  assert.ok(!fs.existsSync(path.join(t.dir, 'assets', 'parkour-still.webp')));
  const src = fs.readFileSync(path.join(t.dir, 'stage.src.html'), 'utf8');
  assert.ok(src.includes('<!-- oldguy:background -->'));
  // darkened and blurred or desaturated, never slowed down or paused
  const clip = src.match(/\.og-bg-clip \{([^}]*)\}/);
  assert.ok(clip, 'the stage styles the footage');
  assert.match(clip[1], /filter:[^;]*brightness\(0\.[0-9]+\)/);
  assert.match(clip[1], /blur\(|saturate\(0\./);
  assert.ok(!/playbackRate|animation-play-state|\.pause\(/.test(src));
  // the board is opaque, so the footage only shows around it
  assert.match(src, /\.oan-board \{[^}]*background: #14110A;/);
  for (const [shape, [, , w]] of Object.entries(t.slots)) {
    const width = { '16:9': 1920, '9:16': 1080, '1:1': 1440 }[shape];
    assert.ok(w / width >= 0.7, `${shape} board is ${w} of ${width} px wide`);
  }
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

test('old-and-new: a page swaps speakers, hides filler caption words and draws no source chips', () => {
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
    assert.ok(!page.includes('class="og-chip"'));
    assert.ok(!page.includes('og-speaker-center'));
    // the stage's script keeps only words with a digit, an underscore or a dot inside
    assert.ok(page.includes("if (!/[0-9_]|[A-Za-z]\\.[A-Za-z]/.test(el.textContent)) el.style.display = 'none';"));
  }
});

test('old-and-new: template.md keeps the rules a first-time viewer needs', () => {
  const md = fs.readFileSync(path.join(t.dir, 'template.md'), 'utf8');
  // the promise naming the stops, early
  assert.match(md, /\*\*The promise, in the first ten seconds\.\*\*/);
  // a before-and-after compares only what the replay shows, two cells a sentence at most
  assert.match(md, /\*\*Compare only what the replay shows\.\*\*/);
  assert.match(md, /\*\*One sentence fills at most two cells\*\*/);
  // the lit code word is the word the voice says, at the moment it is said
  assert.match(md, /\*\*The lit\s+word is the spoken word\*\*/);
  assert.match(md, /word by word/);
  // one clock per chapter, and chapter breaks longer than any pause
  assert.match(md, /\*\*One clock per chapter\.\*\*/);
  assert.match(md, /\*\*Chapter breaks are longer than any pause\.\*\*/);
  // big enough to read on a phone after the 0.54 scale: code at 72 px (about 14 px on a phone), wrapped, never shrunk
  assert.match(md, /labels 48 px or more/);
  assert.match(md, /\*\*code 72 px or more\*\* \(about 14 px on a phone\)/);
  assert.match(md, /Never shrink the code to fit\./);
  // a formula shown with this video's own numbers, and only numbers that feed the running example
  assert.match(md, /\*\*A formula gets its real numbers plugged in\.\*\*/);
  assert.match(md, /\*\*Every number on screen feeds the running example\.\*\*/);
  // a short first chapter, a what-if answered with every consequence, recap boxes with numbers
  assert.match(md, /\*\*The first chapter is short: one line, four stops\.\*\*/);
  assert.match(md, /\*\*The answer names every consequence\*\*/);
  assert.match(md, /\*\*each stage box filled with its number\*\*/);
  // the frame held at a chapter break is the full board before its fade, never a blank one
  assert.match(md, /hold the frame from\s+just before that fade/);
});

test('old-and-new: at 9:16 the board is the frame\'s width, so code at 72 px reads at 14 px on a phone', () => {
  const [, , w, h] = t.slots['9:16'];
  assert.ok(w / 1080 >= 0.7, `the 9:16 board is ${w} of 1080 px wide`);
  // the 1920x1080 scene's scale inside the slot, then a 1080 px frame on a 390 px phone
  const scale = Math.min(w / 1920, h / 1080);
  assert.ok(72 * scale * (390 / 1080) >= 14, `72 px code is ${(72 * scale * (390 / 1080)).toFixed(1)} px on a phone`);
});
