'use strict';
// Tests for the one shared rule that finds the plugin data folder (where the venv and the doctor's pass marker live).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveDataDir } = require('../lib/data-dir.cjs');

// A pretend home folder; only data folders under <home>/.claude/plugins/data/ are trusted from a session file.
const HOME = '/home/u';
const IN = '/home/u/.claude/plugins/data/yap-inline';
const IN2 = '/home/u/.claude/plugins/data/yap-market';

// Makes a throwaway project folder that the test removes afterwards.
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-datadir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Writes <dir>/.yap/session.json with the given raw text.
function writeSession(dir, text) {
  fs.mkdirSync(path.join(dir, '.yap'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.yap', 'session.json'), text);
}

test('--data-dir beats everything else', (t) => {
  const cwd = tmp(t);
  writeSession(cwd, JSON.stringify({ data_dir: IN }));
  assert.equal(resolveDataDir({ flag: '/flag', env: { CLAUDE_PLUGIN_DATA: '/plugin' }, cwd, fs, homedir: HOME }), '/flag');
});

test('a non-empty CLAUDE_PLUGIN_DATA beats the session file', (t) => {
  const cwd = tmp(t);
  writeSession(cwd, JSON.stringify({ data_dir: IN }));
  assert.equal(resolveDataDir({ env: { CLAUDE_PLUGIN_DATA: '/plugin' }, cwd, fs, homedir: HOME }), '/plugin');
});

test('an empty CLAUDE_PLUGIN_DATA is skipped and the session file is used', (t) => {
  const cwd = tmp(t);
  writeSession(cwd, JSON.stringify({ session_id: 'a', data_dir: IN }));
  assert.equal(resolveDataDir({ env: { CLAUDE_PLUGIN_DATA: '' }, cwd, fs, homedir: HOME }), IN);
});

test('with no flag, no env and no session file the default is <cwd>/.yap', (t) => {
  const cwd = tmp(t);
  assert.equal(resolveDataDir({ env: {}, cwd, fs, homedir: HOME }), path.join(cwd, '.yap'));
});

test('the session file is found by walking up from a subfolder', (t) => {
  const project = tmp(t);
  const deep = path.join(project, 'src', 'lib');
  fs.mkdirSync(deep, { recursive: true });
  writeSession(project, JSON.stringify({ data_dir: IN }));
  assert.equal(resolveDataDir({ env: {}, cwd: deep, fs, homedir: HOME }), IN);
});

test('garbage, a relative data_dir, a null or a non-string data_dir are ignored', (t) => {
  for (const text of ['{ not json', '[]', 'null', JSON.stringify({ data_dir: 'relative/dir' }),
    JSON.stringify({ data_dir: null }), JSON.stringify({ data_dir: 42 }), JSON.stringify({ data_dir: '' })]) {
    const cwd = tmp(t);
    writeSession(cwd, text);
    assert.equal(resolveDataDir({ env: {}, cwd, fs, homedir: HOME }), path.join(cwd, '.yap'), text);
  }
});

test('an unusable nearer session file is skipped for a usable one further up', (t) => {
  const project = tmp(t);
  const sub = path.join(project, 'sub');
  writeSession(sub, JSON.stringify({ data_dir: null }));
  writeSession(project, JSON.stringify({ data_dir: IN2 }));
  assert.equal(resolveDataDir({ env: {}, cwd: sub, fs, homedir: HOME }), IN2);
});

test('an unreadable session file (a folder in its place) is ignored', (t) => {
  const cwd = tmp(t);
  fs.mkdirSync(path.join(cwd, '.yap', 'session.json'), { recursive: true });
  assert.equal(resolveDataDir({ env: {}, cwd, fs, homedir: HOME }), path.join(cwd, '.yap'));
});

test('the walk stops at the filesystem root, read through the given fs', () => {
  const asked = [];
  const fakeFs = { readFileSync: (p) => { asked.push(p); throw new Error('ENOENT'); } };
  assert.equal(resolveDataDir({ env: {}, cwd: '/a/b', fs: fakeFs, homedir: HOME }), '/a/b/.yap');
  assert.deepEqual(asked, ['/a/b/.yap/session.json', '/a/.yap/session.json', '/.yap/session.json']);
});

test('a missing or relative cwd with nothing else set gives null', () => {
  assert.equal(resolveDataDir({ env: {}, cwd: 'relative/dir', fs, homedir: HOME }), null);
  assert.equal(resolveDataDir({ env: {}, cwd: undefined, fs, homedir: HOME }), null);
  assert.equal(resolveDataDir({ env: { CLAUDE_PLUGIN_DATA: '/plugin' }, cwd: 'relative/dir', fs, homedir: HOME }), '/plugin');
});

// Resolves from a project whose .yap/session.json names the given data_dir, with no flag and the given env.
function fromSession(t, dataDir, env = {}) {
  const cwd = tmp(t);
  writeSession(cwd, JSON.stringify({ session_id: 'a', data_dir: dataDir }));
  return { got: resolveDataDir({ env, cwd, fs, homedir: HOME }), fallback: path.join(cwd, '.yap') };
}

test('a session data_dir under <home>/.claude/plugins/data/ is trusted', (t) => {
  const { got } = fromSession(t, IN);
  assert.equal(got, IN);
});

test('a session data_dir outside the plugin data root, or the root itself, is ignored', (t) => {
  for (const dir of ['/tmp/anything-at-all', '/home/u/.claude/plugins/data', '/home/u/.claude/plugins/data/',
    '/home/u/.claude/plugins', '/home/u/.claude/plugins/data-evil', '/home/u/.claude/plugins/data-evil/..',
    '/home/u/.claude/plugins/data/../evil', '/home/u/.claude/plugins/data/yap/../../../x', '/home/u/.claude/plugins/data/./yap',
    '/home/u/.claude/plugins/data//yap', 'home/u/.claude/plugins/data/yap']) {
    const { got, fallback } = fromSession(t, dir);
    assert.equal(got, fallback, dir);
  }
});

test('CLAUDE_CONFIG_DIR moves the trusted root; a relative one is ignored', (t) => {
  assert.equal(fromSession(t, '/cfg/plugins/data/yap', { CLAUDE_CONFIG_DIR: '/cfg' }).got, '/cfg/plugins/data/yap');
  const outside = fromSession(t, IN, { CLAUDE_CONFIG_DIR: '/cfg' });
  assert.equal(outside.got, outside.fallback);
  assert.equal(fromSession(t, IN, { CLAUDE_CONFIG_DIR: 'relative/cfg' }).got, IN);
});

test('--data-dir and CLAUDE_PLUGIN_DATA still win, wherever they point', (t) => {
  const cwd = tmp(t);
  writeSession(cwd, JSON.stringify({ data_dir: IN }));
  assert.equal(resolveDataDir({ flag: '/anywhere', env: {}, cwd, fs, homedir: HOME }), '/anywhere');
  assert.equal(resolveDataDir({ env: { CLAUDE_PLUGIN_DATA: '/tmp/acceptance' }, cwd, fs, homedir: HOME }), '/tmp/acceptance');
});

test('an untrusted nearer session file is skipped for a trusted one further up', (t) => {
  const project = tmp(t);
  const sub = path.join(project, 'sub');
  writeSession(sub, JSON.stringify({ data_dir: '/tmp/evil' }));
  writeSession(project, JSON.stringify({ data_dir: IN }));
  assert.equal(resolveDataDir({ env: {}, cwd: sub, fs, homedir: HOME }), IN);
});
