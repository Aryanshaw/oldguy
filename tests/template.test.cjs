'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  loadTemplate, listTemplates, validateTemplate, templateIds, voiceFor, slotBox, SHAPES, DEFAULT_TEMPLATE,
} = require('../lib/template.mts');
const { KOKORO_VOICES, parseVoiceList } = require('../lib/voices.mts');

const FIXTURES = path.join(__dirname, 'fixtures', 'templates');
const DUO = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'duo', 'template.json'), 'utf8'));

// Copies the duo fixture into a temp templates folder, with template.json changed by `edit`, and returns that folder.
function duoWith(t, edit) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-template-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(FIXTURES, 'duo'), path.join(root, 'duo'), { recursive: true });
  const raw = structuredClone(DUO);
  edit(raw);
  fs.writeFileSync(path.join(root, 'duo', 'template.json'), JSON.stringify(raw));
  return root;
}

// The problems validateTemplate finds in the duo fixture after `edit`.
function problems(t, edit) {
  const root = duoWith(t, edit);
  return validateTemplate(JSON.parse(fs.readFileSync(path.join(root, 'duo', 'template.json'), 'utf8')), path.join(root, 'duo'));
}

test('the duo fixture loads with its speakers, pace and slots', () => {
  const t = loadTemplate('duo', FIXTURES);
  assert.equal(t.id, 'duo');
  assert.equal(t.version, 2);
  assert.deepEqual(t.speakers.map((s) => s.id), ['kid', 'dad']);
  assert.equal(t.pace.max_words_per_line, 12);
  assert.equal(t.narrator_voice, 'af_heart', 'a template that names no narrator gets the default voice');
  assert.equal(t.dir, path.join(FIXTURES, 'duo'));
});

test('explainer is listed first and the rest by id', () => {
  assert.deepEqual(templateIds(FIXTURES), ['explainer', 'duo']);
  assert.deepEqual(listTemplates(FIXTURES).map((t) => t.id), ['explainer', 'duo']);
});

test('an unknown id names the templates that exist', () => {
  assert.throws(() => loadTemplate('nope', FIXTURES), /unknown template "nope"; use one of explainer, duo/);
});

