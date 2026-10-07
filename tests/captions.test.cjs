const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { splitSentences } = require('../lib/sentences.mts');
const { beatsFromWords } = require('../lib/beats.mts');
const { buildCaptions } = require('../lib/captions.mts');

const FIX = path.join(__dirname, 'fixtures');
const CLI = path.join(__dirname, '..', 'bin', 'oldguy.cjs');
const words = JSON.parse(fs.readFileSync(path.join(FIX, 'transcript.json'), 'utf8'));

// Turns "HH:MM:SS.mmm" into seconds.
function seconds(stamp) {
  const [h, m, s] = stamp.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// Reads the cues out of a VTT string as {start, end, text}.
function parseVtt(vtt) {
  return vtt.trim().split(/\n\n+/).slice(1).map((block) => {
    const [time, ...text] = block.split('\n');
    const m = time.match(/^(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})$/);
    assert.ok(m, `bad timing line: ${time}`);
    return { start: seconds(m[1]), end: seconds(m[2]), text: text.join(' ') };
  });
}

// Strips punctuation and case so words can be compared.
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

test('VTT starts with WEBVTT and cues are monotonic and non-overlapping', () => {
  const { vtt } = buildCaptions(words, { maxWords: 7, maxCueS: 3.5 });
  assert.ok(vtt.startsWith('WEBVTT'));
  const cues = parseVtt(vtt);
  assert.ok(cues.length >= 4);
  cues.forEach((c, i) => {
    assert.ok(c.end >= c.start);
    if (i > 0) assert.ok(c.start >= cues[i - 1].end, `cue ${i} overlaps`);
  });
});

test('cue text is exactly the input words, in order, none dropped or invented', () => {
  const cues = parseVtt(buildCaptions(words).vtt);
  const got = cues.flatMap((c) => c.text.split(/\s+/)).map(norm);
  assert.deepEqual(got, words.map((w) => norm(w.text)));
});

test('respects maxWords and never crosses a sentence boundary', () => {
  const { vtt } = buildCaptions(words, { maxWords: 7, maxCueS: 3.5 });
  const cues = parseVtt(vtt);
  cues.forEach((c) => assert.ok(c.text.split(/\s+/).length <= 7));
  // a sentence-final word may only be the last word of its cue
  cues.forEach((c) => {
    const ws = c.text.split(/\s+/);
    ws.slice(0, -1).forEach((w) => assert.doesNotMatch(w, /[.!?]$/, `"${c.text}" crosses a sentence end`));
  });
});

test('respects maxCueS', () => {
  const cues = parseVtt(buildCaptions(words, { maxWords: 50, maxCueS: 1.5 }).vtt);
  cues.forEach((c) => {
    if (c.text.split(/\s+/).length > 1) assert.ok(c.end - c.start <= 1.5 + 0.001, c.text);
  });
});

test('captions json has {text, start, end} per word', () => {
  const { json } = buildCaptions(words);
  assert.equal(json.length, words.length);
  json.forEach((w, i) => {
    assert.deepEqual(Object.keys(w).sort(), ['end', 'start', 'text']);
    assert.equal(w.text, words[i].text);
  });
});

test('beats as input keep sentence boundaries and every word', () => {
  const sentences = splitSentences(fs.readFileSync(path.join(FIX, 'narration.txt'), 'utf8'));
  const beats = beatsFromWords(sentences, words, { leadS: 0 });
  const { vtt, json } = buildCaptions(beats);
  assert.equal(json.length, words.length);
  const cues = parseVtt(vtt);
  cues.forEach((c, i) => {
    if (i > 0) assert.ok(c.start >= cues[i - 1].end);
    c.text.split(/\s+/).slice(0, -1).forEach((w) => assert.doesNotMatch(w, /[.!?]$/));
  });
  assert.deepEqual(cues.flatMap((c) => c.text.split(/\s+/)), sentences.join(' ').split(/\s+/));
});

test('oldguy beats | oldguy captions writes the vtt and json files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-cap-'));
  try {
    const b = spawnSync('node', [CLI, 'beats', path.join(FIX, 'narration.txt'), '--duration', '9.301', '--words', path.join(FIX, 'transcript.json'), '--lead', '0.04'], { encoding: 'utf8' });
    assert.equal(b.status, 0, b.stderr);
    const beats = JSON.parse(b.stdout);
    assert.equal(beats.length, 3);
    assert.ok(Math.abs(beats[0].start - 0.07) < 1e-9);
    const inFile = path.join(dir, 'beats.json');
    fs.writeFileSync(inFile, b.stdout);
    const c = spawnSync('node', [CLI, 'captions', inFile, '--vtt', path.join(dir, 'o.vtt'), '--json', path.join(dir, 'o.json')], { encoding: 'utf8' });
    assert.equal(c.status, 0, c.stderr);
    assert.ok(fs.readFileSync(path.join(dir, 'o.vtt'), 'utf8').startsWith('WEBVTT'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'o.json'), 'utf8')).length, words.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('beats and captions exit 2 with one stderr line on bad input', () => {
  for (const args of [['beats'], ['beats', '/no/such/file.txt', '--duration', '5'], ['beats', path.join(FIX, 'narration.txt')], ['beats', path.join(FIX, 'narration.txt'), '--duration', '0'], ['captions'], ['captions', '/no/such.json', '--vtt', '/tmp/x.vtt']]) {
    const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stderr.trim().split('\n').length, 1, args.join(' '));
  }
});
