'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { resolveSlugDir } = require('../cli/server.cjs');

const YAP = path.join(__dirname, '..', 'bin', 'yap.cjs');

// Makes a temp project root and removes it afterwards.
function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('resolveSlugDir uses --dir, else the only folder under .yap with chapters/, else throws one line', (t) => {
  const root = tempRoot(t);
  assert.equal(resolveSlugDir(path.join(root, 'x'), root), path.join(root, 'x'));
  assert.throws(() => resolveSlugDir(undefined, root), (e) => !/\n/.test(e.message) && /--dir/.test(e.message));
  fs.mkdirSync(path.join(root, '.yap', 'a', 'chapters'), { recursive: true });
  fs.mkdirSync(path.join(root, '.yap', 'plain'), { recursive: true });
  assert.equal(resolveSlugDir(undefined, root), path.join(root, '.yap', 'a'));
  fs.mkdirSync(path.join(root, '.yap', 'b', 'chapters'), { recursive: true });
  assert.throws(() => resolveSlugDir(undefined, root), /--dir/);
});

test('yap serve with no folder to find exits 2 with a one-line usage error', (t) => {
  const root = tempRoot(t);
  const r = spawnSync(process.execPath, [YAP, 'serve'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^yap serve: .*--dir.*\n$/);
});

// Asks the server for / with the key and resolves with the status.
function status(info) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: info.port, path: '/', headers: { 'x-yap-key': info.key }, agent: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
}

