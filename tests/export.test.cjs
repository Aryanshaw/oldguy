'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { exportVideo } = require('../lib/export.mts');
const { startServer } = require('../server/server.mts');
const { newManifest, insertChapter, saveManifest } = require('../lib/manifest.mts');
const { sha256 } = require('../lib/build-record.mts');

const BYTES = Buffer.from('MP4DATA');
const TEMP_LISTS = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('yap-export-'));

// Writes a chapter folder that passes the ready rule (mp4 + build.json + matching render.json).
function makeChapter(slugDir, id, mp4 = BYTES) {
  const dir = path.join(slugDir, 'chapters', id);
  fs.mkdirSync(dir, { recursive: true });
  const build = JSON.stringify({ version: 3, verified_against_commit: 'a'.repeat(40), sha256: {} });
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

test('argv is an array with the concat flags, the real ffmpeg name and a temp output in a private folder inside dest', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const f = fakeExec();
  await run(p, { exec: f.exec });
  const { file, args } = f.calls[0];
  assert.equal(file, 'ffm');
  assert.deepEqual(args.slice(0, 7), ['-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i']);
  assert.deepEqual(args.slice(8, 12), ['-c', 'copy', '-movflags', '+faststart']);
  assert.equal(path.dirname(path.dirname(args[12])), fs.realpathSync(p.destDir));
  assert.match(path.basename(path.dirname(args[12])), /^\.yap-export-/);
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
  await assert.rejects(run(p, { slugDir: path.join(odd, 'demo'), exec: f.exec }), (e) => e.status === 409 && e.message === 'a chapter file path contains a line break, so it cannot be joined');
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

test('route: no chapter to join is 409 and nothing is written', async (t) => {
  const p = project(t, [['a', 'pending']]);
  const f = fakeExec();
  const { post } = await serve(t, p, { exec: f.exec });
  const r = await post({ dest: p.destDir, mode: 'drafts' });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /no ready chapter/);
  assert.ok(!r.text.includes(p.root));
  assert.equal(f.calls.length, 0);
});

test('route: full mode (the default) with a draft chapter is 409 naming it', async (t) => {
  const p = project(t, [['a', 'ready', 'draft']]);
  const f = fakeExec();
  const { post } = await serve(t, p, { exec: f.exec });
  const r = await post({ dest: p.destDir });
  assert.equal(r.status, 409, r.text);
  assert.ok(r.json.error.includes('a'));
  assert.deepEqual(fs.readdirSync(p.destDir), []);
  assert.equal(f.calls.length, 0);
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

// ---- fix round 1 ----

test('I-1: an unsafe manifest slug is refused (409): nothing written anywhere, ffmpeg not run', async (t) => {
  for (const slug of ['../escaped', 'a/b', '-rf', '..', '', 'a\nb', '.hidden', 'a..b', 'x'.repeat(81), 'a b', 'a\0b']) {
    const p = project(t, [['a', 'ready']]);
    const f = fakeExec();
    await assert.rejects(run(p, { manifest: { ...p.manifest, slug }, exec: f.exec }), (e) => e.status === 409 && /slug/.test(e.message) && !e.message.includes(p.root), JSON.stringify(slug));
    assert.equal(f.calls.length, 0);
    assert.deepEqual(fs.readdirSync(p.destDir), []);
    assert.deepEqual(fs.readdirSync(p.root).sort(), ['.yap', 'out']);
  }
});

test('I-2: a real folder named ..x inside .yap is refused, a sibling named .yapx is accepted', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const { post } = await serve(t, p, { exec: fakeExec().exec });
  fs.mkdirSync(path.join(p.yap, '..x'));
  assert.equal((await post({ dest: path.join(p.yap, '..x'), mode: 'drafts' })).status, 400);
  const sib = path.join(p.root, '.yapx');
  fs.mkdirSync(sib);
  const ok = await post({ dest: sib, mode: 'drafts' });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(fs.existsSync(path.join(sib, 'demo.mp4')));
});

// Wraps a fake exec so something happens in the middle of the ffmpeg run (before it writes its output).
function duringRun(inner, hook) {
  return async (file, args, opts) => { await hook(args); return inner.exec(file, args, opts); };
}

test('I-3: a file that appears at the chosen name during the run is not overwritten; the export lands on -2', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const exec = duringRun(fakeExec(), () => fs.writeFileSync(path.join(p.destDir, 'demo.mp4'), 'MINE'));
  const r = await run(p, { exec });
  assert.deepEqual(r.files, ['demo-2.mp4', 'script-2.md', 'sources-2.json']);
  assert.equal(fs.readFileSync(path.join(p.destDir, 'demo.mp4'), 'utf8'), 'MINE');
  assert.equal(fs.readFileSync(path.join(p.destDir, 'demo-2.mp4'), 'utf8'), 'JOINED');
  assert.deepEqual(fs.readdirSync(p.destDir).sort(), ['demo-2.mp4', 'demo.mp4', 'script-2.md', 'sources-2.json']);
});

test('I-3: a link planted at the old predictable temp name is left alone and its target unchanged', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const victim = path.join(p.root, 'victim.txt');
  fs.writeFileSync(victim, 'SAFE');
  const planted = path.join(p.destDir, `demo.mp4.tmp-${process.pid}`);
  fs.symlinkSync(victim, planted);
  const r = await run(p, { exec: fakeExec().exec });
  assert.equal(r.file, 'demo.mp4');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'SAFE');
  assert.ok(fs.lstatSync(planted).isSymbolicLink());
});

