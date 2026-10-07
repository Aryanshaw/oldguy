const test = require('node:test');
const assert = require('node:assert/strict');
const { planSetup, pickItems, runItems } = require('../lib/setup.mts');
const { runSetupCli } = require('../cli/setup.mts');
const { HYPERFRAMES_VERSION } = require('../lib/hyperframes.mts');

const GB = 1024 ** 3;
const DATA = '/data';
const HOME = '/home/u';
const VENV = `${DATA}/venv`;
const VENV_PY = `${VENV}/bin/python`;
const MODEL = `${HOME}/.cache/hyperframes/tts/models/kokoro-v1.0.onnx`;
const HF = ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`];
const OK = { code: 0, stdout: '', stderr: '' };

// A pretend machine where everything is installed; each test takes something away. Every program call is recorded.
function machine(over = {}) {
  const files = { [VENV_PY]: 1, [MODEL]: 325e6, ...(over.files || {}) };
  for (const gone of over.missing || []) delete files[gone];
  const chromeOk = over.chromeOk ?? true;
  const handlers = {
    ffmpeg: () => ({ code: 0, stdout: 'ffmpeg version 7.1', stderr: '' }),
    [VENV_PY]: () => OK,
    'whisper-cli': () => OK,
    hyperframes: (args) => (args[0] === 'doctor'
      ? { code: 0, stdout: JSON.stringify({ checks: [{ name: 'Chrome', ok: chromeOk, detail: chromeOk ? 'found' : 'missing' }] }), stderr: '' }
      : OK),
    ...(over.exec || {}),
  };
  for (const gone of over.offPath || []) delete handlers[gone];
  const calls = [];
  const written = [];
  const out = { stdout: '', stderr: '' };
  const deps = {
    exec: async (cmd, args, opts) => {
      calls.push([cmd, args, opts && opts.env]);
      if (cmd === 'npx' && args[0] === '--yes' && args[1] === HF[1]) return handlers.hyperframes(args.slice(2));
      const h = handlers[cmd];
      return h ? h(args) : { code: 127, stdout: '', stderr: 'not found' };
    },
    fs: {
      existsSync: (p) => p in files,
      statSync: (p) => ({ size: files[p] }),
      statfsSync: () => ({ bavail: (over.freeDiskGb ?? 50) * GB, bsize: 1 }),
      readFileSync: () => { throw Object.assign(new Error('none'), { code: 'ENOENT' }); },
    },
    env: { CLAUDE_PLUGIN_DATA: DATA },
    os: { homedir: () => HOME, freemem: () => 8 * GB },
    nodeVersion: 'v22.18.0',
    dataDir: DATA,
    platform: over.platform ?? 'linux',
    tmpDir: '/tmp',
    cwd: '/repo',
    marker: () => { out.marked = true; },
    writeFile: (file, text) => written.push([file, text]),
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
  };
  return { deps, calls, written, out };
}
// Only the program calls that change something (the doctor's own probes are left out).
const installCalls = (calls) => calls.filter(([cmd, args]) => !(args.includes('--version') || args[0] === '-c' || args.includes('doctor') || cmd === 'ffmpeg' || args[0] === '--help'));

test('a fully set-up machine has nothing to offer', async () => {
  const plan = await planSetup(machine().deps);
  assert.deepEqual(plan, { items: [], manual: [] });
});

test('no venv, no model, uv present: voice makes the venv with uv, then speaks once to fetch the model', async () => {
  const m = machine({ missing: [VENV_PY, MODEL], exec: { uv: () => OK } });
  const plan = await planSetup(m.deps);
  assert.deepEqual(plan.items.map((i) => i.id), ['voice']);
  const [voice] = plan.items;
  assert.match(voice.size, /130 MB.*353 MB/);
  assert.deepEqual(voice.steps, [
    { cmd: 'uv', args: ['venv', '--python', '3.12', VENV] },
    { cmd: 'uv', args: ['pip', 'install', '--python', VENV_PY, 'kokoro-onnx', 'soundfile'] },
    { write: '/tmp/oldguy-setup-voice.txt', text: 'Hello from oldguy.\n' },
    { cmd: 'npx', args: [...HF, 'tts', '/tmp/oldguy-setup-voice.txt', '-o', '/tmp/oldguy-setup-voice.wav', '--json'], env: { HYPERFRAMES_PYTHON: VENV_PY } },
  ]);
});

test('no uv: voice uses the newest python3.x on PATH and the venv pip', async () => {
  const m = machine({ missing: [VENV_PY], exec: { 'python3.11': () => OK } });
  const [voice] = (await planSetup(m.deps)).items;
  assert.deepEqual(voice.steps, [
    { cmd: 'python3.11', args: ['-m', 'venv', VENV] },
    { cmd: `${VENV}/bin/pip`, args: ['install', 'kokoro-onnx', 'soundfile'] },
  ]);
});

test('no Python and no uv: the venv is manual, never offered', async () => {
  const plan = await planSetup(machine({ missing: [VENV_PY] }).deps);
  assert.deepEqual(plan.items, []);
  assert.equal(plan.manual[0].name, 'Python venv');
  assert.match(plan.manual[0].fix, /install Python 3.12 or uv/);
});

test('a model cut short is removed before it is fetched again', async () => {
  const [voice] = (await planSetup(machine({ files: { [MODEL]: 10e6 } }).deps)).items;
  assert.deepEqual(voice.steps[0], { cmd: 'rm', args: [MODEL] });
});

test('captions: Homebrew on macOS, manual on Linux; chrome is fetched by Hyperframes', async () => {
  const mac = await planSetup(machine({ platform: 'darwin', offPath: ['whisper-cli'], exec: { brew: () => OK }, chromeOk: false }).deps);
  assert.deepEqual(mac.items.map((i) => i.id), ['captions', 'chrome']);
  assert.deepEqual(mac.items[0].steps, [{ cmd: 'brew', args: ['install', 'whisper-cpp'] }]);
  assert.match(mac.items[0].note, /Homebrew installs whisper.cpp and its dependencies/);
  assert.deepEqual(mac.items[1].steps, [{ cmd: 'npx', args: [...HF, 'browser', 'ensure'] }]);
  const linux = await planSetup(machine({ offPath: ['whisper-cli'] }).deps);
  assert.deepEqual(linux.items, []);
  assert.equal(linux.manual[0].name, 'whisper-cli');
  assert.equal(linux.manual[0].required, false);
});

test('a broken ffmpeg or a full disk is manual, with the doctor fix line', async () => {
  const plan = await planSetup(machine({ offPath: ['ffmpeg'], freeDiskGb: 0.2 }).deps);
  assert.deepEqual(plan.manual.map((x) => x.name), ['ffmpeg', 'Free disk']);
  assert.ok(plan.manual.every((x) => x.fix.length > 0 && x.required === true));
});

test('pickItems: fixed order, unknown or unneeded items are refused', async () => {
  const plan = { items: [{ id: 'voice', steps: [] }, { id: 'chrome', steps: [] }], manual: [] };
  assert.deepEqual(pickItems(plan, 'chrome,voice').map((i) => i.id), ['voice', 'chrome']);
  assert.throws(() => pickItems(plan, 'everything'), /not an item/);
  assert.throws(() => pickItems(plan, 'captions'), /not needed/);
  assert.throws(() => pickItems(plan, ''), /at least one/);
});

test('runItems stops at the first failed step and runs nothing after it', async () => {
  const ran = [];
  const exec = async (cmd) => { ran.push(cmd); return cmd === 'b' ? { code: 1, stderr: 'boom' } : OK; };
  const log = [];
  const ok = await runItems([{ id: 'voice', steps: [{ cmd: 'a', args: [] }, { cmd: 'b', args: [] }, { cmd: 'c', args: [] }] }, { id: 'chrome', steps: [{ cmd: 'd', args: [] }] }],
    { exec, writeFile: () => {}, log: (l) => log.push(l) });
  assert.equal(ok, false);
  assert.deepEqual(ran, ['a', 'b']);
  assert.ok(log.some((l) => /failed: boom/.test(l)));
});

test('oldguy setup without --install only prints the plan and installs nothing', async () => {
  const m = machine({ missing: [VENV_PY], exec: { uv: () => OK } });
  assert.equal(await runSetupCli([], m.deps), 0);
  assert.match(m.out.stdout, /Nothing is installed until you agree/);
  assert.match(m.out.stdout, /runs: uv venv --python 3.12/);
  assert.match(m.out.stdout, /oldguy setup --install voice/);
  assert.deepEqual(installCalls(m.calls), []);
  assert.deepEqual(m.written, []);
});

test('oldguy setup --install voice runs exactly the voice steps, then the doctor, and marks the pass', async () => {
  let made = false;
  const m = machine({ missing: [VENV_PY], exec: { uv: (args) => { if (args[0] === 'pip') made = true; return OK; } } });
  // once uv has installed the packages, the venv python exists and imports
  const exists = m.deps.fs.existsSync;
  m.deps.fs.existsSync = (p) => (p === VENV_PY ? made : exists(p));
  assert.equal(await runSetupCli(['--install', 'voice'], m.deps), 0);
  assert.deepEqual(installCalls(m.calls).map(([cmd, args]) => [cmd, ...args].join(' ')), [
    `uv venv --python 3.12 ${VENV}`,
    `uv pip install --python ${VENV_PY} kokoro-onnx soundfile`,
  ]);
  assert.match(m.out.stdout, /Setup done: oldguy doctor passes/);
  assert.equal(m.out.marked, true);
});

test('oldguy setup --install with an unknown or unneeded item exits 2 and runs nothing', async () => {
  for (const list of ['everything', 'chrome']) {
    const m = machine({ missing: [VENV_PY], exec: { uv: () => OK } });
    assert.equal(await runSetupCli(['--install', list], m.deps), 2, list);
    assert.deepEqual(installCalls(m.calls), [], list);
  }
});
