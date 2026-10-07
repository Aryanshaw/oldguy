// The build record (build.json): fingerprints of the audited text and of the files narrate built from it,
// so render can prove the audio and page it is about to publish still come from the text that passed the audit.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// The fingerprints in a build record: one sha256 per name ("chapter" and each built file).
type BuildFingerprint = Record<string, string>;

// build.json: the record's version, the commit the text was verified against (or null) and the fingerprints.
type BuildRecord = { version: number; verified_against_commit: string | null; sha256: BuildFingerprint };

// The part of a chapter that is fingerprinted: its sentences and its scene, whatever shape they have.
type FingerprintedChapter = { sentences: unknown; scene: unknown };

// The built files whose exact bytes are fingerprinted, besides the chapter's sentences and scene: everything narrate
// writes that a viewer could see or hear, captions and beat timings included.
const BUILT_FILES = ['narration.txt', 'narration.wav', 'beats.json', 'captions.vtt', 'captions.json', 'index.html', 'gsap.min.js'];
// The record's shape; an older record lacks fingerprints for some built files, so it is never trusted.
// Version 3 adds gsap.min.js, which version 2 chapters loaded from a CDN instead.
const RECORD_VERSION = 3;
const CHANGED = 'chapter changed after narrate: fix the spec, delete the chapter folder, then scaffold, audit and narrate again';

// The sha256 of some bytes or text, as hex.
function sha256(data: string | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Copies a value with every object's keys sorted, so the same content always serialises the same way.
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  // value is a non-null, non-array object here, so it can be read by key
  const obj = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sortKeys(obj[k])]));
}

// A commit id as git prints it: 40 lower-case hex characters.
const COMMIT = /^[0-9a-f]{40}$/;

// Fingerprints the chapter's sentences and scene (key order ignored) together with the commit they were verified
// against (or null), and each built file read through readFile(name).
function buildRecord(chapter: FingerprintedChapter, readFile: (name: string) => string | Uint8Array, commit: string | null = null): BuildRecord {
  const verified = { sentences: chapter.sentences, scene: chapter.scene, verified_against_commit: commit };
  const sha: BuildFingerprint = { chapter: sha256(JSON.stringify(sortKeys(verified))) };
  for (const name of BUILT_FILES) sha[name] = sha256(readFile(name));
  return { version: RECORD_VERSION, verified_against_commit: commit, sha256: sha };
}

// True when build.json is the current version and has exactly the expected fingerprint names, each 64 hex characters.
function wellFormed(record: unknown): record is BuildRecord {
  if (!record || typeof record !== 'object') return false;
  // record is a non-null object; every field is checked below before it is trusted
  const r = record as { version?: unknown; verified_against_commit?: unknown; sha256?: unknown };
  if (r.version !== RECORD_VERSION) return false;
  const commit = r.verified_against_commit;
  if (commit !== null && !(typeof commit === 'string' && COMMIT.test(commit))) return false;
  const shaValue = r.sha256;
  if (shaValue === null || typeof shaValue !== 'object' || Array.isArray(shaValue)) return false;
  // a plain object was just proved; each value is checked to be a string below
  const sha = shaValue as Record<string, unknown>;
  const names = ['chapter', ...BUILT_FILES];
  const keys = Object.keys(sha);
  return keys.length === names.length && names.every((n) => typeof sha[n] === 'string' && /^[0-9a-f]{64}$/.test(sha[n]));
}

// Returns why the chapter folder no longer matches its build record (missing, malformed or any fingerprint differs), or null.
function buildChangedReason(dir: string, chapter: FingerprintedChapter): string | null {
  let recorded: BuildRecord;
  let actual: BuildRecord;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
    if (!wellFormed(parsed)) return CHANGED;
    recorded = parsed;
    // the recorded commit goes into the recomputed fingerprint, so editing it alone shows as a change
    actual = buildRecord(chapter, (name) => fs.readFileSync(path.join(dir, name)), recorded.verified_against_commit);
  } catch {
    return CHANGED;
  }
  const same = Object.keys(actual.sha256).every((name) => recorded.sha256[name] === actual.sha256[name]);
  return same ? null : CHANGED;
}

export { buildRecord, buildChangedReason, sha256, COMMIT, RECORD_VERSION };
export type { BuildRecord, BuildFingerprint, FingerprintedChapter };
