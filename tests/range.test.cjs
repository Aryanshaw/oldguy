'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRange } = require('../lib/range.cjs');

// Shorthand: parse a header against a 100-byte file.
const p = (h, size = 100) => parseRange(h, size);

test('no header means none', () => {
  assert.deepEqual(p(undefined), { kind: 'none' });
  assert.deepEqual(p(''), { kind: 'none' });
});

test('single valid ranges give start and end', () => {
  assert.deepEqual(p('bytes=0-'), { kind: 'single', start: 0, end: 99 });
  assert.deepEqual(p('bytes=10-'), { kind: 'single', start: 10, end: 99 });
  assert.deepEqual(p('bytes=-5'), { kind: 'single', start: 95, end: 99 });
  assert.deepEqual(p('bytes=2-3'), { kind: 'single', start: 2, end: 3 });
});

test('an end past the file is clamped; a long suffix is the whole file', () => {
  assert.deepEqual(p('bytes=90-500'), { kind: 'single', start: 90, end: 99 });
  assert.deepEqual(p('bytes=-500'), { kind: 'single', start: 0, end: 99 });
});

test('start at or past the end, and bytes=-0, are unsatisfiable', () => {
  assert.equal(p('bytes=100-').kind, 'unsatisfiable');
  assert.equal(p('bytes=999999-').kind, 'unsatisfiable');
  assert.equal(p('bytes=-0').kind, 'unsatisfiable');
});

test('bad syntax, reversed, other units and multi-range are invalid (whole file)', () => {
  for (const h of ['bytes=abc', 'bytes=5-2', 'items=0-5', 'bytes=', 'bytes=-', 'bytes=0-1,5-6', 'bytes=1.5-3', 'bytes=--3']) {
    assert.equal(p(h).kind, 'invalid', h);
  }
});

test('a zero-byte file with any range is unsatisfiable', () => {
  assert.equal(p('bytes=0-', 0).kind, 'unsatisfiable');
  assert.equal(p('bytes=-5', 0).kind, 'unsatisfiable');
  assert.equal(p(undefined, 0).kind, 'none');
});
