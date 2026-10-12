// Writes script.md, sources.json, specs/<id>.json and scenes/<id>.html for the tutor template's sample video, built on
// the map scene (map.mjs, beside this file): the same four lanes in every chapter, and a band under them that zooms
// into one lane (real code, the timing record, two templates side by side, the what-if), so the map never goes away.
// Same repository and question as the other templates' samples: "explain the template engine so a newcomer can
// follow it", following one spoken line, "Your todo is saved.", through four stops (script, voice, timing, page).
// The new guy asks, the old guy explains and carries every claim (laughing on his jokes). Times are the real ones
// from this video's own first chapter once it is narrated (run this again after narrating it).
//   node templates/tutor/examples/sample-make.mjs [video dir relative to the repo]   (default: .oldguy/sample-tutor)
import fs from 'node:fs';
import path from 'node:path';
import { mapScene, lineAt } from './map.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '..', '..', '..');
const videoRel = process.argv[2] ?? '.oldguy/sample-tutor';
const video = path.join(repo, videoRel);
fs.mkdirSync(path.join(video, 'specs'), { recursive: true });
fs.mkdirSync(path.join(video, 'scenes'), { recursive: true });

const claim = (text, ...ids) => ({ text, kind: 'claim', source_ids: ids, speaker: 'oldguy' });
const laughClaim = (text, ...ids) => ({ text, kind: 'claim', source_ids: ids, speaker: 'oldguy-laughs' });
const old = (text) => ({ text, kind: 'framing', source_ids: [], speaker: 'oldguy' });
const laugh = (text) => ({ text, kind: 'framing', source_ids: [], speaker: 'oldguy-laughs' });
const ask = (text) => ({ text, kind: 'framing', source_ids: [], speaker: 'newguy' });
const src = (id, file, a, b, quote) => ({ id, file, lines: [a, b], quote });
const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8').split('\n');
// the 1-based number of the first line of a file holding `text` (after line `from`)
function lineOf(file, text, from = 0) {
  const n = read(file).findIndex((l, i) => i >= from && l.includes(text)) + 1;
  if (n === 0) throw new Error(`${file}: no line holds ${text}`);
  return n;
}
// code-card lines: whole repository lines, the listed ones highlighted
function card(file, nos, lit = nos) {
  const all = read(file);
  return {
    piece: 'code-card',
    params: { file, lines: nos.map((no) => ({ no, text: all[no - 1].trimEnd(), ...(lit.includes(no) ? { highlight: true } : {}) })) },
  };
}

// ---- the files cited ---------------------------------------------------------------------------------------------
const TJ = 'templates/tutor/template.json';
const L = {
  idNew: lineOf(TJ, '"id": "newguy"'),
  idOld: lineOf(TJ, '"id": "oldguy"'),
  voiceOld: lineOf(TJ, '"voice": "bm_george"'),
  sideLeft: lineOf(TJ, '"side": "left"'),
  sideRight: lineOf(TJ, '"side": "right"'),
  speeds: lineOf(TJ, '"voice_speed": {'),
  speedOld: lineOf(TJ, '"oldguy": 0.97'),
  gap: lineOf(TJ, '"line_gap_ms": 550'),
};
const EJ = 'templates/explainer/template.json';
const exSpeakers = lineOf(EJ, '"speakers": [],');
const exVoice = lineOf(EJ, '"narrator_voice": "af_heart"');
const TPL = 'lib/template.mts';
const tplFind = lineOf(TPL, 'const s = t.speakers.find((x) => x.id === speaker);', lineOf(TPL, 'function voiceFor('));
const tplVoice = lineOf(TPL, 'return { voice: s.voice, speed:', tplFind);
const NAR = 'lib/narrate.mts';
const WAV = 'lib/wav.mts';
const wavGap = lineOf(WAV, 'frames += gap.length / frameBytes;');
const wavStart = lineOf(WAV, 'const start = frames / format.sampleRate;', wavGap);
const STG = 'lib/stage.mts';
const stgMe = lineOf(STG, 'const me = `#og-sp-${l.speaker}`;');
const stgOn = lineOf(STG, 'tl.push(`tl.set(${JSON.stringify(me)}, {opacity: 1}, ${sec(l.start)});`);', stgMe);
const stgOff = lineOf(STG, "if (others.length) tl.push(`tl.set(${JSON.stringify(others.join(', '))}, {opacity: 0}", stgOn);
const tplFolder = lineOf(TPL, '// The files every template folder must hold besides template.json.');
const stgPush = 'tl.push(`tl.set(${JSON.stringify(';
// the voice maker's sample rate: frames of sound per second, where it is set (the speech package oldguy installs)
const KOK = (() => {
  const lib = path.join(repo, '.oldguy', 'venv', 'lib');
  const py = fs.existsSync(lib) ? fs.readdirSync(lib).find((d) => fs.existsSync(path.join(lib, d, 'site-packages', 'kokoro_onnx', 'config.py'))) : null;
  if (!py) throw new Error('no .oldguy/venv/lib/*/site-packages/kokoro_onnx/config.py: run oldguy setup first');
  return `.oldguy/venv/lib/${py}/site-packages/kokoro_onnx/config.py`;
})();
const kokRate = lineOf(KOK, 'SAMPLE_RATE = ');
const SAMPLE_RATE = Number(read(KOK)[kokRate - 1].split('=')[1]);
const code = (file, no, key, mute) => lineAt(repo, file, no, key, mute);
const file = (f) => `zoom · <code>${f}</code>`;

