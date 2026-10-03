const test = require('node:test');
const assert = require('node:assert/strict');
const fsReal = require('node:fs');
const osReal = require('node:os');
const path = require('node:path');
const { runDoctor, writeMarker, checkWhisper } = require('../lib/doctor.mts');
const { runDoctorCli, realExec } = require('../cli/doctor.mts');
const { nodeProblem } = require('../lib/node-floor.cjs');
const { HYPERFRAMES_VERSION } = require('../lib/hyperframes.mts');

const GB = 1024 ** 3;
const DATA = '/data';
const HOME = '/home/u';
const VENV_PY = `${DATA}/venv/bin/python`;
const MODEL = `${HOME}/.cache/hyperframes/tts/models/kokoro-v1.0.onnx`;
const DYLD = 'dyld[67197]: Library not loaded: /opt/homebrew/opt/x265/lib/libx265.216.dylib';
const OK = { code: 0, stdout: '', stderr: '' };

// Builds a pretend machine where everything is installed; each test breaks one thing.
function machine(over = {}) {
  const files = { [VENV_PY]: 1, [MODEL]: 325e6, ...(over.files || {}) };
  const handlers = {
    node: () => OK,
    ffmpeg: () => ({ code: 0, stdout: 'ffmpeg version 7.1', stderr: '' }),
    [VENV_PY]: () => OK,
    'whisper-cli': () => OK,
    hyperframes: () => ({ code: 0, stdout: JSON.stringify({ ok: true, checks: [{ name: 'Chrome', ok: true, detail: 'found' }] }), stderr: '' }),
    ...(over.exec || {}),
  };
  const calls = [];
  return {
    calls,
    deps: {
      exec: async (cmd, args, opts) => {
        calls.push([cmd, args, opts]);
        // the pinned `npx --yes hyperframes@<version> ...` reaches the pretend hyperframes; bare `hyperframes` is not on PATH
        if (cmd === 'npx' && args[0] === '--yes' && args[1] === `hyperframes@${HYPERFRAMES_VERSION}`) return handlers.hyperframes(args.slice(2));
        const h = cmd === 'hyperframes' ? null : handlers[cmd];
        if (!h) return { code: 127, stdout: '', stderr: 'not found' };
        return h(args);
      },
      fs: {
        existsSync: (p) => p in files,
        statSync: (p) => ({ size: files[p] }),
        statfsSync: () => ({ bavail: (over.freeDiskGb ?? 50) * GB, bsize: 1 }),
      },
      env: { CLAUDE_PLUGIN_DATA: DATA, ...(over.env || {}) },
      os: { homedir: () => HOME, freemem: () => (over.freeRamGb ?? 8) * GB },
      nodeVersion: over.nodeVersion ?? 'v22.18.0',
      dataDir: DATA,
    },
  };
}

// Picks one check result by name.
const byName = (results, name) => results.find((r) => r.name === name);

test('everything installed: every check ok and has the stable keys', async () => {
  const r = await runDoctor(machine().deps);
  assert.ok(r.length >= 8);
  for (const c of r) {
    assert.deepEqual(Object.keys(c), ['name', 'ok', 'required', 'detail', 'fix']);
    assert.equal(c.ok, true, c.name);
  }
});

test('the real broken-ffmpeg failure is reported with the library fix text', async () => {
  const m = machine({ exec: { ffmpeg: () => ({ code: 134, stdout: '', stderr: DYLD }) } });
  const c = byName(await runDoctor(m.deps), 'ffmpeg');
  assert.equal(c.ok, false);
  assert.equal(c.required, true);
  assert.match(c.fix, /library ffmpeg needs is missing/);
  assert.match(c.fix, /reinstall ffmpeg/);
  assert.match(c.fix, /HYPERFRAMES_FFMPEG_PATH/);
  assert.match(c.fix, /HYPERFRAMES_FFPROBE_PATH/);
});

test('ffmpeg missing entirely is a failure too', async () => {
  const m = machine({ exec: { ffmpeg: () => { throw new Error('spawn ffmpeg ENOENT'); } } });
  const c = byName(await runDoctor(m.deps), 'ffmpeg');
  assert.equal(c.ok, false);
  assert.match(c.fix, /install ffmpeg/i);
});

