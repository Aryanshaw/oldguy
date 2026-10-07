// The commands Claude runs in a terminal to talk to the local server: reply, add-chapter, set-status; and `order`,
// which only writes a file. Each prints one line and exits 0 (done), 1 (no server or it refused) or 2 (bad usage).
import fs from 'node:fs';
import path from 'node:path';
import { parseFlags, guarded } from './args.mts';
import { askServer, pidAlive } from '../lib/ask-server.mts';
import { resolveSlugDir, readInfo } from './server.mts';
import { slugChapterId } from '../lib/chapter.mts';
import { STATUSES } from '../lib/manifest.mts';
import type { ChapterStatus } from '../lib/manifest.mts';
import type { ReplyBody } from '../server/api.mts';
import type { SourceRef } from '../lib/events.mts';

// What the server may send back to these commands. The shape is trusted only as far as the uses below go: each one is
// checked (strictMatch, positionOf) and a wrong shape throws, which serverCommand reports as an unexpected answer.
type Answer = { reply: { id: unknown }; manifest: { chapters: ({ id?: unknown } | null)[] } };
// What a command's argument check produces: the folder to talk to and the JSON to send.
type Request<B> = { slugDir: string; body: B };
// Options only tests use: a shorter time limit for the request.
type ClientOpts = { timeoutMs?: number };
// The body of an add-chapter request: the op, the id, and any text fields that were given.
type AddBody = { op: 'add'; id: string } & Record<string, string>;
// What moveOnPage did: no server, nothing to move, moved, or failed (after printing why).
type PageMove = 'none' | 'same' | 'moved' | 'failed';

const DEADLINE_MS = 5000;
const MAX_ANSWER_BYTES = 1024 * 1024;
const NO_SERVER = 'no server is running: start it with `yap serve --detach`';

const MAX_LINE = 300;
const UNEXPECTED = 'the server sent an unexpected answer';

// Makes any text safe to print as one line: every run of whitespace becomes one space, and a long text is cut with "…".
function oneLine(text: unknown): string {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LINE ? `${flat.slice(0, MAX_LINE - 1)}…` : flat;
}
// Writes one line to stdout.
const say = (line: string): boolean => process.stdout.write(`${oneLine(line)}\n`);
// Writes one line to stderr.
const complain = (line: string): boolean => process.stderr.write(`${oneLine(line)}\n`);

// Sends one JSON request to the running server for this folder. Resolves { json } on a 2xx answer, or { code: 1 }
// after printing why it failed (no server, no answer in time, or the server's own error text).
async function callServer(slugDir: string, apiPath: string, body: unknown, timeoutMs: number): Promise<{ json?: Answer; code?: number }> {
  const info = readInfo(slugDir);
  if (!info) { complain(NO_SERVER); return { code: 1 }; }
  const r = await askServer({ port: info.port, key: info.key, method: 'POST', path: apiPath, body, timeoutMs, maxBytes: MAX_ANSWER_BYTES });
  if (!r.ok && r.reason === 'refused') { complain(NO_SERVER); return { code: 1 }; }
  if (!r.ok && r.reason === 'timeout') { complain(pidAlive(info.pid) ? 'the server did not answer in time' : NO_SERVER); return { code: 1 }; }
  if (!r.ok) { complain('the server answered in a way yap could not read'); return { code: 1 }; }
  let json: (Answer & { error?: unknown }) | null = null;
  try { json = JSON.parse(r.body) as Answer & { error?: unknown }; } catch { /* not JSON */ }
  if (r.status < 200 || r.status > 299) {
    complain(json && typeof json.error === 'string' ? json.error : `the server answered with status ${r.status}`);
    return { code: 1 };
  }
  if (!json) { complain(UNEXPECTED); return { code: 1 }; }
  return { json };
}

// Shared shape of a server command: check the arguments (a usage error exits 2), send, then print the success line.
async function serverCommand<B>(
  name: string, parse: () => Request<B>, apiPath: string, done: (json: Answer, request: Request<B>) => string, opts: ClientOpts = {},
): Promise<number> {
  const request = guarded(name, parse);
  if (typeof request === 'number') return request;
  const { json, code } = await callServer(request.slugDir, apiPath, request.body, opts.timeoutMs ?? DEADLINE_MS);
  if (code) return code;
  // callServer gives a json whenever it gives no code
  try { say(done(json as Answer, request)); } catch { complain(UNEXPECTED); return 1; }
  return 0;
}

// Returns the value when it is text matching the pattern; otherwise throws (the caller reports an unexpected answer).
function strictMatch(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('unexpected');
  return value;
}

