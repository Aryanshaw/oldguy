'use strict';
// Tells whether a yap server is really running for a folder. Used by `yap serve` and by startServer itself.
const fs = require('node:fs');
const path = require('node:path');
const { askServer, pidAlive, usableInfo } = require('./ask-server.cjs');

// Reads state/server.json, or null when it is missing, unreadable or does not hold a usable pid, port and key.
function readInfo(slugDir) {
  try { return usableInfo(JSON.parse(fs.readFileSync(path.join(slugDir, 'state', 'server.json'), 'utf8'))); } catch { return null; }
}

// Asks the server on this port whether it is a yap server: GET /api/ping with the key. Resolves { pid } when it
// answers 200 {ok:true, pid} with a whole-number pid (anything else it says is not this server), { late: true } when it did not answer within pingMs, or null for any other answer.
// One deadline covers the whole ping and the answer is capped at 4 KB, so a trickling or endless reply cannot hold us.
async function ping(port, key, pingMs) {
  const r = await askServer({ port, key, path: '/api/ping', timeoutMs: pingMs, maxBytes: 4096 });
  if (!r.ok) return r.reason === 'timeout' ? { late: true } : null;
  try { const j = JSON.parse(r.body); return r.status === 200 && j.ok === true && Number.isInteger(j.pid) ? { pid: j.pid } : null; } catch { return null; }
}

// Returns { url, pid } of a yap server really running for this folder, null when the file is stale (missing, refused,
// or answered by something that is not this server), or { busy: true } when its process is alive but silent for
// totalMs. A live process that is only slow is never called stale: the ping is retried until totalMs has passed.
async function liveServer(slugDir, { pingMs = 1000, totalMs = 5000 } = {}) {
  const info = readInfo(slugDir);
  if (!info) return null;
  const end = Date.now() + totalMs;
  for (;;) {
    const answer = await ping(info.port, info.key, pingMs);
    if (answer && answer.pid !== undefined) {
      return answer.pid === info.pid ? { url: `http://127.0.0.1:${info.port}/?key=${info.key}`, pid: info.pid } : null;
    }
    if (!answer) return null;
    if (!pidAlive(info.pid)) return null;
    if (Date.now() >= end) return { busy: true };
  }
}

module.exports = { readInfo, ping, liveServer };
