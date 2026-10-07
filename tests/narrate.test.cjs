'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { narrateChapter } = require('../lib/narrate.mts');
const { scaffoldChapter } = require('../lib/chapter.mts');
const { parseWav } = require('../lib/wav.mts');
const { HYPERFRAMES_VERSION } = require('../lib/hyperframes.mts');
const crypto = require('node:crypto');

const FIXTURES = path.join(__dirname, 'fixtures');
const RAW_WAV = path.join(FIXTURES, 'narration.wav');
const TRANSCRIPT = path.join(FIXTURES, 'transcript.json');
const PYTHON = '/data/venv/bin/python';
const SENTENCES = [
  'A job starts when you press a button.',
  'The planner checks the request, then saves a pending row in the database.',
  'A worker later picks that row up and runs it.',
].map((text) => ({ text, kind: 'framing', source_ids: [] }));
const SCENE = [
  { piece: 'title', params: { heading: 'How a job runs' }, beat: 0 },
  { piece: 'steps', params: { items: [{ label: 'plan' }, { label: 'run' }] }, beat: 2 },
];
const SCAFFOLDED = ['chapter.json', 'narration.txt'];
const NARRATED = ['beats.json', 'build.json', 'captions.json', 'captions.vtt', 'chapter.json', 'gsap.min.js', 'index.html', 'narration.txt', 'narration.wav'];

// Scaffolds the spike-3 narration as a chapter in a temp folder removed after the test.
function chapterDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-narrate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return scaffoldChapter({ root, id: 'how a job runs', title: 'How a job runs', sources: [], sentences: SENTENCES, scene: SCENE });
}

