'use strict';
// The narration pipeline for one chapter: speech, padding, beat timing, captions and the root composition.
// Every outside program goes through the injected `run`, so tests never call Hyperframes.
const fs = require('node:fs');
const path = require('node:path');
const { parseWav, padWav } = require('./wav.mts');
const { beatsFromDuration, beatsFromWords } = require('./beats.mts');
const { buildCaptions } = require('./captions.mts');
const { checkScene, checkSentences, checkNarrationText, narrationSentences, roundUpTenth, pieceWindows, buildRootComposition } = require('./chapter.cjs');
const { hyperframesArgs } = require('./hyperframes.mts');
const { buildRecord, COMMIT } = require('./build-record.mts');

const LEAD_MS = 40;
const TAIL_MS = 120;
// The files a finished narration leaves in the chapter folder; build.json goes last so a half-finished move never matches it.
const OUTPUTS = ['narration.wav', 'beats.json', 'captions.vtt', 'captions.json', 'index.html', 'build.json'];

// Reads the `error` from a `--json` summary on stdout, where Hyperframes reports failures; null when there is none.
function jsonError(stdout) {
  try {
    const error = JSON.parse(String(stdout || '').trim()).error;
    return typeof error === 'string' && error.trim() ? error.trim() : null;
  } catch {
    return null;
  }
}

// Runs the pinned Hyperframes (`npx --yes hyperframes@<version> <args>`) and turns a failed exit into an error carrying
// the program's own reason: its stderr, else the error in its JSON stdout, else the exit code.
async function hyperframes(run, args, env) {
  const r = await run('npx', hyperframesArgs(args), env);
  if (r.code !== 0) {
    const why = String(r.stderr || '').trim() || jsonError(r.stdout) || `exit code ${r.code}`;
    throw new Error(`hyperframes ${args[0]} failed: ${why}`);
  }
  return r;
}

// Asks Hyperframes for word timings of the padded audio and reads the word list it writes.
async function transcribeWords(run, wavPath, env) {
  const r = await hyperframes(run, ['transcribe', wavPath, '--json'], env);
  let transcriptPath;
  try {
    transcriptPath = JSON.parse(r.stdout).transcriptPath;
  } catch {
    throw new Error('hyperframes transcribe did not print the JSON summary with transcriptPath');
  }
  const words = JSON.parse(fs.readFileSync(path.resolve(path.dirname(wavPath), transcriptPath), 'utf8'));
  if (!Array.isArray(words)) throw new Error(`${transcriptPath} is not a list of words`);
  return words;
}

// Cuts beat times back to the audio's real length: whisper can place the last word's end after the audio stops,
// which would leave a caption on screen after the chapter ends.
function clampBeats(beats, audioS) {
  const endS = Math.floor(audioS * 1000) / 1000;
  return beats.map((b) => ({ ...b, start: Math.min(b.start, endS), end: Math.min(b.end, endS) }));
}

// Builds every output file in the work folder and returns what the chapter now measures.
async function buildOutputs(work, chapter, sentences, verifiedText, { run, venvPython, whisperAvailable }) {
  const env = { HYPERFRAMES_PYTHON: venvPython };
  // tts reads a private copy of the bytes that were checked, so a later edit to narration.txt cannot be spoken
  const textPath = path.join(work, 'narration.txt');
  fs.writeFileSync(textPath, verifiedText);
  const rawPath = path.join(work, 'narration.raw.wav');
  await hyperframes(run, ['tts', textPath, '-o', rawPath, '--json'], env);

  // a little silence at both ends so chapters do not click where they join
  const raw = fs.readFileSync(rawPath);
  const padded = padWav(raw, { leadMs: LEAD_MS, tailMs: TAIL_MS });
  const wavPath = path.join(work, 'narration.wav');
  fs.writeFileSync(wavPath, padded);
  const durationS = roundUpTenth(parseWav(padded).durationS);

  // word timings come from the padded audio, so they already include the lead silence
  const timing = whisperAvailable ? 'words' : 'sentence-share';
  const beats = clampBeats(whisperAvailable
    ? beatsFromWords(sentences, await transcribeWords(run, wavPath, env))
    : beatsFromDuration(sentences, parseWav(raw).durationS, { leadS: LEAD_MS / 1000 }), parseWav(padded).durationS);

  // captions are cut from the beats, so they show the audited sentences, never what the recogniser misheard
  const captions = buildCaptions(beats);
  const pieces = pieceWindows(chapter.scene, beats, durationS);
  fs.writeFileSync(path.join(work, 'beats.json'), `${JSON.stringify({ timing, durationS, beats }, null, 2)}\n`);
  fs.writeFileSync(path.join(work, 'captions.vtt'), captions.vtt);
  fs.writeFileSync(path.join(work, 'captions.json'), `${JSON.stringify(captions.json, null, 2)}\n`);
  fs.writeFileSync(path.join(work, 'index.html'), buildRootComposition({ id: chapter.id, durationS, pieces }));
  return { durationS, timing, beats, captions };
}

// Asks git which commit the repository at root is on; null when there is no root, git is missing or fails, or it
// prints anything but a 40-hex commit id. Never throws.
async function verifiedCommit(run, root) {
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
async function narrateChapter(chapterDir, { run, venvPython, whisperAvailable, root }) {
  // absolute paths only, so a folder named like "--option" can never reach Hyperframes as an option
  const dir = path.resolve(chapterDir);
  const chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'));
  // check the cheap things before paying for speech: the audited words, one sentence per beat, a scene the kit can draw
  const narrationBytes = fs.readFileSync(path.join(dir, 'narration.txt'));
  const narration = narrationBytes.toString('utf8');
  checkSentences(chapter.sentences);
  checkNarrationText(narration, chapter.sentences);
  const sentences = narrationSentences(narration, chapter.sentences.length);
  checkScene(chapter.scene, sentences.length);

  // the work folder sits inside the chapter so the final renames stay on one disk
  const commit = await verifiedCommit(run, root);
  const work = fs.mkdtempSync(path.join(dir, '.narrate-'));
  try {
    const result = await buildOutputs(work, chapter, sentences, narrationBytes, { run, venvPython, whisperAvailable });
    // fingerprint the audited text, its commit and what was built from it, so render can refuse anything changed afterwards
    const readBuilt = (name) => (name === 'narration.txt' ? narrationBytes : fs.readFileSync(path.join(work, name)));
    const record = buildRecord(chapter, readBuilt, commit);
    fs.writeFileSync(path.join(work, 'build.json'), `${JSON.stringify(record, null, 2)}\n`);
    for (const name of OUTPUTS) fs.renameSync(path.join(work, name), path.join(dir, name));
    return { ...result, commit };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { narrateChapter };
