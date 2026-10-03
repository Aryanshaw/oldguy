'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { exportVideo } = require('../lib/export.cjs');
const { startServer } = require('../server/server.cjs');
const { newManifest, insertChapter, saveManifest } = require('../lib/manifest.cjs');
const { sha256 } = require('../lib/build-record.cjs');

const BYTES = Buffer.from('MP4DATA');
const TEMP_LISTS = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('yap-export-'));

// Writes a chapter folder that passes the ready rule (mp4 + build.json + matching render.json).
function makeChapter(slugDir, id, mp4 = BYTES) {
  const dir = path.join(slugDir, 'chapters', id);
  fs.mkdirSync(dir, { recursive: true });
  const build = JSON.stringify({ version: 2, verified_against_commit: 'a'.repeat(40), sha256: {} });
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify({ id, title: id }));
  fs.writeFileSync(path.join(dir, 'build.json'), build);
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(build) }));
  fs.writeFileSync(path.join(dir, 'chapter.mp4'), mp4);
  return dir;
}
// A project: <root>/.yap/demo (slug folder) plus a separate <root>/out folder to export into.
// rows are [id, status, quality?]; every row gets a ready folder unless its status is "pending".
function project(t, rows, { slugName = 'demo', texts = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-exp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const yap = path.join(root, '.yap');
  const slugDir = path.join(yap, slugName);
  const destDir = path.join(root, 'out');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  fs.mkdirSync(destDir);
  let manifest = newManifest({ title: 'Demo', slug: slugName, audience: 'beginner' });
  for (const [id, status, quality = 'full'] of rows) {
    manifest = insertChapter(manifest, { id, title: id, status, quality });
    if (status !== 'pending') makeChapter(slugDir, id);
  }
  if (texts) {
    fs.writeFileSync(path.join(slugDir, 'script.md'), '# Script\n\u00e9\n');
    fs.writeFileSync(path.join(slugDir, 'sources.json'), '{"sources":[]}\n');
  }
  saveManifest(path.join(slugDir, 'manifest.json'), manifest);
  return { root, yap, slugDir, destDir, manifest };
}
// A fake exec: records every call; writes bytes to the last argument, or fails with the given stderr for attempt numbers in `failOn`.
function fakeExec({ failOn = [], stderr = 'boom\nConversion failed!' } = {}) {
  const calls = [];
  const exec = async (file, args) => {
    if (!args.includes('concat')) { fs.writeFileSync(args[args.length - 1], 'POSTER'); return; }
    calls.push({ file, args: [...args], list: fs.existsSync(args[args.indexOf('-i') + 1]) ? fs.readFileSync(args[args.indexOf('-i') + 1], 'utf8') : null });
    const out = args[args.length - 1];
    fs.writeFileSync(out, 'PART');
    if (failOn.includes(calls.length)) throw Object.assign(new Error('Command failed'), { stderr });
    fs.writeFileSync(out, 'JOINED');
  };
  return { exec, calls };
}
const run = (p, over = {}) => exportVideo({ manifest: p.manifest, slugDir: p.slugDir, destDir: p.destDir, ffmpeg: 'ffm', mode: 'drafts', ...over });

test('joins ready chapters in manifest order and copies script and sources byte for byte', async (t) => {
  const p = project(t, [['b', 'ready'], ['a', 'ready'], ['c', 'pending']]);
  const f = fakeExec();
  const r = await run(p, { exec: f.exec });
  assert.deepEqual(r, { file: 'demo.mp4', files: ['demo.mp4', 'script.md', 'sources.json'], skipped: [{ id: 'c', reason: 'not ready' }] });
  const want = ['b', 'a'].map((id) => `file '${fs.realpathSync(path.join(p.slugDir, 'chapters', id, 'chapter.mp4'))}'\n`).join('');
  assert.equal(f.calls[0].list, want);
  assert.equal(fs.readFileSync(path.join(p.destDir, 'demo.mp4'), 'utf8'), 'JOINED');
  for (const n of ['script.md', 'sources.json']) assert.deepEqual(fs.readFileSync(path.join(p.destDir, n)), fs.readFileSync(path.join(p.slugDir, n)));
  assert.deepEqual(fs.readdirSync(p.destDir).sort(), ['demo.mp4', 'script.md', 'sources.json']);
});

test('argv is an array with the concat flags, the real ffmpeg name and a temp output beside the final name', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const f = fakeExec();
  await run(p, { exec: f.exec });
  const { file, args } = f.calls[0];
  assert.equal(file, 'ffm');
  assert.deepEqual(args.slice(0, 7), ['-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i']);
  assert.deepEqual(args.slice(8, 12), ['-c', 'copy', '-movflags', '+faststart']);
  assert.equal(args[12], path.join(p.destDir, `demo.mp4.tmp-${process.pid}`));
  assert.equal(args.length, 13);
});

