const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitSentences } = require('../lib/sentences.cjs');
const { beatsFromDuration, beatsFromWords } = require('../lib/beats.cjs');

const FIX = path.join(__dirname, 'fixtures');
const narration = fs.readFileSync(path.join(FIX, 'narration.txt'), 'utf8');
const words = JSON.parse(fs.readFileSync(path.join(FIX, 'transcript.json'), 'utf8'));
const sentences = splitSentences(narration);

// Checks that beats are in order and never overlap or run backwards.
function assertOrdered(beats) {
  beats.forEach((b, i) => {
    assert.ok(b.end >= b.start, `beat ${i} runs backwards`);
    if (i > 0) assert.ok(b.start >= beats[i - 1].end, `beat ${i} overlaps the one before`);
  });
}

test('character-share fallback ends sentences at 2.22 / 6.60 / 9.30', () => {
  const beats = beatsFromDuration(sentences, 9.301, { leadS: 0 });
  assert.equal(beats.length, 3);
  [2.22, 6.6, 9.3].forEach((end, i) => assert.ok(Math.abs(beats[i].end - end) <= 0.02, `end ${i}: ${beats[i].end}`));
  assert.equal(beats[0].start, 0);
  assert.deepEqual(beats.map((b) => b.text), sentences);
  assertOrdered(beats);
});

test('word-based beats end at the transcript times 2.30 / 6.92 / 9.42', () => {
  const beats = beatsFromWords(sentences, words, { leadS: 0 });
  assert.equal(beats.length, 3);
  [2.3, 6.92, 9.42].forEach((end, i) => assert.ok(Math.abs(beats[i].end - end) <= 0.01, `end ${i}: ${beats[i].end}`));
  assert.deepEqual(beats.map((b) => b.text), sentences);
  assertOrdered(beats);
});

test('a transcript with one merged word still gives 3 ordered beats', () => {
  // glue "pending" and "row" into one word, as speech recognition sometimes does
  const at = words.findIndex((w) => w.text === 'pending');
  const merged = words.slice();
  merged.splice(at, 2, { text: 'pendingrow', start: words[at].start, end: words[at + 1].end });
  const beats = beatsFromWords(sentences, merged, { leadS: 0 });
  assert.equal(beats.length, 3);
  assertOrdered(beats);
  [2.3, 6.92, 9.42].forEach((end, i) => assert.ok(Math.abs(beats[i].end - end) <= 0.01, `end ${i}: ${beats[i].end}`));
});

test('a transcript with one split word still gives 3 ordered beats', () => {
  // cut "database." into two words
  const at = words.findIndex((w) => w.text === 'database.');
  const split = words.slice();
  const mid = (words[at].start + words[at].end) / 2;
  split.splice(at, 1, { text: 'data', start: words[at].start, end: mid }, { text: 'base.', start: mid, end: words[at].end });
  const beats = beatsFromWords(sentences, split, { leadS: 0 });
  assert.equal(beats.length, 3);
  assertOrdered(beats);
  assert.ok(Math.abs(beats[1].end - 6.92) <= 0.01);
});

test('leadS shifts every time in both methods', () => {
  for (const make of [
    (o) => beatsFromDuration(sentences, 9.301, o),
    (o) => beatsFromWords(sentences, words, o),
  ]) {
    const base = make({ leadS: 0 });
    const shifted = make({ leadS: 0.5 });
    base.forEach((b, i) => {
      assert.ok(Math.abs(shifted[i].start - (b.start + 0.5)) < 1e-9);
      assert.ok(Math.abs(shifted[i].end - (b.end + 0.5)) < 1e-9);
    });
  }
});

test('word beats fail clearly when there are no words', () => {
  assert.throws(() => beatsFromWords(sentences, [], { leadS: 0 }), /no words/i);
});