// The 1-based place of a chapter id in the manifest the server sent back; throws when it is not there.
function positionOf(json: Answer, id: string): number {
  const at = json.manifest.chapters.findIndex((c) => c && c.id === id);
  if (at < 0) throw new Error('unexpected');
  return at + 1;
}

// Refuses an id that is not already in its plain slug form (this is what the server's folders are named by).
function checkId(flag: string, id: string): string {
  let plain: string | null;
  try { plain = slugChapterId(id); } catch { plain = null; }
  if (plain !== id) throw new Error(`${flag} "${oneLine(id).slice(0, 60)}" is not a plain chapter id (lower-case letters, digits and hyphens, starting with a letter)`);
  return id;
}

// Takes every `--source <value>` pair out of the arguments (the flag may repeat); returns the values and the rest.
function takeSources(args: string[]): { sources: string[]; rest: string[] } {
  const sources: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--source') { rest.push(args[i]); continue; }
    if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error('--source needs a value');
    sources.push(args[++i]);
  }
  return { sources, rest };
}

// Turns "<file>:<line>" or "<file>:<a>-<b>" into {file, lines}, splitting at the last colon.
function parseSource(text: string): SourceRef {
  const cut = text.lastIndexOf(':');
  const file = cut < 0 ? '' : text.slice(0, cut);
  const lines = cut < 0 ? '' : text.slice(cut + 1);
  if (!file || !/^\d+(-\d+)?$/.test(lines)) throw new Error(`--source "${text}" must look like <file>:<line> or <file>:<a>-<b>`);
  return { file, lines };
}

// Picks the flags a command needs, refusing stray words and missing required flags.
function readFlags(args: string[], allowed: string[], required: string[]): Record<string, string> {
  const { positional, flags } = parseFlags(args, allowed);
  if (positional.length) throw new Error(`unexpected "${positional[0]}"`);
  for (const f of required) if (flags[f] === undefined) throw new Error(`${f} is required`);
  return flags;
}

// `yap reply --in-reply-to <evt_n> --text <text> [--source <file>:<a>-<b> ...] [--offer-video]`: posts Claude's answer
// to the viewer; --offer-video puts a "Make this a video" button under it.
function runReply(args: string[], opts?: ClientOpts): Promise<number> {
  return serverCommand('reply', (): Request<ReplyBody> => {
    const { sources, rest } = takeSources(args);
    // --offer-video takes no value, so it is taken out before the flags are parsed
    const offer = rest.includes('--offer-video');
    const flags = readFlags(rest.filter((a) => a !== '--offer-video'), ['--dir', '--in-reply-to', '--text'], ['--in-reply-to', '--text']);
    const body: ReplyBody = { in_reply_to: flags['--in-reply-to'], text: flags['--text'] };
    if (sources.length) body.sources = sources.map(parseSource);
    if (offer) body.offer_video = true;
    return { slugDir: resolveSlugDir(flags['--dir']), body };
  }, '/api/reply', (json) => `reply ${strictMatch(json.reply.id, /^rep_\d+$/)} sent`, opts);
}

// `yap add-chapter --id <id> [--after <id>] [--title <t>] [--parent <id>] [--reason <text>] [--question <text>]`: adds
// a chapter row; --question is the viewer's question it answers, shown under it while it is being made.
function runAddChapter(args: string[], opts?: ClientOpts): Promise<number> {
  return serverCommand('add-chapter', (): Request<AddBody> => {
    const flags = readFlags(args, ['--dir', '--id', '--after', '--title', '--parent', '--reason', '--question'], ['--id']);
    const body: AddBody = { op: 'add', id: checkId('--id', flags['--id']) };
    for (const [flag, key] of [['--after', 'after'], ['--title', 'title'], ['--parent', 'parent_id'], ['--reason', 'placement_reason'], ['--question', 'question']]) {
      if (flags[flag] === undefined) continue;
      body[key] = flag === '--after' || flag === '--parent' ? checkId(flag, flags[flag]) : flags[flag];
    }
    return { slugDir: resolveSlugDir(flags['--dir']), body };
  }, '/api/chapters', (json, { body }) => `chapter ${body.id} added at position ${positionOf(json, body.id)}`, opts);
}

// `yap ack <evt_n> [--dir <slugDir>]`: tells the server Claude has handled an event that gets no text reply.
function runAck(args: string[], opts?: ClientOpts): Promise<number> {
  return serverCommand('ack', (): Request<{ event_id: string }> => {
    const { positional, flags } = parseFlags(args, ['--dir']);
    if (positional.length !== 1) throw new Error('give exactly one event id, for example evt_12');
    if (!/^evt_\d+$/.test(positional[0])) throw new Error(`"${oneLine(positional[0]).slice(0, 60)}" is not an event id (evt_<number>)`);
    return { slugDir: resolveSlugDir(flags['--dir']), body: { event_id: positional[0] } };
  }, '/api/ack', (_json, { body }) => `event ${body.event_id} acked`, opts);
}