test('I-3: ffmpeg writes into a private folder inside dest, which is gone after success and after failure', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const seen = [];
  const mk = (inner) => duringRun(inner, (args) => {
    const dir = path.dirname(args[args.length - 1]);
    seen.push({ parent: path.dirname(dir), mode: fs.statSync(dir).mode & 0o777 });
  });
  await run(p, { exec: mk(fakeExec()) });
  await assert.rejects(run(p, { exec: mk(fakeExec({ failOn: [1, 2] })) }));
  assert.equal(seen.length, 3);
  for (const s of seen) assert.deepEqual(s, { parent: fs.realpathSync(p.destDir), mode: 0o700 });
  assert.deepEqual(fs.readdirSync(p.destDir).sort(), ['demo.mp4', 'script.md', 'sources.json']);
});

test('6: script.md appearing during the run ends in success on the next suffix for all three', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const exec = duringRun(fakeExec(), () => fs.writeFileSync(path.join(p.destDir, 'script.md'), 'MINE'));
  const r = await run(p, { exec });
  assert.deepEqual(r.files, ['demo-2.mp4', 'script-2.md', 'sources-2.json']);
  assert.equal(fs.readFileSync(path.join(p.destDir, 'script.md'), 'utf8'), 'MINE');
  assert.deepEqual(fs.readdirSync(p.destDir).sort(), ['demo-2.mp4', 'script-2.md', 'script.md', 'sources-2.json']);
});

test('4: a symlinked dest with a trailing slash or dot is refused', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const { post } = await serve(t, p, { exec: fakeExec().exec });
  const link = path.join(p.root, 'link');
  fs.symlinkSync(p.destDir, link);
  for (const dest of [link + '/', link + '//', link + '/.']) {
    const r = await post({ dest, mode: 'drafts' });
    assert.equal(r.status, 400, dest);
  }
  assert.deepEqual(fs.readdirSync(p.destDir), []);
});

test('5: server close() aborts a running export, waits for it, and nothing is published afterwards', async (t) => {
  const p = project(t, [['a', 'ready']]);
  let sawSignal = null;
  let started;
  const begun = new Promise((res) => { started = res; });
  const inner = fakeExec();
  const exec = (file, args, opts) => {
    if (!args.includes('concat')) return inner.exec(file, args, opts);
    sawSignal = opts && opts.signal;
    started();
    return new Promise((_, reject) => { sawSignal.addEventListener('abort', () => reject(new Error('aborted'))); });
  };
  const { srv, post } = await serve(t, p, { exec });
  const pending = post({ dest: p.destDir, mode: 'drafts' }).catch(() => ({}));
  await begun;
  assert.ok(sawSignal && typeof sawSignal.aborted === 'boolean');
  await srv.close();
  assert.equal(sawSignal.aborted, true);
  assert.equal(srv.state.exporting, false);
  assert.deepEqual(fs.readdirSync(p.destDir), []);
  await pending;
  assert.deepEqual(fs.readdirSync(p.destDir), []);
});

