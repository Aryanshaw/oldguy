// The real-life-analogy kit builds scenes that pass oldguy's design-piece guardrails, and its lint catches the rules
// it can read from markup (rules.md): palette, outlines, gradients, words outside cards, one new thing per sentence.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const RLA = require('../templates/real-life-analogy/kit/kit.js');
const design = require('../scene-kit/design.mts');

const DIR = path.join(__dirname, '..', 'templates', 'real-life-analogy');

// A small scene using every kind of kit call: setting, person, prop, card with strings, chalk, camera.
function sampleScene() {
  const sc = RLA.scene({ id: 'kit-test', ground: 'indigo' });
  sc.set(RLA.prop('curtain', { id: 'k-curtain' }).svg);
  const actor = RLA.cast('actor', { id: 'k-actor', x: 700, y: 834, s: 0.8, pose: 'hold', holding: { prop: 'paper', s: 0.4 } });
  sc.add(0, actor, { focus: true, delay: 0.4 });
  const card = RLA.card({ id: 'k-card', x: 900, y: 120, title: ['our line:', 'your todo is saved'], lines: ['"voice_speed": 0.95,'], file: 'template.json · line 21', hl: { line: 0, word: '0.95' } });
  sc.add(1, card, { focus: { x: 860, y: 400, r: 100 } });
  sc.add(1, RLA.strings({ id: 'k-card-str', from: card.bottom(2), to: [860, 360] }), { extra: true });
  sc.add(2, RLA.prop('clock', { id: 'k-clock', x: 1400, y: 500, s: 0.7 }), { focus: true });
  sc.add(2, RLA.sight({ id: 'k-sight', from: actor.anchors.eye, to: [1330, 500] }), { extra: true });
  sc.camera(2, { x: 1200, y: 500, zoom: 1.1 });
  return sc.build();
}

test('real-life-analogy: a kit scene has no rule problems and passes the design-piece checks', () => {
  const { html, problems } = sampleScene();
  assert.deepStrictEqual(problems, []);
  const r = design.render({ html }, { startS: 0, durationS: 12, idPrefix: 'p0', beatsS: [0.05, 4, 8] });
  assert.ok(r.html.includes('rla-card'), 'the card is in the rendered piece');
  assert.ok(r.timeline.includes('strokeDashoffset'), 'chalk draws itself on');
});

test('real-life-analogy: every preset, pose, hair, face and prop builds and lints clean', () => {
  for (const name of Object.keys(RLA.PRESETS)) assert.deepStrictEqual(RLA.lint(RLA.cast(name, { id: `t-${name}` }).svg), [], name);
  for (const pose of RLA.POSES) for (const hair of RLA.HAIRS) {
    assert.deepStrictEqual(RLA.lint(RLA.person({ id: 't', pose, hair, face: RLA.FACES[hair.length % RLA.FACES.length] }).svg), [], `${pose} ${hair}`);
  }
  assert.ok(RLA.PROPS.length >= 15, 'at least fifteen props');
  for (const name of RLA.PROPS) assert.deepStrictEqual(RLA.lint(RLA.prop(name, { id: `t-${name}` }).svg), [], name);
});

test('real-life-analogy: lint refuses off-palette colours, outlines, gradients and words outside cards', () => {
  assert.match(RLA.lint('<svg><rect fill="#00FF00"/></svg>').join(' '), /not in the palette/);
  assert.match(RLA.lint(`<svg><rect fill="${RLA.P.coral}" stroke="${RLA.P.ink}"/></svg>`).join(' '), /outline/);
  assert.match(RLA.lint('<svg><linearGradient id="g"/></svg>').join(' '), /gradient/);
  assert.match(RLA.lint('<svg><text>hello</text></svg>').join(' '), /<text>/);
  assert.match(RLA.lint('<div>loose words</div>').join(' '), /outside a paper card/);
});

test('real-life-analogy: two new things on one sentence is a problem', () => {
  const sc = RLA.scene({ id: 'kit-two' });
  sc.add(1, RLA.prop('apple', { id: 'a1' }));
  sc.add(1, RLA.prop('book', { id: 'b1' }));
  assert.match(sc.build().problems.join(' '), /sentence 1 brings in 2 new things/);
});

test('real-life-analogy: stage.html is the one build-stage.mjs writes, with the font inline', () => {
  const stage = fs.readFileSync(path.join(DIR, 'stage.html'), 'utf8');
  assert.ok(stage.includes("font-family: 'RLA Hand'") && stage.includes('data:font/woff2;base64,'));
  assert.ok(stage.includes(RLA.CSS), 'stage.html carries the kit CSS as kit.js writes it now');
  assert.ok(fs.existsSync(path.join(DIR, 'kit', 'fonts', 'OFL.txt')), 'the font licence ships with the font');
});