test('Node 20 fails and names the version', async () => {
  const c = byName(await runDoctor(machine({ nodeVersion: 'v20.11.1' }).deps), 'Node');
  assert.equal(c.ok, false);
  assert.match(c.detail, /20\.11\.1/);
  assert.match(c.fix, /22/);
});

test('Node 22.17.0 fails with the floor sentence as its fix and 22.18.0 passes', async () => {
  const old = byName(await runDoctor(machine({ nodeVersion: '22.17.0' }).deps), 'Node');
  assert.equal(old.ok, false);
  assert.equal(old.required, true);
  assert.match(old.detail, /22\.17\.0/);
  assert.equal(old.fix, nodeProblem('22.17.0', ''));
  const fine = byName(await runDoctor(machine({ nodeVersion: '22.18.0' }).deps), 'Node');
  assert.equal(fine.ok, true);
  assert.equal(fine.fix, '');
});

const VENV = `${DATA}/venv`;
const UV_CREATE = `uv venv --python 3.12 ${VENV} && uv pip install --python ${VENV_PY} kokoro-onnx soundfile`;

// A machine with no venv python; `venvFolder` leaves a half-made venv folder behind; `exec` adds tools on PATH.
function noVenv({ venvFolder = false, exec = {} } = {}) {
  const m = machine({ exec });
  const files = { [MODEL]: 325e6, ...(venvFolder ? { [VENV]: 1 } : {}) };
  m.deps.fs.existsSync = (p) => p in files;
  m.deps.fs.statSync = (p) => ({ size: files[p] });
  return m;
}

test('missing venv with uv on PATH: the fix makes a Python 3.12 venv with uv', async () => {
  const c = byName(await runDoctor(noVenv({ exec: { uv: () => OK } }).deps), 'Python venv');
  assert.equal(c.ok, false);
  assert.equal(c.detail, `no venv at ${VENV}`);
  assert.equal(c.fix, UV_CREATE);
});

test('missing venv without uv: the fix uses the newest of python3.12, 3.11, 3.10 on PATH', async () => {
  const both = noVenv({ exec: { 'python3.11': () => OK, 'python3.12': () => OK } });
  assert.equal(byName(await runDoctor(both.deps), 'Python venv').fix,
    `python3.12 -m venv ${VENV} && ${VENV}/bin/pip install kokoro-onnx soundfile`);
  const old = noVenv({ exec: { 'python3.10': () => OK } });
  assert.equal(byName(await runDoctor(old.deps), 'Python venv').fix,
    `python3.10 -m venv ${VENV} && ${VENV}/bin/pip install kokoro-onnx soundfile`);
});

test('missing venv with no uv and no Python 3.10 to 3.12: the fix says plainly what to install', async () => {
  const c = byName(await runDoctor(noVenv({ exec: { python3: () => OK } }).deps), 'Python venv');
  assert.equal(c.ok, false);
  assert.match(c.fix, /Python 3\.10 to 3\.12 is needed/);
  assert.match(c.fix, /install/);
  assert.doesNotMatch(c.fix, /python3 -m venv/);
});

test('a half-made venv (folder but no bin/python) says so and the fix removes it first', async () => {
  const c = byName(await runDoctor(noVenv({ venvFolder: true, exec: { uv: () => OK } }).deps), 'Python venv');
  assert.equal(c.ok, false);
  assert.match(c.detail, /half-made/);
  assert.match(c.detail, /no working bin\/python/);
  assert.equal(c.fix, `rm -r ${VENV} && ${UV_CREATE}`);
});

test('a venv whose bin/python does not run is half-made too', async () => {
  const m = machine({ exec: { [VENV_PY]: () => ({ code: 1, stdout: '', stderr: 'dyld: image not found' }), 'python3.12': () => OK } });
  const c = byName(await runDoctor(m.deps), 'Python venv');
  assert.match(c.detail, /half-made/);
  assert.equal(c.fix, `rm -r ${VENV} && python3.12 -m venv ${VENV} && ${VENV}/bin/pip install kokoro-onnx soundfile`);
});

// The venv python runs (--version works) but cannot import the packages.
const IMPORT_FAILS = { [VENV_PY]: (args) => (args[0] === '--version' ? OK : { code: 1, stdout: '', stderr: 'ModuleNotFoundError' }) };

