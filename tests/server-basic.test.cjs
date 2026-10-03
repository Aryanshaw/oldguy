'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { startServer } = require('../server/server.cjs');
const { newManifest, insertChapter, saveManifest } = require('../lib/manifest.cjs');

// Makes a temp slug folder (named "demo") and removes it when the test ends.
function tempSlug(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-srv-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  return slugDir;
}
// Starts a server for the test and closes it afterwards.
async function start(t, opts = {}) {
  const slugDir = opts.slugDir || tempSlug(t);
  const srv = await startServer({ slugDir, ...opts });
  t.after(() => srv.close());
  return { srv, slugDir };
}
// One plain HTTP request with the Host header set explicitly (default: the server's own address).
function req(srv, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: url, agent: false, headers: { host: `127.0.0.1:${srv.port}`, ...headers } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on('error', reject);
    r.end(body);
  });
}
const withKey = (srv, extra = {}) => ({ 'x-yap-key': srv.key, ...extra });

test('listens on 127.0.0.1 only, url carries the key, key is 32 hex and differs between starts', async (t) => {
  const { srv } = await start(t);
  assert.match(srv.key, /^[0-9a-f]{32}$/);
  assert.equal(srv.url, `http://127.0.0.1:${srv.port}/?key=${srv.key}`);
  const other = await start(t);
  assert.notEqual(other.srv.key, srv.key);
});

test('every route refuses without the key and with a wrong key (403 JSON)', async (t) => {
  const { srv } = await start(t);
  for (const [method, url] of [['GET', '/'], ['GET', '/api/state'], ['POST', '/api/message'], ['GET', '/nope'], ['DELETE', '/']]) {
    const none = await req(srv, { method, url });
    assert.equal(none.status, 403, `${method} ${url}`);
    assert.ok(JSON.parse(none.body).error);
    assert.equal((await req(srv, { method, url, headers: { 'x-yap-key': 'f'.repeat(32) } })).status, 403);
  }
});

test('key in query sets the cookie and redirects to /; cookie alone then passes; header passes', async (t) => {
  const { srv } = await start(t);
  const first = await req(srv, { url: `/?key=${srv.key}` });
  assert.equal(first.status, 302);
  assert.equal(first.headers.location, '/');
  assert.equal(first.headers['set-cookie'][0], `yap_key=${srv.key}; HttpOnly; SameSite=Strict; Path=/`);
  const page = await req(srv, { headers: { cookie: `yap_key=${srv.key}` } });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.equal((await req(srv, { headers: withKey(srv) })).status, 200);
});

test('Host: evil.example is refused even with the right key; both own hosts pass', async (t) => {
  const { srv } = await start(t);
  assert.equal((await req(srv, { headers: withKey(srv, { host: 'evil.example' }) })).status, 403);
  assert.equal((await req(srv, { headers: withKey(srv, { host: `evil.example:${srv.port}` }) })).status, 403);
  assert.equal((await req(srv, { headers: withKey(srv, { host: `127.0.0.1:${srv.port}` }) })).status, 200);
  assert.equal((await req(srv, { headers: withKey(srv, { host: `localhost:${srv.port}` }) })).status, 200);
});

test('POST: foreign Origin 403, no Origin and own origin pass the guard (404 for the unknown route)', async (t) => {
  const { srv } = await start(t);
  const post = (origin) => req(srv, { method: 'POST', url: '/nothing', headers: withKey(srv, origin ? { origin } : {}) });
  assert.equal((await post('https://evil.example')).status, 403);
  assert.equal((await post('null')).status, 403);
  assert.equal((await post()).status, 404);
  assert.equal((await post(`http://127.0.0.1:${srv.port}`)).status, 404);
});

test('unknown route 404 JSON; known path with wrong method 405 JSON', async (t) => {
  const routes = [{ method: 'GET', pattern: '/api/ping', handler: ({ res, sendJson }) => sendJson(res, 200, { pong: true }) }];
  const { srv } = await start(t, { deps: { routes } });
  const nf = await req(srv, { url: '/missing', headers: withKey(srv) });
  assert.deepEqual([nf.status, JSON.parse(nf.body)], [404, { error: 'not found' }]);
  const bad = await req(srv, { method: 'POST', url: '/api/ping', headers: withKey(srv) });
  assert.equal(bad.status, 405);
  assert.ok(JSON.parse(bad.body).error);
  assert.deepEqual(JSON.parse((await req(srv, { url: '/api/ping', headers: withKey(srv) })).body), { pong: true });
});

