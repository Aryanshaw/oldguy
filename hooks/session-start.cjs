'use strict';
// SessionStart hook: remembers which Claude Code session this folder is in, and nudges the user to run
// `/yap doctor` until it has passed once. It must never break a session, so every path ends in exit 0.
const fs = require('node:fs');
const path = require('node:path');

const READ_LIMIT_MS = 500;

// Reads all of stdin, but gives up after a short wait so a pipe that never closes cannot hang the session.
function readStdin() {
  return new Promise((resolve) => {
    let text = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(text);
    };
    const timer = setTimeout(finish, READ_LIMIT_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { text += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });
}

// Turns the stdin text into a plain object, or null when it is not a JSON object.
function parseInput(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Writes the session file through a temp file and a rename, so a reader never sees half a file.
function writeSessionFile(cwd, input) {
  const dir = path.join(cwd, '.yap');
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd,
    source: input.source,
    updated_at: new Date().toISOString(),
  };
  const temp = path.join(dir, `session.json.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
    fs.renameSync(temp, path.join(dir, 'session.json'));
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

// Works out where the doctor's pass marker lives (same rule as the doctor); null when no folder can be trusted.
function resolveDataDir(cwd) {
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA;
  return typeof cwd === 'string' && path.isAbsolute(cwd) ? path.join(cwd, '.yap') : null;
}

// Prints the one-line hint when `yap doctor` has not left its pass marker in the data folder.
function hintIfDoctorNotRun(dataDir) {
  if (dataDir && !fs.existsSync(path.join(dataDir, 'doctor-ok'))) {
    process.stdout.write('yap: run /yap doctor once to check this machine can make videos.\n');
  }
}

// Records the session when the input is usable; only an absolute cwd is trusted as a write target.
function recordSession(input) {
  if (typeof input.session_id !== 'string' || input.session_id === '') return;
  if (typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd)) return;
  try {
    writeSessionFile(input.cwd, input);
  } catch {
    // An unwritable folder must not stop the session or the hint.
  }
}

// Does the hook's work; the caller turns any failure into a quiet exit 0.
async function main() {
  const input = parseInput(await readStdin());
  if (input) recordSession(input);
  hintIfDoctorNotRun(resolveDataDir(input && input.cwd));
}

main().catch(() => {}).finally(() => process.exit(0));
