#!/usr/bin/env node
'use strict';
// Phase 2 acceptance, run by hand (not part of `npm test`): builds a small synthetic project with real H.264 clips,
// starts the real `yap serve --detach`, and checks it over real HTTP. One line per check: PASS|FAIL <name>: <observed>.
//
//   source spikes/env.sh && node tests/phase2-acceptance.cjs          run every check, then stop the server and clean up
//   source spikes/env.sh && node tests/phase2-acceptance.cjs --keep   build, start, print the URL and temp dir, leave it running
//   node tests/phase2-acceptance.cjs --stop <tmpdir>                   stop a --keep server and remove its temp dir
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawnSync, execFileSync } = require('node:child_process');
const { buildRecord, sha256 } = require('../lib/build-record.mts');

const REPO = path.join(__dirname, '..');
const BIN = path.join(REPO, 'bin', 'yap.cjs');
const PREFIX = 'yap-p2-accept-';
const SLUG = 'demo';
// Story order (deliberately not alphabetical). mid-flow is the stale one; alpha-setup is the one Step 4 plays with.
const CHAPTERS = [
  { id: 'zeta-intro', title: 'Zeta intro', seconds: 3.2 },
  { id: 'alpha-setup', title: 'Alpha setup', seconds: 4.4 },
  { id: 'mid-flow', title: 'Mid flow', seconds: 3.8, stale: true },
  { id: 'beta-wrap', title: 'Beta wrap', seconds: 4.9 },
];
const READY_IDS = CHAPTERS.filter((c) => !c.stale).map((c) => c.id);
const STALE_ID = 'mid-flow';
const LIVE_ID = 'alpha-setup';
const RANGE_ID = 'zeta-intro';

const FFMPEG = process.env.HYPERFRAMES_FFMPEG_PATH;
const FFPROBE = process.env.HYPERFRAMES_FFPROBE_PATH;

// What the run knows about the server and the project; cleanup reads it too.
const ctx = { tmp: null, slugDir: null, port: null, key: null, pid: null, keep: false, stream: null, startedAt: 0 };
const results = [];
const notes = [];

// Waits ms milliseconds.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Blocks the whole process for ms milliseconds (only used during cleanup, which must be synchronous for Ctrl-C).
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
// Shortens any text to one printable line.
function short(text, max = 240) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// Prints and keeps one check result.
function record(name, ok, observed) {
  results.push({ name, ok, observed: short(observed, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${short(observed, 400)}`);
}

// Prints and keeps one measured observation (not pass/fail).
function observe(name, value) {
  notes.push({ name, value });
  console.log(`NOTE ${name}: ${value}`);
}

// Runs one check: fn returns [ok, observed]. A throw is a FAIL with the error text, and the run goes on.
async function check(name, fn) {
  try {
    const [ok, observed] = await fn();
    record(name, Boolean(ok), observed);
    return Boolean(ok);
  } catch (err) {
    record(name, false, `error: ${err && err.message ? err.message : err}`);
    return false;
  }
}

// True when a process with this pid exists.
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

// Runs the real yap CLI and returns { code, out, err }.
function yap(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: process.env, timeout: 30000 });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// The headers that carry the session key.
const keyed = (extra = {}) => ({ 'x-yap-key': ctx.key, ...extra });

// One HTTP request to the server with node:http. Resolves { status, headers, body (Buffer) }; rejects on a socket error or timeout.
function httpRequest({ method = 'GET', path: target, headers = {}, body, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const h = { ...headers };
    if (payload !== undefined) {
      if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json';
      h['content-length'] = payload.length;
    }
    let timer = null;
    const req = http.request({ host: '127.0.0.1', port: ctx.port, method, path: target, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    timer = setTimeout(() => req.destroy(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end(payload);
  });
}

// Sends exact bytes over a raw socket (nothing normalised) and resolves { text, error } with what came back before
// the server closed the connection or timeoutMs passed.
function rawRequest(bytes, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const sock = net.connect(ctx.port, '127.0.0.1');
    let got = Buffer.alloc(0);
    let error = null;
    let done = false;
    // Settles once with what was received.
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ text: got.toString('latin1'), error });
    };
    const timer = setTimeout(finish, timeoutMs);
    sock.on('data', (d) => { got = Buffer.concat([got, d]); });
    sock.on('error', (e) => { error = e.code || e.message; });
    sock.on('close', finish);
    sock.on('connect', () => sock.write(bytes));
  });
}

// The status line of a raw answer, e.g. "HTTP/1.1 404 Not Found", or '(nothing)'.
const statusLine = (text) => (text.split('\r\n')[0] || '(nothing)');
// The status code of a raw answer, or 0.
const statusOf = (text) => Number((/^HTTP\/1\.[01] (\d{3})/.exec(text) || [])[1] || 0);

// Sends a body of bodyBytes to /api/message over a raw socket, piece by piece, and resolves with the first bytes the
// server sent back plus any socket error. chunked=true sends it without Content-Length (Transfer-Encoding: chunked).
function rawFlood(bodyBytes, chunked) {
  return new Promise((resolve) => {
    const sock = net.connect(ctx.port, '127.0.0.1');
    let got = Buffer.alloc(0);
    let error = null;
    let written = 0;
    let done = false;
    // Settles once with what was received.
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ text: got.toString('latin1'), error, written });
    };
    const timer = setTimeout(finish, 20000);
    sock.on('data', (d) => { got = Buffer.concat([got, d]); });
    sock.on('error', (e) => { error = e.code || e.message; });
    sock.on('close', finish);
    sock.on('connect', async () => {
      const head = `POST /api/message HTTP/1.1\r\nHost: 127.0.0.1:${ctx.port}\r\nx-yap-key: ${ctx.key}\r\n` +
        'Content-Type: application/json\r\n' +
        (chunked ? 'Transfer-Encoding: chunked\r\n' : `Content-Length: ${bodyBytes}\r\n`) + '\r\n';
      sock.write(head);
      // one valid JSON object of exactly bodyBytes bytes, sent in 64 KB pieces
      const open = '{"type":"message","text":"';
      const body = Buffer.alloc(bodyBytes, 'a');
      body.write(open, 0);
      body.write('"}', bodyBytes - 2);
      for (let at = 0; at < bodyBytes && !done && !sock.destroyed; at += 65536) {
        const part = body.subarray(at, Math.min(at + 65536, bodyBytes));
        const wire = chunked ? Buffer.concat([Buffer.from(`${part.length.toString(16)}\r\n`), part, Buffer.from('\r\n')]) : part;
        written += part.length;
        if (!sock.write(wire)) {
          // wait for room, or for the socket to go away
          await new Promise((r) => { sock.once('drain', r); sock.once('close', r); });
        }
      }
      if (chunked && !sock.destroyed) sock.write('0\r\n\r\n');
    });
  });
}

// Opens GET /api/stream and collects its events as { event, data, at } in a list.
function openStream() {
  const stream = { events: [], status: null, contentType: null, req: null };
  stream.req = http.request({ host: '127.0.0.1', port: ctx.port, path: '/api/stream', headers: keyed(), agent: false }, (res) => {
    stream.status = res.statusCode;
    stream.contentType = res.headers['content-type'];
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        stream.events.push({ event, data: parsed, at: Date.now() });
      }
    });
    res.on('error', () => {});
  });
  stream.req.on('error', () => {});
  stream.req.end();
  stream.close = () => stream.req.destroy();
  return stream;
}

// Calls fn every stepMs until it returns something truthy or ms pass. Resolves { value, ms } (value null on timeout).
async function waitUntil(fn, ms, stepMs = 100) {
  const start = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return { value: v, ms: Date.now() - start };
    if (Date.now() - start >= ms) return { value: null, ms: Date.now() - start };
    await sleep(stepMs);
  }
}

// GET /api/state with the key, parsed.
async function getState() {
  const r = await httpRequest({ path: '/api/state', headers: keyed() });
  if (r.status !== 200) throw new Error(`/api/state answered ${r.status}`);
  return JSON.parse(r.body.toString('utf8'));
}

// The manifest row for an id, or undefined.
const rowOf = (manifest, id) => manifest && manifest.chapters && manifest.chapters.find((c) => c.id === id);

// Asks ffprobe for a file's container duration and its stream kinds.
function probe(file) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(out);
  return { duration: Number(j.format.duration), streams: (j.streams || []).map((s) => s.codec_type) };
}

// Stops with a one-line message unless the static ffmpeg and ffprobe are set and run.
function requireTools() {
  for (const [name, bin] of [['HYPERFRAMES_FFMPEG_PATH', FFMPEG], ['HYPERFRAMES_FFPROBE_PATH', FFPROBE]]) {
    if (!bin) { console.error(`${name} is not set: run \`source spikes/env.sh\` first`); process.exit(2); }
    const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
    if (r.status !== 0) { console.error(`${name} (${bin}) does not run: ${short(r.stderr || (r.error && r.error.message) || 'exit ' + r.status, 160)}`); process.exit(2); }
  }
}

