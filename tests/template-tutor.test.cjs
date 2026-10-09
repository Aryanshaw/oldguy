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

// The map scene (examples/map.mjs): the four lanes stay on screen while the band under them shows code, a record or a
// what-if; it must be a scene the design piece accepts, and every code line it shows is a whole repository line.
const REPO = path.join(__dirname, '..');
const { checkLesson, sceneTexts } = require('../lib/lesson.mts');
const designPiece = require('../scene-kit/design.mts');
const mapModule = () => import(path.join(tutor.dir, 'examples', 'map.mjs'));

function sampleMap(lineAt) {
  return {
    kicker: 'Template engine · our line',
    title: 'When the line is said',
    cards: [
      { id: 'd', lane: 'script', label: '“Your todo is saved.”', done: true },
      { id: 'a', lane: 'timing', label: 'ends 3.22 s', at: 1 },
      { id: 'b', lane: 'timing', label: 'starts 3.77 s', detail: '3.22 s + 550 ms', at: 2 },
    ],
    lights: [{ at: 3, cards: ['a'] }],
    panels: [
      { id: 'code', lane: 'timing', at: 1, until: 2, title: 'zoom · <code>lib/wav.mts</code>',
        code: [lineAt(REPO, 'lib/wav.mts', 121, 'frames +='), lineAt(REPO, 'lib/wav.mts', 123, 'frames / format.sampleRate')],
        lit: [{ no: 121, at: 1 }, { no: 123, at: 2 }] },
      { id: 'q', lane: 'timing', at: 3, title: 'what if?',
        table: { head: ['', 'now', 'what if'], rows: [['starts', '3.77 s', { text: '?', at: 3, then: { text: '4.22 s', at: 3 } }]] } },
    ],
  };
}

