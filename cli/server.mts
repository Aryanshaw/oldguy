// `yap serve [--dir <slugDir>] [--detach]`: runs the local server in the foreground, or as a background process.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseFlags } from './args.mts';
import { readInfo, liveServer } from '../lib/live-server.mts';
import type { RunningServer } from '../server/types.mts';

const USAGE = 'usage: yap serve [--dir <slugDir>] [--detach]';

// Finds the folder of one video: --dir if given, else the only folder under ./.yap/ that holds chapters/.
// Throws a one-line Error when there is none or more than one.
function resolveSlugDir(dirFlag: string | undefined, cwd: string = process.cwd()): string {
  if (dirFlag) return path.resolve(cwd, dirFlag);
  const base = path.join(cwd, '.yap');
  let found: string[] = [];
  try {
    found = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(base, e.name, 'chapters')))
      .map((e) => path.join(base, e.name));
  } catch { /* no .yap folder */ }
  if (found.length !== 1) throw new Error(`${found.length === 0 ? 'no video folder found under .yap/' : 'more than one video folder under .yap/'}; pass --dir <slugDir>`);
  return found[0];
}

// Runs the server until SIGINT or SIGTERM, then closes it cleanly.
async function serveForeground(slugDir: string): Promise<number> {
  // loaded only here, so the other commands never pay for the server's code
  const { startServer } = await import('../server/server.mts');
  let srv: RunningServer;
  try {
    srv = await startServer({ slugDir });
  } catch (err) {
    // A server already runs here: say so, show where it is (when known), and stop with 1 (not the usage-error 2).
    // startServer throws an Error carrying alreadyRunning and the url when a server already runs here
    const refused = err as { alreadyRunning?: boolean; message: string; url?: string } | null;
    if (!refused || !refused.alreadyRunning) throw err;
    process.stderr.write(`yap serve: ${refused.message}\n`);
    if (refused.url) process.stdout.write(`${refused.url}\n`);
    return 1;
  }
  process.stdout.write(`${srv.url}\n`);
  await new Promise<void>((resolve) => {
    const stop = () => { srv.close().then(resolve); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

// Starts the same command as a detached child and waits up to 10 s for its state/server.json; reuses a live server.
async function serveDetached(slugDir: string): Promise<number> {
  const existing = await liveServer(slugDir);
  if (existing && 'busy' in existing) { process.stderr.write('a server for this folder is running but not answering\n'); return 1; }
  if (existing) { process.stdout.write(`${existing.url}\n`); return 0; }
  // Remove a stale file first, so a new file can only be the child's.
  fs.rmSync(path.join(slugDir, 'state', 'server.json'), { force: true });
  const bin = path.join(import.meta.dirname, '..', 'bin', 'yap.cjs');
  const child = spawn(process.execPath, [bin, 'serve', '--dir', slugDir], { detached: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const up = await liveServer(slugDir);
    if (up && !('busy' in up)) { process.stdout.write(`${up.url}\n`); return 0; }
    await new Promise((r) => setTimeout(r, 50));
  }
  process.stderr.write('yap serve: the server did not start within 10 seconds\n');
  return 1;
}

// The `yap serve` command. --detach takes no value, so it is taken out before the flags are parsed.
async function runServe(args: string[]): Promise<number> {
  const detach = args.includes('--detach');
  try {
    const { positional, flags } = parseFlags(args.filter((a) => a !== '--detach'), ['--dir']);
    if (positional.length) throw new Error(USAGE);
    const slugDir = resolveSlugDir(flags['--dir']);
    return await (detach ? serveDetached(slugDir) : serveForeground(slugDir));
  } catch (err) {
    process.stderr.write(`yap serve: ${String((err as Error).message).replace(/\s*\n\s*/g, ' ')}\n`);
    return 2;
  }
}

export { runServe, resolveSlugDir, readInfo, liveServer };