// Makes a real H.264 + AAC clip of the given length (test pattern plus a tone), moov atom at the front.
function makeClip(out, seconds) {
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out,
  ]);
}

// Makes the narration wav the build record fingerprints: 16-bit PCM, 24 kHz mono.
function makeWav(out, seconds) {
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=24000', '-t', String(seconds), '-ac', '1', '-c:a', 'pcm_s16le', out,
  ]);
}

// Formats seconds as a WebVTT time.
function vttTime(s) {
  const ms = Math.round(s * 1000);
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const ss = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${String(ms % 1000).padStart(3, '0')}`;
}

// Writes one chapter folder that satisfies the Phase 1 contract: the clip, the text files, build.json from
// lib/build-record.mts and render.json naming it. A stale chapter's build.json is rebuilt after render.json is written.
function writeChapter(slugDir, spec) {
  const dir = path.join(slugDir, 'chapters', spec.id);
  fs.mkdirSync(dir, { recursive: true });
  const mp4 = path.join(dir, 'chapter.mp4');
  makeClip(mp4, spec.seconds);
  const duration = probe(mp4).duration;
  makeWav(path.join(dir, 'narration.wav'), spec.seconds);
  const text = `${spec.title} shows how the demo app handles this step.`;
  const chapter = {
    id: spec.id, title: spec.title,
    sources: [{ id: 's1', file: 'src/app.js', lines: [10, 12], quote: 'function start() {' }],
    sentences: [{ text, kind: 'claim', source_ids: ['s1'] }],
    scene: [{ piece: 'title-card', params: { title: spec.title }, beat: 0 }],
  };
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), data);
  write('chapter.json', `${JSON.stringify(chapter, null, 2)}\n`);
  write('narration.txt', `${text}\n`);
  write('beats.json', `${JSON.stringify({ timing: 'sentence-share', durationS: duration, beats: [{ text, start: 0, end: duration }] }, null, 2)}\n`);
  write('captions.vtt', `WEBVTT\n\n${vttTime(0)} --> ${vttTime(duration)}\n${text}\n`);
  const words = text.split(' ');
  write('captions.json', `${JSON.stringify(words.map((w, i) => ({ text: w, start: (i * duration) / words.length, end: ((i + 1) * duration) / words.length })))}\n`);
  const html = (extra) => `<!doctype html><html><body><div data-composition-id="${spec.id}" data-duration="${duration}">${spec.title}</div>${extra}</body></html>\n`;
  write('index.html', html(''));
  const record = () => `${JSON.stringify(buildRecord(chapter, (name) => fs.readFileSync(path.join(dir, name)), null), null, 2)}\n`;
  write('build.json', record());
  write('render.json', `${JSON.stringify({ build_sha256: sha256(fs.readFileSync(path.join(dir, 'build.json'))) })}\n`);
  if (spec.stale) {
    // narrated again after the render: the page changed, so build.json no longer matches what render.json names
    write('index.html', html('<!-- re-narrated -->'));
    write('build.json', record());
  }
  return { id: spec.id, title: spec.title, dir, mp4, duration };
}

// Builds <tmp>/proj/.yap/demo with script.md, sources.json, order.json and the four chapters.
function buildProject() {
  ctx.tmp = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
  ctx.slugDir = path.join(ctx.tmp, 'proj', '.yap', SLUG);
  fs.mkdirSync(path.join(ctx.slugDir, 'chapters'), { recursive: true });
  fs.writeFileSync(path.join(ctx.slugDir, 'script.md'), '# Demo\n\nA synthetic script for the Phase 2 acceptance run.\n\n' +
    CHAPTERS.map((c) => `## ${c.title}\n\n${c.title} shows how the demo app handles this step.\n`).join('\n'));
  fs.writeFileSync(path.join(ctx.slugDir, 'sources.json'), `${JSON.stringify([{ id: 's1', file: 'src/app.js', lines: [10, 12], quote: 'function start() {' }], null, 2)}\n`);
  fs.writeFileSync(path.join(ctx.slugDir, 'order.json'), `${JSON.stringify({ chapters: CHAPTERS.map((c) => c.id) })}\n`);
  ctx.chapters = {};
  for (const spec of CHAPTERS) ctx.chapters[spec.id] = writeChapter(ctx.slugDir, spec);
}

