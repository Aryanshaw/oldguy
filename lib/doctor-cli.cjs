'use strict';
// The `yap doctor [--json] [--data-dir <dir>]` command: runs the checks and prints them for people or for scripts.
const path = require('node:path');
const realFs = require('node:fs');
const realOs = require('node:os');
const { execFile } = require('node:child_process');
const { parseFlags } = require('./cli-args.cjs');
const { runDoctor, writeMarker } = require('./doctor.cjs');

// Runs a real program with a time limit and never rejects: a non-zero exit, a signal kill (such as a dyld abort),
// a timeout or a program that cannot start all come back as data the checks can read.
// Extra env values are added on top of ours, so settings like HYPERFRAMES_FFMPEG_PATH still reach the program.
function realExec(cmd, args, { timeout, env, maxBuffer = 10 * 1024 * 1024 }) {
  const options = { timeout, encoding: 'utf8', maxBuffer, env: env ? { ...process.env, ...env } : undefined };
  return new Promise((resolve) => {
    execFile(cmd, args, options, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, signal: null, stdout, stderr, timedOut: false });
      // A string code (ENOENT and friends) means the program never started; the error message is all there is.
      if (typeof err.code === 'string') return resolve({ code: null, signal: null, stdout: '', stderr: err.message, timedOut: false });
      resolve({
        code: typeof err.code === 'number' ? err.code : null,
        signal: err.signal || null,
        stdout: stdout || '',
        stderr: stderr || '',
        timedOut: Boolean(err.killed && err.signal),
      });
    });
  });
}

// The machine yap really runs on; tests pass their own pretend one instead.
function realDeps() {
  return {
    exec: realExec, fs: realFs, os: realOs, env: process.env, nodeVersion: process.version,
    cwd: process.cwd(), marker: writeMarker,
    stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s),
  };
}

// The data folder is where the venv and the pass marker live: --data-dir, else the plugin's data folder, else ./.yap.
function resolveDataDir(flagValue, env, cwd) {
  return flagValue || env.CLAUDE_PLUGIN_DATA || path.join(cwd || process.cwd(), '.yap');
}

// Lays the results out one per line, with the fix indented under anything that failed.
function formatText(results) {
  return results.map((c) => {
    const tag = c.ok ? 'ok  ' : c.required ? 'FAIL' : 'note';
    return `${tag} ${c.name}: ${c.detail}${c.ok ? '' : `\n     fix: ${c.fix}`}\n`;
  }).join('');
}

// Runs the doctor; exit 0 = all required checks pass, 1 = one failed, 2 = bad usage.
async function runDoctorCli(args, deps = realDeps()) {
  const json = args.includes('--json');
  let flags;
  try {
    ({ flags } = parseFlags(args.filter((a) => a !== '--json'), ['--data-dir']));
  } catch (err) {
    deps.stderr(`yap doctor: ${err.message}\nusage: yap doctor [--json] [--data-dir <dir>]\n`);
    return 2;
  }
  const dataDir = resolveDataDir(flags['--data-dir'], deps.env, deps.cwd);
  const checks = await runDoctor({ ...deps, dataDir });
  const ok = checks.every((c) => c.ok || !c.required);
  deps.stdout(json ? `${JSON.stringify({ ok, checks }, null, 2)}\n` : formatText(checks));
  if (ok) deps.marker(dataDir);
  return ok ? 0 : 1;
}

module.exports = { runDoctorCli, realExec, resolveDataDir };
