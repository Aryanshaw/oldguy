'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  slugChapterId, scaffoldChapter, buildRootComposition, pieceWindows, roundUpTenth, narrationSentences, checkNarrationText,
} = require('../lib/chapter.cjs');

const SOURCES = [{ id: 's1', file: 'app.js', lines: [1, 2], quote: 'start()' }];
const SENTENCES = [
  { text: 'A job starts when you press a button.', kind: 'framing', source_ids: [] },
  { text: 'The planner checks the request.', kind: 'claim', source_ids: ['s1'] },
];
const SCENE = [
  { piece: 'title', params: { heading: 'Jobs' }, beat: 0 },
  { piece: 'callout', params: { text: 'here', pointTo: 'left' }, beat: 1 },
];

// Makes an empty temp folder for one test and removes it when the test ends.
function tempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-chapter-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A full, valid scaffold request; tests override one field to break it.
function spec(root, extra = {}) {
  return { root, id: 'How jobs run', title: 'How jobs run', sources: SOURCES, sentences: SENTENCES, scene: SCENE, ...extra };
}

test('slug: lower-case words joined by single hyphens, punctuation dropped', () => {
  assert.equal(slugChapterId('What if it fails?'), 'what-if-it-fails');
  assert.equal(slugChapterId('  Retry --- and   back-off!! '), 'retry-and-back-off');
  assert.equal(slugChapterId('Café crème'), 'cafe-creme');
});

test('slug: leading digits and hyphens are removed, so no ordering number sneaks in', () => {
  assert.equal(slugChapterId('01 - Intro'), 'intro');
  assert.equal(slugChapterId('3 retries then fail'), 'retries-then-fail');
});

test('slug: capped at 60 characters with no trailing hyphen', () => {
  const slug = slugChapterId(`${'abcd '.repeat(30)}`);
  assert.ok(slug.length <= 60, slug);
  assert.doesNotMatch(slug, /-$/);
  assert.match(slug, /^[a-z][a-z0-9-]*$/);
});

test('slug: an id that slugs to nothing is an error', () => {
  assert.throws(() => slugChapterId('123 ???'), /empty/);
  assert.throws(() => slugChapterId(''), /empty/);
});

test('slug: ids that look like paths are refused, not rewritten', () => {
  assert.throws(() => slugChapterId('../x'), /path/);
  assert.throws(() => slugChapterId('a\\b'), /path/);
});

test('scaffold writes chapter.json and narration.txt under chapters/<slug>/', (t) => {
  const root = tempRoot(t);
  const dir = scaffoldChapter(spec(root));
  assert.equal(dir, path.join(root, 'chapters', 'how-jobs-run'));
  const chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'));
  assert.deepEqual(chapter, { id: 'how-jobs-run', title: 'How jobs run', sources: SOURCES, sentences: SENTENCES, scene: SCENE });
  assert.equal(
    fs.readFileSync(path.join(dir, 'narration.txt'), 'utf8'),
    'A job starts when you press a button. The planner checks the request.\n',
  );
  assert.deepEqual(fs.readdirSync(dir).sort(), ['chapter.json', 'narration.txt']);
});

