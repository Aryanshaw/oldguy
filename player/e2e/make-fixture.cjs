'use strict';
// Builds a throwaway slug folder for the end-to-end test and starts the real server on it.
//   node e2e/make-fixture.cjs        prints the keyed URL and the temp folder, then keeps serving until Ctrl-C
// As a module: `await startFixture()` resolves { url, key, port, tmp, slugDir, stop() }; stop() closes the server and removes the folder.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { buildRecord, sha256 } = require('../../lib/build-record.cjs');
const { startServer } = require('../../server/server.cjs');

const CHAPTERS = [
  { id: 'one-intro', title: 'One intro', hz: 330 },
  { id: 'two-middle', title: 'Two middle', hz: 550 },
  { id: 'three-end', title: 'Three end', hz: 880 },
];
const RENDERING_ID = 'four-rendering';
const SECONDS = 3;

// The ffmpeg to run: HYPERFRAMES_FFMPEG_PATH, else the one on the path, else null.
function findTool(name, envName) {
  for (const bin of [process.env[envName], name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) {
    if (bin && spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0) return bin;
  }
  return null;
}

// Makes a 3 s H.264 + AAC clip: test pattern plus a sine tone, moov atom first, a keyframe every 0.5 s.
function makeClip(ffmpeg, out, hz) {
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25',
    '-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000`,
    '-t', String(SECONDS), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '12', '-c:a', 'aac', '-movflags', '+faststart', out,
  ]);
}

// Makes the narration wav the build record fingerprints: 16-bit PCM, 24 kHz mono.
function makeWav(ffmpeg, out) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=24000', '-t', String(SECONDS), '-ac', '1', '-c:a', 'pcm_s16le', out]);
}

// Writes one ready chapter folder: clip, text files, build.json and the render.json that names it.
function writeChapter(ffmpeg, slugDir, spec) {
  const dir = path.join(slugDir, 'chapters', spec.id);
  fs.mkdirSync(dir, { recursive: true });
  makeClip(ffmpeg, path.join(dir, 'chapter.mp4'), spec.hz);
  makeWav(ffmpeg, path.join(dir, 'narration.wav'));
  const text = `${spec.title} caption line.`;
  const chapter = {
    id: spec.id, title: spec.title,
    sources: [
      { id: 's1', file: `src/${spec.id}.js`, lines: [10, 12], quote: 'function start() {' },
      { id: 's2', file: 'src/util.js', lines: [3, 4], quote: 'export const x' },
    ],
    sentences: [{ text, kind: 'claim', source_ids: ['s1', 's2'] }],
    scene: [{ piece: 'title-card', params: { title: spec.title }, beat: 0 }],
  };
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), data);
  write('chapter.json', `${JSON.stringify(chapter, null, 2)}\n`);
  write('narration.txt', `${text}\n`);
  write('beats.json', `${JSON.stringify({ timing: 'sentence-share', durationS: SECONDS, beats: [{ text, start: 0, end: SECONDS }] }, null, 2)}\n`);
  write('captions.vtt', `WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n${text}\n`);
  write('captions.json', `${JSON.stringify(text.split(' ').map((w, i, a) => ({ text: w, start: (i * SECONDS) / a.length, end: ((i + 1) * SECONDS) / a.length })))}\n`);
  write('index.html', `<!doctype html><html><body><div data-composition-id="${spec.id}" data-duration="${SECONDS}">${spec.title}</div></body></html>\n`);
  write('build.json', `${JSON.stringify(buildRecord(chapter, (name) => fs.readFileSync(path.join(dir, name)), null), null, 2)}\n`);
  write('render.json', `${JSON.stringify({ build_sha256: sha256(fs.readFileSync(path.join(dir, 'build.json'))) })}\n`);
}

// Builds the folder and starts the server. Throws the line `ffmpeg is needed for the end-to-end test` when ffmpeg is missing.
async function startFixture() {
  const ffmpeg = findTool('ffmpeg', 'HYPERFRAMES_FFMPEG_PATH');
  if (!ffmpeg) throw new Error('ffmpeg is needed for the end-to-end test');
  process.env.HYPERFRAMES_FFMPEG_PATH = ffmpeg; // the server's poster and export steps use it
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-e2e-'));
  let srv = null;
  try {
    const slugDir = path.join(tmp, 'proj', '.yap', 'demo');
    fs.mkdirSync(path.join(slugDir, 'chapters'), { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'script.md'), '# Demo\n\nA synthetic script for the end-to-end test.\n');
    fs.writeFileSync(path.join(slugDir, 'sources.json'), '[]\n');
    fs.writeFileSync(path.join(slugDir, 'order.json'), `${JSON.stringify({ chapters: [...CHAPTERS.map((c) => c.id), RENDERING_ID] })}\n`);
    for (const spec of CHAPTERS) writeChapter(ffmpeg, slugDir, spec);
    fs.mkdirSync(path.join(slugDir, 'chapters', RENDERING_ID, 'work-x'), { recursive: true });
    srv = await startServer({ slugDir });
    let stopped = false;
    const stop = async () => {
      if (!stopped) {
        stopped = true;
        try { await srv.close(); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      }
    };
    return { url: srv.url, key: srv.key, port: srv.port, tmp, slugDir, chapters: CHAPTERS, stopServer: () => srv.close(), stop };
  } catch (e) {
    if (srv) await srv.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

module.exports = { startFixture, CHAPTERS, RENDERING_ID, SECONDS };

if (require.main === module) {
  startFixture().then((f) => {
    console.log(f.url);
    console.log(`folder: ${f.tmp}`);
    const bye = () => f.stop().finally(() => process.exit(0));
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
