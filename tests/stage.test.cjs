'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildStagePage, splitStage, stageAssets } = require('../lib/stage.mts');
const { buildRootComposition, pieceWindows } = require('../lib/chapter.mts');
const { loadTemplate } = require('../lib/template.mts');
const { estimateWords, anchorTime } = require('../lib/word-times.mts');

const GOLDEN = path.join(__dirname, 'fixtures', 'stage-golden');
const FIXTURES = path.join(__dirname, 'fixtures', 'templates');
const EXPLAINER = loadTemplate('explainer');
const DUO = loadTemplate('duo', FIXTURES);
const INPUTS = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'inputs.json'), 'utf8'));

// The pieces of one golden input, timed against its beats.
function piecesOf(c) {
  return pieceWindows(c.scene, c.beats.map((start) => ({ start })), c.durationS);
}

// A two-line, two-speaker timing: kid frames from 0.04 to 2, dad claims from 2.12 to 5.
function duoTiming() {
  const lines = [
    { text: 'Does it just make up numbers?', start: 0.04, end: 2, speaker: 'kid', kind: 'framing', chips: [] },
    { text: 'Every source goes through a check first.', start: 2.12, end: 5, speaker: 'dad', kind: 'claim', chips: ['cli/client.mts:141'] },
  ];
  return { durationS: 5.2, lines, words: estimateWords(lines) };
}

const TITLE = [{ piece: 'title', params: { heading: 'Lines' }, startS: 0, durationS: 5.2, beatsS: [0.04, 2.12] }];

test('golden: explainer at 16:9 is byte for byte the page oldguy built before templates', () => {
  for (const c of INPUTS) {
    const before = fs.readFileSync(path.join(GOLDEN, `${c.id}.html`), 'utf8');
    const page = buildStagePage({ id: c.id, template: EXPLAINER, shape: '16:9', timing: { durationS: c.durationS, lines: [], words: [] }, pieces: piecesOf(c) });
    assert.equal(page, before, c.id);
    assert.equal(buildRootComposition({ id: c.id, durationS: c.durationS, pieces: piecesOf(c) }), before, `${c.id} through buildRootComposition`);
  }
});

test('explainer at 9:16 is a 1080x1920 root with the 1920x1080 scene scaled into it, centred', () => {
  const c = INPUTS[0];
  const page = buildStagePage({ id: c.id, template: EXPLAINER, shape: '9:16', timing: { durationS: c.durationS, lines: [], words: [] }, pieces: piecesOf(c) });
  assert.match(page, /data-width="1080" data-height="1920"/);
  assert.match(page, /width=1080, height=1920/);
  assert.match(page, /<div class="og-slot" style="position: absolute; left: 0px; top: 0px; width: 1080px; height: 1920px; overflow: hidden;">/);
  // 1080 / 1920 = 0.5625; the scaled scene is 607.5 tall, so it sits (1920 - 607.5) / 2 = 656.25 from the top
  assert.match(page, /left: 0px; top: 656.25px; width: 1920px; height: 1080px; transform: scale\(0.5625\)/);
});

test('a stage needs the slot marker, known markers only, each once and alone on its line', () => {
  assert.throws(() => splitStage('<div></div>'), /oldguy:slot --> marker is required/);
  assert.throws(() => splitStage('<!-- oldguy:slot -->\n<!-- oldguy:stickers -->'), /unknown marker oldguy:stickers/);
  assert.throws(() => splitStage('<!-- oldguy:slot -->\n<!-- oldguy:slot -->'), /appears twice/);
  assert.throws(() => splitStage('<div><!-- oldguy:slot --></div>'), /alone on its line/);
  assert.deepEqual(splitStage('<style>.a { b: c; }</style>\n<!-- oldguy:slot -->\n').css, '.a { b: c; }');
});

test('a shape the template does not offer is refused', () => {
  assert.throws(() => buildStagePage({ id: 'x', template: DUO, shape: '1:1', timing: duoTiming(), pieces: TITLE }), /duo has no 1:1 layout; it offers 16:9, 9:16/);
});

