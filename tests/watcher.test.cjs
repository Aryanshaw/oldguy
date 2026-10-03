'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startWatcher } = require('../lib/watcher.cjs');

// A scan result for one chapter with only the fields the watcher looks at.
const ch = (id, status = 'ready', buildSha256 = 'aaa') => ({ id, title: id, durationS: 3, status, buildSha256, verifiedAgainstCommit: null, hasPoster: false, issues: [] });
// A scan function that returns whatever `box.result` holds (or throws it when it is an Error).
function fakeScan(box) {
  return () => { if (box.result instanceof Error) throw box.result; return box.result; };
}
// A fake interval: remembers the callback and whether it was cleared; the handle can be unref'd.
function fakeTimers() {
  const t = { fn: null, ms: null, cleared: false, unrefed: false };
  t.setInterval = (fn, ms) => { t.fn = fn; t.ms = ms; return { unref() { t.unrefed = true; } }; };
  t.clearInterval = () => { t.cleared = true; };
  return t;
}
// Starts a watcher over a fake scan; returns the pieces a test needs.
function setup(result, extra = {}) {
  const box = { result };
  const diffs = [];
  const errors = [];
  const timers = fakeTimers();
  const w = startWatcher({
    slugDir: '/nowhere', scan: fakeScan(box), onChange: (d) => { diffs.push(d); return extra.onChange && extra.onChange(d); },
    logError: (e) => errors.push(e), setInterval: timers.setInterval, clearInterval: timers.clearInterval, ...extra.opts,
  });
  return { box, diffs, errors, timers, w };
}

test('the first poll reports every chapter as added, in scan order', async () => {
  const { diffs, w } = setup({ order: ['a', 'b'], chapters: [ch('a'), ch('b', 'pending', null)], issues: [] });
  await w.pollNow();
  assert.equal(diffs.length, 1);
  assert.deepEqual(diffs[0].added.map((c) => c.id), ['a', 'b']);
  assert.deepEqual(diffs[0].changed, []);
  assert.deepEqual(diffs[0].removed, []);
  assert.deepEqual(diffs[0].order, ['a', 'b']);
});

test('an unchanged poll does not call onChange', async () => {
  const { diffs, w } = setup({ order: ['a'], chapters: [ch('a')], issues: [] });
  await w.pollNow();
  await w.pollNow();
  assert.equal(diffs.length, 1);
});

test('a status or build hash change is reported as changed; a new folder as added; a vanished one as removed', async () => {
  const { box, diffs, w } = setup({ order: ['a', 'b'], chapters: [ch('a'), ch('b')], issues: [] });
  await w.pollNow();
  box.result = { order: ['a', 'c'], chapters: [ch('a', 'stale'), ch('c')], issues: [] };
  await w.pollNow();
  assert.deepEqual(diffs[1].changed.map((c) => c.id), ['a']);
  assert.deepEqual(diffs[1].added.map((c) => c.id), ['c']);
  assert.deepEqual(diffs[1].removed, ['b']);
  box.result = { order: ['a', 'c'], chapters: [ch('a', 'stale', 'bbb'), ch('c')], issues: [] };
  await w.pollNow();
  assert.deepEqual(diffs[2].changed.map((c) => c.id), ['a']);
});

test('a throwing scan is logged and the next poll still runs', async () => {
  const { box, diffs, errors, w } = setup(new Error('disk gone'));
  await w.pollNow();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /disk gone/);
  box.result = { order: ['a'], chapters: [ch('a')], issues: [] };
  await w.pollNow();
  assert.equal(diffs.length, 1);
});

test('a throwing or rejecting onChange is logged, and the same change is offered again next poll', async () => {
  let n = 0;
  const { diffs, errors, w } = setup({ order: ['a'], chapters: [ch('a')], issues: [] }, { onChange: () => { n++; if (n === 1) throw new Error('boom'); if (n === 2) return Promise.reject(new Error('later')); } });
  await w.pollNow();
  await w.pollNow();
  await w.pollNow();
  assert.equal(errors.length, 2);
  assert.equal(diffs.length, 3);
  await w.pollNow();
  assert.equal(diffs.length, 3);
});

