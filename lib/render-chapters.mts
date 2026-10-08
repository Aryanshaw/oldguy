// Renders every chapter in a folder, but only those whose claims pass the audit and whose page passes the layout check:
// an unverified chapter is never published.
import fs from 'node:fs';
import path from 'node:path';
import { audit } from './audit.mts';
import { templateOfVideo } from './settings.mts';
import type { Template } from './template.mts';
import { runRenders } from './render-schedule.mts';
import { checkNarrationText } from './chapter.mts';
import { hyperframesArgs } from './hyperframes.mts';
import { buildChangedReason, sha256 } from './build-record.mts';

// A chapter folder that exists: its id (the folder name) and its absolute path.
type Folder = { id: string; dir: string };
// A chapter the caller asked for by id: either its folder, or a marker that no such folder exists.
type Chosen = (Folder & { missing?: undefined }) | { id: string; dir?: undefined; missing: true };
// What running the layout check gives back.
type CheckResult = { code: number | null; stdout?: string; stderr?: string; timedOut?: boolean };
// Runs the layout check on one chapter folder; the CLI passes the real Hyperframes one.
type CheckFn = (dir: string) => Promise<CheckResult> | CheckResult;
// What renderChapters needs besides the folder: the repo to audit against, the parallel limit, the renderer and the checker.
type RenderOptions = {
  root: string; cap: number; render: (chapter: Folder) => unknown; check: CheckFn; only?: string[]; force?: boolean; dryRun?: boolean;
};
// What happened to one chapter: rendered, skipped because it was current, or failed with a reason.
type ChapterOutcome = { id: string; status: 'ready' | 'failed'; attempts?: number; reason?: string; error?: string; skipped?: true };

// The arguments for `npx` that render one chapter folder with the pinned Hyperframes to chapter.mp4 (draft quality, 2 workers, from Phase 0).
function renderArgs(dir: string): string[] {
  return hyperframesArgs(['render', dir, '-q', 'draft', '-w', '2', '-o', path.join(dir, 'chapter.mp4')]);
}

// The arguments for `npx` that run the pinned Hyperframes layout check (overflow, clipped text, runtime errors) on one chapter folder.
function checkArgs(dir: string): string[] {
  return hyperframesArgs(['check', dir]);
}