// Starts the real server with `yap serve --detach` and reads state/server.json. Returns the printed URL and the time taken.
function startServer() {
  ctx.startedAt = Date.now();
  const r = yap(['serve', '--detach', '--dir', ctx.slugDir]);
  const ms = Date.now() - ctx.startedAt;
  const info = readServerInfo(ctx.slugDir);
  if (info) Object.assign(ctx, { port: info.port, key: info.key, pid: info.pid });
  return { r, ms, info };
}

// Reads <slugDir>/state/server.json, or null.
function readServerInfo(slugDir) {
  try { return JSON.parse(fs.readFileSync(path.join(slugDir, 'state', 'server.json'), 'utf8')); } catch { return null; }
}

// Waits until every ready chapter has a poster in the manifest; resolves the ms since the server was started, or null.
async function waitForPosters(ms) {
  const w = await waitUntil(async () => {
    const s = await getState();
    return READY_IDS.every((id) => rowOf(s.manifest, id) && rowOf(s.manifest, id).poster) ? s : null;
  }, ms, 25);
  return w.value ? Date.now() - ctx.startedAt : null;
}

// Step 1: server.json, the key cookie, the page.
async function step1(detach) {
  const file = path.join(ctx.slugDir, 'state', 'server.json');
  await check('1.detach-prints-url', () => [detach.r.code === 0 && detach.info && detach.r.out === detach.info.url,
    `exit ${detach.r.code}, printed "${detach.r.out}"${detach.r.err ? `, stderr "${detach.r.err}"` : ''}`]);
  await check('1.server-json-exists', () => [fs.existsSync(file), fs.existsSync(file) ? 'present' : 'missing']);
  await check('1.server-json-mode-0600', () => {
    const mode = (fs.statSync(file).mode & 0o777).toString(8).padStart(4, '0');
    return [mode === '0600', `mode ${mode}`];
  });
  await check('1.server-json-fields', () => {
    const info = detach.info || {};
    const ok = typeof info.url === 'string' && /^[0-9a-f]{32}$/.test(info.key) && Number.isInteger(info.port) && Number.isInteger(info.pid) &&
      !Number.isNaN(Date.parse(info.started_at)) && info.url === `http://127.0.0.1:${info.port}/?key=${info.key}`;
    return [ok, `keys ${Object.keys(info).join(',')}; port ${info.port}, pid ${info.pid}, started_at ${info.started_at}`];
  });
  await check('1.pid-alive', () => [pidAlive(ctx.pid), `pid ${ctx.pid} ${pidAlive(ctx.pid) ? 'alive' : 'not running'}`]);
  ctx.cookie = null;
  await check('1.key-in-query-302-cookie', async () => {
    const r = await httpRequest({ path: `/?key=${ctx.key}` });
    const cookies = [].concat(r.headers['set-cookie'] || []);
    const want = `yap_key_${ctx.port}=${ctx.key}`;
    const hit = cookies.find((c) => c.startsWith(want));
    if (hit) ctx.cookie = want;
    return [r.status === 302 && Boolean(hit) && r.headers.location === '/', `${r.status}, Location ${r.headers.location}, Set-Cookie "${cookies.join(' | ').replace(ctx.key, '<key>')}"`];
  });
  await check('1.cookie-get-page-200-lists-chapters', async () => {
    const r = await httpRequest({ path: '/', headers: { cookie: ctx.cookie || `yap_key_${ctx.port}=${ctx.key}` } });
    const html = r.body.toString('utf8');
    const at = CHAPTERS.map((c) => html.indexOf(`<h2>${c.title}</h2>`));
    const inOrder = at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1]));
    const videos = (html.match(/<video /g) || []).length;
    return [r.status === 200 && /^text\/html/.test(r.headers['content-type']) && inOrder && videos === READY_IDS.length,
      `${r.status} ${r.headers['content-type']}; all 4 titles in story order: ${inOrder}; ${videos} <video> elements`];
  });
}

