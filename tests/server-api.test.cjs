'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startServer } = require('../server/server.cjs');
const { newManifest, insertChapter, saveManifest, loadManifest, validateManifest } = require('../lib/manifest.mts');
const { sha256 } = require('../lib/build-record.mts');

// Makes a temp slug folder (named "demo"), writes a manifest with the given [id, status] rows, starts a server.
async function setup(t, rows = [], deps = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-api-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(slugDir, { recursive: true });
  let m = newManifest({ title: 'Demo', slug: 'demo', audience: 'beginner' });
  for (const [id, status] of rows) m = insertChapter(m, { id, title: id, status });
  saveManifest(path.join(slugDir, 'manifest.json'), m);
  const srv = await startServer({ slugDir, deps: { logError: () => {}, ...deps } });
  t.after(() => srv.close());
  return { srv, slugDir, root, manifestFile: path.join(slugDir, 'manifest.json') };
}
// One request; JSON body by default. `raw` sends the string as is. Returns {status, json, text}.
function call(srv, method, url, body, { raw, type = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
    const headers = { host: `127.0.0.1:${srv.port}`, 'x-yap-key': srv.key };
    if (payload !== undefined) headers['content-type'] = type;
    const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: url, agent: false, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, json, text }); });
    });
    r.on('error', reject);
    r.end(payload);
  });
}
const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
// A body that must be an error: right status, a one-line message, no stack or path in it.
function assertCleanError(r, status, root) {
  assert.equal(r.status, status, r.text);
  assert.equal(typeof r.json.error, 'string');
  assert.ok(!r.json.error.includes('\n'));
  assert.ok(!r.text.includes(root) && !r.text.includes('    at '), `leaked: ${r.text}`);
}

test('GET /api/state: manifest, thread, claude_connected false, now; no absolute path anywhere', async (t) => {
  const { srv, root } = await setup(t, [['intro', 'pending']]);
  const r = await call(srv, 'GET', '/api/state');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['claude_connected', 'manifest', 'now', 'thread']);
  assert.equal(r.json.manifest.chapters[0].id, 'intro');
  assert.deepEqual(r.json.thread, []);
  assert.equal(r.json.claude_connected, false);
  assert.equal(typeof r.json.now, 'number');
  assert.ok(!r.text.includes(root));
  assert.ok(!/"\/(Users|private|tmp|var|home)/.test(r.text));
});

