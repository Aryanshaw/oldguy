#!/usr/bin/env node
'use strict';
// The yap command. This file is plain JavaScript on purpose: it has to run on any Node, so that an old Node gets one
// clear sentence here instead of a syntax error from the TypeScript in bin/yap.mts, which it loads once the Node is new enough.
const { nodeProblem } = require('../lib/node-floor.cjs');

const problem = nodeProblem(process.versions.node, __dirname);
if (problem) {
  process.stderr.write(`yap: ${problem}\n`);
  process.exitCode = 1;
} else {
  import('./yap.mts').catch((err) => {
    process.stderr.write(`yap: ${err && err.message ? err.message : err}\n`);
    process.exitCode = 1;
  });
}
