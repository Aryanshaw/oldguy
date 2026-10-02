'use strict';
// Finds the plugin data folder (where the Python venv and the doctor's pass marker live). Claude Code gives the
// SessionStart hook CLAUDE_PLUGIN_DATA but not Claude's own shell, so the hook writes it into .yap/session.json
// and every yap command reads it back from there. The hook, the doctor and narrate all use this one rule.
// A session file sits in the project tree, which may hold anyone's files, so a folder read from it is trusted only
// inside Claude Code's own plugin data root: it decides which Python runs.
const path = require('node:path');
const os = require('node:os');

// Where Claude Code keeps plugin data folders: <config dir>/plugins/data, the config dir being an absolute
// CLAUDE_CONFIG_DIR or else <home>/.claude.
function pluginDataRoot(env, homedir) {
  const config = env && typeof env.CLAUDE_CONFIG_DIR === 'string' && path.isAbsolute(env.CLAUDE_CONFIG_DIR)
    ? env.CLAUDE_CONFIG_DIR : path.join(homedir, '.claude');
  return path.join(config, 'plugins', 'data');
}

// Returns the folder when it is an absolute, already-normalised path strictly inside the plugin data root, else null.
function trustedDataDir(dir, { env, homedir = os.homedir() }) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null;
  // a ".." or "." segment, a doubled or trailing slash would let the text say one place and mean another
  if (path.normalize(dir) !== dir || dir.endsWith(path.sep)) return null;
  const rel = path.relative(pluginDataRoot(env, homedir), dir);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) ? dir : null;
}

// Reads data_dir from one session.json; anything unreadable, not JSON, or not a trusted folder counts as absent.
function sessionDataDir(file, fs, trust) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return trustedDataDir(value && value.data_dir, trust);
  } catch {
    return null;
  }
}

// Walks up from cwd to the filesystem root and returns the first trusted data_dir in a .yap/session.json, or null.
function nearestSessionDataDir(cwd, fs, trust) {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    const found = sessionDataDir(path.join(dir, '.yap', 'session.json'), fs, trust);
    if (found) return found;
    if (path.dirname(dir) === dir) return null;
  }
}

// Picks the data folder: --data-dir, then a non-empty CLAUDE_PLUGIN_DATA (both set by the user or Claude Code, so
// taken as given), then a trusted folder from the session file, then <cwd>/.yap.
// Returns null when none of those apply and cwd is not an absolute path (no folder can be trusted).
function resolveDataDir({ flag, env, cwd, fs, homedir = os.homedir() }) {
  if (flag) return flag;
  if (env && env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  return nearestSessionDataDir(cwd, fs, { env, homedir }) || path.join(cwd, '.yap');
}

module.exports = { resolveDataDir, trustedDataDir };
