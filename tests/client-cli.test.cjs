'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { startServer } = require('../server/server.cjs');
const { loadManifest } = require('../lib/manifest.cjs');
const { readOrder } = require('../lib/chapter-scan.cjs');
const { readEventsAfter, readThread } = require('../lib/events.cjs');
const { askServer } = require('../lib/ask-server.cjs');
const { runReply, runAddChapter, runSetStatus, runOrder } = require('../lib/client-cli.cjs');

const NO_SERVER = 'no server is running: start it with `yap serve --detach`\n';

// Runs a command function with its output captured; resolves { code, out, err }. Binary chunks belong to the test runner.
async function run(fn, args, opts) {
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  let out = '';
  let err = '';
  process.stdout.write = (s, ...rest) => (typeof s === 'string' ? (out += s, true) : realOut.call(process.stdout, s, ...rest));
  process.stderr.write = (s, ...rest) => (typeof s === 'string' ? (err += s, true) : realErr.call(process.stderr, s, ...rest));
  try { return { code: await fn(args, opts), out, err }; } finally { process.stdout.write = realOut; process.stderr.write = realErr; }
}
// Makes a temp slug folder (with chapters/) and removes it afterwards.
function slugFolder(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-client-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  return slugDir;
}
// A real server on port 0 over a fresh folder that already has chapter folders for the given ids (no ffmpeg runs).
async function withServer(t, ids = []) {
  const slugDir = slugFolder(t);
  for (const id of ids) fs.mkdirSync(path.join(slugDir, 'chapters', id));
  const srv = await startServer({ slugDir, deps: { logError: () => {}, exec: async () => { throw new Error('no ffmpeg in tests'); } } });
  t.after(() => srv.close());
  return { slugDir, srv, manifest: () => loadManifest(path.join(slugDir, 'manifest.json')) };
}
// Posts a viewer message through the API; returns its event id.
async function viewerMessage(srv) {
  const r = await askServer({ port: srv.port, key: srv.key, method: 'POST', path: '/api/message', body: { type: 'message', text: 'hello' }, timeoutMs: 3000, maxBytes: 100000 });
  return JSON.parse(r.body).event.id;
}
// Writes a server.json naming the given fields.
function writeInfo(slugDir, fields) {
  fs.mkdirSync(path.join(slugDir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'state', 'server.json'), typeof fields === 'string' ? fields : JSON.stringify(fields));
}
// A port nothing listens on.
const deadPort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

test('reply: sends the text with every --source, prints "reply rep_<n> sent", and the thread holds it', async (t) => {
  const { slugDir, srv } = await withServer(t);
  const evt = await viewerMessage(srv);
  const r = await run(runReply, ['--dir', slugDir, '--in-reply-to', evt, '--text', 'It is in the loop.', '--source', 'src/a.js:3-9', '--source', 'src/b.js:12']);
  assert.deepEqual([r.code, r.out, r.err], [0, 'reply rep_1 sent\n', '']);
  const [reply] = readThread(path.join(slugDir, 'state', 'thread.jsonl'));
  assert.equal(reply.in_reply_to, evt);
  assert.equal(reply.text, 'It is in the loop.');
  assert.deepEqual(reply.sources, [{ file: 'src/a.js', lines: '3-9' }, { file: 'src/b.js', lines: '12' }]);
  assert.equal(readEventsAfter(path.join(slugDir, 'state', 'events.jsonl'), null).length, 1);
});

test('reply: a source splits at the LAST colon, so a file name may hold a colon', async (t) => {
  const { slugDir, srv } = await withServer(t);
  const evt = await viewerMessage(srv);
  const r = await run(runReply, ['--dir', slugDir, '--in-reply-to', evt, '--text', 'x', '--source', 'a:b.js:4']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readThread(path.join(slugDir, 'state', 'thread.jsonl'))[0].sources, [{ file: 'a:b.js', lines: '4' }]);
});

