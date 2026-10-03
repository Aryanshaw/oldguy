'use strict';
// The JSON API the player and Claude's CLI use: state, live stream, chat, replies, chapter changes and the heartbeat.
const path = require('node:path');
const { appendEvent, readEventsAfter, appendReply, readThread } = require('../lib/events.cjs');
const { loadManifest, insertChapter, reorderChapters, setChapterFields } = require('../lib/manifest.cjs');
const { scanChapter } = require('../lib/chapter-scan.cjs');
const { handleExport } = require('./export-route.cjs');

const HEARTBEAT_MS = 15000;
// The only chapter fields the API may change.
const SETTABLE = ['status', 'quality', 'title', 'placement_reason', 'question'];
const ADD_FIELDS = ['op', 'id', 'title', 'parent_id', 'placement_reason', 'question', 'after'];

// Makes an Error that carries an HTTP status; the server answers it as {error: message}.
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Runs a library call. Its one-line validation errors become a 400; real system errors (they have a code) pass on as 500s.
function lib(fn) {
  try { return fn(); } catch (err) {
    if (err && err.code) throw err;
    throw httpError(400, err.message);
  }
}

// Tells the open tabs. The change is already stored, so a failure here is only logged and never changes the answer.
function tell(state, event, makeData) {
  try { state.hub.broadcast(event, makeData()); } catch (err) { state.logError(err); }
}

// Where the chat files live.
const eventsFile = (state) => path.join(state.slugDir, 'state', 'events.jsonl');
const threadFile = (state) => path.join(state.slugDir, 'state', 'thread.jsonl');
const manifestFile = (state) => path.join(state.slugDir, 'manifest.json');

// The injected clock in milliseconds (tests move it by hand).
const clock = (state) => (state.deps.now || Date.now)();
// Same clock as a Date, for the timestamps the chat files store.
const clockDate = (state) => () => new Date(clock(state));

// True when a heartbeat arrived less than 15 seconds ago.
function isConnected(state) {
  return state.lastHeartbeat !== null && clock(state) - state.lastHeartbeat < HEARTBEAT_MS;
}

// Turns a stored time into a number for sorting; a broken value sorts first.
function timeOf(entry) {
  const n = Date.parse(entry.ts);
  return Number.isNaN(n) ? 0 : n;
}

// Builds the chat list the browser shows: viewer messages and Claude's replies in time order, events first on a tie.
function buildThread(state) {
  const viewer = readEventsAfter(eventsFile(state), null)
    .filter((e) => e.type === 'message')
    .map((e) => ({ ...e, role: 'viewer' }));
  const claude = readThread(threadFile(state)).map((r) => ({ ...r, role: 'claude' }));
  return [...viewer, ...claude].sort((a, b) => timeOf(a) - timeOf(b));
}

// The whole picture the browser needs; also the payload of every "state" stream event.
function buildState(state) {
  return {
    manifest: loadManifest(manifestFile(state)),
    thread: buildThread(state),
    claude_connected: isConnected(state),
    now: clock(state),
  };
}

// GET /api/state.
function handleState({ res, state, sendJson }) {
  sendJson(res, 200, buildState(state));
}

// GET /api/stream: opens a live stream; the first thing sent is the current state. The response stays open until the
// client leaves or the server closes (the hub ends it), and no per-request timer applies once the request is read.
function handleStream({ res, state }) {
  const send = state.hub.add(res);
  send('state', buildState(state));
}

// POST /api/message: stores a viewer event (type, text, context) and tells the other open tabs.
async function handleMessage({ req, res, state, sendJson, readJsonBody }) {
  const { type, text, context } = await readJsonBody(req);
  const input = { type };
  if (text !== undefined) input.text = text;
  if (context !== undefined) input.context = context;
  const event = lib(() => appendEvent(eventsFile(state), input, { now: clockDate(state) }));
  tell(state, 'state', () => buildState(state));
  sendJson(res, 200, { event });
}

// POST /api/reply: stores Claude's answer to an event and streams it to the open tabs.
async function handleReply({ req, res, state, sendJson, readJsonBody }) {
  const { in_reply_to, text, sources } = await readJsonBody(req);
  const input = { in_reply_to, text };
  if (sources !== undefined) input.sources = sources;
  const reply = lib(() => appendReply(threadFile(state), input, { eventsFile: eventsFile(state), now: clockDate(state) }));
  tell(state, 'reply', () => ({ ...reply, role: 'claude' }));
  sendJson(res, 200, { reply });
}

// POST /api/heartbeat: notes that a live Claude session is listening; tabs hear about it if that changes the answer.
async function handleHeartbeat({ req, res, state, sendJson, readJsonBody }) {
  await readJsonBody(req);
  const before = isConnected(state);
  state.lastHeartbeat = clock(state);
  if (!before) tell(state, 'state', () => buildState(state));
  sendJson(res, 200, { ok: true });
}

