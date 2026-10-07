'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const E = require('../lib/events.mts');
const { openEvents } = require('../lib/inbox.mts');

// Makes a temp state folder with the three chat file paths, removed after the test.
function files(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-inbox-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { eventsFile: path.join(dir, 'events.jsonl'), threadFile: path.join(dir, 'thread.jsonl'), acksFile: path.join(dir, 'acks.jsonl') };
}

test('an event is open until it has a reply or an ack; order is kept', (t) => {
  const f = files(t);
  assert.deepEqual(openEvents(f), []);
  E.appendEvent(f.eventsFile, { type: 'message', text: 'one' });
  E.appendEvent(f.eventsFile, { type: 'message', text: 'two' });
  E.appendEvent(f.eventsFile, { type: 'make_video', ref: 'rep_1' });
  E.appendEvent(f.eventsFile, { type: 'just_text' });
  assert.deepEqual(openEvents(f).map((e) => e.id), ['evt_1', 'evt_2', 'evt_3', 'evt_4']);
  E.appendReply(f.threadFile, { in_reply_to: 'evt_2', text: 'answer' }, { eventsFile: f.eventsFile });
  E.appendAck(f.acksFile, 'evt_3', { eventsFile: f.eventsFile });
  assert.deepEqual(openEvents(f).map((e) => e.id), ['evt_1', 'evt_4']);
  assert.equal(openEvents(f)[0].text, 'one');
});

test('acks: ack_<n> ids, the event must exist, a second ack of the same event is fine, broken lines are skipped', (t) => {
  const f = files(t);
  E.appendEvent(f.eventsFile, { type: 'just_text' });
  assert.throws(() => E.appendAck(f.acksFile, 'evt_9', { eventsFile: f.eventsFile }), /evt_9 is not a known event/);
  assert.throws(() => E.appendAck(f.acksFile, 'nope', { eventsFile: f.eventsFile }), /event_id must look like evt_<number>/);
  const a = E.appendAck(f.acksFile, 'evt_1', { eventsFile: f.eventsFile, now: () => new Date('2026-10-07T10:00:00Z') });
  assert.deepEqual(a, { id: 'ack_1', ts: '2026-10-07T10:00:00.000Z', event_id: 'evt_1' });
  assert.equal(E.appendAck(f.acksFile, 'evt_1', { eventsFile: f.eventsFile }).id, 'ack_2');
  fs.appendFileSync(f.acksFile, 'not json\n');
  assert.deepEqual(E.readAcks(f.acksFile).map((x) => x.event_id), ['evt_1', 'evt_1']);
  assert.deepEqual(openEvents(f), []);
});