// `yap set-status --id <id> --status <pending|rendering|ready|failed|stale>`: changes one chapter's status.
function runSetStatus(args: string[], opts?: ClientOpts): Promise<number> {
  return serverCommand('set-status', () => {
    const flags = readFlags(args, ['--dir', '--id', '--status'], ['--id', '--status']);
    if (!(STATUSES as readonly string[]).includes(flags['--status'])) throw new Error(`--status must be one of ${STATUSES.join(', ')}`);
    return { slugDir: resolveSlugDir(flags['--dir']), body: { op: 'set', id: checkId('--id', flags['--id']), fields: { status: flags['--status'] as ChapterStatus } } };
  }, '/api/chapters', (json, { body }) => `chapter ${body.id} is ${body.fields.status}`, opts);
}

// Checks the comma-separated ids: each already in its plain slug form, none repeated, at least one.
function parseOrderIds(text: string): string[] {
  const ids = text === '' ? [] : text.split(',');
  if (!ids.length) throw new Error('give at least one chapter id');
  for (const id of ids) checkId('id', id);
  if (new Set(ids).size !== ids.length) throw new Error('a chapter id is listed twice');
  return ids;
}

// Writes the file in a temp file beside it, then renames it over the old one, so a reader never sees half a file.
function writeAtomically(file: string, text: string): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing more to clean */ }
    throw err;
  }
}

// The order the page should show: the listed chapters it already has, in the new order; a chapter the list does not
// name stays right after the chapter it follows now.
function pageOrder(current: string[], wanted: string[]): string[] {
  const result = wanted.filter((id) => current.includes(id));
  current.forEach((id, i) => {
    if (wanted.includes(id)) return;
    result.splice(i === 0 ? 0 : result.indexOf(current[i - 1]) + 1, 0, id);
  });
  return result;
}

// Moves the chapters on a running server's page into the new order. Resolves 'none' when no server is running,
// 'same' when nothing had to move, 'moved', or 'failed' after printing why.
async function moveOnPage(slugDir: string, ids: string[], timeoutMs: number): Promise<PageMove> {
  const info = readInfo(slugDir);
  if (!info) return 'none';
  const r = await askServer({ port: info.port, key: info.key, path: '/api/state', timeoutMs, maxBytes: MAX_ANSWER_BYTES });
  // a server.json left behind by a server that is gone
  if (!r.ok && r.reason === 'refused') return 'none';
  let current: string[] | null = null;
  // a failed request has no body; the empty text makes JSON.parse throw, which leaves `current` null
  try { current = (JSON.parse(r.ok ? r.body : '') as { manifest: { chapters: { id: string }[] } }).manifest.chapters.map((c) => c.id); } catch { /* reported just below */ }
  if (!r.ok || r.status !== 200 || !current) {
    complain('yap order: the running server did not give its chapter list; the page keeps its old order');
    return 'failed';
  }
  const next = pageOrder(current, ids);
  if (next.join() === current.join()) return 'same';
  const { code } = await callServer(slugDir, '/api/chapters', { op: 'reorder', ids: next }, timeoutMs);
  if (code) complain('yap order: the page keeps its old order');
  return code ? 'failed' : 'moved';
}

// `yap order <id,id,...>`: writes the story order to <slugDir>/order.json and, when a server is running for the
// folder, moves the chapters already on its page into that order. Needs no server.
async function runOrder(args: string[], opts: ClientOpts = {}): Promise<number> {
  const plan = guarded('order', () => {
    const { positional, flags } = parseFlags(args, ['--dir']);
    if (positional.length !== 1) throw new Error('usage: yap order <id,id,...> [--dir <slugDir>]');
    return { ids: parseOrderIds(positional[0]), slugDir: resolveSlugDir(flags['--dir']) };
  });
  if (typeof plan === 'number') return plan;
  try {
    writeAtomically(path.join(plan.slugDir, 'order.json'), `${JSON.stringify({ chapters: plan.ids })}\n`);
  } catch (err) {
    // a failed write throws a system error with a code
    complain(`yap order: could not write order.json (${(err as NodeJS.ErrnoException).code || 'error'})`);
    return 1;
  }
  const moved = await moveOnPage(plan.slugDir, plan.ids, opts.timeoutMs ?? DEADLINE_MS);
  say(`order written: ${plan.ids.length} chapters${moved === 'moved' ? '; the page now shows the new order' : ''}`);
  return moved === 'failed' ? 1 : 0;
}

export { runReply, runAddChapter, runSetStatus, runOrder, runAck };
