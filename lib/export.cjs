'use strict';
// Export: joins the ready chapters into one mp4 and copies the script and sources next to it, into a folder the viewer chose.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { scanChapter, leavesFolder } = require('./chapter-scan.cjs');
const { slugChapterId } = require('./chapter.cjs');
const { safeChapterFile } = require('./range.cjs');

const EXEC_TIMEOUT_MS = 10 * 60 * 1000;
const execFileAsync = promisify(execFile);

// Makes an Error that carries an HTTP status; the server answers it as {error: message}.
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// The real command runner: runs a program with an argument list (no shell) and gives up after 10 minutes.
function defaultExec(file, args, opts = {}) {
  return execFileAsync(file, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, signal: opts.signal });
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

// One line for a failed ffmpeg run: its last non-empty stderr line, at most 200 characters, with every absolute path
// cut down to its base name. Known paths (even with spaces in them) go first, then any other path that stands alone.
function failureReason(err, knownPaths) {
  const text = String((err && err.stderr) || (err && err.message) || 'unknown error');
  let line = text.split('\n').map((l) => l.trim()).filter(Boolean).pop() || 'unknown error';
  const longestFirst = [...knownPaths].sort((x, y) => y.length - x.length);
  for (const known of longestFirst) {
    const re = new RegExp(`${known.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s'"]*`, 'g');
    line = line.replace(re, (m) => path.basename(m));
  }
  // A path starts at the line start, after a space, a quote, "=" or ":"; so "3/4" is left as it is.
  line = line.replace(/(^|[\s'"(=:])(\/[^\s'"]*)/g, (m, lead, p) => lead + path.basename(p));
  return line.slice(0, 200);
}

// True when anything (even a dangling link) already has this name in the folder.
function taken(destDir, name) {
  try { fs.lstatSync(path.join(destDir, name)); return true; } catch { return false; }
}

// The three output names for number n (1 means the plain names).
function namesFor(slug, n) {
  return n === 1
    ? { mp4: `${slug}.mp4`, script: 'script.md', sources: 'sources.json' }
    : { mp4: `${slug}-${n}.mp4`, script: `script-${n}.md`, sources: `sources-${n}.json` };
}

// The smallest n >= start for which none of the three names exists yet.
function firstFree(destDir, slug, start) {
  let n = start;
  while (Object.values(namesFor(slug, n)).some((name) => taken(destDir, name))) n += 1;
  return n;
}

// True when the slug is a plain safe name (the same rule chapter ids follow), so it can be a file name.
function safeSlug(slug) {
  try { return slugChapterId(slug) === slug; } catch { return false; }
}

// Last check before every write: the target must sit directly in the folder the viewer chose.
function assertDirectChild(base, target) {
  if (path.dirname(target) !== base) throw httpError(500, 'export refused to write outside the chosen folder');
}

// Throws the "stopped" error when the server is shutting down (so nothing more is started or published).
function assertNotStopped(signal) {
  if (signal && signal.aborted) throw httpError(500, 'export was stopped');
}

// Runs ffmpeg for the join: stream copy first, and a re-encode only if copying fails (never after a stop).
// Throws the one-line reason when both fail.
async function joinVideos({ ffmpeg, exec, list, tmpOut, knownPaths, signal }) {
  const head = ['-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', list];
  const tail = ['-movflags', '+faststart', tmpOut];
  const opts = { signal, timeout: EXEC_TIMEOUT_MS };
  try {
    await exec(ffmpeg, [...head, '-c', 'copy', ...tail], opts);
    return;
  } catch { assertNotStopped(signal); /* otherwise try again below with a re-encode */ }
  fs.rmSync(tmpOut, { force: true });
  try {
    await exec(ffmpeg, [...head, '-c:v', 'libx264', '-c:a', 'aac', ...tail], opts);
  } catch (err) {
    assertNotStopped(signal);
    throw httpError(500, `ffmpeg failed: ${failureReason(err, knownPaths)}`);
  }
}

// Copies script.md and sources.json (only plain files) under their output names, never replacing a file.
// Returns the names written and the ones missing; on any failure the ones already written are removed.
function copyTexts(slugDir, base, names) {
  const written = [];
  const skipped = [];
  try {
    for (const [src, dst] of [['script.md', names.script], ['sources.json', names.sources]]) {
      let plain = false;
      try { plain = fs.lstatSync(path.join(slugDir, src)).isFile(); } catch { /* absent */ }
      if (!plain) { skipped.push({ id: src, reason: 'missing' }); continue; }
      assertDirectChild(base, path.join(base, dst));
      fs.copyFileSync(path.join(slugDir, src), path.join(base, dst), fs.constants.COPYFILE_EXCL);
      written.push(dst);
    }
  } catch (err) {
    for (const name of written) fs.rmSync(path.join(base, name), { force: true });
    throw err;
  }
  return { written, skipped };
}

// Puts the finished export in the folder. link() never replaces a file: if any name was taken meanwhile, everything
// written so far is undone and the next number is tried (up to 50 times), the same number for all three outputs.
function publish({ slugDir, base, slug, tmpOut, start, signal }) {
  let n = start;
  for (let tries = 0; tries < 50; tries++, n = firstFree(base, slug, n + 1)) {
    assertNotStopped(signal);
    const names = namesFor(slug, n);
    let copied = null;
    try {
      copied = copyTexts(slugDir, base, names);
      assertDirectChild(base, path.join(base, names.mp4));
      fs.linkSync(tmpOut, path.join(base, names.mp4));
      return { file: names.mp4, files: [names.mp4, ...copied.written], skipped: copied.skipped };
    } catch (err) {
      if (copied) for (const name of copied.written) fs.rmSync(path.join(base, name), { force: true });
      if (!err || err.code !== 'EEXIST') throw err && err.status ? err : httpError(500, 'could not write the export files');
    }
  }
  throw httpError(409, 'could not find free file names in the chosen folder');
}

// Joins the ready chapters of `manifest` into <slug>.mp4 in destDir and copies script.md and sources.json beside it.
// mode 'full' (default) refuses while an included chapter is still a draft; 'drafts' exports them anyway.
// signal (optional) stops the export: ffmpeg is told to quit and nothing is published. Resolves { file, files, skipped }
// with base names only. Never replaces a file: a taken name gets a -2, -3 ... suffix.
async function exportVideo({ manifest, slugDir, destDir, ffmpeg = 'ffmpeg', exec = defaultExec, mode = 'full', signal }) {
  if (mode !== 'full' && mode !== 'drafts') throw httpError(400, 'mode must be full or drafts');
  if (!safeSlug(manifest.slug)) throw httpError(409, 'the manifest slug is not a plain name, so it cannot name the output file');
  const { included, skipped } = pickChapters(manifest, slugDir);
  if (included.length === 0) throw httpError(409, 'no ready chapter to export');
  const drafts = included.filter((c) => c.row.quality === 'draft').map((c) => c.row.id);
  if (mode === 'full' && drafts.length) {
    throw httpError(409, `still drafts: ${drafts.join(', ')}; wait for the full render or export drafts`);
  }
  const text = listText(included.map((c) => c.file));
  const base = fs.realpathSync(destDir);
  const listDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-export-'));
  // ffmpeg writes into a fresh private folder (mode 0700) inside the chosen folder, so no existing name is ever followed.
  let work = null;
  try {
    work = fs.mkdtempSync(path.join(base, '.yap-export-'));
    const list = path.join(listDir, 'list.txt');
    fs.writeFileSync(list, text);
    const tmpOut = path.join(work, 'out.mp4');
    const knownPaths = [listDir, work, base, destDir, slugDir, fs.realpathSync(slugDir), ...included.map((c) => c.file)];
    await joinVideos({ ffmpeg, exec, list, tmpOut, knownPaths, signal });
    const done = publish({ slugDir, base, slug: manifest.slug, tmpOut, start: firstFree(base, manifest.slug, 1), signal });
    return { file: done.file, files: done.files, skipped: [...skipped, ...done.skipped] };
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(listDir, { recursive: true, force: true });
  }
}

// Checks the folder the viewer chose. It must be text, an absolute path without "..", an existing real folder (not a link),
// and not the project's .yap folder (the parent of slugDir) or anything inside it. Throws a 400 whose message never shows the path.
function checkDest(dest, slugDir) {
  if (typeof dest !== 'string' || dest === '') throw httpError(400, 'dest must be a folder path');
  if (dest.includes('\0')) throw httpError(400, 'dest must be a folder path');
  if (!path.isAbsolute(dest)) throw httpError(400, 'dest must be an absolute path');
  if (dest.split(/[\\/]/).includes('..')) throw httpError(400, 'dest must not contain ".."');
  // path.resolve drops trailing separators and "." pieces, so lstat looks at the link itself, not what it points to.
  const clean = path.resolve(dest);
  let real;
  try {
    if (!fs.lstatSync(clean).isDirectory()) throw new Error('not a folder');
    real = fs.realpathSync(clean);
  } catch {
    throw httpError(400, 'dest must be an existing folder (not a link)');
  }
  const yapDir = fs.realpathSync(path.dirname(slugDir));
  if (!leavesFolder(path.relative(yapDir, real))) throw httpError(400, 'dest must not be the project .yap folder or inside it');
  return real;
}

module.exports = { exportVideo, checkDest };
