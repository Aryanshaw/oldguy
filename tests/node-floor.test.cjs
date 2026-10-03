const test = require('node:test');
const assert = require('node:assert/strict');
const { nodeProblem, NODE_FLOOR } = require('../lib/node-floor.cjs');

const DIR = '/x/yap/bin';

test('the floor is 22.18.0', () => {
  assert.equal(NODE_FLOOR, '22.18.0');
});

test('versions at or above the floor have no problem', () => {
  for (const v of ['22.18.0', '22.18.1', '22.19.0', '23.0.0', '26.7.0', '100.0.0']) {
    assert.equal(nodeProblem(v, DIR), null, v);
  }
});

test('versions below the floor give one line naming the version and 22.18', () => {
  for (const v of ['22.17.0', '22.17.9', '22.9.1', '22.0.0', '21.99.99', '20.18.0', '18.0.0']) {
    const line = nodeProblem(v, DIR);
    assert.equal(typeof line, 'string', v);
    assert.ok(line.includes(v), v);
    assert.ok(line.includes('22.18'), v);
    assert.ok(!line.includes('\n'), v);
  }
});

test('numbers are compared as integers, not as text', () => {
  assert.equal(nodeProblem('22.100.0', DIR), null);
  assert.equal(nodeProblem('22.18.10', DIR), null);
  assert.notEqual(nodeProblem('9.99.99', DIR), null);
});

test('running from inside a node_modules folder is one line that says so', () => {
  for (const dir of ['/p/node_modules/yap/bin', 'C:\\p\\node_modules\\yap\\bin']) {
    const line = nodeProblem('22.18.0', dir);
    assert.equal(typeof line, 'string', dir);
    assert.ok(line.includes('node_modules'), dir);
    assert.ok(!line.includes('\n'), dir);
  }
});

test('a folder that only looks like node_modules is fine', () => {
  assert.equal(nodeProblem('22.18.0', '/p/my_node_modules_copy/yap'), null);
});

test('garbage versions are a problem line and never throw', () => {
  for (const v of ['banana', '', '22.18', '22.18.0.1', '22.18.x', 'v22.18.0', '22.18.0-rc1', ' 22.18.0', '22.18.0\n', '-1.0.0', undefined, null, 22]) {
    let line;
    assert.doesNotThrow(() => { line = nodeProblem(v, DIR); }, String(v));
    assert.equal(typeof line, 'string', String(v));
    assert.ok(!line.includes('\n'), String(v));
  }
});

// Real runs under other Node versions, when this machine has them (nvm keeps them under ~/.nvm/versions/node).
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fsNode = require('node:fs');
const ROOT = path.join(__dirname, '..');

// The path of an installed Node of this exact version, or null when it is not installed.
function nodeOfVersion(version) {
  const bin = path.join(os.homedir(), '.nvm', 'versions', 'node', `v${version}`, 'bin', 'node');
  return fsNode.existsSync(bin) ? bin : null;
}

test('under Node 22.17 the command and the hook each print one plain sentence, never a syntax error', (t) => {
  const old = nodeOfVersion('22.17.0');
  if (!old) return t.skip('Node 22.17.0 is not installed on this machine');
  const cli = spawnSync(old, [path.join(ROOT, 'bin', 'yap.cjs'), '--help'], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.equal(cli.stdout, '');
  assert.match(cli.stderr, /^yap: Yap needs Node 22\.18 or newer; this is Node 22\.17\.0\./);
  assert.equal(cli.stderr.trim().split('\n').length, 1);
  assert.doesNotMatch(cli.stderr, /SyntaxError|ERR_UNKNOWN_FILE_EXTENSION/);
  const hook = spawnSync(old, [path.join(ROOT, 'hooks', 'session-start.cjs')], { input: '{}', encoding: 'utf8' });
  assert.equal(hook.status, 0);
  assert.equal(hook.stdout, '');
  assert.match(hook.stderr, /^yap: Yap needs Node 22\.18 or newer/);
  assert.equal(hook.stderr.trim().split('\n').length, 1);
});

test('under Node 22.18 the command and the hook run normally', (t) => {
  const floor = nodeOfVersion('22.18.0');
  if (!floor) return t.skip('Node 22.18.0 is not installed on this machine');
  const cli = spawnSync(floor, [path.join(ROOT, 'bin', 'yap.cjs'), '--help'], { encoding: 'utf8' });
  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /commands:/);
  assert.equal(cli.stderr, '');
  const hook = spawnSync(floor, [path.join(ROOT, 'hooks', 'session-start.cjs')], { input: '{}', encoding: 'utf8' });
  assert.equal(hook.status, 0);
  assert.equal(hook.stderr, '');
});