test('a throwing handler becomes a 500 JSON with no stack and no path', async (t) => {
  const routes = [{ method: 'GET', pattern: '/boom', handler: () => { throw new Error('secret /Users/x/file.js'); } }];
  const { srv } = await start(t, { deps: { routes } });
  const orig = process.stderr.write;
  let logged = '';
  process.stderr.write = (s) => { logged += s; return true; };
  let r;
  try { r = await req(srv, { url: '/boom', headers: withKey(srv) }); } finally { process.stderr.write = orig; }
  assert.equal(r.status, 500);
  assert.deepEqual(JSON.parse(r.body), { error: 'internal error' });
  assert.match(logged, /secret/);
});

test('route params and body errors: path params are passed, oversize body gives 413 JSON', async (t) => {
  const routes = [{ method: 'POST', pattern: '/api/echo/:id', handler: async ({ req: rq, res, params, readJsonBody, sendJson }) => sendJson(res, 200, { id: params.id, body: await readJsonBody(rq) }) }];
  const { srv } = await start(t, { deps: { routes } });
  const ok = await req(srv, { method: 'POST', url: '/api/echo/abc', headers: withKey(srv, { 'content-type': 'application/json' }), body: '{"a":1}' });
  assert.deepEqual(JSON.parse(ok.body), { id: 'abc', body: { a: 1 } });
  const bad = await req(srv, { method: 'POST', url: '/api/echo/abc', headers: withKey(srv, { 'content-type': 'text/plain' }), body: 'x' });
  assert.equal(bad.status, 415);
  assert.ok(JSON.parse(bad.body).error);
});

test('every response carries the security headers', async (t) => {
  const { srv } = await start(t);
  for (const r of [await req(srv), await req(srv, { headers: withKey(srv) }), await req(srv, { url: '/x', headers: withKey(srv) })]) {
    assert.equal(r.headers['content-security-policy'], "default-src 'self'");
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['cache-control'], 'no-store');
  }
});

test('state/server.json is mode 0600 with url, key, port, pid, started_at; close removes it and frees the port', async (t) => {
  const slugDir = tempSlug(t);
  const srv = await startServer({ slugDir });
  const file = path.join(slugDir, 'state', 'server.json');
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(info).sort(), ['key', 'pid', 'port', 'started_at', 'url']);
  assert.equal(info.key, srv.key);
  assert.equal(info.port, srv.port);
  assert.equal(info.pid, process.pid);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await srv.close();
  assert.equal(fs.existsSync(file), false);
  await new Promise((resolve, reject) => {
    const s = net.createServer().once('error', reject).listen(srv.port, '127.0.0.1', () => s.close(resolve));
  });
});

test('a leftover server.json with loose permissions is tightened to 0600', async (t) => {
  const slugDir = tempSlug(t);
  fs.mkdirSync(path.join(slugDir, 'state'));
  fs.writeFileSync(path.join(slugDir, 'state', 'server.json'), '{}', { mode: 0o644 });
  const srv = await startServer({ slugDir });
  t.after(() => srv.close());
  assert.equal(fs.statSync(path.join(slugDir, 'state', 'server.json')).mode & 0o777, 0o600);
});

test('start creates and saves a manifest when none exists; fails with a one-line reason when it is invalid and leaves it alone', async (t) => {
  const { slugDir } = await start(t);
  const made = JSON.parse(fs.readFileSync(path.join(slugDir, 'manifest.json'), 'utf8'));
  assert.deepEqual([made.title, made.slug, made.audience], ['demo', 'demo', 'beginner']);

  const bad = tempSlug(t);
  fs.writeFileSync(path.join(bad, 'manifest.json'), '{"nope":1}');
  await assert.rejects(startServer({ slugDir: bad }), (e) => !/\n/.test(e.message) && /invalid/.test(e.message));
  assert.equal(fs.readFileSync(path.join(bad, 'manifest.json'), 'utf8'), '{"nope":1}');
});

test('placeholder page lists chapters escaped, video only for ready ones, no script', async (t) => {
  const slugDir = tempSlug(t);
  let m = newManifest({ title: 'Tom & <b>Jerry</b>', slug: 'demo', audience: 'beginner' });
  m = insertChapter(m, { id: 'intro', title: '<script>alert(1)</script>', status: 'ready' });
  m = insertChapter(m, { id: 'next', title: 'Next one', status: 'pending' });
  saveManifest(path.join(slugDir, 'manifest.json'), m);
  const { srv } = await start(t, { slugDir });
  const page = await req(srv, { headers: withKey(srv) });
  assert.match(page.body, /Tom &amp; &lt;b&gt;Jerry&lt;\/b&gt;/);
  assert.match(page.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(page.body, /<script/i);
  assert.match(page.body, /<video controls preload="metadata" src="\/chapters\/intro\/video">/);
  assert.doesNotMatch(page.body, /chapters\/next\/video/);
  assert.equal(page.body.includes(slugDir), false);
});
