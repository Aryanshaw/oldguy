// The narration pipeline for one chapter: speech, padding, beat timing, captions and the root composition.
// Every outside program goes through the injected `run`, so tests never call Hyperframes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWav, padWav } from './wav.mts';
import { beatsFromDuration, beatsFromWords } from './beats.mts';
import { buildCaptions } from './captions.mts';
import { checkScene, checkSentences, checkNarrationText, narrationSentences, roundUpTenth, pieceWindows, GSAP_NAME, GSAP_FILE } from './chapter.mts';
import { buildStagePage, stageAssets } from './stage.mts';
import { estimateWords, anchorTime } from './word-times.mts';
import { speakLines } from './voice.mts';
import { voiceFor } from './template.mts';
import { readVideoChoice, slugDirOfChapter, templateOfVideo } from './settings.mts';
import { checkAgainstTemplate } from './template-checks.mts';
import { assetPath, missingAssets, megabytes } from './assets.mts';
import { hyperframesArgs } from './hyperframes.mts';
import { buildRecord, COMMIT } from './build-record.mts';
import type { Beat, Word } from './beats.mts';
import type { Caption } from './captions.mts';
import type { ChapterSpec } from './chapter.mts';
import type { Shape, Template } from './template.mts';
import type { Timing } from './word-times.mts';

// What a finished program run gives back.
type ProgramResult = { code: number | null; stdout?: string; stderr?: string };
// Runs a program with an argument list and optional extra environment; the real one lives in cli/narrate, tests hand in a fake.
type RunProgram = (cmd: string, args: string[], env?: Record<string, string>) => Promise<ProgramResult>;
// What narrateChapter needs from outside: the program runner, the python for speech, whether word timing is available, the repo root.
// The template and shape default to the video folder's (video.json); `kokoro` names the voice model files the
// many-voices path loads (by default the ones Hyperframes downloaded into its cache).
type NarrateDeps = {
  run: RunProgram; venvPython: string; whisperAvailable: boolean; root?: string;
  template?: Template; shape?: Shape; kokoro?: { model: string; voices: string }; dataDir?: string;
};
// How a run timed its sentences: heard words (whisper), a share of the audio by length, or exact per-line audio.
type TimingKind = 'words' | 'sentence-share' | 'lines';
// What a narration run measured and wrote.
type NarrateResult = { durationS: number; timing: TimingKind; beats: Beat[]; captions: Caption; commit: string | null };
// The narration audio and its sentence beats, from either voice path.
type Voiced = { padded: Buffer; durationS: number; timing: TimingKind; beats: Beat[] };

const LEAD_MS = 40;
const TAIL_MS = 120;
// The files a finished narration leaves in the chapter folder; build.json goes last so a half-finished move never matches it.
const OUTPUTS = ['narration.wav', 'beats.json', 'captions.vtt', 'captions.json', 'index.html', GSAP_NAME, 'build.json'];
const KOKORO_DIR = path.join(os.homedir(), '.cache', 'hyperframes', 'tts');
// The voice model files Hyperframes downloads on its first tts run (oldguy setup's voice item does that run).
const KOKORO_FILES = { model: path.join(KOKORO_DIR, 'models', 'kokoro-v1.0.onnx'), voices: path.join(KOKORO_DIR, 'voices', 'voices-v1.0.bin') };

// Reads the `error` from a `--json` summary on stdout, where Hyperframes reports failures; null when there is none.
function jsonError(stdout: string | undefined): string | null {
  try {
    const error = (JSON.parse(String(stdout || '').trim()) as { error?: unknown }).error;
    return typeof error === 'string' && error.trim() ? error.trim() : null;
  } catch {
    return null;
  }
}

// Runs the pinned Hyperframes (`npx --yes hyperframes@<version> <args>`) and turns a failed exit into an error carrying
// the program's own reason: its stderr, else the error in its JSON stdout, else the exit code.
async function hyperframes(run: RunProgram, args: string[], env: Record<string, string>): Promise<ProgramResult> {
  const r = await run('npx', hyperframesArgs(args), env);
  if (r.code !== 0) {
    const why = String(r.stderr || '').trim() || jsonError(r.stdout) || `exit code ${r.code}`;
    throw new Error(`hyperframes ${args[0]} failed: ${why}`);
  }
  return r;
}

