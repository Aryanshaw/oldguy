'use strict';
// The `yap narrate <chapter-dir> [--data-dir <dir>]` command: speech, beats, captions and index.html for one chapter.
const fs = require('node:fs');
const path = require('node:path');
const { parseFlags } = require('./cli-args.cjs');
const { narrateChapter } = require('./narrate.cjs');
const { venvPython, checkWhisper } = require('./doctor.cjs');
const { realExec } = require('./doctor-cli.cjs');
const { resolveDataDir } = require('./data-dir.cjs');

const USAGE = 'usage: yap narrate <chapter-dir> [--data-dir <dir>]';
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

// Runs one real program for the pipeline with a generous time limit.
function realRun(cmd, args, env) {
  return realExec(cmd, args, { timeout: STEP_TIMEOUT_MS, env });
}

// Narrates the chapter; exit 0 = done, 1 = the pipeline failed (message on stderr), 2 = usage.
async function runNarrate(args) {
  let positional;
  let flags;
  try {
    ({ positional, flags } = parseFlags(args, ['--data-dir']));
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
    const r = await narrateChapter(positional[0], { run: realRun, venvPython: venvPython(dataDir), whisperAvailable });
    process.stdout.write(`${path.basename(path.resolve(positional[0]))}: narrated, ${r.durationS} s, ${r.beats.length} beats, timing ${r.timing}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`yap narrate: ${String(err.message).replace(/\s*\n\s*/g, ' ')}\n`);
    return 1;
  }
}

module.exports = { runNarrate };
