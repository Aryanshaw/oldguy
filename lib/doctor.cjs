'use strict';
// The doctor: checks that every tool yap needs is present and says exactly how to fix what is not.
// Every outside call (running programs, files, environment, machine facts) is passed in, so tests run nothing real.
const path = require('node:path');
const realFs = require('node:fs');
const { renderCap } = require('./render-schedule.cjs');

const GB = 1024 ** 3;
const MIN_NODE_MAJOR = 22;
const MIN_MODEL_BYTES = 300e6;
const MIN_FREE_DISK_GB = 1;
const SLOW_MS = 120000;
const QUICK_MS = 15000;

// Builds one check result in the fixed shape the rest of yap (and --json) relies on.
function result(name, ok, required, detail, fix = '') {
  return { name, ok, required, detail, fix: ok ? '' : fix };
}

// Runs a program and never throws: a program that cannot start comes back as code -1 with the reason in stderr.
async function run(exec, cmd, args, timeout) {
  try {
    return await exec(cmd, args, { timeout });
  } catch (err) {
    return { code: -1, stdout: '', stderr: String(err && err.message ? err.message : err) };
  }
}

// Node must be new enough for the rest of yap.
function checkNode(nodeVersion) {
  const major = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  const ok = major >= MIN_NODE_MAJOR;
  return result('Node', ok, true, `Node ${String(nodeVersion).replace(/^v/, '')} (need ${MIN_NODE_MAJOR} or newer)`,
    `install Node ${MIN_NODE_MAJOR} or newer (for example with nvm or brew install node)`);
}

// Fix text for a broken ffmpeg: a missing shared library is the failure we met in Phase 0.
function ffmpegFix(stderr) {
  if (/Library not loaded/.test(stderr)) {
    return 'a library ffmpeg needs is missing: reinstall ffmpeg (brew reinstall ffmpeg), or point '
      + 'HYPERFRAMES_FFMPEG_PATH and HYPERFRAMES_FFPROBE_PATH at a static build of ffmpeg and ffprobe';
  }
  return 'install ffmpeg (brew install ffmpeg), or point HYPERFRAMES_FFMPEG_PATH and HYPERFRAMES_FFPROBE_PATH at a static build';
}

// ffmpeg has to actually run, not just exist on the path.
async function checkFfmpeg(exec, env) {
  const r = await run(exec, env.HYPERFRAMES_FFMPEG_PATH || 'ffmpeg', ['-version'], QUICK_MS);
  const stderr = r.stderr || '';
  // A signal kill or timeout has no exit code, so only a clean exit 0 counts as working.
  if (r.code === 0 && !r.signal && !r.timedOut) return result('ffmpeg', true, true, ((r.stdout || '').split('\n')[0] || 'ffmpeg runs').trim());
  const why = /Library not loaded/.test(stderr) ? 'ffmpeg is installed but a library it needs is missing' : 'ffmpeg does not run';
  const how = r.timedOut ? 'ffmpeg timed out' : r.signal && !stderr.trim() ? `ffmpeg was killed by ${r.signal}` : stderr.trim().split('\n')[0];
  return result('ffmpeg', false, true, `${why}: ${how}`, ffmpegFix(stderr));
}

// Where the venv's python lives inside the data folder; narration hands this to Hyperframes.
function venvPython(dataDir) {
  return path.join(dataDir, 'venv', 'bin', 'python');
}

// Free memory in GB, the number the render cap is worked out from.
function freeRamGb(os) {
  return os.freemem() / GB;
}

// The Python venv under the data folder must exist and import the two packages Kokoro needs.
async function checkVenv({ exec, fs, dataDir }) {
  const venv = path.join(dataDir, 'venv');
  const python = venvPython(dataDir);
  const fix = `python3 -m venv ${venv} && ${path.join(venv, 'bin', 'pip')} install kokoro-onnx soundfile`;
  if (!fs.existsSync(python)) return result('Python venv', false, true, `no venv at ${venv}`, fix);
  const r = await run(exec, python, ['-c', 'import kokoro_onnx, soundfile'], QUICK_MS);
  return r.code === 0
    ? result('Python venv', true, true, `${venv} imports kokoro_onnx and soundfile`)
    : result('Python venv', false, true, `${venv} cannot import kokoro_onnx and soundfile`, fix);
}

