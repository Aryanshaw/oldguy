'use strict';
// Tests for the SessionStart hook: it must record the session id, hint at `yap doctor`, and never break a session.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'hooks', 'session-start.cjs');
const SAMPLE = path.join(__dirname, 'fixtures', 'hook-stdin-sample.txt');

// Makes a throwaway folder that the test removes afterwards.
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-hook-'));
  t.after(() => {
    fs.chmodSync(dir, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// Pulls the first real hook JSON line out of the Phase 0 log, so tests use the true shape Claude Code sends.
function sampleStdin() {
  const line = fs.readFileSync(SAMPLE, 'utf8').split('\n').find((l) => l.startsWith('{"session_id"'));
  return JSON.parse(line);
}

// Runs the hook with the given stdin text and environment; the plugin data folder and the Claude config folder are
// only set when asked for.
function runHook(stdin, { dataDir, configDir } = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_DATA;
  delete env.CLAUDE_CONFIG_DIR;
  if (dataDir) env.CLAUDE_PLUGIN_DATA = dataDir;
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  return spawnSync(process.execPath, [SCRIPT], { input: stdin, env, encoding: 'utf8', timeout: 10000 });
}

// Reads the session file the hook wrote in a project folder.
function readSession(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.yap', 'session.json'), 'utf8'));
}

test('writes session.json with the id, transcript path, cwd and source', (t) => {
  const cwd = tmp(t);
  const input = { ...sampleStdin(), cwd };
  const r = runHook(JSON.stringify(input), { dataDir: tmp(t) });
  assert.equal(r.status, 0);
  const s = readSession(cwd);
  assert.equal(s.session_id, input.session_id);
  assert.equal(s.transcript_path, input.transcript_path);
  assert.equal(s.cwd, cwd);
  assert.equal(s.source, 'startup');
  assert.ok(!Number.isNaN(Date.parse(s.updated_at)));
  // the Claude Code process this session runs in, when one is found among the hook's ancestors
  assert.ok('claude_pid' in s);
  assert.ok(s.claude_pid === null || (Number.isInteger(s.claude_pid) && s.claude_pid > 1));
});

test('a second run with source resume overwrites the file and keeps the id', (t) => {
  const cwd = tmp(t);
  const input = { ...sampleStdin(), cwd };
  runHook(JSON.stringify(input), { dataDir: tmp(t) });
  runHook(JSON.stringify({ ...input, source: 'resume' }), { dataDir: tmp(t) });
  const s = readSession(cwd);
  assert.equal(s.source, 'resume');
  assert.equal(s.session_id, input.session_id);
  // No leftover temp files from the atomic write.
  assert.deepEqual(fs.readdirSync(path.join(cwd, '.yap')), ['session.json']);
});

test('prints one hint line when the doctor marker is missing', (t) => {
  const cwd = tmp(t);
  const r = runHook(JSON.stringify({ ...sampleStdin(), cwd }), { dataDir: tmp(t) });
  assert.equal(r.status, 0);
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\/yap doctor/);
});

test('prints nothing when the doctor marker exists', (t) => {
  const cwd = tmp(t);
  const dataDir = tmp(t);
  fs.writeFileSync(path.join(dataDir, 'doctor-ok'), 'ok');
  const r = runHook(JSON.stringify({ ...sampleStdin(), cwd }), { dataDir });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('without CLAUDE_PLUGIN_DATA the marker is looked for in <cwd>/.yap', (t) => {
  const cwd = tmp(t);
  fs.mkdirSync(path.join(cwd, '.yap'));
  fs.writeFileSync(path.join(cwd, '.yap', 'doctor-ok'), 'ok');
  const r = runHook(JSON.stringify({ ...sampleStdin(), cwd }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('malformed, empty or incomplete stdin exits 0 and writes nothing', (t) => {
  const cwd = tmp(t);
  const cases = ['{not json', '', '[]', 'null', JSON.stringify({ cwd }), JSON.stringify({ cwd, session_id: '' }),
    JSON.stringify({ cwd, session_id: 42 })];
  for (const stdin of cases) {
    const r = runHook(stdin, { dataDir: tmp(t) });
    assert.equal(r.status, 0, `stdin ${JSON.stringify(stdin)}`);
  }
  assert.equal(fs.existsSync(path.join(cwd, '.yap')), false);
});

test('a relative cwd is ignored: nothing written, nothing printed', (t) => {
  const here = tmp(t);
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ session_id: 'abc', cwd: 'relative/dir' }),
    cwd: here, env: { ...process.env, CLAUDE_PLUGIN_DATA: '' }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(path.join(here, '.yap')), false);
  assert.equal(fs.existsSync(path.join(here, 'relative')), false);
});

test('a read-only cwd exits 0', (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('root ignores read-only folders');
  const cwd = tmp(t);
  fs.chmodSync(cwd, 0o555);
  const r = runHook(JSON.stringify({ ...sampleStdin(), cwd }), { dataDir: tmp(t) });
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(path.join(cwd, '.yap')), false);
});

test('finishes well under a second even if stdin never closes', (t, done) => {
  const cwd = tmp(t);
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_DATA;
  const started = Date.now();
  const child = spawn(process.execPath, [SCRIPT], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  // Send nothing and never end stdin.
  child.on('exit', (code) => {
    assert.equal(code, 0);
    assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
    assert.equal(fs.existsSync(path.join(cwd, '.yap')), false);
    done();
  });
  t.after(() => child.kill('SIGKILL'));
});

test('hooks.json wires one SessionStart and one SessionEnd command hook, each with a 5 second timeout', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(cfg.hooks).sort(), ['SessionEnd', 'SessionStart']);
  for (const [event, script] of [['SessionStart', 'session-start.cjs'], ['SessionEnd', 'session-end.cjs']]) {
    const groups = cfg.hooks[event];
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, '');
    assert.equal(groups[0].hooks.length, 1);
    const hook = groups[0].hooks[0];
    assert.equal(hook.type, 'command');
    assert.equal(hook.command, `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${script}"`);
    assert.equal(hook.timeout, 5);
  }
});

const END_SCRIPT = path.join(ROOT, 'hooks', 'session-end.cjs');

test('SessionEnd stops the live yap server of every video in the project and exits 0', async (t) => {
  const cwd = tmp(t);
  const slugDir = path.join(cwd, '.yap', 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  const yap = path.join(ROOT, 'bin', 'yap.cjs');
  const r = spawnSync(process.execPath, [yap, 'serve', '--dir', slugDir, '--detach'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const file = path.join(slugDir, 'state', 'server.json');
  const pid = JSON.parse(fs.readFileSync(file, 'utf8')).pid;
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* stopped */ } });
  const end = spawnSync(process.execPath, [END_SCRIPT], { input: JSON.stringify({ session_id: 's', cwd, reason: 'exit' }), encoding: 'utf8', timeout: 10000 });
  assert.equal(end.status, 0, end.stderr);
  const deadline = Date.now() + 8000;
  while (fs.existsSync(file) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 100));
  assert.equal(fs.existsSync(file), false, 'the server shut down cleanly and removed server.json');
});

test('SessionEnd exits 0 and does nothing on garbage stdin, no .yap folder, or a stale server.json', (t) => {
  for (const input of ['', 'not json', '[]', JSON.stringify({ cwd: 'relative/path' })]) {
    assert.equal(spawnSync(process.execPath, [END_SCRIPT], { input, encoding: 'utf8', timeout: 10000 }).status, 0, input);
  }
  const cwd = tmp(t);
  assert.equal(spawnSync(process.execPath, [END_SCRIPT], { input: JSON.stringify({ cwd }), encoding: 'utf8', timeout: 10000 }).status, 0);
  const state = path.join(cwd, '.yap', 'demo', 'state');
  fs.mkdirSync(state, { recursive: true });
  // a stale file naming this test runner's own pid must never get it killed
  fs.writeFileSync(path.join(state, 'server.json'), JSON.stringify({ pid: process.pid, port: 1, key: 'a'.repeat(32) }));
  assert.equal(spawnSync(process.execPath, [END_SCRIPT], { input: JSON.stringify({ cwd }), encoding: 'utf8', timeout: 10000 }).status, 0);
});

// Counts the hint lines a run printed.
function hintLines(r) {
  return r.stdout.split('\n').filter((l) => /\/yap doctor/.test(l));
}

test('an empty session_id writes nothing but still hints when the marker is missing', (t) => {
  const cwd = tmp(t);
  const r = runHook(JSON.stringify({ cwd, session_id: '' }), { dataDir: tmp(t) });
  assert.equal(r.status, 0);
  assert.equal(hintLines(r).length, 1);
  assert.equal(fs.existsSync(path.join(cwd, '.yap')), false);
});

test('an empty session_id with the marker present prints nothing', (t) => {
  const dataDir = tmp(t);
  fs.writeFileSync(path.join(dataDir, 'doctor-ok'), 'ok');
  const r = runHook(JSON.stringify({ cwd: tmp(t), session_id: '' }), { dataDir });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('a relative cwd with CLAUDE_PLUGIN_DATA set and no marker hints but writes nothing', (t) => {
  const here = tmp(t);
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: tmp(t) };
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ session_id: 'abc', cwd: 'relative/dir' }), cwd: here, env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(r.status, 0);
  assert.equal(hintLines(r).length, 1);
  assert.equal(fs.existsSync(path.join(here, '.yap')), false);
  assert.equal(fs.existsSync(path.join(here, 'relative')), false);
});

