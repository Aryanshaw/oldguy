const test = require('node:test');
const assert = require('node:assert/strict');
const fsReal = require('node:fs');
const osReal = require('node:os');
const path = require('node:path');
const { runDoctor, writeMarker } = require('../lib/doctor.cjs');
const { runDoctorCli, realExec } = require('../lib/doctor-cli.cjs');

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
        const h = handlers[cmd];
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
      nodeVersion: over.nodeVersion ?? 'v22.3.0',
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

test('missing venv gives the exact create and install commands', async () => {
  const m = machine();
  delete m.deps.fs.existsSync; // rebuild without the venv python
  const files = { [MODEL]: 325e6 };
  m.deps.fs.existsSync = (p) => p in files;
  m.deps.fs.statSync = (p) => ({ size: files[p] });
  const c = byName(await runDoctor(m.deps), 'Python venv');
  assert.equal(c.ok, false);
  assert.equal(c.fix, `python3 -m venv ${DATA}/venv && ${DATA}/venv/bin/pip install kokoro-onnx soundfile`);
});

test('venv that cannot import kokoro_onnx fails with the install command', async () => {
  const m = machine({ exec: { [VENV_PY]: () => ({ code: 1, stdout: '', stderr: 'ModuleNotFoundError' }) } });
  const c = byName(await runDoctor(m.deps), 'Python venv');
  assert.equal(c.ok, false);
  assert.match(c.fix, /pip install kokoro-onnx soundfile/);
  const call = m.calls.find(([cmd]) => cmd === VENV_PY);
  assert.deepEqual(call[1], ['-c', 'import kokoro_onnx, soundfile']);
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
    const code = await runDoctorCli(['--data-dir', dir], { ...m.deps, stdout: () => {}, stderr: () => {} , marker: require('../lib/doctor.cjs').writeMarker });
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
