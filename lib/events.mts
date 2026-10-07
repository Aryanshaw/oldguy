// Two plain files carry the chat: events.jsonl (viewer to Claude) and thread.jsonl (Claude to viewer).
// Everything here is synchronous so an id and its line are never separated by an await.
import fs from 'node:fs';
import path from 'node:path';
import { slugChapterId } from './chapter.mts';
import { escapesRoot } from './audit.mts';

const TYPES = ['message', 'make_video', 'just_text', 'retry_chapter', 'export'] as const;
const MAX_TEXT = 4000;
const DEFAULT_MAX_BYTES = 8192;

// What a viewer can do in the page: send a message, or press one of the buttons.
type EventType = (typeof TYPES)[number];
// What the viewer was looking at when they did it: which chapter and which second.
type EventContext = { chapter_id: string; t: number };
// One line of events.jsonl, as stored.
// make_video events also carry ref, the id of the reply the viewer wants turned into a chapter.
type ViewerEvent = { id: string; ts: string; type: EventType; text?: string; context?: EventContext; ref?: string };
// A source Claude cites in a reply: a file and its lines ("12" or "12-20").
type SourceRef = { file: string; lines: string };
// One line of thread.jsonl, as stored: Claude's answer to an event.
// offer_video: true puts a "Make this a video" button under the reply; without it the page shows none.
type Reply = { id: string; ts: string; in_reply_to: string; text: string; sources?: SourceRef[]; offer_video?: true };
// One line of acks.jsonl: Claude has handled an event that gets no text reply (a button press).
type Ack = { id: string; ts: string; event_id: string };
// One entry of the chat as the page shows it: the viewer's message or Claude's reply, tagged with who sent it.
// A reply carries video_asked: true once the viewer has pressed its "Make this a video" button.
type ThreadEntry = (ViewerEvent & { role: 'viewer' }) | (Reply & { role: 'claude'; video_asked?: true });
// Options shared by the writers: a clock and the largest line they will store.
type WriteOptions = { now?: () => Date; maxBytes?: number };
// What a viewer event may carry before it has been checked.
type EventInput = { type?: unknown; text?: unknown; context?: unknown; ref?: unknown };
// What a reply may carry before it has been checked.
type ReplyInput = { in_reply_to?: unknown; text?: unknown; sources?: unknown; offer_video?: unknown };

// Fails with a one-line message; the server turns it into a 400.
function fail(message: string): never {
  throw new Error(message);
}

// Checks text length and NUL; `required` says whether missing text is an error.
function checkText(text: unknown, required: boolean): void {
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
function checkContext(context: unknown): void {
  if (context === undefined) return;
  const ok = context && typeof context === 'object' && !Array.isArray(context);
  // only read after the shape test on the next line has passed
  const c = context as Record<string, unknown>;
  if (!ok || Object.keys(c).sort().join() !== 'chapter_id,t') fail('context must be exactly {chapter_id, t}');
  if (typeof c.chapter_id !== 'string' || slugChapterId(c.chapter_id) !== c.chapter_id) {
    fail('context.chapter_id is not a valid chapter id');
  }
  if (typeof c.t !== 'number' || !Number.isFinite(c.t) || c.t < 0) {
    fail('context.t must be a number of 0 or more');
  }
}

// One source must be {file, lines}: a relative path that stays inside the root, and "12" or "12-20".
function checkSource(item: unknown): void {
  // anything the JSON held; every field is tested before it is used
  const source = item as { file?: unknown; lines?: unknown } | null | undefined;
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
function checkSources(sources: unknown): void {
  if (sources === undefined) return;
  if (!Array.isArray(sources)) fail('sources must be a list of {file, lines}');
  const list: unknown[] = sources;
  list.forEach(checkSource);
}

// True when id is exactly <prefix>_<digits> and the number is a safe integer.
function validId(id: unknown, prefix: string): id is string {
  const m = typeof id === 'string' ? new RegExp(`^${prefix}_(\\d+)$`).exec(id) : null;
  return m !== null && Number.isSafeInteger(Number(m[1]));
}

// Reads a jsonl file into its valid objects (with the given id prefix); bad, partial or odd-id lines are skipped.
function readEntries<T extends { id: string }>(file: string, prefix: string): T[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    try {
      const entry: unknown = JSON.parse(line);
      // only the id is checked here, as before; the writers below are the only code that puts other fields in the file
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && validId((entry as { id?: unknown }).id, prefix)) out.push(entry as T);
    } catch { /* skip garbage */ }
  }
  return out;
}

// Next id is one more than the largest valid id in the file, so ids never repeat or go backwards.
function nextId(file: string, prefix: string): string {
  const max = readEntries<{ id: string }>(file, prefix).reduce((m, e) => Math.max(m, Number(e.id.slice(prefix.length + 1))), 0);
  if (max >= Number.MAX_SAFE_INTEGER) fail('no more ids available in this file');
  return `${prefix}_${max + 1}`;
}

