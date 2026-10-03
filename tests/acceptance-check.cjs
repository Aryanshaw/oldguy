'use strict';
// Acceptance check, run by hand after a real /yap run (NOT part of `npm test`: it needs real renders and ffprobe).
// usage: source spikes/env.sh; node tests/acceptance-check.cjs <project-dir>
// Prints pass/fail per check per chapter; exits 1 when any check fails.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { parseWav } = require('../lib/wav.mts');

const YAP = path.join(__dirname, '..', 'bin', 'yap.cjs');
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const REQUIRED_FILES = ['chapter.json', 'narration.txt', 'narration.wav', 'beats.json', 'captions.vtt', 'captions.json',
  'index.html', 'build.json', 'chapter.mp4'];
// Words that point at another chapter by its place in the video.
const POSITION_WORDS = /\b(next|previous|last|first|earlier|later|following|prior|second|third|fourth|fifth|one|two|three|four|five|\d+)\s+(chapter|part|section|video)\b|\b(chapter|part|section)\s+(\d+|one|two|three|four|five)\b|\b(in|from)\s+the\s+(next|last|previous)\b|\b(coming up|up next|as we saw|we saw earlier|earlier we|later we)\b/i;

// Reads streams and format of a media file as JSON through ffprobe.
function probe(file) {
  return JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-of', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' }));
}

// The mean loudness of a file's audio in dB, from ffmpeg's volumedetect filter.
function meanVolumeDb(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr || '');
  return m ? Number(m[1]) : null;
}

// Pulls data-duration off the root composition element of the chapter page.
function dataDuration(html) {
  const m = /<div id="root"[^>]*data-duration="([\d.]+)"/.exec(html);
  return m ? Number(m[1]) : null;
}

// Parses a VTT timestamp (hh:mm:ss.mmm or mm:ss.mmm) into seconds.
function vttSeconds(stamp) {
  const parts = stamp.split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// A WEBVTT header, at least one cue, every cue with start < end, cues in order and none after the end of audio.
function checkVtt(text, endS) {
  if (!/^WEBVTT/.test(text)) return 'missing WEBVTT header';
  const cues = [...text.matchAll(/^((?:\d+:)?\d{2}:\d{2}\.\d{3}) --> ((?:\d+:)?\d{2}:\d{2}\.\d{3})/gm)];
  if (cues.length === 0) return 'no cues';
  let prevEnd = 0;
  for (const [, a, b] of cues) {
    const [s, e] = [vttSeconds(a), vttSeconds(b)];
    if (!(s < e)) return `cue ${a} --> ${b} does not move forward`;
    if (s < prevEnd - 0.001) return `cue ${a} starts before the previous cue ends`;
    if (e > endS + 0.05) return `cue ends at ${e} s, after the ${endS} s chapter`;
    prevEnd = e;
  }
  return `ok (${cues.length} cues)`;
}

// Runs every check on one chapter folder; returns [{ name, ok, detail }].
function checkChapter(dir, projectDir) {
  const out = [];
  const add = (name, ok, detail) => out.push({ name, ok, detail });
  const missing = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
  add('files present', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : 'all 9');

  // the claim audit, exactly as a user would run it
  const audit = spawnSync('node', [YAP, 'audit', path.join(dir, 'chapter.json'), '--root', projectDir], { encoding: 'utf8' });
  add('yap audit clean', audit.status === 0, audit.status === 0 ? 'exit 0' : `exit ${audit.status}: ${(audit.stdout + audit.stderr).trim()}`);

  const html = fs.existsSync(path.join(dir, 'index.html')) ? fs.readFileSync(path.join(dir, 'index.html'), 'utf8') : '';
  const declared = dataDuration(html);
  const wavS = fs.existsSync(path.join(dir, 'narration.wav')) ? parseWav(fs.readFileSync(path.join(dir, 'narration.wav'))).durationS : null;
  // narrate rounds the padded WAV length up to the next tenth for data-duration
  add('data-duration = padded wav', declared !== null && wavS !== null && declared >= wavS - 0.001 && declared - wavS < 0.1 + 0.001,
    `data-duration ${declared} s, wav ${wavS && wavS.toFixed(3)} s`);
  add('20 to 40 s', declared !== null && declared >= 20 && declared <= 40, `${declared} s`);

  const mp4 = path.join(dir, 'chapter.mp4');
  if (fs.existsSync(mp4)) {
    const info = probe(mp4);
    const video = info.streams.find((s) => s.codec_type === 'video');
    const audio = info.streams.find((s) => s.codec_type === 'audio');
    const videoS = Number(video ? video.duration : info.format.duration);
    add('mp4 duration ~ data-duration', Math.abs(videoS - declared) <= 0.5, `video ${videoS.toFixed(3)} s vs ${declared} s`);
    add('mp4 has audio stream', Boolean(audio), audio ? `${audio.codec_name} ${audio.sample_rate} Hz` : 'no audio stream');
    if (audio) add('audio length ~ video', Math.abs(Number(audio.duration) - videoS) <= 0.5, `audio ${Number(audio.duration).toFixed(3)} s`);
    const db = meanVolumeDb(mp4);
    add('audio not silent (> -45 dB)', db !== null && db > -45, `mean ${db} dB`);
  } else {
    add('mp4 exists', false, 'no chapter.mp4');
  }

  // no sentence may point at another chapter by its position
  const chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'));
  const offenders = chapter.sentences.map((s) => s.text).filter((t) => POSITION_WORDS.test(t));
  add('no position references', offenders.length === 0, offenders.length ? offenders.join(' | ') : `${chapter.sentences.length} sentences clean`);

  const vtt = fs.existsSync(path.join(dir, 'captions.vtt')) ? checkVtt(fs.readFileSync(path.join(dir, 'captions.vtt'), 'utf8'), declared) : 'missing';
  add('captions.vtt valid', vtt.startsWith('ok'), vtt);
  return out;
}

// Finds every chapter folder under <project>/.yap/<slug>/chapters and prints a pass/fail table.
function main() {
  const projectDir = path.resolve(process.argv[2] || '.');
  const yapDir = path.join(projectDir, '.yap');
  const slugs = fs.readdirSync(yapDir).filter((d) => fs.existsSync(path.join(yapDir, d, 'chapters')));
  let failed = 0;
  for (const slug of slugs) {
    const top = ['script.md', 'sources.json'].map((f) => `${f} ${fs.existsSync(path.join(yapDir, slug, f)) ? 'present' : 'MISSING'}`);
    console.log(`video ${slug}: ${top.join(', ')}`);
    const chaptersDir = path.join(yapDir, slug, 'chapters');
    for (const id of fs.readdirSync(chaptersDir).sort()) {
      console.log(`  chapter ${id}`);
      for (const c of checkChapter(path.join(chaptersDir, id), projectDir)) {
        if (!c.ok) failed += 1;
        console.log(`    ${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
      }
    }
  }
  console.log(failed === 0 ? 'all checks pass' : `${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
