'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { speakLines, SPEAK_PY } = require('../lib/voice.mts');
const { joinWavs, writeWav, parseWav } = require('../lib/wav.mts');
const { narrateChapter } = require('../lib/narrate.mts');
const { scaffoldChapter } = require('../lib/chapter.mts');
const { loadTemplate } = require('../lib/template.mts');
const { writeVideoChoice } = require('../lib/settings.mts');

const FIXTURES = path.join(__dirname, 'fixtures', 'templates');
const DUO = loadTemplate('duo', FIXTURES);
const RATE = 24000;
const FORMAT = { channels: 1, sampleRate: RATE, bitsPerSample: 16 };

// Makes an empty temp folder for one test and removes it when the test ends.
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-voice-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A silent mono 16-bit wav of the given length.
function silence(seconds) {
  return writeWav(FORMAT, Buffer.alloc(Math.round(seconds * RATE) * 2));
}

// A pretend speak.py: reads the request, writes line<i>.wav lasting 0.1 s per word, prints the JSON reply.
// `failAt` makes it report a failure on that line instead.
function fakeSpeak({ failAt } = {}) {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push({ cmd, args });
    const request = JSON.parse(fs.readFileSync(args[3], 'utf8'));
    if (failAt !== undefined) return { code: 1, stdout: `${JSON.stringify({ error: 'ValueError: bad phoneme', line: failAt })}\n`, stderr: '' };
    const lines = request.lines.map((l, i) => {
      const seconds = l.text.split(/\s+/).length / 10;
      fs.writeFileSync(path.join(request.out_dir, `line${i}.wav`), silence(seconds));
      return { file: `line${i}.wav`, seconds };
    });
    return { code: 0, stdout: `${JSON.stringify({ sample_rate: RATE, lines })}\n`, stderr: '' };
  };
  return { run, calls };
}

const OPTS = (work, run) => ({ python: '/venv/bin/python', model: '/m/kokoro.onnx', voices: '/m/voices.bin', gapMs: 120, work, run });

test('joinWavs puts gapMs of silence between parts and reports each part\'s span', () => {
  const { wav, spans } = joinWavs([silence(1), silence(0.5), silence(2)], 120);
  assert.deepEqual(spans, [{ start: 0, end: 1 }, { start: 1.12, end: 1.62 }, { start: 1.74, end: 3.74 }]);
  assert.ok(Math.abs(parseWav(wav).durationS - 3.74) < 1e-9);
});

test('joinWavs refuses parts of different formats', () => {
  const other = writeWav({ channels: 1, sampleRate: 22050, bitsPerSample: 16 }, Buffer.alloc(100));
  assert.throws(() => joinWavs([silence(0.1), other], 0), /part 1 is 1 channel\(s\) at 22050 Hz/);
});

test('speakLines runs speak.py once with every line\'s voice and speed', async (t) => {
  const work = tempDir(t);
  const { run, calls } = fakeSpeak();
  const lines = [{ text: 'Why is that?', voice: 'bm_george', speed: 1.15 }, { text: 'Because the check refuses it.', voice: 'am_adam', speed: 1.1 }];
  const spoken = await speakLines(lines, OPTS(work, run));
  assert.equal(calls.length, 1, 'one process for the whole chapter');
  assert.deepEqual(calls[0].args.slice(0, 3), [SPEAK_PY, '/m/kokoro.onnx', '/m/voices.bin']);
  assert.equal(calls[0].cmd, '/venv/bin/python');
  assert.deepEqual(JSON.parse(fs.readFileSync(calls[0].args[3], 'utf8')).lines, lines);
  assert.deepEqual(spoken.spans.map((s) => [Number(s.start.toFixed(3)), Number(s.end.toFixed(3))]), [[0, 0.3], [0.42, 0.92]]);
});

test('speakLines names the line that failed', async (t) => {
  const { run } = fakeSpeak({ failAt: 1 });
  await assert.rejects(speakLines([{ text: 'a.', voice: 'af_heart', speed: 1 }, { text: 'Bad line.', voice: 'af_heart', speed: 1 }], OPTS(tempDir(t), run)),
    /speaking failed \(line 1: "Bad line\."\): ValueError: bad phoneme/);
});

// A data folder holding duo's downloaded background at its listed size (as a finished fetch leaves it).
function dataDir(t) {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, 'templates', 'duo', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'templates', 'duo', 'assets', 'loop.mp4'), Buffer.alloc(1234));
  return dir;
}

