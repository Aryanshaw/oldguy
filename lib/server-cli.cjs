'use strict';
// `yap serve [--dir <slugDir>] [--detach]`: runs the local server in the foreground, or as a background process.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseFlags } = require('./cli-args.cjs');

const USAGE = 'usage: yap serve [--dir <slugDir>] [--detach]';

// Finds the folder of one video: --dir if given, else the only folder under ./.yap/ that holds chapters/.
// Throws a one-line Error when there is none or more than one.
function resolveSlugDir(dirFlag, cwd = process.cwd()) {
  if (dirFlag) return path.resolve(cwd, dirFlag);
  const base = path.join(cwd, '.yap');
  let found = [];
  try {
    found = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(base, e.name, 'chapters')))
      .map((e) => path.join(base, e.name));
  } catch { /* no .yap folder */ }
  if (found.length !== 1) throw new Error(`${found.length === 0 ? 'no video folder found under .yap/' : 'more than one video folder under .yap/'}; pass --dir <slugDir>`);
  return found[0];
}

// Reads state/server.json, or null when it is missing or unreadable.
function readInfo(slugDir) {
  try { return JSON.parse(fs.readFileSync(path.join(slugDir, 'state', 'server.json'), 'utf8')); } catch { return null; }
}

// Asks the server on this port whether it is a yap server: GET /api/ping with the key, answering 200 {ok:true, pid}
// within 1 s. Resolves with the pid it reports, or null for anything else.
function ping(port, key) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', agent: false, timeout: 1000, headers: { host: `127.0.0.1:${port}`, 'x-yap-key': key } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { const j = JSON.parse(body); resolve(res.statusCode === 200 && j.ok === true ? j.pid : null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// Returns { url, pid } of a yap server really running for this folder, or null (missing, stale or untrustworthy file).
// The file is only a hint: the server must answer for itself with the same pid. The url is rebuilt, never copied.
async function liveServer(slugDir) {
  const info = readInfo(slugDir);
  if (!info || !Number.isInteger(info.pid) || info.pid <= 1) return null;
  if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return null;
  if (typeof info.key !== 'string' || !/^[0-9a-f]{32}$/.test(info.key)) return null;
  if (await ping(info.port, info.key) !== info.pid) return null;
  return { url: `http://127.0.0.1:${info.port}/?key=${info.key}`, pid: info.pid };
}

// Runs the server until SIGINT or SIGTERM, then closes it cleanly.
async function serveForeground(slugDir) {
  const { startServer } = require('../server/server.cjs');
  const srv = await startServer({ slugDir });
  process.stdout.write(`${srv.url}\n`);
  await new Promise((resolve) => {
    const stop = () => { srv.close().then(resolve); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

// Starts the same command as a detached child and waits up to 10 s for its state/server.json; reuses a live server.
async function serveDetached(slugDir) {
  const existing = await liveServer(slugDir);
  if (existing) { process.stdout.write(`${existing.url}\n`); return 0; }
  // Remove a stale file first, so a new file can only be the child's.
  fs.rmSync(path.join(slugDir, 'state', 'server.json'), { force: true });
  const bin = path.join(__dirname, '..', 'bin', 'yap.cjs');
  const child = spawn(process.execPath, [bin, 'serve', '--dir', slugDir], { detached: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const up = await liveServer(slugDir);
    if (up) { process.stdout.write(`${up.url}\n`); return 0; }
    await new Promise((r) => setTimeout(r, 50));
  }
  process.stderr.write('yap serve: the server did not start within 10 seconds\n');
  return 1;
}

// The `yap serve` command. --detach takes no value, so it is taken out before the flags are parsed.
async function runServe(args) {
  const detach = args.includes('--detach');
  try {
    const { positional, flags } = parseFlags(args.filter((a) => a !== '--detach'), ['--dir']);
    if (positional.length) throw new Error(USAGE);
    const slugDir = resolveSlugDir(flags['--dir']);
    return await (detach ? serveDetached(slugDir) : serveForeground(slugDir));
  } catch (err) {
    process.stderr.write(`yap serve: ${String(err.message).replace(/\s*\n\s*/g, ' ')}\n`);
    return 2;
  }
}

module.exports = { runServe, resolveSlugDir };