// ---- real times from the first chapter -------------------------------------------------------------------------
const FIRST = 'why-templates';
// sentence 0 is the new guy's line, sentence 1 is our line
const beatsRel = `${videoRel}/chapters/${FIRST}/beats.json`;
const wavRel = `${videoRel}/chapters/${FIRST}/narration.wav`;
const two = (x) => (Math.round(x * 100) / 100).toFixed(2);
const thousands = (n) => n.toLocaleString('en-US');
let T = { prevEnd: '0.00', start: '0.00', end: '0.00', prevEndNo: 1, startNo: 1, endNo: 1, textNo: 1, qTextNo: 1, qStartRaw: '0', prevEndRaw: '0', startRaw: '0', endRaw: '0', frames: '0', real: false };
if (fs.existsSync(path.join(repo, beatsRel))) {
  const text = fs.readFileSync(path.join(repo, beatsRel), 'utf8');
  const [b0, b1] = JSON.parse(text).beats;
  const rows = text.split('\n');
  const find = (key, v, from = 0) => rows.findIndex((l, i) => i >= from && l.includes(`"${key}": ${v}`)) + 1;
  const qTextNo = find('text', JSON.stringify(b0.text));
  const prevEndNo = find('end', b0.end, qTextNo);
  const textNo = find('text', JSON.stringify(b1.text), prevEndNo);
  const startNo = find('start', b1.start, prevEndNo);
  // the worked example: how many frames of this video's sound come before the question ends, read from the narration
  // itself (its sample rate from the wav header; the frames are the record's end times that rate, and the silence of
  // the pause must start right there)
  const wav = fs.readFileSync(path.join(repo, wavRel));
  const rate = wav.readUInt32LE(24);
  if (rate !== SAMPLE_RATE) throw new Error(`${wavRel} is ${rate} Hz, the voice maker says ${SAMPLE_RATE}`);
  const frames = Math.round(b0.end * rate);
  const at = (f) => wav.readInt16LE(44 + f * 2);
  for (let f = frames + 24; f < frames + 24 * 500; f += 24) if (at(f) !== 0) throw new Error(`${wavRel}: no pause after frame ${frames}`);
  T = { prevEnd: two(b0.end), start: two(b1.start), end: two(b1.end), prevEndNo, startNo, endNo: startNo + 1, textNo, qTextNo, qStartRaw: String(b0.start), prevEndRaw: String(b0.end), startRaw: String(b1.start), endRaw: String(b1.end), frames: thousands(frames), real: true };
}
const WHAT_IF = two(Number(T.prevEnd) + 1);
const RATE = thousands(SAMPLE_RATE);

