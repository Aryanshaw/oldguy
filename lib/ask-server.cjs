'use strict';
// The one way yap's own commands talk to the local server: plain http to 127.0.0.1 with the session key.
const http = require('node:http');

// Reads state/server.json fields that are safe to use (a real pid, a port and a 32-hex key), or null when they are not.
function usableInfo(info) {
  if (!info || !Number.isInteger(info.pid) || info.pid <= 1) return null;
  if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return null;
  if (typeof info.key !== 'string' || !/^[0-9a-f]{32}$/.test(info.key)) return null;
  return info;
}

// True when a process with this pid exists (permission denied still means it exists).
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

// Sends one request and always resolves, never rejects: { ok: true, status, body } with the body as text, or
// { ok: false, reason } where reason is 'refused' (nothing listens), 'timeout' (the one deadline for the whole
// request ran out, however slowly bytes arrive), 'toobig' (the answer passed maxBytes) or 'error'.
function askServer({ port, key, method = 'GET', path, body, timeoutMs, maxBytes }) {
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = { host: `127.0.0.1:${port}`, 'x-yap-key': key };
    if (payload !== undefined) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
    let req;
    let timer;
    let done = false;
    // Answers once, stops the timer and drops the connection.
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (req) req.destroy();
      resolve(result);
    };
    // One timer for the whole request: it is never reset by arriving bytes.
    timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    req = http.request({ host: '127.0.0.1', port, method, path, agent: false, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) return finish({ ok: false, reason: 'toobig' });
        chunks.push(c);
      });
      res.on('end', () => finish({ ok: true, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => finish({ ok: false, reason: 'error' }));
      res.on('aborted', () => finish({ ok: false, reason: 'error' }));
    });
    req.on('error', (err) => finish({ ok: false, reason: err.code === 'ECONNREFUSED' ? 'refused' : 'error' }));
    req.end(payload);
  });
}

module.exports = { askServer, pidAlive, usableInfo };