// Asks Hyperframes for word timings of the padded audio and reads the word list it writes.
async function transcribeWords(run: RunProgram, wavPath: string, env: Record<string, string>): Promise<Word[]> {
  const r = await hyperframes(run, ['transcribe', wavPath, '--json'], env);
  let transcriptPath: string;
  try {
    // Hyperframes promises this field; if it is missing, path.resolve below fails loudly, as before
    transcriptPath = (JSON.parse(r.stdout as string) as { transcriptPath: string }).transcriptPath;
  } catch {
    throw new Error('hyperframes transcribe did not print the JSON summary with transcriptPath');
  }
  const words: unknown = JSON.parse(fs.readFileSync(path.resolve(path.dirname(wavPath), transcriptPath), 'utf8'));
  if (!Array.isArray(words)) throw new Error(`${transcriptPath} is not a list of words`);
  // the recogniser's list is used as it is; beatsFromWords copes with what it holds
  return words as Word[];
}

// Cuts beat times back to the audio's real length: whisper can place the last word's end after the audio stops,
// which would leave a caption on screen after the chapter ends.
function clampBeats(beats: Beat[], audioS: number): Beat[] {
  const endS = Math.floor(audioS * 1000) / 1000;
  return beats.map((b) => ({ ...b, start: Math.min(b.start, endS), end: Math.min(b.end, endS) }));
}

// The narrator path without gaps (a template with no speakers and no silence between sentences): one tts call for the
// whole text, with the sentence times from whisper's words or a share of the audio by length. The voice and speed are
// passed only when the template asks for something other than Hyperframes' own default.
async function voiceAsNarrator(work: string, sentences: string[], verifiedText: Buffer, t: Template, { run, venvPython, whisperAvailable }: NarrateDeps): Promise<Voiced> {
  const env = { HYPERFRAMES_PYTHON: venvPython };
  // tts reads a private copy of the bytes that were checked, so a later edit to narration.txt cannot be spoken
  const textPath = path.join(work, 'narration.txt');
  fs.writeFileSync(textPath, verifiedText);
  const rawPath = path.join(work, 'narration.raw.wav');
  const { voice, speed } = voiceFor(t, undefined);
  const extra = [...(voice !== 'af_heart' ? ['--voice', voice] : []), ...(speed !== 1 ? ['--speed', String(speed)] : [])];
  await hyperframes(run, ['tts', textPath, '-o', rawPath, ...extra, '--json'], env);

  // a little silence at both ends so chapters do not click where they join
  const raw = fs.readFileSync(rawPath);
  const padded = padWav(raw, { leadMs: LEAD_MS, tailMs: TAIL_MS });
  const wavPath = path.join(work, 'narration.wav');
  fs.writeFileSync(wavPath, padded);

  // word timings come from the padded audio, so they already include the lead silence
  const timing = whisperAvailable ? 'words' : 'sentence-share';
  const beats = clampBeats(whisperAvailable
    ? beatsFromWords(sentences, await transcribeWords(run, wavPath, env))
    : beatsFromDuration(sentences, parseWav(raw).durationS, { leadS: LEAD_MS / 1000 }), parseWav(padded).durationS);
  return { padded, durationS: roundUpTenth(parseWav(padded).durationS), timing, beats };
}

// A question gets at least this long before its answer, so the viewer can try to answer it.
const QUESTION_HOLD_MS = 3000;

// The silence after each line: the template's gap, twice that after a "So" line (what a step means needs a moment to
// land), at least three seconds after a question, and nothing after the last line, whose hold is the chapter's tail.
function gapsAfter(sentences: string[], gapMs: number): number[] {
  return sentences.map((text, i) => {
    if (i === sentences.length - 1) return 0;
    if (text.trim().endsWith('?')) return Math.max(QUESTION_HOLD_MS, gapMs * 2);
    return /^So\b/.test(text.trim()) ? gapMs * 2 : gapMs;
  });
}

// A time in seconds to the millisecond, so the timing record reads 4.409, not 4.4093333333333335.
const ms = (s: number) => Math.round(s * 1000) / 1000;

