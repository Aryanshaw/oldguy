// Worked example: the make script that built this template's sample video (sample.mp4), kept here as a reference.
// It ran from .oldguy/sample-real-life-analogy/ in the oldguy repository (paths below are relative to that folder);
// copy its shape, not its paths, into your own .oldguy/<slug>/make.mjs.

// Writes script.md, sources.json, scenes/<id>.html and specs/<id>.json for the real-life-analogy sample: the same
// question as the other templates' samples (how the template engine tells one line), told as a theatre. Our line,
// "your todo is saved", goes from the script to the actor (the voice), the cue book (the timing record) and the
// stage (the page). Every scene is built with the template's kit; the times are the real ones from this video's own
// first chapter, read once it is narrated (run this again after narrating why-templates).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '..', '..');
const slug = path.basename(here);
const RLA = createRequire(import.meta.url)(path.join(repo, 'templates/real-life-analogy/kit/kit.js'));
fs.mkdirSync(path.join(here, 'specs'), { recursive: true });
fs.mkdirSync(path.join(here, 'scenes'), { recursive: true });

const claim = (text, ...ids) => ({ text, kind: 'claim', source_ids: ids });
const framing = (text) => ({ text, kind: 'framing', source_ids: [] });
// The 1-based line holding `needle` in a repository file (the first after `after`), so quotes never drift.
function lineOf(file, needle, after = 0) {
  const rows = fs.readFileSync(path.join(repo, file), 'utf8').split('\n');
  const i = rows.findIndex((l, k) => k >= after && l.includes(needle));
  if (i === -1) throw new Error(`${file}: "${needle}" not found`);
  return i + 1;
}
const src = (id, file, needle, span = 0, quote = needle) => {
  const n = lineOf(file, needle);
  return { id, file, lines: [n - span, n], quote };
};
// Whole lines from the repository, the common indent removed.
function lines(file, from, to) {
  const all = fs.readFileSync(path.join(repo, file), 'utf8').split('\n').slice(from - 1, to);
  const indent = Math.min(...all.map((l) => l.length - l.trimStart().length));
  return all.map((l) => l.slice(indent).trimEnd());
}

// ---- the real times, from the first chapter once narrated ---------------------------------------------------------
const FIRST = 'why-templates';
const beatsRel = `.oldguy/${slug}/chapters/${FIRST}/beats.json`;
const two = (x) => (Math.round(x * 100 + 1e-6) / 100).toFixed(2); // half up, so 4.115 shows as 4.12
let T = null;
if (fs.existsSync(path.join(repo, beatsRel))) {
  const text = fs.readFileSync(path.join(repo, beatsRel), 'utf8');
  const [b0, b1] = JSON.parse(text).beats;
  const rows = text.split('\n');
  const find = (key, v, from = 0) => rows.findIndex((l, i) => i >= from && l.includes(`"${key}": ${v}`)) + 1;
  const endNo = find('end', b0.end);
  const startNo = find('start', b1.start, endNo);
  T = { prevEnd: two(b0.end), start: two(b1.start), end: two(b1.end), plus1: two(b0.end + 1), endNo, startNo, endRaw: `"end": ${b0.end}`, startRaw: `"start": ${b1.start}`, lineEndRaw: `"end": ${b1.end}`, startRawNum: b1.start };
}

// ---- the first chapter's built page: the timeline that lights our line's card --------------------------------------
const pageRel = `.oldguy/${slug}/chapters/${FIRST}/index.html`;
let PG = null;
if (fs.existsSync(path.join(repo, pageRel))) {
  const rows = fs.readFileSync(path.join(repo, pageRel), 'utf8').split('\n');
  const bi = rows.findIndex((l) => l.startsWith('const oldguyBeats = ['));
  const li = rows.findIndex((l) => l.startsWith('tl.to("#w-line", '));
  if (bi !== -1 && li !== -1) PG = { rel: pageRel, beatsNo: bi + 1, beatsLine: [rows[bi]], lineNo: li + 1, lineQuote: rows[li] };
}

