'use strict';
// Keeps manifest.json in step with the chapter folders: the watcher's changes become manifest rows, and each ready
// chapter gets a poster picture afterwards. Every manifest change goes through state.updateManifest.
const path = require('node:path');
const { insertChapter, reorderChapters, setChapterFields, loadManifest } = require('../lib/manifest.cjs');
const { readOrder, scanChapter } = require('../lib/chapter-scan.cjs');
const { extractPoster, ffmpegPath, posterTime } = require('../lib/poster.cjs');

// Turns the folder's status into the row's status. An idle folder never wipes a failure that was reported earlier.
function mapStatus(scanStatus, rowStatus) {
  return scanStatus === 'pending' && rowStatus === 'failed' ? 'failed' : scanStatus;
}

// A brand new row for a chapter folder the manifest does not know yet.
function newRow(c) {
  return {
    id: c.id, title: c.title || c.id, parent_id: null, placement_reason: 'core', status: mapStatus(c.status, null), quality: 'draft',
    duration_s: c.durationS, build_sha256: c.buildSha256, verified_against_commit: c.verifiedAgainstCommit,
    video: null, captions: null, poster: null, question: null,
  };
}

// Adds a new row right after the nearest earlier chapter (in folder order) that is already listed. With none earlier it goes
// first when order.json named it, otherwise last. Existing rows keep their places.
function placeRow(m, row, order, listed) {
  const mine = order.indexOf(row.id);
  const have = new Set(m.chapters.map((c) => c.id));
  let after;
  for (let i = mine - 1; i >= 0; i--) if (have.has(order[i])) { after = order[i]; break; }
  const next = insertChapter(m, row, after === undefined ? {} : { after });
  if (after !== undefined || !listed.has(row.id)) return next;
  return reorderChapters(next, [row.id, ...m.chapters.map((c) => c.id)]);
}

// Builds the sync: onChange(diff) for the watcher, stop() to wind it down, and posterIdle() that resolves when no poster
// work is waiting.
function makeChapterSync(state) {
  const { slugDir, deps } = state;
  const manifestFile = path.join(slugDir, 'manifest.json');
  // Poster jobs queued or running, keyed "<id>@<build>", so one build never gets two extractions at once.
  const attempted = new Set();
  let posterTail = Promise.resolve();
  let closed = false;
  const abort = new AbortController();

  // Applies one diff to the manifest. Fills `jobs` with chapters that need a poster and `lost` with ids whose folder is gone.
  // A ready row without a poster means "take one"; the manifest queue sets video and captions (only when ready) and clears the poster of any row that is not ready.
  function applyDiff(m, diff, jobs, lost) {
    const listed = new Set(readOrder(slugDir).ids || []);
    let next = m;
    for (const c of [...diff.added, ...diff.changed]) {
      const row = next.chapters.find((r) => r.id === c.id);
      if (c.status === 'ready' && (!row || !row.poster || row.build_sha256 !== c.buildSha256)) jobs.push(c);
      if (!row) { next = placeRow(next, newRow(c), diff.order, listed); continue; }
      const patch = { status: mapStatus(c.status, row.status), duration_s: c.durationS, build_sha256: c.buildSha256, verified_against_commit: c.verifiedAgainstCommit };
      // The chapter folder is the source of truth for the title once it exists.
      if (typeof c.title === 'string' && c.title !== '' && c.title !== row.title) patch.title = c.title;
      next = setChapterFields(next, c.id, patch);
    }
    for (const id of diff.removed) {
      if (!next.chapters.some((r) => r.id === id)) continue;
      next = setChapterFields(next, id, { status: 'failed' });
      lost.push(id);
    }
    return next;
  }

  // Tells the open tabs; a failure here is only logged because the change is already stored.
  function tell(data) {
    try { state.hub.broadcast('chapter', { op: 'scan', ...data }); } catch (err) { state.logError(err); }
  }

  // True when the folder still shows this chapter ready with this exact build, and the manifest row says the same.
  function stillCurrent(c) {
    const now = scanChapter(path.join(slugDir, 'chapters', c.id));
    if (now.status !== 'ready' || now.buildSha256 !== c.buildSha256) return false;
    const row = loadManifest(manifestFile).chapters.find((r) => r.id === c.id);
    return Boolean(row) && row.status === 'ready' && row.build_sha256 === c.buildSha256;
  }

  // Takes one poster picture and records it in the manifest. The frame is only put in place if, just before that, the
  // chapter is still ready with the same build and the server is still open. Failures are logged and change nothing.
  async function takePoster(c, key) {
    const dir = path.join(slugDir, 'chapters', c.id);
    try {
      if (closed || !stillCurrent(c)) return;
      const placed = await extractPoster({
        ffmpeg: deps.ffmpeg || ffmpegPath(), mp4: path.join(dir, 'chapter.mp4'), out: path.join(dir, 'poster.jpg'), atS: posterTime(c.durationS),
        exec: deps.exec, signal: abort.signal, beforeCommit: () => !closed && stillCurrent(c),
      });
      if (!placed || closed) return;
      const manifest = await state.updateManifest((m) => {
        const row = m.chapters.find((r) => r.id === c.id);
        return row && row.status === 'ready' && row.build_sha256 === c.buildSha256 ? setChapterFields(m, c.id, { poster: `chapters/${c.id}/poster.jpg` }) : m;
      });
      tell({ id: c.id, manifest });
    } catch (err) {
      if (!closed) state.logError(err);
    } finally {
      attempted.delete(key);
    }
  }

  // Queues poster pictures one at a time, skipping a build that is already queued or running. Nothing is queued once closed.
  function queuePosters(jobs) {
    if (closed) return;
    for (const c of jobs) {
      const key = `${c.id}@${c.buildSha256}`;
      if (attempted.has(key)) continue;
      attempted.add(key);
      posterTail = posterTail.then(() => takePoster(c, key));
    }
  }

  // The watcher's callback: one manifest job for the whole diff, then the news, then (not waited for) the posters.
  async function onChange(diff) {
    const jobs = [];
    const lost = [];
    // the job may run again, so it starts from empty lists each time
    const manifest = await state.updateManifest((m) => { jobs.length = 0; lost.length = 0; return applyDiff(m, diff, jobs, lost); });
    if (diff.added.length || diff.changed.length) tell({ manifest });
    for (const id of lost) tell({ id, reason: 'chapter folder is missing', manifest });
    queuePosters(jobs);
  }

  // Closes the queue: no new job starts, a running ffmpeg is told to stop, and a frame that finishes later is thrown away.
  function stop() {
    closed = true;
    abort.abort();
  }

  return { onChange, stop, posterIdle: () => posterTail };
}

module.exports = { makeChapterSync };
