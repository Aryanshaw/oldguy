'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { assetPath, missingAssets, fetchAsset, megabytes } = require('../lib/assets.mts');
const { loadTemplate } = require('../lib/template.mts');
const { buildRecord, buildChangedReason } = require('../lib/build-record.mts');

const DUO = loadTemplate('duo', path.join(__dirname, 'fixtures', 'templates'));
const BODY = crypto.randomBytes(1234);
const GOOD = { path: 'assets/loop.mp4', url: 'https://x/loop.mp4', sha256: crypto.createHash('sha256').update(BODY).digest('hex'), bytes: 1234 };

// Makes an empty temp folder for one test and removes it when the test ends.
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-assets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Starts a local server: /good sends BODY, /bad sends other bytes of the same size, /cut sends half then drops.
async function server(t) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/good') return res.end(BODY);
    if (req.url === '/bad') return res.end(Buffer.alloc(1234, 7));
    if (req.url === '/big') return res.end(Buffer.alloc(5000));
    res.write(BODY.subarray(0, 600));
    setTimeout(() => res.destroy(), 20);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return `http://127.0.0.1:${srv.address().port}`;
}

// A getter that maps the asset's https URL onto the local server's path.
function getter(base, route) {
  return async () => new Promise((resolve, reject) => {
    http.get(`${base}${route}`, (res) => resolve(res)).on('error', reject);
  });
}

// The duo template with its background asset replaced.
function duoWith(asset) {
  return { ...DUO, assets: DUO.assets.map((a) => (a.path === asset.path ? asset : a)) };
}

test('a shipped asset lives in the template folder, a downloaded one in the data folder', () => {
  assert.equal(assetPath(DUO, { path: 'assets/kid.svg' }, '/data'), path.join(DUO.dir, 'assets', 'kid.svg'));
  assert.equal(assetPath(DUO, GOOD, '/data'), path.join('/data', 'templates', 'duo', 'assets', 'loop.mp4'));
});

test('a good download lands in place and is no longer missing', async (t) => {
  const data = tempDir(t);
  const tpl = duoWith(GOOD);
  assert.deepEqual(missingAssets(tpl, data).map((a) => a.path), ['assets/loop.mp4']);
  const dest = await fetchAsset(tpl, GOOD, data, getter(await server(t), '/good'));
  assert.deepEqual(fs.readFileSync(dest), BODY);
  assert.deepEqual(missingAssets(tpl, data), []);
  assert.deepEqual(fs.readdirSync(path.dirname(dest)), ['loop.mp4'], 'no temp file is left');
});

test('a checksum mismatch deletes the file and names it with both hashes', async (t) => {
  const data = tempDir(t);
  await assert.rejects(fetchAsset(duoWith(GOOD), GOOD, data, getter(await server(t), '/bad')),
    new RegExp(`assets/loop\\.mp4: checksum mismatch \\(expected ${GOOD.sha256}, got [0-9a-f]{64}\\); the file was deleted`));
  assert.deepEqual(fs.readdirSync(path.join(data, 'templates', 'duo', 'assets')), []);
});

test('an interrupted download leaves nothing behind, and one larger than listed is cut off', async (t) => {
  const data = tempDir(t);
  const base = await server(t);
  await assert.rejects(fetchAsset(duoWith(GOOD), GOOD, data, getter(base, '/cut')));
  assert.deepEqual(fs.readdirSync(path.join(data, 'templates', 'duo', 'assets')), []);
  await assert.rejects(fetchAsset(duoWith(GOOD), GOOD, data, getter(base, '/big')), /larger than the listed 1234 bytes/);
  assert.deepEqual(fs.readdirSync(path.join(data, 'templates', 'duo', 'assets')), []);
});

test('a shipped asset has nothing to download', async (t) => {
  await assert.rejects(fetchAsset(DUO, { path: 'assets/kid.svg' }, tempDir(t), async () => []), /ships with the template/);
});

test('megabytes rounds, never showing 0 MB', () => {
  assert.equal(megabytes(23000000), '23 MB');
  assert.equal(megabytes(1234), '1 MB');
});

test('an explainer build record is unchanged; a templated one records its template and assets', (t) => {
  const dir = tempDir(t);
  const files = ['narration.txt', 'narration.wav', 'beats.json', 'captions.vtt', 'captions.json', 'index.html', 'gsap.min.js', 'assets/kid.svg'];
  fs.mkdirSync(path.join(dir, 'assets'));
  for (const f of files) fs.writeFileSync(path.join(dir, f), f);
  const chapter = { sentences: [], scene: [] };
  const read = (n) => fs.readFileSync(path.join(dir, n));
  const plain = buildRecord(chapter, read, null);
  assert.deepEqual(Object.keys(plain), ['version', 'verified_against_commit', 'sha256']);
  assert.equal(Object.keys(plain.sha256).length, 8);

  const built = buildRecord(chapter, read, null, { template: { id: 'duo', version: 2, shape: '9:16' }, assets: ['assets/kid.svg'] });
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(built));
  assert.equal(buildChangedReason(dir, chapter), null);
  assert.equal(buildChangedReason(dir, chapter, { id: 'duo', version: 2, shape: '9:16' }), null);
  assert.match(buildChangedReason(dir, chapter, { id: 'duo', version: 3, shape: '9:16' }), /built as duo v2 at 9:16, the video is now duo v3 at 9:16/);
  fs.writeFileSync(path.join(dir, 'assets', 'kid.svg'), 'changed');
  assert.match(buildChangedReason(dir, chapter), /chapter changed after narrate/, 'an edited asset shows as a change');

  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(plain));
  assert.equal(buildChangedReason(dir, chapter, { id: 'explainer', version: 1, shape: '16:9' }), null, 'no block means explainer at 16:9');
  assert.match(buildChangedReason(dir, chapter, { id: 'explainer', version: 1, shape: '9:16' }), /built as explainer at 16:9/);
});
