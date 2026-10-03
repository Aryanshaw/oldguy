'use strict';
// The structure rules of the codebase, as functions that look at source text. tests/code-rules.test.cjs runs them on the
// real files and on small made-up files that break each rule, so every rule is shown able to fail.
const fs = require('node:fs');
const path = require('node:path');

// The folders that hold the program's own code (tests and docs are not held to these rules).
const SOURCE_DIRS = ['bin', 'cli', 'hooks', 'lib', 'server', 'scene-kit'];
// Which folders a folder's files may import from (its own folder is always allowed).
const ALLOWED_IMPORTS = {
  'scene-kit': [],
  lib: ['scene-kit'],
  server: ['lib', 'scene-kit'],
  cli: ['lib', 'server'],
  bin: ['cli', 'lib'],
  hooks: ['lib'],
};

// Reads every .mts and .cjs file in the source folders: { 'lib/x.mts': text }.
function readSources(root) {
  const files = {};
  for (const dir of SOURCE_DIRS) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      if (name.endsWith('.mts') || name.endsWith('.cjs')) files[`${dir}/${name}`] = fs.readFileSync(path.join(root, dir, name), 'utf8');
    }
  }
  return files;
}

// Finds the relative imports in a source text: [{ spec, kind }], kind being 'static' (import ... from), 'type' (import type,
// erased when the program runs) or 'dynamic' (import() and require()).
function importsOf(source) {
  const found = [];
  const add = (spec, kind) => { if (spec.startsWith('.')) found.push({ spec, kind }); };
  for (const m of source.matchAll(/^\s*import\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) add(m[2], m[1] ? 'type' : 'static');
  for (const m of source.matchAll(/^\s*export\s+(type\s+)?(?:\*|\{[^}]*\})\s*from\s+['"]([^'"]+)['"]/gm)) add(m[2], m[1] ? 'type' : 'static');
  for (const m of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1], 'dynamic');
  for (const m of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1], 'dynamic');
  return found;
}

// The repository-relative path an import points at, e.g. ('cli/a.mts', '../lib/b.mts') gives 'lib/b.mts'.
function resolveImport(fromFile, spec) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
}

// Lists the imports that reach into a folder the importing folder may not use.
function checkLayering(files) {
  const bad = [];
  for (const [file, source] of Object.entries(files)) {
    const layer = file.split('/')[0];
    for (const { spec } of importsOf(source)) {
      const target = resolveImport(file, spec).split('/')[0];
      if (target !== layer && !(ALLOWED_IMPORTS[layer] || []).includes(target)) bad.push(`${file} imports ${spec} (${layer}/ may not use ${target}/)`);
    }
  }
  return bad;
}

// Finds a loop of static imports (type-only and dynamic imports do not count: they are not loaded in a chain).
// Returns the loop as 'a -> b -> a', or null.
function findCycle(files) {
  const edges = {};
  for (const [file, source] of Object.entries(files)) {
    edges[file] = importsOf(source).filter((i) => i.kind === 'static').map((i) => resolveImport(file, i.spec)).filter((t) => t in files);
  }
  const state = {};
  const stack = [];
  const visit = (file) => {
    if (state[file] === 'done') return null;
    if (state[file] === 'open') return [...stack.slice(stack.indexOf(file)), file].join(' -> ');
    state[file] = 'open';
    stack.push(file);
    for (const next of edges[file]) {
      const loop = visit(next);
      if (loop) return loop;
    }
    stack.pop();
    state[file] = 'done';
    return null;
  };
  for (const file of Object.keys(files)) {
    const loop = visit(file);
    if (loop) return loop;
  }
  return null;
}

// A line without its comment: a whole-line comment is empty, a trailing " // ..." is cut off.
function code(line) {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
  return line.replace(/\s\/\/.*$/, '');
}

// Lists uses of `any` and of the switches that turn type checking off. An expect-error needs a reason after it.
function checkTyping(files) {
  const bad = [];
  for (const [file, source] of Object.entries(files)) {
    if (!file.endsWith('.mts')) continue;
    source.split('\n').forEach((line, i) => {
      const at = `${file}:${i + 1}`;
      if (/(:\s*any\b|\bas any\b|<any>|\bany\[\])/.test(code(line))) bad.push(`${at} uses any`);
      if (/@ts-ignore|@ts-nocheck/.test(line)) bad.push(`${at} turns type checking off`);
      const expectError = /@ts-expect-error(.*)$/.exec(line);
      if (expectError && expectError[1].trim() === '') bad.push(`${at} has @ts-expect-error without a reason`);
    });
  }
  return bad;
}

// Lists lines that start with `await` at the left edge of a module (top-level await breaks require() of an ES module).
function checkTopLevelAwait(files) {
  const bad = [];
  for (const [file, source] of Object.entries(files)) {
    if (!file.endsWith('.mts')) continue;
    source.split('\n').forEach((line, i) => { if (/^await\s/.test(line)) bad.push(`${file}:${i + 1} awaits at the top level`); });
  }
  return bad;
}

// Lists relative imports that leave out the file extension (Node needs it for ES modules).
function checkExtensions(files) {
  const bad = [];
  for (const [file, source] of Object.entries(files)) {
    for (const { spec } of importsOf(source)) if (!/\.(mts|cjs)$/.test(spec)) bad.push(`${file} imports ${spec} without .mts or .cjs`);
  }
  return bad;
}

// Lists cli files (other than the shared helper) that export no function named run....
function checkCliRunners(files) {
  return Object.entries(files)
    .filter(([file]) => file.startsWith('cli/') && file !== 'cli/args.mts')
    .filter(([, source]) => !/export\s*\{[^}]*\brun[A-Za-z]*\b/.test(source))
    .map(([file]) => `${file} exports no run... function`);
}

module.exports = { readSources, importsOf, resolveImport, checkLayering, findCycle, checkTyping, checkTopLevelAwait, checkExtensions, checkCliRunners };
