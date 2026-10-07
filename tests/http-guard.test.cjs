'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const { createGuard, readJsonBody } = require('../lib/http-guard.mts');

const KEY = 'a'.repeat(32);
const PORT = 4321;
// Builds the bit of a request the guard looks at.
function fakeReq({ method = 'GET', url = '/', headers = {} } = {}) {
  return { method, url, headers: { host: `127.0.0.1:${PORT}`, ...headers } };
}
const guard = createGuard({ key: KEY, port: PORT });

test('no key, wrong key and wrong-length key are refused with 403', () => {
  for (const req of [fakeReq(), fakeReq({ url: '/?key=nope' }), fakeReq({ headers: { 'x-oldguy-key': 'b'.repeat(32) } }), fakeReq({ headers: { 'x-oldguy-key': 'short' } })]) {
    const r = guard.check(req);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  }
});

test('the key is accepted from the header, the cookie and the query', () => {
  assert.equal(guard.check(fakeReq({ headers: { 'x-oldguy-key': KEY } })).ok, true);
  assert.equal(guard.check(fakeReq({ headers: { cookie: `other=1; oldguy_key_${PORT}=${KEY}` } })).ok, true);
  // A cookie without the port in its name, or for another port, is ignored.
  assert.equal(guard.check(fakeReq({ headers: { cookie: `oldguy_key=${KEY}` } })).ok, false);
  assert.equal(guard.check(fakeReq({ headers: { cookie: `oldguy_key_${PORT + 1}=${KEY}` } })).ok, false);
  assert.equal(guard.check(fakeReq({ url: `/?key=${KEY}` })).ok, true);
});

test('Host must be exactly 127.0.0.1:port or localhost:port, and is checked before the key', () => {
  const withKey = (host) => fakeReq({ headers: { 'x-oldguy-key': KEY, host } });
  assert.equal(guard.check(withKey(`127.0.0.1:${PORT}`)).ok, true);
  assert.equal(guard.check(withKey(`localhost:${PORT}`)).ok, true);
  assert.equal(guard.check(withKey(`LOCALHOST:${PORT}`)).ok, true);
  for (const bad of ['evil.example', `evil.example:${PORT}`, '127.0.0.1', `127.0.0.1:${PORT + 1}`, `127.0.0.1:${PORT}.evil.example`, `[::1]:${PORT}`]) {
    assert.equal(guard.check(withKey(bad)).status, 403, bad);
  }
  assert.equal(guard.check({ method: 'GET', url: '/', headers: { 'x-oldguy-key': KEY } }).status, 403, 'missing Host');
  // A bad Host with a bad key gives the same answer as a bad Host with a good key.
  const a = guard.check(fakeReq({ headers: { host: 'evil.example' } }));
  const b = guard.check(fakeReq({ headers: { host: 'evil.example', 'x-oldguy-key': KEY } }));
  assert.deepEqual(a, b);
});

test('POST needs an absent or own Origin; null and foreign origins are refused', () => {
  const post = (origin) => fakeReq({ method: 'POST', headers: { 'x-oldguy-key': KEY, ...(origin === undefined ? {} : { origin }) } });
  assert.equal(guard.check(post(undefined)).ok, true);
  assert.equal(guard.check(post(`http://127.0.0.1:${PORT}`)).ok, true);
  assert.equal(guard.check(post(`http://localhost:${PORT}`)).ok, true);
  for (const bad of ['https://evil.example', 'null', `http://127.0.0.1:${PORT + 1}`, `https://127.0.0.1:${PORT}`, '']) {
    assert.equal(guard.check(post(bad)).status, 403, bad);
  }
  // A foreign Origin on GET does not matter.
  assert.equal(guard.check(fakeReq({ headers: { 'x-oldguy-key': KEY, origin: 'https://evil.example' } })).ok, true);
});

// Starts a tiny server whose handler reads a JSON body and answers with the result or the error status.
function bodyServer(opts) {
  return new Promise((resolve) => {
    const seen = {};
    const server = http.createServer((req, res) => {
      seen.req = req;
      // `delay` makes the handler wait a tick before answering, like a handler that does async work.
      const wait = opts && opts.delay ? new Promise((r) => setImmediate(r)) : null;
      readJsonBody(req, { ...opts, res }).then(
        (obj) => { res.writeHead(200); res.end(JSON.stringify(obj)); },
        async (err) => { if (wait) await wait; res.writeHead(err.status || 500); res.end(String(err.status)); },
      );
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port }));
  });
}
// Sends one request and resolves with {status, body}, or {error} if the connection was cut.
function send(port, { headers = {}, body, chunks }) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', headers, agent: false }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', (error) => resolve({ error }));
    if (chunks) chunks(req); else req.end(body);
  });
}

