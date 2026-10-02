const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseWav, padWav } = require('../lib/wav.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'yap.cjs');
const FIXTURE = path.join(__dirname, 'fixtures', 'narration.wav');

// Builds a "fmt " chunk for the given format fields.
function fmtChunk({ tag = 1, channels = 1, sampleRate = 24000, bits = 16 } = {}) {
  const b = Buffer.alloc(24);
  b.write('fmt ', 0, 'latin1');
  b.writeUInt32LE(16, 4);
  b.writeUInt16LE(tag, 8);
  b.writeUInt16LE(channels, 10);
  b.writeUInt32LE(sampleRate, 12);
  b.writeUInt32LE(sampleRate * channels * (bits / 8), 16);
  b.writeUInt16LE(channels * (bits / 8), 20);
  b.writeUInt16LE(bits, 22);
  return b;
}

// Builds a chunk with an id, a body and the odd-size pad byte when needed.
function chunk(id, body) {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body, Buffer.alloc(body.length % 2)]);
}

// Wraps chunks into a full RIFF/WAVE file.
function riff(...chunks) {
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), ...chunks]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

// Makes a 16-bit PCM WAV whose samples are a repeating non-zero byte pattern.
function makeWav({ channels = 1, sampleRate = 24000, frames = 100, extra = [] } = {}) {
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < data.length; i++) data[i] = (i % 250) + 1;
  return { wav: riff(fmtChunk({ channels, sampleRate }), ...extra, chunk('data', data)), data };
}

test('fixture narration.wav is 16-bit PCM mono 24 kHz, 9.301 s', () => {
  const info = parseWav(fs.readFileSync(FIXTURE));
  assert.deepEqual(info.format, { channels: 1, sampleRate: 24000, bitsPerSample: 16 });
  assert.ok(Math.abs(info.durationS - 9.301) <= 0.002, String(info.durationS));
});

test('padWav adds lead+tail duration and keeps the original samples in the middle', () => {
  const buf = fs.readFileSync(FIXTURE);
  const before = parseWav(buf);
  const out = padWav(buf, { leadMs: 40, tailMs: 120 });
  const after = parseWav(out);
  assert.ok(Math.abs(after.durationS - before.durationS - 0.16) < 1e-9);
  const lead = 960 * 2;
  const tail = 2880 * 2;
  assert.equal(after.dataLength, before.dataLength + lead + tail);
  const middle = out.subarray(after.dataOffset + lead, after.dataOffset + lead + before.dataLength);
  assert.ok(middle.equals(buf.subarray(before.dataOffset, before.dataOffset + before.dataLength)));
  assert.ok(out.subarray(after.dataOffset, after.dataOffset + lead).every((x) => x === 0));
  assert.ok(out.subarray(out.length - tail).every((x) => x === 0));
  assert.equal(out.readUInt32LE(4), out.length - 8);
});

test('padWav handles a LIST chunk before data (odd size, with pad byte)', () => {
  const { wav, data } = makeWav({ extra: [chunk('LIST', Buffer.from('INFOabc'))] });
  const out = padWav(wav, { leadMs: 40, tailMs: 120 });
  const info = parseWav(out);
  assert.equal(info.dataLength, data.length + 1920 + 5760);
  assert.ok(out.subarray(info.dataOffset + 1920, info.dataOffset + 1920 + data.length).equals(data));
  assert.equal(out.readUInt32LE(4), out.length - 8);
});

test('padWav keeps chunks that come after data and still parses', () => {
  const { data } = makeWav();
  const wav = riff(fmtChunk(), chunk('data', data), chunk('LIST', Buffer.from('tail!')));
  const out = padWav(wav, { leadMs: 40, tailMs: 0 });
  assert.equal(parseWav(out).dataLength, data.length + 1920);
  assert.equal(out.readUInt32LE(4), out.length - 8);
  assert.equal(out.subarray(out.length - 14).toString('latin1', 0, 4), 'LIST');
});

