// A machine-wide limit on heavy work (speech and recording): at most `cap` holders at once, across every oldguy process.
// A slot is a lock file holding its owner's pid; a lock whose process is gone (or that cannot be read) counts as free,
// so a crash never leaves a slot taken. Chapter subagents may run in parallel; this keeps the laptop responsive.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pidAlive } from './ask-server.mts';

// What acquireSlot needs: where the locks live, how many may run, who is asking, and how to wait.
type SlotOptions = { dir?: string; cap: number; pid?: number; isAlive?: (pid: number) => boolean; pollMs?: number; onWait?: (inUse: number) => void };

// The default lock folder: one per machine, shared by every project.
const DEFAULT_DIR = path.join(os.tmpdir(), 'oldguy-slots');

// Reads the pid in a lock file, or null when it is missing or not a whole number.
function lockPid(file: string): number | null {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  } catch {
    return null;
  }
}

// Tries each slot once: takes a free one (and frees a dead holder's) and returns its file, or null when all are taken.
function tryTake(dir: string, cap: number, pid: number, isAlive: (pid: number) => boolean): string | null {
  for (let n = 0; n < cap; n++) {
    const file = path.join(dir, `${n}.lock`);
    try {
      fs.writeFileSync(file, String(pid), { flag: 'wx' });
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const holder = lockPid(file);
    if (holder === null || !isAlive(holder)) {
      // the holder is gone: remove its lock and try this slot again (another process may win it, which is fine)
      fs.rmSync(file, { force: true });
      try { fs.writeFileSync(file, String(pid), { flag: 'wx' }); return file; } catch { /* taken meanwhile */ }
    }
  }
  return null;
}

// Waits for a free slot and resolves a release function; release only removes the lock while it is still ours.
async function acquireSlot({ dir = DEFAULT_DIR, cap, pid = process.pid, isAlive = pidAlive, pollMs = 500, onWait }: SlotOptions): Promise<() => void> {
  const limit = Math.max(1, Math.floor(cap));
  fs.mkdirSync(dir, { recursive: true });
  let told = false;
  for (;;) {
    const file = tryTake(dir, limit, pid, isAlive);
    if (file) return () => { if (lockPid(file) === pid) fs.rmSync(file, { force: true }); };
    if (!told && onWait) { onWait(limit); told = true; }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// Runs work inside a slot and frees the slot afterwards, whether the work succeeds or throws.
async function withSlot<T>(opts: SlotOptions, work: () => Promise<T>): Promise<T> {
  const release = await acquireSlot(opts);
  try {
    return await work();
  } finally {
    release();
  }
}

export { acquireSlot, withSlot };
export type { SlotOptions };
