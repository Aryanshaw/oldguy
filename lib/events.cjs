'use strict';
// Two plain files carry the chat: events.jsonl (viewer to Claude) and thread.jsonl (Claude to viewer).
// Everything here is synchronous so an id and its line are never separated by an await.
const fs = require('node:fs');
const path = require('node:path');
const { slugChapterId } = require('./chapter.cjs');
const { escapesRoot } = require('./audit.mts');

const TYPES = ['message', 'make_video', 'just_text', 'retry_chapter', 'export'];
const MAX_TEXT = 4000;
const DEFAULT_MAX_BYTES = 8192;

// Fails with a one-line message; the server turns it into a 400.
function fail(message) {
  throw new Error(message);
}

// Checks text length and NUL; `required` says whether missing text is an error.
function checkText(text, required) {
  if (text === undefined || text === null) {
    if (required) fail('text is required');
    return;
  }
  if (typeof text !== 'string') fail('text must be a string');
  if (required && text.length === 0) fail('text is required');
  if (text.length > MAX_TEXT) fail(`text is over ${MAX_TEXT} characters`);
  if (text.includes('\0')) fail('text must not contain a NUL byte');
}

// Context must be exactly {chapter_id, t}: a valid chapter id and a finite time of 0 or more.
function checkContext(context) {
  if (context === undefined) return;
  const ok = context && typeof context === 'object' && !Array.isArray(context);
  if (!ok || Object.keys(context).sort().join() !== 'chapter_id,t') fail('context must be exactly {chapter_id, t}');
  if (typeof context.chapter_id !== 'string' || slugChapterId(context.chapter_id) !== context.chapter_id) {
    fail('context.chapter_id is not a valid chapter id');
  }
  if (typeof context.t !== 'number' || !Number.isFinite(context.t) || context.t < 0) {
    fail('context.t must be a number of 0 or more');
  }
}

// One source must be {file, lines}: a relative path that stays inside the root, and "12" or "12-20".
function checkSource(source) {
  if (!source || typeof source.file !== 'string' || source.file === '' || source.file.includes('\0')) {
    fail('each source needs a file');
  }
  if (escapesRoot(path.normalize(source.file))) fail(`source file must be a relative path inside the project: ${source.file}`);
  const m = typeof source.lines === 'string' ? /^(\d+)(?:-(\d+))?$/.exec(source.lines) : null;
  const start = m ? Number(m[1]) : 0;
  const end = m && m[2] !== undefined ? Number(m[2]) : start;
  if (!m || start < 1 || end < start) fail(`source lines must look like "12" or "12-20": ${source.lines}`);
}

// Sources are optional; when present it is a list of {file, lines}.
function checkSources(sources) {
  if (sources === undefined) return;
  if (!Array.isArray(sources)) fail('sources must be a list of {file, lines}');
  sources.forEach(checkSource);
}

// True when id is exactly <prefix>_<digits> and the number is a safe integer.
function validId(id, prefix) {
  const m = typeof id === 'string' ? new RegExp(`^${prefix}_(\\d+)$`).exec(id) : null;
  return m !== null && Number.isSafeInteger(Number(m[1]));
}

// Reads a jsonl file into its valid objects (with the given id prefix); bad, partial or odd-id lines are skipped.
function readEntries(file, prefix) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && validId(entry.id, prefix)) out.push(entry);
    } catch { /* skip garbage */ }
  }
  return out;
}

// Next id is one more than the largest valid id in the file, so ids never repeat or go backwards.
function nextId(file, prefix) {
  const max = readEntries(file, prefix).reduce((m, e) => Math.max(m, Number(e.id.slice(prefix.length + 1))), 0);
  if (max >= Number.MAX_SAFE_INTEGER) fail('no more ids available in this file');
  return `${prefix}_${max + 1}`;
}

// Asks the clock for the time as an ISO string; a broken clock is a plain one-line Error.
function stamp(now) {
  const d = now();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) fail('clock returned an invalid time');
  return d.toISOString();
}

// Writes one complete line with a single append call; starts a fresh line first if a crash left a partial one.
function appendLine(file, entry, maxBytes) {
  const line = JSON.stringify(entry) + '\n';
  if (Buffer.byteLength(line, 'utf8') > maxBytes) fail(`entry is too large (over ${maxBytes} bytes)`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prefix = '';
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const last = Buffer.alloc(1);
    try { fs.readSync(fd, last, 0, 1, size - 1); } finally { fs.closeSync(fd); }
    if (size > 0 && last[0] !== 0x0a) prefix = '\n';
  } catch { /* file does not exist yet */ }
  fs.appendFileSync(file, prefix + line);
}

// Validates and stores a viewer event; returns the stored event with its id and timestamp.
function appendEvent(file, input, { now = () => new Date(), maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!input || !TYPES.includes(input.type)) fail(`type must be one of: ${TYPES.join(', ')}`);
  checkText(input.text, input.type === 'message');
  checkContext(input.context);
  const event = { id: nextId(file, 'evt'), ts: stamp(now), type: input.type };
  if (input.text !== undefined) event.text = input.text;
  if (input.context !== undefined) event.context = input.context;
  appendLine(file, event, maxBytes);
  return event;
}

// Returns events with a larger number than afterId; no afterId gives all, a malformed one throws.
function readEventsAfter(file, afterId) {
  if (afterId === undefined || afterId === null) return readEntries(file, 'evt');
  if (!validId(afterId, 'evt')) fail('afterId must look like evt_<number>');
  const n = Number(afterId.slice(4));
  return readEntries(file, 'evt').filter((e) => Number(e.id.slice(4)) > n);
}

// Validates and stores Claude's reply to an existing event; returns the stored reply.
function appendReply(file, input, { eventsFile, now = () => new Date(), maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!input) fail('reply is required');
  checkText(input.text, true);
  checkSources(input.sources);
  if (!readEntries(eventsFile, 'evt').some((e) => e.id === input.in_reply_to)) {
    fail(`in_reply_to ${input.in_reply_to} is not a known event`);
  }
  const reply = { id: nextId(file, 'rep'), ts: stamp(now), in_reply_to: input.in_reply_to, text: input.text };
  if (input.sources !== undefined) reply.sources = input.sources.map(({ file: f, lines }) => ({ file: f, lines }));
  appendLine(file, reply, maxBytes);
  return reply;
}

// Returns every valid reply in the thread file, oldest first.
function readThread(file) {
  return readEntries(file, 'rep');
}

module.exports = { appendEvent, readEventsAfter, appendReply, readThread };
