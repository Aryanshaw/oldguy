'use strict';
// Every template folder that ships under templates/ is held to the same rules: it loads, its stage has a slot and only
// known markers, its assets are present or downloadable, its script rules end with a Gate line, and the stage driver
// builds a page in every shape it lists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listTemplates, templateIds, templatesRoot, SHAPES } = require('../lib/template.mts');
const { buildStagePage, splitStage } = require('../lib/stage.mts');
const { estimateWords } = require('../lib/word-times.mts');

const ROOT = path.join(__dirname, '..', 'templates');

// A two-line timing using the template's own speakers (or the narrator), with one claim.
function sampleTiming(t) {
  const who = (i) => (t.speakers.length ? t.speakers[i % t.speakers.length].id : undefined);
  const lines = [
    { text: 'How does a request get checked?', start: 0.04, end: 2, kind: 'framing', chips: [] },
    { text: 'Every source goes through a check first.', start: 2.12, end: 5, kind: 'claim', chips: ['lib/audit.mts:100'] },
  ].map((l, i) => (who(i) ? { ...l, speaker: who(i) } : l));
  return { durationS: 5.2, lines, words: estimateWords(lines) };
}

test('the shipped templates folder is the default templates root', () => {
  if (process.env.OLDGUY_TEMPLATES_DIR) return;
  assert.equal(templatesRoot(), ROOT);
});

test('every folder under templates/ is a template that loads', () => {
  const folders = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual([...templateIds(ROOT)].sort(), folders, 'every folder holds a template.json');
  assert.equal(listTemplates(ROOT).length, folders.length);
  assert.ok(folders.includes('explainer'));
});

for (const t of listTemplates(ROOT)) {
  test(`${t.id}: its stage has the slot and only known markers`, () => {
    assert.doesNotThrow(() => splitStage(fs.readFileSync(path.join(t.dir, 'stage.html'), 'utf8')));
  });

  test(`${t.id}: template.md ends with a Gate line`, () => {
    const last = fs.readFileSync(path.join(t.dir, 'template.md'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).pop();
    assert.match(last, /^\*\*Gate:\*\*/);
  });

  test(`${t.id}: every asset ships in the folder or is listed for download with sha256 and bytes`, () => {
    for (const a of t.assets) {
      if (a.url === undefined) assert.ok(fs.existsSync(path.join(t.dir, a.path)), a.path);
      else assert.ok(/^[0-9a-f]{64}$/.test(a.sha256) && a.bytes > 0, a.path);
    }
  });

  test(`${t.id}: the stage driver builds a page in every shape it lists`, () => {
    for (const shape of t.shapes) {
      const page = buildStagePage({ id: 'sample', template: t, shape, timing: sampleTiming(t), pieces: [
        { piece: 'title', params: { heading: 'Checks' }, startS: 0, durationS: 5.2, beatsS: [0.04, 2.12] },
      ] });
      const { width, height } = SHAPES[shape];
      assert.ok(page.includes(`data-width="${width}" data-height="${height}"`), `${shape} root size`);
      for (const s of t.speakers) assert.ok(page.includes(`id="og-sp-${s.id}"`), `${shape} draws ${s.id}`);
    }
  });
}
