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
