'use strict';
// Checks the folder layout: command-line adapters live in cli/, not lib/.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// Lists the files in one folder of the repo that end with the given extension.
function filesEnding(dir, ext) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith(ext));
}

test('no file in lib/ ends in -cli.cjs or -cli.mts', () => {
  assert.deepStrictEqual(filesEnding('lib', '-cli.mts').concat(filesEnding('lib', '-cli.cjs')), []);
});

test('lib/cli-args no longer exists', () => {
  assert.strictEqual(fs.existsSync(path.join(root, 'lib', 'cli-args.cjs')) || fs.existsSync(path.join(root, 'lib', 'cli-args.mts')), false);
});

test('cli/ holds the shared helper args.mts', () => {
  assert.ok(filesEnding('cli', '.mts').includes('args.mts'));
});

test('every cli/ file except args.mts exports a function named run...', () => {
  const files = filesEnding('cli', '.mts').filter((f) => f !== 'args.mts');
  assert.ok(files.length >= 10, 'expected the ten command adapters');
  for (const f of files) {
    const mod = require(path.join(root, 'cli', f));
    const runners = Object.keys(mod).filter((k) => k.startsWith('run') && typeof mod[k] === 'function');
    assert.ok(runners.length >= 1, `${f} exports no run* function`);
  }
});
