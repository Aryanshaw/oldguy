'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireSlot } = require('../lib/slots.mts');

// A fresh slot folder for one test.
function slotDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-slots-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const alive = () => true;

test('slots: up to cap holders at once; the next one waits, says so once, and gets the slot when one is freed', async (t) => {
  const dir = slotDir(t);
  const waits = [];
  const a = await acquireSlot({ dir, cap: 2, pid: 101, isAlive: alive, pollMs: 10 });
  const b = await acquireSlot({ dir, cap: 2, pid: 102, isAlive: alive, pollMs: 10 });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['0.lock', '1.lock']);
  let got = false;
  const c = acquireSlot({ dir, cap: 2, pid: 103, isAlive: alive, pollMs: 10, onWait: (n) => waits.push(n) }).then((r) => { got = true; return r; });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(got, false);
  assert.deepEqual(waits, [2], 'told once, with the number in use');
  a();
  const release = await c;
  assert.equal(got, true);
  assert.equal(fs.readFileSync(path.join(dir, '0.lock'), 'utf8'), '103');
  b(); release();
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('slots: a lock held by a process that is gone is taken over at once', async (t) => {
  const dir = slotDir(t);
  fs.writeFileSync(path.join(dir, '0.lock'), '999999');
  const release = await acquireSlot({ dir, cap: 1, pid: 7, isAlive: (pid) => pid !== 999999, pollMs: 10 });
  assert.equal(fs.readFileSync(path.join(dir, '0.lock'), 'utf8'), '7');
  release();
});

test('slots: a garbled lock counts as free; release twice is harmless and never removes another holder', async (t) => {
  const dir = slotDir(t);
  fs.writeFileSync(path.join(dir, '0.lock'), 'not a pid');
  const release = await acquireSlot({ dir, cap: 1, pid: 8, isAlive: alive, pollMs: 10 });
  release();
  const other = await acquireSlot({ dir, cap: 1, pid: 9, isAlive: alive, pollMs: 10 });
  release();
  assert.equal(fs.readFileSync(path.join(dir, '0.lock'), 'utf8'), '9', 'the old holder cannot free the new one');
  other();
});

test('slots: withSlot frees the slot when the work throws', async (t) => {
  const { withSlot } = require('../lib/slots.mts');
  const dir = slotDir(t);
  await assert.rejects(withSlot({ dir, cap: 1, pid: 5, isAlive: alive, pollMs: 10 }, async () => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(await withSlot({ dir, cap: 1, pid: 5, isAlive: alive, pollMs: 10 }, async () => 42), 42);
});
