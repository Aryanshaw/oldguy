'use strict';
// Tests for the code-card part of the audit: every line shown on a card must be the repository's line, or a visible
// cut of it ending in "…", so what the viewer sees is what the code says.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { audit } = require('../lib/audit.cjs');
const codeCard = require('../scene-kit/code-card.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'yap.cjs');
const LONG = '  return a + b; // adds the two numbers together and returns the sum to the caller right away';
const APP = ['function add(a, b) {', LONG, '}', '\tconst x = 1;', ''].join('\n');

// Makes a temp repo holding src/app.js (and a file outside it), removed after the test.
function repo(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-card-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), APP);
  fs.writeFileSync(path.join(base, 'outside.js'), APP);
  return root;
}

// Audits a chapter with no sources or sentences and one code-card piece showing the given lines of a file.
function auditCard(root, lines, file = 'src/app.js') {
  const scene = [{ piece: 'title', params: { heading: 'Hi' }, beat: 0 }, { piece: 'code-card', params: { file, lines }, beat: 1 }];
  return audit({ root, sources: [], sentences: [], scene });
}

// The "id: reason" lines the CLI would print for a result.
const lines = (r) => r.failures.map((f) => `${f.id}: ${f.reason}`);

test('a line shown exactly as in the file passes, trailing spaces aside', (t) => {
  const root = repo(t);
  assert.deepEqual(auditCard(root, [{ no: 1, text: 'function add(a, b) {   ' }, { no: 3, text: '}', highlight: true }]), { ok: true, failures: [] });
});

test('a changed word fails as text differs from the repository line', (t) => {
  const r = auditCard(repo(t), [{ no: 1, text: 'function sum(a, b) {' }]);
  assert.deepEqual(lines(r), ['scene[1] line 1: text differs from the repository line']);
});

test('the right text under the wrong line number fails; a number past the end says so', (t) => {
  const root = repo(t);
  assert.deepEqual(lines(auditCard(root, [{ no: 3, text: 'function add(a, b) {' }])), ['scene[1] line 3: text differs from the repository line']);
  assert.deepEqual(lines(auditCard(root, [{ no: 9, text: '}' }])), ['scene[1] line 9: line number past end of file (4 lines)']);
});

test('a cut line ending in … passes when it is a prefix of a longer line', (t) => {
  assert.equal(auditCard(repo(t), [{ no: 2, text: '  return a + b; // adds the two…' }]).ok, true);
});

test('a cut line that is not a prefix, has no …, or is not really shorter fails with its own reason', (t) => {
  const root = repo(t);
  assert.deepEqual(lines(auditCard(root, [{ no: 2, text: '  return a - b; // adds…' }])), ['scene[1] line 2: text differs from the repository line']);
  assert.deepEqual(lines(auditCard(root, [{ no: 2, text: '  return a + b; // adds the two' }])), ['scene[1] line 2: truncated without …']);
  assert.deepEqual(lines(auditCard(root, [{ no: 1, text: 'function add(a, b) {…' }])), ['scene[1] line 1: … but line is not longer']);
});

test('leading indentation must match; a tab equals four spaces', (t) => {
  const root = repo(t);
  assert.deepEqual(lines(auditCard(root, [{ no: 2, text: 'return a + b;…' }])), ['scene[1] line 2: text differs from the repository line']);
  assert.equal(auditCard(root, [{ no: 4, text: '\tconst x = 1;' }, { no: 4, text: '    const x = 1;' }]).ok, true);
  assert.equal(auditCard(root, [{ no: 4, text: '  const x = 1;' }]).ok, false);
});

test('a file outside the root, a symlink out of it, or a missing file fails once for the card', (t) => {
  const root = repo(t);
  assert.deepEqual(lines(auditCard(root, [{ no: 1, text: 'x' }], '../outside.js')), ['scene[1]: file outside root: ../outside.js']);
  fs.symlinkSync(path.join(root, '..', 'outside.js'), path.join(root, 'src', 'link.js'));
  assert.deepEqual(lines(auditCard(root, [{ no: 1, text: 'x' }], 'src/link.js')), ['scene[1]: file outside root: src/link.js']);
  assert.deepEqual(lines(auditCard(root, [{ no: 1, text: 'x' }], 'src/nope.js')), ['scene[1]: file not found: src/nope.js']);
});

test('a CRLF file passes for lines copied without the CR', (t) => {
  const root = repo(t);
  fs.writeFileSync(path.join(root, 'src', 'crlf.js'), APP.replace(/\n/g, '\r\n'));
  assert.equal(auditCard(root, [{ no: 1, text: 'function add(a, b) {' }, { no: 2, text: '  return a + b;…' }], 'src/crlf.js').ok, true);
});

test('missing or malformed params fail with a clear line instead of crashing', (t) => {
  const root = repo(t);
  const bare = audit({ root, sources: [], sentences: [], scene: [{ piece: 'code-card', beat: 0 }] });
  assert.deepEqual(lines(bare), ['scene[0]: code-card needs params with "file" and "lines"']);
  const noLines = audit({ root, sources: [], sentences: [], scene: [{ piece: 'code-card', params: { file: 'src/app.js' }, beat: 0 }] });
  assert.deepEqual(lines(noLines), ['scene[0]: code-card needs params with "file" and "lines"']);
  const bad = auditCard(root, [null, { text: '}' }, { no: 1 }]);
  assert.deepEqual(lines(bad), [
    'scene[1] lines[0]: needs a whole line number "no" and "text"',
    'scene[1] lines[1]: needs a whole line number "no" and "text"',
    'scene[1] lines[2]: needs a whole line number "no" and "text"',
  ]);
});

test('claims and sources are audited exactly as before alongside the cards', (t) => {
  const root = repo(t);
  const r = audit({
    root,
    sources: [{ id: 's1', file: 'src/app.js', lines: [1, 1], quote: 'function add' }],
    sentences: [{ text: 'It adds.', kind: 'claim', source_ids: ['s1'] }, { text: 'Hi.', kind: 'claim', source_ids: [] }],
    scene: [{ piece: 'code-card', params: { file: 'src/app.js', lines: [{ no: 1, text: 'function add(a, b) {' }] }, beat: 0 }],
  });
  assert.deepEqual(lines(r), ['sentence 1: claim has no source ids']);
});

test('a legitimate card over the todo-app fixture passes the audit and fits the card', () => {
  const root = path.join(__dirname, '..', 'fixtures', 'todo-app');
  const card = [
    { no: 9, text: '  const todos = loadTodos();' },
    { no: 10, text: '  const id = todos.length === 0 ? 1 : Math.max(…' },
    { no: 11, text: '  const todo = { id, title: text, done: false,…', highlight: true },
    { no: 12, text: '  todos.push(todo);' },
  ];
  assert.deepEqual(auditCard(root, card, 'add.js'), { ok: true, failures: [] });
  assert.doesNotThrow(() => codeCard.render({ file: 'add.js', lines: card }, { startS: 0, durationS: 1 }));
});

test('yap audit prints one scene line per card problem and exits 1', (t) => {
  const root = repo(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-card-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'chapter.json');
  const scene = [{ piece: 'code-card', params: { file: 'src/app.js', lines: [{ no: 1, text: 'function sum(a, b) {' }, { no: 3, text: '}' }] }, beat: 0 }];
  fs.writeFileSync(file, JSON.stringify({ sources: [], sentences: [], scene }));
  const r = spawnSync('node', [CLI, 'audit', file, '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, 'scene[0] line 1: text differs from the repository line\n');
});