// The lines path: every sentence in its speaker's voice and speed (the narrator's for a template without speakers),
// spoken by one Kokoro process and joined with the template's silences, then held at the end for twice the gap so the
// chapter's last point settles before the next one starts. Each line's start and end come from the audio itself, so
// the beats are exact.
async function voiceAsLines(work: string, chapter: ChapterSpec, sentences: string[], t: Template, { run, venvPython, kokoro = KOKORO_FILES }: NarrateDeps): Promise<Voiced> {
  const lines = chapter.sentences.map((s, i) => ({ text: sentences[i], ...voiceFor(t, s.speaker) }));
  const gapMs = t.pace.line_gap_ms;
  const spoken = await speakLines(lines, { python: venvPython, model: kokoro.model, voices: kokoro.voices, gapMs: gapsAfter(sentences, gapMs), work, run });
  const padded = padWav(spoken.wav, { leadMs: LEAD_MS, tailMs: TAIL_MS + gapMs * 2 });
  fs.writeFileSync(path.join(work, 'narration.wav'), padded);
  const lead = LEAD_MS / 1000;
  const beats = spoken.spans.map((span, i) => ({ text: sentences[i], start: ms(span.start + lead), end: ms(span.end + lead) }));
  return { padded, durationS: roundUpTenth(parseWav(padded).durationS), timing: 'lines', beats };
}

// The timing record the stage is built from: each sentence as a line with its speaker, kind and source chips, and
// the words inside each line.
function timingOf(chapter: ChapterSpec, beats: Beat[], durationS: number): Timing {
  const byId = new Map(chapter.sources.map((s) => [s.id, s]));
  const lines = beats.map((b, i) => {
    const s = chapter.sentences[i];
    const chips = s.kind === 'claim' ? s.source_ids.flatMap((id) => {
      const src = byId.get(id);
      if (!src) return [];
      return [src.lines[0] === src.lines[1] ? `${src.file}:${src.lines[0]}` : `${src.file}:${src.lines[0]}-${src.lines[1]}`];
    }) : [];
    return { text: b.text, start: b.start, end: b.end, kind: s.kind, chips, ...(s.speaker !== undefined ? { speaker: s.speaker } : {}) };
  });
  return { durationS, lines, words: estimateWords(lines) };
}

// Builds every output file in the work folder and returns what the chapter now measures.
async function buildOutputs(
  work: string, chapter: ChapterSpec, sentences: string[], verifiedText: Buffer, t: Template, shape: Shape, deps: NarrateDeps,
): Promise<Omit<NarrateResult, 'commit'> & { assets: string[] }> {
  // speakers, or a narrator with silence between sentences, need each line spoken on its own; a narrator without
  // gaps is one tts call for the whole text
  const { durationS, timing, beats } = t.speakers.length || t.pace.line_gap_ms > 0
    ? await voiceAsLines(work, chapter, sentences, t, deps)
    : await voiceAsNarrator(work, sentences, verifiedText, t, deps);

  // captions are cut from the beats, so they show the audited sentences, never what the recogniser misheard
  const captions = buildCaptions(beats);
  const stageTiming = timingOf(chapter, beats, durationS);
  const pieces = pieceWindows(chapter.scene, beats, durationS, (beat, word) => anchorTime(stageTiming, beat, word));
  // a template that draws captions or speakers keeps the lines and words it was built from beside the beats
  const plain = t.speakers.length === 0 && t.pace.captions === 'none';
  const beatsFile = plain ? { timing, durationS, beats } : { timing, durationS, beats, lines: stageTiming.lines, words: stageTiming.words };
  fs.writeFileSync(path.join(work, 'beats.json'), `${JSON.stringify(beatsFile, null, 2)}\n`);
  fs.writeFileSync(path.join(work, 'captions.vtt'), captions.vtt);
  fs.writeFileSync(path.join(work, 'captions.json'), `${JSON.stringify(captions.json, null, 2)}\n`);
  fs.writeFileSync(path.join(work, 'index.html'), buildStagePage({ id: chapter.id, template: t, shape, timing: stageTiming, pieces }));
  // the page loads GSAP and the template's pictures and footage from beside it, so the chapter folder renders with no network
  fs.copyFileSync(GSAP_FILE, path.join(work, GSAP_NAME));
  const assets = stageAssets(t);
  for (const rel of assets) {
    // every asset the page names is listed in template.json (the template check proved it); a downloaded one is in the data folder
    const asset = t.assets.find((a) => a.path === rel) ?? { path: rel };
    fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
    fs.copyFileSync(assetPath(t, asset, deps.dataDir ?? ''), path.join(work, rel));
  }
  return { durationS, timing, beats, captions, assets };
}