// The Kokoro voice model must be downloaded in full (a partial file is far smaller than 300 MB).
function checkModel({ fs, os }) {
  const file = path.join(os.homedir(), '.cache', 'hyperframes', 'tts', 'models', 'kokoro-v1.0.onnx');
  const fix = 'generate any narration once with `hyperframes tts` to download the Kokoro model, then re-run yap doctor';
  if (!fs.existsSync(file)) return result('Kokoro model', false, true, `not found at ${file}`, fix);
  const mb = Math.round(fs.statSync(file).size / 1e6);
  const ok = mb * 1e6 >= MIN_MODEL_BYTES;
  return result('Kokoro model', ok, true, `${mb} MB at ${file} (need over 300 MB)`, `${fix} (the file looks cut short, delete it first)`);
}

// Rendering caches grow to about 1 GB, so refuse to start with less than that free.
function checkDisk({ fs, os }) {
  const s = fs.statfsSync(os.homedir());
  const gb = (s.bavail * s.bsize) / GB;
  return result('Free disk', gb >= MIN_FREE_DISK_GB, true, `${gb.toFixed(1)} GB free (need ${MIN_FREE_DISK_GB} GB)`,
    'free up disk space; Hyperframes caches and renders need at least 1 GB');
}

// whisper-cli only improves captions, so its absence is a note, never a failure.
async function checkWhisper(exec) {
  const r = await run(exec, 'whisper-cli', ['--help'], QUICK_MS);
  return result('whisper-cli', r.code === 0, false, r.code === 0 ? 'found on PATH' : 'not on PATH (captions will be sentence-level)',
    'optional: brew install whisper-cpp for word-level captions');
}

// Free memory decides how many chapters render at once; this only reports the number.
function checkRam({ os }) {
  const gb = freeRamGb(os);
  return result('Free RAM', true, false, `${gb.toFixed(1)} GB free, so ${renderCap(gb)} at a time`);
}

// Asks Hyperframes itself and keeps only its Chrome verdict; Chrome can also be fetched later, so it is advisory.
async function checkChrome(exec) {
  const fix = 'run `hyperframes browser ensure` to download a Chrome for rendering';
  const r = await run(exec, 'hyperframes', ['doctor', '--json'], SLOW_MS);
  let chrome;
  try {
    chrome = (JSON.parse(r.stdout).checks || []).find((c) => /chrome/i.test(String(c.name)));
  } catch {
    return result('Chrome', false, false, 'could not read the Hyperframes doctor output', fix);
  }
  if (!chrome) return result('Chrome', false, false, 'Hyperframes doctor did not report a Chrome check', fix);
  return result('Chrome', chrome.ok === true, false, String(chrome.detail || (chrome.ok ? 'found' : 'missing')), fix);
}

// Runs every check and returns the list of results; required ones decide whether yap can run at all.
async function runDoctor({ exec, fs, env, os, nodeVersion, dataDir }) {
  return [
    checkNode(nodeVersion),
    await checkFfmpeg(exec, env),
    await checkVenv({ exec, fs, dataDir }),
    checkModel({ fs, os }),
    checkDisk({ fs, os }),
    await checkWhisper(exec),
    checkRam({ os }),
    await checkChrome(exec),
  ];
}

// Records that the doctor passed, so the session-start hint can stop nagging.
function writeMarker(dataDir, fs = realFs) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'doctor-ok'), `${new Date().toISOString()}\n`);
}

module.exports = { runDoctor, writeMarker, venvPython, freeRamGb, checkWhisper };
