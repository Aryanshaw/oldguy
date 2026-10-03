'use strict';
// Takes one still frame out of a chapter video to use as its poster picture.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const EXTRACT_TIMEOUT_MS = 20000;
const execFileAsync = promisify(execFile);

// The real command runner: runs a program with an argument list (no shell), gives up after 20 seconds, and is killed
// when the caller's abort signal fires.
function defaultExec(file, args, opts = {}) {
  return execFileAsync(file, args, { timeout: EXTRACT_TIMEOUT_MS, signal: opts.signal });
}

// Gives every extraction its own temp file name, so two extractions in one process never share a file.
let tempCounter = 0;

// Which ffmpeg to run: the one the user pointed at, else the one on the path (the same rule the doctor uses).
function ffmpegPath(env = process.env) {
  return env.HYPERFRAMES_FFMPEG_PATH || 'ffmpeg';
}

// The second to grab: 1 s in, or the middle when the video is shorter than 2 s.
function posterTime(durationS) {
  return typeof durationS === 'number' && durationS < 2 ? durationS / 2 : 1;
}

// Writes one frame of mp4 to `out`. The frame goes to its own temp file first; just before it is renamed into place,
// beforeCommit() (optional, may be async) is asked whether the frame is still wanted, and a false answer throws it away.
// Both paths are made absolute and passed as separate arguments, so a folder name can never act as an option.
// Resolves true when the poster was written, false when the frame was thrown away; rejects when ffmpeg fails or is
// aborted. The temp file is removed in every case but success.
async function extractPoster({ ffmpeg = 'ffmpeg', mp4, out, atS, exec = defaultExec, signal, beforeCommit }) {
  const input = path.resolve(mp4);
  const target = path.resolve(out);
  const tmp = path.join(path.dirname(target), `${path.basename(target)}.tmp-${process.pid}-${tempCounter++}`);
  try {
    await exec(ffmpeg, ['-nostdin', '-y', '-ss', String(atS), '-i', input, '-frames:v', '1', '-q:v', '3', '-f', 'image2', tmp], { signal });
    if (beforeCommit && !(await beforeCommit())) { fs.rmSync(tmp, { force: true }); return false; }
    fs.renameSync(tmp, target);
    return true;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

module.exports = { extractPoster, ffmpegPath, posterTime };