// A pretend Hyperframes: tts copies the spike WAV to -o, transcribe drops the spike transcript next to the WAV.
// `fail` names a step that should exit 1 with a stderr message instead.
// `words` replaces the spike transcript's word list.
function fakeRun({ fail, words } = {}) {
  const calls = [];
  const run = async (cmd, args, env) => {
    calls.push({ cmd, args, env });
    const step = args[2];
    if (step === fail) return { code: 1, stdout: '', stderr: `${step}: kokoro exploded\n` };
    if (step === 'tts') {
      fs.copyFileSync(RAW_WAV, args[args.indexOf('-o') + 1]);
      return { code: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
    const transcriptPath = path.join(path.dirname(args[3]), 'transcript.json');
    if (words) fs.writeFileSync(transcriptPath, JSON.stringify(words));
    else fs.copyFileSync(TRANSCRIPT, transcriptPath);
    return { code: 0, stdout: `${JSON.stringify({ ok: true, transcriptPath })}\n`, stderr: '' };
  };
  return { run, calls };
}

// Reads a JSON file from the chapter folder.
function readJson(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

test('narrate (whisper available): tts then transcribe through npx hyperframes, python from the venv', async (t) => {
  const dir = chapterDir(t);
  const { run, calls } = fakeRun();
  await narrateChapter(dir, { run, venvPython: PYTHON, whisperAvailable: true });
  // both steps run the pinned Hyperframes through npx --yes, so no prompt and no surprise upgrade
  const pinned = `hyperframes@${HYPERFRAMES_VERSION}`;
  assert.equal(HYPERFRAMES_VERSION, '0.8.112');
  assert.deepEqual(calls.map((c) => [c.cmd, c.args[0], c.args[1], c.args[2]]), [['npx', '--yes', pinned, 'tts'], ['npx', '--yes', pinned, 'transcribe']]);
  const tts = calls[0].args;
  // tts reads a private copy of the verified text, never the live narration.txt
  assert.equal(path.basename(tts[3]), 'narration.txt');
  assert.ok(path.isAbsolute(tts[3]));
  assert.notEqual(tts[3], path.join(dir, 'narration.txt'));
  assert.equal(path.basename(tts[tts.indexOf('-o') + 1]), 'narration.raw.wav');
  assert.ok(tts.includes('--json'));
  assert.equal(calls[0].env.HYPERFRAMES_PYTHON, PYTHON);
  assert.equal(path.basename(calls[1].args[3]), 'narration.wav');
  assert.ok(calls[1].args.includes('--json'));
});

test('narrate: padded narration.wav is exactly 0.160 s longer than the tts output', async (t) => {
  const dir = chapterDir(t);
  await narrateChapter(dir, { ...fakeRun(), venvPython: PYTHON, whisperAvailable: true });
  const raw = parseWav(fs.readFileSync(RAW_WAV)).durationS;
  const padded = parseWav(fs.readFileSync(path.join(dir, 'narration.wav'))).durationS;
  assert.ok(Math.abs(padded - raw - 0.16) < 1e-9, `${padded} - ${raw}`);
});

test('narrate (words path): 3 beats timed from words, timing "words", captions in the author\'s words', async (t) => {
  const dir = chapterDir(t);
  const result = await narrateChapter(dir, { ...fakeRun(), venvPython: PYTHON, whisperAvailable: true });
  const beats = readJson(dir, 'beats.json');
  assert.equal(beats.timing, 'words');
  assert.equal(result.timing, 'words');
  assert.deepEqual(beats.beats.map((b) => b.text), SENTENCES.map((s) => s.text));
  // the second sentence starts where whisper heard "The" (word w8 of the spike transcript)
  const words = JSON.parse(fs.readFileSync(TRANSCRIPT, 'utf8'));
  assert.equal(beats.beats[1].start, words.find((w) => w.text === 'The').start);
  assert.match(fs.readFileSync(path.join(dir, 'captions.vtt'), 'utf8'), /^WEBVTT\n\n00:00:/);
  const captionWords = readJson(dir, 'captions.json').map((w) => w.text).join(' ');
  assert.equal(captionWords, SENTENCES.map((s) => s.text).join(' '));
});

test('narrate: whisper timings past the end of the audio are cut back to the audio length', async (t) => {
  // seen in the acceptance run: whisper put the last word's end 0.37 s after the audio ended
  const dir = chapterDir(t);
  const words = JSON.parse(fs.readFileSync(TRANSCRIPT, 'utf8'));
  words[words.length - 1] = { ...words[words.length - 1], end: 12.0 };
  await narrateChapter(dir, { ...fakeRun({ words }), venvPython: PYTHON, whisperAvailable: true });
  const audioS = parseWav(fs.readFileSync(path.join(dir, 'narration.wav'))).durationS;
  const beats = readJson(dir, 'beats.json').beats;
  assert.equal(beats[beats.length - 1].end, Math.floor(audioS * 1000) / 1000);
  for (const w of readJson(dir, 'captions.json')) assert.ok(w.end <= audioS + 1e-9, `${w.text} ends at ${w.end}`);
  const cueEnds = [...fs.readFileSync(path.join(dir, 'captions.vtt'), 'utf8').matchAll(/--> 00:00:(\d+\.\d+)/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...cueEnds) <= audioS + 0.001, `last cue ends at ${Math.max(...cueEnds)}`);
});

test('narrate: duration is the padded length rounded up to 0.1 s, and the page uses it exactly', async (t) => {
  const dir = chapterDir(t);
  const result = await narrateChapter(dir, { ...fakeRun(), venvPython: PYTHON, whisperAvailable: true });
  // 9.3013 s of speech + 0.16 s padding = 9.4613 s, rounded up to the next tenth
  assert.equal(result.durationS, 9.5);
  assert.equal(readJson(dir, 'beats.json').durationS, 9.5);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /data-composition-id="how-a-job-runs"[^>]*data-duration="9.5"/);
});

test('narrate: the scene pieces land on their beats in index.html', async (t) => {
  const dir = chapterDir(t);
  await narrateChapter(dir, { ...fakeRun(), venvPython: PYTHON, whisperAvailable: true });
  const third = readJson(dir, 'beats.json').beats[2].start;
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /id="p0-root" class="og-piece og-title"/);
  // the steps piece fades in at the third sentence's start (whole milliseconds, as the kit writes it)
  const fadeIn = html.split('\n').find((l) => l.startsWith('tl.fromTo("#p1-root"'));
  assert.ok(fadeIn.endsWith(`, ${Math.round(third * 1000) / 1000});`), fadeIn);
});

test('narrate writes exactly the finished files and leaves no temp folder behind', async (t) => {
  const dir = chapterDir(t);
  await narrateChapter(dir, { ...fakeRun(), venvPython: PYTHON, whisperAvailable: true });
  assert.deepEqual(fs.readdirSync(dir).sort(), NARRATED);
});

test('narrate (no whisper): never transcribes, times by sentence share and records it', async (t) => {
  const dir = chapterDir(t);
  const { run, calls } = fakeRun();
  const result = await narrateChapter(dir, { run, venvPython: PYTHON, whisperAvailable: false });
  assert.deepEqual(calls.map((c) => c.args[2]), ['tts']);
  const beats = readJson(dir, 'beats.json');
  assert.equal(beats.timing, 'sentence-share');
  assert.equal(result.timing, 'sentence-share');
  assert.equal(beats.beats.length, 3);
  // speech starts after the 40 ms lead and the last beat ends where the speech ends
  assert.equal(beats.beats[0].start, 0.04);
  const raw = parseWav(fs.readFileSync(RAW_WAV)).durationS;
  assert.ok(Math.abs(beats.beats[2].end - (raw + 0.04)) < 1e-9);
  assert.equal(result.durationS, 9.5);
  assert.deepEqual(fs.readdirSync(dir).sort(), NARRATED);
});

test('narrate: a failing tts surfaces its stderr and writes no files', async (t) => {
  const dir = chapterDir(t);
  await assert.rejects(
    narrateChapter(dir, { ...fakeRun({ fail: 'tts' }), venvPython: PYTHON, whisperAvailable: true }),
    /hyperframes tts failed.*kokoro exploded/,
  );
  assert.deepEqual(fs.readdirSync(dir).sort(), SCAFFOLDED);
});

// with --json, Hyperframes puts its reason on stdout (seen for real with a missing venv) and leaves stderr empty
test('narrate: a failing tts with an empty stderr surfaces the error from its JSON stdout', async (t) => {
  const dir = chapterDir(t);
  const reason = 'The kokoro-onnx package is not installed.';
  const run = async () => ({ code: 1, stdout: `${JSON.stringify({ ok: false, error: reason })}\n`, stderr: '' });
  await assert.rejects(
    narrateChapter(dir, { run, venvPython: PYTHON, whisperAvailable: true }),
    /hyperframes tts failed: The kokoro-onnx package is not installed\./,
  );
});

test('narrate: a failing transcribe also fails (no silent fallback) and writes no files', async (t) => {
  const dir = chapterDir(t);
  await assert.rejects(
    narrateChapter(dir, { ...fakeRun({ fail: 'transcribe' }), venvPython: PYTHON, whisperAvailable: true }),
    /hyperframes transcribe failed.*kokoro exploded/,
  );
  assert.deepEqual(fs.readdirSync(dir).sort(), SCAFFOLDED);
});

test('narrate: re-narrating replaces the earlier outputs', async (t) => {
  const dir = chapterDir(t);
  await narrateChapter(dir, { ...fakeRun(), venvPython: PYTHON, whisperAvailable: false });
  await narrateChapter(dir, { ...fakeRun(), venvPython: PYTHON, whisperAvailable: true });
  assert.equal(readJson(dir, 'beats.json').timing, 'words');
  assert.deepEqual(fs.readdirSync(dir).sort(), NARRATED);
});

test('narrate: narration with an extra sentence fails the text audit before any tts is run', async (t) => {
  const dir = chapterDir(t);
  fs.appendFileSync(path.join(dir, 'narration.txt'), 'And one more sentence.\n');
  const { run, calls } = fakeRun();
  await assert.rejects(narrateChapter(dir, { run, venvPython: PYTHON, whisperAvailable: true }), /narration\.txt no longer matches chapter\.json/);
  assert.equal(calls.length, 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), SCAFFOLDED);
});

