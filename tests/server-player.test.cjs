'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { startServer } = require('../server/server.mts');
const { newManifest, insertChapter, saveManifest } = require('../lib/manifest.mts');

const INDEX = Buffer.from('<!doctype html><title>player</title><div id="root"></div>');

// A temp slug folder ("demo", title "Demo") with the given chapter ids, a temp player folder, and a started server.
async function setup(t, { chapters = [], assets = {}, index = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-player-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  let m = newManifest({ title: 'Demo', slug: 'demo', audience: 'beginner' });
  for (const id of chapters) { m = insertChapter(m, { id, title: id, status: 'pending' }); fs.mkdirSync(path.join(slugDir, 'chapters', id), { recursive: true }); }
  saveManifest(path.join(slugDir, 'manifest.json'), m);
  const playerDir = path.join(root, 'dist');
  fs.mkdirSync(path.join(playerDir, 'assets'), { recursive: true });
  if (index) fs.writeFileSync(path.join(playerDir, 'index.html'), index);
  for (const [name, bytes] of Object.entries(assets)) fs.writeFileSync(path.join(playerDir, 'assets', name), bytes);
  const srv = await startServer({ slugDir, deps: { playerDir, exec: async () => {} } });
  t.after(() => srv.close());
  return { srv, slugDir, playerDir, root };
}
// One plain HTTP request; the key header is sent unless noKey.
function get(srv, url, { noKey = false } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${srv.port}` };
    if (!noKey) headers['x-oldguy-key'] = srv.key;
    const r = http.request({ host: '127.0.0.1', port: srv.port, method: 'GET', path: url, agent: false, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end();
  });
}
// Sends the request target exactly as written (no client-side tidying) and returns the raw answer text.
function raw(srv, target) {
  return new Promise((resolve) => {
    const s = net.connect(srv.port, '127.0.0.1');
    let d = '';
    s.on('data', (c) => { d += c; });
    s.on('close', () => resolve(d));
    s.on('error', () => resolve(d));
    s.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nx-oldguy-key: ${srv.key}\r\nConnection: close\r\n\r\n`);
  });
}
const statusOf = (answer) => Number(/^HTTP\/1\.1 (\d+)/.exec(answer)?.[1]);

test('GET / without index.html is the placeholder page', async (t) => {
  const { srv } = await setup(t);
  const r = await get(srv, '/');
  assert.equal(r.status, 200);
  assert.match(r.body.toString(), /<title>Demo<\/title>/);
});