// Lists the chapter folders (those holding a chapter.json), in name order so output is stable.
// Paths are absolute, so a folder named like "--option" can never reach Hyperframes as an option.
function chapterFolders(chaptersDir: string): Folder[] {
  return fs.readdirSync(chaptersDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(chaptersDir, e.name, 'chapter.json')))
    .map((e) => ({ id: e.name, dir: path.resolve(chaptersDir, e.name) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Says why a chapter may not be rendered, or null when it may. Checks run in order: readable chapter.json,
// narration text, claim audit, narrated at all, then the build record (nothing changed since narrate).
// `template` is the video's template, or the reason it could not be loaded (then nothing can be rendered).
function blockReason({ dir }: Folder, root: string, template: Template | string): string | null {
  if (typeof template === 'string') return template;
  let chapter: { sources: unknown; sentences: unknown; scene: unknown };
  try {
    // read as it is (a field may be absent); every field is checked below before it is relied on
    chapter = JSON.parse(fs.readFileSync(path.join(dir, 'chapter.json'), 'utf8')) as typeof chapter;
  } catch (err) {
    return `cannot read chapter.json: ${(err as Error).message}`;
  }
  if (!Array.isArray(chapter.sources) || !Array.isArray(chapter.sentences)) return 'chapter.json needs "sources" and "sentences" lists';
  // the spoken words must be the audited ones, so narration edited after scaffold blocks the render before the claim audit
  try {
    checkNarrationText(fs.readFileSync(path.join(dir, 'narration.txt'), 'utf8'), chapter.sentences);
  } catch (err) {
    // a missing file throws a system error with a code; checkNarrationText throws an Error with a message
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'no narration.txt in the chapter folder' : (err as Error).message;
  }
  const checked = audit({ root, sources: chapter.sources, sentences: chapter.sentences, scene: chapter.scene, template });
  if (!checked.ok) return `audit: ${checked.failures.map((f) => `${f.id}: ${f.reason}`).join('; ')}`;
  if (!fs.existsSync(path.join(dir, 'index.html'))) return 'not narrated yet (no index.html); run oldguy narrate first';
  return buildChangedReason(dir, chapter);
}

// Runs the layout check on one chapter folder; returns why it failed (its first line of output) or null when it passed.
async function layoutReason({ dir }: Folder, check: CheckFn): Promise<string | null> {
  const r = await check(dir);
  if (r.code === 0) return null;
  const first = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').map((l) => l.trim()).find(Boolean);
  return `layout check failed: ${first || (r.timedOut ? 'timed out' : `exit code ${r.code}`)}`;
}

// The sha256 of the chapter's build.json bytes: render.json stores it, so a later run can tell the video is current.
function buildSha({ dir }: Folder): string {
  return sha256(fs.readFileSync(path.join(dir, 'build.json')));
}

// True when chapter.mp4 exists and render.json says it was rendered from the build.json the folder holds now.
function alreadyRendered(chapter: Folder): boolean {
  try {
    if (!fs.existsSync(path.join(chapter.dir, 'chapter.mp4'))) return false;
    return (JSON.parse(fs.readFileSync(path.join(chapter.dir, 'render.json'), 'utf8')) as { build_sha256?: unknown }).build_sha256 === buildSha(chapter);
  } catch {
    return false;
  }
}

// Wraps the render: removes the old chapter.mp4 and render.json right before each attempt, so a failed render can never
// leave an old video that looks like success, and records render.json only once the render has finished.
// A dry run deletes and writes nothing.
function withRenderRecord(render: (chapter: Folder) => unknown, dryRun: boolean): (chapter: Folder) => unknown {
  if (dryRun) return render;
  return async (chapter: Folder) => {
    const sha = buildSha(chapter);
    fs.rmSync(path.join(chapter.dir, 'chapter.mp4'), { force: true });
    fs.rmSync(path.join(chapter.dir, 'render.json'), { force: true });
    await render(chapter);
    fs.writeFileSync(path.join(chapter.dir, 'render.json'), `${JSON.stringify({ build_sha256: sha })}\n`);
  };
}

// The chapters to work on: every folder in name order, or exactly the `only` ids in the order given
// (an id with no folder is kept, marked missing, so it can be reported).
function selectChapters(folders: Folder[], only: string[] | undefined): Chosen[] {
  if (!only) return folders;
  return [...new Set(only)].map((id): Chosen => folders.find((c) => c.id === id) || { id, missing: true });
}

// Audits the chosen chapters, skips those already rendered from the same build, layout-checks the rest and renders
// the ones that pass through the scheduler. Returns one result per chapter, in the order worked on.
// `check(dir)` runs the layout check and resolves to { code, stdout, stderr }; the CLI passes the real Hyperframes one.
// `only` is a list of chapter ids to render in that order; `force` renders even an up-to-date chapter again.
async function renderChapters(chaptersDir: string, { root, cap, render, check, only, force = false, dryRun = false }: RenderOptions): Promise<ChapterOutcome[]> {
  const chosen = selectChapters(chapterFolders(chaptersDir), only);
  // the video folder holds chapters/; its template's rules join the audit of every chapter
  let template: Template | string;
  try {
    template = templateOfVideo(path.dirname(path.resolve(chaptersDir)));
  } catch (err) {
    template = (err as Error).message;
  }
  const blocked = new Map<string, string>(
    chosen.flatMap((c): [string, string][] => {
      const why = c.missing ? 'no such chapter' : blockReason(c, root, template);
      return why ? [[c.id, why]] : [];
    }),
  );
  // an unchanged build means an unchanged page, so a chapter already rendered from it needs neither check nor render
  // a missing chapter is always blocked, so the `missing` test only tells the type checker what the lookups already know
  const skipped = new Set<string>(force ? [] : chosen.filter((c): c is Folder => !c.missing && !blocked.has(c.id) && alreadyRendered(c)).map((c) => c.id));
  // the layout check opens a browser, so it runs one chapter at a time and only after the cheaper gates have passed
  for (const c of chosen.filter((f): f is Folder => !f.missing && !blocked.has(f.id) && !skipped.has(f.id))) {
    const why = await layoutReason(c, check);
    if (why) blocked.set(c.id, why);
  }
  const ready = chosen.filter((c): c is Folder => !c.missing && !blocked.has(c.id) && !skipped.has(c.id));
  const rendered = await runRenders(ready, { cap, render: withRenderRecord(render, dryRun) });
  const byId = new Map<string, ChapterOutcome>(rendered.map((r): [string, ChapterOutcome] => [r.id, r.error === undefined ? r : { id: r.id, status: r.status, attempts: r.attempts, reason: r.error }]));
  return chosen.map((c): ChapterOutcome => {
    if (blocked.has(c.id)) return { id: c.id, status: 'failed', reason: blocked.get(c.id) };
    // every chapter that was neither blocked nor skipped went to the scheduler and has a result
    return skipped.has(c.id) ? { id: c.id, status: 'ready', skipped: true } : (byId.get(c.id) as ChapterOutcome);
  });
}

export { renderChapters, renderArgs, checkArgs };
export type { Folder, Chosen, CheckFn, CheckResult, RenderOptions, ChapterOutcome };