// ---- sources ------------------------------------------------------------------------------------------------------
const TJ = 'templates/real-life-analogy/template.json';
const S = {
  folder: src('s1', TJ, '"line_gap_ms": 650,', 1),
  explainer: src('s2', 'templates/explainer/template.json', '"line_gap_ms": 700,', 1),
  voice: src('s1', TJ, '"voice_speed": 0.95,', 2),
  once: src('s2', 'lib/voice.mts', 'const r = await run(python, [SPEAK_PY, model, voices, request]);'),
  gap: src('s3', TJ, '"line_gap_ms": 650,'),
  so: src('s4', 'lib/narrate.mts', '/^So\\b/.test(text.trim()) ? gapMs * 2 : gapMs'),
  frames: src('s1', 'lib/wav.mts', 'const start = frames / format.sampleRate;'),
  pieces: src('s5', 'lib/narrate.mts', 'const pieces = pieceWindows(chapter.scene, beats, durationS'),
  driver: src('s1', 'lib/stage.mts', 'function buildStagePage({ id, template, shape, timing, pieces, stage }: StageInput): string {'),
  slot: src('s2', 'lib/stage.mts', "scaled into the shape's slot box", 1, "the chapter's scene, drawn at 1920x1080 and scaled into the shape's slot box"),
  recorded: src('s5', 'lib/narrate.mts', "fs.writeFileSync(path.join(work, 'index.html'), buildStagePage(", 13, '? await voiceAsLines(work, chapter, sentences, t, deps)'),
};

// ---- the shared look: one theatre for the whole video ------------------------------------------------------------
const FLOOR = 820;
const ACTOR = { head: 'heart', hair: 'long', hairColor: 'coral', skin: 'peach', glasses: true, outfit: 'dress', shirt: 'sky' };
const actor = (id, o) => RLA.person(Object.assign({ id, s: 0.8, y: FLOOR + 14 }, ACTOR, o));
function theatre(sc, p) {
  sc.set(RLA.prop('curtain', { id: `${p}-curtain`, x: 960, y: 540 }).svg);
  sc.set(RLA.prop('platform', { id: `${p}-stage`, x: 960, y: FLOOR + 30, w: 1700 }).svg);
}
const lineCard = (id, x, y) => RLA.card({ id, x, y, title: ['our line:', 'your todo is saved'] });

const scenes = {};

// ---- why-templates: one line, two stagings ------------------------------------------------------------------------
{
  const sc = RLA.scene({ id: 'why-templates', ground: 'indigo', floor: FLOOR });
  theatre(sc, 'w');
  const writer = RLA.cast('writer', { id: 'w-writer', x: 200, y: FLOOR + 14, s: 0.62, pose: 'hold', face: 'worried', holding: { prop: 'paper', s: 0.42, dy: -30 } });
  sc.add(0, writer, { focus: true, delay: 0.4 });
  const you = RLA.card({ id: 'w-you', x: 380, y: 300, title: ['you:', 'one script'] });
  sc.add(0, you, { extra: true, delay: 0.8 });
  sc.add(0, RLA.strings({ id: 'w-you-str', from: you.bottom(2), to: [[250, writer.anchors.top[1] + 60], [280, writer.anchors.top[1] + 90]] }), { extra: true, delay: 1.2 });
  const page = [writer.anchors.hand[0], writer.anchors.hand[1] - 30];
  const line = lineCard('w-line', 40, 60);
  sc.add(1, line, { focus: { x: page[0], y: page[1], r: 100 }, pin: true });
  sc.add(1, RLA.strings({ id: 'w-line-str', from: [[150, line.box[3]]], to: [[page[0] - 10, page[1] - 52]] }), { extra: true, delay: 0.7 });
  const a = actor('w-actor', { x: 1040, s: 0.55, face: 'pleased' });
  sc.add(2, a, { focus: true });
  const tA = RLA.prop('parcel', { id: 'w-tpl-a', x: 690, y: 752, s: 0.62 });
  const cardA = RLA.card({ id: 'w-tpl-a-card', x: 540, y: 40, title: ['this template:', 'real-life-analogy'], lines: lines(TJ, S.folder.lines[0], S.folder.lines[1]), file: `template.json · lines ${S.folder.lines[0]}–${S.folder.lines[1]}`, hl: { line: 0, word: '0.95' } });
  sc.add(3, tA, { focus: true });
  sc.add(3, cardA, { extra: true, delay: 0.6 });
  sc.add(3, RLA.strings({ id: 'w-tpl-a-card-str', from: [[680, cardA.box[3]]], to: [[680, 662]] }), { extra: true, delay: 1 });
  const tB = RLA.prop('parcel', { id: 'w-tpl-b', x: 1400, y: 752, s: 0.62, colour: 'lilac' });
  const cardB = RLA.card({ id: 'w-tpl-b-card', x: 1220, y: 40, title: ['another template:', 'explainer'], lines: lines('templates/explainer/template.json', S.explainer.lines[0], S.explainer.lines[1]), file: `template.json · lines ${S.explainer.lines[0]}–${S.explainer.lines[1]}`, hl: { line: 0, word: '0.9' } });
  sc.add(4, tB, { focus: true });
  sc.add(4, cardB, { extra: true, delay: 0.6 });
  sc.add(4, RLA.strings({ id: 'w-tpl-b-card-str', from: [[1400, cardB.box[3]]], to: [[1400, 662]] }), { extra: true, delay: 1 });
  sc.add(5, RLA.prop('spotlight', { id: 'w-spot', x: 1780, y: 690, s: 0.9, flip: true, beam: [720, 150] }), { focus: { x: a.focus.x, y: a.focus.y, r: a.focus.r }, enter: 'fade' });
  sc.add(5, RLA.arrow({ id: 'w-arrow-a', from: [770, 640], to: [960, 560], bend: -0.2 }), { extra: true, delay: 0.6 });
  sc.add(5, RLA.arrow({ id: 'w-arrow-b', from: [1320, 640], to: [1120, 560], bend: 0.2 }), { extra: true, delay: 0.8 });
  scenes['why-templates'] = {
    title: 'One line, two stagings',
    sources: [S.folder, S.explainer],
    sentences: [
      framing('Without templates, every video would sound and look exactly the same.'),
      framing('For example, take one line from a script: your todo is saved.'),
      framing('Picture that line in a play, with an actor, a cue book and a stage.'),
      claim('A template is the theatre company: a folder that sets how fast the voice speaks and the pause between lines.', 's1'),
      claim('Another template, the explainer, stages the same line slower, at 0.9, with a 700 millisecond pause.', 's2'),
      framing('So one script can be staged in many ways, one template at a time.'),
    ],
    sc,
  };
}