test('narrate: a changed word in narration.txt fails before any tts is run', async (t) => {
  const dir = chapterDir(t);
  const file = path.join(dir, 'narration.txt');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('button', 'switch'));
  const { run, calls } = fakeRun();
  await assert.rejects(narrateChapter(dir, { run, venvPython: PYTHON, whisperAvailable: true }), /narration\.txt no longer matches chapter\.json: fix the spec, delete the chapter folder, then scaffold, audit and narrate again/);
  assert.equal(calls.length, 0);
  assert.deepEqual(fs.readdirSync(dir).sort(), SCAFFOLDED);
});

test('narrate: index.html plays the padded narration.wav that sits beside it', async (t) => {
  const dir = chapterDir(t);
  await narrateChapter(dir, { ...fakeRun(), venvPython: PYTHON, whisperAvailable: true });
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const audio = html.match(/<audio[^>]*>/g);
  assert.equal(audio.length, 1);
  const src = /src="([^"]+)"/.exec(audio[0])[1];
  assert.equal(src, 'narration.wav');
  assert.match(audio[0], /data-duration="9.5"/);
  // the file it points at is the padded one: 0.16 s longer than the tts output
  const raw = parseWav(fs.readFileSync(RAW_WAV)).durationS;
  const played = parseWav(fs.readFileSync(path.join(dir, src))).durationS;
  assert.ok(Math.abs(played - raw - 0.16) < 1e-9);
});