// ---- the shared map: four lanes in the order the line travels (templates/tutor/examples/map.mjs) -----------------
// the kicker says the promise from the first frame: a written script goes in, a narrated video comes out
const KICK = 'Template engine · script → narrated video';
const LINE = '“Your todo is saved.”';
// the stops our line has already passed, one card each, dimmed from the chapter's first sentence
const done = {
  script: { id: 'd-script', lane: 'script', label: LINE, detail: 'any template', done: true },
  voice: { id: 'd-voice', lane: 'voice', label: 'George, speed 0.97', detail: '+ 550 ms pause', done: true },
  timing: { id: 'd-timing', lane: 'timing', label: `starts ${T.start} s`, detail: `${T.prevEnd} s + 550 ms`, done: true },
};
const design = (id) => ({ piece: 'design', params: { file: `scenes/${id}.html` }, beat: 0 });

// When a phrase is said, in seconds into its sentence: where the phrase falls in the sentence, as a share of the
// sentence's length, times how long the sentence really lasts (from that chapter's own timing record, once narrated;
// a guess from its length before). A card, a block or a key comes in as the voice names it, so nothing waits on screen.
const RECAP = `Script, voice, timing, page: our line lights up at ${T.start} seconds.`;
const LAST = 'the-page';
function said(chapter, i, phrase) {
  const text = SAID[chapter][i].text;
  const at = text.indexOf(phrase);
  if (at < 0) throw new Error(`${chapter} sentence ${i} does not say ${phrase}`);
  const rel = `${videoRel}/chapters/${chapter}/beats.json`;
  let dur = text.length * 0.07;
  if (fs.existsSync(path.join(repo, rel))) {
    const b = JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8')).beats[i];
    if (b && b.text === text) dur = b.end - b.start;
  }
  return Math.round(dur * (at / text.length) * 100) / 100 + 0.15;
}
const recapAfter = (phrase) => said(LAST, 7, phrase);

// ---- the chapters: what is said first, so a picture can come in when its words are said -------------------------
const SAID = {
  [FIRST]: [
    ask('Okay, dumb question: which line are we even following.'),
    old('Your todo is saved.'),
    claim('The engine turns a written script into a narrated video; we follow that one line.', 's1'),
    old('It makes four stops on the way: script, voice, timing, page.'),
    ask('Cool, but why does one little line need a template.'),
    claim('A template is a folder: one template.json of choices, plus a stage, the page around them.', 's2'),
    claim('Its choices fill our stops: who talks and how fast, the pause, and where we stand.', 's3'),
    claim("So swap in the explainer's folder, and one calm voice says the same words.", 's4'),
  ],
  'the-voice': [
    old('Our line, your todo is saved, now needs somebody to say it.'),
    ask('Let me guess: a robot with a nice voice.'),
    claim('Close: I say it, in a voice called George, written bm_george under my id.', 's1'),
    claim("My voice speed is 0.97, slower than the new guy's 1.05, so my lines last longer.", 's2'),
    ask('Figures, you are old.'),
    laughClaim('Heh, in plain words: each line looks up its speaker, then takes that voice and speed.', 's3'),
    claim('Then, after each line, comes a 550 millisecond pause.', 's4'),
    old('So every point gets a breath before the next one starts.'),
  ],
  'the-timing': [
    old('Our line, your todo is saved, is now a little sound with a pause after it.'),
    ask('Okay, but how does the page know when it starts.'),
    claim('The oldguy build tool, not me, writes a timing record: each line, its start, its end.', 's1'),
    claim('Its first row is the question you asked at the very start: okay, dumb question.', 's2'),
    claim(`The record stores when that question ends, in seconds: ${T.prevEnd}.`, 's3'),
    claim(`The tool measured it from the sound: ${T.frames} frames, tiny audio slices, at ${RATE} a second.`, 's4'),
    claim(`Add my 550 millisecond pause, and our line starts at ${T.start} seconds.`, 's5'),
    old('So the page never guesses: it reads every start from the record.'),
  ],
  [LAST]: [
    old(`Last stop: our line, your todo is saved, meets the page at ${T.start} seconds.`),
    claim(`At ${T.start}, the page shows the speaker's card, mine, at opacity 1: fully shown.`, 's1'),
    claim('So at that same moment, every other card goes to opacity 0, and only the talker shows.', 's2'),
    old('Quick one, kiddo: if my pause were 1000 milliseconds, when would my card light up?'),
    ask('Um, later: a whole second after my question ends.'),
    claim(`Right, at ${WHAT_IF} seconds: your question ends at ${T.prevEnd}, plus one second.`, 's3'),
    claim("Slow me down: a line's start depends only on the lines before it, so my speed moves my end.", 's4'),
    old(RECAP),
  ],
};
const chapters = [];
const at = (chapter, i, phrase) => said(chapter, i, phrase);
const recordTag = (no) => `stored · ${FIRST}/beats.json:${no}`;