test('list file: a path with spaces and a single quote is written exactly, and the list folder is removed', async (t) => {
  const p = project(t, [['a', 'ready']]);
  // Move the slug into a folder whose name has spaces and a single quote.
  const odd = path.join(p.root, "it's a folder");
  fs.renameSync(p.yap, odd);
  const slugDir = path.join(odd, 'demo');
  const before = TEMP_LISTS();
  const f = fakeExec();
  await run(p, { slugDir, exec: f.exec });
  const real = fs.realpathSync(path.join(slugDir, 'chapters', 'a', 'chapter.mp4'));
  assert.ok(real.includes("it's a folder"));
  assert.equal(f.calls[0].list, `file '${real.replaceAll("'", "'\\''")}'\n`);
  assert.deepEqual(TEMP_LISTS(), before);
});

test('a chapter path with a line break is refused and nothing runs', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const odd = path.join(p.root, 'line\nbreak');
  fs.renameSync(p.yap, odd);
  const f = fakeExec();
  await assert.rejects(run(p, { slugDir: path.join(odd, 'demo'), exec: f.exec }), (e) => !e.message.includes(p.root));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(fs.readdirSync(p.destDir), []);
});

test('no ready chapter: error with status 409, nothing written, ffmpeg not run', async (t) => {
  const p = project(t, [['a', 'pending']]);
  const f = fakeExec();
  await assert.rejects(run(p, { exec: f.exec }), (e) => e.status === 409 && /no ready chapter/.test(e.message));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(fs.readdirSync(p.destDir), []);
});

test('copy fails, then the re-encode run succeeds', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const f = fakeExec({ failOn: [1] });
  const r = await run(p, { exec: f.exec });
  assert.equal(r.file, 'demo.mp4');
  assert.equal(f.calls.length, 2);
  const a2 = f.calls[1].args;
  assert.deepEqual(a2.slice(8, 14), ['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart']);
  assert.ok(!f.calls[0].args.includes('libx264'));
  assert.equal(fs.readFileSync(path.join(p.destDir, 'demo.mp4'), 'utf8'), 'JOINED');
});

test('both runs fail: reason is the last stderr line with paths cut to base names, no file left, list folder removed', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const before = TEMP_LISTS();
  const mp4 = path.join(p.slugDir, 'chapters', 'a', 'chapter.mp4');
  const f = fakeExec({ failOn: [1, 2], stderr: `x\n${mp4}: Invalid data found\n\n` });
  await assert.rejects(run(p, { exec: f.exec }), (e) => {
    assert.equal(e.message, 'ffmpeg failed: chapter.mp4: Invalid data found');
    return !e.message.includes('\n') && !e.message.includes(p.root) && e.status === 500;
  });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(fs.readdirSync(p.destDir), []);
  assert.deepEqual(TEMP_LISTS(), before);
});

test('never overwrites: an existing name gets -2, then -3, for all three outputs', async (t) => {
  const p = project(t, [['a', 'ready']]);
  fs.writeFileSync(path.join(p.destDir, 'demo.mp4'), 'OLD');
  const r2 = await run(p, { exec: fakeExec().exec });
  assert.deepEqual(r2.files, ['demo-2.mp4', 'script-2.md', 'sources-2.json']);
  assert.equal(r2.file, 'demo-2.mp4');
  const r3 = await run(p, { exec: fakeExec().exec });
  assert.equal(r3.file, 'demo-3.mp4');
  assert.equal(fs.readFileSync(path.join(p.destDir, 'demo.mp4'), 'utf8'), 'OLD');
});

