'use strict';
// The commands Claude runs in a terminal to talk to the local server: reply, add-chapter, set-status; and `order`,
// which only writes a file. Each prints one line and exits 0 (done), 1 (no server or it refused) or 2 (bad usage).
const fs = require('node:fs');
const path = require('node:path');
const { parseFlags, guarded } = require('./cli-args.cjs');
const { askServer, pidAlive } = require('./ask-server.cjs');
const { resolveSlugDir, readInfo } = require('./server-cli.cjs');
const { slugChapterId } = require('./chapter.cjs');
const { STATUSES } = require('./manifest.cjs');

const DEADLINE_MS = 5000;
const MAX_ANSWER_BYTES = 1024 * 1024;
const NO_SERVER = 'no server is running: start it with `yap serve --detach`';

// Writes one line to stdout.
const say = (line) => process.stdout.write(`${line}\n`);
// Writes one line to stderr.
const complain = (line) => process.stderr.write(`${String(line).replace(/\s*\n\s*/g, ' ')}\n`);

// Sends one JSON request to the running server for this folder. Resolves { json } on a 2xx answer, or { code: 1 }
// after printing why it failed (no server, no answer in time, or the server's own error text).
async function callServer(slugDir, apiPath, body, timeoutMs) {
  const info = readInfo(slugDir);
  if (!info) { complain(NO_SERVER); return { code: 1 }; }
  const r = await askServer({ port: info.port, key: info.key, method: 'POST', path: apiPath, body, timeoutMs, maxBytes: MAX_ANSWER_BYTES });
  if (!r.ok && r.reason === 'refused') { complain(NO_SERVER); return { code: 1 }; }
  if (!r.ok && r.reason === 'timeout') { complain(pidAlive(info.pid) ? 'the server did not answer in time' : NO_SERVER); return { code: 1 }; }
  if (!r.ok) { complain('the server answered in a way yap could not read'); return { code: 1 }; }
  let json = null;
  try { json = JSON.parse(r.body); } catch { /* not JSON */ }
  if (r.status < 200 || r.status > 299) {
    complain(json && typeof json.error === 'string' ? json.error : `the server answered with status ${r.status}`);
    return { code: 1 };
  }
  if (!json) { complain('the server answered in a way yap could not read'); return { code: 1 }; }
  return { json };
}

// Shared shape of a server command: check the arguments (a usage error exits 2), send, then print the success line.
async function serverCommand(name, parse, apiPath, done, opts = {}) {
  const request = guarded(name, parse);
  if (typeof request === 'number') return request;
  const { json, code } = await callServer(request.slugDir, apiPath, request.body, opts.timeoutMs ?? DEADLINE_MS);
  if (code) return code;
  try { say(done(json, request)); } catch { complain('the server answered in a way yap could not read'); return 1; }
  return 0;
}

// Takes every `--source <value>` pair out of the arguments (the flag may repeat); returns the values and the rest.
function takeSources(args) {
  const sources = [];
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--source') { rest.push(args[i]); continue; }
    if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error('--source needs a value');
    sources.push(args[++i]);
  }
  return { sources, rest };
}

// Turns "<file>:<line>" or "<file>:<a>-<b>" into {file, lines}, splitting at the last colon.
function parseSource(text) {
  const cut = text.lastIndexOf(':');
  const file = cut < 0 ? '' : text.slice(0, cut);
  const lines = cut < 0 ? '' : text.slice(cut + 1);
  if (!file || !/^\d+(-\d+)?$/.test(lines)) throw new Error(`--source "${text}" must look like <file>:<line> or <file>:<a>-<b>`);
  return { file, lines };
}

// Picks the flags a command needs, refusing stray words and missing required flags.
function readFlags(args, allowed, required) {
  const { positional, flags } = parseFlags(args, allowed);
  if (positional.length) throw new Error(`unexpected "${positional[0]}"`);
  for (const f of required) if (flags[f] === undefined) throw new Error(`${f} is required`);
  return flags;
}