test('yap serve --detach starts a background server, prints the URL, and a second call reuses it', async (t) => {
  const root = tempRoot(t);
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  const file = path.join(slugDir, 'state', 'server.json');
  try {
    const r = spawnSync(process.execPath, [YAP, 'serve', '--dir', slugDir, '--detach'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(r.stdout.trim(), info.url);
    assert.equal(await status(info), 200);
    const again = spawnSync(process.execPath, [YAP, 'serve', '--dir', slugDir, '--detach'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout.trim(), info.url);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, info.pid);
  } finally {
    try { process.kill(JSON.parse(fs.readFileSync(file, 'utf8')).pid, 'SIGTERM'); } catch { /* already gone */ }
  }
});

test('a stale server.json is replaced by --detach', async (t) => {
  const root = tempRoot(t);
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(path.join(slugDir, 'state'), { recursive: true });
  fs.mkdirSync(path.join(slugDir, 'chapters'));
  const file = path.join(slugDir, 'state', 'server.json');
  fs.writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:1/?key=x', key: 'x', port: 1, pid: 2 ** 22 + 12345, started_at: 'then' }));
  try {
    const r = spawnSync(process.execPath, [YAP, 'serve', '--dir', slugDir, '--detach'], { encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.notEqual(info.port, 1);
    assert.equal(await status(info), 200);
  } finally {
    try { process.kill(JSON.parse(fs.readFileSync(file, 'utf8')).pid, 'SIGTERM'); } catch { /* already gone */ }
  }
});

const { spawn } = require('node:child_process');
const net = require('node:net');
const { startServer } = require('../server/server.mts');

// Runs the yap CLI without blocking this process (so an in-process server can answer it); resolves {status, stdout, stderr}.
function runYap(args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [YAP, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
// Makes a slug folder with a server.json holding the given fields, runs --detach, kills whatever it started.
async function detachWith(t, fileFields) {
  const root = tempRoot(t);
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  fs.mkdirSync(path.join(slugDir, 'state'));
  const file = path.join(slugDir, 'state', 'server.json');
  fs.writeFileSync(file, JSON.stringify(fileFields));
  try {
    const r = await runYap(['serve', '--dir', slugDir, '--detach']);
    return { r, slugDir, info: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } finally {
    // never signal this test process itself (a file that still names it means nothing was started)
    try { const p = JSON.parse(fs.readFileSync(file, 'utf8')).pid; if (p !== process.pid) process.kill(p, 'SIGTERM'); } catch { /* nothing started */ }
  }
}

test('server.json that does not name a real yap server is stale: pid 1, pid 0, dead port, wrong key', async (t) => {
  // A live server in another folder that the bad files can point at.
  const otherDir = path.join(tempRoot(t), 'other');
  fs.mkdirSync(path.join(otherDir, 'chapters'), { recursive: true });
  const live = await startServer({ slugDir: otherDir });
  t.after(() => live.close());
  const dead = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const cases = {
    'pid 1': { pid: 1, port: live.port, key: live.key },
    'pid 0': { pid: 0, port: live.port, key: live.key },
    'dead port': { pid: process.pid, port: dead, key: live.key },
    'wrong key': { pid: process.pid, port: live.port, key: 'f'.repeat(32) },
    'wrong pid': { pid: process.pid + 1, port: live.port, key: live.key },
  };
  for (const [name, fields] of Object.entries(cases)) {
    const { r, info } = await detachWith(t, { ...fields, url: `http://127.0.0.1:${fields.port}/?key=${fields.key}`, started_at: 'then' });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.notEqual(info.port, live.port, name);
    assert.notEqual(info.pid, fields.pid, name);
    assert.equal(r.stdout.trim(), info.url, name);
  }
});

test('a live server.json is reused but its stored url is never printed: the url is rebuilt from port and key', async (t) => {
  const slugDir = path.join(tempRoot(t), 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  const live = await startServer({ slugDir });
  t.after(() => live.close());
  const file = path.join(slugDir, 'state', 'server.json');
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...info, url: 'https://evil.example/phish' }));
  const r = await runYap(['serve', '--dir', slugDir, '--detach']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), live.url);
  assert.doesNotMatch(r.stdout, /evil/);
});

// ---- slow or hostile answers to the liveness ping (N-1, N-2) ----
const { liveServer, runServe } = require('../cli/server.cjs');

// Runs an async function while capturing what it writes to stdout and stderr; resolves {result, out, err}.
async function captured(fn) {
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  let out = '';
  let err = '';
  // Only text is ours; binary chunks belong to the test runner's own reporting and pass through.
  process.stdout.write = (s, ...rest) => (typeof s === 'string' ? (out += s, true) : realOut.call(process.stdout, s, ...rest));
  process.stderr.write = (s, ...rest) => (typeof s === 'string' ? (err += s, true) : realErr.call(process.stderr, s, ...rest));
  try { return { result: await fn(), out, err }; } finally { process.stdout.write = realOut; process.stderr.write = realErr; }
}
// Starts a raw TCP listener running `onConn(socket)` per connection; closed (with its sockets) when the test ends.
async function rawListener(t, onConn) {
  const sockets = new Set();
  const srv = net.createServer((s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => {}); onConn(s); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { for (const s of sockets) s.destroy(); srv.close(resolve); }));
  return srv.address().port;
}
// Makes a slug folder whose server.json names this test process and the given port.
function folderNaming(t, port, key = 'a'.repeat(32)) {
  const slugDir = path.join(tempRoot(t), 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  fs.mkdirSync(path.join(slugDir, 'state'));
  const text = JSON.stringify({ url: `http://127.0.0.1:${port}/?key=${key}`, key, port, pid: process.pid, started_at: 'then' });
  fs.writeFileSync(path.join(slugDir, 'state', 'server.json'), text);
  return { slugDir, text, file: path.join(slugDir, 'state', 'server.json') };
}
const HEAD = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100000000\r\n\r\n';

test('N-1: a listener that drips one byte at a time cannot hold the ping past its one overall deadline', async (t) => {
  const port = await rawListener(t, (s) => { s.write(HEAD); const i = setInterval(() => s.write('x'), 50); s.on('close', () => clearInterval(i)); });
  const { slugDir } = folderNaming(t, port);
  const started = Date.now();
  const r = await liveServer(slugDir, { pingMs: 300, totalMs: 900 });
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  assert.deepEqual(r, { busy: true });
});

test('N-1: a ping answer bigger than 4 KB is not this server (the file is stale), and is cut off quickly', async (t) => {
  const port = await rawListener(t, (s) => { s.write(HEAD); const big = 'a'.repeat(65536); const i = setInterval(() => s.write(big), 5); s.on('close', () => clearInterval(i)); });
  const { slugDir } = folderNaming(t, port);
  const started = Date.now();
  assert.equal(await liveServer(slugDir, { pingMs: 1000, totalMs: 1000 }), null);
  assert.ok(Date.now() - started < 3000);
});

test('N-2: a live server that answers the ping late (after the first 1 s limit) is still found live', async (t) => {
  let calls = 0;
  const web = http.createServer((req, res) => {
    calls += 1;
    const send = () => res.end(JSON.stringify({ ok: true, pid: process.pid }));
    if (calls === 1) setTimeout(send, 600); else send();
  });
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { web.closeAllConnections(); web.close(resolve); }));
  const { slugDir } = folderNaming(t, web.address().port);
  const r = await liveServer(slugDir, { pingMs: 300, totalMs: 3000 });
  assert.equal(r.pid, process.pid);
  assert.equal(calls, 2);
});

test('N-2: a ping that times out for a dead pid is stale (null), not busy', async (t) => {
  const port = await rawListener(t, () => {});
  const { slugDir, file } = folderNaming(t, port);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), pid: 2 ** 22 + 12345 }));
  assert.equal(await liveServer(slugDir, { pingMs: 200, totalMs: 1000 }), null);
});

