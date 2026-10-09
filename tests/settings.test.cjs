'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readSettings, writeSettings, chooseForVideo, readVideoChoice, writeVideoChoice, hasVideoChoice, slugDirOfChapter, settingsFile,
} = require('../lib/settings.mts');
const { loadTemplate } = require('../lib/template.mts');
const { startServer } = require('../server/server.mts');
const { newManifest, saveManifest, loadManifest, validateManifest } = require('../lib/manifest.mts');

const FIXTURES = path.join(__dirname, 'fixtures', 'templates');

// Makes an empty temp folder for one test and removes it when the test ends.
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('settings round trip through .oldguy/settings.json', (t) => {
  const project = tempDir(t);
  writeSettings(project, { template: 'duo', shape: '9:16' });
  assert.deepEqual(readSettings(project), { template: 'duo', shape: '9:16' });
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile(project), 'utf8')), { template: 'duo', shape: '9:16' });
  assert.deepEqual(fs.readdirSync(path.join(project, '.oldguy')), ['settings.json'], 'no temp file is left behind');
});

test('a missing or corrupt settings file means explainer at 16:9', (t) => {
  const project = tempDir(t);
  assert.deepEqual(readSettings(project), { template: 'explainer', shape: '16:9' });
  fs.mkdirSync(path.join(project, '.oldguy'));
  fs.writeFileSync(settingsFile(project), '{not json');
  assert.deepEqual(readSettings(project), { template: 'explainer', shape: '16:9' });
  fs.writeFileSync(settingsFile(project), JSON.stringify({ template: '../evil', shape: '4:3' }));
  assert.deepEqual(readSettings(project), { template: 'explainer', shape: '16:9' });
});

test('writeSettings refuses a bad id or shape', (t) => {
  const project = tempDir(t);
  assert.throws(() => writeSettings(project, { template: 'Bad Id', shape: '16:9' }), /must be a slug/);
  assert.throws(() => writeSettings(project, { template: 'duo', shape: '4:3' }), /16:9, 9:16 or 1:1/);
});

test('a request override wins over the project default', () => {
  const duo = loadTemplate('duo', FIXTURES);
  const settings = { template: 'explainer', shape: '16:9' };
  assert.deepEqual(chooseForVideo(settings, { template: 'duo', shape: '9:16' }, duo), { template: 'duo', shape: '9:16', shapeFallback: false });
  assert.deepEqual(chooseForVideo({ template: 'duo', shape: '9:16' }, {}, duo), { template: 'duo', shape: '9:16', shapeFallback: false });
});

test('a shape the template does not offer falls back to its default, and says so', () => {
  const duo = loadTemplate('duo', FIXTURES);
  assert.deepEqual(chooseForVideo({ template: 'duo', shape: '1:1' }, {}, duo), { template: 'duo', shape: '16:9', shapeFallback: true });
});

test('chooseForVideo refuses a template that is not the one asked for', () => {
  assert.throws(() => chooseForVideo({ template: 'explainer', shape: '16:9' }, { template: 'tutor' }, loadTemplate('duo', FIXTURES)), /not the one asked for/);
});

test('a video folder records its choice; a folder from before templates reads as explainer at 16:9', (t) => {
  const slugDir = tempDir(t);
  assert.equal(hasVideoChoice(slugDir), false);
  assert.deepEqual(readVideoChoice(slugDir), { template: 'explainer', shape: '16:9' });
  writeVideoChoice(slugDir, { template: 'duo', shape: '9:16' });
  assert.equal(hasVideoChoice(slugDir), true);
  assert.deepEqual(readVideoChoice(slugDir), { template: 'duo', shape: '9:16' });
});

test('a video keeps one template once it has chapters', (t) => {
  const slugDir = tempDir(t);
  writeVideoChoice(slugDir, { template: 'duo', shape: '9:16' });
  writeVideoChoice(slugDir, { template: 'explainer', shape: '16:9' });
  fs.mkdirSync(path.join(slugDir, 'chapters', 'a'), { recursive: true });
  assert.throws(() => writeVideoChoice(slugDir, { template: 'duo', shape: '16:9' }), /already made as explainer at 16:9; remake it/);
  writeVideoChoice(slugDir, { template: 'explainer', shape: '16:9' });
});

test('slugDirOfChapter climbs out of chapters/<id>', () => {
  assert.equal(slugDirOfChapter('/p/.oldguy/demo/chapters/intro'), '/p/.oldguy/demo');
});

test('the manifest takes an optional template and shape, always together', () => {
  const m = newManifest({ title: 'T', slug: 't', audience: 'beginner', template: 'duo', shape: '9:16' });
  assert.equal(m.template, 'duo');
  assert.equal(m.shape, '9:16');
  assert.deepEqual(Object.keys(m), ['version', 'title', 'slug', 'audience', 'verified_against_commit', 'template', 'shape', 'chapters']);
  assert.equal(validateManifest(m).ok, true);
  assert.match(validateManifest({ ...m, shape: '4:3' }).errors.join(), /shape must be/);
  assert.match(validateManifest({ ...m, template: 'Bad' }).errors.join(), /template must be a template id/);
  const { shape, ...noShape } = m;
  assert.match(validateManifest(noShape).errors.join(), /given together/);
  assert.equal('template' in newManifest({ title: 'T', slug: 't', audience: 'beginner' }), false);
});

test('an old manifest without a template loads and saves back byte for byte', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'manifest.json');
  const old = newManifest({ title: 'T', slug: 't', audience: 'beginner' });
  saveManifest(file, old);
  const before = fs.readFileSync(file);
  saveManifest(file, loadManifest(file));
  assert.deepEqual(fs.readFileSync(file), before);
});

// Starts a server on slugDir with an empty player folder and closes it afterwards.
async function serve(t, slugDir) {
  const playerDir = tempDir(t);
  const srv = await startServer({ slugDir, deps: { playerDir } });
  t.after(() => srv.close());
  return srv;
}

test('the server writes the video choice into a new manifest, and into an old one once', async (t) => {
  const fresh = path.join(tempDir(t), 'demo');
  fs.mkdirSync(path.join(fresh, 'chapters'), { recursive: true });
  writeVideoChoice(fresh, { template: 'duo', shape: '9:16' });
  await serve(t, fresh);
  const m = loadManifest(path.join(fresh, 'manifest.json'));
  assert.equal(m.template, 'duo');
  assert.equal(m.shape, '9:16');

  const old = path.join(tempDir(t), 'demo');
  fs.mkdirSync(path.join(old, 'chapters'), { recursive: true });
  saveManifest(path.join(old, 'manifest.json'), newManifest({ title: 'Old', slug: 'demo', audience: 'beginner' }));
  writeVideoChoice(old, { template: 'explainer', shape: '1:1' });
  await serve(t, old);
  const patched = loadManifest(path.join(old, 'manifest.json'));
  assert.equal(patched.title, 'Old');
  assert.equal(patched.shape, '1:1');
});

test('the server leaves a manifest alone when the folder chose no template', async (t) => {
  const slugDir = path.join(tempDir(t), 'demo');
  fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
  await serve(t, slugDir);
  assert.equal('template' in loadManifest(path.join(slugDir, 'manifest.json')), false);
});
