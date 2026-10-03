'use strict';
// The local server: guard, router, the placeholder page, and start/stop. Later tasks add rows to ROUTES.
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createGuard, readJsonBody } = require('../lib/http-guard.cjs');
const { newManifest, saveManifest, loadManifest } = require('../lib/manifest.cjs');
const { slugChapterId } = require('../lib/chapter.cjs');
const { scanChapter } = require('../lib/chapter-scan.cjs');
const { serveFile, safeChapterFile } = require('../lib/range.cjs');
const { createHub } = require('../lib/sse.cjs');
const { API_ROUTES } = require('./api.cjs');

// Headers put on every response, whatever the route.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

// Escapes text so it is safe to put inside HTML.
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Sends a JSON answer.
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// Builds the placeholder page from the manifest only: every text escaped, a video for each ready chapter, no scripts.
function renderPage(manifest) {
  const items = manifest.chapters.map((c) => {
    const video = c.status === 'ready' ? `<video controls preload="metadata" src="/chapters/${encodeURIComponent(c.id)}/video"></video>` : '';
    return `<li><h2>${escapeHtml(c.title)}</h2><p>${escapeHtml(c.status)}</p>${video}</li>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(manifest.title)}</title></head>` +
    `<body><h1>${escapeHtml(manifest.title)}</h1><ul>${items.join('')}</ul></body></html>`;
}

// GET /: with the key in the query, remember it in a cookie and redirect so it leaves the address bar; otherwise the page.
function handleHome({ req, res, url, state }) {
  if (url.searchParams.has('key')) {
    res.writeHead(302, { 'Set-Cookie': `yap_key_${state.port}=${state.key}; HttpOnly; SameSite=Strict; Path=/`, Location: '/' });
    return res.end();
  }
  const manifest = loadManifest(path.join(state.slugDir, 'manifest.json'));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderPage(manifest));
}

// GET /api/ping: tells a caller (the --detach check) this really is a yap server and which process runs it.
function handlePing({ res }) {
  sendJson(res, 200, { ok: true, pid: process.pid });
}

// Fixed file name and content type for each kind of chapter media.
const MEDIA = {
  video: { file: 'chapter.mp4', contentType: 'video/mp4' },
  poster: { file: 'poster.jpg', contentType: 'image/jpeg' },
  captions: { file: 'captions.vtt', contentType: 'text/vtt; charset=utf-8' },
};

// True when id is a plain valid chapter id (slug rule) listed in the manifest; the row is returned, else null.
function findChapterRow(state, id) {
  try { if (slugChapterId(id) !== id) return null; } catch { return null; }
  const manifest = loadManifest(path.join(state.slugDir, 'manifest.json'));
  return manifest.chapters.find((c) => c.id === id) || null;
}

// Makes a handler that sends one kind of chapter media. The path is built only from the slug folder, the checked id and
// a fixed file name. The video also has to be ready right now (checked again on disk), not just in the manifest.
function mediaHandler(kind) {
  const { file, contentType } = MEDIA[kind];
  return async ({ req, res, params, state }) => {
    const row = findChapterRow(state, params.id);
    const dir = row && path.join(state.slugDir, 'chapters', row.id);
    const ok = row && (kind !== 'video' || (row.status === 'ready' && scanChapter(dir).status === 'ready'));
    const real = ok && safeChapterFile(dir, file);
    if (!real) return sendJson(res, 404, { error: 'not found' });
    // Test hook: lets a test change the file after the check and before the open.
    if (state.deps.afterCheck) await state.deps.afterCheck();
    await serveFile(req, res, real.path, { contentType, identity: real, createReadStream: state.deps.createReadStream });
  };
}

// The route table. A row is { method, pattern, handler }. pattern is a path; a segment like ":id" matches any one
// segment and arrives in params.id. handler gets { req, res, url, params, state, sendJson, readJsonBody }, may be async.
const ROUTES = [
  { method: 'GET', pattern: '/', handler: handleHome },
  { method: 'GET', pattern: '/api/ping', handler: handlePing },
  { method: 'GET', pattern: '/chapters/:id/video', handler: mediaHandler('video') },
  { method: 'HEAD', pattern: '/chapters/:id/video', handler: mediaHandler('video') },
  { method: 'GET', pattern: '/chapters/:id/poster', handler: mediaHandler('poster') },
  { method: 'GET', pattern: '/chapters/:id/captions', handler: mediaHandler('captions') },
  ...API_ROUTES,
];

// Tries to match a path against a pattern; returns the params object or null.
function matchPattern(pattern, pathname) {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':') && got[i] !== '') {
      try { params[want[i].slice(1)] = decodeURIComponent(got[i]); } catch { return null; }
    } else if (want[i] !== got[i]) return null;
  }
  return params;
}

// Finds what to run for a request: the handler and params, or { status: 404 | 405 }.
function route(routes, method, pathname) {
  let pathMatched = false;
  for (const row of routes) {
    const params = matchPattern(row.pattern, pathname);
    if (!params) continue;
    if (row.method === method) return { row, params };
    pathMatched = true;
  }
  return { status: pathMatched ? 405 : 404 };
}