chapters.push({
  id: FIRST, title: 'One line, four stops',
  sources: [
    src('s1', NAR, 1, 1, 'The narration pipeline for one chapter'),
    src('s2', TPL, tplFolder, tplFolder + 1, 'besides template.json'),
    src('s3', TJ, L.idNew, L.gap, '"line_gap_ms": 550,'),
    src('s4', EJ, exSpeakers, exVoice, '"narrator_voice": "af_heart"'),
  ],
  map: {
    tour: 3,
    tourAfter: ['script', 'voice', 'timing', 'page'].map((w) => at(FIRST, 3, w)),
    // the lanes fill left to right, in the order our line travels: the script first, then one card per stop
    cards: [
      { id: 'line', lane: 'script', label: LINE, detail: 'our line', at: 1 },
      { id: 'who', lane: 'voice', label: 'who talks, how fast', detail: 'a choice', at: 6, after: at(FIRST, 6, 'who talks') },
      { id: 'pause', lane: 'timing', label: 'the pause', detail: 'a choice', at: 6, after: at(FIRST, 6, 'the pause') },
      { id: 'where', lane: 'page', label: 'where we stand', detail: 'a choice', at: 6, after: at(FIRST, 6, 'where we stand') },
    ],
    panels: [
      // the promise, drawn: what goes in, what comes out
      { id: 'promise', at: 2, until: 4, title: 'what the engine does', colour: 'var(--og-orange)',
        chain: [
          { id: 'in', label: 'a written script', detail: LINE, tone: 'script', at: 2, after: at(FIRST, 2, 'a written script') },
          { id: 'eng', label: 'the engine', detail: 'four stops', tone: 'timing', at: 2, after: at(FIRST, 2, 'into') },
          { id: 'out', label: 'a narrated video', detail: 'like this one', tone: 'page', at: 2, after: at(FIRST, 2, 'a narrated video') },
        ] },
      { id: 'folder', at: 5, until: 7, title: 'what a template is', colour: 'var(--og-yellow)',
        folder: { name: 'templates/tutor/', files: [
          { name: 'template.json', note: 'the choices: voices, speeds, pause, sides' },
          { name: 'stage.html', note: 'the page around the board' },
        ] } },
      // the other template, once, after the stops are placed: one sentence, both columns at once
      { id: 'two', at: 7, title: 'Two templates, one line',
        table: {
          head: ['', 'explainer', 'tutor'],
          rows: [
            ['who talks', { text: 'one calm voice', at: 7 }, { text: 'new guy asks, old guy answers', at: 7 }],
            ['words', { text: LINE, at: 7 }, { text: LINE, at: 7 }],
          ],
        } },
    ],
  },
});