test('scaffold refuses to overwrite an existing chapter and leaves it untouched', (t) => {
  const root = tempRoot(t);
  const dir = scaffoldChapter(spec(root));
  const before = fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8');
  assert.throws(() => scaffoldChapter(spec(root, { title: 'Other' })), /already exists: delete .* and scaffold again/);
  assert.equal(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'), before);
});

test('scaffold rejects a path-escaping id and writes nothing', (t) => {
  const root = tempRoot(t);
  assert.throws(() => scaffoldChapter(spec(root, { id: '../x' })), /path/);
  assert.deepEqual(fs.readdirSync(root), []);
  assert.equal(fs.existsSync(path.join(root, '..', 'x')), false);
});

test('scaffold rejects an unknown piece by name and writes nothing', (t) => {
  const root = tempRoot(t);
  const scene = [{ piece: 'diagram', params: {}, beat: 0 }];
  assert.throws(() => scaffoldChapter(spec(root, { scene })), /scene\[0\].*"diagram".*title\|steps\|code-card\|callout/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('scaffold rejects a callout pointing a way the kit does not draw', (t) => {
  const root = tempRoot(t);
  const scene = [{ piece: 'callout', params: { text: 'x', pointTo: 'sideways' }, beat: 0 }];
  assert.throws(() => scaffoldChapter(spec(root, { scene })), /scene\[0\].*pointTo.*up, down, left, right/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('scaffold rejects beats that are out of range or not increasing', (t) => {
  const root = tempRoot(t);
  const title = (beat) => ({ piece: 'title', params: { heading: 'x' }, beat });
  assert.throws(() => scaffoldChapter(spec(root, { scene: [title(2)] })), /beat/);
  assert.throws(() => scaffoldChapter(spec(root, { scene: [title(1), title(1)] })), /beat/);
  assert.throws(() => scaffoldChapter(spec(root, { scene: [title(0.5)] })), /beat/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('scaffold rejects a sentence text that is really two sentences', (t) => {
  const root = tempRoot(t);
  const sentences = [{ text: 'We call foo. Bar runs it.', kind: 'framing', source_ids: [] }];
  assert.throws(() => scaffoldChapter(spec(root, { sentences, scene: [] })), /sentences\[0\] is not exactly one sentence/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('scaffold rejects entries whose split differs from the spoken split, naming the entry (finding I2)', (t) => {
  const root = tempRoot(t);
  const framing = (text) => ({ text, kind: 'framing', source_ids: [] });
  // the joined narration splits as "Intro." + "The planner Deletes rows.", not as the two entries say
  const finding = [framing('Intro. The planner'), { text: 'Deletes rows.', kind: 'claim', source_ids: ['s1'] }];
  assert.throws(() => scaffoldChapter(spec(root, { sentences: finding, scene: [] })), /sentences\[0\]/);
  // each entry is one sentence on its own, but joined the first runs into the second
  const runOn = [framing('Hello world'), framing('Next one.')];
  assert.throws(() => scaffoldChapter(spec(root, { sentences: runOn, scene: [] })), /sentences\[0\] does not stay one sentence/);
  // the offender is named even when it is not the first entry
  const second = [framing('Fine.'), framing('Bad. Two of them.')];
  assert.throws(() => scaffoldChapter(spec(root, { sentences: second, scene: [] })), /sentences\[1\] is not exactly one sentence/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('narrationSentences: returns the split sentences when the count matches, else says both counts', () => {
  assert.deepEqual(narrationSentences('One. Two.', 2), ['One.', 'Two.']);
  assert.throws(() => narrationSentences('One. Two. Three.', 2), /3 sentences.*2/);
});

test('roundUpTenth: rounds up to the next 0.1 s, an exact tenth stays put', () => {
  assert.equal(roundUpTenth(9.461), 9.5);
  assert.equal(roundUpTenth(9.4), 9.4);
  assert.equal(roundUpTenth(0.7), 0.7);
  assert.equal(roundUpTenth(9.40001), 9.5);
});

test('pieceWindows: each piece runs from its beat start to the next piece, the last to the end', () => {
  const beats = [{ start: 0.04, end: 2 }, { start: 2, end: 5 }, { start: 5, end: 9 }];
  const scene = [
    { piece: 'title', params: { heading: 'a' }, beat: 0 },
    { piece: 'steps', params: { items: [] }, beat: 2 },
  ];
  assert.deepEqual(pieceWindows(scene, beats, 9.5), [
    { piece: 'title', params: { heading: 'a' }, startS: 0.04, durationS: 4.96 },
    { piece: 'steps', params: { items: [] }, startS: 5, durationS: 4.5 },
  ]);
});

// Two pieces on a 9.5 s chapter, used by the composition tests.
const PIECES = [
  { piece: 'title', params: { heading: 'Jobs <b>run</b>' }, startS: 0, durationS: 4 },
  { piece: 'code-card', params: { file: 'app.js', lines: [{ no: 1, text: 'start()' }] }, startS: 4, durationS: 5.5 },
];

test('root composition: one 1920x1080 root with the id and the exact duration', () => {
  const html = buildRootComposition({ id: 'how-jobs-run', durationS: 9.5, pieces: PIECES });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<div id="root" data-composition-id="how-jobs-run" data-start="0" data-width="1920" data-height="1080" data-duration="9.5">/);
  assert.equal(html.match(/data-composition-id=/g).length, 1);
});

test('root composition: holds every piece html (escaped), with unique id prefixes p0, p1', () => {
  const html = buildRootComposition({ id: 'c', durationS: 9.5, pieces: PIECES });
  assert.match(html, /id="p0-root" class="yk-piece yk-title"/);
  assert.match(html, /id="p1-root" class="yk-piece yk-code-card"/);
  assert.match(html, /Jobs &lt;b&gt;run&lt;\/b&gt;/);
  assert.match(html, /tl\.fromTo\("#p1-root"/);
});

test('root composition: theme inlined, GSAP from the CDN, one paused timeline registered once', () => {
  const html = buildRootComposition({ id: 'c', durationS: 9.5, pieces: PIECES });
  const theme = fs.readFileSync(path.join(__dirname, '..', 'scene-kit', 'theme.css'), 'utf8');
  assert.ok(html.includes(theme), 'theme.css is inlined');
  assert.ok(html.includes('<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>'));
  assert.ok(html.includes('const tl = gsap.timeline({ paused: true });'));
  assert.equal(html.match(/window\.__timelines\[/g).length, 1);
  assert.ok(html.includes('window.__timelines["c"] = tl;'));
});

test('root composition: no outside url other than the GSAP CDN', () => {
  const html = buildRootComposition({ id: 'c', durationS: 9.5, pieces: PIECES });
  const urls = html.match(/https?:\/\/[^\s"')]+/g);
  assert.deepEqual(urls, ['https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js']);
});

test('root composition: same input gives byte-identical output', () => {
  const a = buildRootComposition({ id: 'c', durationS: 9.5, pieces: PIECES });
  const b = buildRootComposition({ id: 'c', durationS: 9.5, pieces: structuredClone(PIECES) });
  assert.equal(a, b);
});

test('root composition: an unknown piece is an error naming it', () => {
  assert.throws(() => buildRootComposition({ id: 'c', durationS: 1, pieces: [{ piece: 'nope', params: {}, startS: 0, durationS: 1 }] }), /"nope"/);
});

test('root composition: carries the narration as one audio element spanning the whole chapter', () => {
  const html = buildRootComposition({ id: 'c', durationS: 9.5, pieces: PIECES });
  const audios = html.match(/<audio[^>]*>/g);
  assert.equal(audios.length, 1);
  assert.equal(audios[0], '<audio id="narration" src="narration.wav" data-start="0" data-duration="9.5" data-track-index="10" data-volume="1">');
  assert.ok(html.includes('</audio>'));
  assert.doesNotMatch(html, /crossorigin/i);
  assert.doesNotMatch(html, /\.(play|pause)\(/);
  // the audio sits inside the root composition
  assert.ok(html.indexOf('<audio') > html.indexOf('<div id="root"') && html.indexOf('<audio') < html.lastIndexOf('</div>'));
});

test('checkNarrationText: narration matching the chapter sentences passes, CRLF and extra spaces tolerated', () => {
  const sentences = [{ text: 'One thing.' }, { text: 'Another  thing.' }];
  assert.doesNotThrow(() => checkNarrationText('One thing.\r\nAnother thing.\n', sentences));
  assert.doesNotThrow(() => checkNarrationText('  One   thing. Another thing.', sentences));
});

test('checkNarrationText: a changed word or an extra sentence fails with the redo-the-chapter message', () => {
  const sentences = [{ text: 'One thing.' }, { text: 'Another thing.' }];
  const message = /narration\.txt no longer matches chapter\.json: fix the spec, delete the chapter folder, then scaffold, audit and narrate again/;
  assert.throws(() => checkNarrationText('One thing. Another stuff.', sentences), message);
  assert.throws(() => checkNarrationText('One thing. Another thing. A third.', sentences), message);
});

test('scaffold refuses a code-card line over 68 columns with the kit\'s message and writes nothing', (t) => {
  const root = tempRoot(t);
  const scene = [{ piece: 'code-card', params: { file: 'app.js', lines: [{ no: 1, text: 'y'.repeat(70) }] }, beat: 0 }];
  assert.throws(() => scaffoldChapter(spec(root, { scene })), /scene\[0\]: code-card: lines\[0\] is 70 columns wide/);
  assert.deepEqual(fs.readdirSync(root), []);
});