test('readJsonBody returns the parsed object and allows content-type parameters', async () => {
  const { server, port } = await bodyServer({});
  try {
    const r = await send(port, { headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"a":1}' });
    assert.deepEqual([r.status, r.body], [200, '{"a":1}']);
  } finally { server.close(); }
});

test('readJsonBody rejects wrong type (415), bad JSON and non-objects (400)', async () => {
  const { server, port } = await bodyServer({});
  try {
    assert.equal((await send(port, { headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await send(port, { body: '{}' })).status, 415);
    const json = { 'content-type': 'application/json' };
    for (const bad of ['{nope', '[1]', 'null', '"s"', '5', '']) {
      assert.equal((await send(port, { headers: json, body: bad })).status, 400, bad);
    }
  } finally { server.close(); }
});

test('readJsonBody rejects an over-cap body with 413 and destroys the request, with or without Content-Length', async () => {
  const { server, seen, port } = await bodyServer({ maxBytes: 100 });
  try {
    const json = { 'content-type': 'application/json' };
    const big = JSON.stringify({ x: 'y'.repeat(500) });
    const sized = await send(port, { headers: json, body: big });
    assert.equal(sized.status, 413);
    const chunked = await send(port, { headers: json, chunks: (req) => { req.write('{"x":"'); req.write('y'.repeat(500)); req.end('"}'); } });
    assert.equal(chunked.status, 413);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(seen.req.destroyed, true);
  } finally { server.close(); }
});

test('readJsonBody gives up with 408 when the body never finishes', async () => {
  const { server, port } = await bodyServer({ timeoutMs: 100 });
  try {
    const r = await send(port, { headers: { 'content-type': 'application/json' }, chunks: (req) => { req.write('{"a":'); } });
    assert.equal(r.status, 408);
  } finally { server.closeAllConnections(); server.close(); }
});

test('readJsonBody works on a plain stream too (unit)', async () => {
  const s = new PassThrough();
  s.headers = { 'content-type': 'application/json' };
  s.end('{"ok":true}');
  assert.deepEqual(await readJsonBody(s), { ok: true });
});

test('a request target the URL parser rejects is refused, never thrown (guard unit)', () => {
  for (const url of ['http://x:99999/', 'http://[/', '//', 'http://%zz/', undefined]) {
    const r = guard.check({ method: 'GET', url, headers: { host: `127.0.0.1:${PORT}` } });
    assert.equal(r.status, 403, String(url));
  }
  assert.equal(guard.check({ method: 'GET', url: '/', headers: null }).status, 403);
  assert.equal(guard.check({ method: 'GET', url: '/', headers: { host: `127.0.0.1:${PORT}`, cookie: 7, 'x-oldguy-key': ['a'] } }).status, 403);
});

// Sends raw bytes to the port and resolves with {head, closed}: the status line (or '') and whether the server closed the socket.
function raw(port, writer, wait = 3000) {
  const net = require('node:net');
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let got = '';
    const done = (closed) => { clearTimeout(t); sock.destroy(); resolve({ head: got.split('\r\n')[0], closed }); };
    const t = setTimeout(() => done(false), wait);
    sock.on('data', (c) => { got += c; });
    sock.on('error', () => {});
    sock.on('close', () => done(true));
    writer(sock);
  });
}

for (const delay of [false, true]) {
  test(`a 10 MB body gets its real 413 status line, then the socket is closed (handler delay: ${delay})`, async () => {
    const { server, port } = await bodyServer({ maxBytes: 100, delay });
    try {
      for (let i = 0; i < 5; i++) {
        const r = await raw(port, (s) => {
          s.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 10485760\r\n\r\n`);
          s.write(Buffer.alloc(10 * 1024 * 1024, 0x20));
        });
        assert.equal(r.head, 'HTTP/1.1 413 Payload Too Large');
        assert.equal(r.closed, true);
      }
    } finally { server.close(); }
  });

  test(`a body that never finishes gets its real 408 status line, then the socket is closed (handler delay: ${delay})`, async () => {
    const { server, port } = await bodyServer({ timeoutMs: 100, delay });
    try {
      const r = await raw(port, (s) => s.write('POST / HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 50\r\n\r\n{"a":'));
      assert.equal(r.head, 'HTTP/1.1 408 Request Timeout');
      assert.equal(r.closed, true);
    } finally { server.close(); }
  });
}