// ---- the-voice: the actor speaks the line -------------------------------------------------------------------------
{
  const sc = RLA.scene({ id: 'the-voice', ground: 'indigo', floor: FLOOR });
  theatre(sc, 'v');
  const a = actor('v-actor', { x: 700, s: 0.75, pose: 'hold', face: 'pleased', holding: { prop: 'paper', s: 0.42, dy: -30 } });
  sc.set(RLA.prop('microphone', { id: 'v-mic', x: 1640, y: 720, s: 1 }).svg);
  sc.set(a.svg);
  const page = [a.anchors.hand[0], a.anchors.hand[1] - 30];
  const line = lineCard('v-line', 900, 140);
  sc.add(0, line, { focus: { x: page[0], y: page[1], r: 110 }, delay: 0.4, pin: true });
  sc.add(0, RLA.strings({ id: 'v-line-str', from: line.bottom(2), to: [page[0], page[1] - 52] }), { extra: true, delay: 1 });
  const voice = RLA.card({ id: 'v-voice', x: 150, y: 30, title: 'the actor: af_heart at 0.95', lines: lines(TJ, S.voice.lines[1], S.voice.lines[1]), file: `real-life-analogy/template.json · line ${S.voice.lines[1]}`, hl: { line: 0, word: '0.95' } });
  sc.add(1, voice, { focus: a.focus });
  sc.add(1, RLA.strings({ id: 'v-voice-str', from: [[560, voice.box[3]], [760, voice.box[3]]], to: [[650, a.anchors.top[1] + 40], [740, a.anchors.top[1] + 40]] }), { extra: true, delay: 0.7 });
  const once = RLA.card({ id: 'v-once', x: 1250, y: 380, title: 'one voice, loaded once', file: `lib/voice.mts · line ${S.once.lines[0]}` });
  sc.add(2, once, { focus: { x: 1640, y: 630, r: 120 } });
  sc.add(2, RLA.strings({ id: 'v-once-str', from: once.bottom(2), to: [1640, 586] }), { extra: true, delay: 0.7 });
  const clock = RLA.prop('clock', { id: 'v-clock', x: 1180, y: 560, s: 0.7, h: 0, m: 0 });
  sc.add(3, clock, { focus: true });
  const pause = RLA.card({ id: 'v-pause', x: 860, y: 760, title: 'pause: 650 ms, twice after so', lines: lines('lib/narrate.mts', S.so.lines[0], S.so.lines[1]), file: `lib/narrate.mts · line ${S.so.lines[0]}`, hl: { line: 0, word: 'gapMs * 2' } });
  sc.add(3, pause, { extra: true, delay: 0.7 });
  sc.add(3, RLA.strings({ id: 'v-pause-str', from: [[1110, 760], [1250, 760]], to: [[1150, 636], [1210, 636]] }), { extra: true, delay: 1.1 });
  sc.add(4, RLA.ring({ id: 'v-ring', x: 1180, y: 560, rx: 108, ry: 108 }), { extra: true });
  scenes['the-voice'] = {
    title: 'The actor speaks the line',
    sources: [S.voice, S.once, S.gap, S.so],
    sentences: [
      framing('Our line, your todo is saved, now reaches the actor.'),
      claim('The actor is a voice called af_heart, set in this template to a speed of 0.95.', 's1'),
      claim('One voice process loads the model once, then speaks each sentence on its own.', 's2'),
      claim('After each sentence come 650 milliseconds of silence, twice that after a sentence starting with So.', 's3', 's4'),
      claim('So every point gets a moment to land before the next one starts.', 's4'),
    ],
    sc,
  };
}