test('narrate writes build.json with sha256 of the chapter text and every built file', async (t) => {
  const dir = chapterDir(t);
  await narrateChapter(dir, { ...fakeRun(), venvPython: PYTHON, whisperAvailable: false });
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
  assert.equal(record.version, 3);
  const files = ['beats.json', 'captions.json', 'captions.vtt', 'gsap.min.js', 'index.html', 'narration.txt', 'narration.wav'];
  assert.deepEqual(Object.keys(record.sha256).sort(), ['chapter', ...files].sort());
  for (const name of files) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
    assert.equal(record.sha256[name], actual, name);
  }
  assert.match(record.sha256.chapter, /^[0-9a-f]{64}$/);
});

test('narrate hands Hyperframes absolute paths even when given a relative chapter folder', async (t) => {
  const dir = chapterDir(t);
  const { run, calls } = fakeRun();
  await narrateChapter(path.relative(process.cwd(), dir), { run, venvPython: PYTHON, whisperAvailable: true });
  for (const call of calls) {
    const paths = call.args.filter((a) => a.includes('narration'));
    assert.ok(paths.length > 0 && paths.every((p) => path.isAbsolute(p)), call.args.join(' '));
  }
});

test('narrate refuses a chapter.json entry that is not exactly one sentence, before any tts', async (t) => {
  const dir = chapterDir(t);
  const file = path.join(dir, 'chapter.json');
  const chapter = JSON.parse(fs.readFileSync(file, 'utf8'));
  // move a sentence boundary while keeping the joined text identical, so only the per-entry check can catch it
  chapter.sentences[0].text = 'A job starts when you press a button. The planner checks the request,';
  chapter.sentences[1].text = 'then saves a pending row in the database.';
  fs.writeFileSync(file, JSON.stringify(chapter));
  const { run, calls } = fakeRun();
  await assert.rejects(narrateChapter(dir, { run, venvPython: PYTHON, whisperAvailable: true }), /sentences\[0\]/);
  assert.equal(calls.length, 0);
});

