'use strict';
// `yap serve [--dir <slugDir>] [--detach]`: runs the local server in the foreground, or as a background process.
const fs = require('node:fs');
const net = require('node:net');
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

// True when a process with this id exists.
function pidAlive(pid) {
  try { process.kill(pid, 0); return Number.isInteger(pid); } catch (err) { return err.code === 'EPERM'; }
}

// True when something accepts connections on this local port.
function portAnswers(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

// Returns the info of a server that is really running for this folder, or null (stale file).
async function liveServer(slugDir) {
  const info = readInfo(slugDir);
  return info && pidAlive(info.pid) && await portAnswers(info.port) ? info : null;
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
    const info = readInfo(slugDir);
    if (info && pidAlive(info.pid)) { process.stdout.write(`${info.url}\n`); return 0; }
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