// ---- the-timing: the cue book, in the wings -----------------------------------------------------------------------
if (T) {
  const sc = RLA.scene({ id: 'the-timing', ground: 'indigo', floor: FLOOR });
  theatre(sc, 't');
  sc.set(RLA.prop('conveyor', { id: 't-belt', x: 640, y: 790, w: 820 }).svg);
  const TY = 728;
  const ticket = (id, x, c) => RLA.prop('ticket', { id, x, y: TY, s: 0.55, colour: c });
  const tTop = TY - 36;
  const row = RLA.group('t-row', [ticket('t-before', 360, 'peach'), ticket('t-ours', 640, 'yellow'), ticket('t-after', 920, 'coral')], { x: 640, y: TY, r: 95 });
  sc.add(0, row, { focus: true, delay: 0.4 });
  const sounds = RLA.card({ id: 't-sounds', x: 300, y: 420, title: ['sounds, one per sentence', 'ours: your todo is saved'] });
  sc.add(0, sounds, { extra: true, delay: 0.8 });
  sc.add(0, RLA.strings({ id: 't-sounds-str', from: sounds.bottom(3), to: [[360, tTop], [640, tTop], [920, tTop]] }), { extra: true, delay: 1.2 });
  const mgr = RLA.cast('manager', { id: 't-mgr', x: 1480, y: FLOOR + 14, s: 0.6, pose: 'hold', face: 'focused', holding: { prop: 'clipboard', s: 0.5, dy: -40, rot: -8 } });
  sc.add(1, mgr, { focus: true });
  const who = RLA.card({ id: 't-who', x: 1180, y: 60, title: ['the stage manager:', 'joins the sounds'], file: `lib/wav.mts · line ${S.frames.lines[0]}` });
  sc.add(1, who, { extra: true, delay: 0.6 });
  sc.add(1, RLA.strings({ id: 't-who-str', from: [[1420, who.box[3]], [1540, who.box[3]]], to: [[1450, mgr.anchors.top[1] + 30], [1520, mgr.anchors.top[1] + 30]] }), { extra: true, delay: 1 });
  const wave = RLA.prop('waveform', { id: 't-wave', x: 640, y: 330, s: 0.8 });
  sc.add(2, wave, { focus: true });
  const code = RLA.card({ id: 't-code', x: 260, y: 40, title: 'a start = samples ÷ rate', lines: lines('lib/wav.mts', S.frames.lines[0], S.frames.lines[1]), file: `lib/wav.mts · line ${S.frames.lines[0]}`, hl: { line: 0, word: 'sampleRate' } });
  sc.add(2, code, { extra: true, delay: 0.6 });
  sc.add(2, RLA.strings({ id: 't-code-str', from: [[560, code.box[3]], [720, code.box[3]]], to: [[560, 256], [720, 256]] }), { extra: true, delay: 1 });
  const before = RLA.card({ id: 't-before-card', x: 30, y: 420, title: ['the line before:', '"without templates…"'], lines: [T.endRaw], file: `beats.json · line ${T.endNo}`, hl: { line: 0, word: String(T.endRaw.split(': ')[1]) } });
  sc.add(3, before, { focus: { x: 360, y: TY, r: 95 } });
  sc.add(3, RLA.strings({ id: 't-before-card-str', from: [[340, before.box[3]]], to: [[360, tTop]] }), { extra: true, delay: 0.6 });
  const sum = RLA.card({ id: 't-sum', x: 720, y: 400, title: 'our line', lines: [`${T.prevEnd} + 0.65 = ${T.start}`, `ends at ${T.end}`] });
  sc.add(4, sum, { focus: { x: 640, y: TY, r: 95 } });
  sc.add(4, RLA.strings({ id: 't-sum-str', from: [[760, sum.box[3]]], to: [[660, tTop]] }), { extra: true, delay: 0.6 });
  const clip = [mgr.anchors.hand[0], mgr.anchors.hand[1] - 40];
  const book = RLA.card({ id: 't-book', x: 1260, y: 70, title: 'the cue book', lines: [T.startRaw + ',', T.lineEndRaw], file: `beats.json · lines ${T.startNo}–${T.startNo + 1}`, hl: { line: 0, word: String(T.startRaw.split(': ')[1]) } });
  sc.add(5, book, { focus: { x: clip[0], y: clip[1], r: 110 } });
  sc.add(5, RLA.strings({ id: 't-book-str', from: [[clip[0] - 20, book.box[3]]], to: [[clip[0], clip[1] - 72]] }), { extra: true, delay: 0.6 });
  sc.camera(5, { x: 1300, y: 520, zoom: 1.08 });
  const a = actor('t-actor', { x: 1190, s: 0.5, face: 'pleased' });
  sc.add(6, a, { focus: true });
  sc.add(6, RLA.arrow({ id: 't-arrow', from: [clip[0] - 70, clip[1] + 10], to: [1270, a.anchors.head[1] + 60], bend: -0.25 }), { extra: true, delay: 0.6 });
  sc.camera(6, { x: 960, y: 540, zoom: 1 });
  scenes['the-timing'] = {
    title: 'The cue book',
    sources: [
      S.frames,
      { id: 's2', file: beatsRel, lines: [T.endNo, T.endNo], quote: T.endRaw },
      { id: 's3', file: beatsRel, lines: [T.startNo, T.startNo + 1], quote: T.startRaw },
      { id: 's4', file: TJ, lines: S.gap.lines, quote: S.gap.quote },
      S.pieces,
    ],
    sentences: [
      framing('In the wings, our line, your todo is saved, is now one sound in a row of sounds.'),
      claim('The stage manager joins all the sounds into one file, counting each start from the sound itself.', 's1'),
      claim('A start is the samples so far, divided by the samples per second.', 's1'),
      claim(`The sentence before ours, the one about templates, ends at ${T.prevEnd} seconds.`, 's2'),
      claim(`Add the 650 millisecond pause, and our line runs from ${T.start} to ${T.end} seconds.`, 's3', 's4'),
      claim('Every start and end goes into the timing record, our cue book, one row per sentence.', 's3'),
      claim('So the stage can light our line at the very moment it is heard.', 's5'),
    ],
    sc,
  };
}

