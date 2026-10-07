// SessionStart hook: remembers which Claude Code session this folder is in, and nudges the user to run
// `/yap doctor` until it has passed once. It must never break a session, so every path ends in exit 0.
import fs from 'node:fs';
import path from 'node:path';

const READ_LIMIT_MS = 500;

// The JSON Claude Code sends the hook on stdin (any field may be missing or of another type).
type HookInput = Record<string, unknown>;

// Reads all of stdin, but gives up after a short wait so a pipe that never closes cannot hang the session.
function readStdin(): Promise<string> {
  return new Promise<string>((resolve) => {
    let text = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(text);
    };
    const timer = setTimeout(finish, READ_LIMIT_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => { text += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });
}

// Turns the stdin text into a plain object, or null when it is not a JSON object.
function parseInput(text: string): HookInput | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as HookInput) : null;
  } catch {
    return null;
  }
}

// Writes the session file through a temp file and a rename, so a reader never sees half a file.
async function writeSessionFile(cwd: string, input: HookInput): Promise<void> {
  // loaded here, not at the top, so even a missing library file ends in the quiet exit 0
  const { trustedDataDir } = await import('../lib/data-dir.mts');
  const { findClaudePid } = await import('../lib/owner.mts');
  const dir = path.join(cwd, '.yap');
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd,
    source: input.source,
    // the Claude Code process this session runs in; yap serve stops when it is gone (null when none was found)
    claude_pid: findClaudePid(process.ppid),
    // Claude's own shell does not get CLAUDE_PLUGIN_DATA, so yap commands read the data folder from here;
    // only a folder inside Claude Code's plugin data root is recorded, since readers trust nothing else
    data_dir: trustedDataDir(process.env.CLAUDE_PLUGIN_DATA || null, { env: process.env }),
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

// Prints the one-line hint when `yap doctor` has not left its pass marker in the data folder.
function hintIfDoctorNotRun(dataDir: string | null): void {
  if (dataDir && !fs.existsSync(path.join(dataDir, 'doctor-ok'))) {
    process.stdout.write('yap: run /yap doctor once to check this machine can make videos.\n');
  }
}

// Records the session when the input is usable; only an absolute cwd is trusted as a write target.
async function recordSession(input: HookInput): Promise<void> {
  if (typeof input.session_id !== 'string' || input.session_id === '') return;
  if (typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd)) return;
  try {
    await writeSessionFile(input.cwd, input);
  } catch {
    // An unwritable folder must not stop the session or the hint.
  }
}

// Does the hook's work; the caller turns any failure into a quiet exit 0.
async function main(): Promise<void> {
  const input = parseInput(await readStdin());
  if (input) await recordSession(input);
  // loaded here, not at the top, so even a missing library file ends in the quiet exit 0 below
  const { resolveDataDir } = await import('../lib/data-dir.mts');
  // the marker is looked for exactly where the doctor writes it; null when no folder can be trusted
  const cwd = input && typeof input.cwd === 'string' ? input.cwd : undefined;
  hintIfDoctorNotRun(resolveDataDir({ env: process.env, cwd, fs }));
}

main().catch(() => {}).finally(() => process.exit(0));
