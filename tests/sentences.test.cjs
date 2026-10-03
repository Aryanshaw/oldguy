'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitSentences } = require('../lib/sentences.mts');

// shorthand: how many sentences a text splits into
const count = (t) => splitSentences(t).length;

test('spike-3 narration gives exactly 3 sentences', () => {
  const t = fs.readFileSync(path.join(__dirname, 'fixtures', 'narration.txt'), 'utf8');
  const s = splitSentences(t);
  assert.equal(s.length, 3);
  assert.equal(s[0], 'A job starts when you press a button.');
});

test('abbreviations do not split', () => {
  const s = splitSentences('Use e.g. a queue. It is fast.');
  assert.deepEqual(s, ['Use e.g. a queue.', 'It is fast.']);
  assert.equal(count('Compare it vs. Redis for speed. Done.'), 2);
});

test('version numbers do not split', () => {
  assert.deepEqual(splitSentences('Version v1.0 ships. Then 3.5 seconds pass.'),
    ['Version v1.0 ships.', 'Then 3.5 seconds pass.']);
});

test('file names and paths do not split', () => {
  assert.deepEqual(splitSentences('It lives in api/app/jobs.py. Open it.'),
    ['It lives in api/app/jobs.py.', 'Open it.']);
});

test('ellipsis stays inside a sentence', () => {
  assert.deepEqual(splitSentences('Wait... then go. Done.'), ['Wait... then go.', 'Done.']);
  assert.equal(count('Wait... Then go.'), 1);
});

test('closing quote after the full stop still splits', () => {
  assert.deepEqual(splitSentences('She said "Stop." Then left.'), ['She said "Stop."', 'Then left.']);
});

test('closing parenthesis after the full stop still splits', () => {
  assert.deepEqual(splitSentences('He said (stop.) Then left.'), ['He said (stop.)', 'Then left.']);
});

test('backticked code with a period stays inside its sentence', () => {
  const s = splitSentences('`call foo.bar() now. Then stop.` Then go.');
  assert.deepEqual(s, ['`call foo.bar() now. Then stop.` Then go.']);
  const t = splitSentences('Run `call foo.bar() now. Then stop.` Next. Done.');
  assert.equal(t.length, 2);
  assert.ok(t[0].includes('`call foo.bar() now. Then stop.`'));
  assert.equal(count('`call foo.bar() now. Then stop.`'), 1);
});

test('a digit or question mark / exclamation also splits', () => {
  assert.deepEqual(splitSentences('Really? Yes! 3 apps ship.'), ['Really?', 'Yes!', '3 apps ship.']);
});

test('single sentence without final punctuation gives 1', () => {
  assert.deepEqual(splitSentences('just one thought here'), ['just one thought here']);
});

test('empty and whitespace-only give []', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences('  \n\t '), []);
});

test('newlines inside a sentence act as spaces', () => {
  assert.deepEqual(splitSentences('One line\nand another.\nNext one.'), ['One line and another.', 'Next one.']);
});

test('is deterministic and never throws on odd input', () => {
  for (const odd of ['...', '?!?!', '. . .', '`', '``` ` ``', '"', '😀. 😀! Ok.', '\u0000', '.']) {
    assert.doesNotThrow(() => splitSentences(odd));
    assert.deepEqual(splitSentences(odd), splitSentences(odd));
  }
  assert.deepEqual(splitSentences('😀. Then 😀 ok.'), ['😀.', 'Then 😀 ok.']);
});

test('50k characters of text runs in well under a second', () => {
  const big = 'This is a fairly normal sentence. '.repeat(1500).slice(0, 50000);
  const t0 = Date.now();
  const out = splitSentences(big);
  assert.ok(Date.now() - t0 < 500);
  assert.ok(out.length > 1000);
  const punct = '.'.repeat(50000);
  const t1 = Date.now();
  splitSentences(punct);
  splitSentences('`'.repeat(50000));
  splitSentences('a. '.repeat(16000));
  assert.ok(Date.now() - t1 < 500);
});

test('plain text with a dotted call inside splits into 2, call intact', () => {
  assert.deepEqual(splitSentences('call foo.bar() now. Then stop.'), ['call foo.bar() now.', 'Then stop.']);
});
