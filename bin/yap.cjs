#!/usr/bin/env node
// yap CLI entry point: looks the command up in a table and runs it.

const { runAudit } = require('../lib/audit-cli.cjs');
const { runPadWav } = require('../lib/wav-cli.cjs');
const { runBeats } = require('../lib/beats-cli.cjs');
const { runCaptions } = require('../lib/captions-cli.cjs');
const { runDoctorCli } = require('../lib/doctor-cli.cjs');

// Stand-in for commands built in later tasks; swap a row's run to implement it.
function notImplemented(name) {
  return () => {
    process.stderr.write(`yap ${name}: not implemented yet\n`);
    return 3;
  };
}

// One row per command; later tasks only replace a row's run function.
const COMMANDS = {
  doctor: { summary: 'check that the tools yap needs are installed', run: runDoctorCli },
  audit: { summary: 'check that every claim in a chapter points at real code', run: runAudit },
  beats: { summary: 'split narration into timed beats', run: runBeats },
  captions: { summary: 'build captions from a transcript', run: runCaptions },
  'pad-wav': { summary: 'add silence to the start and end of a narration wav', run: runPadWav },
  scaffold: { summary: 'create a new video project folder', run: notImplemented('scaffold') },
  render: { summary: 'render the video project to mp4', run: notImplemented('render') },
  narrate: { summary: 'turn the script into narration audio', run: notImplemented('narrate') },
};

// Prints each command name with its one-line summary.
function printHelp() {
  const lines = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(10)} ${c.summary}`);
  process.stdout.write(`usage: yap <command> [args]\n\ncommands:\n${lines.join('\n')}\n`);
}

// Runs the requested command (waiting if it is async) and returns the exit code.
async function main(argv) {
  const [name] = argv;
  if (name === undefined || name === '--help' || name === '-h') {
    printHelp();
    return 0;
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
  if (!command) {
    process.stderr.write(`usage: yap <${Object.keys(COMMANDS).join('|')}> (try --help)\n`);
    return 2;
  }
  return (await command.run(argv.slice(1))) ?? 0;
}

// A command that crashes or rejects must not look like success.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`yap: ${err && err.message ? err.message : err}\n`);
    process.exitCode = 2;
  },
);
