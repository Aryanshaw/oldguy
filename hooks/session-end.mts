// SessionEnd hook: when Claude Code exits, stop the oldguy server of every video in this project, so nothing keeps running
// without a session to answer the chat. It only signals a server that answers as this folder's real oldguy server (a
// stale server.json can never get another process killed), and every path ends in exit 0.
import fs from 'node:fs';
import path from 'node:path';
import { readStdin, parseInput } from './stdin.mts';

// Sends SIGTERM to the live oldguy server of each video folder under <cwd>/.oldguy; the server closes cleanly on it.
async function stopServers(cwd: string): Promise<void> {
  // loaded here, not at the top, so even a missing library file ends in the quiet exit 0 below
  const { liveServer } = await import('../lib/live-server.mts');
  const base = path.join(cwd, '.oldguy');
  let folders: string[] = [];
  try {
    folders = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(base, e.name));
  } catch { /* no .oldguy folder: nothing to stop */ }
  for (const slugDir of folders) {
    const live = await liveServer(slugDir, { pingMs: 500, totalMs: 1500 });
    if (live && 'pid' in live) {
      try { process.kill(live.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  }
}

// Does the hook's work; the caller turns any failure into a quiet exit 0.
async function main(): Promise<void> {
  const input = parseInput(await readStdin());
  if (input && typeof input.cwd === 'string' && path.isAbsolute(input.cwd)) await stopServers(input.cwd);
}

main().catch(() => {}).finally(() => process.exit(0));
