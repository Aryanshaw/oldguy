'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const E = require('../lib/events.cjs');

// Makes a temp folder, runs the test body with it, and removes it after.
function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-events-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const ctx = { chapter_id: 'ch-worker-claim', t: 12.3 };
const fixedNow = () => new Date('2026-10-02T10:01:00Z');

test('ids increase, carry ts, and survive reopening; state dir is created', () => withTmp((dir) => {
  const f = path.join(dir, 'state', 'events.jsonl');
  const a = E.appendEvent(f, { type: 'message', text: 'hi', context: ctx }, { now: fixedNow });
  const b = E.appendEvent(f, { type: 'export' });
  assert.equal(a.id, 'evt_1');
  assert.equal(a.ts, '2026-10-02T10:01:00.000Z');
  assert.equal(b.id, 'evt_2');
  assert.deepEqual(a.context, ctx);
  assert.equal(E.appendEvent(f, { type: 'just_text' }).id, 'evt_3');
}));

test('readEventsAfter returns only later events; missing file is empty', () => withTmp((dir) => {
  const f = path.join(dir, 'events.jsonl');
  assert.deepEqual(E.readEventsAfter(f, null), []);
  for (let i = 0; i < 5; i++) E.appendEvent(f, { type: 'export' });
  assert.deepEqual(E.readEventsAfter(f, 'evt_3').map((e) => e.id), ['evt_4', 'evt_5']);
  assert.equal(E.readEventsAfter(f, null).length, 5);
  assert.equal(E.readEventsAfter(f, 'evt_9').length, 0);
}));

test('partial last line is skipped and the next append starts a fresh line', () => withTmp((dir) => {
  const f = path.join(dir, 'events.jsonl');
  E.appendEvent(f, { type: 'export' });
  fs.appendFileSync(f, '{"id":"evt_2","ts":"x","type":"mess');
  assert.equal(E.readEventsAfter(f, null).length, 1);
  const e = E.appendEvent(f, { type: 'export' });
  assert.equal(e.id, 'evt_2');
  assert.deepEqual(E.readEventsAfter(f, null).map((x) => x.id), ['evt_1', 'evt_2']);
}));

test('garbage lines are skipped, not fatal', () => withTmp((dir) => {
  const f = path.join(dir, 'events.jsonl');
  E.appendEvent(f, { type: 'export' });
  fs.appendFileSync(f, 'not json at all\n[1,2]\n{"id":5}\n\n');
  E.appendEvent(f, { type: 'export' });
  assert.deepEqual(E.readEventsAfter(f, null).map((x) => x.id), ['evt_1', 'evt_2']);
}));

test('validation: unknown type, text limits, NUL, context shape', () => withTmp((dir) => {
  const f = path.join(dir, 'events.jsonl');
  const bad = (ev, re) => assert.throws(() => E.appendEvent(f, ev), re);
  bad({ type: 'nope' }, /type/);
  bad({ type: 'message' }, /text/);
  bad({ type: 'message', text: 'a'.repeat(4001) }, /4000/);
  bad({ type: 'message', text: 'a\0b' }, /NUL/);
  bad({ type: 'export', context: { chapter_id: 'Bad Id', t: 1 } }, /chapter_id/);
  bad({ type: 'export', context: { chapter_id: 'ch-a', t: -1 } }, /context/);
  bad({ type: 'export', context: { chapter_id: 'ch-a', t: Infinity } }, /context/);
  bad({ type: 'export', context: { chapter_id: 'ch-a', t: 1, extra: 1 } }, /context/);
  bad({ type: 'export', context: 'x' }, /context/);
  E.appendEvent(f, { type: 'message', text: 'a'.repeat(4000) });
  E.appendEvent(f, { type: 'export', context: { chapter_id: 'ch-a', t: 0 } });
  assert.equal(E.readEventsAfter(f, null).length, 2);
  assert.throws(() => { try { E.appendEvent(f, { type: 'nope' }); } catch (e) { assert.ok(!e.message.includes('\n')); throw e; } });
}));

test('whole line over maxBytes is rejected and nothing is written', () => withTmp((dir) => {
  const f = path.join(dir, 'events.jsonl');
  assert.throws(() => E.appendEvent(f, { type: 'message', text: 'é'.repeat(1000) }, { maxBytes: 1500 }), /too large/);
  assert.equal(fs.existsSync(f), false);
  assert.throws(() => E.appendEvent(f, { type: 'message', text: '€'.repeat(3000) }), /too large/);
}));

test('200 appends from Promise.all give 200 distinct ids and no torn lines', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-events-'));
  try {
  const f = path.join(dir, 'events.jsonl');
  const out = await Promise.all(Array.from({ length: 200 }, (_, i) =>
    Promise.resolve().then(() => E.appendEvent(f, { type: 'message', text: `m${i}` }))));
  assert.equal(new Set(out.map((e) => e.id)).size, 200);
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 200);
  lines.forEach((l) => JSON.parse(l));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('appendReply needs a known in_reply_to, gets rep_ ids, readThread lists them', () => withTmp((dir) => {
  const ev = path.join(dir, 'state', 'events.jsonl');
  const th = path.join(dir, 'state', 'thread.jsonl');
  assert.deepEqual(E.readThread(th), []);
  E.appendEvent(ev, { type: 'message', text: 'q' });
  assert.throws(() => E.appendReply(th, { in_reply_to: 'evt_9', text: 'a' }, { eventsFile: ev }), /evt_9/);
  const r1 = E.appendReply(th, { in_reply_to: 'evt_1', text: 'a', sources: [{ file: 'src/a.js', lines: '12-20' }] }, { eventsFile: ev, now: fixedNow });
  const r2 = E.appendReply(th, { in_reply_to: 'evt_1', text: 'b', sources: [{ file: 'a.js', lines: '7' }] }, { eventsFile: ev });
  assert.equal(r1.id, 'rep_1');
  assert.equal(r1.ts, '2026-10-02T10:01:00.000Z');
  assert.equal(r2.id, 'rep_2');
  assert.deepEqual(E.readThread(th).map((x) => x.id), ['rep_1', 'rep_2']);
}));

test('reply text limits and source path safety', () => withTmp((dir) => {
  const ev = path.join(dir, 'events.jsonl');
  const th = path.join(dir, 'thread.jsonl');
  E.appendEvent(ev, { type: 'message', text: 'q' });
  const bad = (r, re) => assert.throws(() => E.appendReply(th, { in_reply_to: 'evt_1', text: 'a', ...r }, { eventsFile: ev }), re);
  bad({ text: '' }, /text/);
  bad({ text: 'a'.repeat(4001) }, /4000/);
  bad({ text: 'a\0' }, /NUL/);
  bad({ sources: 'x' }, /sources/);
  bad({ sources: [{ file: '/etc/passwd', lines: '1' }] }, /source/);
  bad({ sources: [{ file: '../x.js', lines: '1' }] }, /source/);
  bad({ sources: [{ file: 'a/../../x.js', lines: '1' }] }, /source/);
  bad({ sources: [{ file: 'a.js', lines: 'abc' }] }, /lines/);
  bad({ sources: [{ file: 'a.js', lines: '20-12' }] }, /lines/);
  bad({ sources: [{ file: 'a.js', lines: '0' }] }, /lines/);
  bad({ sources: [{ file: 'a.js' }] }, /source/);
  assert.equal(fs.existsSync(th), false);
}));