test('polls never overlap: a tick during a slow onChange waits', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { diffs, timers, w } = setup({ order: ['a'], chapters: [ch('a')], issues: [] }, { onChange: () => gate });
  const first = w.pollNow();
  timers.fn();
  const second = w.pollNow();
  await new Promise((r) => setImmediate(r));
  assert.equal(diffs.length, 1);
  release();
  await first;
  await second;
  assert.equal(diffs.length, 1);
});

test('the timer is unref-ed, uses the interval, ticks poll, and stop() clears it and ends polling', async () => {
  const { diffs, timers, w } = setup({ order: ['a'], chapters: [ch('a')], issues: [] }, { opts: { intervalMs: 250 } });
  assert.equal(timers.ms, 250);
  assert.equal(timers.unrefed, true);
  timers.fn();
  await w.pollNow();
  assert.equal(diffs.length, 1);
  w.stop();
  assert.equal(timers.cleared, true);
  await w.pollNow();
  timers.fn();
  assert.equal(diffs.length, 1);
});

// ---- server wiring: the manifest follows the folders on disk ----
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('../server/server.cjs');
const { newManifest, insertChapter, saveManifest, loadManifest } = require('../lib/manifest.cjs');
const { sha256 } = require('../lib/build-record.cjs');

const BUILD = JSON.stringify({ version: 2, verified_against_commit: 'c'.repeat(40), sha256: {} });
const BUILD2 = JSON.stringify({ version: 2, verified_against_commit: 'd'.repeat(40), sha256: {} });

// Makes a temp slug folder named "demo" with a chapters folder.
function tempSlug(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-watch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  return slugDir;
}
// Writes a chapter folder; withVideo false leaves it unrendered (pending).
function makeChapter(slugDir, id, { build = BUILD, withVideo = true, duration = 3 } = {}) {
  const dir = path.join(slugDir, 'chapters', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify({ id, title: `Title ${id}` }));
  fs.writeFileSync(path.join(dir, 'beats.json'), JSON.stringify({ durationS: duration, beats: [] }));
  fs.writeFileSync(path.join(dir, 'build.json'), build);
  if (withVideo) {
    fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(build) }));
    fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'MP4');
  }
  return dir;
}
// Starts a server with a fake exec (records calls, writes a tiny poster or fails) and a timer that never fires.
async function boot(t, slugDir, { failExec = false, deps = {} } = {}) {
  const calls = [];
  const events = [];
  const errors = [];
  const exec = async (file, args) => { calls.push({ file, args }); if (failExec) throw new Error('no frames'); fs.writeFileSync(args[args.length - 1], 'JPEG'); };
  const srv = await startServer({ slugDir, deps: { exec, ffmpeg: 'fake-ffmpeg', logError: (e) => errors.push(e), setInterval: () => ({ unref() {} }), clearInterval() {}, ...deps } });
  t.after(() => srv.close());
  const real = srv.state.hub.broadcast;
  srv.state.hub.broadcast = (event, data) => { events.push({ event, data }); return real(event, data); };
  return { srv, calls, events, errors };
}
const rowsOf = (slugDir) => loadManifest(path.join(slugDir, 'manifest.json')).chapters;
const rowOf = (slugDir, id) => rowsOf(slugDir).find((c) => c.id === id);
// GET with the session key.
const api = (srv, p) => fetch(`http://127.0.0.1:${srv.port}${p}`, { headers: { 'x-yap-key': srv.key } });

