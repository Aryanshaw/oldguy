'use strict';
// Checks the folder layout: command-line adapters live in cli/, not lib/.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// Lists the .cjs files in one folder of the repo.
function cjsFiles(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith('.cjs'));
}

test('no file in lib/ ends in -cli.cjs', () => {
  assert.deepStrictEqual(cjsFiles('lib').filter((f) => f.endsWith('-cli.cjs')), []);
});

test('lib/cli-args.cjs no longer exists', () => {
  assert.strictEqual(fs.existsSync(path.join(root, 'lib', 'cli-args.cjs')), false);
});

test('cli/ holds the shared helper args.cjs', () => {
  assert.ok(cjsFiles('cli').includes('args.cjs'));
});

test('every cli/ file except args.cjs exports a function named run...', () => {
  const files = cjsFiles('cli').filter((f) => f !== 'args.cjs');
  assert.ok(files.length >= 10, 'expected the ten command adapters');
  for (const f of files) {
    const mod = require(path.join(root, 'cli', f));
    const runners = Object.keys(mod).filter((k) => k.startsWith('run') && typeof mod[k] === 'function');
    assert.ok(runners.length >= 1, `${f} exports no run* function`);
  }
});
