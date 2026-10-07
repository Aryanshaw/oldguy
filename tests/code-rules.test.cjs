'use strict';
// Code-rule checks that keep the TypeScript conversion honest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// The lib files that import no other oldguy module and are therefore converted first.
const LEAF_LIB = [
  'sentences', 'wav', 'beats', 'captions', 'build-record', 'render-schedule', 'audit',
  'hyperframes', 'data-dir', 'ask-server', 'http-guard', 'poster', 'sse',
];

test('no file under scene-kit/ or in the lib/ leaf list ends in .cjs', () => {
  const sceneKit = fs.readdirSync(path.join(ROOT, 'scene-kit')).filter((f) => f.endsWith('.cjs'));
  const lib = LEAF_LIB.filter((n) => fs.existsSync(path.join(ROOT, 'lib', `${n}.cjs`)));
  assert.deepEqual(sceneKit, []);
  assert.deepEqual(lib, []);
});

test('the domain modules and the whole server folder are TypeScript, not .cjs', () => {
  const domain = ['chapter', 'chapter-scan', 'manifest', 'events', 'range', 'watcher', 'live-server', 'export', 'doctor', 'narrate', 'render-chapters'];
  const leftover = domain.filter((n) => fs.existsSync(path.join(ROOT, 'lib', `${n}.cjs`)));
  const server = fs.readdirSync(path.join(ROOT, 'server')).filter((f) => f.endsWith('.cjs'));
  assert.deepEqual(leftover, []);
  assert.deepEqual(server, []);
});

test('only the plain-JavaScript start files and the Node-floor file are .cjs under the source folders', () => {
  const allowed = new Set(['bin/oldguy.cjs', 'hooks/session-start.cjs', 'hooks/session-end.cjs', 'lib/node-floor.cjs']);
  const found = [];
  for (const dir of ['bin', 'cli', 'hooks', 'lib', 'server', 'scene-kit']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.cjs')) found.push(`${dir}/${f}`);
  }
  assert.deepEqual(found.filter((f) => !allowed.has(f)), []);
  assert.deepEqual([...allowed].filter((f) => !found.includes(f)), []);
});

// ---- structure rules (tests/code-rules-lib.cjs): each runs on the real files and on a made-up file that breaks it ----
const rules = require('./code-rules-lib.cjs');
const real = rules.readSources(ROOT);

test('layering: no folder imports from a folder it may not use', () => {
  assert.deepEqual(rules.checkLayering(real), []);
  const broken = { 'lib/a.mts': "import { x } from '../server/b.mts';\n", 'server/b.mts': "import { y } from '../cli/c.mts';\n", 'cli/c.mts': '', 'scene-kit/d.mts': "import '../lib/a.mts';\n" };
  assert.equal(rules.checkLayering(broken).length, 3);
  assert.deepEqual(rules.checkLayering({ 'cli/ok.mts': "import { s } from '../server/server.mts';\nimport type { T } from '../lib/t.mts';\n", 'server/server.mts': '', 'lib/t.mts': '' }), []);
});

test('layering: dynamic imports and require count too', () => {
  const broken = { 'lib/a.mts': "const m = await import('../cli/c.mts');\n", 'cli/c.mts': '', 'lib/b.cjs': "const x = require('../server/s.mts');\n", 'server/s.mts': '' };
  assert.equal(rules.checkLayering(broken).length, 2);
});

test('no loop of static imports (a loop breaks require() of an ES module)', () => {
  assert.equal(rules.findCycle(real), null);
  assert.equal(rules.findCycle({ 'lib/a.mts': "import { b } from './b.mts';\n", 'lib/b.mts': "import { a } from './a.mts';\n" }), 'lib/a.mts -> lib/b.mts -> lib/a.mts');
  // type-only and dynamic imports are not loaded as a chain
  assert.equal(rules.findCycle({ 'lib/a.mts': "import type { B } from './b.mts';\n", 'lib/b.mts': "import { a } from './a.mts';\n" }), null);
  assert.equal(rules.findCycle({ 'lib/a.mts': "const b = await import('./b.mts');\n", 'lib/b.mts': "import { a } from './a.mts';\n" }), null);
});

test('typing: no any, no switched-off type checking, every expect-error has a reason', () => {
  assert.deepEqual(rules.checkTyping(real), []);
  const broken = {
    'lib/a.mts': 'const x: any = 1;\nconst y = z as any;\nconst l: any[] = [];\n// @ts-ignore\nconst a = 1;\n// @ts-expect-error\nconst b = 2;\n',
  };
  assert.equal(rules.checkTyping(broken).length, 5);
  // a comment that merely says the word, and an expect-error with a reason, are fine
  assert.deepEqual(rules.checkTyping({ 'lib/a.mts': '// anything goes here: any more\n// @ts-expect-error the library types are wrong\nconst b = 2;\n' }), []);
});

test('no await at the top level of a module', () => {
  assert.deepEqual(rules.checkTopLevelAwait(real), []);
  assert.equal(rules.checkTopLevelAwait({ 'lib/a.mts': 'await run();\n' }).length, 1);
  assert.deepEqual(rules.checkTopLevelAwait({ 'lib/a.mts': 'async function f() {\n  await run();\n}\n' }), []);
});

test('every relative import names its file extension', () => {
  assert.deepEqual(rules.checkExtensions(real), []);
  assert.equal(rules.checkExtensions({ 'lib/a.mts': "import { b } from './b';\n" }).length, 1);
});

test('every cli file except the shared helper exports a run... function', () => {
  assert.deepEqual(rules.checkCliRunners(real), []);
  assert.equal(rules.checkCliRunners({ 'cli/x.mts': 'export { helper };\n' }).length, 1);
  assert.deepEqual(rules.checkCliRunners({ 'cli/x.mts': 'export { runX, other };\n' }), []);
});
