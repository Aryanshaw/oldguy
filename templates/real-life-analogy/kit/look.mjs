// The look check's contact sheet (see ../look.md). Takes one frame of a rendered chapter 1.2 s after each sentence
// starts, and writes <chapter>/look.jpg: the frames at 640 px in rows of three, then the same frames at 240 px, the
// thumbnail size. Needs ffmpeg.   node look.mjs <chapter folder>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node look.mjs <chapter folder holding chapter.mp4 and beats.json>');
  process.exit(2);
}
const video = path.join(dir, 'chapter.mp4');
const beatsFile = path.join(dir, 'beats.json');
if (!fs.existsSync(video) || !fs.existsSync(beatsFile)) {
  console.error(`look: ${dir} needs chapter.mp4 and beats.json; render the chapter first`);
  process.exit(2);
}
const { beats, durationS } = JSON.parse(fs.readFileSync(beatsFile, 'utf8'));
const times = beats.map((b) => Math.min(b.start + 1.2, durationS - 0.1));
const tmp = fs.mkdtempSync(path.join(dir, '.look-'));
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
try {
  times.forEach((t, i) => ff(['-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', path.join(tmp, `big-${String(i).padStart(2, '0')}.png`)]));
  times.forEach((t, i) => ff(['-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=240:-2', path.join(tmp, `small-${String(i).padStart(2, '0')}.png`)]));
  const n = times.length;
  const cols = Math.min(3, n);
  const rows = Math.ceil(n / cols);
  ff(['-i', path.join(tmp, 'big-%02d.png'), '-vf', `tile=${cols}x${rows}:padding=8:margin=8:color=0x1A1545`, '-frames:v', '1', path.join(tmp, 'big.png')]);
  ff(['-i', path.join(tmp, 'small-%02d.png'), '-vf', `tile=${n}x1:padding=8:margin=8:color=0x1A1545`, '-frames:v', '1', path.join(tmp, 'small.png')]);
  // stack: the big tiles over the small row, padded to the same width
  const out = path.join(dir, 'look.jpg');
  const W = Math.max(cols * 640 + (cols - 1) * 8 + 16, n * 240 + (n - 1) * 8 + 16);
  ff(['-i', path.join(tmp, 'big.png'), '-i', path.join(tmp, 'small.png'), '-filter_complex',
    `[0]pad=${W}:ih:0:0:0x1A1545[g];[1]pad=${W}:ih:0:0:0x1A1545[s];[g][s]vstack`, '-q:v', '3', out]);
  console.log(`look: ${out} (${n} frames, at ${times.map((t) => t.toFixed(1)).join(', ')} s)`);
  console.log('answer the eight questions in look.md from it; fix every no.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
