'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('../server/server.mts');
const { askServer } = require('../lib/ask-server.mts');
const { runListen } = require('../cli/listen.mts');

// A real server over a fresh video folder; returns it with a helper that posts to its API.
async function withServer(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-listen-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  const srv = await startServer({ slugDir, deps: { logError: () => {}, exec: async () => { throw new Error('no ffmpeg in tests'); } } });
  t.after(() => srv.close());
  const post = async (p, body) => JSON.parse((await askServer({ port: srv.port, key: srv.key, method: 'POST', path: p, body, timeoutMs: 3000, maxBytes: 100000 })).body);
  const get = async (p) => JSON.parse((await askServer({ port: srv.port, key: srv.key, path: p, timeoutMs: 3000, maxBytes: 1000000 })).body);
  return { slugDir, srv, post, get };
}
const until = async (cond, ms = 3000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };

test('listen prints the open events first, then each new one once, heartbeats, and stops with server_stopped', async (t) => {
  const { slugDir, srv, post, get } = await withServer(t);
  await post('/api/message', { type: 'message', text: 'answered already' });
  await post('/api/reply', { in_reply_to: 'evt_1', text: 'yes' });
  await post('/api/message', { type: 'message', text: 'still open', context: { chapter_id: 'intro', t: 3.5 } });
  await post('/api/message', { type: 'just_text' });
  await post('/api/ack', { event_id: 'evt_3' });
  const lines = [];
  const done = runListen(['--dir', slugDir], { pollMs: 30, heartbeatMs: 60, write: (l) => lines.push(l) });
  await until(() => lines.length >= 1);
  assert.deepEqual(JSON.parse(lines[0]), { id: 'evt_2', ts: JSON.parse(lines[0]).ts, type: 'message', text: 'still open', context: { chapter_id: 'intro', t: 3.5 } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(lines.length, 1, 'nothing printed twice');
  assert.equal((await get('/api/state')).claude_connected, true);
  await post('/api/message', { type: 'message', text: 'a new one' });
  await until(() => lines.length >= 2);
  assert.equal(JSON.parse(lines[1]).text, 'a new one');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(lines.length, 2);
  await srv.close();
  assert.equal(await done, 0);
  assert.deepEqual(JSON.parse(lines[lines.length - 1]), { type: 'server_stopped' });
  assert.ok(lines.every((l) => !l.includes('\n')), 'one line per event');
});

test('listen with no server exits 1 with one line on stderr and prints nothing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-listen-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(slugDir);
  const lines = [];
  const errs = [];
  assert.equal(await runListen(['--dir', slugDir], { write: (l) => lines.push(l), complain: (l) => errs.push(l) }), 1);
  assert.deepEqual(lines, []);
  assert.match(errs.join(''), /no server is running/);
});

test('listen stops with server_stopped when heartbeats are refused twice in a row', async (t) => {
  const { slugDir, srv } = await withServer(t);
  const info = JSON.parse(fs.readFileSync(path.join(slugDir, 'state', 'server.json'), 'utf8'));
  const lines = [];
  // a fake server.json that still names a port, but the key is wrong, so every heartbeat is refused with a 403
  const done = runListen(['--dir', slugDir], { pollMs: 1000, heartbeatMs: 30, write: (l) => lines.push(l), readInfo: () => ({ ...info, key: 'f'.repeat(32) }) });
  assert.equal(await done, 0);
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [{ type: 'server_stopped' }]);
  void srv;
});
