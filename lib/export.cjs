'use strict';
// Export: joins the ready chapters into one mp4 and copies the script and sources next to it, into a folder the viewer chose.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { scanChapter } = require('./chapter-scan.cjs');
const { safeChapterFile } = require('./range.cjs');

const EXEC_TIMEOUT_MS = 10 * 60 * 1000;
const execFileAsync = promisify(execFile);

// Makes an Error that carries an HTTP status; the server answers it as {error: message}.
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// The real command runner: runs a program with an argument list (no shell) and gives up after 10 minutes.
function defaultExec(file, args) {
  return execFileAsync(file, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
}

// Sorts the manifest rows into the chapters to join (with their real file paths) and the ones left out (with a short reason).
function pickChapters(manifest, slugDir) {
  const included = [];
  const skipped = [];
  for (const row of manifest.chapters) {
    const dir = path.join(slugDir, 'chapters', row.id);
    if (row.status !== 'ready') { skipped.push({ id: row.id, reason: 'not ready' }); continue; }
    if (scanChapter(dir).status !== 'ready') { skipped.push({ id: row.id, reason: 'files are not current' }); continue; }
    const real = safeChapterFile(dir, 'chapter.mp4');
    if (!real) { skipped.push({ id: row.id, reason: 'video file is not safe to read' }); continue; }
    included.push({ row, file: real.path });
  }
  return { included, skipped };
}

// The text of the concat list: one line per file, in single quotes; a quote inside a path becomes '\'' (ffmpeg's rule).
// A path with a line break cannot be written safely, so it is refused (the message names no path).
function listText(files) {
  if (files.some((f) => /[\r\n]/.test(f))) throw httpError(409, 'a chapter file path contains a line break, so it cannot be joined');
  return files.map((f) => `file '${f.replaceAll("'", "'\\''")}'\n`).join('');
}

// One line for a failed ffmpeg run: its last non-empty stderr line, every absolute path cut down to its base name.
function failureReason(err, knownDirs) {
  const text = String((err && err.stderr) || (err && err.message) || 'unknown error');
  let line = text.split('\n').map((l) => l.trim()).filter(Boolean).pop() || 'unknown error';
  // Paths that may contain spaces are matched from their known folder to the next space-free end.
  for (const dir of knownDirs) {
    line = line.replace(new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s'"]*`, 'g'), (p) => path.basename(p));
  }
  return line.replace(/(?:\/|[A-Za-z]:\\)[^\s'"]*/g, (p) => path.basename(p));
}

// True when anything (even a dangling link) already has this name in the folder.
function taken(destDir, name) {
  try { fs.lstatSync(path.join(destDir, name)); return true; } catch { return false; }
}

// The three output names. Plain names when all are free; otherwise the smallest n >= 2 that frees all three.
function outputNames(destDir, slug) {
  const make = (n) => (n === 1
    ? { mp4: `${slug}.mp4`, script: 'script.md', sources: 'sources.json' }
    : { mp4: `${slug}-${n}.mp4`, script: `script-${n}.md`, sources: `sources-${n}.json` });
  let n = 1;
  while (Object.values(make(n)).some((name) => taken(destDir, name))) n += 1;
  return make(n);
}

// Runs ffmpeg once for the join: stream copy first, and a re-encode only if copying fails. Returns nothing; throws the reason.
async function joinVideos({ ffmpeg, exec, list, tmpOut, knownDirs }) {
  const head = ['-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', list];
  const tail = ['-movflags', '+faststart', tmpOut];
  try {
    await exec(ffmpeg, [...head, '-c', 'copy', ...tail]);
    return;
  } catch { /* try again below with a re-encode */ }
  fs.rmSync(tmpOut, { force: true });
  try {
    await exec(ffmpeg, [...head, '-c:v', 'libx264', '-c:a', 'aac', ...tail]);
  } catch (err) {
    fs.rmSync(tmpOut, { force: true });
    throw httpError(500, `ffmpeg failed: ${failureReason(err, knownDirs)}`);
  }
}

// Copies script.md and sources.json from the slug folder (only if they are plain files) under their output names.
// Returns the names written and the ones missing; if a copy fails, the ones already written are removed.
function copyTexts(slugDir, destDir, names) {
  const written = [];
  const skipped = [];
  try {
    for (const [src, dst] of [['script.md', names.script], ['sources.json', names.sources]]) {
      let plain = false;
      try { plain = fs.lstatSync(path.join(slugDir, src)).isFile(); } catch { /* absent */ }
      if (!plain) { skipped.push({ id: src, reason: 'missing' }); continue; }
      fs.copyFileSync(path.join(slugDir, src), path.join(destDir, dst), fs.constants.COPYFILE_EXCL);
      written.push(dst);
    }
  } catch (err) {
    for (const name of written) fs.rmSync(path.join(destDir, name), { force: true });
    throw err;
  }
  return { written, skipped };
}

// Joins the ready chapters of `manifest` into <slug>.mp4 in destDir and copies script.md and sources.json beside it.
// mode 'full' (default) refuses while an included chapter is still a draft; 'drafts' exports them anyway.
// Resolves { file, files, skipped } with base names only. Never overwrites: a taken name gets a -2, -3 ... suffix.
async function exportVideo({ manifest, slugDir, destDir, ffmpeg = 'ffmpeg', exec = defaultExec, mode = 'full' }) {
  if (mode !== 'full' && mode !== 'drafts') throw httpError(400, 'mode must be full or drafts');
  const { included, skipped } = pickChapters(manifest, slugDir);
  if (included.length === 0) throw httpError(409, 'no ready chapter to export');
  const drafts = included.filter((c) => c.row.quality === 'draft').map((c) => c.row.id);
  if (mode === 'full' && drafts.length) {
    throw httpError(409, `still drafts: ${drafts.join(', ')}; wait for the full render or export drafts`);
  }
  const text = listText(included.map((c) => c.file));
  const names = outputNames(destDir, manifest.slug);
  const tmpOut = path.join(destDir, `${names.mp4}.tmp-${process.pid}`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-export-'));
  try {
    const list = path.join(tmpDir, 'list.txt');
    fs.writeFileSync(list, text);
    await joinVideos({ ffmpeg, exec, list, tmpOut, knownDirs: [tmpDir, destDir, slugDir] });
    const copied = copyTexts(slugDir, destDir, names);
    try {
      fs.renameSync(tmpOut, path.join(destDir, names.mp4));
    } catch (err) {
      for (const name of copied.written) fs.rmSync(path.join(destDir, name), { force: true });
      throw err;
    }
    return { file: names.mp4, files: [names.mp4, ...copied.written], skipped: [...skipped, ...copied.skipped] };
  } finally {
    fs.rmSync(tmpOut, { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// True when `inner` is the same as `outer` or lies inside it (compared by path pieces, not by text prefix).
function isInside(outer, inner) {
  const rel = path.relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Checks the folder the viewer chose. It must be text, an absolute path without "..", an existing real folder (not a link),
// and not the project's .yap folder (the parent of slugDir) or anything inside it. Throws a 400 whose message never shows the path.
function checkDest(dest, slugDir) {
  if (typeof dest !== 'string' || dest === '') throw httpError(400, 'dest must be a folder path');
  if (dest.includes('\0')) throw httpError(400, 'dest must be a folder path');
  if (!path.isAbsolute(dest)) throw httpError(400, 'dest must be an absolute path');
  if (dest.split(/[\\/]/).includes('..')) throw httpError(400, 'dest must not contain ".."');
  let real;
  try {
    if (!fs.lstatSync(dest).isDirectory()) throw new Error('not a folder');
    real = fs.realpathSync(dest);
  } catch {
    throw httpError(400, 'dest must be an existing folder (not a link)');
  }
  const yapDir = fs.realpathSync(path.dirname(slugDir));
  if (isInside(yapDir, real)) throw httpError(400, 'dest must not be the project .yap folder or inside it');
  return real;
}

module.exports = { exportVideo, checkDest };
