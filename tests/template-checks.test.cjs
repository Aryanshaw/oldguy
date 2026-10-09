'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkAgainstTemplate, spokenWords } = require('../lib/template-checks.mts');
const { loadTemplate } = require('../lib/template.mts');
const { scaffoldChapter } = require('../lib/chapter.mts');
const { audit } = require('../lib/audit.mts');
const { writeVideoChoice } = require('../lib/settings.mts');

const REPO = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'templates');
const DUO = loadTemplate('duo', FIXTURES);
const EXPLAINER = loadTemplate('explainer', FIXTURES);
const BIN = path.join(REPO, 'bin', 'oldguy.cjs');
const SPIKE = path.join(REPO, 'spikes', '08-templates');

// Makes an empty temp folder for one test and removes it when the test ends.
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-tchecks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Runs the oldguy command and returns its exit code and output.
function oldguy(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const line = (speaker, text, kind = 'framing') => ({ speaker, text, kind, source_ids: kind === 'claim' ? ['s1'] : [] });

test('a speaker the template does not have is refused, naming the ones it has', () => {
  const found = checkAgainstTemplate([line('kid', 'Why?'), line('mum', 'Because.')], [], DUO);
  assert.deepEqual(found, [{ id: 'sentence 1', reason: 'unknown speaker "mum"; template duo has kid, dad' }]);
});

test('with speakers, every sentence needs one; a narrator-only template refuses any', () => {
  assert.match(checkAgainstTemplate([{ text: 'Hi.', kind: 'framing' }], [], DUO)[0].reason, /needs a "speaker": one of kid, dad/);
  assert.match(checkAgainstTemplate([line('kid', 'Hi.')], [], EXPLAINER)[0].reason, /narrator only; remove "speaker"/);
  assert.deepEqual(checkAgainstTemplate([{ text: 'Hi there.', kind: 'framing' }], [], EXPLAINER), []);
});

test('13 words against a cap of 12 fails (the spike case); 12 passes', () => {
  const thirteen = 'So when Claude answers in the chat, does it just make up numbers?';
  assert.equal(thirteen.split(' ').length, 13);
  assert.deepEqual(checkAgainstTemplate([line('kid', thirteen)], [], DUO), [{ id: 'sentence 0', reason: '13 words; template duo allows 12 per line' }]);
  assert.deepEqual(checkAgainstTemplate([line('kid', 'one two three four five six seven eight nine ten eleven twelve.')], [], DUO), []);
});

test('explainer has no cap, so a long sentence still passes', () => {
  const long = `${'word '.repeat(60)}end.`;
  assert.deepEqual(checkAgainstTemplate([{ text: long, kind: 'framing' }], [], EXPLAINER), []);
});

test('a keyword anchor must be one word that is in its sentence', () => {
  const sentences = [line('kid', 'Is the reply checked?'), line('dad', 'Every source goes through a check first.', 'claim')];
  assert.deepEqual(checkAgainstTemplate(sentences, [{ piece: 'title', beat: 1, word: 'Check' }], DUO), []);
  assert.match(checkAgainstTemplate(sentences, [{ piece: 'title', beat: 1, word: 'refused' }], DUO)[0].reason, /"refused" is not in sentence 1/);
  assert.match(checkAgainstTemplate(sentences, [{ piece: 'title', beat: 1, word: 'a check' }], DUO)[0].reason, /must be one word/);
});

test('spokenWords drops the punctuation around words and keeps words with marks inside', () => {
  assert.deepEqual(spokenWords('Hi, "you" — what\'s `app.run()`?'), ['hi', 'you', "what's", 'app.run']);
});

test('scaffold refuses a chapter that breaks the template, and passes one that keeps it', (t) => {
  const root = tempDir(t);
  const base = { root, id: 'Why lines', title: 'Why lines', sources: [{ id: 's1', file: 'a.js', lines: [1, 1], quote: 'x' }], scene: [{ piece: 'title', params: { heading: 'Lines' }, beat: 0 }] };
  assert.throws(() => scaffoldChapter({ ...base, sentences: [line('mum', 'Hello there.')], template: DUO }), /sentence 0: unknown speaker "mum"/);
  const dir = scaffoldChapter({ ...base, sentences: [line('kid', 'Hello there.'), line('dad', 'Hi back.', 'claim')], template: DUO });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8')).sentences[0].speaker, 'kid');
});

test('the audit adds the template rules and keeps the claim rule under every template', () => {
  const sentences = [line('mum', 'Why?'), { speaker: 'dad', text: 'It just is.', kind: 'claim', source_ids: [] }];
  const r = audit({ root: REPO, sources: [], sentences, template: DUO });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.id === 'sentence 1' && f.reason === 'claim has no source ids'), 'the claim rule still holds');
  assert.ok(r.failures.some((f) => f.id === 'sentence 0' && /unknown speaker "mum"/.test(f.reason)));
  assert.equal(audit({ root: REPO, sources: [], sentences: [{ text: 'Hi.', kind: 'framing', source_ids: [] }] }).ok, true, 'no template, no extra rules');
});

