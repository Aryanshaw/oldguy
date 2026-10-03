#!/usr/bin/env node
// yap CLI entry point: looks the command up in a table and runs it.

const { runAudit } = require('../cli/audit.cjs');
const { runPadWav } = require('../cli/wav.cjs');
const { runBeats } = require('../cli/beats.cjs');
const { runCaptions } = require('../cli/captions.cjs');
const { runDoctorCli } = require('../cli/doctor.cjs');
const { runScaffold } = require('../cli/scaffold.cjs');
const { runNarrate } = require('../cli/narrate.cjs');
const { runRender } = require('../cli/render.cjs');
const { runServe } = require('../cli/server.cjs');
const { runReply, runAddChapter, runSetStatus, runOrder } = require('../cli/client.cjs');

// One row per command.
const COMMANDS = {
  doctor: { summary: 'check that the tools yap needs are installed', run: runDoctorCli },
  audit: { summary: 'check that every claim in a chapter points at real code', run: runAudit },
  beats: { summary: 'split narration into timed beats', run: runBeats },
  captions: { summary: 'build captions from a transcript', run: runCaptions },
  'pad-wav': { summary: 'add silence to the start and end of a narration wav', run: runPadWav },
  scaffold: { summary: 'create a chapter folder from a spec (yap scaffold --help)', run: runScaffold },
  render: { summary: 'audit every chapter, then render the ones that pass to mp4', run: runRender },
  narrate: { summary: 'make a chapter\'s narration audio, beats, captions and page', run: runNarrate },
  serve: { summary: 'start the local video player server (--detach to run in the background)', run: runServe },
  reply: { summary: 'answer the viewer in the player chat (--in-reply-to, --text, --source)', run: runReply },
  'add-chapter': { summary: 'add a chapter to the story (--id, --after, --title, --parent, --reason)', run: runAddChapter },
  'set-status': { summary: 'set a chapter\'s status (--id, --status)', run: runSetStatus },
  order: { summary: 'write the story order (and move chapters on a running page): yap order <id,id,...>', run: runOrder },
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