// ---- the-page: the stage lights up ---------------------------------------------------------------------------------
if (T && PG) {
  const sc = RLA.scene({ id: 'the-page', ground: 'indigo', floor: FLOOR, cards: 1 });
  theatre(sc, 'p');
  const a = actor('p-actor', { x: 600, s: 0.6, pose: 'hold', face: 'pleased', holding: { prop: 'paper', s: 0.42, dy: -30 } });
  sc.set(a.svg);
  const page = [a.anchors.hand[0], a.anchors.hand[1] - 30];
  const line = lineCard('p-line', 40, 60);
  sc.add(0, line, { extra: true, delay: 0.3, pin: true });
  sc.add(0, RLA.strings({ id: 'p-line-str', from: [line.bottom(2)[1]], to: [[page[0], page[1] - 52]] }), { extra: true, delay: 0.7 });
  const crew = RLA.cast('clerk', { id: 'p-crew', x: 960, y: FLOOR + 14, s: 0.55, pose: 'point', face: 'focused' });
  sc.add(0, crew, { focus: true, delay: 1 });
  const drv = RLA.card({ id: 'p-drv', x: 700, y: 60, title: ['the stage driver:', 'buildStagePage'], file: `lib/stage.mts · line ${S.driver.lines[0]}` });
  sc.add(0, drv, { extra: true, delay: 1.4 });
  sc.add(0, RLA.strings({ id: 'p-drv-str', from: [[900, drv.box[3]], [1000, drv.box[3]]], to: [[945, crew.anchors.top[1] + 30], [985, crew.anchors.top[1] + 30]] }), { extra: true, delay: 1.8 });
  const SX = 1440;
  const SY = 470;
  const SW = 640;
  const SH = SW * 9 / 16;
  const scr = RLA.prop('screen', { id: 'p-screen', x: SX, y: SY, w: SW });
  sc.add(1, scr, { focus: { x: SX, y: SY, r: 360 } });
  sc.add(1, RLA.frame({ id: 'p-slot-frame', x: SX - SW / 2 + 14, y: SY - SH / 2 + 14, w: SW - 28, h: SH - 28 }), { extra: true, delay: 0.6 });
  const slot = RLA.card({ id: 'p-slot', x: 1230, y: 60, title: ['the slot:', 'where the scene goes'], file: `lib/stage.mts · lines ${S.slot.lines[0]}–${S.slot.lines[1]}` });
  sc.add(1, slot, { extra: true, delay: 0.9 });
  sc.add(1, RLA.strings({ id: 'p-slot-str', from: [[1340, slot.box[3]], [1540, slot.box[3]]], to: [[1340, SY - SH / 2 - 22], [1540, SY - SH / 2 - 22]] }), { extra: true, delay: 1.3 });
  const tlc = RLA.card({ id: 'p-tl', x: 700, y: 60, title: "the page's timeline", lines: PG.beatsLine, file: `why-templates/index.html · line ${PG.beatsNo}`, hl: { line: 0, word: String(T.startRawNum) } });
  sc.add(2, tlc, { focus: { x: SX, y: SY, r: 370 } });
  sc.add(2, RLA.strings({ id: 'p-tl-str', from: [[1500, tlc.box[3]]], to: [[1500, SY - SH / 2 - 22]] }), { extra: true, delay: 0.6 });
  const mini = RLA.card({ id: 'p-mini', x: SX - 250, y: SY - 110, w: 500, title: ['our line:', 'your todo is saved'] });
  sc.add(3, mini, { focus: { x: SX, y: SY - 26, r: 270 }, pin: true });
  const mic = RLA.prop('microphone', { id: 'p-mic', x: 200, y: 700, s: 0.8 });
  sc.add(4, mic, { focus: true });
  const rec = RLA.card({ id: 'p-rec', x: 20, y: 290, title: ['not live:', 'recorded first'], file: `lib/narrate.mts · lines ${S.recorded.lines[0]}–${S.recorded.lines[1]}` });
  sc.add(4, rec, { extra: true, delay: 0.6 });
  sc.add(4, RLA.strings({ id: 'p-rec-str', from: [[200, rec.box[3]]], to: [[200, 590]] }), { extra: true, delay: 1 });
  const clock = RLA.prop('clock', { id: 'p-clock', x: 1130, y: 205, s: 0.55, h: 5, m: 30 });
  sc.add(5, clock, { focus: true });
  const ask = RLA.card({ id: 'p-ask', x: 600, y: 60, title: 'pause 1000 ms?' });
  sc.add(5, ask, { extra: true, delay: 0.6 });
  sc.add(5, RLA.strings({ id: 'p-ask-str', from: [[980, ask.box[3]]], to: [[1075, 205]] }), { extra: true, delay: 1 });
  const ans = RLA.card({ id: 'p-ans', x: 720, y: 210, lines: [`${T.prevEnd} + 1.00 = ${T.plus1}`] });
  sc.add(6, ans, { focus: { x: 1130, y: 205, r: 80 } });
  sc.add(7, RLA.underline({ id: 'p-under', x: 360, y: 845, w: 1200 }), { extra: true });
  scenes['the-page'] = {
    title: 'The stage lights up',
    sources: [S.driver, S.slot,
      { id: 's3', file: PG.rel, lines: [PG.beatsNo, PG.beatsNo], quote: PG.beatsLine[0] },
      { id: 's4', file: PG.rel, lines: [PG.lineNo, PG.lineNo], quote: PG.lineQuote },
      S.recorded,
      { id: 's6', file: beatsRel, lines: [T.endNo, T.endNo], quote: T.endRaw },
    ],
    sentences: [
      claim('Last stop: buildStagePage builds the page for our line, your todo is saved, from the template and cue book.', 's1'),
      claim("The template's layout has a slot, the box on the page where the chapter's scene goes.", 's2'),
      claim(`The page's timeline holds every start from the cue book, ours at ${T.startRawNum}.`, 's3'),
      claim(`So at ${T.start} seconds our line's card rises on the page, as af_heart says it.`, 's3', 's4'),
      claim('Where the picture breaks: nothing here is live, the sound is recorded first and the page built to match.', 's5'),
      framing('Quick check: if the pause were 1000 milliseconds, when would our line start?'),
      claim(`At ${T.plus1} seconds: the sentence before still ends at ${T.prevEnd}, plus one full second.`, 's6'),
      framing('One script, one actor, one cue book, one stage.'),
    ],
    sc,
  };
}

