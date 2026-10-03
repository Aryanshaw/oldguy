'use strict';
// Takes one still frame out of a chapter video to use as its poster picture.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const EXTRACT_TIMEOUT_MS = 20000;
const execFileAsync = promisify(execFile);

// The real command runner: runs a program with an argument list (no shell) and gives up after 20 seconds.
function defaultExec(file, args) {
  return execFileAsync(file, args, { timeout: EXTRACT_TIMEOUT_MS });
}

// Which ffmpeg to run: the one the user pointed at, else the one on the path (the same rule the doctor uses).
function ffmpegPath(env = process.env) {
  return env.HYPERFRAMES_FFMPEG_PATH || 'ffmpeg';
}

// The second to grab: 1 s in, or the middle when the video is shorter than 2 s.
function posterTime(durationS) {
  return typeof durationS === 'number' && durationS < 2 ? durationS / 2 : 1;
}

// Writes one frame of mp4 to `out`. The frame goes to a temp file first and is renamed, so a half-written picture is never
// served. Both paths are made absolute and passed as separate arguments, so a folder name can never act as an option.
// Rejects when ffmpeg fails or leaves no file; the temp file is removed either way.
async function extractPoster({ ffmpeg = 'ffmpeg', mp4, out, atS, exec = defaultExec }) {
  const input = path.resolve(mp4);
  const target = path.resolve(out);
  const tmp = path.join(path.dirname(target), `${path.basename(target)}.tmp-${process.pid}`);
  try {
    await exec(ffmpeg, ['-nostdin', '-y', '-ss', String(atS), '-i', input, '-frames:v', '1', '-q:v', '3', '-f', 'image2', tmp]);
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

module.exports = { extractPoster, ffmpegPath, posterTime };
