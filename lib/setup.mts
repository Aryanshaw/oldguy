// oldguy setup: turns what the doctor found missing into install items, each with its size and the exact programs it
// runs, and runs only the items the user agreed to. Things it cannot install safely are listed as manual, with the
// doctor's fix line. Every outside call is passed in, so tests run nothing real.
import path from 'node:path';
import { runDoctor, venvRepairSteps, venvPython, onPath, kokoroModelPath, NO_PYTHON } from './doctor.mts';
import { hyperframesArgs } from './hyperframes.mts';
import type { DoctorCheck, DoctorDeps, Step } from './doctor.mts';

// The things setup can install, in the order it installs them.
const ITEM_IDS = ['voice', 'captions', 'chrome'] as const;
type ItemId = (typeof ITEM_IDS)[number];
// A step either runs a program or writes a small text file (the sentence the voice step speaks once).
type SetupStep = Step | { write: string; text: string };
// One thing setup offers: what it is, roughly how big, what it runs, and anything the user should know first.
type SetupItem = { id: ItemId; what: string; size: string; steps: SetupStep[]; note?: string };
// A problem setup will not touch: the doctor's finding, its fix line, and whether oldguy can run without it.
type ManualItem = { name: string; why: string; fix: string; required: boolean };
type SetupPlan = { items: SetupItem[]; manual: ManualItem[] };
// The doctor's own dependencies, plus the platform and a scratch folder.
type SetupDeps = DoctorDeps & { platform: string; tmpDir: string };
// What running the agreed items needs: a program runner, a file writer and a progress printer.
type RunDeps = {
  exec: DoctorDeps['exec'];
  writeFile: (file: string, text: string) => void;
  log: (line: string) => void;
};

// Installs and downloads take minutes on a slow connection.
const STEP_MS = 20 * 60 * 1000;
// Checks setup turns into items of its own; every other failed required check is manual.
const OWN = ['Python venv', 'Kokoro model', 'whisper-cli', 'Chrome'];

// The voice item: repair the venv when needed, then speak one sentence with Hyperframes, which downloads the model.
async function voiceItem(deps: SetupDeps, checks: DoctorCheck[]): Promise<SetupItem | ManualItem | null> {
  const venvBad = checks.some((c) => c.name === 'Python venv' && !c.ok);
  const modelBad = checks.some((c) => c.name === 'Kokoro model' && !c.ok);
  if (!venvBad && !modelBad) return null;
  const steps: SetupStep[] = [];
  if (venvBad) {
    const repair = await venvRepairSteps(deps);
    if (!repair) return { name: 'Python venv', why: 'no Python 3.10 to 3.12 and no uv on PATH', fix: NO_PYTHON, required: true };
    steps.push(...repair);
  }
  if (modelBad) {
    const model = kokoroModelPath(deps.os);
    // a file cut short by an earlier download must go first, or Hyperframes keeps using it
    if (deps.fs.existsSync(model)) steps.push({ cmd: 'rm', args: [model] });
    const text = path.join(deps.tmpDir, 'oldguy-setup-voice.txt');
    steps.push({ write: text, text: 'Hello from oldguy.\n' });
    steps.push({ cmd: 'npx', args: hyperframesArgs(['tts', text, '-o', path.join(deps.tmpDir, 'oldguy-setup-voice.wav'), '--json']), env: { HYPERFRAMES_PYTHON: venvPython(deps.dataDir) } });
  }
  const size = [venvBad && 'about 130 MB', modelBad && '353 MB'].filter(Boolean).join(' + ');
  const parts = [venvBad && 'a Python venv in oldguy\'s data folder with kokoro-onnx and soundfile', modelBad && 'the Kokoro voice model'].filter(Boolean);
  return { id: 'voice', what: `Voice: ${parts.join(', and ')}`, size, steps };
}