test('tutor map: a scene the design piece accepts, with the map drawn before anything in it', async () => {
  const { mapScene, lineAt } = await mapModule();
  const html = mapScene(sampleMap(lineAt));
  const out = designPiece.render({ html }, { startS: 0, durationS: 12, idPrefix: 'p0', beatsS: [0.04, 2, 4, 6] });
  // four lanes, every card and panel held back first, then each one revealed on its sentence
  assert.equal((html.match(/class="lane"/g) ?? []).length, 4);
  assert.match(out.timeline ?? out.js ?? JSON.stringify(out), /#tm-a, #tm-b, #tm-code, #tm-q/);
  assert.ok(html.includes('tl.to("#tm-a", {opacity: 1, duration: 0.35}, beat(1) + 0.30);'));
  // the quick check lights the card the answer needs again, and the answer takes the "?"'s place
  assert.ok(html.includes('tl.to("#tm-a-g", {opacity: 1, duration: 0.25}, beat(3) + 0.30);'));
  assert.ok(html.includes('tl.to("#tm-q-r0c2-b", {opacity: 1, duration: 0.3}, beat(3) + 0.50);'));
  // the code band lights one line, then moves the light to the next
  assert.ok(html.includes('tl.to("#tm-code-l121", {opacity: 0, duration: 0.25}, beat(2) + 0.30);'));
  assert.ok(html.includes('tl.to("#tm-code-l123", {opacity: 1, duration: 0.25}, beat(2) + 0.30);'));
});

test('tutor map: code lines are whole repository lines, and line numbers are not read as values', async () => {
  const { mapScene, lineAt } = await mapModule();
  const wav = fs.readFileSync(path.join(REPO, 'lib', 'wav.mts'), 'utf8').split('\n');
  assert.equal(lineAt(REPO, 'lib/wav.mts', 123).text, wav[122].trimEnd());
  assert.throws(() => lineAt(REPO, 'lib/wav.mts', 123, 'not on this line'), /does not hold/);
  const html = mapScene(sampleMap(lineAt));
  const shown = [...html.matchAll(/<pre id="[^"]+">([\s\S]*?)<\/pre>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  // only the indent the lines share is dropped, so the shown lines keep their shape
  assert.deepEqual(shown.map((l) => l.trim()), [wav[120].trim(), wav[122].trim()]);
  assert.ok(shown[0].startsWith('  frames'));
  // the labels are short, and the code and its line numbers are left out of what the lesson check reads as labels
  const texts = sceneTexts(html);
  assert.ok(!texts.some((t) => /\b12[13]\b/.test(t)));
  const sentences = [{ text: 'Our line, your todo is saved, ends at 3.22 and starts at 3.77 after 550 ms.' }, { text: 'So it would start at 4.22.' }];
  const findings = checkLesson({ example: 'the line "your todo is saved"', chapters: [{ id: 'c', sentences, scenes: [html] }] });
  assert.deepEqual(findings, []);
});

test('tutor: the template points at the map scene, and the source chip is a footnote by the old guy', () => {
  const md = fs.readFileSync(path.join(tutor.dir, 'template.md'), 'utf8');
  assert.match(md, /examples\/map\.mjs/);
  assert.doesNotMatch(md, /code-card` replaces the map/);
  const src = fs.readFileSync(path.join(tutor.dir, 'stage.src.html'), 'utf8');
  assert.match(src, /\[data-shape="16:9"\] \.og-chip \{ right: /);
});

test('tutor map: a muted part stays on the line but faint, and a small code size wraps long lines', async () => {
  const { mapScene, lineAt } = await mapModule();
  const line = lineAt(REPO, 'lib/wav.mts', 121, 'frames += gap', '.length / frameBytes');
  assert.equal(line.mute, '.length / frameBytes');
  assert.throws(() => lineAt(REPO, 'lib/wav.mts', 121, 'frames', 'not on this line'), /does not hold/);
  const map = sampleMap(lineAt);
  map.panels[0].code[0] = line;
  map.panels[0].size = 30;
  const html = mapScene(map);
  // the whole line is still there, the unnamed part drawn faint inside it
  assert.match(html, /<b>frames \+= gap<\/b><i class="mute">\.length \/ frameBytes<\/i>;/);
  assert.match(html, /class="code wrap" style="--cs: 30px"/);
  // a key part cannot also be muted
  assert.throws(() => mapScene({ ...map, panels: [{ ...map.panels[0], code: [{ ...line, mute: 'frames += gap.length' }] }] }), /cannot be muted/);
});

test('tutor: the source chip names one file:line and wraps a long path instead of running off', () => {
  const src = fs.readFileSync(path.join(tutor.dir, 'stage.src.html'), 'utf8');
  assert.match(src, /\.og-chip \{[^}]*overflow-wrap: anywhere/);
  assert.doesNotMatch(src, /\.og-chip \{[^}]*white-space: nowrap/);
  const md = fs.readFileSync(path.join(tutor.dir, 'template.md'), 'utf8');
  // the rules the sample follows: the promise first, the chip and the band agree, no value early in code either
  assert.match(md, /first chapter says the promise/i);
  assert.match(md, /chip and the band agree/i);
  assert.match(md, /No value before its sentence, in the code too/);
});

test('tutor map: a worked example on a timeline, a folder card, and code said in plain words beside a picture', async () => {
  const { mapScene, lineAt } = await mapModule();
  const map = sampleMap(lineAt);
  map.tour = 0;
  map.panels = [
    { id: 'folder', at: 1, until: 2, title: 'what a template is', colour: 'var(--og-yellow)',
      folder: { name: 'templates/tutor/', files: [{ name: 'template.json', note: 'the choices' }, { name: 'stage.html', note: 'the page around it' }] } },
    { id: 'code', lane: 'timing', at: 2, until: 3, title: 'zoom', code: [lineAt(REPO, 'lib/wav.mts', 123, 'frames / format.sampleRate')],
      lit: [{ no: 123, at: 2 }], plain: 'time = frames so far ÷ 24,000',
      pic: { items: [{ id: 'new', label: 'new guy' }, { id: 'old', label: 'old guy' }], steps: [{ at: 2, lit: ['old'], dark: ['new'] }] } },
    { id: 'bar', lane: 'timing', at: 3, title: 'timing record',
      bar: { span: [0, 6], blocks: [
        { id: 'q', label: 'the question', from: 0, to: 3.22, tone: 'page', at: 3 },
        { id: 'gap', label: '550 ms', from: 3.22, to: 3.77, tone: 'gap', at: 3 },
      ], marks: [{ id: 'end', t: 3.22, label: 'ends 3.22 s', side: 'before', at: 3 }] } },
  ];
  const html = mapScene(map);
  designPiece.render({ html }, { startS: 0, durationS: 12, idPrefix: 'p0', beatsS: [0.04, 2, 4, 6] });
  // every lane glows in turn on the tour sentence
  assert.ok(html.includes('tl.to("#tm-lane-script-t", {opacity: 1, duration: 0.3}, beat(0) + 0.30);'));
  // the folder's files, the timeline's blocks and marks start hidden and come in on their sentence
  assert.match(html, /#tm-bar-b-q, #tm-bar-b-gap, #tm-bar-m-end, #tm-folder-f0, #tm-folder-f1/);
  assert.ok(html.includes('tl.to("#tm-bar-b-gap", {opacity: 1, duration: 0.3}, beat(3) + 1.00);'));
  // the pause is drawn to scale: 0.55 s of a 6 s span on a 1720 px bar
  assert.match(html, /id="tm-bar-b-gap" class="blk gap" style="left:923px; width:158px;/);
  // the plain words sit under the code, and the picture lights one card and darkens the other
  assert.match(html, /<span>in plain words:<\/span> time = frames so far ÷ 24,000/);
  assert.ok(html.includes('tl.to("#tm-code-p-new", {opacity: 0.18, duration: 0.3}, beat(2) + 0.50);'));
  // a label on screen stays a label
  assert.deepEqual(checkLesson({ example: 'the line "your todo is saved"', chapters: [{ id: 'c', sentences: [
    { text: 'Our line, your todo is saved, starts at 3.77, 550 ms after 3.22.' }, { text: 'So 24,000 frames a second.' }], scenes: [html] }] }), []);
});

test('tutor map: the last scene holds its frame, and a card and a panel cannot share an id', async () => {
  const { mapScene, lineAt } = await mapModule();
  const held = mapScene({ ...sampleMap(lineAt), hold: true });
  // the piece fades out over its last 0.4 s; the held scene keeps it up whichever way the timeline is played
  assert.match(held, /tl\.fromTo\("\.og-design", \{opacity: 0\.999\}, \{opacity: 1, [^)]*\}, endS - 0\.42\);/);
  assert.match(held, /tl\.fromTo\("\.og-design", \{opacity: 0\.999\}, \{opacity: 1, [^)]*\}, endS - 0\.39\);/);
  assert.doesNotMatch(mapScene(sampleMap(lineAt)), /og-design/);
  designPiece.render({ html: held }, { startS: 0, durationS: 12, idPrefix: 'p0', beatsS: [0.04, 2, 4, 6] });
  const clash = sampleMap(lineAt);
  clash.panels[0].id = 'a';
  assert.throws(() => mapScene(clash), /both called a/);
});

test('tutor: template.md keeps the lessons from the first-time viewer', () => {
  const md = fs.readFileSync(path.join(tutor.dir, 'template.md'), 'utf8');
  assert.match(md, /One worked example, with real numbers, in one picture/);
  assert.match(md, /hold it for the whole sentence/);
  assert.match(md, /The what-if covers two settings/);
  assert.match(md, /End on a held recap frame/);
  assert.match(md, /Fill both\s+columns on the same sentence/);
});
