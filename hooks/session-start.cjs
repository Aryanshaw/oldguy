'use strict';
// The SessionStart hook. Plain JavaScript on purpose, like bin/oldguy.cjs: an old Node says so in one line here, and the hook
// still ends quietly with exit 0 (a session must start whatever happens). The real work is in hooks/session-start.mts.
const { nodeProblem } = require('../lib/node-floor.cjs');

const problem = nodeProblem(process.versions.node, __dirname);
if (problem) {
  process.stderr.write(`oldguy: ${problem}\n`);
  process.exit(0);
} else {
  import('./session-start.mts').catch(() => process.exit(0));
}