// ---- write everything --------------------------------------------------------------------------------------------
const ORDER = ['why-templates', 'the-voice', 'the-timing', 'the-page'];
let bad = 0;
const allSources = [];
for (const id of ORDER) {
  const c = scenes[id];
  if (!c) continue;
  const built = c.sc.build();
  if (built.problems.length) {
    bad++;
    console.error(`${id}: ${built.problems.join('; ')}`);
  }
  fs.writeFileSync(path.join(here, 'scenes', `${id}.html`), built.html);
  const spec = { id, title: c.title, sources: c.sources, sentences: c.sentences, scene: [{ piece: 'design', params: { file: `scenes/${id}.html` }, beat: 0 }] };
  fs.writeFileSync(path.join(here, 'specs', `${id}.json`), `${JSON.stringify(spec, null, 2)}\n`);
  for (const s of c.sources) allSources.push({ chapter: id, ...s });
  console.log(`${id}: scene ${Math.round(built.html.length / 1024)} KB, ${c.sentences.length} sentences`);
}
fs.writeFileSync(path.join(here, 'sources.json'), `${JSON.stringify(allSources, null, 2)}\n`);
const md = [
  '# How the template engine tells one line, as a theatre',
  '',
  'Request: explain the template engine so a newcomer can follow it.',
  'Flow: one spoken line travels from the script through the voice and the timing record to the chapter page.',
  'Starts: lib/narrate.mts (voiceAsLines). Ends: lib/stage.mts (buildStagePage).',
  `Chapters: ${ORDER.length}.`,
  'example: the line "your todo is saved"',
  'analogy: a theatre staging one line of a play',
  '- the script = the chapter\'s sentences (specs/<id>.json)',
  `- the theatre company = the template folder (${TJ}); a second company = templates/explainer/template.json`,
  `- the actor = the voice af_heart at 0.95 (${TJ}:${S.voice.lines[1]})`,
  `- the pause between lines = line_gap_ms 650 (${TJ}:${S.gap.lines[0]})`,
  '- the tickets on the belt = the sounds, one per sentence',
  `- the stage manager = the joiner that counts each start (lib/wav.mts:${S.frames.lines[0]})`,
  `- the cue book = the timing record beats.json (lib/wav.mts:${S.frames.lines[0]})`,
  `- the stage driver = buildStagePage (lib/stage.mts:${S.driver.lines[0]})`,
  `- the stage = the page built by buildStagePage (lib/stage.mts:${S.driver.lines[0]})`,
  "- where it breaks: a play is live; here the sound is recorded first and the page built to match",
  '',
];
for (const id of ORDER) {
  const c = scenes[id];
  if (!c) continue;
  md.push(`## ${id} — ${c.title}`);
  c.sentences.forEach((s, i) => md.push(`${i} ${s.kind}${s.source_ids.length ? ' ' + s.source_ids.join(',') : ''}  ${s.text}`));
  md.push('');
}
fs.writeFileSync(path.join(here, 'script.md'), md.join('\n'));
if (bad) process.exit(1);
