'use strict';
// Code-rule checks that keep the TypeScript conversion honest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// The lib files that import no other Yap module and are therefore converted first.
const LEAF_LIB = [
  'sentences', 'wav', 'beats', 'captions', 'build-record', 'render-schedule', 'audit',
  'hyperframes', 'data-dir', 'ask-server', 'http-guard', 'poster', 'sse',
];

test('no file under scene-kit/ or in the lib/ leaf list ends in .cjs', () => {
  const sceneKit = fs.readdirSync(path.join(ROOT, 'scene-kit')).filter((f) => f.endsWith('.cjs'));
  const lib = LEAF_LIB.filter((n) => fs.existsSync(path.join(ROOT, 'lib', `${n}.cjs`)));
  assert.deepEqual(sceneKit, []);
  assert.deepEqual(lib, []);
});

test('the domain modules and the whole server folder are TypeScript, not .cjs', () => {
  const domain = ['chapter', 'chapter-scan', 'manifest', 'events', 'range', 'watcher', 'live-server', 'export', 'doctor', 'narrate', 'render-chapters'];
  const leftover = domain.filter((n) => fs.existsSync(path.join(ROOT, 'lib', `${n}.cjs`)));
  const server = fs.readdirSync(path.join(ROOT, 'server')).filter((f) => f.endsWith('.cjs'));
  assert.deepEqual(leftover, []);
  assert.deepEqual(server, []);
});

test('only the three plain-JavaScript start files and the Node-floor file are .cjs under the source folders', () => {
  const allowed = new Set(['bin/yap.cjs', 'hooks/session-start.cjs', 'lib/node-floor.cjs']);
  const found = [];
  for (const dir of ['bin', 'cli', 'hooks', 'lib', 'server', 'scene-kit']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.cjs')) found.push(`${dir}/${f}`);
  }
  assert.deepEqual(found.filter((f) => !allowed.has(f)), []);
  assert.deepEqual([...allowed].filter((f) => !found.includes(f)), []);
});
