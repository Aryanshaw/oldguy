// Reads the chapter folders Phase 1 writes and says, per chapter, whether its video is current.
// Everything here is synchronous and read-only: it never writes, and a bad file never throws.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './build-record.mts';
import { slugChapterId } from './chapter.mts';

// The build.json version the current narrate writes; an older one is never trusted.
const CURRENT_BUILD_VERSION = 2;

// Whether a chapter's video is current: ready, stale (a video that no longer matches its build), rendering or pending (never failed).
type ScanStatus = 'ready' | 'stale' | 'rendering' | 'pending';
// What the scan found out about one chapter folder.
type ScannedChapter = {
  id: string; title: string | null; durationS: number | null; status: ScanStatus; buildSha256: string | null;
  verifiedAgainstCommit: string | null; hasPoster: boolean; issues: string[];
};
// Every chapter of one video in story order, with the id order and any problems found while listing.
type ProjectScan = { order: string[]; chapters: ScannedChapter[]; issues: string[] };
// The outcome of reading a JSON file: its parsed value, or which way it failed.
type JsonRead = { value?: unknown; missing?: true; broken?: true };
// What was found out about a build.json.
type BuildInfo = { sha: string | null; commit: string | null; current: boolean };

// Reads one property of a parsed JSON value; anything that is not a non-null object has none.
function fieldOf(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

// Reads a file's bytes, or null when it is missing or unreadable.
function readBytes(file: string): Buffer | null {
  try { return fs.readFileSync(file); } catch { return null; }
}

// Reads a JSON file. Returns {value} on success, or {missing:true} / {broken:true} so callers can word the problem.
function readJson(file: string): JsonRead {
  const bytes = readBytes(file);
  if (bytes === null) return { missing: true };
  try { return { value: JSON.parse(bytes.toString('utf8')) }; } catch { return { broken: true }; }
}

// True when the path is a regular file (a symlink to a file does not count here; use lstat so we see the link itself).
function isRegularFile(file: string): boolean {
  try { return fs.lstatSync(file).isFile(); } catch { return false; }
}

// True when a folder is a valid chapter id: the slug rule applied to its own name changes nothing.
function isChapterId(name: string): boolean {
  try { return slugChapterId(name) === name; } catch { return false; }
}

// True when a relative path climbs out of its start folder (a whole ".." step, so a name like "..video.mp4" is fine).
function leavesFolder(relative: string): boolean {
  return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
}

// True when the path is itself a symbolic link (checked on the link, not on what it points at).
function isLink(file: string): boolean {
  try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; }
}

// Looks at chapter.mp4: returns {usable, issue}. It is usable only if it is a regular file whose real path stays
// inside the chapter folder (a link pointing elsewhere must never be served as this chapter's video).
function checkVideo(dir: string): { usable: boolean; issue: string | null } {
  const file = path.join(dir, 'chapter.mp4');
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); } catch { return { usable: false, issue: null }; }
  try {
    const real = fs.realpathSync(file);
    const inside = path.relative(fs.realpathSync(dir), real);
    if (leavesFolder(inside)) return { usable: false, issue: 'chapter.mp4 points outside the chapter folder, so it is ignored' };
    if (!fs.statSync(real).isFile()) return { usable: false, issue: 'chapter.mp4 is not a regular file, so it is ignored' };
  } catch {
    return { usable: false, issue: stat.isSymbolicLink() ? 'chapter.mp4 is a broken link, so it is ignored' : 'chapter.mp4 cannot be read, so it is ignored' };
  }
  return { usable: true, issue: null };
}

// True when the chapter folder holds a work-* folder (a render was started and not cleaned up).
function hasWorkFolder(dir: string): boolean {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory() && e.name.startsWith('work-'));
  } catch { return false; }
}

// Reads the duration from beats.json: a finite positive number or null, pushing an issue when it is not usable.
function readDuration(dir: string, issues: string[]): number | null {
  const beats = readJson(path.join(dir, 'beats.json'));
  if (beats.missing) { issues.push('beats.json is missing, so the length is unknown'); return null; }
  if (beats.broken) { issues.push('beats.json cannot be read, so the length is unknown'); return null; }
  const d = fieldOf(beats.value, 'durationS');
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) return d;
  issues.push('beats.json has no usable durationS, so the length is unknown');
  return null;
}

// Reads the title from chapter.json (null plus an issue when missing, unreadable or not text).
function readTitle(dir: string, issues: string[]): string | null {
  const chapter = readJson(path.join(dir, 'chapter.json'));
  const title = fieldOf(chapter.value, 'title');
  if (typeof title === 'string') return title;
  issues.push(chapter.missing ? 'chapter.json is missing, so the title is unknown' : 'chapter.json has no readable title');
  return null;
}

// Reads build.json: returns {sha, commit, current} where sha is the hash of its bytes (null if absent),
// current says it is the version this tool trusts, and a note is pushed to issues for an old or unreadable record.
function readBuild(dir: string, issues: string[]): BuildInfo {
  const bytes = readBytes(path.join(dir, 'build.json'));
  if (bytes === null) return { sha: null, commit: null, current: false };
  const sha = sha256(bytes);
  let record: unknown;
  try { record = JSON.parse(bytes.toString('utf8')); } catch {
    issues.push('build.json cannot be read');
    return { sha, commit: null, current: false };
  }
  if (!record || fieldOf(record, 'version') !== CURRENT_BUILD_VERSION) {
    issues.push('narrated with an older version');
    return { sha, commit: null, current: false };
  }
  const recorded = fieldOf(record, 'verified_against_commit');
  const commit = typeof recorded === 'string' ? recorded : null;
  return { sha, commit, current: true };
}

