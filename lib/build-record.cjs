'use strict';
// The build record (build.json): fingerprints of the audited text and of the files narrate built from it,
// so render can prove the audio and page it is about to publish still come from the text that passed the audit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The built files whose exact bytes are fingerprinted, besides the chapter's sentences and scene: everything narrate
// writes that a viewer could see or hear, captions and beat timings included.
const BUILT_FILES = ['narration.txt', 'narration.wav', 'beats.json', 'captions.vtt', 'captions.json', 'index.html'];
// The record's shape; an older record lacks fingerprints for some built files, so it is never trusted.
const RECORD_VERSION = 2;
const CHANGED = 'chapter changed after narrate: fix the spec, delete the chapter folder, then scaffold, audit and narrate again';

// The sha256 of some bytes or text, as hex.
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Copies a value with every object's keys sorted, so the same content always serialises the same way.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
}

// Fingerprints the chapter's sentences and scene (key order ignored) and each built file read through readFile(name).
function buildRecord(chapter, readFile) {
  const sha = { chapter: sha256(JSON.stringify(sortKeys({ sentences: chapter.sentences, scene: chapter.scene }))) };
  for (const name of BUILT_FILES) sha[name] = sha256(readFile(name));
  return { version: RECORD_VERSION, sha256: sha };
}

// True when build.json is the current version and has exactly the expected fingerprint names, each 64 hex characters.
function wellFormed(record) {
  if (!record || record.version !== RECORD_VERSION) return false;
  const sha = record.sha256;
  if (sha === null || typeof sha !== 'object' || Array.isArray(sha)) return false;
  const names = ['chapter', ...BUILT_FILES];
  const keys = Object.keys(sha);
  return keys.length === names.length && names.every((n) => typeof sha[n] === 'string' && /^[0-9a-f]{64}$/.test(sha[n]));
}

// Returns why the chapter folder no longer matches its build record (missing, malformed or any fingerprint differs), or null.
function buildChangedReason(dir, chapter) {
  let recorded;
  let actual;
  try {
    recorded = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
    actual = buildRecord(chapter, (name) => fs.readFileSync(path.join(dir, name)));
  } catch {
    return CHANGED;
  }
  if (!wellFormed(recorded)) return CHANGED;
  const same = Object.keys(actual.sha256).every((name) => recorded.sha256[name] === actual.sha256[name]);
  return same ? null : CHANGED;
}

module.exports = { buildRecord, buildChangedReason, sha256 };
