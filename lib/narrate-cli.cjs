'use strict';
// The `yap narrate <chapter-dir> [--root <repo>] [--data-dir <dir>]` command: speech, beats, captions and index.html
// for one chapter, recording the repository's commit when --root is given.
const fs = require('node:fs');
const path = require('node:path');
const { parseFlags } = require('./cli-args.cjs');
const { narrateChapter } = require('./narrate.cjs');
const { venvPython, checkWhisper } = require('./doctor.cjs');
const { realExec } = require('./doctor-cli.cjs');
const { resolveDataDir } = require('./data-dir.cjs');

const USAGE = 'usage: yap narrate <chapter-dir> [--root <repo>] [--data-dir <dir>]';
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

// Runs one real program for the pipeline with a generous time limit.
function realRun(cmd, args, env) {
  return realExec(cmd, args, { timeout: STEP_TIMEOUT_MS, env });
}

// The line printed for a narrated chapter: its length, beats, timing and the commit it was verified against.
function narratedLine(id, r, rootGiven) {
  const commit = r.commit ? `commit ${r.commit.slice(0, 7)}` : rootGiven ? 'not a git repo' : 'no commit recorded (no --root)';
  return `${id}: narrated, ${r.durationS} s, ${r.beats.length} beats, timing ${r.timing}, ${commit}`;
}

// Narrates the chapter; exit 0 = done, 1 = the pipeline failed (message on stderr), 2 = usage.
async function runNarrate(args) {
  let positional;
  let flags;
  try {
    ({ positional, flags } = parseFlags(args, ['--data-dir', '--root']));
    if (positional.length !== 1) throw new Error('needs exactly one chapter folder');
    if (!fs.existsSync(path.join(positional[0], 'chapter.json'))) throw new Error(`no chapter.json in ${positional[0]}`);
  } catch (err) {
    process.stderr.write(`yap narrate: ${err.message}\n${USAGE}\n`);
    return 2;
  }
  // the venv and the whisper check are the same ones the doctor uses
  const dataDir = resolveDataDir({ flag: flags['--data-dir'], env: process.env, cwd: process.cwd(), fs });
  try {
    // a render running beside narrate can make whisper slow to start; the doctor's 15 s would quietly drop word timing
    const whisperAvailable = (await checkWhisper(realExec, STEP_TIMEOUT_MS)).ok;
    const root = flags['--root'];
    const r = await narrateChapter(positional[0], { run: realRun, venvPython: venvPython(dataDir), whisperAvailable, root });
    process.stdout.write(`${narratedLine(path.basename(path.resolve(positional[0])), r, Boolean(root))}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`yap narrate: ${String(err.message).replace(/\s*\n\s*/g, ' ')}\n`);
    return 1;
  }
}

module.exports = { runNarrate, narratedLine };