// Checks that each named field, when present, is text (or text/null where the rule says so). Runs before the queue.
function checkTypes(obj, { text = [], textOrNull = [] }) {
  for (const key of text) if (obj[key] !== undefined && typeof obj[key] !== 'string') throw httpError(400, `${key} must be text`);
  for (const key of textOrNull) {
    if (obj[key] !== undefined && obj[key] !== null && typeof obj[key] !== 'string') throw httpError(400, `${key} must be text or null`);
  }
}

// The change for op "add": a new pending/draft row placed after `after`, else after its parent, else at the end.
function addChange(body) {
  const unknown = Object.keys(body).filter((k) => !ADD_FIELDS.includes(k));
  if (unknown.length) throw httpError(400, `unknown field "${unknown[0].replace(/\s+/g, ' ')}"`);
  if (typeof body.id !== 'string') throw httpError(400, 'id must be text');
  checkTypes(body, { textOrNull: ['after', 'parent_id', 'title', 'placement_reason', 'question'] });
  return (m) => {
    if (m.chapters.some((c) => c.id === body.id)) throw httpError(409, `chapter "${body.id}" already exists`);
    for (const [key, v] of [['after', body.after], ['parent_id', body.parent_id]]) {
      if (v !== undefined && v !== null && !m.chapters.some((c) => c.id === v)) throw httpError(400, `${key} "${String(v).replace(/\s+/g, ' ')}" names no chapter`);
    }
    const row = { id: body.id, title: body.title ?? body.id };
    for (const key of ['parent_id', 'placement_reason', 'question']) if (body[key] !== undefined) row[key] = body[key];
    const place = body.after ?? body.parent_id ?? undefined;
    return lib(() => insertChapter(m, row, { after: place === null ? undefined : place }));
  };
}

// The change for op "reorder": the new full order of ids.
function reorderChange(body) {
  if (!Array.isArray(body.ids) || !body.ids.every((i) => typeof i === 'string')) throw httpError(400, 'ids must be a list of chapter ids');
  return (m) => lib(() => reorderChapters(m, body.ids));
}

// The change for op "set": some allowed fields of one chapter. Status "ready" has to be proven by the files right now.
function setChange(state, body) {
  const fields = body.fields;
  if (typeof body.id !== 'string') throw httpError(400, 'id must be text');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0) throw httpError(400, 'fields must be an object with something to change');
  const bad = Object.keys(fields).find((k) => !SETTABLE.includes(k));
  if (bad !== undefined) throw httpError(400, `field "${bad.replace(/\s+/g, ' ')}" cannot be set (allowed: ${SETTABLE.join(', ')})`);
  checkTypes(fields, { text: ['status', 'quality', 'title'], textOrNull: ['placement_reason', 'question'] });
  return (m) => {
    if (!m.chapters.some((c) => c.id === body.id)) throw httpError(404, `no chapter "${body.id.replace(/\s+/g, ' ')}"`);
    const next = lib(() => setChapterFields(m, body.id, fields));
    if (fields.status === 'ready' && scanChapter(path.join(state.slugDir, 'chapters', body.id)).status !== 'ready') {
      throw httpError(409, 'the chapter files do not show a current video, so it cannot be marked ready');
    }
    return next;
  };
}

// Picks the change for the requested op, or refuses an unknown one.
function chooseChange(state, body) {
  if (body.op === 'add') return addChange(body);
  if (body.op === 'reorder') return reorderChange(body);
  if (body.op === 'set') return setChange(state, body);
  throw httpError(400, 'op must be add, reorder or set');
}

// POST /api/chapters: the only way Claude changes the manifest. Goes through the one save queue, then tells the tabs.
async function handleChapters({ req, res, state, sendJson, readJsonBody }) {
  const body = await readJsonBody(req);
  const change = chooseChange(state, body);
  let manifest;
  try {
    manifest = await state.updateManifest(change);
  } catch (err) {
    if (err && Number.isInteger(err.status)) throw err;
    state.logError(err);
    return sendJson(res, 500, { error: 'could not save the manifest' });
  }
  tell(state, 'chapter', () => ({ op: body.op, ...(typeof body.id === 'string' ? { id: body.id } : {}), manifest }));
  sendJson(res, 200, { manifest });
}

const API_ROUTES = [
  { method: 'GET', pattern: '/api/state', handler: handleState },
  { method: 'GET', pattern: '/api/stream', handler: handleStream },
  { method: 'POST', pattern: '/api/message', handler: handleMessage },
  { method: 'POST', pattern: '/api/reply', handler: handleReply },
  { method: 'POST', pattern: '/api/chapters', handler: handleChapters },
  { method: 'POST', pattern: '/api/heartbeat', handler: handleHeartbeat },
  { method: 'POST', pattern: '/api/export', handler: handleExport },
];

module.exports = { API_ROUTES };
