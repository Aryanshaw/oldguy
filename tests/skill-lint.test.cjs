'use strict';
// Lint for the yap skill text: the files exist, link to each other, name only real commands and keep the owner's word rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKILL_DIR = path.join(__dirname, '..', 'skills', 'yap');
const SKILL = path.join(SKILL_DIR, 'SKILL.md');
const REFS_DIR = path.join(SKILL_DIR, 'references');
const CLI = path.join(__dirname, '..', 'bin', 'yap.cjs');
const MAX_SKILL_LINES = 200;
const MAX_REFERENCE_LINES = 120;
// Words the owner never wants in the skill text (whole words, any case).
const BANNED_WORDS = /\b(cost|costs|price|pricing|usd|dollar|dollars|billing|token|tokens)\b/i;
// Commands that do not exist yet and must not be promised.
const MISSING_COMMANDS = /\byap (listen|export|serve)\b/i;

// Reads one file as text; a missing file fails the test with its path.
function readText(file) {
  assert.ok(fs.existsSync(file), `${file} is missing`);
  return fs.readFileSync(file, 'utf8');
}

// Every skill file: SKILL.md and each reference, as { file, text }.
function allFiles() {
  const refs = fs.existsSync(REFS_DIR) ? fs.readdirSync(REFS_DIR).map((n) => path.join(REFS_DIR, n)) : [];
  return [SKILL, ...refs].map((file) => ({ file, text: readText(file) }));
}

// The command names printed by `yap --help`, read from its "commands:" block.
function realCommands() {
  const r = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const block = r.stdout.split('commands:')[1] || '';
  return new Set(block.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean));
}

// Every `yap <command>` inside backticks or fenced code; `/yap`, `.yap/` and `yap-setup` are not commands.
function mentionedCommands(text) {
  const spans = [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => m[0]);
  const names = new Set();
  for (const span of spans) {
    for (const m of span.matchAll(/(?<![/\w.-])yap\s+([a-z][a-z-]*)/g)) names.add(m[1]);
  }
  return names;
}

// The frontmatter between the first two --- lines, as key: value pairs.
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'SKILL.md needs --- frontmatter ---');
  return Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
}

test('SKILL.md frontmatter names the skill and describes its triggers', () => {
  const fm = frontmatter(readText(SKILL));
  assert.equal(fm.name, 'yap');
  assert.ok(fm.description && fm.description.length > 0, 'description must not be empty');
  for (const word of ['explain', 'video', '/yap']) assert.ok(fm.description.includes(word), `description must mention "${word}"`);
});

test('SKILL.md stays short and each reference stays short', () => {
  assert.ok(readText(SKILL).split('\n').length <= MAX_SKILL_LINES, `SKILL.md is over ${MAX_SKILL_LINES} lines`);
  for (const { file, text } of allFiles().slice(1)) {
    assert.ok(text.split('\n').length <= MAX_REFERENCE_LINES, `${path.basename(file)} is over ${MAX_REFERENCE_LINES} lines`);
  }
});

test('every yap command mentioned is a real command in yap --help', () => {
  const real = realCommands();
  assert.ok(real.has('scaffold'), 'help output did not parse');
  for (const { file, text } of allFiles()) {
    for (const name of mentionedCommands(text)) assert.ok(real.has(name), `${path.basename(file)} mentions "yap ${name}", which is not a command`);
  }
});

test('SKILL.md links every reference, every link resolves, and the required references exist', () => {
  const linked = new Set([...readText(SKILL).matchAll(/references\/([a-z-]+\.md)/g)].map((m) => m[1]));
  const present = new Set(fs.existsSync(REFS_DIR) ? fs.readdirSync(REFS_DIR) : []);
  for (const name of ['scope.md', 'verify.md', 'storyboard.md', 'scene-kit.md', 'narrate.md', 'render.md', 'doctor.md']) {
    assert.ok(present.has(name), `references/${name} is missing`);
  }
  for (const name of linked) assert.ok(present.has(name), `SKILL.md links references/${name}, which does not exist`);
  for (const name of present) assert.ok(linked.has(name), `references/${name} is not linked from SKILL.md`);
});

test('every reference ends with a Gate line', () => {
  for (const { file, text } of allFiles().slice(1)) {
    const last = text.split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
    assert.ok(last.startsWith('**Gate:**'), `${path.basename(file)} must end with a line starting **Gate:**`);
  }
});

test('the money rule lets Claude explain the repository\'s own payment code', () => {
  assert.ok(readText(SKILL).includes('Explaining the repository\'s own payment or checkout code is fine'),
    'SKILL.md must say that explaining the repository\'s own payment or checkout code is fine');
});

