'use strict';
// The SessionEnd hook. Plain JavaScript on purpose, like hooks/session-start.cjs: an old Node says so in one line here,
// and the hook still ends quietly with exit 0. The real work is in hooks/session-end.mts.
const { nodeProblem } = require('../lib/node-floor.cjs');

const problem = nodeProblem(process.versions.node, __dirname);
if (problem) {
  process.stderr.write(`yap: ${problem}\n`);
  process.exit(0);
} else {
  import('./session-end.mts').catch(() => process.exit(0));
}