// Asks git which commit the repository at root is on; null when there is no root, git is missing or fails, or it
// prints anything but a 40-hex commit id. Never throws.
async function verifiedCommit(run: RunProgram, root: string | undefined): Promise<string | null> {
  if (!root) return null;
  try {
    const r = await run('git', ['-C', path.resolve(root), 'rev-parse', 'HEAD']);
    const out = String(r.stdout || '').trim();
    return r.code === 0 && COMMIT.test(out) ? out : null;
  } catch {
    return null;
  }
}

// Narrates one scaffolded chapter; all work happens in a temp folder so a failure leaves no partial files.
// `root` is the repository the chapter was audited against; its commit is recorded in build.json.
async function narrateChapter(chapterDir: string, deps: NarrateDeps): Promise<NarrateResult> {
  const { run, root } = deps;
  // absolute paths only, so a folder named like "--option" can never reach Hyperframes as an option
  const dir = path.resolve(chapterDir);
  // read as it is; checkSentences, checkNarrationText and checkScene below test every field before it is relied on
  const chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8')) as ChapterSpec;
  // check the cheap things before paying for speech: the audited words, one sentence per beat, a scene the kit can draw
  const narrationBytes = fs.readFileSync(path.join(dir, 'narration.txt'));
  const narration = narrationBytes.toString('utf8');
  checkSentences(chapter.sentences);
  checkNarrationText(narration, chapter.sentences);
  const sentences = narrationSentences(narration, chapter.sentences.length);
  checkScene(chapter.scene, sentences.length);
  // the video folder's template and shape (explainer at 16:9 for a folder that chose none); its rules hold here too
  const slugDir = slugDirOfChapter(dir);
  const template = deps.template ?? templateOfVideo(slugDir);
  const shape = deps.shape ?? readVideoChoice(slugDir).shape;
  const missing = missingAssets(template, deps.dataDir ?? '');
  if (missing.length) {
    const list = missing.map((a) => `${a.path} (${megabytes(a.bytes ?? 0)})`).join(', ');
    throw new Error(`template ${template.id} needs ${list} downloaded first: ask the user, then run oldguy templates ${template.id} --fetch`);
  }
  const broken = checkAgainstTemplate(chapter.sentences, chapter.scene, template);
  if (broken.length) throw new Error(`${broken.map((f) => `${f.id}: ${f.reason}`).join('; ')}: fix the spec, delete the chapter folder, then scaffold, audit and narrate again`);

  // the work folder sits inside the chapter so the final renames stay on one disk
  const commit = await verifiedCommit(run, root);
  const work = fs.mkdtempSync(path.join(dir, '.narrate-'));
  try {
    const { assets, ...result } = await buildOutputs(work, chapter, sentences, narrationBytes, template, shape, deps);
    // fingerprint the audited text, its commit and what was built from it, so render can refuse anything changed afterwards
    const readBuilt = (name: string) => (name === 'narration.txt' ? narrationBytes : fs.readFileSync(path.join(work, name)));
    // a chapter built as anything but the plain explainer at 16:9 records its template and fingerprints its assets
    const plain = template.id === 'explainer' && shape === '16:9' && assets.length === 0;
    const extra = plain ? undefined : { template: { id: template.id, version: template.version, shape }, assets };
    const record = buildRecord(chapter, readBuilt, commit, extra);
    fs.writeFileSync(path.join(work, 'build.json'), `${JSON.stringify(record, null, 2)}\n`);
    for (const rel of assets) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.renameSync(path.join(work, rel), path.join(dir, rel));
    }
    for (const name of OUTPUTS) fs.renameSync(path.join(work, name), path.join(dir, name));
    return { ...result, commit };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export { narrateChapter };
export type { NarrateDeps, NarrateResult, RunProgram, ProgramResult, TimingKind };