test('reply: usage errors exit 2 with one stderr line and send nothing', async (t) => {
  const { slugDir, srv } = await withServer(t);
  const evt = await viewerMessage(srv);
  const base = ['--dir', slugDir, '--in-reply-to', evt, '--text', 'hi'];
  const bad = {
    'unknown flag': [...base, '--loud', 'yes'],
    'missing text': ['--dir', slugDir, '--in-reply-to', evt],
    'missing in-reply-to': ['--dir', slugDir, '--text', 'hi'],
    'text starting with --': ['--dir', slugDir, '--in-reply-to', evt, '--text', '--hi'],
    'source without colon': [...base, '--source', 'a.js'],
    'source without lines': [...base, '--source', 'a.js:'],
    'source without file': [...base, '--source', ':3'],
    'source with bad lines': [...base, '--source', 'a.js:x-y'],
    'source needs a value': [...base, '--source'],
    'stray word': [...base, 'extra'],
  };
  for (const [name, args] of Object.entries(bad)) {
    const r = await run(runReply, args);
    assert.equal(r.code, 2, name);
    assert.equal(r.out, '', name);
    assert.match(r.err, /^yap reply: [^\n]+\n$/, name);
  }
  assert.deepEqual(readThread(path.join(slugDir, 'state', 'thread.jsonl')), []);
});

test('reply: a refusal from the server prints its error text and exits 1', async (t) => {
  const { slugDir } = await withServer(t);
  const r = await run(runReply, ['--dir', slugDir, '--in-reply-to', 'evt_99', '--text', 'hi']);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /^[^\n]*evt_99[^\n]*\n$/);
});

test('add-chapter: adds after another chapter and prints the 1-based position', async (t) => {
  const { slugDir, manifest } = await withServer(t, ['intro', 'outro']);
  const r = await run(runAddChapter, ['--dir', slugDir, '--id', 'middle', '--after', 'intro', '--title', 'The middle', '--reason', 'it bridges', '--parent', 'intro']);
  assert.deepEqual([r.code, r.out, r.err], [0, 'chapter middle added at position 2\n', '']);
  const row = manifest().chapters.find((c) => c.id === 'middle');
  assert.equal(row.title, 'The middle');
  assert.equal(row.placement_reason, 'it bridges');
  assert.equal(row.parent_id, 'intro');
  assert.deepEqual(manifest().chapters.map((c) => c.id), ['intro', 'middle', 'outro']);
});

test('add-chapter: only --id is needed; a repeat id shows the server error; a missing --id or a flag typo exits 2', async (t) => {
  const { slugDir, manifest } = await withServer(t, ['intro']);
  const ok = await run(runAddChapter, ['--dir', slugDir, '--id', 'later']);
  assert.deepEqual([ok.code, ok.out], [0, 'chapter later added at position 2\n']);
  assert.equal(manifest().chapters[1].id, 'later');
  const dup = await run(runAddChapter, ['--dir', slugDir, '--id', 'later']);
  assert.equal(dup.code, 1);
  assert.match(dup.err, /^[^\n]*already exists\n$/);
  for (const args of [['--dir', slugDir], ['--dir', slugDir, '--id', 'x', '--titel', 'oops']]) {
    const r = await run(runAddChapter, args);
    assert.equal(r.code, 2);
    assert.match(r.err, /^yap add-chapter: [^\n]+\n$/);
  }
});

test('set-status: changes the chapter and prints "chapter <id> is <status>"', async (t) => {
  const { slugDir, manifest } = await withServer(t, ['intro']);
  const r = await run(runSetStatus, ['--dir', slugDir, '--id', 'intro', '--status', 'failed']);
  assert.deepEqual([r.code, r.out, r.err], [0, 'chapter intro is failed\n', '']);
  assert.equal(manifest().chapters[0].status, 'failed');
});

