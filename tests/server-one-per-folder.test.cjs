'use strict';
// One server per folder (final review I1): a second start refuses, and close() only removes its own server.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer } = require('../server/server.mts');

const OLDGUY = path.join(__dirname, '..', 'bin', 'oldguy.cjs');
const MESSAGE = 'a server for this folder is already running';

// Makes a temp folder named "demo" with a chapters/ folder and removes it afterwards.
function tempSlug(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-one-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  return slugDir;
}

// Runs `oldguy serve` as a child (async, so this process can still answer its ping) and resolves { status, stdout, stderr }.
function runOldguy(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [OLDGUY, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('a second server on the same folder refuses with one line; the first keeps serving and its server.json is unchanged', async (t) => {
  const slugDir = tempSlug(t);
  const first = await startServer({ slugDir, deps: { logError: () => {} } });
  t.after(() => first.close());
  const file = path.join(slugDir, 'state', 'server.json');
  const before = fs.readFileSync(file, 'utf8');
  await assert.rejects(startServer({ slugDir, deps: { logError: () => {} } }), (err) => err.message === MESSAGE);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const r = await fetch(`http://127.0.0.1:${first.port}/api/ping`, { headers: { 'x-oldguy-key': first.key } });
  assert.equal(r.status, 200);
});

test('a stale server.json (nothing listening) is replaced by a new server', async (t) => {
  const slugDir = tempSlug(t);
  const first = await startServer({ slugDir, deps: { logError: () => {} } });
  const old = fs.readFileSync(path.join(slugDir, 'state', 'server.json'), 'utf8');
  await first.close();
  fs.mkdirSync(path.join(slugDir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'state', 'server.json'), old);
  const second = await startServer({ slugDir, deps: { logError: () => {} } });
  t.after(() => second.close());
  assert.equal(JSON.parse(fs.readFileSync(path.join(slugDir, 'state', 'server.json'), 'utf8')).port, second.port);
});

test('foreground `oldguy serve` on a folder with a live server exits 1 with the line and the existing URL', async (t) => {
  const slugDir = tempSlug(t);
  const first = await startServer({ slugDir, deps: { logError: () => {} } });
  t.after(() => first.close());
  const r = await runOldguy(['serve', '--dir', slugDir]);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr, `oldguy serve: ${MESSAGE}\n`);
  assert.equal(r.stdout, `${first.url}\n`);
});

test('after a refused second start, the first server close() still removes its own server.json', async (t) => {
  const slugDir = tempSlug(t);
  const first = await startServer({ slugDir, deps: { logError: () => {} } });
  await assert.rejects(startServer({ slugDir, deps: { logError: () => {} } }), /already running/);
  const file = path.join(slugDir, 'state', 'server.json');
  assert.ok(fs.existsSync(file));
  await first.close();
  assert.ok(!fs.existsSync(file));
});

test('close() leaves a server.json that holds another server\'s record', async (t) => {
  const slugDir = tempSlug(t);
  const first = await startServer({ slugDir, deps: { logError: () => {} } });
  const file = path.join(slugDir, 'state', 'server.json');
  const other = JSON.stringify({ url: 'http://127.0.0.1:1/?key=x', key: 'a'.repeat(32), port: 1, pid: process.pid + 1, started_at: 'x' });
  fs.writeFileSync(file, other);
  await first.close();
  assert.equal(fs.readFileSync(file, 'utf8'), other);
});
