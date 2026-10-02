'use strict';
// The `yap render <chapters-dir> --root <repo> [--cap <n>] [--dry-run]` command.
const fs = require('node:fs');
const os = require('node:os');
const { parseFlags } = require('./cli-args.cjs');
const { renderChapters, renderArgs } = require('./render-chapters.cjs');
const { renderCap } = require('./render-schedule.cjs');
const { freeRamGb } = require('./doctor.cjs');
const { realExec } = require('./doctor-cli.cjs');

const USAGE = 'usage: yap render <chapters-dir> --root <repo> [--cap <n>] [--dry-run]';
const RENDER_TIMEOUT_MS = 60 * 60 * 1000;
// render progress output can be long, so allow far more than the default buffer
const RENDER_MAX_BUFFER = 256 * 1024 * 1024;

// Renders one chapter for real; a failed render becomes an error carrying the last line Hyperframes printed.
async function realRender({ dir }) {
  const r = await realExec('npx', renderArgs(dir), { timeout: RENDER_TIMEOUT_MS, maxBuffer: RENDER_MAX_BUFFER });
  if (r.code !== 0) {
    const last = String(r.stderr || '').trim().split('\n').pop();
    throw new Error(`hyperframes render failed: ${last || (r.timedOut ? 'timed out' : `exit code ${r.code}`)}`);
  }
}

// Stands in for the real render: says what would run and runs nothing.
function dryRender({ dir }) {
  process.stdout.write(`would run: npx ${renderArgs(dir).join(' ')}\n`);
}

// Reads the arguments; throws a usage message for anything missing or malformed.
function parseArgs(args) {
  const dryRun = args.includes('--dry-run');
  const { positional, flags } = parseFlags(args.filter((a) => a !== '--dry-run'), ['--root', '--cap']);
  if (positional.length !== 1 || !flags['--root']) throw new Error('needs one chapters folder and --root');
  if (!fs.existsSync(positional[0]) || !fs.statSync(positional[0]).isDirectory()) throw new Error(`${positional[0]} is not a folder`);
  const cap = flags['--cap'] === undefined ? undefined : Number(flags['--cap']);
  if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) throw new Error('--cap needs a whole number, 1 or more');
  return { chaptersDir: positional[0], root: flags['--root'], cap, dryRun };
}

// Audits and renders every chapter; exit 0 = all ready, 1 = any failed or none found, 2 = usage.
async function runRender(args) {
  let opts;
  try {
    opts = parseArgs(args);
  } catch (err) {
    process.stderr.write(`yap render: ${err.message}\n${USAGE}\n`);
    return 2;
  }
  // without --cap, free memory decides, measured the way the doctor measures it
  const cap = opts.cap ?? renderCap(freeRamGb(os));
  if (opts.dryRun) process.stdout.write(`dry run: would render up to ${cap} at a time\n`);
  const results = await renderChapters(opts.chaptersDir, { root: opts.root, cap, render: opts.dryRun ? dryRender : realRender });
  if (results.length === 0) {
    process.stderr.write(`yap render: no chapters (folders with chapter.json) in ${opts.chaptersDir}\n`);
    return 1;
  }
  for (const r of results) process.stdout.write(r.status === 'ready' ? `${r.id}: ready\n` : `${r.id}: failed (${r.reason})\n`);
  return results.every((r) => r.status === 'ready') ? 0 : 1;
}

module.exports = { runRender };
