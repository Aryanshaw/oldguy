'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { createHub } = require('../lib/sse.cjs');
const { startServer } = require('../server/server.cjs');

// A stand-in for an HTTP response: records the head and every write; `broken` makes write throw.
function fakeRes({ broken = false } = {}) {
  const res = new EventEmitter();
  res.chunks = [];
  res.ended = false;
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.write = (c) => { if (broken) throw new Error('socket gone'); res.chunks.push(c); return true; };
  res.end = () => { res.ended = true; };
  return res;
}

test('add writes the stream headers; broadcast uses the exact wire format', (t) => {
  const hub = createHub({ pingMs: 100000 });
  t.after(() => hub.close());
  const res = fakeRes();
  hub.add(res);
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers.Connection, 'keep-alive');
  assert.equal(res.headers['X-Accel-Buffering'], 'no');
  hub.broadcast('reply', { id: 'rep_1', text: 'hi' });
  assert.deepEqual(res.chunks, ['event: reply\ndata: {"id":"rep_1","text":"hi"}\n\n']);
});

test('data stays on one line even when the text holds a newline or U+2028', (t) => {
  const hub = createHub({ pingMs: 100000 });
  t.after(() => hub.close());
  const res = fakeRes();
  hub.add(res);
  const text = 'a\nb c\r\nd';
  hub.broadcast('state', { text });
  const frame = res.chunks[0];
  assert.match(frame, /^event: state\ndata: [^\n]*\n\n$/);
  assert.deepEqual(JSON.parse(frame.split('\n')[1].slice('data: '.length)), { text });
});

test('add returns a sender for that one client only', (t) => {
  const hub = createHub({ pingMs: 100000 });
  t.after(() => hub.close());
  const a = fakeRes();
  const b = fakeRes();
  const sendA = hub.add(a);
  hub.add(b);
  sendA('state', { n: 1 });
  assert.equal(a.chunks.length, 1);
  assert.equal(b.chunks.length, 0);
});

test('a client that closes or errors is removed; a failing write drops it and never throws', (t) => {
  const hub = createHub({ pingMs: 100000 });
  t.after(() => hub.close());
  const a = fakeRes();
  const b = fakeRes();
  const bad = fakeRes({ broken: true });
  hub.add(a);
  hub.add(b);
  hub.add(bad);
  assert.equal(hub.size(), 3);
  hub.broadcast('state', {});
  assert.equal(hub.size(), 2, 'broken socket dropped');
  a.emit('close');
  assert.equal(hub.size(), 1);
  b.emit('error', new Error('boom'));
  assert.equal(hub.size(), 0);
});

test('ping goes out every pingMs with {now}; close() stops the timer and ends every client', async (t) => {
  const hub = createHub({ pingMs: 20 });
  const res = fakeRes();
  hub.add(res);
  await new Promise((r) => setTimeout(r, 90));
  const pings = res.chunks.filter((c) => c.startsWith('event: ping\n'));
  assert.ok(pings.length >= 2, `got ${pings.length} pings`);
  assert.equal(typeof JSON.parse(pings[0].split('\n')[1].slice(6)).now, 'number');
  hub.close();
  assert.equal(res.ended, true);
  assert.equal(hub.size(), 0);
  const before = res.chunks.length;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(res.chunks.length, before, 'no ping after close');
});

test('the ping timer is unref()ed so it cannot keep the process alive', () => {
  const real = global.setInterval;
  let handle;
  global.setInterval = (...a) => { handle = real(...a); return handle; };
  let hub;
  try { hub = createHub({ pingMs: 100000 }); } finally { global.setInterval = real; }
  try { assert.equal(handle.hasRef(), false); } finally { hub.close(); }
});

// ---- with a real server ----