test('set-status: an unknown status exits 2 before any request (no server needed); the server refusals exit 1', async (t) => {
  const bare = slugFolder(t);
  for (const args of [['--dir', bare, '--id', 'a', '--status', 'done'], ['--dir', bare, '--id', 'a'], ['--dir', bare, '--status', 'ready']]) {
    const r = await run(runSetStatus, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, /^yap set-status: [^\n]+\n$/);
  }
  const { slugDir } = await withServer(t, ['intro']);
  const unknownChapter = await run(runSetStatus, ['--dir', slugDir, '--id', 'ghost', '--status', 'failed']);
  assert.equal(unknownChapter.code, 1);
  assert.match(unknownChapter.err, /ghost/);
  const notReady = await run(runSetStatus, ['--dir', slugDir, '--id', 'intro', '--status', 'ready']);
  assert.equal(notReady.code, 1);
  assert.match(notReady.err, /^[^\n]*ready[^\n]*\n$/);
});

test('every server command says "no server is running" (exit 1) when server.json is missing, unreadable, malformed or stale', async (t) => {
  const port = await deadPort();
  const key = 'b'.repeat(32);
  const commands = [
    [runReply, ['--in-reply-to', 'evt_1', '--text', 'x']],
    [runAddChapter, ['--id', 'a']],
    [runSetStatus, ['--id', 'a', '--status', 'failed']],
  ];
  const states = {
    missing: null,
    'not json': '{nope',
    'wrong shape': { pid: 'x', port: 'y' },
    'dead pid and closed port': { pid: 2 ** 22 + 12345, port, key },
    'live pid, closed port': { pid: process.pid, port, key },
    unreadable: 'DIR',
  };
  for (const [name, fields] of Object.entries(states)) {
    for (const [fn, args] of commands) {
      const slugDir = slugFolder(t);
      if (fields === 'DIR') fs.mkdirSync(path.join(slugDir, 'state', 'server.json'), { recursive: true });
      else if (fields !== null) writeInfo(slugDir, fields);
      const before = fields !== null && fields !== 'DIR' ? fs.readFileSync(path.join(slugDir, 'state', 'server.json'), 'utf8') : null;
      const r = await run(fn, ['--dir', slugDir, ...args]);
      assert.deepEqual([r.code, r.out, r.err], [1, '', NO_SERVER], name);
      if (before !== null) assert.equal(fs.readFileSync(path.join(slugDir, 'state', 'server.json'), 'utf8'), before, `${name}: server.json untouched`);
    }
  }
});

test('a server that does not answer within the deadline: "did not answer in time", exit 1, server.json kept', async (t) => {
  const sockets = new Set();
  const silent = net.createServer((s) => { sockets.add(s); s.on('error', () => {}); });
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { for (const s of sockets) s.destroy(); silent.close(resolve); }));
  const slugDir = slugFolder(t);
  writeInfo(slugDir, { pid: process.pid, port: silent.address().port, key: 'c'.repeat(32) });
  const before = fs.readFileSync(path.join(slugDir, 'state', 'server.json'), 'utf8');
  const r = await run(runSetStatus, ['--dir', slugDir, '--id', 'a', '--status', 'failed'], { timeoutMs: 300 });
  assert.deepEqual([r.code, r.out, r.err], [1, '', 'the server did not answer in time\n']);
  assert.equal(fs.readFileSync(path.join(slugDir, 'state', 'server.json'), 'utf8'), before);
});

test('a server that trickles its answer is cut off by the one overall deadline, and an endless answer is cut off at 1 MB', async (t) => {
  const sockets = new Set();
  const HEAD = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 999999999\r\n\r\n';
  let mode = 'drip';
  const bad = net.createServer((s) => {
    sockets.add(s); s.on('error', () => {});
    s.write(HEAD);
    const chunk = mode === 'drip' ? 'x' : 'a'.repeat(65536);
    const i = setInterval(() => s.write(chunk), mode === 'drip' ? 30 : 2);
    s.on('close', () => clearInterval(i));
  });
  await new Promise((resolve) => bad.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { for (const s of sockets) s.destroy(); bad.close(resolve); }));
  const slugDir = slugFolder(t);
  writeInfo(slugDir, { pid: process.pid, port: bad.address().port, key: 'c'.repeat(32) });
  const started = Date.now();
  const slow = await run(runAddChapter, ['--dir', slugDir, '--id', 'a'], { timeoutMs: 400 });
  assert.equal(slow.code, 1);
  assert.equal(slow.err, 'the server did not answer in time\n');
  assert.ok(Date.now() - started < 3000);
  mode = 'flood';
  const flood = await run(runAddChapter, ['--dir', slugDir, '--id', 'a'], { timeoutMs: 3000 });
  assert.equal(flood.code, 1);
  assert.match(flood.err, /^[^\n]+\n$/);
});

