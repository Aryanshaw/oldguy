'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { Readable } = require('node:stream');
const { fork } = require('node:child_process');
const { startServer } = require('../server/server.cjs');
const { newManifest, insertChapter, saveManifest } = require('../lib/manifest.cjs');
const { sha256 } = require('../lib/build-record.cjs');

const BYTES = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'); // 36 bytes

// Makes a temp slug folder (named "demo") and removes it when the test ends.
function tempSlug(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-media-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const slugDir = path.join(root, 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  return slugDir;
}
// Writes a chapter folder that passes the ready rule (mp4 + build.json + matching render.json) plus poster and captions.
function makeChapter(slugDir, id) {
  const dir = path.join(slugDir, 'chapters', id);
  fs.mkdirSync(dir, { recursive: true });
  const build = JSON.stringify({ version: 2, verified_against_commit: 'a'.repeat(40), sha256: {} });
  fs.writeFileSync(path.join(dir, 'chapter.json'), JSON.stringify({ id, title: id }));
  fs.writeFileSync(path.join(dir, 'beats.json'), JSON.stringify({ durationS: 3, beats: [] }));
  fs.writeFileSync(path.join(dir, 'build.json'), build);
  fs.writeFileSync(path.join(dir, 'render.json'), JSON.stringify({ build_sha256: sha256(build) }));
  fs.writeFileSync(path.join(dir, 'chapter.mp4'), BYTES);
  fs.writeFileSync(path.join(dir, 'poster.jpg'), 'JPEGDATA');
  fs.writeFileSync(path.join(dir, 'captions.vtt'), 'WEBVTT\n');
  return dir;
}
// Writes manifest.json with the given [id, status] rows, builds their folders, and starts a server.
function buildSlug(t, rows = [['intro', 'ready']]) {
  const slugDir = tempSlug(t);
  let m = newManifest({ title: 'Demo', slug: 'demo', audience: 'beginner' });
  for (const [id, status] of rows) { m = insertChapter(m, { id, title: id, status }); makeChapter(slugDir, id); }
  saveManifest(path.join(slugDir, 'manifest.json'), m);
  return slugDir;
}
// Same, then starts a server on it (deps are the server's injection points).
async function setup(t, rows = [['intro', 'ready']], deps = {}) {
  const slugDir = buildSlug(t, rows);
  const srv = await startServer({ slugDir, deps });
  t.after(() => srv.close());
  return { srv, slugDir };
}
// One plain HTTP request returning the body as a Buffer.
function get(srv, url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: url, agent: false, headers: { host: `127.0.0.1:${srv.port}`, 'x-yap-key': srv.key, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end();
  });
}
// Sends a raw request line over a socket so the path reaches the server exactly as written.
function raw(srv, target) {
  return new Promise((resolve) => {
    const s = net.connect(srv.port, '127.0.0.1');
    let d = '';
    s.on('data', (c) => { d += c; });
    s.on('close', () => resolve(d));
    s.on('error', () => resolve(d));
    s.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nx-yap-key: ${srv.key}\r\nConnection: close\r\n\r\n`);
  });
}

test('video without Range: 200, whole file, exact length, mp4 type, no-store', async (t) => {
  const { srv } = await setup(t);
  const r = await get(srv, '/chapters/intro/video');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, BYTES);
  assert.equal(r.headers['content-length'], String(BYTES.length));
  assert.equal(r.headers['accept-ranges'], 'bytes');
  assert.equal(r.headers['content-type'], 'video/mp4');
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('video ranges: open ended, from, suffix and middle give 206 with the exact slice', async (t) => {
  const { srv } = await setup(t);
  const n = BYTES.length;
  for (const [h, s, e] of [['bytes=0-', 0, n - 1], ['bytes=10-', 10, n - 1], ['bytes=-5', n - 5, n - 1], ['bytes=2-3', 2, 3], ['bytes=30-9999', 30, n - 1], ['bytes=-9999', 0, n - 1]]) {
    const r = await get(srv, '/chapters/intro/video', { headers: { range: h } });
    assert.equal(r.status, 206, h);
    assert.deepEqual(r.body, BYTES.subarray(s, e + 1), h);
    assert.equal(r.headers['content-range'], `bytes ${s}-${e}/${n}`, h);
    assert.equal(r.headers['content-length'], String(e - s + 1), h);
    assert.equal(r.headers['accept-ranges'], 'bytes');
  }
});

test('unsatisfiable range is 416 with bytes */size; bad and multi ranges get the whole file', async (t) => {
  const { srv } = await setup(t);
  for (const h of ['bytes=999999-', 'bytes=-0']) {
    const r = await get(srv, '/chapters/intro/video', { headers: { range: h } });
    assert.equal(r.status, 416, h);
    assert.equal(r.headers['content-range'], `bytes */${BYTES.length}`);
  }
  for (const h of ['bytes=abc', 'bytes=5-2', 'items=0-3', 'bytes=0-1,4-5']) {
    const r = await get(srv, '/chapters/intro/video', { headers: { range: h } });
    assert.equal(r.status, 200, h);
    assert.deepEqual(r.body, BYTES, h);
  }
});

test('zero-byte file: 200 length 0 without a range, 416 with one', async (t) => {
  const { srv, slugDir } = await setup(t);
  fs.writeFileSync(path.join(slugDir, 'chapters', 'intro', 'chapter.mp4'), '');
  const a = await get(srv, '/chapters/intro/video');
  assert.equal(a.status, 200);
  assert.equal(a.headers['content-length'], '0');
  const b = await get(srv, '/chapters/intro/video', { headers: { range: 'bytes=0-' } });
  assert.equal(b.status, 416);
  assert.equal(b.headers['content-range'], 'bytes */0');
});

test('HEAD on video: same headers, no body; HEAD on poster is not allowed', async (t) => {
  const { srv } = await setup(t);
  const r = await get(srv, '/chapters/intro/video', { method: 'HEAD', headers: { range: 'bytes=2-3' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-length'], '2');
  assert.equal(r.headers['content-range'], `bytes 2-3/${BYTES.length}`);
  assert.equal(r.body.length, 0);
  assert.equal((await get(srv, '/chapters/intro/poster', { method: 'HEAD' })).status, 405);
});

test('poster and captions: right type and bytes, and they do not need ready', async (t) => {
  const { srv } = await setup(t, [['draft', 'pending']]);
  const p = await get(srv, '/chapters/draft/poster');
  assert.equal(p.status, 200);
  assert.equal(p.headers['content-type'], 'image/jpeg');
  assert.equal(p.body.toString(), 'JPEGDATA');
  const c = await get(srv, '/chapters/draft/captions');
  assert.equal(c.status, 200);
  assert.equal(c.headers['content-type'], 'text/vtt; charset=utf-8');
  assert.equal(c.body.toString(), 'WEBVTT\n');
  assert.equal((await get(srv, '/chapters/draft/video')).status, 404, 'video needs ready');
});

test('video is 404 when the build changed after the manifest said ready', async (t) => {
  const { srv, slugDir } = await setup(t);
  fs.appendFileSync(path.join(slugDir, 'chapters', 'intro', 'build.json'), ' ');
  assert.equal((await get(srv, '/chapters/intro/video')).status, 404);
});

test('missing file is 404', async (t) => {
  const { srv, slugDir } = await setup(t);
  fs.rmSync(path.join(slugDir, 'chapters', 'intro', 'poster.jpg'));
  assert.equal((await get(srv, '/chapters/intro/poster')).status, 404);
});

test('a media file that is a link pointing outside the chapter is 404', async (t) => {
  const { srv, slugDir } = await setup(t);
  const outside = path.join(path.dirname(slugDir), 'secret.txt');
  fs.writeFileSync(outside, 'TOPSECRET');
  const dir = path.join(slugDir, 'chapters', 'intro');
  fs.rmSync(path.join(dir, 'poster.jpg'));
  fs.symlinkSync(outside, path.join(dir, 'poster.jpg'));
  const r = await get(srv, '/chapters/intro/poster');
  assert.equal(r.status, 404);
  assert.ok(!r.body.toString().includes('TOPSECRET'));
});

test('a chapter folder that is a link is 404', async (t) => {
  const { srv, slugDir } = await setup(t);
  const real = path.join(path.dirname(slugDir), 'elsewhere');
  fs.renameSync(path.join(slugDir, 'chapters', 'intro'), real);
  fs.symlinkSync(real, path.join(slugDir, 'chapters', 'intro'));
  assert.equal((await get(srv, '/chapters/intro/poster')).status, 404);
  assert.equal((await get(srv, '/chapters/intro/video')).status, 404);
});

test('hostile ids are 404 and nothing leaks the temp path', async (t) => {
  const { srv, slugDir } = await setup(t, [['intro', 'ready']]);
  const ids = ['../x', '%2e%2e', '..%2f..', '%2e%2e%2fintro', '..\\x', '%5Cx', '%00', 'intro%00', 'a'.repeat(5000), 'valid-but-unlisted', 'Intro', 'intro-'];
  for (const id of ids) {
    for (const leaf of ['video', 'poster', 'captions']) {
      const text = await raw(srv, `/chapters/${id}/${leaf}`);
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1]);
      assert.equal(status, 404, `${id}/${leaf} gave ${status}`);
      assert.ok(!text.includes(slugDir) && !text.includes(path.dirname(slugDir)), `path leaked for ${id}`);
    }
  }
  const miss = await get(srv, '/chapters/valid-but-unlisted/video');
  assert.deepEqual(JSON.parse(miss.body), { error: 'not found' });
});

test('a client that hangs up mid-video does not stop the server', async (t) => {
  const { srv, slugDir } = await setup(t);
  fs.writeFileSync(path.join(slugDir, 'chapters', 'intro', 'chapter.mp4'), Buffer.alloc(30 * 1024 * 1024, 1));
  await new Promise((resolve) => {
    const s = net.connect(srv.port, '127.0.0.1', () => {
      s.write(`GET /chapters/intro/video HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nx-yap-key: ${srv.key}\r\n\r\n`);
    });
    s.on('error', () => {});
    s.once('data', () => { s.destroy(); resolve(); });
  });
  const r = await get(srv, '/chapters/intro/poster');
  assert.equal(r.status, 200);
});

test('a read stream that fails after the headers ends the response and the server keeps answering', async (t) => {
  // Sends a few bytes then errors, like a file that shrank under the reader.
  // Only the first stream fails, so the follow-up request is served normally.
  let calls = 0;
  const failing = (...args) => {
    if (calls++ > 0) return fs.createReadStream(...args);
    let sent = false;
    return new Readable({
      read() {
        if (sent) return;
        sent = true;
        this.push(Buffer.from('abc'));
        setImmediate(() => this.destroy(new Error('boom')));
      },
    });
  };
  const { srv } = await setup(t, [['intro', 'ready']], { createReadStream: failing });
  const outcome = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: srv.port, path: '/chapters/intro/video', agent: false, headers: { host: `127.0.0.1:${srv.port}`, 'x-yap-key': srv.key } }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve('end'));
      res.on('error', () => resolve('error'));
      res.on('aborted', () => resolve('aborted'));
    });
    r.on('error', () => resolve('error'));
    r.setTimeout(3000, () => { r.destroy(); resolve('hang'); });
    r.end();
  });
  assert.notEqual(outcome, 'hang');
  const ok = await get(srv, '/chapters/intro/poster');
  assert.equal(ok.status, 200);
});

test('chapter.mp4 itself linked to a file outside the chapter is 404 on /video', async (t) => {
  const { srv, slugDir } = await setup(t);
  const outside = path.join(path.dirname(slugDir), 'secret.mp4');
  fs.writeFileSync(outside, 'TOPSECRET');
  const mp4 = path.join(slugDir, 'chapters', 'intro', 'chapter.mp4');
  fs.rmSync(mp4);
  fs.symlinkSync(outside, mp4);
  const r = await get(srv, '/chapters/intro/video');
  assert.equal(r.status, 404);
  assert.ok(!r.body.toString().includes('TOPSECRET'));
});

test('file swapped for a link between the check and the open is 404, secret not served', async (t) => {
  const mp4Of = (d) => path.join(d, 'chapters', 'intro', 'chapter.mp4');
  const holder = {};
  const { srv, slugDir } = await setup(t, [['intro', 'ready']], { afterCheck: () => holder.swap() });
  const outside = path.join(path.dirname(slugDir), 'secret.mp4');
  fs.writeFileSync(outside, 'TOPSECRET');
  holder.swap = () => { fs.rmSync(mp4Of(slugDir)); fs.symlinkSync(outside, mp4Of(slugDir)); };
  const r = await get(srv, '/chapters/intro/video');
  assert.equal(r.status, 404);
  assert.ok(!r.body.toString().includes('TOPSECRET'));
});

test('file replaced by a different regular file between the check and the open is 404', async (t) => {
  const holder = {};
  const { srv, slugDir } = await setup(t, [['intro', 'ready']], { afterCheck: () => holder.swap() });
  const mp4 = path.join(slugDir, 'chapters', 'intro', 'chapter.mp4');
  // The new file is written while the old one still exists, so it is certain to be a different file.
  holder.swap = () => { fs.writeFileSync(`${mp4}.new`, 'OTHER'); fs.renameSync(`${mp4}.new`, mp4); };
  const r = await get(srv, '/chapters/intro/video');
  assert.equal(r.status, 404);
  assert.ok(!r.body.toString().includes('OTHER'));
});

test('file deleted between the check and the open is 404, not 500', async (t) => {
  const holder = {};
  const { srv, slugDir } = await setup(t, [['intro', 'ready']], { afterCheck: () => holder.swap() });
  holder.swap = () => fs.rmSync(path.join(slugDir, 'chapters', 'intro', 'chapter.mp4'));
  const r = await get(srv, '/chapters/intro/video');
  assert.equal(r.status, 404);
  assert.deepEqual(JSON.parse(r.body), { error: 'not found' });
});

test('a file that really shrinks mid-response breaks the connection within a second and the server lives on', async (t) => {
  const { srv, slugDir } = await setup(t);
  const mp4 = path.join(slugDir, 'chapters', 'intro', 'chapter.mp4');
  fs.writeFileSync(mp4, Buffer.alloc(40 * 1024 * 1024, 7));
  const closed = await new Promise((resolve, reject) => {
    const s = net.connect(srv.port, '127.0.0.1', () => {
      s.write(`GET /chapters/intro/video HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nx-yap-key: ${srv.key}\r\nConnection: keep-alive\r\n\r\n`);
    });
    s.on('error', () => {});
    // Hold the client back after the first bytes so the server's stream has not reached the end yet, then shrink the file.
    s.once('data', () => {
      s.pause();
      fs.truncateSync(mp4, 10);
      const started = Date.now();
      s.once('close', () => resolve(Date.now() - started));
      s.resume();
      setTimeout(() => { s.destroy(); reject(new Error('connection still open after 1s')); }, 1000);
    });
  });
  assert.ok(closed < 1000);
  assert.equal((await get(srv, '/chapters/intro/poster')).status, 200);
});

// Starts a real server in a child process (with gc exposed) and hangs up many requests right after sending them.
async function hangUpStorm(t, count) {
  const slugDir = buildSlug(t);
  const script = path.join(path.dirname(slugDir), 'child.cjs');
  fs.writeFileSync(script, `
    const fs = require('node:fs');
    const { startServer } = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'server.cjs'))});
    startServer({ slugDir: ${JSON.stringify(slugDir)} }).then((srv) => {
      process.send({ ready: true, port: srv.port, key: srv.key });
      process.on('message', () => { global.gc(); setTimeout(() => { global.gc(); process.send({ fds: fs.readdirSync('/dev/fd').length }); }, 100); });
    });`);
  const child = fork(script, [], { execArgv: ['--expose-gc'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  t.after(() => child.kill());
  // Waits for the child's next message; if the child dies instead, gives back { died: true } so the test fails instead of hanging.
  const next = () => new Promise((resolve) => {
    child.once('message', resolve);
    child.once('exit', () => resolve({ died: true }));
  });
  const info = await next();
  const fdsNow = async () => {
    if (child.exitCode !== null) return NaN;
    const reply = next();
    child.send('gc');
    return (await reply).fds ?? NaN;
  };
  const before = await fdsNow();
  for (let i = 0; i < count; i++) {
    const s = net.connect(info.port, '127.0.0.1');
    s.on('error', () => {});
    s.write(`GET /chapters/intro/video HTTP/1.1\r\nHost: 127.0.0.1:${info.port}\r\nx-yap-key: ${info.key}\r\n\r\n`);
    s.end();
  }
  await new Promise((r) => setTimeout(r, 500));
  const after = await fdsNow();
  const ok = child.exitCode === null ? await get({ port: info.port, key: info.key }, '/chapters/intro/poster') : { status: 0 };
  return { child, before, after, ok, stderr };
}

test('hang-ups right after the request line do not crash the server (garbage collection forced)', async (t) => {
  const { child, ok, stderr } = await hangUpStorm(t, 300);
  assert.equal(child.exitCode, null, `child died: ${stderr}`);
  assert.equal(ok.status, 200);
  assert.equal(stderr, '');
});

test('300 early hang-ups leave no open files behind', async (t) => {
  const { before, after } = await hangUpStorm(t, 300);
  assert.ok(after - before <= 5, `(NaN means the server died) open files grew from ${before} to ${after}`);
});