test('venv that cannot import kokoro_onnx: the fix is only the install line (uv when present, else the venv pip)', async () => {
  const withUv = machine({ exec: { ...IMPORT_FAILS, uv: () => OK } });
  const c = byName(await runDoctor(withUv.deps), 'Python venv');
  assert.equal(c.ok, false);
  assert.match(c.detail, /cannot import kokoro_onnx and soundfile/);
  assert.equal(c.fix, `uv pip install --python ${VENV_PY} kokoro-onnx soundfile`);
  const call = withUv.calls.find(([cmd, args]) => cmd === VENV_PY && args[0] === '-c');
  assert.deepEqual(call[1], ['-c', 'import kokoro_onnx, soundfile']);
  const noUv = machine({ exec: IMPORT_FAILS });
  assert.equal(byName(await runDoctor(noUv.deps), 'Python venv').fix, `${VENV}/bin/pip install kokoro-onnx soundfile`);
});

test('a working venv probes neither uv nor any python3.x', async () => {
  const m = machine({ exec: { uv: () => OK, 'python3.12': () => OK } });
  await runDoctor(m.deps);
  assert.deepEqual(m.calls.filter(([cmd]) => /^(uv|python3)/.test(cmd)), []);
});

test('a 10 MB Kokoro model file is too small', async () => {
  const c = byName(await runDoctor(machine({ files: { [MODEL]: 10e6 } }).deps), 'Kokoro model');
  assert.equal(c.ok, false);
  assert.match(c.detail, /10 MB/);
});

test('missing whisper-cli is advisory and does not fail the run', async () => {
  const m = machine({ exec: { 'whisper-cli': () => ({ code: 127, stdout: '', stderr: 'nope' }) } });
  const r = await runDoctor(m.deps);
  const c = byName(r, 'whisper-cli');
  assert.equal(c.ok, false);
  assert.equal(c.required, false);
  assert.equal(r.filter((x) => x.required && !x.ok).length, 0);
});

// a busy machine (a render running beside narrate) once took 20 s to answer `whisper-cli --help`
test('the whisper check waits as long as its caller allows, 15 s when not told', async () => {
  const m = machine();
  await checkWhisper(m.deps.exec);
  await checkWhisper(m.deps.exec, 600000);
  const timeouts = m.calls.filter(([cmd]) => cmd === 'whisper-cli').map(([, , opts]) => opts.timeout);
  assert.deepEqual(timeouts, [15000, 600000]);
});

test('disk of 0.5 GB fails', async () => {
  const c = byName(await runDoctor(machine({ freeDiskGb: 0.5 }).deps), 'Free disk');
  assert.equal(c.ok, false);
  assert.equal(c.required, true);
});

test('free RAM is advisory and reports the render cap', async () => {
  const c = byName(await runDoctor(machine({ freeRamGb: 4.5 }).deps), 'Free RAM');
  assert.equal(c.required, false);
  assert.match(c.detail, /2 at a time/);
  const low = byName(await runDoctor(machine({ freeRamGb: 1 }).deps), 'Free RAM');
  assert.equal(low.ok, true);
  assert.match(low.detail, /1 at a time/);
});

test('Hyperframes Chrome check failing is advisory; bad output does not crash', async () => {
  const bad = { ok: false, checks: [{ name: 'Chrome', ok: false, detail: 'missing' }] };
  const m = machine({ exec: { hyperframes: () => ({ code: 1, stdout: JSON.stringify(bad), stderr: '' }) } });
  const r = await runDoctor(m.deps);
  const c = byName(r, 'Chrome');
  assert.equal(c.ok, false);
  assert.equal(c.required, false);
  const junk = machine({ exec: { hyperframes: () => ({ code: 0, stdout: 'not json', stderr: '' }) } });
  assert.equal(byName(await runDoctor(junk.deps), 'Chrome').ok, false);
});