test('N-2: --detach against a live pid that never answers prints the sentence, exits 1, keeps server.json, starts nothing', async (t) => {
  let connections = 0;
  const port = await rawListener(t, () => { connections += 1; });
  const { slugDir, text, file } = folderNaming(t, port);
  const started = Date.now();
  const { result, out, err } = await captured(() => runServe(['--dir', slugDir, '--detach']));
  try {
    assert.equal(result, 1);
    assert.equal(err, 'a server for this folder is running but not answering\n');
    assert.equal(out, '');
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    assert.ok(Date.now() - started >= 4500 && Date.now() - started < 9000, `took ${Date.now() - started} ms`);
    assert.ok(connections >= 2, 'it retried the ping');
  } finally {
    // safety net for the old behaviour, which started a second server
    try { const p = JSON.parse(fs.readFileSync(file, 'utf8')).pid; if (p !== process.pid) process.kill(p, 'SIGTERM'); } catch { /* nothing started */ }
  }
});

// ---- I-1: an answer that is not exactly this server is stale at once ----
// A web server that answers every request with the given status and body text.
async function fixedAnswer(t, status, bodyText) {
  const web = http.createServer((req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(bodyText); });
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { web.closeAllConnections(); web.close(resolve); }));
  return web.address().port;
}

test('I-1: a 200 ping without a whole-number pid (or with another body shape) is stale, not busy', async (t) => {
  for (const bodyText of ['{"ok":true}', '{"ok":true,"pid":"12"}', '{"ok":true,"pid":1.5}', '[]', 'null', '{"ok":false,"pid":1234}']) {
    const port = await fixedAnswer(t, 200, bodyText);
    const { slugDir } = folderNaming(t, port);
    const started = Date.now();
    assert.equal(await liveServer(slugDir, { pingMs: 300, totalMs: 3000 }), null, bodyText);
    assert.ok(Date.now() - started < 1500, `${bodyText} took ${Date.now() - started} ms`);
  }
});

test('I-1: --detach over such a file starts a fresh server promptly instead of refusing', async (t) => {
  for (const bodyText of ['{"ok":true}', '{"ok":true,"pid":"12"}', '[]', 'null']) {
    const port = await fixedAnswer(t, 200, bodyText);
    const key = 'a'.repeat(32);
    const started = Date.now();
    const { r, info } = await detachWith(t, { url: `http://127.0.0.1:${port}/?key=${key}`, key, port, pid: process.pid, started_at: 'then' });
    assert.equal(r.status, 0, `${bodyText}: ${r.stderr}`);
    assert.notEqual(info.port, port, bodyText);
    assert.ok(Date.now() - started < 4500, `${bodyText} took ${Date.now() - started} ms`);
  }
});
