// Watches the chapter folders by looking again every second (native file watchers are unreliable on temp and network
// folders) and tells the caller what changed since the last look.
import { scanProject } from './chapter-scan.mts';
import type { ProjectScan, ScannedChapter } from './chapter-scan.mts';

// What changed since the last look; `first` is set on the very first look, which reports every chapter as added.
type Diff = { added: ScannedChapter[]; changed: ScannedChapter[]; removed: string[]; order: string[]; first?: true };
// What startWatcher needs: where to look, who to tell, and (for tests) a different scanner, logger and timers.
type WatcherOptions = {
  slugDir: string;
  onChange: (diff: Diff) => unknown;
  intervalMs?: number;
  scan?: (slugDir: string) => ProjectScan;
  logError?: (err: unknown) => void;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
};
// The handle startWatcher gives back.
type Watcher = { stop: () => void; pollNow: () => Promise<void>; idle: () => Promise<void> };

// Compares this scan with the last one: new folders, folders whose status or build hash differ, and folders now gone.
function diffScans(prev: Map<string, ScannedChapter>, scanResult: ProjectScan): Diff {
  const now = new Map(scanResult.chapters.map((c) => [c.id, c]));
  const added = scanResult.chapters.filter((c) => !prev.has(c.id));
  const changed = scanResult.chapters.filter((c) => {
    const old = prev.get(c.id);
    return old && (old.status !== c.status || old.buildSha256 !== c.buildSha256);
  });
  const removed = [...prev.keys()].filter((id) => !now.has(id));
  return { added, changed, removed, order: scanResult.order };
}

// True when the diff says nothing happened.
function isEmpty(diff: Diff): boolean {
  return !diff.added.length && !diff.changed.length && !diff.removed.length;
}

// Starts looking every intervalMs. onChange(diff) runs when something changed, and on the first look even if nothing did (the first look reports every chapter
// as added, with diff.first set). Returns { stop(), pollNow(), idle() }; pollNow runs one look right away and returns a Promise for it.
function startWatcher({
  slugDir, onChange, intervalMs = 1000, scan = scanProject, logError = () => {},
  setInterval: setTimer = setInterval, clearInterval: clearTimer = clearInterval,
}: WatcherOptions): Watcher {
  let prev = new Map<string, ScannedChapter>();
  let stopped = false;
  let waiting = 0;
  let first = true;
  let tail = Promise.resolve();

  // One look. Errors are logged and swallowed so the next look still happens. The remembered scan only moves forward
  // once onChange has accepted the change, so a failed hand-over is offered again next time.
  async function poll(): Promise<void> {
    if (stopped) return;
    try {
      const result = scan(slugDir);
      const diff = diffScans(prev, result);
      // The very first look is always reported (diff.first), even when it is empty, so the caller can check rows against the folders.
      if (first) diff.first = true;
      if (!isEmpty(diff) || diff.first) await onChange(diff);
      first = false;
      prev = new Map(result.chapters.map((c) => [c.id, c]));
    } catch (err) {
      try { logError(err); } catch { /* logging must never stop the watcher */ }
    }
  }

  // Queues one look behind any look still running, so two never overlap.
  function pollNow(): Promise<void> {
    waiting++;
    const run = tail.then(poll);
    tail = run.then(() => { waiting--; });
    return run;
  }

  const timer = setTimer(() => { if (waiting === 0) pollNow(); }, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();

  // Stops the timer; a look already running finishes, but none starts afterwards.
  function stop(): void {
    stopped = true;
    clearTimer(timer);
  }

  // Resolves when every look queued so far has finished.
  const idle = () => tail;

  return { stop, pollNow, idle };
}

export { startWatcher };
export type { Diff, WatcherOptions, Watcher };
