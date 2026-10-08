'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { appendEvent } = require('../lib/events.mts');
const { startServer } = require('../server/server.mts');
const { writeVideoChoice } = require('../lib/settings.mts');

const BIN = path.join(__dirname, '..', 'bin', 'oldguy.cjs');
const FIXTURES = path.join(__dirname, 'fixtures', 'templates');

// Makes an empty temp folder for one test and removes it when the test ends.
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-remake-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Runs oldguy with the fixture templates (explainer and duo).
function oldguy(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, OLDGUY_TEMPLATES_DIR: FIXTURES } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// A finished video folder: checked sources, a script, an order and a chapter, made as explainer at 16:9.
function video(t, name = 'add-todo') {
  const dir = path.join(tempDir(t), name);
  fs.mkdirSync(path.join(dir, 'chapters', 'intro'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sources.json'), '[]\n');
  fs.writeFileSync(path.join(dir, 'script.md'), '# script\n');
  fs.writeFileSync(path.join(dir, 'order.json'), '{"chapters":["intro"]}\n');
  fs.writeFileSync(path.join(dir, 'chapters', 'intro', 'chapter.json'), '{}');
  return dir;
}

test('a remake event needs a template and a shape; no other event carries them', (t) => {
  const file = path.join(tempDir(t), 'events.jsonl');
  const e = appendEvent(file, { type: 'remake', template: 'duo', shape: '9:16' });
  assert.equal(e.type, 'remake');
  assert.equal(e.template, 'duo');
  assert.equal(e.shape, '9:16');
  assert.throws(() => appendEvent(file, { type: 'remake', shape: '9:16' }), /template is required for remake/);
  assert.throws(() => appendEvent(file, { type: 'remake', template: 'duo' }), /shape is required for remake: one of 16:9, 9:16, 1:1/);
  assert.throws(() => appendEvent(file, { type: 'remake', template: '../x', shape: '9:16' }), /template is required/);
  assert.throws(() => appendEvent(file, { type: 'message', text: 'hi', template: 'duo' }), /only remake carries template and shape/);
});

// One request to a running server with its key.
function call(srv, method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: url, agent: false,
      headers: { host: `127.0.0.1:${srv.port}`, 'x-oldguy-key': srv.key, ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: d && /json/.test(res.headers['content-type'] || '') ? JSON.parse(d) : d }));
    });
    r.on('error', reject);
    r.end(data);
  });
}

// Starts a server on a video folder, with the fixture templates, and closes it afterwards.
async function serve(t, slugDir) {
  const before = process.env.OLDGUY_TEMPLATES_DIR;
  process.env.OLDGUY_TEMPLATES_DIR = FIXTURES;
  t.after(() => { if (before === undefined) delete process.env.OLDGUY_TEMPLATES_DIR; else process.env.OLDGUY_TEMPLATES_DIR = before; });
  const srv = await startServer({ slugDir, deps: { playerDir: tempDir(t) } });
  t.after(() => srv.close());
  return srv;
}

test('the server takes a remake to a known template and refuses an unknown one with 400', async (t) => {
  const srv = await serve(t, video(t));
  const ok = await call(srv, 'POST', '/api/message', { type: 'remake', template: 'duo', shape: '9:16' });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.event.type, ok.body.event.template, ok.body.event.shape], ['remake', 'duo', '9:16']);
  const bad = await call(srv, 'POST', '/api/message', { type: 'remake', template: 'tutor', shape: '9:16' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /unknown template "tutor"; use one of explainer, duo/);
});

test('GET /api/templates gives the video\'s template and shape and every template', async (t) => {
  const slugDir = video(t);
  writeVideoChoice(slugDir, { template: 'explainer', shape: '9:16' });
  const srv = await serve(t, slugDir);
  const r = await call(srv, 'GET', '/api/templates');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.current, { template: 'explainer', shape: '9:16' });
  assert.deepEqual(r.body.templates.map((x) => x.id), ['explainer', 'duo']);
  assert.deepEqual(r.body.templates[1], {
    id: 'duo', title: 'Duo', description: 'A test template: one asks, one explains.', shapes: ['16:9', '9:16'],
    tags: ['two-voices', 'reel', 'word-captions'], voices: [{ id: 'kid', voice: 'bm_george' }, { id: 'dad', voice: 'am_adam' }],
    captions: 'word', chapter_seconds: [30, 60], sample: false, poster: false,
  });
  assert.deepEqual(r.body.templates[0].voices, [{ id: 'narrator', voice: 'af_heart' }], 'a narrator template lists its one voice');
});

test('oldguy remake makes a new folder with the checked sources, script and order, and the new template', (t) => {
  const from = video(t);
  const r = oldguy(['remake', '--from', from, '--template', 'duo', '--shape', '9:16']);
  assert.equal(r.code, 0, r.stderr);
  const dir = path.join(path.dirname(from), 'add-todo-duo');
  assert.equal(r.stdout, `${dir}\nduo at 9:16\n`);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['order.json', 'script.md', 'sources.json', 'video.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'video.json'), 'utf8')), { template: 'duo', shape: '9:16' });
  assert.ok(fs.existsSync(path.join(from, 'chapters', 'intro', 'chapter.json')), 'the old video is untouched');
});

test('a template\'s sample and poster are served; a template or file that does not exist is 404', async (t) => {
  const srv = await serve(t, video(t));
  const poster = await call(srv, 'GET', '/api/templates/explainer/poster');
  assert.equal(poster.status, 200);
  assert.equal(poster.type, 'image/jpeg');
  assert.equal((await call(srv, 'GET', '/api/templates/explainer/sample')).status, 404, 'the fixture explainer ships no clip');
  assert.equal((await call(srv, 'GET', '/api/templates/duo/sample')).status, 404);
  assert.equal((await call(srv, 'GET', '/api/templates/nope/poster')).status, 404);
});

test('a second remake to the same template refuses; a remake of a remake keeps the base name', (t) => {
  const from = video(t);
  assert.equal(oldguy(['remake', '--from', from, '--template', 'duo']).code, 0);
  const again = oldguy(['remake', '--from', from, '--template', 'duo']);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /add-todo-duo already exists/);
  const back = oldguy(['remake', '--from', path.join(path.dirname(from), 'add-todo-duo'), '--template', 'explainer']);
  assert.equal(back.code, 0, back.stderr);
  assert.match(back.stdout, /add-todo-explainer\n/);
});

test('remaking in the same template means a new shape, and the folder says which', (t) => {
  const from = video(t);
  assert.match(oldguy(['remake', '--from', from, '--template', 'explainer']).stderr, /already explainer at 16:9/);
  const r = oldguy(['remake', '--from', from, '--template', 'explainer', '--shape', '9:16']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /add-todo-explainer-9x16\nexplainer at 9:16\n/);
});

test('a shape the template lacks falls back to its default; unknown ids, shapes and folders are refused', (t) => {
  const from = video(t);
  writeVideoChoice(from, { template: 'explainer', shape: '1:1' });
  assert.match(oldguy(['remake', '--from', from, '--template', 'duo']).stdout, /duo at 16:9 \(duo has no 1:1 layout, so its default 16:9 is used\)/);
  assert.match(oldguy(['remake', '--from', from, '--template', 'nope']).stderr, /unknown template "nope"/);
  assert.match(oldguy(['remake', '--from', from, '--template', 'duo', '--shape', '4:3']).stderr, /unknown shape "4:3"/);
  assert.match(oldguy(['remake', '--from', tempDir(t), '--template', 'duo']).stderr, /no sources\.json/);
  assert.equal(oldguy(['remake', '--template', 'duo']).code, 2);
});
