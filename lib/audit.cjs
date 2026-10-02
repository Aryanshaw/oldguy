// Claim audit: proves every claim in a chapter's narration points at real code.
const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Collapses all whitespace runs (tabs, CRLF, spaces) to one space so layout differences do not matter.
function normalise(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Resolves a source path against the root and refuses anything whose real location leaves the root.
function resolveInsideRoot(root, file) {
  let realRoot;
  let real;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return { reason: 'root not found' };
  }
  try {
    real = fs.realpathSync(path.resolve(realRoot, file));
  } catch {
    return { reason: `file not found: ${file}` };
  }
  const rel = path.relative(realRoot, real);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    return { reason: `file outside root: ${file}` };
  }
  return { real };
}

// Reads a source file as UTF-8 text; refuses non-files, huge files, binary and invalid UTF-8.
function readTextFile(real, file) {
  const stat = fs.statSync(real);
  if (!stat.isFile()) return { reason: `not a regular file: ${file}` };
  if (stat.size > MAX_FILE_BYTES) return { reason: `file too large (over 2 MB): ${file}` };
  const bytes = fs.readFileSync(real);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('nul byte');
    return { text };
  } catch {
    return { reason: `not valid UTF-8 text: ${file}` };
  }
}

// Checks the 1-based inclusive line range is whole numbers inside the file; returns a reason if not.
function checkLineRange(lines, lineCount) {
  const [start, end] = Array.isArray(lines) ? lines : [];
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end) {
    return `invalid line range ${start}-${end}`;
  }
  if (end > lineCount) return `lines ${start}-${end} past end of file (${lineCount} lines)`;
  return null;
}

// Returns the reason one source fails (bad file, bad range, quote not there) or null if it holds.
function checkSource(root, source) {
  const quote = normalise(typeof source.quote === 'string' ? source.quote : '');
  if (quote === '') return 'empty quote';
  const located = resolveInsideRoot(root, source.file);
  if (located.reason) return located.reason;
  const loaded = readTextFile(located.real, source.file);
  if (loaded.reason) return loaded.reason;
  // a trailing newline does not start a new line, so drop it before counting
  const lines = loaded.text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const rangeProblem = checkLineRange(source.lines, lines.length);
  if (rangeProblem) return rangeProblem;
  const [start, end] = source.lines;
  const joined = normalise(lines.slice(start - 1, end).join('\n'));
  return joined.includes(quote) ? null : `quote not on lines ${start}-${end}`;
}

// Returns the reason one sentence fails (claim without sources or citing an unknown source) or null.
function checkSentence(sentence, knownIds) {
  if (sentence.kind !== 'claim') return null;
  const ids = sentence.source_ids || [];
  if (ids.length === 0) return 'claim has no source ids';
  const unknown = ids.find((id) => !knownIds.has(id));
  return unknown === undefined ? null : `unknown source id ${unknown}`;
}

// Audits every source and sentence and reports all failures, not just the first.
function audit({ root, sources, sentences }) {
  const failures = [];
  const knownIds = new Set(sources.map((s) => s.id));
  for (const source of sources) {
    const reason = checkSource(root, source);
    if (reason) failures.push({ id: String(source.id), reason });
  }
  sentences.forEach((sentence, index) => {
    const reason = checkSentence(sentence, knownIds);
    if (reason) failures.push({ id: `sentence ${index}`, reason });
  });
  return { ok: failures.length === 0, failures };
}

module.exports = { audit };