test('every rule fails on its own, naming the field', (t) => {
  const cases = [
    [(r) => { r.id = 'other'; }, /must match its folder name/],
    [(r) => { r.id = 'Bad Id'; }, /^id must be a slug/],
    [(r) => { r.version = 0; }, /version must be a whole number/],
    [(r) => { r.title = ''; }, /title must be non-empty/],
    [(r) => { r.shapes = []; }, /shapes must be a non-empty list/],
    [(r) => { r.shapes = ['4:3']; }, /shapes must be a non-empty list/],
    [(r) => { r.default_shape = '1:1'; }, /default_shape must be one of the listed shapes/],
    [(r) => { r.speakers[1].id = 'kid'; }, /speakers\[1\]\.id "kid" is a duplicate/],
    [(r) => { r.speakers[0].voice = 'zz_nobody'; }, /speakers\[0\]\.voice "zz_nobody" is not a Kokoro voice/],
    [(r) => { r.speakers[0].side = 'up'; }, /speakers\[0\]\.side/],
    [(r) => { r.speakers[0].image = 'assets/missing.svg'; }, /speakers\[0\]\.image must name a listed asset/],
    [(r) => { r.pace.voice_speed.kid = 3; }, /pace\.voice_speed\.kid must be a number from 0\.5 to 2/],
    [(r) => { r.pace.voice_speed.ghost = 1; }, /pace\.voice_speed\.ghost names no speaker/],
    [(r) => { r.pace.line_gap_ms = 5000; }, /pace\.line_gap_ms/],
    [(r) => { r.pace.max_words_per_line = 2; }, /pace\.max_words_per_line/],
    [(r) => { r.pace.captions = 'big'; }, /pace\.captions must be one of none, line, word/],
    [(r) => { r.pace.visual_beat = 'drum'; }, /pace\.visual_beat/],
    [(r) => { r.pace.chapter_seconds = [60, 30]; }, /pace\.chapter_seconds/],
    [(r) => { r.assets[0].path = '../escape.svg'; }, /assets\[0\]\.path must be a relative path inside/],
    [(r) => { r.assets.push({ path: 'assets/gone.png' }); }, /assets\[4\]: assets\/gone\.png is not in the template folder/],
    [(r) => { r.assets[3].sha256 = 'abc'; }, /assets\[3\]\.sha256/],
    [(r) => { r.assets[3].bytes = 0; }, /assets\[3\]\.bytes/],
    [(r) => { r.assets[3].url = 'http://example.com/x'; }, /assets\[3\]\.url must be an https URL/],
    [(r) => { r.slots['1:1'] = [0, 0, 10, 10]; }, /slots\.1:1 is not one of the template's shapes/],
    [(r) => { r.slots['16:9'] = [1000, 0, 1000, 100]; }, /slots\.16:9 must be \[x, y, width, height\] inside the 1920x1080 frame/],
    [(r) => { r.background = 'assets/none.mp4'; }, /background must name a listed asset/],
    [(r) => { r.narrator_voice = 'nobody'; }, /narrator_voice "nobody" is not a Kokoro voice/],
  ];
  for (const [edit, pattern] of cases) {
    const found = problems(t, edit);
    assert.ok(found.some((p) => pattern.test(p)), `expected ${pattern} in ${JSON.stringify(found)}`);
  }
});

test('the valid fixture has no problems, and a missing stage.html or template.md is one', (t) => {
  assert.deepEqual(problems(t, () => {}), []);
  const root = duoWith(t, () => {});
  fs.rmSync(path.join(root, 'duo', 'stage.html'));
  fs.rmSync(path.join(root, 'duo', 'template.md'));
  assert.throws(() => loadTemplate('duo', root), /stage\.html is missing.*template\.md is missing|template\.md is missing.*stage\.html is missing/);
});

test('a bad template lists every problem at once', (t) => {
  const root = duoWith(t, (r) => { r.version = -1; r.pace.captions = 'big'; });
  assert.throws(() => loadTemplate('duo', root), /version must be.*; pace\.captions/);
});

test('voiceFor gives each speaker its voice and speed, and the narrator a single speed', () => {
  const duo = loadTemplate('duo', FIXTURES);
  assert.deepEqual(voiceFor(duo, 'dad'), { voice: 'am_adam', speed: 1.1 });
  assert.deepEqual(voiceFor(duo, 'kid'), { voice: 'bm_george', speed: 1.15 });
  assert.throws(() => voiceFor(duo, 'mum'), /no speaker "mum"/);
  assert.deepEqual(voiceFor(loadTemplate('explainer', FIXTURES), undefined), { voice: 'af_heart', speed: 1 });
});

test('slotBox uses the template box, or the whole frame', () => {
  const duo = loadTemplate('duo', FIXTURES);
  assert.deepEqual(slotBox(duo, '16:9'), [480, 200, 960, 540]);
  assert.deepEqual(slotBox(loadTemplate('explainer', FIXTURES), '9:16'), [0, 0, 1080, 1920]);
  assert.deepEqual(SHAPES['1:1'], { width: 1440, height: 1440 });
});

test('the shipped templates all load, and the default one exists', () => {
  const shipped = listTemplates();
  assert.ok(shipped.some((t) => t.id === DEFAULT_TEMPLATE));
  const explainer = loadTemplate(DEFAULT_TEMPLATE);
  assert.deepEqual(explainer.speakers, []);
  assert.equal(explainer.pace.captions, 'none');
  assert.equal(explainer.pace.max_words_per_line, undefined, 'explainer puts no cap on a sentence, as today');
});

test('the fixture explainer is a copy of the shipped one', () => {
  for (const name of ['template.json', 'template.md', 'stage.html']) {
    assert.equal(fs.readFileSync(path.join(FIXTURES, 'explainer', name), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'templates', 'explainer', name), 'utf8'), name);
  }
});

test('parseVoiceList reads the ids out of the tts --list table', () => {
  const sample = '  ID                Name\n  ────\n  af_heart           Heart         en-US\n  bm_george          George        en-GB\n  Use any Kokoro voice ID\n';
  assert.deepEqual(parseVoiceList(sample), ['af_heart', 'bm_george']);
});

test('KOKORO_VOICES matches what the pinned Hyperframes lists', { skip: !process.env.OLDGUY_CHECK_VOICES && 'set OLDGUY_CHECK_VOICES=1 (needs the network)' }, () => {
  const out = execFileSync('npx', ['--yes', 'hyperframes@0.8.112', 'tts', '--list'], { encoding: 'utf8' });
  assert.deepEqual(parseVoiceList(out), [...KOKORO_VOICES]);
});
