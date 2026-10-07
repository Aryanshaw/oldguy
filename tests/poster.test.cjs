'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractPoster } = require('../lib/poster.mts');

// Makes a temp chapter folder and removes it when the test ends.
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-poster-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A fake exec that records each call and writes a tiny file to the temp output (the last argument).
function fakeExec(calls, { fail = false, writeNothing = false } = {}) {
  return async (file, args) => {
    calls.push({ file, args });
    if (fail) throw new Error('ffmpeg exploded');
    if (!writeNothing) fs.writeFileSync(args[args.length - 1], 'JPEG');
  };
}

test('extractPoster runs ffmpeg with an argv array and absolute paths, then moves the temp file into place', async (t) => {
  const dir = tempDir(t);
  const mp4 = path.join(dir, 'chapter.mp4');
  const out = path.join(dir, 'poster.jpg');
  const calls = [];
  await extractPoster({ ffmpeg: 'ffmpeg', mp4, out, atS: 1, exec: fakeExec(calls) });
  assert.equal(calls.length, 1);
  const tmp = calls[0].args[calls[0].args.length - 1];
  assert.match(path.relative(dir, tmp), new RegExp(`^poster\\.jpg\\.tmp-${process.pid}-\\d+$`));
  assert.deepEqual(calls[0], { file: 'ffmpeg', args: ['-nostdin', '-y', '-ss', '1', '-i', mp4, '-frames:v', '1', '-q:v', '3', '-f', 'image2', tmp] });
  assert.equal(fs.readFileSync(out, 'utf8'), 'JPEG');
  assert.equal(fs.existsSync(tmp), false);
});

test('a relative path is made absolute, so an id like --evil can never be read as an option', async (t) => {
  const dir = tempDir(t);
  const cwd = process.cwd();
  const calls = [];
  process.chdir(dir);
  try {
    fs.mkdirSync('--evil');
    await extractPoster({ ffmpeg: 'ffmpeg', mp4: path.join('--evil', 'chapter.mp4'), out: path.join('--evil', 'poster.jpg'), atS: 1, exec: fakeExec(calls) });
  } finally { process.chdir(cwd); }
  const args = calls[0].args;
  const input = args[args.indexOf('-i') + 1];
  assert.ok(path.isAbsolute(input) && path.isAbsolute(args[args.length - 1]));
  assert.ok(!args.slice(args.indexOf('-i') + 1).some((a) => a.startsWith('-') && a !== '-frames:v' && a !== '-q:v' && a !== '-f'));
});

test('a failing ffmpeg rejects, leaves no temp file and no poster', async (t) => {
  const dir = tempDir(t);
  const exec = async (file, args) => { fs.writeFileSync(args[args.length - 1], 'half'); throw new Error('ffmpeg exploded'); };
  await assert.rejects(extractPoster({ ffmpeg: 'ffmpeg', mp4: path.join(dir, 'chapter.mp4'), out: path.join(dir, 'poster.jpg'), atS: 1, exec }), /ffmpeg exploded/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('ffmpeg that exits fine but writes nothing is a failure, not a missing poster', async (t) => {
  const dir = tempDir(t);
  await assert.rejects(extractPoster({ ffmpeg: 'ffmpeg', mp4: path.join(dir, 'chapter.mp4'), out: path.join(dir, 'poster.jpg'), atS: 1, exec: fakeExec([], { writeNothing: true }) }));
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('exec receives an abort signal; aborting rejects and leaves no temp file', async (t) => {
  const dir = tempDir(t);
  const ctl = new AbortController();
  let seen;
  const exec = (file, args, opts) => new Promise((resolve, reject) => {
    seen = opts.signal;
    fs.writeFileSync(args[args.length - 1], 'half');
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const p = extractPoster({ ffmpeg: 'ffmpeg', mp4: path.join(dir, 'chapter.mp4'), out: path.join(dir, 'poster.jpg'), atS: 1, exec, signal: ctl.signal });
  await new Promise((r) => setImmediate(r));
  assert.equal(seen, ctl.signal);
  ctl.abort();
  await assert.rejects(p, /aborted/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('beforeCommit returning false discards the frame: no poster, no temp file, resolves false', async (t) => {
  const dir = tempDir(t);
  const out = path.join(dir, 'poster.jpg');
  fs.writeFileSync(out, 'OLD');
  const done = await extractPoster({ ffmpeg: 'ffmpeg', mp4: path.join(dir, 'chapter.mp4'), out, atS: 1, exec: fakeExec([]), beforeCommit: () => false });
  assert.equal(done, false);
  assert.deepEqual(fs.readdirSync(dir), ['poster.jpg']);
  assert.equal(fs.readFileSync(out, 'utf8'), 'OLD');
});