// Makes a temp slug folder and starts a server on it.
async function start(t, deps = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-sse-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(slugDir, { recursive: true });
  const srv = await startServer({ slugDir, deps: { pingMs: 40, ...deps } });
  t.after(() => srv.close());
  return { srv, slugDir };
}
// Opens the stream and collects parsed events; wait(n) resolves once n events have arrived.
function openStream(srv, headers = { 'x-yap-key': srv.key }) {
  return new Promise((resolve, reject) => {
    const events = [];
    const waiters = [];
    let buf = '';
    const r = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/stream', agent: false, headers: { host: `127.0.0.1:${srv.port}`, ...headers } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const [e, d] = buf.slice(0, i).split('\n');
          buf = buf.slice(i + 2);
          events.push({ event: e.slice(7), data: JSON.parse(d.slice(6)) });
        }
        for (const w of waiters.splice(0)) w();
      });
      res.on('error', () => {});
      const wait = async (pred, ms = 3000) => {
        const end = Date.now() + ms;
        while (!pred(events)) {
          if (Date.now() > end) throw new Error(`timeout; saw ${JSON.stringify(events.map((e) => e.event))}`);
          await new Promise((ok) => { waiters.push(ok); setTimeout(ok, 50); });
        }
      };
      resolve({ res, req: r, events, wait });
    });
    r.on('error', reject);
    r.end();
  });
}
// POSTs JSON with the key.
function post(srv, url, obj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(obj);
    const r = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: url, agent: false, headers: { host: `127.0.0.1:${srv.port}`, 'x-yap-key': srv.key, 'content-type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

test('stream needs the key (403 without it)', async (t) => {
  const { srv } = await start(t);
  const s = await openStream(srv, {});
  assert.equal(s.res.statusCode, 403);
  s.req.destroy();
});

test('stream: first a state event, then a reply event when Claude replies, then pings', async (t) => {
  const { srv } = await start(t);
  const s = await openStream(srv);
  assert.equal(s.res.headers['content-type'], 'text/event-stream');
  await s.wait((e) => e.length >= 1);
  assert.equal(s.events[0].event, 'state');
  assert.deepEqual(Object.keys(s.events[0].data).sort(), ['claude_connected', 'manifest', 'now', 'thread']);
  const m = await post(srv, '/api/message', { type: 'message', text: 'why?' });
  await s.wait((e) => e.some((x) => x.event === 'state' && x.data.thread.length === 1));
  const r = await post(srv, '/api/reply', { in_reply_to: m.body.event.id, text: 'because' });
  assert.equal(r.status, 200);
  await s.wait((e) => e.some((x) => x.event === 'reply'));
  assert.equal(s.events.find((x) => x.event === 'reply').data.text, 'because');
  await s.wait((e) => e.some((x) => x.event === 'ping'));
  s.req.destroy();
});

test('a chapter change is broadcast as a chapter event with the manifest', async (t) => {
  const { srv } = await start(t);
  const s = await openStream(srv);
  await s.wait((e) => e.length >= 1);
  await post(srv, '/api/chapters', { op: 'add', id: 'intro', title: 'Intro' });
  await s.wait((e) => e.some((x) => x.event === 'chapter'));
  const ev = s.events.find((x) => x.event === 'chapter').data;
  assert.equal(ev.op, 'add');
  assert.equal(ev.id, 'intro');
  assert.deepEqual(ev.manifest.chapters.map((c) => c.id), ['intro']);
  s.req.destroy();
});

test('a heartbeat that flips claude_connected sends a state event', async (t) => {
  let clock = 1000;
  const { srv } = await start(t, { now: () => clock });
  const s = await openStream(srv);
  await s.wait((e) => e.length >= 1);
  assert.equal(s.events[0].data.claude_connected, false);
  await post(srv, '/api/heartbeat', {});
  await s.wait((e) => e.some((x) => x.event === 'state' && x.data.claude_connected === true));
  s.req.destroy();
});

test('a client that disconnects is removed from the hub (no leak)', async (t) => {
  const { srv } = await start(t);
  const s = await openStream(srv);
  await s.wait((e) => e.length >= 1);
  assert.equal(srv.state.hub.size(), 1);
  s.req.destroy();
  const end = Date.now() + 2000;
  while (srv.state.hub.size() !== 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.equal(srv.state.hub.size(), 0);
});

test('close() ends open streams and frees the port even with a client still connected', async (t) => {
  const { srv } = await start(t);
  const s = await openStream(srv);
  await s.wait((e) => e.length >= 1);
  const ended = new Promise((r) => s.res.once('close', r));
  await srv.close();
  await ended;
  assert.equal(srv.server.listening, false);
});

test('an open stream stays open past a short request timeout', async (t) => {
  const { srv } = await start(t);
  // Node checks timeouts on a 30 s sweep, so this only shows the stream is not tied to the request timers.
  srv.server.requestTimeout = 50;
  srv.server.headersTimeout = 40;
  const s = await openStream(srv);
  let closed = false;
  s.res.once('close', () => { closed = true; });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(closed, false);
  await s.wait((e) => e.filter((x) => x.event === 'ping').length >= 2);
  s.req.destroy();
});

test('a client that stops reading is dropped once its backlog passes 1 MB; others are unaffected and memory stays bounded', async (t) => {
  const { srv } = await start(t, { pingMs: 100000 });
  const good = await openStream(srv);
  await good.wait((e) => e.length >= 1);
  // A raw client that asks for the stream and then never reads again.
  const stalled = net.connect(srv.port, '127.0.0.1');
  t.after(() => stalled.destroy());
  await new Promise((r) => stalled.once('connect', r));
  stalled.write(`GET /api/stream HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nx-yap-key: ${srv.key}\r\n\r\n`);
  stalled.pause();
  const end = Date.now() + 2000;
  while (srv.state.hub.size() < 2 && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.equal(srv.state.hub.size(), 2);
  const rssBefore = process.memoryUsage().rss;
  const payload = { text: 'x'.repeat(20000) };
  let sent = 0;
  while (srv.state.hub.size() > 1 && sent < 3000) { srv.state.hub.broadcast('reply', payload); sent++; await new Promise((r) => setImmediate(r)); }
  assert.equal(srv.state.hub.size(), 1, `stalled client still held after ${sent} sends`);
  assert.ok(process.memoryUsage().rss - rssBefore < 100 * 1024 * 1024, 'memory grew without bound');
  srv.state.hub.broadcast('reply', { text: 'still here' });
  await good.wait((e) => e.some((x) => x.data.text === 'still here'));
  good.req.destroy();
});
