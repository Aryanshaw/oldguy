'use strict';
// `yap serve [--dir <slugDir>] [--detach]`: runs the local server in the foreground, or as a background process.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseFlags } = require('./args.cjs');
const { readInfo, liveServer } = require('../lib/live-server.cjs');

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

// Runs the server until SIGINT or SIGTERM, then closes it cleanly.
async function serveForeground(slugDir) {
  const { startServer } = require('../server/server.cjs');
  let srv;
  try {
    srv = await startServer({ slugDir });
  } catch (err) {
    // A server already runs here: say so, show where it is (when known), and stop with 1 (not the usage-error 2).
    if (!err || !err.alreadyRunning) throw err;
    process.stderr.write(`yap serve: ${err.message}\n`);
    if (err.url) process.stdout.write(`${err.url}\n`);
    return 1;
  }
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
  if (existing && existing.busy) { process.stderr.write('a server for this folder is running but not answering\n'); return 1; }
  if (existing) { process.stdout.write(`${existing.url}\n`); return 0; }
  // Remove a stale file first, so a new file can only be the child's.
  fs.rmSync(path.join(slugDir, 'state', 'server.json'), { force: true });
  const bin = path.join(__dirname, '..', 'bin', 'yap.cjs');
  const child = spawn(process.execPath, [bin, 'serve', '--dir', slugDir], { detached: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const up = await liveServer(slugDir);
    if (up && !up.busy) { process.stdout.write(`${up.url}\n`); return 0; }
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

module.exports = { runServe, resolveSlugDir, readInfo, liveServer };