test('chapters on disk are in the manifest when startServer resolves, in order.json order, with the fixed row shape', async (t) => {
  const slugDir = tempSlug(t);
  for (const id of ['alpha', 'beta', 'gamma']) makeChapter(slugDir, id);
  makeChapter(slugDir, 'delta', { withVideo: false });
  fs.writeFileSync(path.join(slugDir, 'order.json'), JSON.stringify({ chapters: ['gamma', 'ghost', 'alpha'] }));
  const { srv } = await boot(t, slugDir);
  assert.deepEqual(rowsOf(slugDir).map((c) => c.id), ['gamma', 'alpha', 'beta', 'delta']);
  const { poster, ...rest } = rowOf(slugDir, 'gamma');
  assert.deepEqual(rest, {
    id: 'gamma', title: 'Title gamma', parent_id: null, placement_reason: 'core', status: 'ready', quality: 'draft', duration_s: 3,
    video: 'chapters/gamma/chapter.mp4', captions: 'chapters/gamma/captions.vtt', question: null, build_sha256: sha256(BUILD), verified_against_commit: 'c'.repeat(40),
  });
  assert.equal(rowOf(slugDir, 'delta').status, 'pending');
  const state = await (await api(srv, '/api/state')).json();
  assert.equal(state.manifest.chapters.length, 4);
});

test('a ready chapter gets a poster after the ready flip, with argv paths, and a chapter event announces it', async (t) => {
  const slugDir = tempSlug(t);
  makeChapter(slugDir, 'intro');
  const { srv, calls, events } = await boot(t, slugDir);
  assert.equal(rowOf(slugDir, 'intro').status, 'ready');
  await srv.state.posterIdle();
  assert.equal(calls.length, 1);
  const dir = path.join(slugDir, 'chapters', 'intro');
  assert.equal(calls[0].file, 'fake-ffmpeg');
  assert.deepEqual(calls[0].args.slice(0, 5), ['-nostdin', '-y', '-ss', '1', '-i']);
  assert.equal(calls[0].args[5], path.join(dir, 'chapter.mp4'));
  assert.equal(rowOf(slugDir, 'intro').poster, 'chapters/intro/poster.jpg');
  assert.equal(fs.readFileSync(path.join(dir, 'poster.jpg'), 'utf8'), 'JPEG');
  const last = events.filter((e) => e.event === 'chapter').pop();
  assert.equal(last.data.op, 'scan');
  assert.equal(last.data.id, 'intro');
  assert.equal(last.data.manifest.chapters[0].poster, 'chapters/intro/poster.jpg');
});

test('a chapter shorter than 2 s takes its poster from the middle', async (t) => {
  const slugDir = tempSlug(t);
  makeChapter(slugDir, 'tiny', { duration: 1.5 });
  const { srv, calls } = await boot(t, slugDir);
  await srv.state.posterIdle();
  assert.equal(calls[0].args[3], '0.75');
});

test('a failing ffmpeg leaves poster null, logs, and the chapter stays ready', async (t) => {
  const slugDir = tempSlug(t);
  makeChapter(slugDir, 'intro');
  const { srv, errors } = await boot(t, slugDir, { failExec: true });
  await srv.state.posterIdle();
  const row = rowOf(slugDir, 'intro');
  assert.equal(row.status, 'ready');
  assert.equal(row.poster, null);
  assert.ok(errors.some((e) => /no frames/.test(e.message)));
  assert.equal(fs.existsSync(path.join(slugDir, 'chapters', 'intro', 'poster.jpg')), false);
});

test('a new ready chapter appears on the next poll and a chapter event is broadcast', async (t) => {
  const slugDir = tempSlug(t);
  makeChapter(slugDir, 'one');
  const { srv, events } = await boot(t, slugDir);
  await srv.state.posterIdle();
  events.length = 0;
  makeChapter(slugDir, 'two');
  await srv.state.watcher.pollNow();
  assert.deepEqual(rowsOf(slugDir).map((c) => c.id), ['one', 'two']);
  assert.equal(events[0].event, 'chapter');
  assert.equal(events[0].data.op, 'scan');
  assert.equal(events[0].data.manifest.chapters.length, 2);
});

