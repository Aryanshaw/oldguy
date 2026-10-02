const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['narration.wav', 'transcript.json', 'narration.txt', 'hook-stdin-sample.txt'];

// Later tasks lean on these samples, so fail loudly if one goes missing or empties.
test('the four shared fixtures exist and are non-empty', () => {
  for (const f of FILES) {
    const p = path.join(__dirname, 'fixtures', f);
    assert.ok(fs.existsSync(p), `${f} missing`);
    assert.ok(fs.statSync(p).size > 0, `${f} is empty`);
  }
});
