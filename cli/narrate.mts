// The `yap narrate <chapter-dir> [--root <repo>] [--data-dir <dir>]` command: speech, beats, captions and index.html
// for one chapter, recording the repository's commit when --root is given.
import fs from 'node:fs';
import path from 'node:path';
import { parseFlags } from './args.mts';
import { narrateChapter } from '../lib/narrate.mts';
import { venvPython, checkWhisper } from '../lib/doctor.mts';
import { realExec } from './doctor.mts';
import { resolveDataDir } from '../lib/data-dir.mts';
import type { ProgramResult } from '../lib/narrate.mts';
import type { NarrateResult } from '../lib/narrate.mts';

const USAGE = 'usage: yap narrate <chapter-dir> [--root <repo>] [--data-dir <dir>]';
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

// Runs one real program for the pipeline with a generous time limit.
function realRun(cmd: string, args: string[], env?: Record<string, string>): Promise<ProgramResult> {
  return realExec(cmd, args, { timeout: STEP_TIMEOUT_MS, env });
}

// The line printed for a narrated chapter: its length, beats, timing and the commit it was verified against.
function narratedLine(id: string, r: NarrateResult, rootGiven: boolean): string {
  const commit = r.commit ? `commit ${r.commit.slice(0, 7)}` : rootGiven ? 'not a git repo' : 'no commit recorded (no --root)';
  return `${id}: narrated, ${r.durationS} s, ${r.beats.length} beats, timing ${r.timing}, ${commit}`;
}

// Narrates the chapter; exit 0 = done, 1 = the pipeline failed (message on stderr), 2 = usage.
async function runNarrate(args: string[]): Promise<number> {
  let positional: string[];
  let flags: Record<string, string>;
  try {
    ({ positional, flags } = parseFlags(args, ['--data-dir', '--root']));
    if (positional.length !== 1) throw new Error('needs exactly one chapter folder');
    if (!fs.existsSync(path.join(positional[0], 'chapter.json'))) throw new Error(`no chapter.json in ${positional[0]}`);
  } catch (err) {
    process.stderr.write(`yap narrate: ${(err as Error).message}\n${USAGE}\n`);
    return 2;
  }
  // the venv and the whisper check are the same ones the doctor uses
  // process.cwd() is an absolute path, so a folder is always found
  const dataDir = resolveDataDir({ flag: flags['--data-dir'], env: process.env, cwd: process.cwd(), fs }) as string;
  try {
    // a render running beside narrate can make whisper slow to start; the doctor's 15 s would quietly drop word timing
    const whisperAvailable = (await checkWhisper(realExec, STEP_TIMEOUT_MS)).ok;
    const root = flags['--root'];
    const r = await narrateChapter(positional[0], { run: realRun, venvPython: venvPython(dataDir), whisperAvailable, root });
    process.stdout.write(`${narratedLine(path.basename(path.resolve(positional[0])), r, Boolean(root))}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`yap narrate: ${String((err as Error).message).replace(/\s*\n\s*/g, ' ')}\n`);
    return 1;
  }
}

export { runNarrate, narratedLine };
