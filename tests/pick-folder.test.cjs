'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pickFolder } = require('../lib/pick-folder.mts');
const { startServer } = require('../server/server.mts');
const { newManifest, saveManifest } = require('../lib/manifest.mts');

// A fake exec: each call takes the next answer; an answer is {stdout} or an error code (ENOENT or an exit number).
function fakeExec(answers) {
  const calls = [];
  const exec = async (file, args) => {
    calls.push(file);
    const a = answers.shift();
    if (a && 'code' in a) throw Object.assign(new Error('failed'), { code: a.code });
    return a;
  };
  return { exec, calls };
}

test('pickFolder: answers the chosen folder without the trailing newline', async () => {
  const f = fakeExec([{ stdout: '/Users/me/Desktop/\n' }]);
  assert.equal(await pickFolder({ platform: 'darwin', exec: f.exec }), '/Users/me/Desktop/');
  assert.deepEqual(f.calls, ['osascript']);
});

test('pickFolder: cancel is null (a non-zero exit, or no output on Windows)', async () => {
  assert.equal(await pickFolder({ platform: 'darwin', exec: fakeExec([{ code: 1 }]).exec }), null);
  assert.equal(await pickFolder({ platform: 'win32', exec: fakeExec([{ stdout: '\r\n' }]).exec }), null);
});

test('pickFolder: Linux falls back from zenity to kdialog, then reports 501', async () => {
  const f = fakeExec([{ code: 'ENOENT' }, { stdout: '/home/me\n' }]);
  assert.equal(await pickFolder({ platform: 'linux', exec: f.exec }), '/home/me');
  assert.deepEqual(f.calls, ['zenity', 'kdialog']);
  await assert.rejects(pickFolder({ platform: 'linux', exec: fakeExec([{ code: 'ENOENT' }, { code: 'ENOENT' }]).exec }), (e) => e.status === 501);
  await assert.rejects(pickFolder({ platform: 'aix', exec: fakeExec([]).exec }), (e) => e.status === 501);
});

test('route: POST /api/export/folder answers {dest}, refuses a second picker, needs the key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-pick-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, '.oldguy', 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  saveManifest(path.join(slugDir, 'manifest.json'), newManifest({ slug: 'demo', title: 'Demo', audience: 'devs' }));
  let release;
  const srv = await startServer({ slugDir, deps: { logError: () => {}, pickFolder: () => new Promise((r) => (release = r)) } });
  t.after(() => srv.close());
  const post = (key = srv.key) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${srv.port}`, 'content-type': 'application/json', ...(key ? { 'x-oldguy-key': key } : {}) };
    const r = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: '/api/export/folder', agent: false, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text || 'null') }));
    });
    r.on('error', reject);
    r.end('{}');
  });
  assert.equal((await post(null)).status, 403);
  const first = post();
  while (!release) await new Promise((r) => setTimeout(r, 5));
  assert.equal((await post()).status, 409);
  release('/picked');
  assert.deepEqual(await first, { status: 200, json: { dest: '/picked' } });
});
