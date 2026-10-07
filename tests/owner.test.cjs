'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findClaudePid, watchOwner } = require('../lib/owner.mts');

// A fake process table: pid -> {ppid, comm, args}.
const table = (rows) => (pid) => rows[pid] || null;

test('findClaudePid: the nearest ancestor whose command is claude, or node running a script named claude', () => {
  const linux = table({ 50: { ppid: 40, comm: 'sh', args: 'sh -c node hook.cjs' }, 40: { ppid: 30, comm: 'claude', args: '/opt/claude-code/bin/claude --x' }, 30: { ppid: 1, comm: 'bash', args: 'bash' } });
  assert.equal(findClaudePid(50, linux), 40);
  const mac = table({ 9: { ppid: 8, comm: 'zsh', args: 'zsh' }, 8: { ppid: 7, comm: 'node', args: 'node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js' }, 7: { ppid: 1, comm: 'Terminal', args: 'Terminal' } });
  assert.equal(findClaudePid(9, mac), null, 'cli.js is not named claude');
  const macBin = table({ 9: { ppid: 8, comm: '/bin/zsh', args: 'zsh' }, 8: { ppid: 1, comm: 'node', args: 'node /opt/homebrew/bin/claude' } });
  assert.equal(findClaudePid(9, macBin), 8);
  const fullPath = table({ 9: { ppid: 8, comm: '/Users/me/.local/bin/claude', args: 'claude' } });
  assert.equal(findClaudePid(9, fullPath), 9, 'the start pid itself counts');
});

test('findClaudePid: none found, a broken table, or a loop give null', () => {
  assert.equal(findClaudePid(5, table({ 5: { ppid: 1, comm: 'bash', args: 'bash' } })), null);
  assert.equal(findClaudePid(5, () => null), null);
  assert.equal(findClaudePid(5, table({ 5: { ppid: 6, comm: 'a', args: 'a' }, 6: { ppid: 5, comm: 'b', args: 'b' } })), null);
  assert.equal(findClaudePid(5, () => { throw new Error('no ps'); }), null);
});

test('watchOwner: calls onGone once when the owner process is gone, and stop() ends the watch', async () => {
  let alive = true;
  let gone = 0;
  const w = watchOwner({ pid: 123, intervalMs: 10, isAlive: () => alive, onGone: () => { gone++; } });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(gone, 0);
  alive = false;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(gone, 1);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(gone, 1, 'only once');
  w.stop();
  const w2 = watchOwner({ pid: 1, intervalMs: 10, isAlive: () => false, onGone: () => { gone++; } });
  w2.stop();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(gone, 1, 'a stopped watch never fires');
});
