'use strict';
// Keeps manifest.json in step with the chapter folders: the watcher's changes become manifest rows, and each ready
// chapter gets a poster picture afterwards. Every manifest change goes through state.updateManifest.
const path = require('node:path');
const { insertChapter, reorderChapters, setChapterFields } = require('../lib/manifest.cjs');
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
    video: `chapters/${c.id}/chapter.mp4`, captions: `chapters/${c.id}/captions.vtt`, poster: null, question: null,
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

// Builds the sync: onChange(diff) for the watcher, and posterIdle() that resolves when no poster work is waiting.
function makeChapterSync(state) {
  const { slugDir, deps } = state;
  // The build each poster picture was taken from (this run), so a rebuilt chapter gets a new picture.
  const posterBuild = new Map();
  // Builds already queued or taken, so one build never gets two extractions.
  const attempted = new Map();
  let posterTail = Promise.resolve();

  // Applies one diff to the manifest. Fills `jobs` with chapters that need a poster and `lost` with ids whose folder is gone.
  function applyDiff(m, diff, jobs, lost) {
    const listed = new Set(readOrder(slugDir).ids || []);
    let next = m;
    for (const c of [...diff.added, ...diff.changed]) {
      const row = next.chapters.find((r) => r.id === c.id);
      if (row && row.poster && !posterBuild.has(c.id)) posterBuild.set(c.id, row.build_sha256);
      const basis = row ? (posterBuild.has(c.id) ? posterBuild.get(c.id) : row.build_sha256) : null;
      if (c.status === 'ready' && (!row || !row.poster || basis !== c.buildSha256)) jobs.push(c);
      if (!row) { next = placeRow(next, newRow(c), diff.order, listed); continue; }
      const patch = { status: mapStatus(c.status, row.status), duration_s: c.durationS, build_sha256: c.buildSha256, verified_against_commit: c.verifiedAgainstCommit };
      if (!row.title) patch.title = c.title || c.id;
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

  // Takes one poster picture and records it in the manifest. Failures are logged and leave the chapter as it was.
  async function takePoster(c) {
    const dir = path.join(slugDir, 'chapters', c.id);
    const now = scanChapter(dir);
    if (now.status !== 'ready' || now.buildSha256 !== c.buildSha256) { attempted.delete(c.id); return; }
    try {
      await extractPoster({ ffmpeg: deps.ffmpeg || ffmpegPath(), mp4: path.join(dir, 'chapter.mp4'), out: path.join(dir, 'poster.jpg'), atS: posterTime(c.durationS), exec: deps.exec });
      const manifest = await state.updateManifest((m) => (m.chapters.some((r) => r.id === c.id) ? setChapterFields(m, c.id, { poster: `chapters/${c.id}/poster.jpg` }) : m));
      posterBuild.set(c.id, c.buildSha256);
      tell({ id: c.id, manifest });
    } catch (err) {
      attempted.delete(c.id);
      state.logError(err);
    }
  }

  // Queues poster pictures one at a time, skipping a build that was already queued or taken.
  function queuePosters(jobs) {
    for (const c of jobs) {
      if (attempted.get(c.id) === c.buildSha256) continue;
      attempted.set(c.id, c.buildSha256);
      posterTail = posterTail.then(() => takePoster(c));
    }
  }

  // The watcher's callback: one manifest job for the whole diff, then the news, then (not waited for) the posters.
  async function onChange(diff) {
    const jobs = [];
    const lost = [];
    const manifest = await state.updateManifest((m) => { jobs.length = 0; lost.length = 0; return applyDiff(m, diff, jobs, lost); });
    if (diff.added.length || diff.changed.length) tell({ manifest });
    for (const id of lost) tell({ id, reason: 'chapter folder is missing', manifest });
    queuePosters(jobs);
  }

  return { onChange, posterIdle: () => posterTail };
}

module.exports = { makeChapterSync };