chapters.push({
  id: 'the-voice', title: 'The line gets a voice',
  sources: [
    src('s1', TJ, L.idOld, L.voiceOld, '"voice": "bm_george",'),
    src('s2', TJ, L.speeds, L.speedOld, '"oldguy": 0.97'),
    src('s3', TPL, tplFind, tplVoice, 'return { voice: s.voice, speed:'),
    src('s4', TJ, L.gap, L.gap, '"line_gap_ms": 550,'),
  ],
  map: {
    cards: [
      { ...done.script, done: true },
      { id: 'george', lane: 'voice', label: 'George', detail: 'bm_george', at: 2 },
      { id: 'speed', lane: 'voice', label: 'speed 0.97', detail: 'new guy: 1.05', at: 3 },
      { id: 'own', lane: 'voice', label: 'each line: its own voice', at: 5 },
      { id: 'pause', lane: 'voice', label: '+ 550 ms pause', detail: 'after each line', at: 6 },
    ],
    // each code panel: the few characters that matter, big; the whole line under them, dimmed
    panels: [
      // where the line is now: written, waiting for somebody to say it (and the new guy's guess)
      { id: 'needs', lane: 'voice', at: 0, until: 2, title: 'our line, so far',
        chain: [
          { id: 'line', label: LINE, detail: 'written', tone: 'script', at: 0, after: 0.6 },
          { id: 'who', label: 'who says it', detail: 'not yet', tone: 'voice', at: 0, after: at('the-voice', 0, 'somebody') },
          { id: 'robot', label: 'a robot', detail: 'the new guy’s guess', tone: 'var(--og-dim)', at: 1, after: at('the-voice', 1, 'a robot') },
        ] },
      { id: 'who', lane: 'voice', at: 2, until: 3, title: file(TJ), size: 30,
        code: [code(TJ, L.idOld), code(TJ, L.voiceOld, 'bm_george')], lit: [{ no: L.voiceOld, at: 2, after: at('the-voice', 2, 'George') }], plain: 'my id gets the voice called George' },
      { id: 'pace', lane: 'voice', at: 3, until: 5, title: file(TJ), size: 30,
        code: [code(TJ, L.speeds + 1, '"newguy": 1.05'), code(TJ, L.speedOld, '"oldguy": 0.97')],
        lit: [{ no: L.speedOld, at: 3, after: at('the-voice', 3, '0.97') }, { no: L.speeds + 1, at: 3, after: at('the-voice', 3, '1.05') }], plain: 'the new guy talks a bit faster' },
      { id: 'find', lane: 'voice', at: 5, until: 6, title: file(TPL), size: 30,
        code: [code(TPL, tplVoice, ['s.voice', 'speed[speaker]'], "typeof speed === 'number' ? speed : ")],
        lit: [{ no: tplVoice, at: 5, after: at('the-voice', 5, 'each line') }], plain: "the speaker's voice, and the speaker's speed" },
      { id: 'gap', lane: 'voice', at: 6, until: 7, title: file(TJ), size: 30,
        code: [code(TJ, L.gap, '"line_gap_ms": 550')], lit: [{ no: L.gap, at: 6, after: at('the-voice', 6, '550') }], plain: 'a 550 ms silence after every line' },
      // the "So" line, drawn: a line, its breath, the next line
      { id: 'breath', lane: 'voice', at: 7, title: 'one line, one breath',
        bar: { span: [0, 4.4], blocks: [
          { id: 'mine', label: 'a line', from: 0, to: 1.8, tone: 'voice', at: 7, after: 0.4 },
          { id: 'gap', label: '550 ms', from: 1.8, to: 2.35, tone: 'gap', at: 7, after: 1.0 },
          { id: 'next', label: 'the next one', from: 2.35, to: 4.4, tone: 'voice', at: 7, after: 1.6 },
        ] } },
    ],
  },
});

