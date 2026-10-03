'use strict';
// The oldest Node yap runs on: 22.18 is the first release that runs TypeScript files with no flag.
// This file stays plain JavaScript so any Node, however old, can load it and say why yap cannot run.
const NODE_FLOOR = '22.18.0';

// Splits "N.N.N" into three whole numbers; anything else (a prefix, a suffix, missing parts) gives null.
function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

// True when version is the floor or newer, comparing major, then minor, then patch as numbers.
function atLeastFloor(parts) {
  const floor = versionParts(NODE_FLOOR);
  for (let i = 0; i < 3; i += 1) {
    if (parts[i] !== floor[i]) return parts[i] > floor[i];
  }
  return true;
}

// One plain sentence when yap cannot run here, or null when all is well. Never throws.
// A version that is not N.N.N is a problem, never "new enough".
function nodeProblem(version, dir) {
  if (/[\\/]node_modules[\\/]/.test(String(dir))) {
    return 'Yap cannot run from inside a node_modules folder (Node does not read TypeScript there). Install it as a Claude Code plugin instead.';
  }
  const parts = versionParts(version);
  if (parts && atLeastFloor(parts)) return null;
  // the version is shown on one line even if it was garbage with line breaks in it
  const shown = String(version).replace(/\s+/g, ' ');
  return `Yap needs Node 22.18 or newer; this is Node ${shown}. Install a newer Node from https://nodejs.org and run it again.`;
}

module.exports = { nodeProblem, NODE_FLOOR };