test('suffix when only script.md pre-exists', async (t) => {
  const p = project(t, [['a', 'ready']]);
  fs.writeFileSync(path.join(p.destDir, 'script.md'), 'MINE');
  const r = await run(p, { exec: fakeExec().exec });
  assert.deepEqual(r.files, ['demo-2.mp4', 'script-2.md', 'sources-2.json']);
  assert.equal(fs.readFileSync(path.join(p.destDir, 'script.md'), 'utf8'), 'MINE');
});

test('a missing script.md or sources.json is listed in skipped and the export goes on', async (t) => {
  const p = project(t, [['a', 'ready']], { texts: false });
  fs.writeFileSync(path.join(p.slugDir, 'sources.json'), '[]');
  const r = await run(p, { exec: fakeExec().exec });
  assert.deepEqual(r.files, ['demo.mp4', 'sources.json']);
  assert.deepEqual(r.skipped, [{ id: 'script.md', reason: 'missing' }]);
});

test("mode 'full' with a draft chapter: 409 naming it, nothing written, ffmpeg not run", async (t) => {
  const p = project(t, [['a', 'ready', 'full'], ['b', 'ready', 'draft']]);
  const f = fakeExec();
  await assert.rejects(run(p, { mode: 'full', exec: f.exec }), (e) => e.status === 409 && e.message.includes('b') && !e.message.includes('"a"'));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(fs.readdirSync(p.destDir), []);
});

test("mode defaults to 'full'; drafts mode exports draft chapters; other modes are a 400", async (t) => {
  const p = project(t, [['a', 'ready', 'draft']]);
  await assert.rejects(exportVideo({ manifest: p.manifest, slugDir: p.slugDir, destDir: p.destDir, ffmpeg: 'f', exec: fakeExec().exec }), (e) => e.status === 409);
  const r = await run(p, { mode: 'drafts', exec: fakeExec().exec });
  assert.equal(r.file, 'demo.mp4');
  await assert.rejects(run(p, { mode: 'fast', exec: fakeExec().exec }), (e) => e.status === 400);
});

test('a chapter that is ready in the manifest but not on disk is skipped', async (t) => {
  const p = project(t, [['a', 'ready'], ['b', 'ready']]);
  fs.appendFileSync(path.join(p.slugDir, 'chapters', 'b', 'build.json'), ' ');
  const f = fakeExec();
  const r = await run(p, { exec: f.exec });
  assert.deepEqual(r.skipped, [{ id: 'b', reason: 'files are not current' }]);
  assert.equal(f.calls[0].list.split('\n').filter(Boolean).length, 1);
});

test('a chapter.mp4 that is a link out of its folder is skipped', async (t) => {
  const p = project(t, [['a', 'ready'], ['b', 'ready']]);
  const mp4 = path.join(p.slugDir, 'chapters', 'b', 'chapter.mp4');
  const outside = path.join(p.root, 'elsewhere.mp4');
  fs.writeFileSync(outside, 'X');
  fs.rmSync(mp4);
  fs.symlinkSync(outside, mp4);
  const r = await run(p, { exec: fakeExec().exec });
  assert.deepEqual(r.skipped.map((x) => x.id), ['b']);
});

// ---- the route ----

// Starts a server over a project with an injected exec; returns a caller that sends a keyed POST /api/export.
async function serve(t, p, deps = {}) {
  const srv = await startServer({ slugDir: p.slugDir, deps: { logError: () => {}, ...deps } });
  t.after(() => srv.close());
  const post = (body, { raw } = {}) => new Promise((resolve, reject) => {
    const payload = raw !== undefined ? raw : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: '/api/export', agent: false,
      headers: { host: `127.0.0.1:${srv.port}`, 'x-yap-key': srv.key, 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, json, text }); });
    });
    r.on('error', reject);
    r.end(payload);
  });
  return { srv, post };
}

