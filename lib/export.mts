// Export: joins the ready chapters into one mp4 and copies the script and sources next to it, into a folder the viewer chose.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scanChapter, leavesFolder } from './chapter-scan.mts';
import { safeChapterFile } from './range.mts';
import type { Manifest, ManifestRow } from './manifest.mts';

// An error that carries the HTTP status the server answers with.
type HttpError = Error & { status: number };
// A chapter left out of the export (or a text file that was missing), with a short reason.
type Skipped = { id: string; reason: string };
// What a finished export reports: the main file, every file written (base names only) and what was left out.
type ExportResult = { file: string; files: string[]; skipped: Skipped[] };
// Runs a program with an argument list; the real one never uses a shell. A test hands in a fake.
type ExecFn = (file: string, args: string[], opts?: { signal?: AbortSignal; timeout?: number }) => Promise<unknown>;
// The file functions the publish step uses, so a test can hand in broken ones.
type PublishFs = Pick<typeof fs, 'linkSync' | 'copyFileSync' | 'constants'>;
// What exportVideo needs.
type ExportOptions = {
  manifest: Manifest;
  slugDir: string;
  destDir: string;
  ffmpeg?: string;
  exec?: ExecFn;
  mode?: string;
  signal?: AbortSignal;
  fs?: PublishFs;
};
// The three output file names for one export number.
type OutputNames = { mp4: string; script: string; sources: string };

// Errors that mean the drive cannot make hard links.
const LINK_UNSUPPORTED: readonly unknown[] = ['ENOTSUP', 'EPERM', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK'];
const EXEC_TIMEOUT_MS = 10 * 60 * 1000;
const execFileAsync = promisify(execFile);

// Makes an Error that carries an HTTP status; the server answers it as {error: message}.
function httpError(status: number, message: string): HttpError {
  return Object.assign(new Error(message), { status });
}

// The system error code of something that was thrown, or undefined when it has none.
function codeOf(err: unknown): unknown {
  return err ? (err as { code?: unknown }).code : undefined;
}

// The real command runner: runs a program with an argument list (no shell) and gives up after 10 minutes.
function defaultExec(file: string, args: string[], opts: { signal?: AbortSignal } = {}): Promise<unknown> {
  return execFileAsync(file, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, signal: opts.signal });
}