test('the watcher never reorders: a new folder goes after the nearest earlier id in the manifest, else front if listed, else end', async (t) => {
  const slugDir = tempSlug(t);
  let m = newManifest({ title: 'Demo', slug: 'demo', audience: 'beginner' });
  m = insertChapter(m, { id: 'zed', title: 'Zed' });
  m = insertChapter(m, { id: 'bee', title: 'Bee' });
  saveManifest(path.join(slugDir, 'manifest.json'), m);
  makeChapter(slugDir, 'zed', { withVideo: false });
  makeChapter(slugDir, 'bee', { withVideo: false });
  fs.writeFileSync(path.join(slugDir, 'order.json'), JSON.stringify({ chapters: ['first', 'bee', 'mid', 'zed'] }));
  makeChapter(slugDir, 'first', { withVideo: false });
  makeChapter(slugDir, 'mid', { withVideo: false });
  makeChapter(slugDir, 'unlisted', { withVideo: false });
  const { srv } = await boot(t, slugDir);
  // zed, bee stay as the manifest had them; first is listed with nothing before it; mid follows bee; unlisted (after zed in folder order) follows zed
  assert.deepEqual(rowsOf(slugDir).map((c) => c.id), ['first', 'zed', 'unlisted', 'bee', 'mid']);
  assert.ok(srv.state.watcher);
});

test('deleting chapter.mp4 turns the row pending; the video is a 404 before the poll runs', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  const { srv } = await boot(t, slugDir);
  await srv.state.posterIdle();
  assert.equal((await api(srv, '/chapters/intro/video')).status, 200);
  fs.rmSync(path.join(dir, 'chapter.mp4'));
  assert.equal((await api(srv, '/chapters/intro/video')).status, 404);
  assert.equal(rowOf(slugDir, 'intro').status, 'ready');
  await srv.state.watcher.pollNow();
  assert.equal(rowOf(slugDir, 'intro').status, 'pending');
  assert.equal((await api(srv, '/chapters/intro/video')).status, 404);
  const state = await (await api(srv, '/api/state')).json();
  assert.equal(state.manifest.chapters[0].status, 'pending');
});

test('editing build.json turns the row stale (404 before the poll); re-rendering flips it back and re-takes the poster once', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  const { srv, calls } = await boot(t, slugDir);
  await srv.state.posterIdle();
  assert.equal(calls.length, 1);
  fs.writeFileSync(path.join(dir, 'build.json'), BUILD2);
  assert.equal((await api(srv, '/chapters/intro/video')).status, 404);
  await srv.state.watcher.pollNow();
  assert.equal(rowOf(slugDir, 'intro').status, 'stale');
  assert.equal(rowOf(slugDir, 'intro').build_sha256, sha256(BUILD2));
  assert.equal((await api(srv, '/chapters/intro/video')).status, 404);
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(BUILD2) }));
  await srv.state.watcher.pollNow();
  await srv.state.posterIdle();
  assert.equal(rowOf(slugDir, 'intro').status, 'ready');
  assert.equal(calls.length, 2);
  assert.equal((await api(srv, '/chapters/intro/video')).status, 200);
  // a chapter that leaves ready loses its poster, so coming back ready (even with the same build) takes a fresh frame
  fs.rmSync(path.join(dir, 'chapter.mp4'));
  await srv.state.watcher.pollNow();
  fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'MP4');
  await srv.state.watcher.pollNow();
  await srv.state.posterIdle();
  assert.equal(rowOf(slugDir, 'intro').status, 'ready');
  assert.equal(calls.length, 3);
});

test('a folder that disappears marks its row failed with the reason in the event; rows never scaffolded are left alone', async (t) => {
  const slugDir = tempSlug(t);
  let m = newManifest({ title: 'Demo', slug: 'demo', audience: 'beginner' });
  m = insertChapter(m, { id: 'planned', title: 'Planned', status: 'pending' });
  saveManifest(path.join(slugDir, 'manifest.json'), m);
  makeChapter(slugDir, 'intro');
  const { srv, events } = await boot(t, slugDir);
  await srv.state.posterIdle();
  events.length = 0;
  fs.rmSync(path.join(slugDir, 'chapters', 'intro'), { recursive: true });
  await srv.state.watcher.pollNow();
  assert.equal(rowOf(slugDir, 'intro').status, 'failed');
  assert.equal(rowOf(slugDir, 'planned').status, 'pending');
  assert.equal(rowsOf(slugDir).length, 2);
  const withReason = events.find((e) => e.data.reason);
  assert.equal(withReason.data.reason, 'chapter folder is missing');
  assert.equal(withReason.data.id, 'intro');
  assert.equal(withReason.data.op, 'scan');
});