test('speakers swap on each line start, and a talking picture shows only while its line is spoken', () => {
  const page = buildStagePage({ id: 'lines', template: DUO, shape: '16:9', timing: duoTiming(), pieces: TITLE });
  assert.match(page, /<div id="og-sp-kid" class="og-speaker og-speaker-left" data-speaker="kid"><img class="og-speaker-idle" src="assets\/kid.svg" alt="" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: contain;" \/><\/div>/);
  assert.match(page, /tl\.set\("#og-sp-kid", \{opacity: 1\}, 0\.04\);\ntl\.set\("#og-sp-dad", \{opacity: 0\}, 0\.04\);/);
  assert.match(page, /tl\.set\("#og-sp-dad", \{opacity: 1\}, 2\.12\);\ntl\.set\("#og-sp-kid", \{opacity: 0\}, 2\.12\);/);
  assert.match(page, /tl\.set\("#og-sp-dad \.og-speaker-talk", \{opacity: 1\}, 2\.12\);\ntl\.set\("#og-sp-dad \.og-speaker-talk", \{opacity: 0\}, 5\);/);
  assert.match(page, /tl\.fromTo\("#og-sp-kid", \{y: 0\}, \{y: -14/, 'a speaker with no talking picture bobs instead');
});

test('a word caption is visible exactly in its word window, without trailing punctuation', () => {
  const timing = duoTiming();
  const page = buildStagePage({ id: 'lines', template: DUO, shape: '16:9', timing, pieces: TITLE });
  const last = timing.words.length - 1;
  assert.equal(timing.words[last].text, 'first.');
  assert.match(page, new RegExp(`<div id="og-cap-${last}" class="og-cap og-cap-word">first</div>`));
  const w = timing.words[3];
  const s = (n) => String(Number(n.toFixed(3)));
  assert.ok(page.includes(`tl.set("#og-cap-3", {opacity: 0}, 0);\ntl.set("#og-cap-3", {opacity: 1}, ${s(w.start)});\ntl.set("#og-cap-3", {opacity: 0}, ${s(w.end)});`));
});

test('line captions show one cue per line', (t) => {
  const lineTemplate = { ...DUO, pace: { ...DUO.pace, captions: 'line' } };
  const page = buildStagePage({ id: 'lines', template: lineTemplate, shape: '16:9', timing: duoTiming(), pieces: TITLE });
  assert.match(page, /<div id="og-cap-1" class="og-cap og-cap-line">Every source goes through a check first\.<\/div>/);
  assert.match(page, /tl\.set\("#og-cap-1", \{opacity: 1\}, 2\.12\);/);
});

test('source chips appear only on claim lines, for that line', () => {
  const page = buildStagePage({ id: 'lines', template: DUO, shape: '16:9', timing: duoTiming(), pieces: TITLE });
  assert.match(page, /<div id="og-chip-1" class="og-chip">cli\/client\.mts:141<\/div>/);
  assert.doesNotMatch(page, /og-chip-0/);
  assert.match(page, /tl\.set\("#og-chip-1", \{opacity: 1\}, 2\.12\);\ntl\.set\("#og-chip-1", \{opacity: 0\}, 5\);/);
});

test('the scene sits in the template slot box, scaled to fit', () => {
  const page = buildStagePage({ id: 'lines', template: DUO, shape: '16:9', timing: duoTiming(), pieces: TITLE });
  assert.match(page, /left: 480px; top: 200px; width: 960px; height: 540px;/);
  assert.match(page, /transform: scale\(0\.5\)/);
  assert.match(page, /data-shape="16:9"/, 'a stage with styles is told its shape');
});

test('the background loop covers the chapter from an offset that is stable per chapter id', () => {
  const long = { ...duoTiming(), durationS: 47 };
  const a = buildStagePage({ id: 'one', template: DUO, shape: '16:9', timing: long, pieces: TITLE });
  const again = buildStagePage({ id: 'one', template: DUO, shape: '16:9', timing: long, pieces: TITLE });
  const b = buildStagePage({ id: 'two', template: DUO, shape: '16:9', timing: long, pieces: TITLE });
  const clips = [...a.matchAll(/<video id="og-bg-\d+" class="og-bg-clip" src="assets\/loop.mp4" muted playsinline data-start="([\d.]+)" data-duration="([\d.]+)" data-media-start="([\d.]+)"/g)]
    .map((m) => m.slice(1).map(Number));
  assert.equal(a, again);
  assert.ok(clips.length >= 3);
  const offset = clips[0][2];
  assert.ok(offset >= 0 && offset < 20);
  assert.equal(clips[0][0], 0);
  assert.ok(Math.abs(clips[0][1] - (20 - offset)) < 0.002, 'the first clip plays to the end of the footage');
  clips.slice(1).forEach(([, , from]) => assert.equal(from, 0));
  const total = clips.reduce((n, [, d]) => n + d, 0);
  assert.ok(Math.abs(total - 47) < 0.01, `clips cover the chapter (${total})`);
  assert.notEqual(b.match(/data-media-start="([\d.]+)"/)[1], String(offset), 'another chapter opens on another frame');
});

test('anchorTime: a keyword starts the piece, unless it is in the last third of its line', () => {
  const lines = [{ text: 'one two three four five six seven eight nine', start: 0, end: 9 }];
  const timing = { durationS: 9, lines, words: estimateWords(lines) };
  assert.equal(anchorTime(timing, 0, 'three'), timing.words[2].start);
  assert.equal(anchorTime(timing, 0, 'Seven'), 0, 'word 7 of 9 is in the last third');
  assert.equal(anchorTime(timing, 0), 0);
  assert.equal(anchorTime(timing, 0, 'missing'), 0);
});

test('pieceWindows starts an anchored piece at its word and ends the piece before at the same moment', () => {
  const scene = [{ piece: 'title', params: {}, beat: 0 }, { piece: 'callout', params: {}, beat: 1, word: 'check' }];
  const windows = pieceWindows(scene, [{ start: 0 }, { start: 2 }], 6, (beat, word) => (word ? 3.5 : beat * 2));
  assert.deepEqual(windows.map((w) => [w.startS, w.durationS]), [[0, 3.5], [3.5, 2.5]]);
});

test('estimateWords splits each line by word length, in order, inside the line', () => {
  const words = estimateWords([{ text: 'a bbb', start: 1, end: 3 }]);
  assert.deepEqual(words, [{ line: 0, text: 'a', start: 1, end: 1.5 }, { line: 0, text: 'bbb', start: 1.5, end: 3 }]);
});

test('stageAssets lists the background and every speaker picture once', () => {
  assert.deepEqual(stageAssets(DUO).sort(), ['assets/dad-talk.svg', 'assets/dad.svg', 'assets/kid.svg', 'assets/loop.mp4']);
  assert.deepEqual(stageAssets(EXPLAINER), []);
});
