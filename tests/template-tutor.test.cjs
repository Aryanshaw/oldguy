'use strict';
// The tutor template: the old guy has two poses on one card (two speaker ids, one voice), the new guy is on the
// other side, and the room's props travel inside stage.html (built from stage.src.html by stage-props.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listTemplates } = require('../lib/template.mts');
const { buildStagePage, stageAssets } = require('../lib/stage.mts');

const ROOT = path.join(__dirname, '..', 'templates');
const tutor = listTemplates(ROOT).find((t) => t.id === 'tutor');

test('tutor: the old guy laughs in his own voice, on his own side', () => {
  const byId = Object.fromEntries(tutor.speakers.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ['newguy', 'oldguy', 'oldguy-laughs']);
  assert.equal(byId['oldguy-laughs'].voice, byId.oldguy.voice);
  assert.equal(byId['oldguy-laughs'].side, byId.oldguy.side);
  assert.notEqual(byId.newguy.side, byId.oldguy.side);
  assert.ok(tutor.pace.line_gap_ms >= 500);
});

test('tutor: stage.html is stage.src.html with every prop inlined', () => {
  const src = fs.readFileSync(path.join(tutor.dir, 'stage.src.html'), 'utf8');
  const stage = fs.readFileSync(path.join(tutor.dir, 'stage.html'), 'utf8');
  const props = [...src.matchAll(/PROP\(([a-z-]+)\)/g)].map((m) => m[1]);
  assert.ok(props.length >= 3);
  assert.ok(!/PROP\(/.test(stage), 'run node templates/tutor/stage-props.mjs');
  for (const name of props) {
    const b64 = fs.readFileSync(path.join(tutor.dir, 'assets', 'props', `${name}.webp`)).toString('base64');
    assert.ok(stage.includes(`data:image/webp;base64,${b64}`), `${name} is inlined and current`);
  }
});

test('tutor: every picture the stage names by path is copied into the chapter', () => {
  const stage = fs.readFileSync(path.join(tutor.dir, 'stage.html'), 'utf8');
  const named = [...stage.matchAll(/(?:src="|url\()(assets\/[^")]+)/g)].map((m) => m[1]);
  const copied = new Set(stageAssets(tutor));
  for (const p of named) assert.ok(copied.has(p), `${p} would be missing from a chapter`);
});

test('tutor: a laughing line shows the laughing card and hides the pointing one', () => {
  const lines = [
    { text: 'Okay, dumb question.', start: 0.04, end: 1, kind: 'framing', chips: [], speaker: 'newguy' },
    { text: 'Back in my day.', start: 1.6, end: 3, kind: 'framing', chips: [], speaker: 'oldguy-laughs' },
  ];
  const page = buildStagePage({ id: 'sample', template: tutor, shape: '16:9', timing: { durationS: 3.5, lines, words: [] }, pieces: [
    { piece: 'title', params: { heading: 'Checks' }, startS: 0, durationS: 3.5, beatsS: [0.04, 1.6] },
  ] });
  assert.ok(page.includes('tl.set("#og-sp-oldguy-laughs", {opacity: 1}, 1.6);'));
  assert.ok(page.includes('tl.set("#og-sp-newguy, #og-sp-oldguy", {opacity: 0}, 1.6);'));
});
