// The JSON API the player and Claude's CLI use: state, live stream, chat, replies, chapter changes and the heartbeat.
import path from 'node:path';
import { appendEvent, readEventsAfter, appendReply, readThread, appendAck } from '../lib/events.mts';
import { loadManifest, insertChapter, reorderChapters, setChapterFields } from '../lib/manifest.mts';
import { scanChapter } from '../lib/chapter-scan.mts';
import { handleExport } from './export-route.mts';
import type { Ack, EventContext, EventType, Reply, SourceRef, ThreadEntry, ViewerEvent } from '../lib/events.mts';
import type { Manifest, ManifestRow, NewRow } from '../lib/manifest.mts';
import type { ChapterPayload, StatePayload, StreamData, StreamEventName } from '../lib/sse.mts';
import type { JsonObject } from '../lib/http-guard.mts';
import type { ExportResult } from '../lib/export.mts';
import type { Route, RouteContext, ServerState } from './types.mts';

// What a client sends to POST /api/message.
type MessageBody = { type: EventType; text?: string; context?: EventContext; ref?: string };
// What a client sends to POST /api/reply.
type ReplyBody = { in_reply_to: string; text: string; sources?: SourceRef[]; offer_video?: true };
// What a client sends to POST /api/ack: the event Claude has handled without a text reply.
type AckBody = { event_id: string };
// The chapter fields POST /api/chapters may change with op "set".
type SettableFields = Partial<Pick<ManifestRow, 'status' | 'quality' | 'title' | 'placement_reason' | 'question'>>;
// What a client sends to POST /api/chapters: add a chapter, put all of them in a new order, or change one.
type ChaptersBody =
  | { op: 'add'; id: string; title?: string | null; parent_id?: string | null; placement_reason?: string | null; question?: string | null; after?: string | null }
  | { op: 'reorder'; ids: string[] }
  | { op: 'set'; id: string; fields: SettableFields };
// What a client sends to POST /api/export.
type ExportBody = { dest: string; mode?: 'full' | 'drafts' };
// What GET /api/state answers (and what every "state" stream event carries).
type StateResponse = StatePayload;
// What POST /api/message, /api/reply, /api/chapters and /api/export answer on success.
type MessageResponse = { event: ViewerEvent };
type ReplyResponse = { reply: Reply };
type AckResponse = { ack: Ack };
type ChaptersResponse = { manifest: Manifest };
type ExportResponse = ExportResult;
// A change to the manifest: gets the loaded manifest, returns the new one (it may throw an Error that carries a status).
type ManifestChange = (m: Manifest) => Manifest;
// An Error that carries the HTTP status the server answers with.
type HttpError = Error & { status: number };

const HEARTBEAT_MS = 15000;
// The only chapter fields the API may change.
const SETTABLE = ['status', 'quality', 'title', 'placement_reason', 'question'];
const ADD_FIELDS = ['op', 'id', 'title', 'parent_id', 'placement_reason', 'question', 'after'];

// Makes an Error that carries an HTTP status; the server answers it as {error: message}.
function httpError(status: number, message: string): HttpError {
  return Object.assign(new Error(message), { status });
}

// Runs a library call. Its one-line validation errors become a 400; real system errors (they have a code) pass on as 500s.
function lib<T>(fn: () => T): T {
  try { return fn(); } catch (err) {
    if (err && (err as { code?: unknown }).code) throw err;
    throw httpError(400, (err as Error).message);
  }
}

// Tells the open tabs. The change is already stored, so a failure here is only logged and never changes the answer.
function tell<E extends StreamEventName>(state: ServerState, event: E, makeData: () => StreamData<E>): void {
  try { state.hub.broadcast(event, makeData()); } catch (err) { state.logError(err); }
}

