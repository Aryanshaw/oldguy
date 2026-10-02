'use strict';
// Finds the plugin data folder (where the Python venv and the doctor's pass marker live). Claude Code gives the
// SessionStart hook CLAUDE_PLUGIN_DATA but not Claude's own shell, so the hook writes it into .yap/session.json
// and every yap command reads it back from there. The hook, the doctor and narrate all use this one rule.
const path = require('node:path');

// Reads data_dir from one session.json; anything unreadable, not JSON, or not an absolute path counts as absent.
function sessionDataDir(file, fs) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const dir = value && value.data_dir;
    return typeof dir === 'string' && path.isAbsolute(dir) ? dir : null;
  } catch {
    return null;
  }
}

// Walks up from cwd to the filesystem root and returns the first usable data_dir in a .yap/session.json, or null.
function nearestSessionDataDir(cwd, fs) {
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    const found = sessionDataDir(path.join(dir, '.yap', 'session.json'), fs);
    if (found) return found;
    if (path.dirname(dir) === dir) return null;
  }
}

// Picks the data folder: --data-dir, then a non-empty CLAUDE_PLUGIN_DATA, then the session file, then <cwd>/.yap.
// Returns null when none of those apply and cwd is not an absolute path (no folder can be trusted).
function resolveDataDir({ flag, env, cwd, fs }) {
  if (flag) return flag;
  if (env && env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  return nearestSessionDataDir(cwd, fs) || path.join(cwd, '.yap');
}

module.exports = { resolveDataDir };
