'use strict';
// The security checks for the local server: who may call it (host, origin, key) and how request bodies are read.
const crypto = require('node:crypto');

// Makes an Error that carries an HTTP status for the caller to answer with.
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// True when two strings are equal, compared in constant time; different lengths are simply "not equal".
function sameKey(given, key) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(key));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Reads the key a request presents: header first, then the yap_key cookie, then the ?key= query. Returns '' when none.
function presentedKey(req) {
  if (typeof req.headers['x-yap-key'] === 'string') return req.headers['x-yap-key'];
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'yap_key') return rest.join('=');
  }
  return new URL(req.url, 'http://placeholder').searchParams.get('key') || '';
}

// Builds the guard for one running server. check(req) says whether to let a request in: Host first, then (for anything
// that is not a plain read) Origin, then the key. A refusal is always 403 with a short reason that does not say more.
function createGuard({ key, port }) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const origins = hosts.map((h) => `http://${h}`);
  const refuse = (reason) => ({ ok: false, status: 403, reason });
  return {
    check(req) {
      // Only our own address is a valid Host; this stops a hostile site that was pointed at 127.0.0.1 by DNS.
      const host = req.headers.host;
      if (typeof host !== 'string' || !hosts.includes(host.toLowerCase())) return refuse('forbidden');
      // A page in another tab can send a POST here; its Origin gives it away (Origin: null is refused too).
      const changes = req.method !== 'GET' && req.method !== 'HEAD';
      const origin = req.headers.origin;
      if (changes && origin !== undefined && !origins.includes(origin.toLowerCase())) return refuse('forbidden');
      if (!sameKey(presentedKey(req), key)) return refuse('forbidden');
      return { ok: true, status: 200, reason: '' };
    },
  };
}

// Reads a request body that must be one JSON object. Rejects with an Error carrying `status`:
// 415 wrong content type, 413 too big, 400 not a JSON object, 408 too slow.
// On 413/408 it stops reading and destroys the request (the caller answers first, then the socket is dropped).
function readJsonBody(req, { maxBytes = 65536, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return reject(httpError(415, 'content-type must be application/json'));
    if (Number(req.headers['content-length']) > maxBytes) return reject(abandon(req, httpError(413, 'body too large')));
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => finish(abandon(req, httpError(408, 'body timed out'))), timeoutMs);
    // Ends the read once: stops the timer and listeners, then settles the promise.
    function finish(err, value) {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', finish);
      req.off('close', onClose);
      if (err) reject(err); else resolve(value);
    }
    // Collects a piece of the body, giving up as soon as it passes the cap.
    function onData(chunk) {
      size += chunk.length;
      if (size > maxBytes) return finish(abandon(req, httpError(413, 'body too large')));
      chunks.push(chunk);
    }
    // Parses the whole body once it has arrived; only a JSON object is accepted.
    function onEnd() {
      let obj;
      try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish(httpError(400, 'body is not valid JSON')); }
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return finish(httpError(400, 'body must be a JSON object'));
      finish(null, obj);
    }
    // The client hung up before finishing.
    function onClose() {
      finish(httpError(400, 'request ended early'));
    }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', finish);
    req.on('close', onClose);
  });
}

// Marks a request to be dropped: no more reading now, and the socket is destroyed once the response has gone out.
function abandon(req, err) {
  req.pause();
  req.removeAllListeners('data');
  const res = req.res;
  if (res) res.once('finish', () => req.destroy());
  else setImmediate(() => req.destroy());
  return err;
}

module.exports = { createGuard, readJsonBody };
