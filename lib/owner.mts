// The oldguy server lives only as long as the Claude Code session that started it. The SessionStart hook finds that
// session's Claude Code process (findClaudePid) and records it; `oldguy serve` watches it (watchOwner) and shuts down
// cleanly once it is gone, so nothing keeps running after Claude Code stops.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pidAlive } from './ask-server.mts';

// One row of the process table: the parent pid, the command name and the full command line.
type ProcRow = { ppid: number; comm: string; args: string };
// Looks one pid up in the process table; null when it is not there.
type Lookup = (pid: number) => ProcRow | null;
// What watchOwner needs: whom to watch, how often, how to tell, and what to do when the owner is gone.
type WatchOptions = { pid: number; intervalMs?: number; isAlive?: (pid: number) => boolean; onGone: () => void };

// How far up the process tree to look; Claude Code is normally the parent or grandparent.
const MAX_DEPTH = 12;

// The real lookup: `ps -o ppid=,comm=,args= -p <pid>`, the same on Linux and macOS.
function psLookup(pid: number): ProcRow | null {
  const out = execFileSync('ps', ['-o', 'ppid=,comm=,args=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).trim();
  const m = /^(\d+)\s+(\S+)\s+(.*)$/.exec(out);
  return m ? { ppid: Number(m[1]), comm: m[2], args: m[3] } : null;
}

// True when a process row is Claude Code: its command is `claude`, or it is node running a script named `claude`.
function isClaude({ comm, args }: ProcRow): boolean {
  if (path.basename(comm) === 'claude') return true;
  const [first, second] = args.split(/\s+/);
  return /^node(\.exe)?$/.test(path.basename(first || comm)) && path.basename(second || '') === 'claude';
}

// Walks up from startPid and returns the nearest Claude Code process, or null when none is found (never throws).
function findClaudePid(startPid: number, lookup: Lookup = psLookup): number | null {
  const seen = new Set<number>();
  let pid = startPid;
  try {
    for (let depth = 0; depth < MAX_DEPTH && pid > 1 && !seen.has(pid); depth++) {
      seen.add(pid);
      const row = lookup(pid);
      if (!row) return null;
      if (isClaude(row)) return pid;
      pid = row.ppid;
    }
  } catch { /* no ps, or it failed: nothing recorded */ }
  return null;
}

// Checks every intervalMs whether the owner process is still there; calls onGone once when it is not. The timer is
// unref()ed so it never keeps a process alive on its own.
function watchOwner({ pid, intervalMs = 5000, isAlive = pidAlive, onGone }: WatchOptions): { stop: () => void } {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped || isAlive(pid)) return;
    stopped = true;
    clearInterval(timer);
    onGone();
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { stop: () => { stopped = true; clearInterval(timer); } };
}

export { findClaudePid, watchOwner, isClaude };
export type { ProcRow, Lookup, WatchOptions };