test('POST /api/message appends exactly one line and returns the event; state shows it as a viewer message', async (t) => {
  const { srv, slugDir } = await setup(t);
  const file = path.join(slugDir, 'state', 'events.jsonl');
  const r = await call(srv, 'POST', '/api/message', { type: 'message', text: 'why?', context: { chapter_id: 'intro', t: 1.5 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.event.id, 'evt_1');
  assert.equal(lines(file).length, 1);
  assert.deepEqual(JSON.parse(lines(file)[0]), r.json.event);
  const s = (await call(srv, 'GET', '/api/state')).json;
  assert.equal(s.thread.length, 1);
  assert.equal(s.thread[0].role, 'viewer');
  assert.equal(s.thread[0].text, 'why?');
  assert.equal((await call(srv, 'POST', '/api/message', { type: 'make_video' })).status, 200);
  assert.equal((await call(srv, 'GET', '/api/state')).json.thread.length, 1, 'button events are not shown in the thread');
});

test('hostile message input: every case is a clean 4xx and nothing is stored', async (t) => {
  const { srv, slugDir, root } = await setup(t);
  const file = path.join(slugDir, 'state', 'events.jsonl');
  assertCleanError(await call(srv, 'POST', '/api/message', undefined, { raw: '{not json' }), 400, root);
  assertCleanError(await call(srv, 'POST', '/api/message', undefined, { raw: JSON.stringify({ type: 'message', text: 'x'.repeat(100000) }) }), 413, root);
  assertCleanError(await call(srv, 'POST', '/api/message', undefined, { raw: 'x', type: 'text/plain' }), 415, root);
  assertCleanError(await call(srv, 'POST', '/api/message', { type: 'message', text: 'a\0b' }), 400, root);
  assertCleanError(await call(srv, 'POST', '/api/message', { type: 'dance' }), 400, root);
  assertCleanError(await call(srv, 'POST', '/api/message', { type: 'message' }), 400, root);
  assertCleanError(await call(srv, 'POST', '/api/message', { type: 'message', text: 'hi', context: { chapter_id: '../x', t: 1 } }), 400, root);
  // 4000 euro signs is under the 4000-character cap but over the 8 KB line cap.
  assertCleanError(await call(srv, 'POST', '/api/message', { type: 'message', text: '€'.repeat(4000) }), 400, root);
  assert.equal(lines(file).length, 0);
});

test('a partial last line in events.jsonl and a hand-edited thread file do not break state or new messages', async (t) => {
  const { srv, slugDir } = await setup(t, [], { now: () => Date.parse('2026-10-03T11:00:00.000Z') });
  const dir = path.join(slugDir, 'state');
  fs.mkdirSync(dir, { recursive: true });
  const evt1 = { id: 'evt_1', ts: '2026-10-03T10:00:00.000Z', type: 'message', text: 'first' };
  fs.writeFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(evt1) + '\n{"id":"evt_2","ts":"2026');
  const rep1 = { id: 'rep_1', ts: '2026-10-03T10:00:05.000Z', in_reply_to: 'evt_1', text: 'answer' };
  fs.writeFileSync(path.join(dir, 'thread.jsonl'), `garbage\n[1]\n{"id":"rep_x"}\n${JSON.stringify(rep1)}\n`);
  const s = await call(srv, 'GET', '/api/state');
  assert.equal(s.status, 200);
  assert.deepEqual(s.json.thread.map((e) => [e.id, e.role]), [['evt_1', 'viewer'], ['rep_1', 'claude']]);
  const m = await call(srv, 'POST', '/api/message', { type: 'message', text: 'second' });
  assert.equal(m.status, 200);
  assert.equal(m.json.event.id, 'evt_2');
  const after = (await call(srv, 'GET', '/api/state')).json.thread;
  assert.deepEqual(after.map((e) => e.id), ['evt_1', 'rep_1', 'evt_2']);
});

test('thread is ordered by time, events first on a tie', async (t) => {
  const { srv, slugDir } = await setup(t);
  const dir = path.join(slugDir, 'state');
  fs.mkdirSync(dir, { recursive: true });
  const e = (n, ts) => JSON.stringify({ id: `evt_${n}`, ts, type: 'message', text: `m${n}` });
  const r = (n, ts) => JSON.stringify({ id: `rep_${n}`, ts, in_reply_to: 'evt_1', text: `r${n}` });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [e(1, '2026-10-03T10:00:00.000Z'), e(2, '2026-10-03T10:00:09.000Z')].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'thread.jsonl'), [r(1, '2026-10-03T10:00:09.000Z'), r(2, '2026-10-03T10:00:03.000Z')].join('\n') + '\n');
  const ids = (await call(srv, 'GET', '/api/state')).json.thread.map((x) => x.id);
  assert.deepEqual(ids, ['evt_1', 'rep_2', 'evt_2', 'rep_1']);
});

test('POST /api/reply: unknown event id 400; good reply is stored, returned and shown as claude', async (t) => {
  const { srv, slugDir, root } = await setup(t);
  assertCleanError(await call(srv, 'POST', '/api/reply', { in_reply_to: 'evt_9', text: 'hi' }), 400, root);
  const m = await call(srv, 'POST', '/api/message', { type: 'message', text: 'q' });
  assertCleanError(await call(srv, 'POST', '/api/reply', { in_reply_to: m.json.event.id, text: 'a', sources: [{ file: '/etc/passwd', lines: '1' }] }), 400, root);
  const r = await call(srv, 'POST', '/api/reply', { in_reply_to: m.json.event.id, text: 'a', sources: [{ file: 'src/x.js', lines: '3-4' }] });
  assert.equal(r.status, 200);
  assert.equal(r.json.reply.id, 'rep_1');
  assert.equal(lines(path.join(slugDir, 'state', 'thread.jsonl')).length, 1);
  const thread = (await call(srv, 'GET', '/api/state')).json.thread;
  assert.deepEqual(thread.map((x) => x.role), ['viewer', 'claude']);
  assert.deepEqual(thread[1].sources, [{ file: 'src/x.js', lines: '3-4' }]);
});

test('heartbeat: claude_connected false at start, true after a beat, false again after 15 s', async (t) => {
  let clock = 1_000_000;
  const { srv } = await setup(t, [], { now: () => clock });
  const connected = async () => (await call(srv, 'GET', '/api/state')).json.claude_connected;
  assert.equal(await connected(), false);
  assert.equal((await call(srv, 'POST', '/api/heartbeat', {})).status, 200);
  assert.equal(await connected(), true);
  clock += 14_999;
  assert.equal(await connected(), true);
  clock += 1;
  assert.equal(await connected(), false);
  await call(srv, 'POST', '/api/heartbeat', {});
  assert.equal(await connected(), true);
  assert.equal((await call(srv, 'POST', '/api/heartbeat', undefined, { raw: 'nope' })).status, 400);
});