// The captions item: whisper.cpp through Homebrew on macOS; anywhere else it is a manual step.
async function captionsItem(deps: SetupDeps, checks: DoctorCheck[]): Promise<SetupItem | ManualItem | null> {
  const whisper = checks.find((c) => c.name === 'whisper-cli');
  if (!whisper || whisper.ok) return null;
  if (deps.platform !== 'darwin' || !(await onPath(deps.exec, 'brew'))) {
    return { name: 'whisper-cli', why: whisper.detail, fix: 'build whisper.cpp (https://github.com/ggml-org/whisper.cpp) so whisper-cli is on PATH, or skip it: captions stay sentence-level', required: false };
  }
  return {
    id: 'captions', what: 'Word-by-word captions: whisper.cpp through Homebrew', size: 'whisper.cpp, then 487 MB for the small.en model',
    steps: [{ cmd: 'brew', args: ['install', 'whisper-cpp'] }],
    note: 'Homebrew installs whisper.cpp and its dependencies. The small.en model downloads the first time a chapter is narrated.',
  };
}

// The chrome item: the browser Hyperframes renders with.
function chromeItem(checks: DoctorCheck[]): SetupItem | null {
  const chrome = checks.find((c) => c.name === 'Chrome');
  if (!chrome || chrome.ok) return null;
  return { id: 'chrome', what: 'Chrome for rendering, downloaded by Hyperframes', size: 'one headless Chrome download', steps: [{ cmd: 'npx', args: hyperframesArgs(['browser', 'ensure']) }] };
}

// Runs the doctor and turns what it found into the plan: the items setup can install and the manual ones.
async function planSetup(deps: SetupDeps): Promise<SetupPlan> {
  const checks = await runDoctor(deps);
  const plan: SetupPlan = { items: [], manual: [] };
  for (const found of [await voiceItem(deps, checks), await captionsItem(deps, checks), chromeItem(checks)]) {
    if (!found) continue;
    if ('id' in found) plan.items.push(found); else plan.manual.push(found);
  }
  for (const c of checks) {
    if (!c.ok && c.required && !OWN.includes(c.name)) plan.manual.push({ name: c.name, why: c.detail, fix: c.fix, required: true });
  }
  return plan;
}

// Checks the comma-separated items against the plan; throws a message for one that is unknown or not needed.
function pickItems(plan: SetupPlan, list: string): SetupItem[] {
  const ids = list.split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error('name at least one item, for example --install voice');
  for (const id of ids) {
    if (!(ITEM_IDS as readonly string[]).includes(id)) throw new Error(`"${id.slice(0, 40)}" is not an item (items: ${ITEM_IDS.join(', ')})`);
    if (!plan.items.some((i) => i.id === id)) throw new Error(`${id} is not needed on this machine (run oldguy setup to see what is)`);
  }
  // always in the fixed order, so the voice venv exists before anything that might use it
  return plan.items.filter((i) => ids.includes(i.id));
}

// The step as the user would type it, for the plan and the progress lines.
function stepLine(step: SetupStep): string {
  return 'write' in step ? `write ${step.write}` : [step.cmd, ...step.args].join(' ');
}

// Runs the agreed items' steps in order and stops at the first failure. Returns true when every step succeeded.
async function runItems(items: SetupItem[], { exec, writeFile, log }: RunDeps): Promise<boolean> {
  for (const item of items) {
    log(`${item.id}:`);
    for (const step of item.steps) {
      log(`  → ${stepLine(step)}`);
      if ('write' in step) {
        writeFile(step.write, step.text);
        continue;
      }
      let r;
      try {
        r = await exec(step.cmd, step.args, { timeout: STEP_MS, env: step.env });
      } catch (err) {
        r = { code: -1, stderr: String((err as Error).message || err) };
      }
      if (r.code !== 0) {
        const why = String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ') || `exit code ${r.code}`;
        log(`  failed: ${why}`);
        return false;
      }
    }
    log(`  ${item.id} done`);
  }
  return true;
}

export { ITEM_IDS, planSetup, pickItems, runItems, stepLine };
export type { ItemId, SetupItem, ManualItem, SetupPlan, SetupDeps, SetupStep, RunDeps };
