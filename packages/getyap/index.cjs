#!/usr/bin/env node
'use strict';
// npx getyap: the real machine for lib.cjs. Programs run with an argument list (never a shell string); the setup
// install streams its progress straight to this terminal.
const { spawn } = require('node:child_process');
const os = require('node:os');
const readline = require('node:readline');
const { main } = require('./lib.cjs');

// Runs a program and collects its output; a program that cannot start comes back as code -1.
function run(cmd, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// Runs a program with its output shown live; resolves with its exit code.
function runLive(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code === null ? 1 : code));
  });
}

// Asks one question on the terminal.
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

main({
  run, runLive, ask,
  argv: process.argv.slice(2), env: process.env, home: os.homedir(), nodeVersion: process.version,
  isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  log: (s) => process.stdout.write(`${s}\n`), warn: (s) => process.stderr.write(`${s}\n`),
}).then((code) => { process.exitCode = code; }, (err) => {
  process.stderr.write(`getyap: ${err && err.message ? err.message : err}\n`);
  process.exitCode = 1;
});