test('chapters add: pending/draft defaults, position rules, duplicate 409, unknown after/parent 400', async (t) => {
  const { srv, root } = await setup(t, [['a', 'pending'], ['b', 'pending']]);
  const ids = (r) => r.json.manifest.chapters.map((c) => c.id);
  let r = await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'c', title: 'See' });
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r), ['a', 'b', 'c']);
  const row = r.json.manifest.chapters[2];
  assert.equal(row.status, 'pending');
  assert.equal(row.quality, 'draft');
  r = await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'd', after: 'a' });
  assert.deepEqual(ids(r), ['a', 'd', 'b', 'c']);
  r = await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'e', parent_id: 'b', placement_reason: 'detail', question: 'why?' });
  assert.deepEqual(ids(r), ['a', 'd', 'b', 'e', 'c']);
  assert.equal(r.json.manifest.chapters[3].parent_id, 'b');
  assertCleanError(await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'a' }), 409, root);
  assertCleanError(await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'f', after: 'zzz' }), 400, root);
  assertCleanError(await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'f', parent_id: 'zzz' }), 400, root);
  assertCleanError(await call(srv, 'POST', '/api/chapters', { op: 'add', id: '../evil' }), 400, root);
  assertCleanError(await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'g', status: 'ready' }), 400, root);
  assertCleanError(await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'g', question: 5 }), 400, root);
  assertCleanError(await call(srv, 'POST', '/api/chapters', { op: 'nope' }), 400, root);
  assertCleanError(await call(srv, 'POST', '/api/chapters', {}), 400, root);
  assert.deepEqual(loadManifest(path.join(root, 'demo', 'manifest.json')).chapters.map((c) => c.id), ['a', 'd', 'b', 'e', 'c']);
});

test('chapters reorder: a permutation works; anything else is 400 and the manifest is unchanged', async (t) => {
  const { srv, manifestFile, root } = await setup(t, [['a', 'pending'], ['b', 'pending'], ['c', 'pending']]);
  const r = await call(srv, 'POST', '/api/chapters', { op: 'reorder', ids: ['c', 'a', 'b'] });
  assert.deepEqual(r.json.manifest.chapters.map((c) => c.id), ['c', 'a', 'b']);
  const before = fs.readFileSync(manifestFile, 'utf8');
  for (const ids of [['a', 'b'], ['a', 'a', 'b'], ['a', 'b', 'x'], 'abc', [1, 2, 3]]) {
    assertCleanError(await call(srv, 'POST', '/api/chapters', { op: 'reorder', ids }), 400, root);
  }
  assert.equal(fs.readFileSync(manifestFile, 'utf8'), before);
});

test('chapters set: allowed fields only; unknown id 404; bad field or value 400', async (t) => {
  const { srv, root } = await setup(t, [['a', 'pending']]);
  const set = (id, fields) => call(srv, 'POST', '/api/chapters', { op: 'set', id, fields });
  const r = await set('a', { status: 'rendering', quality: 'full', title: 'New', placement_reason: 'why', question: null });
  assert.equal(r.status, 200);
  assert.deepEqual(
    (({ status, quality, title, placement_reason, question }) => ({ status, quality, title, placement_reason, question }))(r.json.manifest.chapters[0]),
    { status: 'rendering', quality: 'full', title: 'New', placement_reason: 'why', question: null },
  );
  assertCleanError(await set('nope', { title: 'x' }), 404, root);
  for (const fields of [{ video: 'x.mp4' }, { id: 'z' }, { duration_s: 4 }, { parent_id: null }, { status: 'weird' }, { quality: 'best' }, { title: '' }, { question: 7 }, {}, 'text', null]) {
    assertCleanError(await set('a', fields), 400, root);
  }
});