// Answers a handler's failure: a known status error keeps its short message, anything else becomes a plain 500 (real error to stderr).
function answerError(res, err) {
  if (res.headersSent) return res.end();
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) return sendJson(res, err.status, { error: String(err.message).replace(/\s+/g, ' ') });
  process.stderr.write(`yap server: ${err && err.stack ? err.stack : err}\n`);
  sendJson(res, 500, { error: 'internal error' });
}

// Builds the request listener: security headers, guard, then the router. Everything sits inside one try so a
// throw (or a rejected handler) can never become an unhandled rejection that stops the process.
function makeListener(state, routes, guard) {
  return async (req, res) => {
    try {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
      const verdict = guard.check(req);
      if (!verdict.ok) return sendJson(res, verdict.status, { error: verdict.reason });
      let url;
      try { url = new URL(req.url, 'http://placeholder'); } catch { return sendJson(res, 400, { error: 'bad request' }); }
      const hit = route(routes, req.method, url.pathname);
      if (hit.status === 404) return sendJson(res, 404, { error: 'not found' });
      if (hit.status === 405) return sendJson(res, 405, { error: 'method not allowed' });
      // The handler's readJsonBody knows its response, so a 413/408 can be answered before the socket is dropped.
      const readBody = (r, opts) => readJsonBody(r, { ...opts, res });
      await hit.row.handler({ req, res, url, params: hit.params, state, sendJson, readJsonBody: readBody });
    } catch (err) {
      try { answerError(res, err); } catch { res.destroy(); }
    }
  };
}

// Loads the manifest, or creates and saves a fresh one when the file is absent. A file that is there but bad stops the start.
function ensureManifest(slugDir) {
  const file = path.join(slugDir, 'manifest.json');
  if (fs.existsSync(file)) return loadManifest(file);
  const m = newManifest({ title: path.basename(slugDir), slug: path.basename(slugDir), audience: 'beginner' });
  saveManifest(file, m);
  return m;
}

// Writes state/server.json readable by the owner only. It is written as a new file (flag wx, mode 0600) next to the
// target and renamed over it, so a link or an old looser file is replaced, never followed or edited.
// Refuses when state/ is itself a link.
function writeServerInfo(slugDir, info) {
  const dir = path.join(slugDir, 'state');
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('the state folder is a symbolic link; refusing to start');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'server.json');
  const tmp = path.join(dir, `.server.json.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(info, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return file;
}

// Makes the one queue every manifest change goes through: each job loads the file, changes it with a pure function from
// lib/manifest.cjs (the change may be async), and saves it atomically, one job at a time. A job that fails does not stop the jobs behind it.
function makeManifestQueue(slugDir, deps) {
  const file = path.join(slugDir, 'manifest.json');
  let tail = Promise.resolve();
  return (change) => {
    const job = tail.then(async () => {
      const next = await change(loadManifest(file));
      if (deps.beforeSave) await deps.beforeSave();
      saveManifest(file, next, deps.fs ? { fs: deps.fs } : undefined);
      return next;
    });
    tail = job.catch(() => {});
    return job;
  };
}

// Starts the server on 127.0.0.1 and resolves with { url, key, port, close() }.
// deps (all optional, for tests): routes replaces the route table; now is a clock in ms; pingMs is the stream ping
// interval; fs is used to save the manifest; beforeSave is awaited between change and save (tests); logError receives unexpected save failures.
async function startServer({ slugDir, key = crypto.randomBytes(16).toString('hex'), port = 0, deps = {} }) {
  ensureManifest(slugDir);
  const routes = deps.routes || ROUTES;
  const server = http.createServer();
  // Slow headers or a slow request must not tie the server up (a video download is a response, so it is not affected).
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const bound = server.address();
  const actualPort = bound.port;
  const hub = createHub({ pingMs: deps.pingMs });
  const state = {
    slugDir, key, port: actualPort, deps, hub, lastHeartbeat: null,
    updateManifest: makeManifestQueue(slugDir, deps),
    logError: deps.logError || ((err) => process.stderr.write(`yap server: ${err && err.stack ? err.stack : err}\n`)),
  };
  server.on('request', makeListener(state, routes, createGuard({ key, port: actualPort })));
  const url = `http://127.0.0.1:${actualPort}/?key=${key}`;
  let infoFile;
  try {
    infoFile = writeServerInfo(slugDir, { url, key, port: actualPort, pid: process.pid, started_at: new Date().toISOString() });
  } catch (err) {
    server.close();
    throw err;
  }
  // Stops the server, drops open connections so the port is freed, and removes state/server.json.
  const close = () => new Promise((resolve) => {
    fs.rmSync(infoFile, { force: true });
    hub.close();
    server.close(() => resolve());
    server.closeAllConnections();
  });
  return { url, key, port: actualPort, address: bound.address, family: bound.family, server, state, close };
}

module.exports = { startServer, ROUTES, sendJson, escapeHtml };