test('every SKILL.md paragraph that re-runs yap narrate also names yap audit', () => {
  const paragraphs = readText(SKILL).split(/\n\s*\n/);
  for (const p of paragraphs) {
    if (/`yap narrate`/.test(p)) assert.ok(/`yap audit`/.test(p), `paragraph mentions yap narrate without yap audit:\n${p}`);
  }
});

test('no file uses a banned word or promises a command that does not exist', () => {
  for (const { file, text } of allFiles()) {
    text.split('\n').forEach((line, i) => {
      const banned = line.match(BANNED_WORDS);
      assert.ok(!banned, `${path.basename(file)}:${i + 1} uses the banned word "${banned && banned[0]}"`);
      const missing = line.match(MISSING_COMMANDS);
      assert.ok(!missing, `${path.basename(file)}:${i + 1} mentions "${missing && missing[0]}", which does not exist`);
    });
  }
});

// Every file under skills/, at any depth, as { file, text }.
function everySkillFile(dir = path.join(__dirname, '..', 'skills')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? everySkillFile(full) : [{ file: full, text: fs.readFileSync(full, 'utf8') }];
  });
}

test('no skill file sends Claude to a hyperframes-* skill yap does not ship, or to search the disk', () => {
  for (const { file, text } of everySkillFile()) {
    text.split('\n').forEach((line, i) => {
      assert.ok(!/\bhyperframes-[a-z]/i.test(line), `${path.relative(SKILL_DIR, file)}:${i + 1} names a hyperframes-* skill: ${line}`);
      assert.ok(!/\bfind\s+\//.test(line), `${path.relative(SKILL_DIR, file)}:${i + 1} searches the disk: ${line}`);
    });
  }
});

// The flags each Hyperframes 0.8.112 command really has (from its --help, ACCEPTANCE.md open item e).
const HYPERFRAMES_FLAGS = { check: ['--snapshots', '--at-transitions'], snapshot: ['--frames', '--at'] };

test('render.md states the pinned check and snapshot commands inline, using only flags 0.8.112 has', () => {
  const text = readText(path.join(REFS_DIR, 'render.md'));
  for (const cmd of Object.keys(HYPERFRAMES_FLAGS)) {
    assert.ok(text.includes(`npx --yes hyperframes@0.8.112 ${cmd} `), `render.md must show npx --yes hyperframes@0.8.112 ${cmd}`);
  }
  for (const { file, text: body } of everySkillFile()) {
    for (const m of body.matchAll(/hyperframes@[\d.]+ (check|snapshot)\b([^\n`]*)/g)) {
      for (const flag of m[2].match(/--[a-z-]+/g) || []) {
        assert.ok(HYPERFRAMES_FLAGS[m[1]].includes(flag), `${path.basename(file)}: hyperframes ${m[1]} has no ${flag}`);
      }
    }
  }
});

test('SKILL.md runs chapters one at a time in story order and renders each with --only', () => {
  const text = readText(SKILL);
  assert.ok(/story order/i.test(text), 'SKILL.md must say chapters are made in story order');
  assert.ok(/for each chapter/i.test(text), 'SKILL.md must describe the per-chapter pipeline ("for each chapter")');
  assert.ok(/`yap render [^`]*--only <id>`/.test(text), 'SKILL.md must render each chapter with `yap render ... --only <id>`');
  assert.ok(/--only <all ids in story order>/.test(text), 'SKILL.md must end with one --only run over every id in story order');
});

// The rule that keeps a headless session alive until every render it started has finished.
const NEVER_END_TURN = 'Never end your turn while a render is running.';

test('no skill file runs a render in the background, with &, or through run_in_background', () => {
  for (const { file, text } of everySkillFile()) {
    text.split('\n').forEach((line, i) => {
      const where = `${path.relative(SKILL_DIR, file)}:${i + 1}`;
      assert.ok(!/background/i.test(line), `${where} mentions running something in the background: ${line}`);
      assert.ok(!/run_in_background/.test(line), `${where} mentions run_in_background: ${line}`);
      assert.ok(!/yap render[^`\n]*&/.test(line), `${where} puts a yap render behind &: ${line}`);
    });
  }
});

test('SKILL.md says Claude never ends its turn while a render is running, and renders in the foreground', () => {
  const text = readText(SKILL);
  assert.ok(text.includes(NEVER_END_TURN), `SKILL.md must contain "${NEVER_END_TURN}"`);
  assert.ok(/foreground/.test(text), 'SKILL.md must say renders run in the foreground');
});
