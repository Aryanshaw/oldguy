const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const CLI = path.join(__dirname, '..', 'bin', 'yap.cjs');
const NAMES = ['doctor', 'audit', 'beats', 'captions', 'pad-wav', 'scaffold', 'render', 'narrate'];

// Runs the CLI with the given arguments and returns the finished process result.
function yap(...args) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
}

test('--help exits 0 and lists all eight commands', () => {
  const r = yap('--help');
  assert.equal(r.status, 0);
  for (const name of NAMES) assert.match(r.stdout, new RegExp(`^\\s*${name}\\s`, 'm'));
});

test('no arguments prints the same help and exits 0', () => {
  const r = yap();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /doctor/);
});

test('unknown command exits 2 with a one-line usage message on stderr', () => {
  const r = yap('bogus');
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /usage/i);
});

// doctor is left out: with no arguments it is a real run (it calls ffmpeg and hyperframes), which tests must not do.
test('every command except doctor, given no arguments, exits 2 with a usage line on stderr', () => {
  for (const name of NAMES.filter((n) => n !== 'doctor')) {
    const r = yap(name);
    assert.equal(r.status, 2, name);
    assert.match(r.stderr, /usage: yap /, name);
    assert.doesNotMatch(r.stderr, /not implemented/, name);
  }
});

// Makes a temp folder for one test and removes it when the test ends.
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A scaffold spec with one framing sentence and one claim about app.js line 1.
const SPEC = {
  id: 'What if it fails?',
  title: 'What if it fails?',
  sources: [{ id: 's1', file: 'app.js', lines: [1, 1], quote: 'start()' }],
  sentences: [
    { text: 'Here is what happens.', kind: 'framing', source_ids: [] },
    { text: 'It calls start.', kind: 'claim', source_ids: ['s1'] },
  ],
  scene: [{ piece: 'callout', params: { text: 'start()', pointTo: 'up' }, beat: 1 }],
};

test('scaffold --help documents the spec, the four pieces and the four callout directions', () => {
  const r = yap('scaffold', '--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^usage: yap scaffold <spec.json> --root <dir>/);
  for (const word of ['title', 'steps', 'code-card', 'callout', 'beat', 'up|down|left|right']) assert.ok(r.stdout.includes(word), word);
});

test('scaffold creates the chapter, prints its folder, and refuses a second run with exit 1', (t) => {
  const root = tempDir(t);
  const specFile = path.join(root, 'spec.json');
  fs.writeFileSync(specFile, JSON.stringify(SPEC));
  const r = yap('scaffold', specFile, '--root', root);
  assert.equal(r.status, 0, r.stderr);
  const dir = path.join(root, 'chapters', 'what-if-it-fails');
  assert.equal(r.stdout, `${dir}\n`);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['chapter.json', 'narration.txt']);
  const again = yap('scaffold', specFile, '--root', root);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /^yap scaffold: .*already exists/);
});

test('scaffold with a bad callout direction exits 1 naming the allowed ones', (t) => {
  const root = tempDir(t);
  const specFile = path.join(root, 'spec.json');
  fs.writeFileSync(specFile, JSON.stringify({ ...SPEC, scene: [{ piece: 'callout', params: { text: 'x', pointTo: 'north' }, beat: 0 }] }));
  const r = yap('scaffold', specFile, '--root', root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pointTo.*up, down, left, right/);
});

test('narrate on a folder with no chapter.json is a usage error', (t) => {
  const r = yap('narrate', tempDir(t));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no chapter.json/);
});

// Lays out a repo with app.js and a chapters folder holding one good narrated chapter and one that fails the audit.
function renderWorkspace(t, { withBad = true } = {}) {
  const base = tempDir(t);
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'app.js'), 'start()\n');
  const chapters = path.join(base, 'chapters');
  const write = (id, quote) => {
    fs.mkdirSync(path.join(chapters, id), { recursive: true });
    const sources = [{ ...SPEC.sources[0], quote }];
    fs.writeFileSync(path.join(chapters, id, 'chapter.json'), JSON.stringify({ ...SPEC, id, sources }));
    fs.writeFileSync(path.join(chapters, id, 'index.html'), '<!doctype html>');
  };
  write('good', 'start()');
  if (withBad) write('bad', 'stop()');
  return { repo, chapters };
}

test('render --dry-run prints the render command for passing chapters and fails the unaudited one', (t) => {
  const { repo, chapters } = renderWorkspace(t);
  const r = yap('render', chapters, '--root', repo, '--cap', '2', '--dry-run');
  assert.equal(r.status, 1, r.stderr);
  const good = path.join(chapters, 'good');
  assert.ok(r.stdout.includes(`would run: npx hyperframes render ${good} -q draft -w 2 -o ${path.join(good, 'chapter.mp4')}\n`), r.stdout);
  assert.doesNotMatch(r.stdout, /would run: .*bad/);
  assert.match(r.stdout, /^bad: failed \(audit: s1: quote not on lines 1-1\)$/m);
  assert.match(r.stdout, /^good: ready$/m);
  assert.match(r.stdout, /up to 2 at a time/);
});

test('render --dry-run exits 0 when every chapter is ready, with the cap taken from free memory', (t) => {
  const { repo, chapters } = renderWorkspace(t, { withBad: false });
  const r = yap('render', chapters, '--root', repo, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /up to [123] at a time/);
  assert.match(r.stdout, /^good: ready$/m);
});

test('render usage errors exit 2: no --root, a bad --cap, a missing folder', (t) => {
  const { repo, chapters } = renderWorkspace(t);
  assert.equal(yap('render', chapters, '--dry-run').status, 2);
  assert.equal(yap('render', chapters, '--root', repo, '--cap', '0', '--dry-run').status, 2);
  assert.equal(yap('render', path.join(chapters, 'nope'), '--root', repo, '--dry-run').status, 2);
});

test('render with no chapters in the folder exits 1 rather than claiming success', (t) => {
  const empty = tempDir(t);
  const r = yap('render', empty, '--root', empty, '--dry-run');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no chapters/);
});
