'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { resolveSlugDir } = require('../lib/server-cli.cjs');

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
const { startServer } = require('../server/server.cjs');

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
    try { process.kill(JSON.parse(fs.readFileSync(file, 'utf8')).pid, 'SIGTERM'); } catch { /* nothing started */ }
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
