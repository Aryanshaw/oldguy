// The `oldguy doctor [--json] [--data-dir <dir>]` command: runs the checks and prints them for people or for scripts.
import realFs from 'node:fs';
import realOs from 'node:os';
import { execFile } from 'node:child_process';
import { parseFlags } from './args.mts';
import { runDoctor, writeMarker } from '../lib/doctor.mts';
import type { DoctorCheck, DoctorDeps, DoctorFs, RunResult } from '../lib/doctor.mts';
import type { FileReader } from '../lib/data-dir.mts';
import { resolveDataDir } from '../lib/data-dir.mts';

// Everything the doctor command reaches outside itself for: the doctor's own dependencies (minus the data folder, which is
// worked out here), where it runs, how it marks success, and where it prints.
type DoctorCliDeps = Omit<DoctorDeps, 'dataDir' | 'fs'> & {
  fs: DoctorFs & FileReader;
  cwd: string;
  marker: (dataDir: string) => void;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

// Runs a real program with a time limit and never rejects: a non-zero exit, a signal kill (such as a dyld abort),
// a timeout or a program that cannot start all come back as data the checks can read.
// Extra env values are added on top of ours, so settings like HYPERFRAMES_FFMPEG_PATH still reach the program.
function realExec(cmd: string, args: string[], { timeout, env, maxBuffer = 10 * 1024 * 1024 }: { timeout: number; env?: Record<string, string>; maxBuffer?: number }): Promise<RunResult> {
  const options = { timeout, encoding: 'utf8' as const, maxBuffer, env: env ? { ...process.env, ...env } : undefined };
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

// The machine oldguy really runs on; tests pass their own pretend one instead.
function realDeps(): DoctorCliDeps {
  return {
    exec: realExec, fs: realFs, os: realOs, env: process.env, nodeVersion: process.version,
    cwd: process.cwd(), marker: writeMarker,
    stdout: (s: string) => process.stdout.write(s), stderr: (s: string) => process.stderr.write(s),
  };
}

// Lays the results out one per line, with the fix indented under anything that failed.
function formatText(results: DoctorCheck[]): string {
  return results.map((c) => {
    const tag = c.ok ? 'ok  ' : c.required ? 'FAIL' : 'note';
    return `${tag} ${c.name}: ${c.detail}${c.ok ? '' : `\n     fix: ${c.fix}`}\n`;
  }).join('');
}

// Runs the doctor; exit 0 = all required checks pass, 1 = one failed, 2 = bad usage.
async function runDoctorCli(args: string[], deps: DoctorCliDeps = realDeps()): Promise<number> {
  const json = args.includes('--json');
  let flags: Record<string, string>;
  try {
    ({ flags } = parseFlags(args.filter((a) => a !== '--json'), ['--data-dir']));
  } catch (err) {
    deps.stderr(`oldguy doctor: ${(err as Error).message}\nusage: oldguy doctor [--json] [--data-dir <dir>]\n`);
    return 2;
  }
  // the venv and the pass marker live in the data folder, found the same way the hook and narrate find it
  // null only when cwd is not an absolute path; a real run passes process.cwd()
  const dataDir = resolveDataDir({ flag: flags['--data-dir'], env: deps.env, cwd: deps.cwd, fs: deps.fs, homedir: deps.os.homedir() }) as string;
  const checks = await runDoctor({ ...deps, dataDir });
  const ok = checks.every((c) => c.ok || !c.required);
  deps.stdout(json ? `${JSON.stringify({ ok, checks }, null, 2)}\n` : formatText(checks));
  if (ok) deps.marker(dataDir);
  return ok ? 0 : 1;
}

export { runDoctorCli, realExec, formatText };
export type { DoctorCliDeps };