// Step 1b: a second start on the same folder. The foreground form is refused; --detach hands back the running one.
async function step1b() {
  const before = fs.readFileSync(path.join(ctx.slugDir, 'state', 'server.json'), 'utf8');
  const fg = yap(['serve', '--dir', ctx.slugDir]);
  await check('1b.second-foreground-serve-refused', () => [fg.code !== 0 && fg.code !== null && /a server for this folder is already running/.test(fg.err),
    `exit ${fg.code}, stderr "${short(fg.err.replace(ctx.key, '<key>'), 160)}"`]);
  const again = yap(['serve', '--detach', '--dir', ctx.slugDir]);
  await check('1b.second-detach-prints-same-url', () => [again.code === 0 && again.out === `http://127.0.0.1:${ctx.port}/?key=${ctx.key}`,
    `exit ${again.code}, printed the running server's URL: ${again.out === `http://127.0.0.1:${ctx.port}/?key=${ctx.key}`}`]);
  await check('1b.first-server-untouched', async () => {
    const r = await httpRequest({ path: '/api/ping', headers: keyed() });
    const pid = JSON.parse(r.body.toString('utf8')).pid;
    const same = fs.readFileSync(path.join(ctx.slugDir, 'state', 'server.json'), 'utf8') === before;
    return [r.status === 200 && pid === ctx.pid && same && serversFor(ctx.slugDir).length === 1,
      `ping ${r.status}, pid ${pid} (started as ${ctx.pid}), server.json unchanged: ${same}, server processes for this folder: ${serversFor(ctx.slugDir).length}`];
  });
}

// Step 2: the key guard, the manifest, posters and media serving.
async function step2() {
  const id = RANGE_ID;
  const routes = [
    ['GET', '/'], ['GET', '/api/state'], ['GET', '/api/ping'], ['GET', '/api/stream'],
    ['GET', `/chapters/${id}/video`], ['HEAD', `/chapters/${id}/video`], ['GET', `/chapters/${id}/poster`], ['GET', `/chapters/${id}/captions`],
    ['POST', '/api/message'], ['POST', '/api/reply'], ['POST', '/api/chapters'], ['POST', '/api/heartbeat'], ['POST', '/api/export'],
    ['GET', '/no-such-route'],
  ];
  await check('2.no-key-403-every-route', async () => {
    const seen = [];
    for (const [method, p] of routes) {
      const r = await httpRequest({ method, path: p, body: method === 'POST' ? {} : undefined });
      seen.push(`${method} ${p} ${r.status}`);
    }
    return [seen.every((s) => s.endsWith(' 403')), seen.join('; ')];
  });
  await check('2.wrong-key-403', async () => {
    const wrong = ctx.key.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    const a = await httpRequest({ path: '/api/state', headers: { 'x-yap-key': wrong } });
    const b = await httpRequest({ path: `/api/state?key=${wrong}` });
    return [a.status === 403 && b.status === 403, `header ${a.status}, query ${b.status}`];
  });
  let state = null;
  await check('2.state-with-key-200', async () => {
    const r = await httpRequest({ path: '/api/state', headers: keyed() });
    state = JSON.parse(r.body.toString('utf8'));
    return [r.status === 200, `${r.status} ${r.headers['content-type']}; keys ${Object.keys(state).join(',')}`];
  });
  await check('2.manifest-order-is-order-json', () => {
    const ids = state.manifest.chapters.map((c) => c.id);
    return [ids.join(',') === CHAPTERS.map((c) => c.id).join(','), ids.join(', ')];
  });
  for (const rid of READY_IDS) {
    await check(`2.ready-row.${rid}`, () => {
      const row = rowOf(state.manifest, rid);
      const real = ctx.chapters[rid].duration;
      const buildSha = sha256(fs.readFileSync(path.join(ctx.chapters[rid].dir, 'build.json')));
      const paths = row.video === `chapters/${rid}/chapter.mp4` && row.captions === `chapters/${rid}/captions.vtt`;
      const ok = row.status === 'ready' && Math.abs(row.duration_s - real) <= 0.05 && row.build_sha256 === buildSha && paths;
      return [ok, `status ${row.status}, duration_s ${row.duration_s} vs ffprobe ${real}, build_sha256 ${row.build_sha256 === buildSha ? 'matches build.json' : row.build_sha256}, video ${row.video}, captions ${row.captions}`];
    });
  }
  // the watch was started right after `serve --detach` returned, so this time is not delayed by the Step 1 checks
  const postersAt = await ctx.postersWatch;
  if (postersAt !== null) observe('time from serve --detach start to all three posters in the manifest', `${postersAt} ms`);
  state = await getState();
  for (const rid of READY_IDS) {
    await check(`2.poster.${rid}`, async () => {
      const row = rowOf(state.manifest, rid);
      if (!row.poster) return [false, `poster still null 15 s after start; poster.jpg on disk: ${fs.existsSync(path.join(ctx.chapters[rid].dir, 'poster.jpg'))}`];
      const r = await httpRequest({ path: `/chapters/${rid}/poster`, headers: keyed() });
      const magic = r.body.subarray(0, 2).toString('hex').toUpperCase();
      return [r.status === 200 && magic === 'FFD8', `manifest poster "${row.poster}"; route ${r.status} ${r.headers['content-type']}, ${r.body.length} bytes, first bytes ${magic}`];
    });
  }
  await check('2.stale-row', () => {
    const row = rowOf(state.manifest, STALE_ID);
    return [row.status === 'stale' && row.poster === null && row.video === null && row.captions === null,
      `status ${row.status}, poster ${row.poster}, video ${row.video}, captions ${row.captions}`];
  });
  const mp4 = fs.readFileSync(ctx.chapters[id].mp4);
  const size = mp4.length;
  await check('2.range-100-199', async () => {
    const r = await httpRequest({ path: `/chapters/${id}/video`, headers: keyed({ range: 'bytes=100-199' }) });
    const same = r.body.equals(mp4.subarray(100, 200));
    return [r.status === 206 && r.headers['content-range'] === `bytes 100-199/${size}` && same,
      `${r.status}, Content-Range "${r.headers['content-range']}", ${r.body.length} bytes, equal to file bytes 100..199: ${same}`];
  });
  await check('2.range-0-open', async () => {
    const r = await httpRequest({ path: `/chapters/${id}/video`, headers: keyed({ range: 'bytes=0-' }) });
    return [r.status === 206 && r.body.equals(mp4) && r.headers['content-range'] === `bytes 0-${size - 1}/${size}`,
      `${r.status}, Content-Range "${r.headers['content-range']}", ${r.body.length} of ${size} bytes, identical: ${r.body.equals(mp4)}`];
  });
  await check('2.no-range-200', async () => {
    const r = await httpRequest({ path: `/chapters/${id}/video`, headers: keyed() });
    return [r.status === 200 && r.headers['accept-ranges'] === 'bytes' && r.body.equals(mp4) && r.headers['content-type'] === 'video/mp4',
      `${r.status}, Accept-Ranges "${r.headers['accept-ranges']}", ${r.headers['content-type']}, ${r.body.length} bytes`];
  });
  await check('2.head-video', async () => {
    const r = await httpRequest({ method: 'HEAD', path: `/chapters/${id}/video`, headers: keyed() });
    return [r.status === 200 && r.body.length === 0 && Number(r.headers['content-length']) === size,
      `${r.status}, Content-Length ${r.headers['content-length']}, body ${r.body.length} bytes`];
  });
  await check('2.stale-video-404', async () => {
    const r = await httpRequest({ path: `/chapters/${STALE_ID}/video`, headers: keyed() });
    return [r.status === 404, `${r.status} ${r.body.toString('utf8')}`];
  });
  await check('2.captions-vtt', async () => {
    const r = await httpRequest({ path: `/chapters/${id}/captions`, headers: keyed() });
    return [r.status === 200 && /^text\/vtt/.test(r.headers['content-type']) && r.body.toString('utf8').startsWith('WEBVTT'),
      `${r.status} ${r.headers['content-type']}, starts "${r.body.toString('utf8').slice(0, 6)}"`];
  });
}

// Waits up to ms for the live chapter's manifest row to satisfy pred; resolves { row, ms }.
async function waitRow(id, pred, ms) {
  const w = await waitUntil(async () => { const r = rowOf((await getState()).manifest, id); return r && pred(r) ? r : null; }, ms, 50);
  return { row: w.value, ms: w.ms };
}

// Waits up to ms for a stream event (after index `from`) that satisfies pred.
async function waitEvent(stream, from, pred, ms) {
  const w = await waitUntil(() => stream.events.slice(from).find(pred) || null, ms, 25);
  return w.value;
}

// Step 4: live updates from the folders, chat with a CLI reply, and the chapter commands.
async function step4() {
  const stream = openStream();
  ctx.stream = stream;
  const first = await waitEvent(stream, 0, () => true, 3000);
  await check('4.stream-first-event-state', () => [stream.status === 200 && first && first.event === 'state' && first.data.manifest,
    `${stream.status} ${stream.contentType}; first event "${first && first.event}"`]);
  const dir = ctx.chapters[LIVE_ID].dir;
  const mp4 = path.join(dir, 'chapter.mp4');
  const away = path.join(dir, 'chapter.mp4.away');

  // rename the video away
  let mark = stream.events.length;
  const t0 = Date.now();
  fs.renameSync(mp4, away);
  await check('4.mp4-gone-video-404-immediately', async () => {
    const r = await httpRequest({ path: `/chapters/${LIVE_ID}/video`, headers: keyed() });
    return [r.status === 404, `${r.status} ${Date.now() - t0} ms after the rename`];
  });
  let w = await waitRow(LIVE_ID, (r) => r.status !== 'ready', 3000);
  await check('4.mp4-gone-pending-within-3s', () => [w.row !== null && w.row.status === 'pending' && w.row.poster === null,
    w.row ? `status ${w.row.status} (expected pending per controller ruling) after ${Date.now() - t0} ms; poster ${w.row.poster}` : 'still ready after 3 s']);
  let ev = await waitEvent(stream, mark, (e) => e.event === 'chapter' && e.data && rowOf(e.data.manifest, LIVE_ID) && rowOf(e.data.manifest, LIVE_ID).status !== 'ready', 3000);
  await check('4.mp4-gone-chapter-event', () => [Boolean(ev), ev ? `chapter event (op ${ev.data.op}) showing ${LIVE_ID} ${rowOf(ev.data.manifest, LIVE_ID).status}, ${ev.at - t0} ms after the rename` : 'no such chapter event within 3 s']);

  // rename it back
  const posterFile = path.join(dir, 'poster.jpg');
  const inoBefore = fs.existsSync(posterFile) ? fs.statSync(posterFile).ino : null;
  mark = stream.events.length;
  const t1 = Date.now();
  fs.renameSync(away, mp4);
  w = await waitRow(LIVE_ID, (r) => r.status === 'ready', 3000);
  await check('4.mp4-back-ready-within-3s', () => [w.row !== null, w.row ? `ready after ${Date.now() - t1} ms` : 'not ready within 3 s']);
  w = await waitRow(LIVE_ID, (r) => r.status === 'ready' && r.poster, 15000);
  await check('4.mp4-back-poster-again', () => {
    const inoAfter = fs.existsSync(posterFile) ? fs.statSync(posterFile).ino : null;
    return [w.row !== null && inoBefore !== null && inoAfter !== null && inoAfter !== inoBefore, w.row ? `poster "${w.row.poster}" ${Date.now() - t1} ms after the rename back; poster.jpg inode ${inoBefore} -> ${inoAfter} (${inoBefore !== inoAfter ? 'new file' : 'same file'})` : `poster still null after 15 s; poster.jpg on disk: ${inoAfter !== null}`];
  });

  // edit build.json, then restore it
  const buildFile = path.join(dir, 'build.json');
  const original = fs.readFileSync(buildFile);
  const t2 = Date.now();
  fs.appendFileSync(buildFile, ' ');
  w = await waitRow(LIVE_ID, (r) => r.status === 'stale', 3000);
  const vid = await httpRequest({ path: `/chapters/${LIVE_ID}/video`, headers: keyed() });
  await check('4.build-edit-stale-within-3s', () => [w.row !== null && w.row.poster === null && vid.status === 404,
    w.row ? `stale after ${Date.now() - t2} ms, poster ${w.row.poster}, /video ${vid.status}` : `not stale within 3 s; /video ${vid.status}`]);
  const t3 = Date.now();
  fs.writeFileSync(buildFile, original);
  w = await waitRow(LIVE_ID, (r) => r.status === 'ready', 3000);
  await check('4.build-restored-ready-within-3s', () => [w.row !== null, w.row ? `ready after ${Date.now() - t3} ms` : 'not ready within 3 s']);

  // viewer message and the CLI reply
  let evtId = null;
  await check('4.post-message', async () => {
    const r = await httpRequest({ method: 'POST', path: '/api/message', headers: keyed(), body: { type: 'message', text: 'why does it start there?', context: { chapter_id: LIVE_ID, t: 1.5 } } });
    const j = JSON.parse(r.body.toString('utf8'));
    evtId = j.event && j.event.id;
    return [r.status === 200 && /^evt_\d+$/.test(evtId), `${r.status}, event id ${evtId}`];
  });
  mark = stream.events.length;
  const reply = yap(['reply', '--in-reply-to', String(evtId), '--text', 'It starts at the setup because the app loads its config first.', '--source', 'src/app.js:10-12', '--dir', ctx.slugDir]);
  await check('4.cli-reply-line', () => [reply.code === 0 && reply.out === 'reply rep_1 sent', `exit ${reply.code}, stdout "${reply.out}"${reply.err ? `, stderr "${reply.err}"` : ''}`]);
  ev = await waitEvent(stream, mark, (e) => e.event === 'reply', 3000);
  await check('4.reply-event-on-stream', () => [ev && ev.data.id === 'rep_1' && ev.data.role === 'claude' && ev.data.in_reply_to === evtId,
    ev ? `reply event id ${ev.data.id}, role ${ev.data.role}, in_reply_to ${ev.data.in_reply_to}, sources ${JSON.stringify(ev.data.sources)}` : 'no reply event within 3 s']);
  await check('4.thread-viewer-then-claude', async () => {
    const t = (await getState()).thread;
    const ok = t.length === 2 && t[0].role === 'viewer' && t[0].id === evtId && t[1].role === 'claude' && t[1].id === 'rep_1';
    return [ok, t.map((e) => `${e.role}:${e.id}`).join(', ')];
  });

  // the chapter commands
  const add = yap(['add-chapter', '--id', 'extra-topic', '--after', LIVE_ID, '--title', 'Extra', '--dir', ctx.slugDir]);
  await check('4.cli-add-chapter', async () => {
    const ids = (await getState()).manifest.chapters.map((c) => c.id);
    const want = ['zeta-intro', 'alpha-setup', 'extra-topic', 'mid-flow', 'beta-wrap'];
    return [add.code === 0 && add.out === 'chapter extra-topic added at position 3' && ids.join() === want.join(),
      `exit ${add.code}, stdout "${add.out}"${add.err ? `, stderr "${add.err}"` : ''}; manifest ${ids.join(', ')}`];
  });
  const set = yap(['set-status', '--id', 'extra-topic', '--status', 'failed', '--dir', ctx.slugDir]);
  await check('4.cli-set-status', async () => {
    const row = rowOf((await getState()).manifest, 'extra-topic');
    return [set.code === 0 && set.out === 'chapter extra-topic is failed' && row && row.status === 'failed',
      `exit ${set.code}, stdout "${set.out}"${set.err ? `, stderr "${set.err}"` : ''}; row status ${row && row.status}, title ${row && row.title}`];
  });

  // moving chapters that are already on the page
  const move = yap(['order', 'beta-wrap,zeta-intro,alpha-setup,mid-flow', '--dir', ctx.slugDir]);
  await check('4.cli-order-moves-page', async () => {
    const ids = (await getState()).manifest.chapters.map((c) => c.id);
    const want = ['beta-wrap', 'zeta-intro', 'alpha-setup', 'extra-topic', 'mid-flow'];
    return [move.code === 0 && move.out === 'order written: 4 chapters; the page now shows the new order' && ids.join() === want.join(),
      `exit ${move.code}, stdout "${move.out}"${move.err ? `, stderr "${move.err}"` : ''}; manifest ${ids.join(', ')}`];
  });
}

// Step 4b: the heartbeat flips claude_connected on, and it goes off again after 15 s of silence.
async function step4b() {
  await check('4b.connected-false-at-first', async () => { const s = await getState(); return [s.claude_connected === false, `claude_connected ${s.claude_connected}`]; });
  const mark = ctx.stream ? ctx.stream.events.length : 0;
  await check('4b.heartbeat-then-true', async () => {
    const r = await httpRequest({ method: 'POST', path: '/api/heartbeat', headers: keyed(), body: {} });
    const s = await getState();
    return [r.status === 200 && s.claude_connected === true, `heartbeat ${r.status}; claude_connected ${s.claude_connected}`];
  });
  await sleep(16000);
  await check('4b.false-after-16s', async () => { const s = await getState(); return [s.claude_connected === false, `claude_connected ${s.claude_connected} after 16 s`]; });
  await check('4b.stream-says-connected-then-disconnected', () => {
    const seen = ctx.stream.events.slice(mark).filter((e) => e.event === 'state').map((e) => e.data.claude_connected);
    const on = seen.indexOf(true);
    return [on >= 0 && seen.indexOf(false, on) > on, `state events after the heartbeat carried claude_connected: ${seen.join(', ') || '(none)'}`];
  });
}

// Hashes a file's bytes, or null when it is missing.
function fileHash(file) {
  try { return sha256(fs.readFileSync(file)); } catch { return null; }
}

// Step 5: export into a fresh folder, twice, plus the refusals.
async function step5() {
  const settled = await waitUntil(async () => {
    const m = (await getState()).manifest;
    return READY_IDS.every((id) => rowOf(m, id).status === 'ready');
  }, 10000);
  if (!settled.value) record('5.ready-before-export', false, 'the three ready chapters were not all ready within 10 s');
  const dest = fs.mkdtempSync(path.join(ctx.tmp, 'export-'));
  const expected = READY_IDS.reduce((sum, id) => sum + ctx.chapters[id].duration, 0);
  let first = null;
  const t0 = Date.now();
  await check('5.export-drafts-200', async () => {
    const r = await httpRequest({ method: 'POST', path: '/api/export', headers: keyed(), body: { dest, mode: 'drafts' }, timeoutMs: 180000 });
    first = JSON.parse(r.body.toString('utf8'));
    return [r.status === 200, `${r.status} in ${Date.now() - t0} ms: ${JSON.stringify(first)}`];
  });
  observe('first export (3 chapters, stream copy) took', `${Date.now() - t0} ms`);
  await check('5.export-files-present', () => {
    const names = fs.readdirSync(dest).sort();
    return [['demo.mp4', 'script.md', 'sources.json'].every((n) => names.includes(n)), `dest holds ${names.join(', ')}`];
  });
  await check('5.export-duration-and-streams', () => {
    const p = probe(path.join(dest, 'demo.mp4'));
    const v = p.streams.filter((s) => s === 'video').length;
    const a = p.streams.filter((s) => s === 'audio').length;
    return [Math.abs(p.duration - expected) <= 0.2 && v === 1 && a === 1,
      `ffprobe ${p.duration} s vs sum of ready chapters ${expected.toFixed(6)} s (diff ${(p.duration - expected).toFixed(3)}); ${v} video, ${a} audio`];
  });
  await check('5.export-texts-identical', () => {
    const s = fs.readFileSync(path.join(dest, 'script.md')).equals(fs.readFileSync(path.join(ctx.slugDir, 'script.md')));
    const j = fs.readFileSync(path.join(dest, 'sources.json')).equals(fs.readFileSync(path.join(ctx.slugDir, 'sources.json')));
    return [s && j, `script.md identical ${s}, sources.json identical ${j}`];
  });
  const before = ['demo.mp4', 'script.md', 'sources.json'].map((n) => fileHash(path.join(dest, n)));
  await check('5.second-export-numbered', async () => {
    const r = await httpRequest({ method: 'POST', path: '/api/export', headers: keyed(), body: { dest, mode: 'drafts' }, timeoutMs: 180000 });
    const j = JSON.parse(r.body.toString('utf8'));
    const names = fs.readdirSync(dest).sort();
    const ok = r.status === 200 && j.file === 'demo-2.mp4' && ['demo-2.mp4', 'script-2.md', 'sources-2.json'].every((n) => names.includes(n));
    return [ok, `${r.status} ${JSON.stringify(j)}; dest holds ${names.join(', ')}`];
  });
  await check('5.first-set-untouched', () => {
    const after = ['demo.mp4', 'script.md', 'sources.json'].map((n) => fileHash(path.join(dest, n)));
    return [after.every((h, i) => h !== null && h === before[i]), `hashes unchanged: ${after.map((h, i) => h === before[i]).join(', ')}`];
  });
  await check('5.full-mode-409-names-drafts', async () => {
    const r = await httpRequest({ method: 'POST', path: '/api/export', headers: keyed(), body: { dest, mode: 'full' } });
    const msg = JSON.parse(r.body.toString('utf8')).error || '';
    return [r.status === 409 && READY_IDS.every((id) => msg.includes(id)), `${r.status} "${msg}"`];
  });
  await check('5.dest-yap-folder-400', async () => {
    const r = await httpRequest({ method: 'POST', path: '/api/export', headers: keyed(), body: { dest: path.dirname(ctx.slugDir), mode: 'drafts' } });
    return [r.status === 400, `${r.status} ${r.body.toString('utf8')}`];
  });
  await check('5.no-hidden-work-folder-left', () => {
    const hidden = fs.readdirSync(dest).filter((n) => n.startsWith('.yap-export-'));
    return [hidden.length === 0, hidden.length ? `left: ${hidden.join(', ')}` : `none; dest holds ${fs.readdirSync(dest).sort().join(', ')}`];
  });
}

// Step 6: hostile requests against the running server.
async function step6() {
  const id = RANGE_ID;
  const size = fs.statSync(ctx.chapters[id].mp4).size;
  const hostLine = `Host: 127.0.0.1:${ctx.port}\r\n`;
  const keyLine = `x-yap-key: ${ctx.key}\r\n`;
  await check('6.forged-host-403', async () => {
    const r = await httpRequest({ path: '/api/state', headers: keyed({ host: 'evil.example' }) });
    return [r.status === 403, `Host: evil.example with the right key -> ${r.status} ${r.body.toString('utf8')}`];
  });
  await check('6.absolute-form-bad-port-400', async () => {
    const r = await rawRequest(`GET http://x:99999/ HTTP/1.1\r\n${hostLine}${keyLine}Connection: close\r\n\r\n`);
    const code = statusOf(r.text);
    return [code === 400, `"${statusLine(r.text)}"${r.error ? ` (socket ${r.error})` : ''}; body ${short(r.text.split('\r\n\r\n')[1] || '', 80)}`];
  });
  await check('6.answers-after-absolute-form', async () => {
    const r = await httpRequest({ path: '/api/ping', headers: keyed() });
    return [r.status === 200, `ping ${r.status} ${r.body.toString('utf8')}`];
  });
  for (const [name, target] of [['6.escape-dotdot-slash-404', `/chapters/..%2f..%2fetc/video`], ['6.escape-dotdot-404', '/chapters/%2e%2e/video']]) {
    await check(name, async () => {
      const r = await rawRequest(`GET ${target} HTTP/1.1\r\n${hostLine}${keyLine}Connection: close\r\n\r\n`);
      return [statusOf(r.text) === 404, `GET ${target} -> "${statusLine(r.text)}"`];
    });
  }
  await check('6.body-10mb-413', async () => {
    const r = await rawFlood(10 * 1024 * 1024, false);
    return [statusOf(r.text) === 413, `with Content-Length: "${statusLine(r.text)}"; client wrote ${r.written} body bytes${r.error ? `, then socket ${r.error}` : ''}`];
  });
  await check('6.body-10mb-chunked-413', async () => {
    const r = await rawFlood(10 * 1024 * 1024, true);
    return [statusOf(r.text) === 413, `chunked, no Content-Length: "${statusLine(r.text)}"; client wrote ${r.written} body bytes${r.error ? `, then socket ${r.error}` : ''}`];
  });
  await check('6.range-past-end-416', async () => {
    const r = await httpRequest({ path: `/chapters/${id}/video`, headers: keyed({ range: 'bytes=999999999-' }) });
    return [r.status === 416 && r.headers['content-range'] === `bytes */${size}`, `${r.status}, Content-Range "${r.headers['content-range']}"`];
  });
  await check('6.foreign-origin-post-403', async () => {
    const r = await httpRequest({ method: 'POST', path: '/api/heartbeat', headers: keyed({ origin: 'https://evil.example' }), body: {} });
    return [r.status === 403, `POST /api/heartbeat with Origin https://evil.example and the right key -> ${r.status}`];
  });
  await check('6.cookie-wrong-name-403', async () => {
    const r = await httpRequest({ path: '/api/state', headers: { cookie: `yap_key=${ctx.key}` } });
    return [r.status === 403, `Cookie yap_key=<key> only -> ${r.status}`];
  });
  await check('6.300-hangups-then-ok', async () => {
    const t0 = Date.now();
    for (let batch = 0; batch < 6; batch++) {
      await Promise.all(Array.from({ length: 50 }, () => new Promise((resolve) => {
        const s = net.connect(ctx.port, '127.0.0.1');
        s.on('error', () => resolve());
        s.on('close', () => resolve());
        s.on('connect', () => { s.write('GET /api/state HTTP/1.1\r\n', () => s.destroy()); });
      })));
    }
    const r = await httpRequest({ path: '/api/ping', headers: keyed() });
    const pid = JSON.parse(r.body.toString('utf8')).pid;
    return [r.status === 200 && pid === ctx.pid && pidAlive(ctx.pid), `300 hang-ups in ${Date.now() - t0} ms; ping ${r.status}, pid ${pid} (started as ${ctx.pid})`];
  });
}

// Finds any server process still running for this slug folder (by its command line).
function serversFor(slugDir) {
  const r = spawnSync('pgrep', ['-f', `yap.cjs serve --dir ${slugDir}`], { encoding: 'utf8' });
  return (r.stdout || '').split('\n').map(Number).filter((n) => Number.isInteger(n) && n > 1);
}

// Stops a server: SIGTERM, wait up to 30 s (close waits for poster work), then SIGKILL. Returns how long it took in ms.
function stopPid(pid) {
  const t0 = Date.now();
  try { process.kill(pid, 'SIGTERM'); } catch { return 0; }
  while (pidAlive(pid) && Date.now() - t0 < 30000) sleepSync(50);
  if (pidAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } sleepSync(200); }
  return Date.now() - t0;
}

// True when dir is a temp folder this script made (and so safe to remove).
function isOurTmp(dir) {
  try {
    return path.basename(dir).startsWith(PREFIX) && fs.realpathSync(path.dirname(dir)) === fs.realpathSync(os.tmpdir());
  } catch { return false; }
}

let cleaned = false;
// Stops the server this run started and removes the temp folder; safe to call twice, and synchronous for Ctrl-C.
function cleanup() {
  if (cleaned || ctx.keep) return;
  cleaned = true;
  if (ctx.stream) ctx.stream.close();
  const pids = new Set([...(ctx.pid ? [ctx.pid] : []), ...(ctx.slugDir ? serversFor(ctx.slugDir) : [])]);
  for (const pid of pids) if (pidAlive(pid)) stopPid(pid);
  if (ctx.tmp && isOurTmp(ctx.tmp)) fs.rmSync(ctx.tmp, { recursive: true, force: true });
}

// `--stop <tmpdir>`: stops the --keep server (after its ping confirms the pid) and removes the folder.
async function stopKept(dir) {
  const tmp = path.resolve(dir || '');
  if (!isOurTmp(tmp)) { console.error(`refusing: ${tmp} is not a ${PREFIX}* folder in ${os.tmpdir()}`); return 2; }
  const slugDir = path.join(tmp, 'proj', '.yap', SLUG);
  const info = readServerInfo(slugDir);
  if (info) {
    Object.assign(ctx, { port: info.port, key: info.key });
    let pid = null;
    try {
      const r = await httpRequest({ path: '/api/ping', headers: keyed(), timeoutMs: 3000 });
      pid = JSON.parse(r.body.toString('utf8')).pid;
    } catch { /* not answering */ }
    if (pid === info.pid) console.log(`stopped server pid ${pid} in ${stopPid(pid)} ms`);
    else if (pid === null) console.log('no server answered on that port');
    else { console.error(`the server on port ${info.port} answers with pid ${pid}, not ${info.pid}; not stopping it`); return 1; }
  }
  for (const pid of serversFor(slugDir)) console.log(`stopped leftover server pid ${pid} in ${stopPid(pid)} ms`);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`removed ${tmp}`);
  return 0;
}

