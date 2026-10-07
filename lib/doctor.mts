// The doctor: checks that every tool oldguy needs is present and says exactly how to fix what is not.
// Every outside call (running programs, files, environment, machine facts) is passed in, so tests run nothing real.
import path from 'node:path';
import realFs from 'node:fs';
import { renderCap } from './render-schedule.mts';
import { hyperframesArgs } from './hyperframes.mts';
import { nodeProblem } from './node-floor.cjs';

// One line of the doctor's report: what was checked, whether it passed, whether oldguy needs it, and how to fix it if not.
type DoctorCheck = { name: string; ok: boolean; required: boolean; detail: string; fix: string };
// The whole report, in the order the checks run.
type DoctorReport = DoctorCheck[];
// What running a program gives back (a program that cannot start comes back as code -1).
type RunResult = { code: number | null; stdout?: string; stderr?: string; signal?: string | null; timedOut?: boolean };
// Runs a program with an argument list and a time limit; the real one is in cli/doctor, a test hands in a fake.
type Exec = (cmd: string, args: string[], opts: { timeout: number; env?: Record<string, string> }) => Promise<RunResult>;
// The file functions the doctor reads with.
type DoctorFs = Pick<typeof realFs, 'existsSync' | 'statSync' | 'statfsSync'>;
// The machine facts the doctor reads.
type DoctorOs = { homedir: () => string; freemem: () => number };
// Everything the doctor reaches outside itself for.
type DoctorDeps = { exec: Exec; fs: DoctorFs; env: Record<string, string | undefined>; os: DoctorOs; nodeVersion: string; dataDir: string };

const GB = 1024 ** 3;
const MIN_MODEL_BYTES = 300e6;
const MIN_FREE_DISK_GB = 1;
const SLOW_MS = 120000;
const QUICK_MS = 15000;

// Builds one check result in the fixed shape the rest of oldguy (and --json) relies on.
function result(name: string, ok: boolean, required: boolean, detail: string, fix = ''): DoctorCheck {
  return { name, ok, required, detail, fix: ok ? '' : fix };
}

// Runs a program and never throws: a program that cannot start comes back as code -1 with the reason in stderr.
async function run(exec: Exec, cmd: string, args: string[], timeout: number): Promise<RunResult> {
  try {
    return await exec(cmd, args, { timeout });
  } catch (err) {
    // whatever was thrown is shown; an Error has a message, anything else is shown as it is
    const e = err as { message?: unknown } | null | undefined;
    return { code: -1, stdout: '', stderr: String(e && e.message ? e.message : err) };
  }
}

// Node must be new enough for the rest of oldguy; the sentence that says so is shared with the launcher.
function checkNode(nodeVersion: string): DoctorCheck {
  const version = String(nodeVersion).replace(/^v/, '');
  const problem = nodeProblem(version, '');
  return result('Node', problem === null, true, `Node ${version} (need 22.18 or newer)`, problem || '');
}

// Fix text for a broken ffmpeg: a missing shared library is the failure we met in Phase 0.
function ffmpegFix(stderr: string): string {
  if (/Library not loaded/.test(stderr)) {
    return 'a library ffmpeg needs is missing: reinstall ffmpeg (brew reinstall ffmpeg), or point '
      + 'HYPERFRAMES_FFMPEG_PATH and HYPERFRAMES_FFPROBE_PATH at a static build of ffmpeg and ffprobe';
  }
  return 'install ffmpeg (brew install ffmpeg), or point HYPERFRAMES_FFMPEG_PATH and HYPERFRAMES_FFPROBE_PATH at a static build';
}

// ffmpeg has to actually run, not just exist on the path.
async function checkFfmpeg(exec: Exec, env: Record<string, string | undefined>): Promise<DoctorCheck> {
  const r = await run(exec, env.HYPERFRAMES_FFMPEG_PATH || 'ffmpeg', ['-version'], QUICK_MS);
  const stderr = r.stderr || '';
  // A signal kill or timeout has no exit code, so only a clean exit 0 counts as working.
  if (r.code === 0 && !r.signal && !r.timedOut) return result('ffmpeg', true, true, ((r.stdout || '').split('\n')[0] || 'ffmpeg runs').trim());
  const why = /Library not loaded/.test(stderr) ? 'ffmpeg is installed but a library it needs is missing' : 'ffmpeg does not run';
  const how = r.timedOut ? 'ffmpeg timed out' : r.signal && !stderr.trim() ? `ffmpeg was killed by ${r.signal}` : stderr.trim().split('\n')[0];
  return result('ffmpeg', false, true, `${why}: ${how}`, ffmpegFix(stderr));
}