test('Chrome check asks the pinned Hyperframes through npx, and its fix names the pinned command', async () => {
  const m = machine();
  const c = byName(await runDoctor(m.deps), 'Chrome');
  assert.equal(c.ok, true);
  const hf = m.calls.filter(([cmd, args]) => cmd === 'hyperframes' || (cmd === 'npx' && String(args[1]).startsWith('hyperframes')));
  assert.deepEqual(hf.map(([cmd, args]) => [cmd, args]), [['npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'doctor', '--json']]]);
  const missing = machine({ exec: { hyperframes: () => ({ code: 0, stdout: JSON.stringify({ checks: [] }), stderr: '' }) } });
  const fix = byName(await runDoctor(missing.deps), 'Chrome').fix;
  assert.match(fix, new RegExp(`npx --yes hyperframes@${HYPERFRAMES_VERSION.replace(/\./g, '\\.')} browser ensure`));
});

test('every outside call is given a timeout', async () => {
  const m = machine();
  await runDoctor(m.deps);
  assert.ok(m.calls.length > 0);
  for (const [, , opts] of m.calls) assert.ok(opts && opts.timeout > 0);
});

// Runs the doctor command against a pretend machine and captures what it printed.
async function cli(args, over) {
  const m = machine(over);
  let out = '';
  let err = '';
  const code = await runDoctorCli(args, {
    ...m.deps,
    marker: (dir) => { m.marked = dir; },
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
  });
  return { code, out, err, marked: m.marked };
}

test('--json prints parseable output with stable keys and exits 0, writing the marker', async () => {
  const r = await cli(['--json']);
  assert.equal(r.code, 0);
  const j = JSON.parse(r.out);
  assert.deepEqual(Object.keys(j), ['ok', 'checks']);
  assert.equal(j.ok, true);
  assert.deepEqual(Object.keys(j.checks[0]), ['name', 'ok', 'required', 'detail', 'fix']);
  assert.equal(r.marked, DATA);
});

test('a failing required check exits 1 and writes no marker', async () => {
  const r = await cli([], { freeDiskGb: 0.5 });
  assert.equal(r.code, 1);
  assert.equal(r.marked, undefined);
  assert.match(r.out, /Free disk/);
});

test('--data-dir overrides the data directory; a bad flag exits 2', async () => {
  const r = await cli(['--data-dir', '/elsewhere'], { files: { '/elsewhere/venv/bin/python': 1 }, exec: { '/elsewhere/venv/bin/python': () => OK } });
  assert.equal(r.marked, '/elsewhere');
  const bad = await cli(['--bogus']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /unknown option/);
});

test('writeMarker creates doctor-ok inside the data directory', () => {
  const dir = fsReal.mkdtempSync(path.join(osReal.tmpdir(), 'yap-doctor-'));
  try {
    const nested = path.join(dir, 'a', 'b');
    writeMarker(nested);
    assert.ok(fsReal.existsSync(path.join(nested, 'doctor-ok')));
  } finally {
    fsReal.rmSync(dir, { recursive: true, force: true });
  }
});

test('ffmpeg killed by a signal still shows the dyld text and the library fix', async () => {
  const m = machine({ exec: { ffmpeg: () => ({ code: null, signal: 'SIGABRT', stdout: '', stderr: DYLD, timedOut: false }) } });
  const c = byName(await runDoctor(m.deps), 'ffmpeg');
  assert.equal(c.ok, false);
  assert.match(c.detail, /Library not loaded: \/opt\/homebrew\/opt\/x265\/lib\/libx265\.216\.dylib/);
  assert.match(c.fix, /library ffmpeg needs is missing/);
});

test('a timed-out ffmpeg is not ok and says it timed out', async () => {
  const m = machine({ exec: { ffmpeg: () => ({ code: null, signal: 'SIGTERM', stdout: '', stderr: '', timedOut: true }) } });
  const c = byName(await runDoctor(m.deps), 'ffmpeg');
  assert.equal(c.ok, false);
  assert.match(c.detail, /timed out/);
});

test('real exec wrapper resolves for a signal kill, a non-zero exit, a timeout and a missing program', async () => {
  const killed = await realExec(process.execPath, ['-e', "process.kill(process.pid,'SIGKILL')"], { timeout: 10000 });
  assert.equal(killed.code, null);
  assert.equal(killed.signal, 'SIGKILL');
  assert.equal(killed.timedOut, false);
  const exited = await realExec(process.execPath, ['-e', 'process.exit(3)'], { timeout: 10000 });
  assert.equal(exited.code, 3);
  assert.equal(exited.signal, null);
  const slow = await realExec(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { timeout: 200 });
  assert.equal(slow.timedOut, true);
  const missing = await realExec('yap-no-such-program-xyz', [], { timeout: 1000 });
  assert.equal(missing.code, null);
  assert.match(missing.stderr, /ENOENT/);
  const fine = await realExec(process.execPath, ['-e', "process.stdout.write('hi')"], { timeout: 10000 });
  assert.deepEqual([fine.code, fine.stdout, fine.timedOut], [0, 'hi', false]);
});

// Runs the doctor command with the real marker writer into a temp data dir; returns exit code and whether the marker exists.
async function cliWithMarker(over) {
  const dir = fsReal.mkdtempSync(path.join(osReal.tmpdir(), 'yap-doctor-'));
  try {
    const py = `${dir}/venv/bin/python`;
    const m = machine({ ...over, files: { [py]: 1 }, exec: { [py]: () => OK, ...over.exec } });
    const code = await runDoctorCli(['--data-dir', dir], { ...m.deps, stdout: () => {}, stderr: () => {} , marker: require('../lib/doctor.mts').writeMarker });
    return { code, marked: fsReal.existsSync(path.join(dir, 'doctor-ok')) };
  } finally {
    fsReal.rmSync(dir, { recursive: true, force: true });
  }
}

test('a missing whisper-cli still exits 0 and writes the marker', async () => {
  const r = await cliWithMarker({ exec: { 'whisper-cli': () => ({ code: 127, stdout: '', stderr: 'nope' }) } });
  assert.deepEqual(r, { code: 0, marked: true });
});

test('a missing or unreadable Hyperframes Chrome check still exits 0 and writes the marker', async () => {
  const absent = await cliWithMarker({ exec: { hyperframes: () => ({ code: 0, stdout: JSON.stringify({ ok: true, checks: [] }), stderr: '' }) } });
  assert.deepEqual(absent, { code: 0, marked: true });
  const junk = await cliWithMarker({ exec: { hyperframes: () => ({ code: 0, stdout: 'garbage', stderr: '' }) } });
  assert.deepEqual(junk, { code: 0, marked: true });
});

test('data dir: CLAUDE_PLUGIN_DATA, else <cwd>/.yap, and --data-dir beats both', async () => {
  // Machine whose venv exists under the directory the doctor should pick.
  const run = async (args, env, cwd, dir) => {
    const m = machine({ files: { [`${dir}/venv/bin/python`]: 1 }, exec: { [`${dir}/venv/bin/python`]: () => OK } });
    let marked;
    const code = await runDoctorCli(args, { ...m.deps, env, cwd, marker: (d) => { marked = d; }, stdout: () => {}, stderr: () => {} });
    return { code, marked };
  };
  assert.deepEqual(await run([], { CLAUDE_PLUGIN_DATA: '/plugin' }, '/work', '/plugin'), { code: 0, marked: '/plugin' });
  assert.deepEqual(await run([], {}, '/work', '/work/.yap'), { code: 0, marked: '/work/.yap' });
  assert.deepEqual(await run(['--data-dir', '/flag'], { CLAUDE_PLUGIN_DATA: '/plugin' }, '/work', '/flag'), { code: 0, marked: '/flag' });
});

test('data dir: without the flag or CLAUDE_PLUGIN_DATA, the doctor reads data_dir from .yap/session.json', async () => {
  // the session file is only trusted for a folder under <home>/.claude/plugins/data/, home being the machine's
  const dir = `${HOME}/.claude/plugins/data/yap-inline`;
  const m = machine({ files: { [`${dir}/venv/bin/python`]: 1 }, exec: { [`${dir}/venv/bin/python`]: () => OK } });
  const sessions = { '/work/.yap/session.json': JSON.stringify({ session_id: 'a', data_dir: dir }) };
  const fs = { ...m.deps.fs, readFileSync: (p) => { if (p in sessions) return sessions[p]; throw new Error('ENOENT'); } };
  let marked;
  const code = await runDoctorCli([], { ...m.deps, fs, env: {}, cwd: '/work/src', marker: (d) => { marked = d; }, stdout: () => {}, stderr: () => {} });
  assert.deepEqual({ code, marked }, { code: 0, marked: dir });
});