test('order: writes {"chapters":[...]} with a trailing newline, needs no server, leaves no temp file, and readOrder reads it', async (t) => {
  const slugDir = slugFolder(t);
  const r = await run(runOrder, ['--dir', slugDir, 'intro,middle,outro']);
  assert.deepEqual([r.code, r.out, r.err], [0, 'order written: 3 chapters\n', '']);
  assert.equal(fs.readFileSync(path.join(slugDir, 'order.json'), 'utf8'), '{"chapters":["intro","middle","outro"]}\n');
  assert.deepEqual(readOrder(slugDir), { ids: ['intro', 'middle', 'outro'], issues: [] });
  assert.deepEqual(fs.readdirSync(slugDir).sort(), ['chapters', 'order.json']);
  const again = await run(runOrder, ['--dir', slugDir, 'solo']);
  assert.equal(again.out, 'order written: 1 chapters\n');
  assert.deepEqual(readOrder(slugDir).ids, ['solo']);
});

test('order: bad ids, duplicates, an empty list, extra words and flags exit 2 and leave the old file alone', async (t) => {
  const slugDir = slugFolder(t);
  await run(runOrder, ['--dir', slugDir, 'keep,me']);
  const bad = {
    'upper case': ['Intro,outro'],
    'not a slug': ['a_b'],
    'path': ['a/b'],
    'starts with a digit': ['1a'],
    duplicates: ['a,b,a'],
    empty: [''],
    'empty item': ['a,,b'],
    'trailing comma': ['a,b,'],
    'no list': [],
    'two lists': ['a', 'b'],
    'unknown flag': ['--sort', 'a'],
  };
  for (const [name, args] of Object.entries(bad)) {
    const r = await run(runOrder, ['--dir', slugDir, ...args]);
    assert.equal(r.code, 2, name);
    assert.equal(r.out, '', name);
    assert.match(r.err, /^yap order: [^\n]+\n$/, name);
  }
  assert.equal(fs.readFileSync(path.join(slugDir, 'order.json'), 'utf8'), '{"chapters":["keep","me"]}\n');
  assert.deepEqual(fs.readdirSync(slugDir).sort(), ['chapters', 'order.json']);
});

test('the commands are wired into bin/yap.cjs: --dir is optional (the only folder under .yap/ is used)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-client-bin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.yap', 'only', 'chapters'), { recursive: true });
  const yap = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'yap.cjs'), ...args], { cwd: root, encoding: 'utf8' });
  const ok = yap('order', 'a,b');
  assert.deepEqual([ok.status, ok.stdout], [0, 'order written: 2 chapters\n']);
  assert.equal(fs.readFileSync(path.join(root, '.yap', 'only', 'order.json'), 'utf8'), '{"chapters":["a","b"]}\n');
  const noServer = yap('set-status', '--id', 'a', '--status', 'failed');
  assert.deepEqual([noServer.status, noServer.stderr], [1, NO_SERVER]);
  fs.mkdirSync(path.join(root, '.yap', 'second', 'chapters'), { recursive: true });
  const two = yap('reply', '--in-reply-to', 'evt_1', '--text', 'x');
  assert.equal(two.status, 2);
  assert.match(two.stderr, /^yap reply: .*--dir.*\n$/);
  assert.match(yap('--help').stdout, /^\s*reply\s.*\n[\s\S]*add-chapter[\s\S]*set-status[\s\S]*order/m);
});