test('a row failed through the API stays failed while the folder is only pending', async (t) => {
  const slugDir = tempSlug(t);
  makeChapter(slugDir, 'intro', { withVideo: false });
  const { srv } = await boot(t, slugDir);
  await srv.state.updateManifest((m) => ({ ...m, chapters: m.chapters.map((c) => ({ ...c, status: 'failed' })) }));
  makeChapter(slugDir, 'intro', { withVideo: false, build: BUILD2 });
  await srv.state.watcher.pollNow();
  assert.equal(rowOf(slugDir, 'intro').status, 'failed');
});

test('close() stops the watcher', async (t) => {
  const slugDir = tempSlug(t);
  let cleared = 0;
  const { srv } = await boot(t, slugDir, { deps: { clearInterval: () => { cleared++; } } });
  await srv.close();
  assert.equal(cleared, 1);
});

// ---- fix round 1: posters follow the current build; close waits for poster work ----
// A fake exec whose calls can be held: a call for chapter `id` waits for gates[id]() to be released or for its abort signal.
function gatedExec() {
  const g = { calls: [], gates: {}, aborted: [], n: 0 };
  g.hold = (id) => { let release; const p = new Promise((r) => { release = r; }); g.gates[id] = { p, release }; };
  g.exec = async (file, args, opts = {}) => {
    const tmp = args[args.length - 1];
    const id = path.basename(path.dirname(tmp));
    g.calls.push({ id, args });
    fs.writeFileSync(tmp, `JPEG-${++g.n}`);
    const gate = g.gates[id];
    if (!gate) return;
    delete g.gates[id];
    await new Promise((resolve, reject) => {
      gate.p.then(resolve);
      if (opts.signal) opts.signal.addEventListener('abort', () => { g.aborted.push(id); reject(new Error('aborted')); });
    });
  };
  return g;
}
const callsFor = (g, id) => g.calls.filter((c) => c.id === id).length;
const tick = () => new Promise((r) => setImmediate(r));

test('I1: ready A with poster -> edit to B (stale) -> restart -> re-render B takes a new frame, set by the new extraction', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  const g = gatedExec();
  const first = await startServer({ slugDir, deps: { exec: g.exec, ffmpeg: 'f', logError() {}, setInterval: () => ({ unref() {} }), clearInterval() {} } });
  await first.state.posterIdle();
  assert.equal(rowOf(slugDir, 'intro').poster, 'chapters/intro/poster.jpg');
  assert.equal(fs.readFileSync(path.join(dir, 'poster.jpg'), 'utf8'), 'JPEG-1');
  fs.writeFileSync(path.join(dir, 'build.json'), BUILD2);
  await first.state.watcher.pollNow();
  assert.equal(rowOf(slugDir, 'intro').status, 'stale');
  assert.equal(rowOf(slugDir, 'intro').poster, null);
  await first.close();
  const second = await startServer({ slugDir, deps: { exec: g.exec, ffmpeg: 'f', logError() {}, setInterval: () => ({ unref() {} }), clearInterval() {} } });
  t.after(() => second.close());
  assert.equal(g.calls.length, 1);
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(BUILD2) }));
  await second.state.watcher.pollNow();
  await second.state.posterIdle();
  assert.equal(g.calls.length, 2);
  assert.equal(rowOf(slugDir, 'intro').status, 'ready');
  assert.equal(rowOf(slugDir, 'intro').poster, 'chapters/intro/poster.jpg');
  assert.equal(fs.readFileSync(path.join(dir, 'poster.jpg'), 'utf8'), 'JPEG-2');
});

