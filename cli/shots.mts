// The `oldguy shots --dir .oldguy/<slug>` command: for a template with shots, checks every chapter's shots/<id>.json
// against the art library and the shot rules, and writes each chapter's designed scene to scenes/<id>.html, ready for
// its spec's design piece. `--show <id>` also writes a contact sheet of that chapter's shots to shots/<id>.png.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCatalog } from '../lib/catalog.mts';
import { compileChapter, contactSheetHtml } from '../lib/shots.mts';
import { checkShotsFolder } from '../lib/shots-folder.mts';
import { parseFlags, guarded } from './args.mts';

const USAGE = 'usage: oldguy shots --dir .oldguy/<slug> [--show <chapter id>]';
// Where a headless Chromium is usually found; OLDGUY_CHROMIUM wins when set.
const CHROMIUM_PLACES = ['/opt/pw-browsers/chromium'];
const CHROMIUM_NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];

// The Chromium to take stills with: OLDGUY_CHROMIUM, a known place, or one on PATH; null when there is none.
function findChromium(): string | null {
  const given = process.env.OLDGUY_CHROMIUM;
  if (given) return fs.existsSync(given) ? given : null;
  // a Playwright browser folder may hold a newer headless shell than the one named above
  const pw = '/opt/pw-browsers';
  const shells = fs.existsSync(pw) ? fs.readdirSync(pw).filter((n) => n.startsWith('chromium_headless_shell-')).sort().reverse().map((n) => path.join(pw, n, 'chrome-linux', 'headless_shell')) : [];
  for (const p of [...shells, ...CHROMIUM_PLACES]) if (fs.existsSync(p)) return p;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const name of CHROMIUM_NAMES) if (dir && fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  return null;
}

// Screenshots a page to a PNG with headless Chromium; throws with Chromium's last words when it fails. The window is a
// little taller than the page, since some Chromium builds keep part of the window for themselves.
function screenshot(chromium: string, html: string, width: number, height: number, out: string): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-shots-'));
  try {
    const page = path.join(tmp, 'sheet.html');
    fs.writeFileSync(page, html);
    fs.rmSync(out, { force: true });
    const args = ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${path.join(tmp, 'profile')}`,
      `--window-size=${width},${height}`, '--virtual-time-budget=15000', `--screenshot=${out}`, `file://${page}`];
    const r = spawnSync(chromium, args, { encoding: 'utf8', timeout: 120000 });
    if (!fs.existsSync(out)) throw new Error(`Chromium did not write the sheet: ${(r.stderr || r.error?.message || '').trim().split('\n').slice(-2).join(' ')}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Runs the check and the compile; exit 0 = every scene written, 1 = problems listed by chapter, 2 = usage or no Chromium.
function runShots(args: string[]): number {
  return guarded('shots', () => {
    const { positional, flags } = parseFlags(args, ['--dir', '--show']);
    if (!flags['--dir'] || positional.length) throw new Error(USAGE);
    const dir = flags['--dir'];
    const results = checkShotsFolder(dir, loadCatalog());
    const show = flags['--show'];
    if (show !== undefined && !results.some((r) => r.id === show)) throw new Error(`--show ${show}: no such chapter in order.json (${results.map((r) => r.id).join(', ')})`);
    for (const r of results) for (const w of r.warnings) process.stdout.write(`${r.id}: warning: ${w}\n`);
    const broken = results.filter((r) => r.errors.length);
    if (broken.length) {
      for (const r of broken) process.stdout.write(`${r.id}:\n${r.errors.map((e) => `  ${e}\n`).join('')}`);
      return 1;
    }
    const cat = loadCatalog();
    fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
    const written: string[] = [];
    const scenes = new Map<string, string>();
    for (const r of results) {
      // checkShotsFolder only leaves out shots for a chapter that has errors, and there are none here
      const scene = compileChapter(r.shots!, cat);
      const file = path.join(dir, 'scenes', `${r.id}.html`);
      fs.writeFileSync(file, scene);
      scenes.set(r.id, scene);
      written.push(file);
    }
    process.stdout.write(`shots ok\n${written.map((f) => `${f}\n`).join('')}`);
    if (show !== undefined) {
      const chromium = findChromium();
      if (!chromium) throw new Error('--show needs a headless Chromium; set OLDGUY_CHROMIUM to its path');
      const r = results.find((x) => x.id === show)!;
      const sheet = contactSheetHtml(scenes.get(show)!, r.shots!.shots.length, `${show}: ${r.shots!.title}`);
      const out = path.join(dir, 'shots', `${show}.png`);
      screenshot(chromium, sheet.html, sheet.width, sheet.height + 120, out);
      process.stdout.write(`contact sheet: ${out}\n`);
    }
    return 0;
  });
}

export { runShots };
