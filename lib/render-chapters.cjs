'use strict';
// Renders every chapter in a folder, but only those whose claims pass the audit: an unverified chapter is never published.
const fs = require('node:fs');
const path = require('node:path');
const { audit } = require('./audit.cjs');
const { runRenders } = require('./render-schedule.cjs');

// The arguments for `npx` that render one chapter folder to chapter.mp4 (draft quality, 2 workers, from Phase 0).
function renderArgs(dir) {
  return ['hyperframes', 'render', dir, '-q', 'draft', '-w', '2', '-o', path.join(dir, 'chapter.mp4')];
}

// Lists the chapter folders (those holding a chapter.json), in name order so output is stable.
function chapterFolders(chaptersDir) {
  return fs.readdirSync(chaptersDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(chaptersDir, e.name, 'chapter.json')))
    .map((e) => ({ id: e.name, dir: path.join(chaptersDir, e.name) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Says why a chapter may not be rendered (unreadable, fails the audit, not narrated), or null when it may.
function blockReason({ dir }, root) {
  let chapter;
  try {
    chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'));
  } catch (err) {
    return `cannot read chapter.json: ${err.message}`;
  }
  if (!Array.isArray(chapter.sources) || !Array.isArray(chapter.sentences)) return 'chapter.json needs "sources" and "sentences" lists';
  const checked = audit({ root, sources: chapter.sources, sentences: chapter.sentences });
  if (!checked.ok) return `audit: ${checked.failures.map((f) => `${f.id}: ${f.reason}`).join('; ')}`;
  if (!fs.existsSync(path.join(dir, 'index.html'))) return 'not narrated yet (no index.html); run yap narrate first';
  return null;
}

// Audits every chapter, renders the ones that pass through the scheduler, and returns one result per chapter in folder order.
async function renderChapters(chaptersDir, { root, cap, render }) {
  const folders = chapterFolders(chaptersDir);
  const blocked = new Map(folders.map((c) => [c.id, blockReason(c, root)]).filter(([, why]) => why));
  const rendered = await runRenders(folders.filter((c) => !blocked.has(c.id)), { cap, render });
  const byId = new Map(rendered.map((r) => [r.id, r.error === undefined ? r : { id: r.id, status: r.status, attempts: r.attempts, reason: r.error }]));
  return folders.map((c) => (blocked.has(c.id) ? { id: c.id, status: 'failed', reason: blocked.get(c.id) } : byId.get(c.id)));
}

module.exports = { renderChapters, renderArgs };
