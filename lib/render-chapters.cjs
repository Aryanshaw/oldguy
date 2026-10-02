'use strict';
// Renders every chapter in a folder, but only those whose claims pass the audit and whose page passes the layout check:
// an unverified chapter is never published.
const fs = require('node:fs');
const path = require('node:path');
const { audit } = require('./audit.cjs');
const { runRenders } = require('./render-schedule.cjs');
const { checkNarrationText } = require('./chapter.cjs');
const { hyperframesArgs } = require('./hyperframes.cjs');
const { buildChangedReason } = require('./build-record.cjs');

// The arguments for `npx` that render one chapter folder with the pinned Hyperframes to chapter.mp4 (draft quality, 2 workers, from Phase 0).
function renderArgs(dir) {
  return hyperframesArgs(['render', dir, '-q', 'draft', '-w', '2', '-o', path.join(dir, 'chapter.mp4')]);
}

// The arguments for `npx` that run the pinned Hyperframes layout check (overflow, clipped text, runtime errors) on one chapter folder.
function checkArgs(dir) {
  return hyperframesArgs(['check', dir]);
}

// Lists the chapter folders (those holding a chapter.json), in name order so output is stable.
// Paths are absolute, so a folder named like "--option" can never reach Hyperframes as an option.
function chapterFolders(chaptersDir) {
  return fs.readdirSync(chaptersDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(chaptersDir, e.name, 'chapter.json')))
    .map((e) => ({ id: e.name, dir: path.resolve(chaptersDir, e.name) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Says why a chapter may not be rendered, or null when it may. Checks run in order: readable chapter.json,
// narration text, claim audit, narrated at all, then the build record (nothing changed since narrate).
function blockReason({ dir }, root) {
  let chapter;
  try {
    chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8'));
  } catch (err) {
    return `cannot read chapter.json: ${err.message}`;
  }
  if (!Array.isArray(chapter.sources) || !Array.isArray(chapter.sentences)) return 'chapter.json needs "sources" and "sentences" lists';
  // the spoken words must be the audited ones, so narration edited after scaffold blocks the render before the claim audit
  try {
    checkNarrationText(fs.readFileSync(path.join(dir, 'narration.txt'), 'utf8'), chapter.sentences);
  } catch (err) {
    return err.code === 'ENOENT' ? 'no narration.txt in the chapter folder' : err.message;
  }
  const checked = audit({ root, sources: chapter.sources, sentences: chapter.sentences });
  if (!checked.ok) return `audit: ${checked.failures.map((f) => `${f.id}: ${f.reason}`).join('; ')}`;
  if (!fs.existsSync(path.join(dir, 'index.html'))) return 'not narrated yet (no index.html); run yap narrate first';
  return buildChangedReason(dir, chapter);
}

// Runs the layout check on one chapter folder; returns why it failed (its first line of output) or null when it passed.
async function layoutReason({ dir }, check) {
  const r = await check(dir);
  if (r.code === 0) return null;
  const first = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').map((l) => l.trim()).find(Boolean);
  return `layout check failed: ${first || (r.timedOut ? 'timed out' : `exit code ${r.code}`)}`;
}

// Removes the previous chapter.mp4 right before each render attempt, so a failed render can never leave an old video
// that looks like success. A dry run deletes nothing.
function withStaleVideoRemoved(render, dryRun) {
  if (dryRun) return render;
  return (chapter) => {
    fs.rmSync(path.join(chapter.dir, 'chapter.mp4'), { force: true });
    return render(chapter);
  };
}

// Audits every chapter, renders the ones that pass through the scheduler, and returns one result per chapter in folder order.
// `check(dir)` runs the layout check and resolves to { code, stdout, stderr }; the CLI passes the real Hyperframes one.
async function renderChapters(chaptersDir, { root, cap, render, check, dryRun = false }) {
  const folders = chapterFolders(chaptersDir);
  const blocked = new Map(folders.map((c) => [c.id, blockReason(c, root)]).filter(([, why]) => why));
  // the layout check opens a browser, so it runs one chapter at a time and only after the cheaper gates have passed
  for (const c of folders.filter((f) => !blocked.has(f.id))) {
    const why = await layoutReason(c, check);
    if (why) blocked.set(c.id, why);
  }
  const ready = folders.filter((c) => !blocked.has(c.id));
  const rendered = await runRenders(ready, { cap, render: withStaleVideoRemoved(render, dryRun) });
  const byId = new Map(rendered.map((r) => [r.id, r.error === undefined ? r : { id: r.id, status: r.status, attempts: r.attempts, reason: r.error }]));
  return folders.map((c) => (blocked.has(c.id) ? { id: c.id, status: 'failed', reason: blocked.get(c.id) } : byId.get(c.id)));
}

module.exports = { renderChapters, renderArgs, checkArgs };