// Where the chat files live.
const eventsFile = (state: ServerState): string => path.join(state.slugDir, 'state', 'events.jsonl');
const threadFile = (state: ServerState): string => path.join(state.slugDir, 'state', 'thread.jsonl');
const acksFile = (state: ServerState): string => path.join(state.slugDir, 'state', 'acks.jsonl');
const manifestFile = (state: ServerState): string => path.join(state.slugDir, 'manifest.json');

// The injected clock in milliseconds (tests move it by hand).
const clock = (state: ServerState): number => (state.deps.now || Date.now)();
// Same clock as a Date, for the timestamps the chat files store.
const clockDate = (state: ServerState): (() => Date) => () => new Date(clock(state));

// True when a heartbeat arrived less than 15 seconds ago.
function isConnected(state: ServerState): boolean {
  return state.lastHeartbeat !== null && clock(state) - state.lastHeartbeat < HEARTBEAT_MS;
}

// Turns a stored time into a number for sorting; a broken value sorts first.
function timeOf(entry: { ts: string }): number {
  const n = Date.parse(entry.ts);
  return Number.isNaN(n) ? 0 : n;
}

// Builds the chat list the browser shows: viewer messages and Claude's replies in time order, events first on a tie.
function buildThread(state: ServerState): ThreadEntry[] {
  const viewer = readEventsAfter(eventsFile(state), null)
    .filter((e) => e.type === 'message')
    .map((e): ThreadEntry => ({ ...e, role: 'viewer' }));
  const claude = readThread(threadFile(state)).map((r): ThreadEntry => ({ ...r, role: 'claude' }));
  return [...viewer, ...claude].sort((a, b) => timeOf(a) - timeOf(b));
}

// The whole picture the browser needs; also the payload of every "state" stream event.
function buildState(state: ServerState): StateResponse {
  return {
    manifest: loadManifest(manifestFile(state)),
    thread: buildThread(state),
    claude_connected: isConnected(state),
    now: clock(state),
  };
}

// GET /api/state.
function handleState({ res, state, sendJson }: RouteContext): void {
  sendJson(res, 200, buildState(state));
}

// GET /api/stream: opens a live stream; the first thing sent is the current state. The response stays open until the
// client leaves or the server closes (the hub ends it), and no per-request timer applies once the request is read.
function handleStream({ res, state }: RouteContext): void {
  const send = state.hub.add(res);
  send('state', buildState(state));
}

// POST /api/message: stores a viewer event (type, text, context) and tells the other open tabs.
async function handleMessage({ req, res, state, sendJson, readJsonBody }: RouteContext): Promise<void> {
  const { type, text, context, ref } = await readJsonBody(req);
  const input: Record<string, unknown> = { type };
  if (text !== undefined) input.text = text;
  if (context !== undefined) input.context = context;
  if (ref !== undefined) input.ref = ref;
  const event = lib(() => appendEvent(eventsFile(state), input, { now: clockDate(state) }));
  tell(state, 'state', () => buildState(state));
  sendJson(res, 200, { event });
}

// POST /api/reply: stores Claude's answer to an event and streams it to the open tabs.
async function handleReply({ req, res, state, sendJson, readJsonBody }: RouteContext): Promise<void> {
  const { in_reply_to, text, sources, offer_video } = await readJsonBody(req);
  const input: Record<string, unknown> = { in_reply_to, text };
  if (sources !== undefined) input.sources = sources;
  if (offer_video !== undefined) input.offer_video = offer_video;
  const reply = lib(() => appendReply(threadFile(state), input, { eventsFile: eventsFile(state), now: clockDate(state) }));
  tell(state, 'reply', () => ({ ...reply, role: 'claude' }));
  sendJson(res, 200, { reply });
}

