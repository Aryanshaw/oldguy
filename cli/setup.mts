// The `yap setup [--install <items>] [--json] [--data-dir <dir>]` command. Without --install it only prints the plan:
// what is missing, how big it is, and the exact programs each item runs. With --install it runs only the named items,
// then the doctor again. Nothing is installed unless the user agreed to that item.
import realFs from 'node:fs';
import realOs from 'node:os';
import { parseFlags } from './args.mts';
import { realExec, formatText } from './doctor.mts';
import { resolveDataDir } from '../lib/data-dir.mts';
import { runDoctor, writeMarker } from '../lib/doctor.mts';
import { planSetup, pickItems, runItems, stepLine } from '../lib/setup.mts';
import type { DoctorCliDeps } from './doctor.mts';
import type { SetupPlan } from '../lib/setup.mts';

const USAGE = 'usage: yap setup [--install <item,item>] [--json] [--data-dir <dir>]';

// Everything setup reaches outside itself for; tests pass a pretend machine.
type SetupCliDeps = DoctorCliDeps & { platform: string; tmpDir: string; writeFile: (file: string, text: string) => void };

// The machine yap really runs on.
function realDeps(): SetupCliDeps {
  return {
    exec: realExec, fs: realFs, os: realOs, env: process.env, nodeVersion: process.version, cwd: process.cwd(),
    marker: writeMarker, platform: process.platform, tmpDir: realOs.tmpdir(),
    writeFile: (file, text) => realFs.writeFileSync(file, text),
    stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s),
  };
}

// The plan as text for the user: each item with its size and steps, then the manual ones, then the command to run.
function formatPlan(plan: SetupPlan): string {
  if (!plan.items.length && !plan.manual.length) return 'Everything Yap needs is installed.\n';
  const out: string[] = [];
  if (plan.items.length) {
    out.push('Yap can install these. Nothing is installed until you agree.', '');
    for (const item of plan.items) {
      out.push(`  ${item.id.padEnd(9)} ${item.what} (${item.size})`);
      if (item.note) out.push(`            ${item.note}`);
      for (const step of item.steps) out.push(`            runs: ${stepLine(step)}`);
    }
    out.push('', `To install: yap setup --install ${plan.items.map((i) => i.id).join(',')}  (or name only the ones you want)`);
  }
  if (plan.manual.length) {
    out.push('', 'Yap cannot install these for you:');
    for (const m of plan.manual) out.push(`  ${m.name}: ${m.why}`, `     fix: ${m.fix}`);
  }
  return `${out.join('\n')}\n`;
}

// Prints the plan, or runs the agreed items and the doctor. Exit 0 = nothing failed (and, after an install, the doctor
// passes), 1 = an install step failed or the doctor still fails, 2 = bad usage.
async function runSetupCli(args: string[], deps: SetupCliDeps = realDeps()): Promise<number> {
  const json = args.includes('--json');
  let flags: Record<string, string>;
  try {
    ({ flags } = parseFlags(args.filter((a) => a !== '--json'), ['--data-dir', '--install']));
  } catch (err) {
    deps.stderr(`yap setup: ${(err as Error).message}\n${USAGE}\n`);
    return 2;
  }
  // the venv lives in the same data folder the doctor and narrate use
  const dataDir = resolveDataDir({ flag: flags['--data-dir'], env: deps.env, cwd: deps.cwd, fs: deps.fs, homedir: deps.os.homedir() }) as string;
  const plan = await planSetup({ ...deps, dataDir });
  if (flags['--install'] === undefined) {
    deps.stdout(json ? `${JSON.stringify(plan, null, 2)}\n` : formatPlan(plan));
    return 0;
  }
  let items;
  try {
    items = pickItems(plan, flags['--install']);
  } catch (err) {
    deps.stderr(`yap setup: ${(err as Error).message}\n`);
    return 2;
  }
  const done = await runItems(items, { exec: deps.exec, writeFile: deps.writeFile, log: (line) => deps.stderr(`${line}\n`) });
  if (!done) {
    deps.stdout('Setup stopped at the failed step above. Nothing after it ran.\n');
    return 1;
  }
  const checks = await runDoctor({ ...deps, dataDir });
  const ok = checks.every((c) => c.ok || !c.required);
  deps.stdout(formatText(checks));
  if (ok) deps.marker(dataDir);
  deps.stdout(ok ? 'Setup done: yap doctor passes.\n' : 'Setup finished, but the doctor still fails (see above).\n');
  return ok ? 0 : 1;
}

export { runSetupCli, formatPlan };
export type { SetupCliDeps };