test('set status ready is refused (409) unless the files prove it right now', async (t) => {
  const { srv, slugDir, root } = await setup(t, [['a', 'pending']]);
  assertCleanError(await call(srv, 'POST', '/api/chapters', { op: 'set', id: 'a', fields: { status: 'ready' } }), 409, root);
  assert.equal(loadManifest(path.join(slugDir, 'manifest.json')).chapters[0].status, 'pending');
  const dir = path.join(slugDir, 'chapters', 'a');
  fs.mkdirSync(dir, { recursive: true });
  const build = JSON.stringify({ version: 2, verified_against_commit: 'a'.repeat(40), sha256: {} });
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify({ id: 'a', title: 'a' }));
  fs.writeFileSync(path.join(dir, 'beats.json'), JSON.stringify({ durationS: 3, beats: [] }));
  fs.writeFileSync(path.join(dir, 'build.json'), build);
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(build) }));
  fs.writeFileSync(path.join(dir, 'chapter.mp4'), 'mp4');
  const ok = await call(srv, 'POST', '/api/chapters', { op: 'set', id: 'a', fields: { status: 'ready' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.manifest.chapters[0].status, 'ready');
});

test('50 simultaneous chapter writes: valid manifest, every add exactly once, no temp files left', async (t) => {
  const seeded = Array.from({ length: 10 }, (_, i) => [`seed-${i}`, 'pending']);
  // beforeSave hands control back to the event loop between load and save, so without the queue jobs would overwrite each other.
  const yieldNow = () => new Promise((r) => setTimeout(r, Math.random() * 5));
  const { srv, slugDir, manifestFile } = await setup(t, seeded, { beforeSave: yieldNow });
  const jobs = [];
  for (let i = 0; i < 50; i++) {
    jobs.push(i % 2 === 0
      ? call(srv, 'POST', '/api/chapters', { op: 'add', id: `new-${i}`, title: `New ${i}` })
      : call(srv, 'POST', '/api/chapters', { op: 'set', id: `seed-${i % 10}`, fields: { title: `T${i}` } }));
  }
  const results = await Promise.all(jobs);
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.filter((r) => r.status !== 200)));
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(validateManifest(m).ok, true);
  const ids = m.chapters.map((c) => c.id);
  assert.equal(ids.length, 35);
  assert.equal(new Set(ids).size, 35);
  for (let i = 0; i < 50; i += 2) assert.ok(ids.includes(`new-${i}`));
  const leftovers = [...fs.readdirSync(slugDir), ...fs.readdirSync(path.join(slugDir, 'state'))].filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('a failed save keeps the old manifest, answers 500 without detail, and the next request still works', async (t) => {
  let failOnce = true;
  const logged = [];
  const fsLike = { ...fs, renameSync: (...a) => { if (failOnce) { failOnce = false; throw new Error('disk fell over'); } return fs.renameSync(...a); } };
  const { srv, slugDir, manifestFile, root } = await setup(t, [['a', 'pending']], { fs: fsLike, logError: (e) => logged.push(e) });
  const before = fs.readFileSync(manifestFile, 'utf8');
  const bad = await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'b' });
  assertCleanError(bad, 500, root);
  assert.ok(!bad.text.includes('disk fell over'));
  assert.equal(logged.length, 1);
  assert.equal(fs.readFileSync(manifestFile, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(slugDir).filter((n) => n.endsWith('.tmp')), []);
  const good = await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'b' });
  assert.equal(good.status, 200);
  assert.deepEqual(loadManifest(manifestFile).chapters.map((c) => c.id), ['a', 'b']);
});

test('state.updateManifest is one queue: a failing job does not break the next', async (t) => {
  const { srv, manifestFile } = await setup(t, [['a', 'pending']]);
  const order = [];
  const slow = srv.state.updateManifest(async (m) => { await new Promise((r) => setTimeout(r, 30)); order.push('slow'); return { ...m, title: 'Slow' }; });
  const bad = srv.state.updateManifest(() => { order.push('bad'); throw new Error('nope'); });
  const good = srv.state.updateManifest((m) => { order.push(`good saw ${m.title}`); return { ...m, title: 'Changed' }; });
  await assert.rejects(bad, /nope/);
  assert.equal((await good).title, 'Changed');
  await slow;
  assert.deepEqual(order, ['slow', 'bad', 'good saw Slow']);
  assert.equal(loadManifest(manifestFile).title, 'Changed');
});

// ---- fix round 1 ----

// Values of the wrong type that a hostile caller might send.
function deepArray(n) { let v = []; for (let i = 0; i < n; i++) v = [v]; return v; }
const HOSTILE = [{ toString: 1 }, { valueOf: 1, toString: 1 }, [1], deepArray(1000), 5, true, { constructor: {} }];