test('I1: a chapter whose folder vanishes loses its poster; the same build returning gets a new extraction', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  const g = gatedExec();
  const { srv } = await boot(t, slugDir, { deps: { exec: g.exec } });
  await srv.state.posterIdle();
  const saved = fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f))]);
  fs.rmSync(dir, { recursive: true });
  await srv.state.watcher.pollNow();
  assert.equal(rowOf(slugDir, 'intro').poster, null);
  fs.mkdirSync(dir);
  for (const [f, b] of saved) if (f !== 'poster.jpg') fs.writeFileSync(path.join(dir, f), b);
  await srv.state.watcher.pollNow();
  await srv.state.posterIdle();
  assert.equal(rowOf(slugDir, 'intro').status, 'ready');
  assert.equal(g.calls.length, 2);
  assert.equal(rowOf(slugDir, 'intro').poster, 'chapters/intro/poster.jpg');
});

test('I2: close() aborts a pending extraction, waits for it, writes nothing and broadcasts nothing afterwards, removes the temp file', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  makeChapter(slugDir, 'second');
  const g = gatedExec();
  g.hold('intro');
  const { srv, events } = await boot(t, slugDir, { deps: { exec: g.exec } });
  await tick();
  assert.equal(callsFor(g, 'intro'), 1);
  assert.deepEqual(g.aborted, []);
  await srv.close();
  assert.deepEqual(g.aborted, ['intro']);
  const manifestText = fs.readFileSync(path.join(slugDir, 'manifest.json'), 'utf8');
  const seen = events.length;
  await tick(); await tick();
  assert.equal(fs.readFileSync(path.join(slugDir, 'manifest.json'), 'utf8'), manifestText);
  assert.equal(events.length, seen);
  assert.equal(callsFor(g, 'second'), 0, 'queued jobs never start after close');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
  assert.equal(rowOf(slugDir, 'intro').poster, null);
});

test('I2: an exec that ignores the abort and finishes late still writes no poster and no manifest change', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  let release;
  const held = new Promise((r) => { release = r; });
  const exec = async (f, args) => { fs.writeFileSync(args[args.length - 1], 'LATE'); await held; };
  const { srv } = await boot(t, slugDir, { deps: { exec } });
  await tick();
  const closing = srv.close();
  await tick();
  release();
  await closing;
  assert.equal(fs.existsSync(path.join(dir, 'poster.jpg')), false);
  assert.equal(rowOf(slugDir, 'intro').poster, null);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
});

test('I3a: a re-render (A -> B) during A\'s extraction discards A\'s frame; exactly one extraction runs for B and its frame is the poster', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  const g = gatedExec();
  g.hold('intro');
  const gateA = g.gates.intro;
  const { srv } = await boot(t, slugDir, { deps: { exec: g.exec } });
  await tick();
  fs.writeFileSync(path.join(dir, 'build.json'), BUILD2);
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(BUILD2) }));
  await srv.state.watcher.pollNow();
  g.hold('intro');
  const gateB = g.gates.intro;
  gateA.release();
  await tick(); await tick();
  // A's frame is finished but the build moved on: it must not be published while B is still being taken
  assert.equal(fs.existsSync(path.join(dir, 'poster.jpg')), false);
  assert.equal(rowOf(slugDir, 'intro').poster, null);
  gateB.release();
  await srv.state.posterIdle();
  assert.equal(callsFor(g, 'intro'), 2);
  assert.equal(rowOf(slugDir, 'intro').poster, 'chapters/intro/poster.jpg');
  assert.equal(fs.readFileSync(path.join(dir, 'poster.jpg'), 'utf8'), 'JPEG-2');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
});

test('I3b: polls that report the same ready build while its extraction is pending queue exactly one extraction', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  const g = gatedExec();
  g.hold('intro');
  const gateA = g.gates.intro;
  const { srv } = await boot(t, slugDir, { deps: { exec: g.exec } });
  await tick();
  fs.renameSync(path.join(dir, 'chapter.mp4'), path.join(dir, 'away.mp4'));
  await srv.state.watcher.pollNow();
  fs.renameSync(path.join(dir, 'away.mp4'), path.join(dir, 'chapter.mp4'));
  await srv.state.watcher.pollNow();
  assert.equal(rowOf(slugDir, 'intro').status, 'ready');
  gateA.release();
  await srv.state.posterIdle();
  assert.equal(callsFor(g, 'intro'), 1);
  assert.equal(rowOf(slugDir, 'intro').poster, 'chapters/intro/poster.jpg');
});

