const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

// Claude Code only offers an update when the version changes, so every place that names it must move together.
test('plugin, marketplace, package and getyap all carry the same version', () => {
  const versions = {
    '.claude-plugin/plugin.json': read('.claude-plugin/plugin.json').version,
    '.claude-plugin/marketplace.json': read('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'oldguy').version,
    'package.json': read('package.json').version,
    'packages/getyap/package.json': read('packages/getyap/package.json').version,
  };
  assert.equal(new Set(Object.values(versions)).size, 1, `versions differ: ${JSON.stringify(versions)}`);
});