chapters.push({
  id: 'the-timing', title: 'When the line is said',
  sources: [
    src('s1', beatsRel, T.textNo, T.endNo, `"text": ${JSON.stringify('Your todo is saved.')}`),
    src('s2', beatsRel, T.qTextNo, T.qTextNo, '"text": "Okay, dumb question:'),
    src('s3', beatsRel, T.prevEndNo, T.prevEndNo, `"end": ${T.prevEndRaw}`),
    src('s4', KOK, kokRate, kokRate, `SAMPLE_RATE = ${SAMPLE_RATE}`),
    src('s5', beatsRel, T.startNo, T.startNo, `"start": ${T.startRaw}`),
  ],
  map: {
    cards: [
      { ...done.script },
      { ...done.voice },
      { id: 'rec', lane: 'timing', label: 'timing record', detail: 'written by the tool', at: 2, after: at('the-timing', 2, 'a timing record') },
      { id: 'qend', lane: 'timing', label: `ends ${T.prevEnd} s`, detail: 'the question', at: 4, after: at('the-timing', 4, T.prevEnd) },
      { id: 'rate', lane: 'timing', label: `${RATE} a second`, detail: 'how it was measured', at: 5, after: at('the-timing', 5, RATE) },
      { id: 'start', lane: 'timing', label: `starts ${T.start} s`, detail: `${T.prevEnd} s + 550 ms`, at: 6, after: at('the-timing', 6, T.start) },
      { id: 'read', lane: 'page', label: 'reads every start', at: 7 },
    ],
    panels: [
      // where the line is now: a sound and its pause, and the question the chapter answers
      { id: 'now', lane: 'timing', at: 0, until: 2, title: 'our line, so far',
        chain: [
          { id: 'line', label: LINE, detail: 'written', tone: 'script', at: 0, after: 0.6 },
          { id: 'sound', label: 'a little sound', detail: '+ 550 ms pause', tone: 'voice', at: 0, after: at('the-timing', 0, 'a little sound') },
          { id: 'when', label: 'starts when', detail: 'the page must know', tone: 'timing', at: 1, after: at('the-timing', 1, 'when it starts') },
        ] },
      // the whole worked example in one picture, built a sentence at a time: the record's rows under their blocks,
      // the question replayed on its own block, its stored end, how that end was measured, then our start
      { id: 'bar', lane: 'timing', at: 2, title: 'this video’s timing record',
        bar: {
          span: [0, 6.2],
          blocks: [
            { id: 'q', label: 'a line', from: Number(T.qStartRaw), to: Number(T.prevEndRaw), tone: 'page', at: 2, after: at('the-timing', 2, 'each line'),
              replay: { who: 'new guy · the very start', text: '“Okay, dumb question…”', at: 3, after: at('the-timing', 3, 'the question') },
              row: `"start": ${T.qStartRaw}, "end": ${T.prevEndRaw}`, rowAt: 4, rowAfter: at('the-timing', 4, 'stores') },
            { id: 'line', label: LINE, from: Number(T.startRaw), to: Number(T.endRaw), tone: 'timing', at: 2, after: at('the-timing', 2, 'its start'),
              row: `"start": ${T.startRaw}, "end": ${T.endRaw}`, rowAt: 6, rowAfter: at('the-timing', 6, 'our line starts') },
            { id: 'gap', label: '550 ms', from: Number(T.prevEndRaw), to: Number(T.startRaw), tone: 'gap', at: 6, after: at('the-timing', 6, '550') },
          ],
          marks: [
            { id: 'qend', t: Number(T.prevEndRaw), label: `ends ${T.prevEnd} s`, tag: recordTag(T.prevEndNo), side: 'before', at: 4, after: at('the-timing', 4, T.prevEnd) },
            { id: 'frames', t: Number(T.prevEndRaw), label: `measured: ${T.frames} frames ÷ ${RATE}`, tag: 'frames counted in narration.wav', low: true, side: 'before', at: 5, after: at('the-timing', 5, T.frames) },
            { id: 'start', t: Number(T.startRaw), label: `starts ${T.start} s`, tag: recordTag(T.startNo), side: 'after', at: 6, after: at('the-timing', 6, T.start) },
          ],
        } },
    ],
  },
});