// A temp templates folder holding the spike's peter-and-stewie template.json, with the files a template needs.
function spikeTemplate(t) {
  const root = tempDir(t);
  const dir = path.join(root, 'peter-and-stewie');
  fs.mkdirSync(dir);
  const raw = JSON.parse(fs.readFileSync(path.join(SPIKE, 'template', 'template.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'template.json'), JSON.stringify({ version: 1, assets: [], ...raw }));
  fs.writeFileSync(path.join(dir, 'template.md'), '# spike\n');
  fs.writeFileSync(path.join(dir, 'stage.html'), '<!-- oldguy:slot -->\n');
  return dir;
}

// A copy of the spike chapter whose citation of lib/audit.mts points at wherever its quoted line sits today, so editing
// audit.mts does not break this test.
function spikeChapter(t) {
  const chapter = JSON.parse(fs.readFileSync(path.join(SPIKE, 'chapter.json'), 'utf8'));
  const auditLines = fs.readFileSync(path.join(REPO, 'lib', 'audit.mts'), 'utf8').split('\n');
  for (const s of chapter.sources.filter((x) => x.file === 'lib/audit.mts')) {
    const n = auditLines.findIndex((l) => l.includes(s.quote)) + 1;
    s.lines = [n, n];
  }
  const file = path.join(tempDir(t), 'chapter.json');
  fs.writeFileSync(file, JSON.stringify(chapter));
  return file;
}

test('oldguy audit: the spike chapter passes its template except its 14-word first line', (t) => {
  const r = oldguy(['audit', spikeChapter(t), '--root', REPO, '--template', spikeTemplate(t)]);
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stdout, 'sentence 0: 14 words; template peter-and-stewie allows 12 per line\n');
});

test('oldguy audit: the spike chapter with a claim stripped of its sources still fails, template or not', (t) => {
  const file = spikeChapter(t);
  const chapter = JSON.parse(fs.readFileSync(file, 'utf8'));
  chapter.sentences[1].source_ids = [];
  fs.writeFileSync(file, JSON.stringify(chapter));
  const r = oldguy(['audit', file, '--root', REPO, '--template', spikeTemplate(t)]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /sentence 1: claim has no source ids/);
});

test('oldguy audit: a chapter in a video folder is held to that video\'s template', (t) => {
  const slugDir = tempDir(t);
  const chapterDir = path.join(slugDir, 'chapters', 'intro');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.writeFileSync(path.join(chapterDir, 'chapter.json'), JSON.stringify({ sources: [], sentences: [line('kid', 'Hello.')], scene: [] }));
  // no video.json: explainer, which has no speakers
  assert.match(oldguy(['audit', path.join(chapterDir, 'chapter.json'), '--root', REPO]).stdout, /narrator only/);
  writeVideoChoice(slugDir, { template: 'explainer', shape: '9:16' });
  assert.equal(oldguy(['audit', path.join(chapterDir, 'chapter.json'), '--root', REPO, '--template', path.join(FIXTURES, 'duo')]).code, 0);
});

test('oldguy audit: an unknown template is a usage error that lists the real ones', () => {
  const r = oldguy(['audit', path.join(SPIKE, 'chapter.json'), '--root', REPO, '--template', 'nope']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown template "nope"; use one of explainer/);
});
