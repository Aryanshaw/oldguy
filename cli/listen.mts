// `oldguy listen [--dir <slugDir>]`: the bridge between the player's chat and a live Claude Code session. Run under Claude
// Code's Monitor tool, every line it prints wakes Claude. It prints each open viewer event (one with no reply and no
// ack) as one JSON line, first all that are open now, then each new one once; it sends a heartbeat every few seconds
// so the page shows "Claude connected"; and when the server is gone it prints {"type":"server_stopped"} and exits 0.
import path from 'node:path';
import { parseFlags } from './args.mts';
import { resolveSlugDir } from './server.mts';
import { readInfo as readServerInfo } from '../lib/live-server.mts';
import { askServer } from '../lib/ask-server.mts';
import { openEvents } from '../lib/inbox.mts';
import type { ServerInfo } from '../lib/ask-server.mts';

// What tests may change: the timings, where lines go, and how server.json is read.
type ListenDeps = {
  pollMs?: number; heartbeatMs?: number; write?: (line: string) => void; complain?: (line: string) => void;
  readInfo?: (slugDir: string) => ServerInfo | null;
};

const USAGE = 'usage: oldguy listen [--dir <slugDir>]';
const NO_SERVER = 'no server is running: start it with `oldguy serve --detach`';
// Heartbeats refused or unanswered this many times in a row mean the server is gone.
const MAX_MISSED = 2;
const HEARTBEAT_TIMEOUT_MS = 3000;

// Runs the listener until the server is gone; resolves the exit code (0 when it stopped because the server did).
async function runListen(args: string[], deps: ListenDeps = {}): Promise<number> {
  const { pollMs = 1000, heartbeatMs = 5000 } = deps;
  const write = deps.write || ((line: string) => { process.stdout.write(`${line}\n`); });
  const complain = deps.complain || ((line: string) => { process.stderr.write(`${line}\n`); });
  const readInfo = deps.readInfo || readServerInfo;
  let slugDir: string;
  try {
    const { positional, flags } = parseFlags(args, ['--dir']);
    if (positional.length) throw new Error(`unexpected "${positional[0]}"`);
    slugDir = resolveSlugDir(flags['--dir']);
  } catch (err) {
    complain(`oldguy listen: ${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  if (!readInfo(slugDir)) { complain(NO_SERVER); return 1; }
  const state = path.join(slugDir, 'state');
  const files = { eventsFile: path.join(state, 'events.jsonl'), threadFile: path.join(state, 'thread.jsonl'), acksFile: path.join(state, 'acks.jsonl') };
  const printed = new Set<string>();

  return new Promise<number>((resolve) => {
    let stopped = false;
    let missed = 0;
    let beating = false;
    // Ends the listener once: one last line for Claude, timers cleared.
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(beatTimer);
      write(JSON.stringify({ type: 'server_stopped' }));
      resolve(0);
    };
    // Prints every open event not printed yet; a file that cannot be read is tried again on the next look.
    const look = () => {
      if (stopped) return;
      if (!readInfo(slugDir)) return stop();
      let open;
      try { open = openEvents(files); } catch { return; }
      for (const event of open) {
        if (printed.has(event.id)) continue;
        printed.add(event.id);
        write(JSON.stringify(event));
      }
    };
    // Tells the server a live session is listening; too many misses in a row mean it is gone.
    const beat = async () => {
      if (stopped || beating) return;
      beating = true;
      const info = readInfo(slugDir);
      const r = info ? await askServer({ port: info.port, key: info.key, method: 'POST', path: '/api/heartbeat', body: {}, timeoutMs: HEARTBEAT_TIMEOUT_MS, maxBytes: 4096 }) : null;
      beating = false;
      missed = r && r.ok && r.status === 200 ? 0 : missed + 1;
      if (missed >= MAX_MISSED) stop();
    };
    const pollTimer = setInterval(look, pollMs);
    const beatTimer = setInterval(() => { void beat(); }, heartbeatMs);
    look();
    void beat();
  });
}

export { runListen };
export type { ListenDeps };
