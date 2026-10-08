const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// Paths that keep the old name on purpose: the historical record (what was true when it was written), the rename's
// own spec and plan, vendored third-party skills, and generated lockfiles.
const SKIP_PREFIXES = [
  'docs/phase-',
  'docs/superpowers/plans/',
  'docs/superpowers/specs/2026-10-02-',
  'docs/superpowers/specs/2026-10-03-',
  'docs/superpowers/specs/2026-10-07-phase-4-',
  'docs/superpowers/specs/2026-10-07-oldguy-rename-design.md',
  'docs/spikes/',
  'spikes/',
  '.claude/skills/',
];
const SKIP_FILES = new Set(['tests/brand-name.test.cjs', 'package-lock.json', 'player/package-lock.json', 'packages/oldguy/package-lock.json']);
// Binary files and built player assets carry no reviewable text.
const BINARY = /\.(png|webp|jpe?g|gif|mp4|wav|mp3|woff2?|ttf|ico)$/i;
// Lines that keep the old word on purpose:
// - the subline, where "yap" is the verb, not the product
// - links to the original design spec, whose file name is part of the historical record
// - the rename notice and the owner's steps to retire the old npm installer
// - the .gitignore entry that keeps old local .yap/ video folders out of git
// - "yappy", the tutor's personality, an ordinary English word
const ALLOWED = [
  /Claude yaps\. You watch\./,
  /2026-10-02-yap-design\.md/,
  /Renamed from Yap to oldguy/,
  /npm deprecate getyap/,
  /old installer, `getyap`/,
  /^\.yap\/?$/,
  /\byappy\b/i,
];
// Inline data URIs (base64 pictures in a stage) can hold any three letters by chance; they are not text.
const DATA_URI = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g;

// Tracked files that should no longer name the product "yap".
function checkedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !SKIP_FILES.has(f) && !BINARY.test(f))
    .filter((f) => !SKIP_PREFIXES.some((p) => f.startsWith(p)))
    .filter((f) => !(f.startsWith('player/dist/') && f !== 'player/dist/index.html'));
}

test('no shipped file or path still uses the old product name', () => {
  const hits = [];
  for (const file of checkedFiles()) {
    if (/yap/i.test(file)) hits.push(`${file}: (path)`);
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;
    fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      const text = line.replace(DATA_URI, '');
      if (/yap/i.test(text) && !ALLOWED.some((re) => re.test(line))) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, [], `${hits.length} leftover "yap" mentions:\n${hits.join('\n')}`);
});
