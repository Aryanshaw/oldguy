const test = require('node:test');
const assert = require('node:assert/strict');
const { renderCap, runRenders } = require('../lib/render-schedule.mts');

// Waits a few milliseconds so fake renders overlap the way real ones would.
const pause = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// Builds a fake render that records how many run at once, the order of starts, and per-chapter call counts.
function fakeRender({ failTimes = {}, throwSync = {} } = {}) {
  const state = { running: 0, peak: 0, starts: [], calls: {}, peakAtRetry: [] };
  const render = (chapter) => {
    const id = chapter.id;
    state.calls[id] = (state.calls[id] || 0) + 1;
    if (throwSync[id] && state.calls[id] <= throwSync[id]) throw new Error(`sync boom ${id}`);
    state.starts.push(id);
    state.running += 1;
    state.peak = Math.max(state.peak, state.running);
    if (state.calls[id] > 1) state.peakAtRetry.push(state.running);
    return pause().then(() => {
      state.running -= 1;
      if (state.calls[id] <= (failTimes[id] || 0)) throw new Error(`boom ${id}`);
    });
  };
  return { render, state };
}

const chapters = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}` }));

test('renderCap follows max(1, min(3, floor(free - 2)))', () => {
  for (const [gb, want] of [[0, 1], [1, 1], [2, 1], [3, 1], [4, 2], [5, 3], [6, 3], [64, 3]]) {
    assert.equal(renderCap(gb), want, `${gb} GB`);
  }
});

test('renderCap gives 1 for non-finite or negative input', () => {
  for (const bad of [NaN, Infinity, -Infinity, -4, undefined]) assert.equal(renderCap(bad), 1);
});

test('empty list resolves to []', async () => {
  assert.deepEqual(await runRenders([], { cap: 3, render: () => Promise.resolve() }), []);
});

test('never more than cap renders overlap, and results keep input order', async () => {
  const { render, state } = fakeRender();
  const res = await runRenders(chapters(7), { cap: 3, render });
  assert.equal(state.peak, 3);
  assert.deepEqual(res.map((r) => r.id), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  assert.ok(res.every((r) => r.status === 'ready' && r.attempts === 1));
});

test('cap 1 runs strictly in sequence', async () => {
  const { render, state } = fakeRender();
  await runRenders(chapters(4), { cap: 1, render });
  assert.equal(state.peak, 1);
  assert.deepEqual(state.starts, ['c1', 'c2', 'c3', 'c4']);
});

test('cap is clamped to the number of chapters', async () => {
  const { render, state } = fakeRender();
  await runRenders(chapters(2), { cap: 10, render });
  assert.equal(state.peak, 2);
});

test('cap of 0 or negative is treated as 1', async () => {
  for (const cap of [0, -3]) {
    const { render, state } = fakeRender();
    await runRenders(chapters(3), { cap, render });
    assert.equal(state.peak, 1);
  }
});

test('a transient failure is retried alone and ends ready with 2 attempts', async () => {
  const { render, state } = fakeRender({ failTimes: { c2: 1 } });
  const res = await runRenders(chapters(4), { cap: 3, render });
  assert.deepEqual(res.map((r) => [r.id, r.status, r.attempts]),
    [['c1', 'ready', 1], ['c2', 'ready', 2], ['c3', 'ready', 1], ['c4', 'ready', 1]]);
  assert.deepEqual(state.peakAtRetry, [1]);
  assert.equal(state.calls.c2, 2);
});

test('a permanent failure ends failed with its message; the rest are ready', async () => {
  const { render, state } = fakeRender({ failTimes: { c2: 99 } });
  const res = await runRenders(chapters(3), { cap: 2, render });
  assert.equal(res[1].status, 'failed');
  assert.equal(res[1].attempts, 2);
  assert.equal(res[1].error, 'boom c2');
  assert.equal(state.calls.c2, 2);
  assert.deepEqual([res[0].status, res[2].status], ['ready', 'ready']);
  assert.equal(res[0].error, undefined);
});

test('render throwing synchronously counts as a failure', async () => {
  const { render } = fakeRender({ throwSync: { c1: 1, c2: 5 } });
  const res = await runRenders(chapters(2), { cap: 2, render });
  assert.deepEqual(res.map((r) => [r.status, r.attempts]), [['ready', 2], ['failed', 2]]);
  assert.equal(res[1].error, 'sync boom c2');
});

test('two chapters failing together are retried one after the other', async () => {
  const { render, state } = fakeRender({ failTimes: { c1: 1, c2: 1 } });
  const res = await runRenders(chapters(2), { cap: 2, render });
  assert.ok(res.every((r) => r.status === 'ready' && r.attempts === 2));
  assert.deepEqual(state.peakAtRetry, [1, 1]);
});