// POST /api/ack: records that Claude handled an event that gets no text reply (a button press), so yap listen stops
// showing it. An unknown event is a 404; a malformed id a 400.
async function handleAck({ req, res, state, sendJson, readJsonBody }: RouteContext): Promise<void> {
  const { event_id } = await readJsonBody(req);
  if (typeof event_id === 'string' && /^evt_\d+$/.test(event_id) && !readEventsAfter(eventsFile(state), null).some((e) => e.id === event_id)) {
    throw httpError(404, `${event_id} is not a known event`);
  }
  const ack = lib(() => appendAck(acksFile(state), event_id, { eventsFile: eventsFile(state), now: clockDate(state) }));
  sendJson(res, 200, { ack });
}

// Stops the "Claude went quiet" timer, if one is armed (close() uses this too).
function clearHeartbeatTimer(state: ServerState): void {
  if (!state.heartbeatTimer) return;
  (state.deps.clearTimeout || clearTimeout)(state.heartbeatTimer);
  state.heartbeatTimer = null;
}

// Arms the one timer that tells the open tabs 15 s after the last heartbeat that Claude is no longer connected.
// Every heartbeat replaces it, so it only fires when no newer heartbeat has arrived. It is unref()ed so it never keeps the process alive.
function armHeartbeatTimer(state: ServerState): void {
  clearHeartbeatTimer(state);
  const timer = (state.deps.setTimeout || setTimeout)(() => {
    state.heartbeatTimer = null;
    state.lastHeartbeat = null;
    tell(state, 'state', () => buildState(state));
  }, HEARTBEAT_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
  state.heartbeatTimer = timer;
}

// POST /api/heartbeat: notes that a live Claude session is listening; tabs hear about it if that changes the answer,
// and again (from the timer) when the heartbeats stop.
async function handleHeartbeat({ req, res, state, sendJson, readJsonBody }: RouteContext): Promise<void> {
  await readJsonBody(req);
  if (state.closing) return sendJson(res, 503, { error: 'the server is closing' });
  const before = isConnected(state);
  state.lastHeartbeat = clock(state);
  armHeartbeatTimer(state);
  if (!before) tell(state, 'state', () => buildState(state));
  sendJson(res, 200, { ok: true });
}

// Checks that each named field, when present, is text (or text/null where the rule says so). Runs before the queue.
function checkTypes(obj: Record<string, unknown>, { text = [], textOrNull = [] }: { text?: string[]; textOrNull?: string[] }): void {
  for (const key of text) if (obj[key] !== undefined && typeof obj[key] !== 'string') throw httpError(400, `${key} must be text`);
  for (const key of textOrNull) {
    if (obj[key] !== undefined && obj[key] !== null && typeof obj[key] !== 'string') throw httpError(400, `${key} must be text or null`);
  }
}

// The change for op "add": a new pending/draft row placed after `after`, else after its parent, else at the end.
function addChange(body: JsonObject): ManifestChange {
  const unknown = Object.keys(body).filter((k) => !ADD_FIELDS.includes(k));
  if (unknown.length) throw httpError(400, `unknown field "${unknown[0].replace(/\s+/g, ' ')}"`);
  const id = body.id;
  if (typeof id !== 'string') throw httpError(400, 'id must be text');
  checkTypes(body, { textOrNull: ['after', 'parent_id', 'title', 'placement_reason', 'question'] });
  return (m) => {
    if (m.chapters.some((c) => c.id === id)) throw httpError(409, `chapter "${id}" already exists`);
    for (const [key, v] of [['after', body.after], ['parent_id', body.parent_id]] as [string, unknown][]) {
      if (v !== undefined && v !== null && !m.chapters.some((c) => c.id === v)) throw httpError(400, `${key} "${String(v).replace(/\s+/g, ' ')}" names no chapter`);
    }
    // checkTypes just proved title, parent_id, placement_reason and question are text or null; insertChapter checks the rest
    const row: Record<string, unknown> = { id, title: body.title ?? id };
    for (const key of ['parent_id', 'placement_reason', 'question']) if (body[key] !== undefined) row[key] = body[key];
    const place = (body.after ?? body.parent_id ?? undefined) as string | null | undefined;
    return lib(() => insertChapter(m, row as NewRow, { after: place === null ? undefined : place }));
  };
}

// The change for op "reorder": the new full order of ids.
function reorderChange(body: JsonObject): ManifestChange {
  if (!Array.isArray(body.ids) || !body.ids.every((i) => typeof i === 'string')) throw httpError(400, 'ids must be a list of chapter ids');
  // every entry was just proved to be text
  const ids = body.ids as string[];
  return (m) => lib(() => reorderChapters(m, ids));
}

// The change for op "set": some allowed fields of one chapter. Status "ready" has to be proven by the files right now.
function setChange(state: ServerState, body: JsonObject): ManifestChange {
  const fields = body.fields;
  const id = body.id;
  if (typeof id !== 'string') throw httpError(400, 'id must be text');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0) throw httpError(400, 'fields must be an object with something to change');
  const given = fields as Record<string, unknown>;
  const bad = Object.keys(given).find((k) => !SETTABLE.includes(k));
  if (bad !== undefined) throw httpError(400, `field "${bad.replace(/\s+/g, ' ')}" cannot be set (allowed: ${SETTABLE.join(', ')})`);
  checkTypes(given, { text: ['status', 'quality', 'title'], textOrNull: ['placement_reason', 'question'] });
  // only the five settable fields are present and each is text (or text/null); setChapterFields checks the values
  const patch = given as SettableFields;
  return (m) => {
    if (!m.chapters.some((c) => c.id === id)) throw httpError(404, `no chapter "${id.replace(/\s+/g, ' ')}"`);
    const next = lib(() => setChapterFields(m, id, patch));
    if (patch.status === 'ready' && scanChapter(path.join(state.slugDir, 'chapters', id)).status !== 'ready') {
      throw httpError(409, 'the chapter files do not show a current video, so it cannot be marked ready');
    }
    return next;
  };
}