// The hash render.json says the video was built from, or null (with an issue) when it is missing or unusable.
function readRenderedHash(dir: string, issues: string[]): string | null {
  const render = readJson(path.join(dir, 'render.json'));
  if (render.missing) { issues.push('render.json is missing, so the video cannot be proven current'); return null; }
  const h = fieldOf(render.value, 'build_sha256');
  if (typeof h === 'string') return h;
  issues.push('render.json cannot be read, so the video cannot be proven current');
  return null;
}

// Decides the status from what was found: ready, stale, rendering or pending (never failed).
function decideStatus(videoUsable: boolean, working: boolean, build: BuildInfo, renderedHash: string | null): ScanStatus {
  if (!videoUsable) return working ? 'rendering' : 'pending';
  const current = build.current && build.sha !== null && renderedHash === build.sha;
  return current ? 'ready' : 'stale';
}

// The result for a chapter folder that is a symbolic link: nothing is read, it is pending, and the issue says why.
function refusedLink(chapterDir: string): ScannedChapter {
  return {
    id: path.basename(chapterDir), title: null, durationS: null, status: 'pending', buildSha256: null,
    verifiedAgainstCommit: null, hasPoster: false, issues: ['the chapter folder is a link, so it is not read'],
  };
}

// Scans one chapter folder and reports {id, title, durationS, status, buildSha256, verifiedAgainstCommit, hasPoster, issues}.
function scanChapter(chapterDir: string): ScannedChapter {
  const issues: string[] = [];
  // a linked chapter folder could lead anywhere, so it is never read: report it as not rendered
  if (isLink(chapterDir)) return refusedLink(chapterDir);
  const video = checkVideo(chapterDir);
  if (video.issue) issues.push(video.issue);
  const title = readTitle(chapterDir, issues);
  const durationS = readDuration(chapterDir, issues);
  const build = readBuild(chapterDir, issues);
  // only a present video needs its render record; without one the chapter is simply not rendered yet
  const renderedHash = video.usable ? readRenderedHash(chapterDir, issues) : null;
  if (video.usable && build.sha === null) issues.push('build.json is missing, so the video cannot be proven current');
  const status = decideStatus(video.usable, hasWorkFolder(chapterDir), build, renderedHash);
  if (status === 'stale' && renderedHash !== null && renderedHash !== build.sha) issues.push('the video was made from a different build than build.json now describes');
  return {
    id: path.basename(chapterDir), title, durationS, status,
    buildSha256: build.sha, verifiedAgainstCommit: build.commit,
    hasPoster: isRegularFile(path.join(chapterDir, 'poster.jpg')), issues,
  };
}

// Reads order.json ({"chapters": [ids]}). Returns {ids, issues}: ids is the de-duplicated list of valid ids,
// or null when the file is absent (no issue) or unusable (one issue).
function readOrder(slugDir: string): { ids: string[] | null; issues: string[] } {
  const file = readJson(path.join(slugDir, 'order.json'));
  if (file.missing) return { ids: null, issues: [] };
  const list = fieldOf(file.value, 'chapters');
  if (!Array.isArray(list)) return { ids: null, issues: ['order.json is not in the expected shape, so the folders are listed alphabetically'] };
  const items: unknown[] = list;
  const ids = [...new Set(items.filter((x): x is string => typeof x === 'string' && isChapterId(x)))];
  return { ids, issues: [] };
}

// Lists the folder names under chapters/, separating valid chapter ids from skipped entries (with an issue each).
function listChapterFolders(slugDir: string, issues: string[]): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(path.join(slugDir, 'chapters'), { withFileTypes: true }); } catch (err) {
    // a failed directory read always carries a system error code
    const code = (err as NodeJS.ErrnoException).code;
    // a missing chapters folder is normal (nothing scaffolded yet); anything else is worth telling the user
    if (code !== 'ENOENT') issues.push(`chapters cannot be listed: ${code === 'ENOTDIR' ? 'it is not a folder' : code || 'unreadable'}`);
    return [];
  }
  const names: string[] = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) { issues.push(`skipped "${e.name}" in chapters: it is a link`); continue; }
    if (!e.isDirectory()) { issues.push(`skipped "${e.name}" in chapters: it is not a folder`); continue; }
    if (!isChapterId(e.name)) { issues.push(`skipped folder "${e.name}": its name is not a valid chapter id`); continue; }
    names.push(e.name);
  }
  return names.sort();
}

// Scans every chapter under <slugDir>/chapters and puts them in story order: order.json ids that exist as folders
// first (first mention only), then the remaining folders alphabetically.
function scanProject(slugDir: string): ProjectScan {
  const order = readOrder(slugDir);
  const issues = [...order.issues];
  const folders = listChapterFolders(slugDir, issues);
  const present = new Set(folders);
  const first = (order.ids || []).filter((id) => present.has(id));
  const rest = folders.filter((id) => !first.includes(id));
  const ids = [...first, ...rest];
  const chapters = ids.map((id) => scanChapter(path.join(slugDir, 'chapters', id)));
  return { order: ids, chapters, issues };
}

export { readOrder, scanChapter, scanProject, leavesFolder };
export type { ScanStatus, ScannedChapter, ProjectScan };