test('narrate speaks the verified text even if narration.txt changes on disk after the check', async (t) => {
  const dir = chapterDir(t);
  const live = path.join(dir, 'narration.txt');
  const verified = SENTENCES.map((s) => s.text).join(' ');
  const { run: base } = fakeRun();
  let spoken;
  const run = async (cmd, args, env) => {
    if (args[2] === 'tts') {
      // the race: someone rewrites narration.txt after narrate verified it but before tts reads its input
      fs.writeFileSync(live, 'Unaudited words slipped in.\n');
      spoken = fs.readFileSync(args[3], 'utf8');
    }
    return base(cmd, args, env);
  };
  await narrateChapter(dir, { run, venvPython: PYTHON, whisperAvailable: false });
  assert.equal(spoken.trim(), verified);
  // the build record holds the verified bytes, so render will refuse the folder whose narration.txt was swapped
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
  const crypto2 = require('node:crypto');
  assert.equal(record.sha256['narration.txt'], crypto2.createHash('sha256').update(`${verified}\n`).digest('hex'));
});

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

// The fake Hyperframes plus a pretend git: `git` calls get the given answer (or throw it when it is an Error).
function withGit(answer) {
  const base = fakeRun();
  const gitCalls = [];
  const run = async (cmd, args, env) => {
    if (cmd !== 'git') return base.run(cmd, args, env);
    gitCalls.push(args);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { run, gitCalls };
}

test('narrate records the commit HEAD of --root in build.json and returns it', async (t) => {
  const dir = chapterDir(t);
  const { run, gitCalls } = withGit({ code: 0, stdout: `${SHA}\n`, stderr: '' });
  const result = await narrateChapter(dir, { run, venvPython: PYTHON, whisperAvailable: false, root: 'some/repo' });
  assert.deepEqual(gitCalls, [['-C', path.resolve('some/repo'), 'rev-parse', 'HEAD']]);
  assert.equal(readJson(dir, 'build.json').verified_against_commit, SHA);
  assert.equal(result.commit, SHA);
});

test('narrate records null for output that is not a 40-hex commit, a git failure, or missing git', async (t) => {
  for (const answer of [{ code: 0, stdout: 'not a sha\n', stderr: '' }, { code: 0, stdout: SHA.toUpperCase(), stderr: '' },
    { code: 128, stdout: '', stderr: 'fatal: not a git repository' }, { code: null, stdout: '', stderr: 'spawn git ENOENT' },
    new Error('spawn git ENOENT')]) {
    const dir = chapterDir(t);
    const result = await narrateChapter(dir, { run: withGit(answer).run, venvPython: PYTHON, whisperAvailable: false, root: '/repo' });
    assert.equal(readJson(dir, 'build.json').verified_against_commit, null, JSON.stringify(String(answer.stdout ?? answer)));
    assert.equal(result.commit, null);
  }
});

test('narrate without a root asks git nothing and records null', async (t) => {
  const dir = chapterDir(t);
  const { run, gitCalls } = withGit({ code: 0, stdout: SHA, stderr: '' });
  await narrateChapter(dir, { run, venvPython: PYTHON, whisperAvailable: false });
  assert.deepEqual(gitCalls, []);
  assert.equal(readJson(dir, 'build.json').verified_against_commit, null);
});

test('the narrate output line names the short commit, or says there is no git repo or no --root', () => {
  const { narratedLine } = require('../cli/narrate.mts');
  const r = { durationS: 31.2, beats: [1, 2, 3, 4], timing: 'words' };
  assert.equal(narratedLine('intro', { ...r, commit: SHA }, true), 'intro: narrated, 31.2 s, 4 beats, timing words, commit a1b2c3d');
  assert.equal(narratedLine('intro', { ...r, commit: null }, true), 'intro: narrated, 31.2 s, 4 beats, timing words, not a git repo');
  assert.equal(narratedLine('intro', { ...r, commit: null }, false), 'intro: narrated, 31.2 s, 4 beats, timing words, no commit recorded (no --root)');
});