// Where the venv's python lives inside the data folder; narration hands this to Hyperframes.
function venvPython(dataDir: string): string {
  return path.join(dataDir, 'venv', 'bin', 'python');
}

// Free memory in GB, the number the render cap is worked out from.
function freeRamGb(os: DoctorOs): number {
  return os.freemem() / GB;
}

// Pythons Kokoro works with, newest first; the default python3 can be too new (3.14's ensurepip fails).
const VENV_PYTHONS = ['python3.12', 'python3.11', 'python3.10'];
const PACKAGES = ['kokoro-onnx', 'soundfile'];

// One program to run, as an argument list (never a shell string); `env` is added on top of the current environment.
type Step = { cmd: string; args: string[]; env?: Record<string, string> };

// True when a program runs on this machine (`<cmd> --version` exits 0).
async function onPath(exec: Exec, cmd: string): Promise<boolean> {
  return (await run(exec, cmd, ['--version'], QUICK_MS)).code === 0;
}

// The steps that make a fresh venv and install the packages, preferring uv, then a Python 3.10 to 3.12 on PATH;
// null when neither is there, since oldguy never installs Python itself.
async function createVenvSteps(exec: Exec, venv: string, python: string): Promise<Step[] | null> {
  if (await onPath(exec, 'uv')) {
    return [{ cmd: 'uv', args: ['venv', '--python', '3.12', venv] }, { cmd: 'uv', args: ['pip', 'install', '--python', python, ...PACKAGES] }];
  }
  for (const cmd of VENV_PYTHONS) {
    if (await onPath(exec, cmd)) return [{ cmd, args: ['-m', 'venv', venv] }, { cmd: path.join(venv, 'bin', 'pip'), args: ['install', ...PACKAGES] }];
  }
  return null;
}

// The steps that add the packages to a venv whose python already runs: uv when present, else the venv's pip.
async function installSteps(exec: Exec, venv: string, python: string): Promise<Step[]> {
  return (await onPath(exec, 'uv'))
    ? [{ cmd: 'uv', args: ['pip', 'install', '--python', python, ...PACKAGES] }]
    : [{ cmd: path.join(venv, 'bin', 'pip'), args: ['install', ...PACKAGES] }];
}

const NO_PYTHON = 'Python 3.10 to 3.12 is needed to make the venv and none was found on PATH: install Python 3.12 or uv, '
  + 'then re-run oldguy doctor';

// The steps that repair a venv the doctor found broken (the caller has already seen it fail to import): add the
// packages when its python runs, else remove whatever is there and start over. null when no Python can make one.
async function venvRepairSteps({ exec, fs, dataDir }: Pick<DoctorDeps, 'exec' | 'fs' | 'dataDir'>): Promise<Step[] | null> {
  const venv = path.join(dataDir, 'venv');
  const python = venvPython(dataDir);
  if (fs.existsSync(python) && await onPath(exec, python)) return installSteps(exec, venv, python);
  const create = await createVenvSteps(exec, venv, python);
  if (!create) return null;
  return fs.existsSync(venv) || fs.existsSync(python) ? [{ cmd: 'rm', args: ['-r', venv] }, ...create] : create;
}

// Steps as the one shell line the doctor prints in its fix.
function stepsText(steps: Step[]): string {
  return steps.map((s) => [s.cmd, ...s.args].join(' ')).join(' && ');
}

// The Python venv under the data folder must exist and import the two packages Kokoro needs. A venv folder with no
// working python (left by a failed create) is reported as half-made, and its fix removes the folder first.
async function checkVenv(deps: Pick<DoctorDeps, 'exec' | 'fs' | 'dataDir'>): Promise<DoctorCheck> {
  const { exec, fs, dataDir } = deps;
  const venv = path.join(dataDir, 'venv');
  const python = venvPython(dataDir);
  let detail: string;
  if (!fs.existsSync(python)) {
    detail = fs.existsSync(venv) ? `${venv} is half-made: it has no working bin/python` : `no venv at ${venv}`;
  } else {
    const r = await run(exec, python, ['-c', 'import kokoro_onnx, soundfile'], QUICK_MS);
    if (r.code === 0) return result('Python venv', true, true, `${venv} imports kokoro_onnx and soundfile`);
    // a python that runs but cannot import only needs the packages; one that does not run at all means start over
    detail = (await onPath(exec, python)) ? `${venv} cannot import kokoro_onnx and soundfile` : `${venv} is half-made: it has no working bin/python`;
  }
  const steps = await venvRepairSteps(deps);
  return result('Python venv', false, true, detail, steps ? stepsText(steps) : NO_PYTHON);
}

// Where Hyperframes keeps the Kokoro voice model once its tts command has downloaded it.
function kokoroModelPath(os: Pick<DoctorOs, 'homedir'>): string {
  return path.join(os.homedir(), '.cache', 'hyperframes', 'tts', 'models', 'kokoro-v1.0.onnx');
}