test('5: an export whose ffmpeg ignores the abort still publishes nothing once stopped', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const ac = new AbortController();
  const inner = fakeExec();
  const exec = async (file, args, opts) => { ac.abort(); return inner.exec(file, args, opts); };
  await assert.rejects(run(p, { exec, signal: ac.signal }), (e) => e.status === 500 && /stopped/.test(e.message));
  assert.deepEqual(fs.readdirSync(p.destDir), []);
});

test('7: the ffmpeg reason keeps 3/4 intact, drops a real folder name with spaces, and is capped at 200 characters', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const spaced = path.join(p.root, 'My Project');
  fs.symlinkSync(p.yap, spaced);
  const viaLink = path.join(spaced, 'demo');
  const real = fs.realpathSync(path.join(p.slugDir, 'chapters', 'a', 'chapter.mp4'));
  const reasonOf = async (stderr, slugDir = p.slugDir) => {
    const f = fakeExec({ failOn: [1, 2], stderr });
    try { await run(p, { slugDir, exec: f.exec }); } catch (e) { return e.message; }
    return null;
  };
  assert.equal(await reasonOf('frame 3/4 done'), 'ffmpeg failed: frame 3/4 done');
  const m = await reasonOf(`${path.join(fs.realpathSync(p.yap), 'demo', 'chapters', 'a', 'chapter.mp4')}: bad`, viaLink);
  assert.equal(m, 'ffmpeg failed: chapter.mp4: bad');
  assert.ok(real.length > 0 && !m.includes('My Project'));
  const long = await reasonOf('x'.repeat(500));
  assert.ok(!long.includes('\n') && long.length <= 'ffmpeg failed: '.length + 200);
});

test('8: mode and other fields are type-checked before dest touches the disk', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const { post } = await serve(t, p, { exec: fakeExec().exec });
  const missing = path.join(p.root, 'nope');
  for (const body of [{ dest: missing, mode: 7 }, { dest: missing, mode: 'drafts', extra: 1 }]) {
    const r = await post(body);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /mode|field/);
  }
});

// ---- fix round 2 ----

test('names: 2024-recap, Demo, my_video and a.b are accepted as the output name', async (t) => {
  for (const slug of ['2024-recap', 'Demo', 'my_video', 'a.b', 'x'.repeat(80)]) {
    const p = project(t, [['a', 'ready']]);
    const r = await run(p, { manifest: { ...p.manifest, slug }, exec: fakeExec().exec });
    assert.equal(r.file, `${slug}.mp4`);
  }
});

// A copy of node's fs with some functions replaced, injected into the export.
const withFs = (over) => ({ ...fs, ...over });
const codeError = (code) => Object.assign(new Error(code), { code });