// Asks the clock for the time as an ISO string; a broken clock is a plain one-line Error.
function stamp(now: () => Date): string {
  const d = now();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) fail('clock returned an invalid time');
  return d.toISOString();
}

// Writes one complete line with a single append call; starts a fresh line first if a crash left a partial one.
function appendLine(file: string, entry: ViewerEvent | Reply | Ack, maxBytes: number): void {
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

// A make_video event must name the reply it is about (rep_<n>); no other event type carries ref.
function checkRef(type: unknown, ref: unknown): void {
  if (type !== 'make_video') {
    if (ref !== undefined) fail('only make_video carries ref');
    return;
  }
  if (ref === undefined) fail('ref is required for make_video');
  if (!validId(ref, 'rep')) fail('ref must look like rep_<number>');
}

// Validates and stores a viewer event; returns the stored event with its id and timestamp.
function appendEvent(file: string, anything: unknown, { now = () => new Date(), maxBytes = DEFAULT_MAX_BYTES }: WriteOptions = {}): ViewerEvent {
  const input = anything as EventInput | null | undefined;
  if (!input || !(TYPES as readonly unknown[]).includes(input.type)) fail(`type must be one of: ${TYPES.join(', ')}`);
  checkText(input.text, input.type === 'message');
  checkContext(input.context);
  checkRef(input.type, input.ref);
  // the type, text and context were all checked just above
  const event: ViewerEvent = { id: nextId(file, 'evt'), ts: stamp(now), type: input.type as EventType };
  if (input.text !== undefined) event.text = input.text as string;
  if (input.context !== undefined) event.context = input.context as EventContext;
  if (input.ref !== undefined) event.ref = input.ref as string;
  appendLine(file, event, maxBytes);
  return event;
}

// Returns events with a larger number than afterId; no afterId gives all, a malformed one throws.
function readEventsAfter(file: string, afterId?: string | null): ViewerEvent[] {
  if (afterId === undefined || afterId === null) return readEntries<ViewerEvent>(file, 'evt');
  if (!validId(afterId, 'evt')) fail('afterId must look like evt_<number>');
  const n = Number(afterId.slice(4));
  return readEntries<ViewerEvent>(file, 'evt').filter((e) => Number(e.id.slice(4)) > n);
}

// Validates and stores Claude's reply to an existing event; returns the stored reply.
function appendReply(file: string, anything: unknown, { eventsFile = '', now = () => new Date(), maxBytes = DEFAULT_MAX_BYTES }: WriteOptions & { eventsFile?: string } = {}): Reply {
  const input = anything as ReplyInput | null | undefined;
  if (!input) fail('reply is required');
  checkText(input.text, true);
  checkSources(input.sources);
  if (input.offer_video !== undefined && input.offer_video !== true) fail('offer_video must be true when given');
  if (!readEntries<ViewerEvent>(eventsFile, 'evt').some((e) => e.id === input.in_reply_to)) {
    fail(`in_reply_to ${input.in_reply_to} is not a known event`);
  }
  // the event id was found in the file just above, and the text and sources were checked before that
  const reply: Reply = { id: nextId(file, 'rep'), ts: stamp(now), in_reply_to: input.in_reply_to as string, text: input.text as string };
  if (input.sources !== undefined) reply.sources = (input.sources as SourceRef[]).map(({ file: f, lines }) => ({ file: f, lines }));
  if (input.offer_video === true) reply.offer_video = true;
  appendLine(file, reply, maxBytes);
  return reply;
}

// Returns every valid reply in the thread file, oldest first.
function readThread(file: string): Reply[] {
  return readEntries<Reply>(file, 'rep');
}

// Records that Claude has handled an event that gets no text reply; the event must exist. Acking twice is harmless.
function appendAck(file: string, eventId: unknown, { eventsFile = '', now = () => new Date(), maxBytes = DEFAULT_MAX_BYTES }: WriteOptions & { eventsFile?: string } = {}): Ack {
  if (!validId(eventId, 'evt')) fail('event_id must look like evt_<number>');
  if (!readEntries<ViewerEvent>(eventsFile, 'evt').some((e) => e.id === eventId)) fail(`${eventId} is not a known event`);
  const ack: Ack = { id: nextId(file, 'ack'), ts: stamp(now), event_id: eventId };
  appendLine(file, ack, maxBytes);
  return ack;
}

// Returns every valid ack, oldest first.
function readAcks(file: string): Ack[] {
  return readEntries<Ack>(file, 'ack');
}

export { appendEvent, readEventsAfter, appendReply, readThread, appendAck, readAcks };
export type { EventType, EventContext, ViewerEvent, SourceRef, Reply, Ack, ThreadEntry, WriteOptions };