test('an unwritable cwd (a file, not a folder) exits 0 and still hints', (t) => {
  const file = path.join(tmp(t), 'not-a-dir');
  fs.writeFileSync(file, 'x');
  const r = runHook(JSON.stringify({ ...sampleStdin(), cwd: file }), { dataDir: tmp(t) });
  assert.equal(r.status, 0);
  assert.equal(hintLines(r).length, 1);
});

test('a read-only cwd exits 0 and still hints', (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('root ignores read-only folders');
  const cwd = tmp(t);
  fs.chmodSync(cwd, 0o555);
  const r = runHook(JSON.stringify({ ...sampleStdin(), cwd }), { dataDir: tmp(t) });
  assert.equal(r.status, 0);
  assert.equal(hintLines(r).length, 1);
});

test('session.json records data_dir: the plugin data folder when set inside the plugin data root, else null', (t) => {
  const cwd = tmp(t);
  const configDir = tmp(t);
  const dataDir = path.join(configDir, 'plugins', 'data', 'yap-inline');
  runHook(JSON.stringify({ ...sampleStdin(), cwd }), { dataDir, configDir });
  assert.equal(readSession(cwd).data_dir, dataDir);
  runHook(JSON.stringify({ ...sampleStdin(), cwd }), { configDir });
  assert.equal(readSession(cwd).data_dir, null);
  // a plugin data folder outside <config>/plugins/data/ is still used for the hint, but never recorded
  runHook(JSON.stringify({ ...sampleStdin(), cwd }), { dataDir: tmp(t), configDir });
  assert.equal(readSession(cwd).data_dir, null);
});