test('padWav on stereo 44.1 kHz pads whole frames', () => {
  const { wav, data } = makeWav({ channels: 2, sampleRate: 44100, frames: 50 });
  const out = padWav(wav, { leadMs: 40, tailMs: 120 });
  const info = parseWav(out);
  const lead = Math.round(44100 * 0.04) * 4;
  const tail = Math.round(44100 * 0.12) * 4;
  assert.equal(info.dataLength, data.length + lead + tail);
  assert.ok(out.subarray(info.dataOffset + lead, info.dataOffset + lead + data.length).equals(data));
});

test('an empty data chunk is valid with duration 0', () => {
  const info = parseWav(riff(fmtChunk(), chunk('data', Buffer.alloc(0))));
  assert.equal(info.dataLength, 0);
  assert.equal(info.durationS, 0);
});

test('8-bit and float WAVs are rejected with a message naming the format', () => {
  const body = chunk('data', Buffer.alloc(8));
  assert.throws(() => parseWav(riff(fmtChunk({ bits: 8 }), body)), /8-bit/);
  assert.throws(() => parseWav(riff(fmtChunk({ tag: 3, bits: 32 }), body)), /format 3/);
});

test('zero channels and zero sample rate are rejected', () => {
  const body = chunk('data', Buffer.alloc(8));
  assert.throws(() => parseWav(riff(fmtChunk({ channels: 0 }), body)), /zero channels/);
  assert.throws(() => parseWav(riff(fmtChunk({ sampleRate: 0 }), body)), /zero sample rate/);
});

test('a data chunk claiming more bytes than the file holds is rejected', () => {
  const { wav } = makeWav();
  assert.throws(() => parseWav(wav.subarray(0, wav.length - 10)), /more audio than the file holds/);
});

test('truncated or non-WAV input is rejected without crashing', () => {
  const { wav } = makeWav();
  for (const n of [0, 4, 11, 20, 36, 40]) {
    assert.throws(() => parseWav(wav.subarray(0, n)), Error, `length ${n}`);
  }
  assert.throws(() => parseWav(Buffer.from('not a wav file at all, just text')), /RIFF/);
  assert.throws(() => parseWav(riff(fmtChunk())), /no data chunk/);
  assert.throws(() => parseWav(riff(chunk('data', Buffer.alloc(4)))), /fmt/);
});

// Runs the pad-wav CLI inside a fresh temp folder, then removes it.
function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-wav-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI pad-wav uses defaults lead 40 and tail 120 and exits 0', () => {
  withTemp((dir) => {
    const out = path.join(dir, 'out.wav');
    const r = spawnSync('node', [CLI, 'pad-wav', FIXTURE, out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const a = parseWav(fs.readFileSync(FIXTURE));
    const b = parseWav(fs.readFileSync(out));
    assert.ok(Math.abs(b.durationS - a.durationS - 0.16) < 1e-9);
  });
});

test('CLI pad-wav honours --lead and --tail', () => {
  withTemp((dir) => {
    const out = path.join(dir, 'out.wav');
    const r = spawnSync('node', [CLI, 'pad-wav', FIXTURE, out, '--lead', '100', '--tail', '0'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const a = parseWav(fs.readFileSync(FIXTURE));
    assert.ok(Math.abs(parseWav(fs.readFileSync(out)).durationS - a.durationS - 0.1) < 1e-9);
  });
});

test('CLI pad-wav errors exit 2 with one stderr line and no stack', () => {
  withTemp((dir) => {
    const bad = path.join(dir, 'bad.wav');
    fs.writeFileSync(bad, 'nope');
    const cases = [
      [],
      [path.join(dir, 'missing.wav'), path.join(dir, 'o.wav')],
      [bad, path.join(dir, 'o.wav')],
      [FIXTURE, path.join(dir, 'o.wav'), '--lead', 'abc'],
      [FIXTURE, path.join(dir, 'o.wav'), '--lead', '-5'],
      [FIXTURE, path.join(dir, 'nodir', 'o.wav')],
    ];
    for (const args of cases) {
      const r = spawnSync('node', [CLI, 'pad-wav', ...args], { encoding: 'utf8' });
      assert.equal(r.status, 2, args.join(' '));
      assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
      assert.doesNotMatch(r.stderr, /\n\s+at /);
    }
  });
});