// `yap reply --in-reply-to <evt_n> --text <text> [--source <file>:<a>-<b> ...]`: posts Claude's answer to the viewer.
function runReply(args, opts) {
  return serverCommand('reply', () => {
    const { sources, rest } = takeSources(args);
    const flags = readFlags(rest, ['--dir', '--in-reply-to', '--text'], ['--in-reply-to', '--text']);
    const body = { in_reply_to: flags['--in-reply-to'], text: flags['--text'] };
    if (sources.length) body.sources = sources.map(parseSource);
    return { slugDir: resolveSlugDir(flags['--dir']), body };
  }, '/api/reply', (json) => `reply ${json.reply.id} sent`, opts);
}

// `yap add-chapter --id <id> [--after <id>] [--title <t>] [--parent <id>] [--reason <text>]`: adds a chapter row.
function runAddChapter(args, opts) {
  return serverCommand('add-chapter', () => {
    const flags = readFlags(args, ['--dir', '--id', '--after', '--title', '--parent', '--reason'], ['--id']);
    const body = { op: 'add', id: flags['--id'] };
    for (const [flag, key] of [['--after', 'after'], ['--title', 'title'], ['--parent', 'parent_id'], ['--reason', 'placement_reason']]) {
      if (flags[flag] !== undefined) body[key] = flags[flag];
    }
    return { slugDir: resolveSlugDir(flags['--dir']), body };
  }, '/api/chapters', (json, { body }) => `chapter ${body.id} added at position ${json.manifest.chapters.findIndex((c) => c.id === body.id) + 1}`, opts);
}

// `yap set-status --id <id> --status <pending|rendering|ready|failed|stale>`: changes one chapter's status.
function runSetStatus(args, opts) {
  return serverCommand('set-status', () => {
    const flags = readFlags(args, ['--dir', '--id', '--status'], ['--id', '--status']);
    if (!STATUSES.includes(flags['--status'])) throw new Error(`--status must be one of ${STATUSES.join(', ')}`);
    return { slugDir: resolveSlugDir(flags['--dir']), body: { op: 'set', id: flags['--id'], fields: { status: flags['--status'] } } };
  }, '/api/chapters', (json, { body }) => `chapter ${body.id} is ${body.fields.status}`, opts);
}

// Checks the comma-separated ids: each already in its plain slug form, none repeated, at least one.
function parseOrderIds(text) {
  const ids = text === '' ? [] : text.split(',');
  if (!ids.length) throw new Error('give at least one chapter id');
  for (const id of ids) {
    let plain;
    try { plain = slugChapterId(id); } catch { plain = null; }
    if (plain !== id) throw new Error(`"${id}" is not a plain chapter id (lower-case letters, digits and hyphens, starting with a letter)`);
  }
  if (new Set(ids).size !== ids.length) throw new Error('a chapter id is listed twice');
  return ids;
}

// Writes the file in a temp file beside it, then renames it over the old one, so a reader never sees half a file.
function writeAtomically(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing more to clean */ }
    throw err;
  }
}

// `yap order <id,id,...>`: writes the story order to <slugDir>/order.json. Needs no server.
function runOrder(args) {
  const plan = guarded('order', () => {
    const { positional, flags } = parseFlags(args, ['--dir']);
    if (positional.length !== 1) throw new Error('usage: yap order <id,id,...> [--dir <slugDir>]');
    return { ids: parseOrderIds(positional[0]), slugDir: resolveSlugDir(flags['--dir']) };
  });
  if (typeof plan === 'number') return plan;
  try {
    writeAtomically(path.join(plan.slugDir, 'order.json'), `${JSON.stringify({ chapters: plan.ids })}\n`);
  } catch (err) {
    complain(`yap order: could not write order.json (${err.code || 'error'})`);
    return 1;
  }
  say(`order written: ${plan.ids.length} chapters`);
  return 0;
}

module.exports = { runReply, runAddChapter, runSetStatus, runOrder };