// Sorts the manifest rows into the chapters to join (with their real file paths) and the ones left out (with a short reason).
function pickChapters(manifest: Manifest, slugDir: string): { included: { row: ManifestRow; file: string }[]; skipped: Skipped[] } {
  const included: { row: ManifestRow; file: string }[] = [];
  const skipped: Skipped[] = [];
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
function listText(files: string[]): string {
  if (files.some((f) => /[\r\n]/.test(f))) throw httpError(409, 'a chapter file path contains a line break, so it cannot be joined');
  return files.map((f) => `file '${f.replaceAll("'", "'\\''")}'\n`).join('');
}

// One line for a failed ffmpeg run: its last non-empty stderr line, at most 200 characters, with every absolute path
// cut down to its base name. Known paths (even with spaces in them) go first, then any other path that stands alone.
function failureReason(err: unknown, knownPaths: string[]): string {
  // a failed program run carries its stderr and message; anything else is shown as 'unknown error'
  const e = err as { stderr?: unknown; message?: unknown } | null | undefined;
  const text = String((e && e.stderr) || (e && e.message) || 'unknown error');
  let line = text.split('\n').map((l) => l.trim()).filter(Boolean).pop() || 'unknown error';
  const longestFirst = [...knownPaths].sort((x, y) => y.length - x.length);
  for (const known of longestFirst) {
    const re = new RegExp(`${known.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s'"]*`, 'g');
    line = line.replace(re, (m) => path.basename(m));
  }
  // A path starts at the line start, after a space, a quote, "=" or ":"; so "3/4" is left as it is.
  line = line.replace(/(^|[\s'"(=:])(\/[^\s'"]*)/g, (_m: string, lead: string, p: string) => lead + path.basename(p));
  return line.slice(0, 200);
}

// True when anything (even a dangling link) already has this name in the folder.
function taken(destDir: string, name: string): boolean {
  try { fs.lstatSync(path.join(destDir, name)); return true; } catch { return false; }
}

// The three output names for number n (1 means the plain names).
function namesFor(slug: string, n: number): OutputNames {
  return n === 1
    ? { mp4: `${slug}.mp4`, script: 'script.md', sources: 'sources.json' }
    : { mp4: `${slug}-${n}.mp4`, script: `script-${n}.md`, sources: `sources-${n}.json` };
}

// The smallest n >= start for which none of the three names exists yet.
function firstFree(destDir: string, slug: string, start: number): number {
  let n = start;
  while (Object.values(namesFor(slug, n)).some((name) => taken(destDir, name))) n += 1;
  return n;
}

// True when the slug is a plain safe file name: letters, digits, dot, underscore, hyphen; starts with a letter or digit,
// at most 80 characters, no "..". So it can never hold a slash, a leading dot or hyphen, a space or a line break.
function safeSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(slug) && !slug.includes('..');
}

// Puts the finished mp4 at `final` without ever replacing a file: a hard link first, and on drives that cannot make
// links (exFAT, FAT, some network shares) an exclusive copy. A half-written copy is removed. EEXIST means "name taken".
function placeFile(fsx: PublishFs, tmp: string, final: string): void {
  try {
    fsx.linkSync(tmp, final);
  } catch (err) {
    if (!err || !LINK_UNSUPPORTED.includes(codeOf(err))) throw err;
    try {
      fsx.copyFileSync(tmp, final, fsx.constants.COPYFILE_EXCL);
    } catch (copyErr) {
      if (!copyErr || codeOf(copyErr) !== 'EEXIST') fs.rmSync(final, { force: true });
      throw copyErr;
    }
  }
  fs.rmSync(tmp, { force: true });
}

// Throws the "stopped" error when the server is shutting down (so nothing more is started or published).
function assertNotStopped(signal: AbortSignal | undefined): void {
  if (signal && signal.aborted) throw httpError(500, 'export was stopped');
}

// Runs ffmpeg for the join: stream copy first, and a re-encode only if copying fails (never after a stop).
// Throws the one-line reason when both fail.
async function joinVideos({ ffmpeg, exec, list, tmpOut, knownPaths, signal }: {
  ffmpeg: string; exec: ExecFn; list: string; tmpOut: string; knownPaths: string[]; signal: AbortSignal | undefined;
}): Promise<void> {
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
function copyTexts(fsx: PublishFs, slugDir: string, base: string, names: OutputNames): { written: string[]; skipped: Skipped[] } {
  const written: string[] = [];
  const skipped: Skipped[] = [];
  try {
    for (const [src, dst] of [['script.md', names.script], ['sources.json', names.sources]]) {
      let plain = false;
      try { plain = fs.lstatSync(path.join(slugDir, src)).isFile(); } catch { /* absent */ }
      if (!plain) { skipped.push({ id: src, reason: 'missing' }); continue; }
      fsx.copyFileSync(path.join(slugDir, src), path.join(base, dst), fs.constants.COPYFILE_EXCL);
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
function publish({ fsx, slugDir, base, slug, tmpOut, start, signal }: {
  fsx: PublishFs; slugDir: string; base: string; slug: string; tmpOut: string; start: number; signal: AbortSignal | undefined;
}): ExportResult {
  let n = start;
  for (let tries = 0; tries < 50; tries++, n = firstFree(base, slug, n + 1)) {
    assertNotStopped(signal);
    const names = namesFor(slug, n);
    let copied: { written: string[]; skipped: Skipped[] } | null = null;
    try {
      copied = copyTexts(fsx, slugDir, base, names);
      placeFile(fsx, tmpOut, path.join(base, names.mp4));
      return { file: names.mp4, files: [names.mp4, ...copied.written], skipped: copied.skipped };
    } catch (err) {
      if (copied) for (const name of copied.written) fs.rmSync(path.join(base, name), { force: true });
      const status = err ? (err as { status?: unknown }).status : undefined;
      if (!err || codeOf(err) !== 'EEXIST') throw status ? err : httpError(500, 'could not write the export files');
    }
  }
  throw httpError(409, 'could not find free file names in the chosen folder');
}

// Joins the ready chapters of `manifest` into <slug>.mp4 in destDir and copies script.md and sources.json beside it.
// mode 'full' (default) refuses while an included chapter is still a draft; 'drafts' exports them anyway.
// fs (optional) replaces node's fs for the publish step (tests). signal (optional) stops the export: ffmpeg is told to quit and nothing is published. Resolves { file, files, skipped }
// with base names only. Never replaces a file: a taken name gets a -2, -3 ... suffix.
async function exportVideo({ manifest, slugDir, destDir, ffmpeg = 'ffmpeg', exec = defaultExec, mode = 'full', signal, fs: fsx = fs }: ExportOptions): Promise<ExportResult> {
  if (mode !== 'full' && mode !== 'drafts') throw httpError(400, 'mode must be full or drafts');
  if (!safeSlug(manifest.slug)) throw httpError(409, 'the manifest slug is not a plain file name, so it cannot name the output file');
  const { included, skipped } = pickChapters(manifest, slugDir);
  if (included.length === 0) throw httpError(409, 'no ready chapter to export');
  const drafts = included.filter((c) => c.row.quality === 'draft').map((c) => c.row.id);
  if (mode === 'full' && drafts.length) {
    throw httpError(409, `still drafts: ${drafts.join(', ')}; wait for the full render or export drafts`);
  }
  const text = listText(included.map((c) => c.file));
  const base = fs.realpathSync(destDir);
  const listDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-export-'));
  // ffmpeg writes into a fresh private folder (mode 0700) inside the chosen folder, so no existing name is ever followed.
  let work: string | null = null;
  try {
    try {
      work = fs.mkdtempSync(path.join(base, '.oldguy-export-'));
    } catch (err) {
      if (err && ['EACCES', 'EROFS', 'EPERM'].includes(String(codeOf(err)))) throw httpError(409, 'cannot write into that folder');
      throw err;
    }
    const list = path.join(listDir, 'list.txt');
    fs.writeFileSync(list, text);
    const tmpOut = path.join(work, 'out.mp4');
    const knownPaths = [listDir, work, base, destDir, slugDir, fs.realpathSync(slugDir), ...included.map((c) => c.file)];
    await joinVideos({ ffmpeg, exec, list, tmpOut, knownPaths, signal });
    const done = publish({ fsx, slugDir, base, slug: manifest.slug, tmpOut, start: firstFree(base, manifest.slug, 1), signal });
    return { file: done.file, files: done.files, skipped: [...skipped, ...done.skipped] };
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(listDir, { recursive: true, force: true });
  }
}

// Checks the folder the viewer chose. It must be text, an absolute path without "..", an existing real folder (not a link),
// and not the project's .oldguy folder (the parent of slugDir) or anything inside it. Throws a 400 whose message never shows the path.
function checkDest(dest: unknown, slugDir: string): string {
  if (typeof dest !== 'string' || dest === '') throw httpError(400, 'dest must be a folder path');
  if (dest.includes('\0')) throw httpError(400, 'dest must be a folder path');
  if (!path.isAbsolute(dest)) throw httpError(400, 'dest must be an absolute path');
  if (dest.split(/[\\/]/).includes('..')) throw httpError(400, 'dest must not contain ".."');
  // path.resolve drops trailing separators and "." pieces, so lstat looks at the link itself, not what it points to.
  const clean = path.resolve(dest);
  let real: string;
  try {
    if (!fs.lstatSync(clean).isDirectory()) throw new Error('not a folder');
    real = fs.realpathSync(clean);
  } catch {
    throw httpError(400, 'dest must be an existing folder (not a link)');
  }
  const oldguyDir = fs.realpathSync(path.dirname(slugDir));
  if (!leavesFolder(path.relative(oldguyDir, real))) throw httpError(400, 'dest must not be the project .oldguy folder or inside it');
  return real;
}

export { exportVideo, checkDest };
export type { ExportOptions, ExportResult, ExecFn, Skipped, PublishFs };