chapters.push({
  id: LAST, title: 'Who lights up',
  sources: [
    src('s1', STG, stgOn, stgOn, '{opacity: 1}, ${sec(l.start)}'),
    src('s2', STG, stgOff, stgOff, '{opacity: 0}, ${sec(l.start)}'),
    src('s3', beatsRel, T.prevEndNo, T.prevEndNo, `"end": ${T.prevEndRaw}`),
    src('s4', WAV, wavStart, wavStart, 'const start = frames / format.sampleRate;'),
  ],
  map: {
    hold: true,
    cards: [
      { ...done.script },
      { ...done.voice },
      { ...done.timing },
      { id: 'd-sides', lane: 'page', label: 'new guy left, old guy right', detail: 'where they stand', done: true },
      { id: 'on', lane: 'page', label: `${T.start} s: speaker's card on`, at: 1, after: at(LAST, 1, 'opacity 1') },
      { id: 'off', lane: 'page', label: 'every other card off', at: 2, after: at(LAST, 2, 'every other card') },
    ],
    lights: [
      // the quick check: the values the answer needs are lit while the viewer thinks
      { at: 3, cards: ['d-timing', 'on'] },
      // the recap: one stop per phrase, as it is said, ending on the page at our start
      { at: 7, after: recapAfter('Script'), cards: ['d-script'] },
      { at: 7, after: recapAfter('voice'), cards: ['d-script', 'd-voice'] },
      { at: 7, after: recapAfter('timing'), cards: ['d-script', 'd-voice', 'd-timing'] },
      { at: 7, after: recapAfter('page'), cards: ['d-script', 'd-voice', 'd-timing', 'on'] },
    ],
    panels: [
      // the code is held for its whole sentence: the few characters that matter big, with a picture of what they do
      { id: 'z-on', lane: 'page', at: 1, until: 2, title: file(STG), size: 26,
        code: [code(STG, stgOn, '{opacity: 1}', stgPush)], lit: [{ no: stgOn, at: 1, after: at(LAST, 1, 'opacity 1') }],
        pic: { items: [{ id: 'new', label: 'new guy' }, { id: 'old', label: 'old guy' }], steps: [{ at: 1, lit: ['old'] }] },
        plain: "me is the speaker's card: show it" },
      { id: 'z-off', lane: 'page', at: 2, until: 3, title: file(STG), size: 26,
        code: [code(STG, stgOff, '{opacity: 0}', stgPush)], lit: [{ no: stgOff, at: 2, after: at(LAST, 2, 'opacity 0') }],
        pic: { items: [{ id: 'new', label: 'new guy' }, { id: 'old', label: 'old guy' }], steps: [{ at: 2, lit: ['old'], dark: ['new'] }] },
        plain: 'every other card: hide it' },
      // the quick check, drawn: the timing bar again with a longer pause, a "?" where our start goes
      { id: 'wi-pause', lane: 'timing', at: 3, until: 6, title: 'quick check · a 1000 ms pause',
        bar: {
          span: [0, 7],
          blocks: [
            { id: 'q', label: 'your question', from: Number(T.qStartRaw), to: Number(T.prevEndRaw), tone: 'page', at: 3, after: 0.4 },
            { id: 'gap', label: '1000 ms', from: Number(T.prevEndRaw), to: Number(T.prevEndRaw) + 1, tone: 'gap', at: 3, after: at(LAST, 3, '1000') },
            { id: 'line', label: 'our line', from: Number(T.prevEndRaw) + 1, to: Number(T.prevEndRaw) + 1 + (Number(T.endRaw) - Number(T.startRaw)), tone: 'timing', at: 3, after: at(LAST, 3, 'my card') },
          ],
          marks: [
            { id: 'qend', t: Number(T.prevEndRaw), label: `ends ${T.prevEnd} s`, tag: recordTag(T.prevEndNo), side: 'before', at: 3, after: 0.8 },
            { id: 'start', t: Number(T.prevEndRaw) + 1, label: 'starts ?', side: 'after', at: 3, after: at(LAST, 3, 'light up'),
              then: { label: `starts ${WHAT_IF} s`, at: 5, after: at(LAST, 5, WHAT_IF) } },
          ],
        } },
      // the second what-if, drawn: same bar, our line grows, same start, later end, the next line slides right
      { id: 'wi-speed', lane: 'timing', at: 6, until: 7, title: 'what if · my voice slower',
        bar: {
          span: [0, 9.6],
          blocks: [
            { id: 'q', label: 'your question', from: Number(T.qStartRaw), to: Number(T.prevEndRaw), tone: 'page', at: 6, after: 0.4 },
            { id: 'gap', label: '', from: Number(T.prevEndRaw), to: Number(T.startRaw), tone: 'gap', at: 6, after: 0.4 },
            { id: 'line', label: 'our line', from: Number(T.startRaw), to: Number(T.endRaw), tone: 'timing', at: 6, after: 0.4,
              slide: { at: 6, after: at(LAST, 6, 'so my speed'), to: Number(T.endRaw) + 1.4 } },
            { id: 'was', label: '', from: Number(T.startRaw), to: Number(T.endRaw), tone: 'ghost', at: 6, after: at(LAST, 6, 'so my speed') },
            { id: 'gap2', label: '', from: Number(T.endRaw), to: Number(T.endRaw) + 0.55, tone: 'gap', at: 6, after: 0.4,
              slide: { at: 6, after: at(LAST, 6, 'so my speed'), from: Number(T.endRaw) + 1.4, to: Number(T.endRaw) + 1.95 } },
            { id: 'next', label: 'next line', from: Number(T.endRaw) + 0.55, to: Number(T.endRaw) + 2.55, tone: 'voice', at: 6, after: 0.4,
              slide: { at: 6, after: at(LAST, 6, 'so my speed'), from: Number(T.endRaw) + 1.95, to: Number(T.endRaw) + 3.95 } },
          ],
          marks: [
            { id: 'start', t: Number(T.startRaw), label: `my start: ${T.start} s, same`, side: 'before', at: 6, after: at(LAST, 6, 'depends') },
            { id: 'end', t: Number(T.endRaw), label: 'my end: later', low: true, side: 'after', at: 6, after: at(LAST, 6, 'so my speed'),
              slide: { at: 6, after: at(LAST, 6, 'so my speed'), t: Number(T.endRaw) + 1.4 } },
          ],
        } },
      // the recap: the four stops in one row, ending on our start; the last frame holds on it
      { id: 'recap', at: 7, title: 'one line, four stops',
        table: {
          head: ['', 'script', 'voice', 'timing', 'page'], first: 190,
          rows: [['our line', { text: LINE, at: 7 }, { text: 'George, 0.97', at: 7 }, { text: `${T.prevEnd} s + 550 ms`, at: 7 }, { text: `lit at ${T.start} s`, at: 7 }]],
        } },
    ],
  },
});
for (const c of chapters) {
  c.sentences = SAID[c.id];
  c.scene = [design(c.id)];
}