test('I3c: an old job whose pre-check fails does not clear the marker of the newer build, so no duplicate extraction', async (t) => {
  const slugDir = tempSlug(t);
  makeChapter(slugDir, 'aaa');
  makeChapter(slugDir, 'bbb');
  const dirB = path.join(slugDir, 'chapters', 'bbb');
  const g = gatedExec();
  g.hold('aaa');
  const gateFirst = g.gates.aaa;
  const { srv } = await boot(t, slugDir, { deps: { exec: g.exec } });
  await tick();
  // aaa is in flight; bbb (build A) waits behind it. Rebuild bbb to B: its old job will fail its pre-check.
  fs.writeFileSync(path.join(dirB, 'build.json'), BUILD2);
  fs.writeFileSync(path.join(dirB, 'render.json'), JSON.stringify({ build_sha256: sha256(BUILD2) }));
  await srv.state.watcher.pollNow();
  g.hold('bbb');
  const gateB = g.gates.bbb;
  // aaa finishes: the old bbb job fails its pre-check, then the new one starts and is held in flight
  gateFirst.release();
  await tick(); await tick();
  assert.equal(callsFor(g, 'bbb'), 1);
  // flip away and back with the same build B while its extraction is running
  fs.renameSync(path.join(dirB, 'chapter.mp4'), path.join(dirB, 'away.mp4'));
  await srv.state.watcher.pollNow();
  fs.renameSync(path.join(dirB, 'away.mp4'), path.join(dirB, 'chapter.mp4'));
  await srv.state.watcher.pollNow();
  gateB.release();
  await srv.state.posterIdle();
  assert.equal(callsFor(g, 'bbb'), 1);
  assert.equal(rowOf(slugDir, 'bbb').poster, 'chapters/bbb/poster.jpg');
});

test('a row failed because its folder vanished recovers to the scan status when the folder returns', async (t) => {
  for (const kind of ['ready', 'stale', 'rendering']) {
    const slugDir = tempSlug(t);
    const dir = makeChapter(slugDir, 'intro');
    const { srv } = await boot(t, slugDir);
    await srv.state.posterIdle();
    fs.rmSync(dir, { recursive: true });
    await srv.state.watcher.pollNow();
    assert.equal(rowOf(slugDir, 'intro').status, 'failed');
    if (kind === 'ready') makeChapter(slugDir, 'intro');
    if (kind === 'stale') { makeChapter(slugDir, 'intro'); fs.writeFileSync(path.join(dir, 'build.json'), BUILD2); }
    if (kind === 'rendering') { makeChapter(slugDir, 'intro', { withVideo: false }); fs.mkdirSync(path.join(dir, 'work-1')); }
    await srv.state.watcher.pollNow();
    await srv.state.posterIdle();
    assert.equal(rowOf(slugDir, 'intro').status, kind);
    await srv.close();
  }
});

// ---- fix round 2: a chapter that is not ready never keeps a poster ----
const http = require('node:http');
const net = require('node:net');
// One API call with the session key; JSON body optional. Returns {status, json}.
function call(srv, method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = { host: `127.0.0.1:${srv.port}`, 'x-yap-key': srv.key };
    if (payload !== undefined) headers['content-type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: url, agent: false, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : undefined }));
    });
    r.on('error', reject);
    r.end(payload);
  });
}
const setStatus = (srv, id, status) => call(srv, 'POST', '/api/chapters', { op: 'set', id, fields: { status } });

test('N1: ready A with poster -> API sets failed -> poster cleared -> build B re-rendered -> a new frame is taken', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  const g = gatedExec();
  const { srv } = await boot(t, slugDir, { deps: { exec: g.exec } });
  await srv.state.posterIdle();
  assert.equal(rowOf(slugDir, 'intro').poster, 'chapters/intro/poster.jpg');
  assert.equal((await setStatus(srv, 'intro', 'failed')).status, 200);
  const state = (await call(srv, 'GET', '/api/state')).json;
  assert.equal(state.manifest.chapters[0].poster, null);
  fs.writeFileSync(path.join(dir, 'build.json'), BUILD2);
  await srv.state.watcher.pollNow();
  assert.equal(rowOf(slugDir, 'intro').status, 'stale');
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(BUILD2) }));
  await srv.state.watcher.pollNow();
  await srv.state.posterIdle();
  assert.equal(rowOf(slugDir, 'intro').status, 'ready');
  assert.equal(g.calls.length, 2);
  assert.equal(rowOf(slugDir, 'intro').poster, 'chapters/intro/poster.jpg');
  assert.equal(fs.readFileSync(path.join(dir, 'poster.jpg'), 'utf8'), 'JPEG-2');
});

