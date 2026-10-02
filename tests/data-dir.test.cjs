'use strict';
// Tests for the one shared rule that finds the plugin data folder (where the venv and the doctor's pass marker live).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveDataDir } = require('../lib/data-dir.cjs');

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
  writeSession(cwd, JSON.stringify({ data_dir: '/from-session' }));
  assert.equal(resolveDataDir({ flag: '/flag', env: { CLAUDE_PLUGIN_DATA: '/plugin' }, cwd, fs }), '/flag');
});

test('a non-empty CLAUDE_PLUGIN_DATA beats the session file', (t) => {
  const cwd = tmp(t);
  writeSession(cwd, JSON.stringify({ data_dir: '/from-session' }));
  assert.equal(resolveDataDir({ env: { CLAUDE_PLUGIN_DATA: '/plugin' }, cwd, fs }), '/plugin');
});

test('an empty CLAUDE_PLUGIN_DATA is skipped and the session file is used', (t) => {
  const cwd = tmp(t);
  writeSession(cwd, JSON.stringify({ session_id: 'a', data_dir: '/from-session' }));
  assert.equal(resolveDataDir({ env: { CLAUDE_PLUGIN_DATA: '' }, cwd, fs }), '/from-session');
});

test('with no flag, no env and no session file the default is <cwd>/.yap', (t) => {
  const cwd = tmp(t);
  assert.equal(resolveDataDir({ env: {}, cwd, fs }), path.join(cwd, '.yap'));
});

test('the session file is found by walking up from a subfolder', (t) => {
  const project = tmp(t);
  const deep = path.join(project, 'src', 'lib');
  fs.mkdirSync(deep, { recursive: true });
  writeSession(project, JSON.stringify({ data_dir: '/from-session' }));
  assert.equal(resolveDataDir({ env: {}, cwd: deep, fs }), '/from-session');
});

test('garbage, a relative data_dir, a null or a non-string data_dir are ignored', (t) => {
  for (const text of ['{ not json', '[]', 'null', JSON.stringify({ data_dir: 'relative/dir' }),
    JSON.stringify({ data_dir: null }), JSON.stringify({ data_dir: 42 }), JSON.stringify({ data_dir: '' })]) {
    const cwd = tmp(t);
    writeSession(cwd, text);
    assert.equal(resolveDataDir({ env: {}, cwd, fs }), path.join(cwd, '.yap'), text);
  }
});

test('an unusable nearer session file is skipped for a usable one further up', (t) => {
  const project = tmp(t);
  const sub = path.join(project, 'sub');
  writeSession(sub, JSON.stringify({ data_dir: null }));
  writeSession(project, JSON.stringify({ data_dir: '/from-parent' }));
  assert.equal(resolveDataDir({ env: {}, cwd: sub, fs }), '/from-parent');
});

test('an unreadable session file (a folder in its place) is ignored', (t) => {
  const cwd = tmp(t);
  fs.mkdirSync(path.join(cwd, '.yap', 'session.json'), { recursive: true });
  assert.equal(resolveDataDir({ env: {}, cwd, fs }), path.join(cwd, '.yap'));
});

test('the walk stops at the filesystem root, read through the given fs', () => {
  const asked = [];
  const fakeFs = { readFileSync: (p) => { asked.push(p); throw new Error('ENOENT'); } };
  assert.equal(resolveDataDir({ env: {}, cwd: '/a/b', fs: fakeFs }), '/a/b/.yap');
  assert.deepEqual(asked, ['/a/b/.yap/session.json', '/a/.yap/session.json', '/.yap/session.json']);
});

test('a missing or relative cwd with nothing else set gives null', () => {
  assert.equal(resolveDataDir({ env: {}, cwd: 'relative/dir', fs }), null);
  assert.equal(resolveDataDir({ env: {}, cwd: undefined, fs }), null);
  assert.equal(resolveDataDir({ env: { CLAUDE_PLUGIN_DATA: '/plugin' }, cwd: 'relative/dir', fs }), '/plugin');
});
