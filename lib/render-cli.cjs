'use strict';
// The `yap render <chapters-dir> --root <repo> [--only <id,...>] [--cap <n>] [--force] [--dry-run]` command.
const fs = require('node:fs');
const os = require('node:os');
const { parseFlags } = require('./cli-args.cjs');
const { renderChapters, renderArgs, checkArgs } = require('./render-chapters.cjs');
const { renderCap } = require('./render-schedule.cjs');
const { freeRamGb } = require('./doctor.cjs');
const { realExec } = require('./doctor-cli.cjs');

const USAGE = 'usage: yap render <chapters-dir> --root <repo> [--only <id,id,...>] [--cap <n>] [--force] [--dry-run]';
const RENDER_TIMEOUT_MS = 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
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

// Runs the pinned Hyperframes layout check on one chapter folder; its exit code and output decide the gate.
function realCheck(dir) {
  return realExec('npx', checkArgs(dir), { timeout: CHECK_TIMEOUT_MS, maxBuffer: RENDER_MAX_BUFFER });
}

// Stands in for the layout check in a dry run: says what would run, runs nothing, and lets the chapter through.
function dryCheck(dir) {
  process.stdout.write(`would run: npx ${checkArgs(dir).join(' ')}\n`);
  return { code: 0, stdout: '', stderr: '' };
}

// Turns `--only a,b` into ['a', 'b'] (undefined when absent); an empty list is a usage error.
function onlyIds(value) {
  if (value === undefined) return undefined;
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('--only needs chapter ids separated by commas');
  return ids;
}

// Reads the arguments; throws a usage message for anything missing or malformed.
function parseArgs(args) {
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const valued = args.filter((a) => a !== '--dry-run' && a !== '--force');
  const { positional, flags } = parseFlags(valued, ['--root', '--cap', '--only']);
  if (positional.length !== 1 || !flags['--root']) throw new Error('needs one chapters folder and --root');
  if (!fs.existsSync(positional[0]) || !fs.statSync(positional[0]).isDirectory()) throw new Error(`${positional[0]} is not a folder`);
  const cap = flags['--cap'] === undefined ? undefined : Number(flags['--cap']);
  if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) throw new Error('--cap needs a whole number, 1 or more');
  return { chaptersDir: positional[0], root: flags['--root'], cap, dryRun, force, only: onlyIds(flags['--only']) };
}

// One output line per chapter: failed with its reason, skipped as already rendered, or ready (would-words in a dry run).
function resultLine(r, dryRun) {
  if (r.status !== 'ready') return `${r.id}: failed (${r.reason})`;
  if (r.skipped) return `${r.id}: ${dryRun ? 'would skip' : 'ready'} (already rendered)`;
  return `${r.id}: ${dryRun ? 'would render' : 'ready'}`;
}

// Audits, layout-checks and renders every chapter; exit 0 = all ready, 1 = any failed or none found, 2 = usage.
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
  const render = opts.dryRun ? dryRender : realRender;
  const check = opts.dryRun ? dryCheck : realCheck;
  const { root, only, force, dryRun } = opts;
  const results = await renderChapters(opts.chaptersDir, { root, cap, render, check, only, force, dryRun });
  if (results.length === 0) {
    process.stderr.write(`yap render: no chapters (folders with chapter.json) in ${opts.chaptersDir}\n`);
    return 1;
  }
  for (const r of results) process.stdout.write(`${resultLine(r, dryRun)}\n`);
  return results.every((r) => r.status === 'ready') ? 0 : 1;
}

module.exports = { runRender };