test('route: 200 with {file, files, skipped}; no body leaks an absolute path', async (t) => {
  const p = project(t, [['a', 'ready'], ['b', 'pending']]);
  const f = fakeExec();
  const { post } = await serve(t, p, { exec: f.exec, ffmpeg: 'my-ffmpeg' });
  const r = await post({ dest: p.destDir, mode: 'drafts' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { file: 'demo.mp4', files: ['demo.mp4', 'script.md', 'sources.json'], skipped: [{ id: 'b', reason: 'not ready' }] });
  assert.equal(f.calls[0].file, 'my-ffmpeg');
  assert.ok(!r.text.includes(p.root));
});

test('route: ffmpeg failure is a one-line 500 with no absolute path', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const f = fakeExec({ failOn: [1, 2], stderr: `${p.destDir}/x.mp4: No space left` });
  const { post } = await serve(t, p, { exec: f.exec });
  const r = await post({ dest: p.destDir, mode: 'drafts' });
  assert.equal(r.status, 500);
  assert.equal(r.json.error, 'ffmpeg failed: x.mp4: No space left');
  assert.ok(!r.text.includes(p.root));
});

test('route: no chapter to join and full mode with drafts are 409', async (t) => {
  const p = project(t, [['a', 'pending']]);
  const { post } = await serve(t, p, { exec: fakeExec().exec });
  const r = await post({ dest: p.destDir, mode: 'drafts' });
  assert.equal(r.status, 409);
  assert.ok(!r.text.includes(p.root));
});

test('route: bad dest values are 400 with a one-line message that does not echo the path', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const f = fakeExec();
  const { post } = await serve(t, p, { exec: f.exec });
  const file = path.join(p.root, 'afile');
  fs.writeFileSync(file, 'x');
  const link = path.join(p.root, 'link');
  fs.symlinkSync(p.destDir, link);
  const inside = path.join(p.yap, 'demo', 'sub');
  fs.mkdirSync(inside);
  const cases = [
    'relative/out', 'out', path.join(p.root, 'missing-dir'), file, link, p.yap, p.slugDir, inside,
    p.destDir + '/../out', 42, null, ['x'], undefined, '',
  ];
  for (const dest of cases) {
    const r = await post({ dest, mode: 'drafts' });
    assert.equal(r.status, 400, `${String(dest)} -> ${r.text}`);
    assert.equal(typeof r.json.error, 'string');
    assert.ok(!r.json.error.includes('\n'));
    assert.ok(!r.text.includes(p.root) && !r.text.includes('missing-dir'), r.text);
  }
  const bad = await post({ dest: p.destDir, mode: 7 });
  assert.equal(bad.status, 400);
  assert.equal((await post({ dest: p.destDir, mode: 'nope' })).status, 400);
  assert.equal(f.calls.length, 0);
});

test('route: a second export while one runs is 409, and a new one works after it ends', async (t) => {
  const p = project(t, [['a', 'ready']]);
  let release;
  const gate = new Promise((res) => { release = res; });
  let started;
  const begun = new Promise((res) => { started = res; });
  const inner = fakeExec();
  const exec = async (file, args) => { started(); await gate; return inner.exec(file, args); };
  const { post } = await serve(t, p, { exec });
  const first = post({ dest: p.destDir, mode: 'drafts' });
  await begun;
  const second = await post({ dest: p.destDir, mode: 'drafts' });
  assert.equal(second.status, 409);
  assert.equal(second.json.error, 'an export is already running');
  release();
  assert.equal((await first).status, 200);
  assert.equal((await post({ dest: p.destDir, mode: 'drafts' })).status, 200);
});

test('route: needs the key', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const { srv } = await serve(t, p, { exec: fakeExec().exec });
  const status = await new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: '/api/export', agent: false,
      headers: { host: `127.0.0.1:${srv.port}`, 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.end(JSON.stringify({ dest: p.destDir }));
  });
  assert.equal(status, 403);
});