// The Kokoro voice model must be downloaded in full (a partial file is far smaller than 300 MB).
function checkModel({ fs, os }: Pick<DoctorDeps, 'fs' | 'os'>): DoctorCheck {
  const file = kokoroModelPath(os);
  const fix = 'generate any narration once with `hyperframes tts` to download the Kokoro model, then re-run oldguy doctor';
  if (!fs.existsSync(file)) return result('Kokoro model', false, true, `not found at ${file}`, fix);
  const mb = Math.round(fs.statSync(file).size / 1e6);
  const ok = mb * 1e6 >= MIN_MODEL_BYTES;
  return result('Kokoro model', ok, true, `${mb} MB at ${file} (need over 300 MB)`, `${fix} (the file looks cut short, delete it first)`);
}

// Rendering caches grow to about 1 GB, so refuse to start with less than that free.
function checkDisk({ fs, os }: Pick<DoctorDeps, 'fs' | 'os'>): DoctorCheck {
  const s = fs.statfsSync(os.homedir());
  const gb = (s.bavail * s.bsize) / GB;
  return result('Free disk', gb >= MIN_FREE_DISK_GB, true, `${gb.toFixed(1)} GB free (need ${MIN_FREE_DISK_GB} GB)`,
    'free up disk space; Hyperframes caches and renders need at least 1 GB');
}

// whisper-cli only improves captions, so its absence is a note, never a failure.
// `timeout` lets narrate wait longer: beside a running render, the first call has taken 20 s to answer.
async function checkWhisper(exec: Exec, timeout = QUICK_MS): Promise<DoctorCheck> {
  const r = await run(exec, 'whisper-cli', ['--help'], timeout);
  return result('whisper-cli', r.code === 0, false, r.code === 0 ? 'found on PATH' : 'not on PATH (captions will be sentence-level)',
    'optional: brew install whisper-cpp for word-level captions');
}

// Free memory decides how many chapters render at once; this only reports the number.
function checkRam({ os }: Pick<DoctorDeps, 'os'>): DoctorCheck {
  const gb = freeRamGb(os);
  return result('Free RAM', true, false, `${gb.toFixed(1)} GB free, so ${renderCap(gb)} at a time`);
}

// Asks the pinned Hyperframes (through npx, as render does; it is not on PATH) and keeps only its Chrome verdict.
// Chrome can also be fetched later, so it is advisory.
async function checkChrome(exec: Exec): Promise<DoctorCheck> {
  const fix = `run \`npx ${hyperframesArgs(['browser', 'ensure']).join(' ')}\` to download a Chrome for rendering`;
  const r = await run(exec, 'npx', hyperframesArgs(['doctor', '--json']), SLOW_MS);
  let chrome: { name?: unknown; ok?: unknown; detail?: unknown } | undefined;
  try {
    // a missing stdout makes JSON.parse throw, which the catch below reports
    const parsed = JSON.parse(r.stdout as string) as { checks?: { name?: unknown; ok?: unknown; detail?: unknown }[] };
    chrome = (parsed.checks || []).find((c) => /chrome/i.test(String(c.name)));
  } catch {
    return result('Chrome', false, false, 'could not read the Hyperframes doctor output', fix);
  }
  if (!chrome) return result('Chrome', false, false, 'Hyperframes doctor did not report a Chrome check', fix);
  return result('Chrome', chrome.ok === true, false, String(chrome.detail || (chrome.ok ? 'found' : 'missing')), fix);
}

// Runs every check and returns the list of results; required ones decide whether oldguy can run at all.
async function runDoctor({ exec, fs, env, os, nodeVersion, dataDir }: DoctorDeps): Promise<DoctorReport> {
  return [
    checkNode(nodeVersion),
    await checkFfmpeg(exec, env),
    await checkVenv({ exec, fs, dataDir }),
    checkModel({ fs, os }),
    checkDisk({ fs, os }),
    await checkWhisper(exec),
    checkRam({ os }),
    await checkChrome(exec),
  ];
}

// Records that the doctor passed, so the session-start hint can stop nagging.
function writeMarker(dataDir: string, fs: Pick<typeof realFs, 'mkdirSync' | 'writeFileSync'> = realFs): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'doctor-ok'), `${new Date().toISOString()}\n`);
}

export { runDoctor, writeMarker, venvPython, freeRamGb, checkWhisper, venvRepairSteps, stepsText, onPath, kokoroModelPath, NO_PYTHON };
export type { DoctorCheck, DoctorReport, DoctorDeps, Exec, RunResult, DoctorFs, DoctorOs, Step };