test('chapter ops: every wrong type is a 400, never a 500, and the manifest is not touched', async (t) => {
  const logged = [];
  const { srv, manifestFile, root } = await setup(t, [['a', 'pending'], ['b', 'pending']], { logError: (e) => logged.push(e) });
  const before = fs.readFileSync(manifestFile);
  const bodies = [];
  for (const h of HOSTILE) {
    for (const f of ['id', 'after', 'parent_id', 'title', 'placement_reason', 'question']) bodies.push({ op: 'add', id: 'new', [f]: h });
    bodies.push({ op: 'reorder', ids: h }, { op: 'reorder', ids: ['a', h] });
    bodies.push({ op: 'set', id: h, fields: { title: 'x' } }, { op: 'set', id: 'a', fields: h });
    for (const f of ['status', 'quality', 'title', 'placement_reason', 'question']) bodies.push({ op: 'set', id: 'a', fields: { [f]: h } });
    bodies.push({ op: h });
  }
  bodies.push({ op: 'add', id: 'new', after: null, title: 5 }, { op: 'set', id: 'a', fields: { status: null } });
  for (const b of bodies) assertCleanError(await call(srv, 'POST', '/api/chapters', b), 400, root);
  for (const raw of ['{"op":"add","id":"n","__proto__":{"x":1}}', '{"op":"add","id":"n","constructor":{}}', '{"op":"set","id":"a","fields":{"__proto__":{"x":1}}}', '{"op":"set","id":"a","fields":{"constructor":"x"}}']) {
    assertCleanError(await call(srv, 'POST', '/api/chapters', undefined, { raw }), 400, root);
  }
  assert.deepEqual(fs.readFileSync(manifestFile), before);
  assert.deepEqual(logged, []);
  // null is fine where the rule allows it
  assert.equal((await call(srv, 'POST', '/api/chapters', { op: 'add', id: 'ok', after: null, parent_id: null, placement_reason: null, question: null })).status, 200);
});

test('every error body from every route is one line', async (t) => {
  const { srv, root } = await setup(t, [['a', 'pending']]);
  const m = await call(srv, 'POST', '/api/message', { type: 'message', text: 'q' });
  const id = m.json.event.id;
  const cases = [
    ['/api/reply', { in_reply_to: 'evt\n9', text: 'x' }],
    ['/api/reply', { in_reply_to: id, text: 'x', sources: [{ file: '/abs\npath', lines: '1' }] }],
    ['/api/reply', { in_reply_to: id, text: 'x', sources: [{ file: 'a.js', lines: '1\n2' }] }],
    ['/api/reply', { in_reply_to: id, text: 'x', sources: [{ file: 'a.js', lines: '1\r\n2' }] }],
    ['/api/message', { type: 'bad\ntype' }],
    ['/api/message', { type: 'message', text: 'x', context: { chapter_id: 'a\nb', t: 1 } }],
    ['/api/chapters', { op: 'add', id: 'x', after: 'no\nsuch' }],
    ['/api/chapters', { op: 'set', id: 'no\nsuch', fields: { title: 'x' } }],
    ['/api/chapters', { op: 'set', id: 'a', fields: { 'bad\nfield': 1 } }],
    ['/api/chapters', { op: 'reorder', ids: ['x\ny'] }],
  ];
  for (const [url, body] of cases) {
    const r = await call(srv, 'POST', url, body);
    assert.ok(r.status === 400 || r.status === 404, `${url} ${JSON.stringify(body)} -> ${r.text}`);
    assert.ok(!/[\r\n]/.test(r.json.error), JSON.stringify(r.json.error));
    assertCleanError(r, r.status, root);
  }
});

test('a broken manifest after start: message and heartbeat are stored and still answer 200; the failure is logged', async (t) => {
  const logged = [];
  const { srv, slugDir, manifestFile } = await setup(t, [['a', 'pending']], { logError: (e) => logged.push(e) });
  fs.writeFileSync(manifestFile, '{ broken');
  const r = await call(srv, 'POST', '/api/message', { type: 'message', text: 'hello' });
  assert.equal(r.status, 200, r.text);
  assert.equal(lines(path.join(slugDir, 'state', 'events.jsonl')).length, 1);
  assert.ok(logged.length >= 1);
  const reply = await call(srv, 'POST', '/api/reply', { in_reply_to: r.json.event.id, text: 'ok' });
  assert.equal(reply.status, 200);
  const hb = await call(srv, 'POST', '/api/heartbeat', {});
  assert.equal(hb.status, 200);
  assert.equal(srv.state.lastHeartbeat !== null, true);
  assert.equal(lines(path.join(slugDir, 'state', 'thread.jsonl')).length, 1);
});