test('N1: an API set to any non-ready status leaves no poster behind', async (t) => {
  for (const status of ['pending', 'rendering', 'stale', 'failed']) {
    const slugDir = tempSlug(t);
    makeChapter(slugDir, 'intro');
    const { srv } = await boot(t, slugDir);
    await srv.state.posterIdle();
    assert.equal(rowOf(slugDir, 'intro').poster, 'chapters/intro/poster.jpg');
    assert.equal((await setStatus(srv, 'intro', status)).status, 200);
    assert.equal(rowOf(slugDir, 'intro').poster, null, status);
    await srv.close();
  }
});

test('N1: adding a chapter, reordering and renaming leave a ready row\'s poster alone', async (t) => {
  const slugDir = tempSlug(t);
  makeChapter(slugDir, 'intro');
  const { srv } = await boot(t, slugDir);
  await srv.state.posterIdle();
  assert.equal((await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'extra', title: 'Extra' })).status, 200);
  assert.equal((await call(srv, 'POST', '/api/chapters', { op: 'reorder', ids: ['extra', 'intro'] })).status, 200);
  assert.equal((await call(srv, 'POST', '/api/chapters', { op: 'set', id: 'intro', fields: { title: 'New name' } })).status, 200);
  assert.equal(rowOf(slugDir, 'intro').poster, 'chapters/intro/poster.jpg');
  assert.equal(rowOf(slugDir, 'extra').poster, null);
});

test('N3: the poster route is 404 while the row has no poster even if the file exists, and 200 once an extraction sets it', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  fs.writeFileSync(path.join(dir, 'poster.jpg'), 'OLDFRAME');
  let fail = true;
  const exec = async (f, args) => { if (fail) throw new Error('no frames'); fs.writeFileSync(args[args.length - 1], 'NEWFRAME'); };
  const { srv } = await boot(t, slugDir, { deps: { exec } });
  await srv.state.posterIdle();
  assert.equal(rowOf(slugDir, 'intro').poster, null);
  const get = (p) => fetch(`http://127.0.0.1:${srv.port}${p}`, { headers: { 'x-yap-key': srv.key } });
  assert.equal((await get('/chapters/intro/poster')).status, 404);
  fail = false;
  fs.writeFileSync(path.join(dir, 'build.json'), BUILD2);
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(BUILD2) }));
  await srv.state.watcher.pollNow();
  await srv.state.posterIdle();
  const r = await get('/chapters/intro/poster');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'NEWFRAME');
});

test('N2: close() stops waiting for a stuck extraction after the bound; the port is free and nothing is written afterwards', async (t) => {
  const slugDir = tempSlug(t);
  const dir = makeChapter(slugDir, 'intro');
  let release;
  const stuck = new Promise((r) => { release = r; });
  const exec = async (f, args) => { fs.writeFileSync(args[args.length - 1], 'LATE'); await stuck; };
  const { srv, events } = await boot(t, slugDir, { deps: { exec, posterWaitMs: 30 } });
  await tick();
  await srv.close();
  const port = srv.port;
  await new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); reject(new Error('port still open')); });
    s.on('error', resolve);
  });
  const text = fs.readFileSync(path.join(slugDir, 'manifest.json'), 'utf8');
  const seen = events.length;
  release();
  await tick(); await tick();
  assert.equal(fs.readFileSync(path.join(slugDir, 'manifest.json'), 'utf8'), text);
  assert.equal(events.length, seen);
  assert.equal(fs.existsSync(path.join(dir, 'poster.jpg')), false);
});
