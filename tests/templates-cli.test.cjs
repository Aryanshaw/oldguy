'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const BIN = path.join(REPO, 'bin', 'oldguy.cjs');
const FIXTURES = path.join(__dirname, 'fixtures', 'templates');

// Makes an empty temp folder for one test and removes it when the test ends.
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-tcli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Runs oldguy in a project folder with the fixture templates and a private data folder.
function oldguy(project, args, data = path.join(project, '.data')) {
  const env = { ...process.env, OLDGUY_TEMPLATES_DIR: FIXTURES, CLAUDE_PLUGIN_DATA: data };
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: project, env, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Reads the project's settings file.
function settings(project) {
  return JSON.parse(fs.readFileSync(path.join(project, '.oldguy', 'settings.json'), 'utf8'));
}

test('the list marks the project template, explainer first', (t) => {
  const project = tempDir(t);
  const r = oldguy(project, ['templates']);
  assert.equal(r.code, 0);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /^→ explainer /);
  assert.match(lines[1], /^ {2}duo +16:9 9:16 +A test template/);
  oldguy(project, ['templates', 'duo']);
  assert.match(oldguy(project, ['templates']).stdout.split('\n')[1], /^→ duo/);
});

test('setting a template writes settings and says what it needs downloaded', (t) => {
  const project = tempDir(t);
  const r = oldguy(project, ['templates', 'duo', '9:16']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^project template: duo at 9:16; it needs 1 MB downloaded before its first video \(oldguy templates duo --fetch\)\n$/);
  assert.deepEqual(settings(project), { template: 'duo', shape: '9:16' });
});

test('a shape the template lacks falls back to its default, and says so', (t) => {
  const project = tempDir(t);
  const r = oldguy(project, ['templates', 'duo', '1:1']);
  assert.match(r.stdout, /duo at 16:9 \(duo has no 1:1 layout, so its default 16:9 is used\)/);
  assert.deepEqual(settings(project), { template: 'duo', shape: '16:9' });
});

test('--show gives the voices, pace and media still to download', (t) => {
  const r = oldguy(tempDir(t), ['templates', 'duo', '--show']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /voices: kid \(bm_george, left\), dad \(am_adam, right\)/);
  assert.match(r.stdout, /captions word, pictures on each keyword, at most 12 words per line/);
  assert.match(r.stdout, /to download first: assets\/loop\.mp4 \(1 MB\)/);
});

test('--show says when a template draws its pictures from shot lists', (t) => {
  const project = tempDir(t);
  assert.doesNotMatch(oldguy(project, ['templates', 'duo', '--show']).stdout, /shots/);
  const root = path.join(project, 'templates');
  fs.cpSync(FIXTURES, root, { recursive: true });
  const file = path.join(root, 'duo', 'template.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), shots: true }));
  const env = { ...process.env, OLDGUY_TEMPLATES_DIR: root, CLAUDE_PLUGIN_DATA: path.join(project, '.data') };
  const r = spawnSync(process.execPath, [BIN, 'templates', 'duo', '--show'], { cwd: project, env, encoding: 'utf8' });
  assert.match(r.stdout, /\npictures: shot lists \(write shots\/<id>\.json for each chapter, then oldguy shots\)\n/);
});

test('--show says nothing is left once the media is in the data folder', (t) => {
  const project = tempDir(t);
  const data = path.join(project, '.data');
  fs.mkdirSync(path.join(data, 'templates', 'duo', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(data, 'templates', 'duo', 'assets', 'loop.mp4'), Buffer.alloc(1234));
  assert.match(oldguy(project, ['templates', 'duo', '--show'], data).stdout, /nothing to download/);
  assert.match(oldguy(project, ['templates', 'duo', '--fetch'], data).stdout, /duo: nothing to download/);
});

test('an unknown id or shape exits 2 and lists the valid ones', (t) => {
  const project = tempDir(t);
  const id = oldguy(project, ['templates', 'tutor']);
  assert.equal(id.code, 2);
  assert.match(id.stderr, /unknown template "tutor"; use one of explainer, duo/);
  const shape = oldguy(project, ['templates', 'duo', '4:3']);
  assert.equal(shape.code, 2);
  assert.match(shape.stderr, /unknown shape "4:3"; use one of 16:9, 9:16, 1:1/);
  assert.equal(fs.existsSync(path.join(project, '.oldguy', 'settings.json')), false);
});

test('oldguy video records the project default, or the request override, in video.json', (t) => {
  const project = tempDir(t);
  const slug = path.join(project, '.oldguy', 'demo');
  assert.equal(oldguy(project, ['video', '--dir', slug]).stdout, 'video: explainer at 16:9\n');
  oldguy(project, ['templates', 'duo', '9:16']);
  const other = path.join(project, '.oldguy', 'other');
  assert.equal(oldguy(project, ['video', '--dir', other]).stdout, 'video: duo at 9:16\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(other, 'video.json'), 'utf8')), { template: 'duo', shape: '9:16' });
  const third = path.join(project, '.oldguy', 'third');
  assert.equal(oldguy(project, ['video', '--dir', third, '--template', 'explainer', '--shape', '1:1']).stdout, 'video: explainer at 1:1\n');
});

test('oldguy video refuses to change a video that has chapters, and an unknown template', (t) => {
  const project = tempDir(t);
  const slug = path.join(project, '.oldguy', 'demo');
  oldguy(project, ['video', '--dir', slug]);
  fs.mkdirSync(path.join(slug, 'chapters', 'intro'), { recursive: true });
  const r = oldguy(project, ['video', '--dir', slug, '--shape', '9:16']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /already made as explainer at 16:9; remake it to change that/);
  assert.match(oldguy(project, ['video', '--dir', slug, '--template', 'nope']).stderr, /unknown template "nope"/);
  assert.equal(oldguy(project, ['video']).code, 2);
});

test('the /oldguy:templates skill exists, names only real commands and stays short', () => {
  const text = fs.readFileSync(path.join(REPO, 'skills', 'templates', 'SKILL.md'), 'utf8');
  assert.match(text, /^---\nname: templates\n/);
  const help = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' }).stdout;
  const real = new Set(help.split('commands:')[1].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean));
  for (const m of text.matchAll(/`oldguy ([a-z-]+)/g)) assert.ok(real.has(m[1]), `oldguy ${m[1]} is not a command`);
  assert.ok(text.split('\n').length <= 60);
  assert.doesNotMatch(text, /\b(cost|price|token)s?\b/i);
});