// Scaffolds a two-speaker chapter in a video folder that chose the duo template.
function duoChapter(t, shape = '9:16') {
  const slugDir = tempDir(t);
  writeVideoChoice(slugDir, { template: 'duo', shape });
  const sentences = [
    { speaker: 'kid', kind: 'framing', source_ids: [], text: 'Does it just make up numbers?' },
    { speaker: 'dad', kind: 'claim', source_ids: ['s1'], text: 'Every source goes through a check first.' },
  ];
  const scene = [{ piece: 'title', params: { heading: 'Lines' }, beat: 0 }, { piece: 'callout', params: { text: 'check' }, beat: 1, word: 'source' }];
  return scaffoldChapter({ root: slugDir, id: 'lines', title: 'Lines', sources: [{ id: 's1', file: 'a.js', lines: [3, 4], quote: 'x' }], sentences, scene, template: DUO });
}

test('narrate with speakers: exact line beats, a stage page, the template pictures copied, beats.json with lines and words', async (t) => {
  const dir = duoChapter(t);
  const { run, calls } = fakeSpeak();
  const r = await narrateChapter(dir, { run, venvPython: '/venv/bin/python', whisperAvailable: true, template: DUO, kokoro: { model: '/m/k.onnx', voices: '/m/v.bin' }, dataDir: dataDir(t) });
  assert.equal(r.timing, 'lines');
  assert.equal(calls.length, 1, 'no tts or transcribe call: one speak.py run, whisper or not');
  // 0.04 lead, line 0 is 6 words (0.6 s), the gap is 120 ms, line 1 is 7 words (0.7 s)
  assert.deepEqual(r.beats.map((b) => [Number(b.start.toFixed(3)), Number(b.end.toFixed(3))]), [[0.04, 0.64], [0.76, 1.46]]);
  const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(page, /data-width="1080" data-height="1920"/);
  assert.match(page, /tl\.set\("#og-sp-dad", \{opacity: 1\}, 0\.76\);/);
  assert.match(page, /<div id="og-chip-1" class="og-chip">a\.js:3-4<\/div>/);
  for (const pic of ['assets/kid.svg', 'assets/dad.svg', 'assets/dad-talk.svg', 'assets/loop.mp4']) assert.ok(fs.existsSync(path.join(dir, pic)), pic);
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
  assert.deepEqual(record.template, { id: 'duo', version: 2, shape: '9:16' });
  assert.ok(record.sha256['asset:assets/loop.mp4'], 'copied assets are fingerprinted');
  const beats = JSON.parse(fs.readFileSync(path.join(dir, 'beats.json'), 'utf8'));
  assert.equal(beats.lines[1].speaker, 'dad');
  assert.equal(beats.words[0].text, 'Does');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.narrate-')), [], 'the work folder is gone');
});

test('narrate with speakers starts an anchored piece on its word', async (t) => {
  const dir = duoChapter(t);
  await narrateChapter(dir, { run: fakeSpeak().run, venvPython: '/p', whisperAvailable: false, template: DUO, dataDir: dataDir(t) });
  const beats = JSON.parse(fs.readFileSync(path.join(dir, 'beats.json'), 'utf8'));
  const source = beats.words.find((w) => w.text === 'source');
  assert.ok(source.start > beats.lines[1].start, 'the anchor word is after the line start');
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), new RegExp(String(Number(source.start.toFixed(3)))));
});

test('narrate refuses a chapter the template no longer accepts, before speaking', async (t) => {
  const dir = duoChapter(t);
  const chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'));
  chapter.sentences[0].speaker = 'mum';
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify(chapter));
  const { run, calls } = fakeSpeak();
  await assert.rejects(narrateChapter(dir, { run, venvPython: '/p', whisperAvailable: false, template: DUO, dataDir: dataDir(t) }), /sentence 0: unknown speaker "mum"/);
  assert.equal(calls.length, 0);
});

test('narrate reads the template and shape from the video folder by default', async (t) => {
  const dir = duoChapter(t, '16:9');
  // the shipped templates do not include duo, so naming it only through video.json must fail clearly
  await assert.rejects(narrateChapter(dir, { run: fakeSpeak().run, venvPython: '/p', whisperAvailable: false }), /this video is made as duo: unknown template "duo"/);
  await narrateChapter(dir, { run: fakeSpeak().run, venvPython: '/p', whisperAvailable: false, template: DUO, dataDir: dataDir(t) });
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /data-width="1920" data-height="1080" data-duration="[\d.]+" data-shape="16:9"/);
});

test('narrate stops before speaking when a downloaded asset is missing, naming it and its size', async (t) => {
  const dir = duoChapter(t);
  const { run, calls } = fakeSpeak();
  await assert.rejects(narrateChapter(dir, { run, venvPython: '/p', whisperAvailable: false, template: DUO, dataDir: tempDir(t) }),
    /template duo needs assets\/loop\.mp4 \(1 MB\) downloaded first: ask the user, then run oldguy templates duo --fetch/);
  assert.equal(calls.length, 0);
});
