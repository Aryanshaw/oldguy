'use strict';
// Nothing is written after close() resolves (final review I4): late exports and queued manifest jobs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startServer } = require('../server/server.mts');
const { newManifest, insertChapter, saveManifest } = require('../lib/manifest.mts');
const { sha256 } = require('../lib/build-record.mts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A gate: wait() blocks until open() is called; entered resolves once someone is waiting.
function gate() {
  let open;
  let enter;
  const opened = new Promise((r) => { open = r; });
  const entered = new Promise((r) => { enter = r; });
  return { open, entered, wait: () => { enter(); return opened; } };
}

// Makes <root>/.yap/demo with one ready chapter "a" and an empty <root>/out; removes it afterwards.
function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-close-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, '.yap', 'demo');
  const dir = path.join(slugDir, 'chapters', 'a');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'out'));
  const build = JSON.stringify({ version: 3, verified_against_commit: 'a'.repeat(40), sha256: {} });
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify({ id: 'a', title: 'a' }));
  fs.writeFileSync(path.join(dir, 'build.json'), build);
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(build) }));
  fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'MP4DATA');
  fs.writeFileSync(path.join(dir, 'beats.json'), JSON.stringify({ durationS: 3, beats: [] }));
  fs.writeFileSync(path.join(slugDir, 'script.md'), '# Script\n');
  fs.writeFileSync(path.join(slugDir, 'sources.json'), '{"sources":[]}\n');
  let m = newManifest({ title: 'Demo', slug: 'demo', audience: 'beginner' });
  m = insertChapter(m, { id: 'a', title: 'a', status: 'ready', quality: 'full' });
  saveManifest(path.join(slugDir, 'manifest.json'), m);
  return { root, slugDir, destDir: path.join(root, 'out') };
}

// Sends a JSON POST in one go; resolves { status, json }.
function post(srv, url, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: url, agent: false,
      headers: { host: `127.0.0.1:${srv.port}`, 'x-yap-key': srv.key, 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject);
    r.end(JSON.stringify(body));
  });
}

test('an export whose body is still arriving when close() starts is refused with 503 and writes nothing', async (t) => {
  const p = project(t);
  const posterGate = gate();
  const joins = [];
  // The poster picture is held so close() has something to wait for; any join (the export) is recorded and writes a file.
  const exec = async (file, args) => {
    if (!args.includes('concat')) { await posterGate.wait(); return; }
    joins.push(args);
    fs.writeFileSync(args[args.length - 1], 'JOINED');
  };
  const srv = await startServer({ slugDir: p.slugDir, deps: { exec, ffmpeg: 'f', logError: () => {}, posterWaitMs: 1500, setInterval: () => ({ unref() {} }), clearInterval() {} } });
  t.after(() => { posterGate.open(); return srv.close(); });
  await posterGate.entered;
  const answer = new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: '/api/export', agent: false,
      headers: { host: `127.0.0.1:${srv.port}`, 'x-yap-key': srv.key, 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.write(`{"dest":${JSON.stringify(p.destDir)}`);
    setTimeout(() => { req.end(', "mode":"drafts"}'); }, 200);
  });
  await sleep(50);
  const closed = srv.close();
  const r = await answer;
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { error: 'the server is closing' });
  await closed;
  await sleep(300);
  assert.deepEqual(fs.readdirSync(p.destDir), []);
  assert.equal(joins.length, 0);
});

test('a POST /api/chapters in flight when close() starts completes before close() resolves; a later one gets 503; the file never changes after close', async (t) => {
  const p = project(t);
  const hold = gate();
  let armed = false;
  const srv = await startServer({ slugDir: p.slugDir, deps: { logError: () => {}, setInterval: () => ({ unref() {} }), clearInterval() {}, exec: async (f, a) => { fs.writeFileSync(a[a.length - 1], 'JPEG'); },
    ffmpeg: 'f', beforeSave: async () => { if (armed) { armed = false; await hold.wait(); } } } });
  t.after(() => { hold.open(); return srv.close(); });
  await srv.state.posterIdle();
  const file = path.join(p.slugDir, 'manifest.json');
  armed = true;
  const first = post(srv, '/api/chapters', { op: 'add', id: 'one', title: 'One' });
  await hold.entered;
  let closedAt = null;
  const closed = srv.close().then(() => { closedAt = Date.now(); });
  await sleep(50);
  const late = await post(srv, '/api/chapters', { op: 'add', id: 'two', title: 'Two' });
  assert.equal(late.status, 503);
  assert.deepEqual(late.json, { error: 'the server is closing' });
  assert.equal(closedAt, null, 'close() is still waiting for the running job');
  hold.open();
  const done = await first;
  await closed;
  assert.equal(done.status, 200);
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');
  assert.ok(text.includes('"one"') && !text.includes('"two"'));
  await sleep(300);
  assert.ok(fs.readFileSync(file).equals(bytes), 'the manifest did not change after close() resolved');
});

test('close() stops waiting for a manifest job that never ends, after queueWaitMs', async (t) => {
  const p = project(t);
  const hold = gate();
  let armed = false;
  const srv = await startServer({ slugDir: p.slugDir, deps: { logError: () => {}, queueWaitMs: 100, setInterval: () => ({ unref() {} }), clearInterval() {}, exec: async (f, a) => { fs.writeFileSync(a[a.length - 1], 'JPEG'); },
    ffmpeg: 'f', beforeSave: async () => { if (armed) { armed = false; await hold.wait(); } } } });
  t.after(() => { hold.open(); return srv.close(); });
  await srv.state.posterIdle();
  armed = true;
  post(srv, '/api/chapters', { op: 'add', id: 'one' }).catch(() => {});
  await hold.entered;
  const started = Date.now();
  await srv.close();
  assert.ok(Date.now() - started < 3000);
});