test('GET / with index.html returns its exact bytes; ?key= still redirects with the cookie', async (t) => {
  const { srv } = await setup(t, { index: INDEX });
  const r = await get(srv, '/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  assert.deepEqual(r.body, INDEX);
  const k = await get(srv, `/?key=${srv.key}`);
  assert.equal(k.status, 302);
  assert.match(k.headers['set-cookie'][0], new RegExp(`oldguy_key_${srv.port}=${srv.key}`));
  assert.equal(k.headers.location, '/');
});

test('an index.html that is a folder falls back to the placeholder', async (t) => {
  const { srv, playerDir } = await setup(t);
  fs.mkdirSync(path.join(playerDir, 'index.html'));
  assert.match((await get(srv, '/')).body.toString(), /<title>Demo<\/title>/);
});

test('assets get their content types; unknown extensions are 404', async (t) => {
  const assets = {
    'app.js': 'console.log(1)', 'app.css': 'a{}', 'f.woff2': 'W2', 'f.woff': 'W1', 'i.svg': '<svg/>', 'p.png': 'PNG', 'p.jpg': 'JPG', 'app.js.map': '{}', 'x.html': '<p>',
  };
  const { srv } = await setup(t, { assets });
  const want = {
    'app.js': 'text/javascript; charset=utf-8', 'app.css': 'text/css; charset=utf-8', 'f.woff2': 'font/woff2', 'f.woff': 'font/woff',
    'i.svg': 'image/svg+xml', 'p.png': 'image/png', 'p.jpg': 'image/jpeg',
  };
  for (const [name, type] of Object.entries(want)) {
    const r = await get(srv, `/assets/${name}`);
    assert.equal(r.status, 200, name);
    assert.equal(r.headers['content-type'], type, name);
    assert.equal(r.body.toString(), assets[name], name);
  }
  assert.equal((await get(srv, '/assets/app.js.map')).status, 404);
  assert.equal((await get(srv, '/assets/x.html')).status, 404);
  assert.equal((await get(srv, '/assets/missing.js')).status, 404);
});

test('asset names that try to leave assets/ never reach another file', async (t) => {
  const { srv, playerDir } = await setup(t, { index: INDEX, assets: { 'app.js': 'ok' } });
  fs.writeFileSync(path.join(playerDir, 'secret.js'), 'SECRET');
  const targets = ['/assets/..%2Findex.html', '/assets/..%2Fsecret.js', '/assets/%2e%2e', '/assets/a/b.js', `/assets/${'a'.repeat(200)}.js`, '/assets/a%00.js', '/assets/.hidden.js', '/assets/a..b.js', '/assets/..\\', '/assets/..\\app.js', '/assets/%2e%2e%5c'];
  for (const target of targets) {
    const answer = await raw(srv, target);
    assert.ok([400, 404].includes(statusOf(answer)), `${target} -> ${answer.slice(0, 20)}`);
    assert.ok(!answer.includes('SECRET') && !answer.includes('<div id="root">'), target);
  }
});

test('a symlink inside assets/ that points outside is 404', async (t) => {
  const { srv, playerDir } = await setup(t);
  fs.writeFileSync(path.join(playerDir, 'outside.js'), 'OUTSIDE');
  fs.symlinkSync(path.join(playerDir, 'outside.js'), path.join(playerDir, 'assets', 'link.js'));
  assert.equal((await get(srv, '/assets/link.js')).status, 404);
});

test('security headers stay on; without the key every new route is 403', async (t) => {
  const { srv } = await setup(t, { index: INDEX, assets: { 'app.js': 'ok' }, chapters: ['intro'] });
  for (const url of ['/', '/assets/app.js', '/assets/nope.js', '/chapters/intro/sources', '/chapters/nope/sources']) {
    const r = await get(srv, url);
    assert.equal(r.headers['content-security-policy'], "default-src 'self'", url);
    const bare = await get(srv, url, { noKey: true });
    assert.equal(bare.status, 403, url);
    assert.equal(bare.headers['content-security-policy'], "default-src 'self'", url);
  }
});

test('GET /chapters/:id/sources keeps well-formed entries and defaults the quote', async (t) => {
  const { srv, slugDir } = await setup(t, { chapters: ['intro'] });
  const sources = [
    { id: 's1', file: 'a.js', lines: [1, 5], quote: 'one' },
    { id: 's2', file: 'b.js', lines: [10, 12], quote: 'two' },
    { id: 's3', file: 'c.js', lines: [3, 3] },
    { id: 's4', file: 'd.js', lines: [7, 9], quote: 'four' },
    { id: 's5', file: 'e.js', lines: 'x', quote: 'bad lines' },
    { id: 's6', file: '', lines: [1, 2] },
    { id: 's7', file: 'f.js', lines: [1.5, 2] },
    { id: 's8', file: 'g.js', lines: [1] },
    null,
  ];
  fs.writeFileSync(path.join(slugDir, 'chapters', 'intro', 'chapter.json'), JSON.stringify({ id: 'intro', title: 'intro', sources }));
  const r = await get(srv, '/chapters/intro/sources');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { sources: [
    { file: 'a.js', lines: [1, 5], quote: 'one' },
    { file: 'b.js', lines: [10, 12], quote: 'two' },
    { file: 'c.js', lines: [3, 3], quote: '' },
    { file: 'd.js', lines: [7, 9], quote: 'four' },
  ] });
});

test('sources: missing file, unreadable file or no sources array is an empty list', async (t) => {
  const { srv, slugDir } = await setup(t, { chapters: ['intro'] });
  assert.deepEqual(JSON.parse((await get(srv, '/chapters/intro/sources')).body), { sources: [] });
  const file = path.join(slugDir, 'chapters', 'intro', 'chapter.json');
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(JSON.parse((await get(srv, '/chapters/intro/sources')).body), { sources: [] });
  fs.writeFileSync(file, JSON.stringify({ id: 'intro', sources: 'nope' }));
  assert.deepEqual(JSON.parse((await get(srv, '/chapters/intro/sources')).body), { sources: [] });
});

test('sources: unknown or unsafe id is 404', async (t) => {
  const { srv } = await setup(t, { chapters: ['intro'] });
  assert.equal((await get(srv, '/chapters/nope/sources')).status, 404);
  assert.equal((await get(srv, '/chapters/..%2Fx/sources')).status, 404);
  assert.equal((await get(srv, '/chapters/%2e%2e/sources')).status, 404);
});

test('sources: a chapter.json that is a symlink out of the folder is an empty list', async (t) => {
  const { srv, slugDir, root } = await setup(t, { chapters: ['intro'] });
  fs.writeFileSync(path.join(root, 'evil.json'), JSON.stringify({ sources: [{ file: 'x', lines: [1, 2] }] }));
  fs.symlinkSync(path.join(root, 'evil.json'), path.join(slugDir, 'chapters', 'intro', 'chapter.json'));
  assert.deepEqual(JSON.parse((await get(srv, '/chapters/intro/sources')).body), { sources: [] });
});