// ---- write it all ------------------------------------------------------------------------------------------------
const order = chapters.map((c) => c.id);
const allSources = [];
const md = [
  '# How the template engine tells one line (Old Guy Tutor)',
  '',
  'Request: explain the template engine so a newcomer can follow it.',
  'Flow: one spoken line travels from the script through the voice and the timing record to the page.',
  'Starts: lib/narrate.mts (voiceAsLines). Ends: lib/stage.mts (stageTimeline).',
  `Chapters: ${chapters.length}.`,
  'example: the line "your todo is saved"',
  '',
];
for (const c of chapters) {
  const spec = { id: c.id, title: c.title, sources: c.sources, sentences: c.sentences, scene: c.scene };
  fs.writeFileSync(path.join(video, 'specs', `${c.id}.json`), `${JSON.stringify(spec, null, 2)}\n`);
  fs.writeFileSync(path.join(video, 'scenes', `${c.id}.html`), mapScene({ kicker: KICK, title: c.title, ...c.map }));
  for (const s of c.sources) allSources.push({ chapter: c.id, ...s });
  md.push(`## ${c.id} — ${c.title}`);
  c.sentences.forEach((s, i) => md.push(`${i} ${s.speaker.padEnd(13)} ${s.kind === 'claim' ? `claim ${s.source_ids.join(',')}` : 'framing'}  ${s.text}`));
  md.push('');
}
fs.writeFileSync(path.join(video, 'script.md'), md.join('\n'));
fs.writeFileSync(path.join(video, 'sources.json'), `${JSON.stringify(allSources, null, 2)}\n`);
fs.writeFileSync(path.join(video, 'order.json'), `${JSON.stringify({ chapters: order })}\n`);
console.log(`wrote ${order.length} chapters to ${videoRel} (${T.real ? 'real times' : 'placeholder times: narrate the first chapter, then run again'})`);
console.log(order.join(','));