test('N-1: when hard links are not supported the export copies instead, byte for byte', async (t) => {
  for (const code of ['ENOTSUP', 'EPERM', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK']) {
    const p = project(t, [['a', 'ready']]);
    const f = withFs({ linkSync: () => { throw codeError(code); } });
    const r = await run(p, { exec: fakeExec().exec, fs: f });
    assert.deepEqual(r.files, ['demo.mp4', 'script.md', 'sources.json'], code);
    assert.equal(fs.readFileSync(path.join(p.destDir, 'demo.mp4'), 'utf8'), 'JOINED');
    assert.deepEqual(fs.readdirSync(p.destDir).sort(), ['demo.mp4', 'script.md', 'sources.json']);
  }
});

test('N-1: the copy fallback never replaces a file that appeared meanwhile', async (t) => {
  const p = project(t, [['a', 'ready']]);
  let first = true;
  const f = withFs({});
  f.linkSync = (a, b) => { if (first) { first = false; fs.writeFileSync(path.join(p.destDir, 'demo.mp4'), 'MINE'); } throw codeError('ENOTSUP'); };
  const r = await run(p, { exec: fakeExec().exec, fs: f });
  assert.deepEqual(r.files, ['demo-2.mp4', 'script-2.md', 'sources-2.json']);
  assert.equal(fs.readFileSync(path.join(p.destDir, 'demo.mp4'), 'utf8'), 'MINE');
  assert.deepEqual(fs.readdirSync(p.destDir).sort(), ['demo-2.mp4', 'demo.mp4', 'script-2.md', 'sources-2.json']);
});

test('N-1: a copy that fails half-way leaves nothing behind under the final names', async (t) => {
  const p = project(t, [['a', 'ready']]);
  const f = withFs({
    linkSync: () => { throw codeError('ENOTSUP'); },
    copyFileSync: (src, dst, flags) => {
      if (String(dst).endsWith('.mp4')) { fs.writeFileSync(dst, 'HALF'); throw codeError('EIO'); }
      return fs.copyFileSync(src, dst, flags);
    },
  });
  await assert.rejects(run(p, { exec: fakeExec().exec, fs: f }), (e) => e.status === 500 && !e.message.includes(p.root));
  assert.deepEqual(fs.readdirSync(p.destDir), []);
});

test('rollback: a clash on the second text file ends with a complete set on the next suffix and no stray file', async (t) => {
  const p = project(t, [['a', 'ready']]);
  let planted = false;
  const f = withFs({
    copyFileSync: (src, dst, flags) => {
      if (!planted && String(dst).endsWith('sources.json')) { planted = true; fs.writeFileSync(dst, 'MINE'); }
      return fs.copyFileSync(src, dst, flags);
    },
  });
  const r = await run(p, { exec: fakeExec().exec, fs: f });
  assert.deepEqual(r.files, ['demo-2.mp4', 'script-2.md', 'sources-2.json']);
  assert.deepEqual(fs.readdirSync(p.destDir).sort(), ['demo-2.mp4', 'script-2.md', 'sources-2.json', 'sources.json']);
  assert.equal(fs.readFileSync(path.join(p.destDir, 'sources.json'), 'utf8'), 'MINE');
});

test('rollback: a clash at the link step ends with a complete set on the next suffix and no stray file', async (t) => {
  const p = project(t, [['a', 'ready']]);
  let planted = false;
  const f = withFs({
    linkSync: (a, b) => {
      if (!planted) { planted = true; fs.writeFileSync(path.join(p.destDir, 'demo.mp4'), 'MINE'); }
      return fs.linkSync(a, b);
    },
  });
  const r = await run(p, { exec: fakeExec().exec, fs: f });
  assert.deepEqual(r.files, ['demo-2.mp4', 'script-2.md', 'sources-2.json']);
  assert.deepEqual(fs.readdirSync(p.destDir).sort(), ['demo-2.mp4', 'demo.mp4', 'script-2.md', 'sources-2.json']);
  assert.equal(fs.readFileSync(path.join(p.destDir, 'demo.mp4'), 'utf8'), 'MINE');
});

test('N-4: a folder that cannot be written into gives a 409 with a short message', { skip: process.getuid && process.getuid() === 0 }, async (t) => {
  const p = project(t, [['a', 'ready']]);
  const { post } = await serve(t, p, { exec: fakeExec().exec });
  fs.chmodSync(p.destDir, 0o500);
  try {
    await assert.rejects(run(p, { exec: fakeExec().exec }), (e) => e.status === 409 && e.message === 'cannot write into that folder');
    const r = await post({ dest: p.destDir, mode: 'drafts' });
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { error: 'cannot write into that folder' });
  } finally {
    fs.chmodSync(p.destDir, 0o700);
  }
});

test('N-2: an export started while close() waits on poster work is answered 503 and writes nothing', async (t) => {
  const p = project(t, [['a', 'ready']]);
  let release;
  const gate = new Promise((res) => { release = res; });
  const exec = async (file, args) => {
    if (!args.includes('concat')) { await gate; fs.writeFileSync(args[args.length - 1], 'POSTER'); return; }
    fs.writeFileSync(args[args.length - 1], 'JOINED');
  };
  const { srv, post } = await serve(t, p, { exec, posterWaitMs: 2000 });
  const closing = srv.close();
  const r = await post({ dest: p.destDir, mode: 'drafts' });
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { error: 'the server is closing' });
  release();
  await closing;
  assert.deepEqual(fs.readdirSync(p.destDir), []);
});