// Picks the change for the requested op, or refuses an unknown one.
function chooseChange(state: ServerState, body: JsonObject): ManifestChange {
  if (body.op === 'add') return addChange(body);
  if (body.op === 'reorder') return reorderChange(body);
  if (body.op === 'set') return setChange(state, body);
  throw httpError(400, 'op must be add, reorder or set');
}

// POST /api/chapters: the only way Claude changes the manifest. Goes through the one save queue, then tells the tabs.
async function handleChapters({ req, res, state, sendJson, readJsonBody }: RouteContext): Promise<void> {
  const body = await readJsonBody(req);
  const change = chooseChange(state, body);
  let manifest: Manifest;
  try {
    manifest = await state.updateManifest(change);
  } catch (err) {
    if (err && Number.isInteger((err as { status?: unknown }).status)) throw err;
    state.logError(err);
    return sendJson(res, 500, { error: 'could not save the manifest' });
  }
  // chooseChange only returns for the three known ops
  const op = body.op as ChapterPayload['op'];
  tell(state, 'chapter', () => ({ op, ...(typeof body.id === 'string' ? { id: body.id } : {}), manifest }));
  sendJson(res, 200, { manifest });
}

const API_ROUTES: Route[] = [
  { method: 'GET', pattern: '/api/state', handler: handleState },
  { method: 'GET', pattern: '/api/stream', handler: handleStream },
  { method: 'POST', pattern: '/api/message', handler: handleMessage },
  { method: 'POST', pattern: '/api/reply', handler: handleReply },
  { method: 'POST', pattern: '/api/ack', handler: handleAck },
  { method: 'POST', pattern: '/api/chapters', handler: handleChapters },
  { method: 'POST', pattern: '/api/heartbeat', handler: handleHeartbeat },
  { method: 'POST', pattern: '/api/export', handler: handleExport },
];

export { API_ROUTES, clearHeartbeatTimer };
export type { AckBody, AckResponse,
  MessageBody, ReplyBody, ChaptersBody, ExportBody, SettableFields, StateResponse, MessageResponse, ReplyResponse,
  ChaptersResponse, ExportResponse,
};