test('the hint finds the marker through a parent session.json, the same way the doctor does', (t) => {
  const project = tmp(t);
  const configDir = tmp(t);
  const dataDir = path.join(configDir, 'plugins', 'data', 'yap-inline');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'doctor-ok'), 'ok');
  fs.mkdirSync(path.join(project, '.yap'));
  fs.writeFileSync(path.join(project, '.yap', 'session.json'), JSON.stringify({ session_id: 'x', data_dir: dataDir }));
  const sub = path.join(project, 'sub');
  fs.mkdirSync(sub);
  // no CLAUDE_PLUGIN_DATA: the hook's own session.json in sub has data_dir null, so the parent's one decides
  const r = runHook(JSON.stringify({ ...sampleStdin(), cwd: sub }), { configDir });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const { resolveDataDir } = require('../lib/data-dir.mts');
  assert.equal(resolveDataDir({ env: { CLAUDE_CONFIG_DIR: configDir }, cwd: sub, fs }), dataDir);
});

test('the hint ignores a parent session.json whose data_dir is outside the plugin data root', (t) => {
  const project = tmp(t);
  const elsewhere = tmp(t);
  fs.writeFileSync(path.join(elsewhere, 'doctor-ok'), 'ok');
  fs.mkdirSync(path.join(project, '.yap'));
  fs.writeFileSync(path.join(project, '.yap', 'session.json'), JSON.stringify({ session_id: 'x', data_dir: elsewhere }));
  const sub = path.join(project, 'sub');
  fs.mkdirSync(sub);
  const r = runHook(JSON.stringify({ ...sampleStdin(), cwd: sub }), { configDir: tmp(t) });
  assert.equal(hintLines(r).length, 1);
});
