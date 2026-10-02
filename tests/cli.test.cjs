const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'yap.cjs');
const NAMES = ['doctor', 'audit', 'beats', 'captions', 'pad-wav', 'scaffold', 'render', 'narrate'];

// Runs the CLI with the given arguments and returns the finished process result.
function yap(...args) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
}

test('--help exits 0 and lists all eight commands', () => {
  const r = yap('--help');
  assert.equal(r.status, 0);
  for (const name of NAMES) assert.match(r.stdout, new RegExp(`^\\s*${name}\\s`, 'm'));
});

test('no arguments prints the same help and exits 0', () => {
  const r = yap();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /doctor/);
});

test('unknown command exits 2 with a one-line usage message on stderr', () => {
  const r = yap('bogus');
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /usage/i);
});

test('each unimplemented command says so on stderr and exits 3', () => {
  for (const name of NAMES.filter((n) => n !== 'audit' && n !== 'pad-wav')) {
    const r = yap(name);
    assert.equal(r.status, 3, name);
    assert.match(r.stderr, /not implemented yet/, name);
  }
});
