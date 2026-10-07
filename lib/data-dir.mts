// Finds the plugin data folder (where the Python venv and the doctor's pass marker live). Claude Code gives the
// SessionStart hook CLAUDE_PLUGIN_DATA but not Claude's own shell, so the hook writes it into .oldguy/session.json
// and every oldguy command reads it back from there. The hook, the doctor and narrate all use this one rule.
// A session file sits in the project tree, which may hold anyone's files, so a folder read from it is trusted only
// inside Claude Code's own plugin data root: it decides which Python runs.
import path from 'node:path';
import os from 'node:os';

// The environment variables the rules read (process.env has this shape).
type Env = Record<string, string | undefined>;

// The only file-system call the session file lookup needs; tests hand in a fake one.
type FileReader = { readFileSync: (file: string, encoding: 'utf8') => string };

// What decides which folders are trusted: the environment and the home folder.
type Trust = { env?: Env; homedir?: string };

// What resolveDataDir takes: the --data-dir flag, the environment, the working folder, the file reader and the home folder.
type DataDirInput = { flag?: string; env?: Env; cwd?: string; fs: FileReader; homedir?: string };

// Where Claude Code keeps plugin data folders: <config dir>/plugins/data, the config dir being an absolute
// CLAUDE_CONFIG_DIR or else <home>/.claude.
function pluginDataRoot(env: Env | undefined, homedir: string): string {
  const config = env && typeof env.CLAUDE_CONFIG_DIR === 'string' && path.isAbsolute(env.CLAUDE_CONFIG_DIR)
    ? env.CLAUDE_CONFIG_DIR : path.join(homedir, '.claude');
  return path.join(config, 'plugins', 'data');
}

// Returns the folder when it is an absolute, already-normalised path strictly inside the plugin data root, else null.
function trustedDataDir(dir: unknown, { env, homedir = os.homedir() }: Trust): string | null {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null;
  // a ".." or "." segment, a doubled or trailing slash would let the text say one place and mean another
  if (path.normalize(dir) !== dir || dir.endsWith(path.sep)) return null;
  const rel = path.relative(pluginDataRoot(env, homedir), dir);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) ? dir : null;
}

// Reads data_dir from one session.json; anything unreadable, not JSON, or not a trusted folder counts as absent.
function sessionDataDir(file: string, fs: FileReader, trust: Trust): string | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return trustedDataDir(typeof value === 'object' && value !== null && 'data_dir' in value ? value.data_dir : undefined, trust);
  } catch {
    return null;
  }
}

// Walks up from cwd to the filesystem root and returns the first trusted data_dir in a .oldguy/session.json, or null.
function nearestSessionDataDir(cwd: string, fs: FileReader, trust: Trust): string | null {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    const found = sessionDataDir(path.join(dir, '.oldguy', 'session.json'), fs, trust);
    if (found) return found;
    if (path.dirname(dir) === dir) return null;
  }
}

// Picks the data folder: --data-dir, then a non-empty CLAUDE_PLUGIN_DATA (both set by the user or Claude Code, so
// taken as given), then a trusted folder from the session file, then <cwd>/.oldguy.
// Returns null when none of those apply and cwd is not an absolute path (no folder can be trusted).
function resolveDataDir({ flag, env, cwd, fs, homedir = os.homedir() }: DataDirInput): string | null {
  if (flag) return flag;
  if (env && env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  return nearestSessionDataDir(cwd, fs, { env, homedir }) || path.join(cwd, '.oldguy');
}

export { resolveDataDir, trustedDataDir };
export type { Env, FileReader, Trust, DataDirInput };