// `--keep`: builds the project, starts the server, waits for the posters, prints how to reach it and how to stop it.
async function keepRunning() {
  ctx.keep = true;
  buildProject();
  const d = startServer();
  if (d.r.code !== 0 || !d.info) { console.error(`yap serve --detach failed: exit ${d.r.code} ${d.r.err}`); ctx.keep = false; cleanup(); return 1; }
  const at = await waitForPosters(15000);
  console.log(`URL: ${d.info.url}`);
  console.log(`TMPDIR: ${ctx.tmp}`);
  console.log(`slug folder: ${ctx.slugDir}`);
  console.log(`server pid ${ctx.pid}; posters ${at === null ? 'not all ready after 15 s' : `ready ${at} ms after start`}`);
  console.log(`stop it with: node tests/phase2-acceptance.cjs --stop ${ctx.tmp}`);
  return 0;
}

// The full run: steps 1, 2, 4, 4b, 5, 6, observations, then cleanup. Exit 1 when any check failed.
async function fullRun() {
  const tBuild = Date.now();
  buildProject();
  observe('project built (4 clips via static ffmpeg)', `${Date.now() - tBuild} ms in ${ctx.tmp}`);
  const detach = startServer();
  observe('time from `yap serve --detach` to the URL being printed', `${detach.ms} ms`);
  if (detach.r.code !== 0 || !detach.info) {
    record('1.detach-prints-url', false, `exit ${detach.r.code}, stdout "${detach.r.out}", stderr "${detach.r.err}"`);
    return 1;
  }
  ctx.postersWatch = waitForPosters(15000);
  await step1(detach);
  await step1b();
  await step2();
  await step4();
  await step4b();
  await step5();
  await step6();
  const rss = spawnSync('ps', ['-o', 'rss=', '-p', String(ctx.pid)], { encoding: 'utf8' }).stdout.trim();
  observe('server resident memory after the run', `${rss} KB (${(Number(rss) / 1024).toFixed(1)} MB)`);
  observe('manifest.json size', `${fs.statSync(path.join(ctx.slugDir, 'manifest.json')).size} bytes`);
  if (ctx.stream) { observe('events received on the stream', ctx.stream.events.map((e) => e.event).join(',')); ctx.stream.close(); ctx.stream = null; }
  const stopMs = stopPid(ctx.pid);
  observe('time for the server to stop on SIGTERM', `${stopMs} ms; server.json removed: ${!fs.existsSync(path.join(ctx.slugDir, 'state', 'server.json'))}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`TOTAL: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  return failed.length ? 1 : 0;
}

// Entry: picks the mode, and makes sure cleanup runs on every way out.
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--stop') return stopKept(args[1]);
  requireTools();
  process.on('SIGINT', () => { console.log('interrupted: stopping the server and removing the temp folder'); ctx.keep = false; cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (err) => { console.error(`unexpected error: ${err && err.stack}`); cleanup(); process.exit(1); });
  process.on('unhandledRejection', (err) => { console.error(`unexpected error: ${err && err.stack}`); cleanup(); process.exit(1); });
  if (args[0] === '--keep') return keepRunning();
  if (args.length) { console.error('usage: node tests/phase2-acceptance.cjs [--keep | --stop <tmpdir>]'); return 2; }
  try {
    return await fullRun();
  } finally {
    cleanup();
  }
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error(err && err.stack); cleanup(); process.exitCode = 1; });
