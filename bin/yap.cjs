#!/usr/bin/env node
// yap CLI entry point: looks the command up in a table and runs it.

// Stand-in for commands built in later tasks; swap a row's run to implement it.
function notImplemented(name) {
  return () => {
    process.stderr.write(`yap ${name}: not implemented yet\n`);
    return 3;
  };
}

// One row per command; later tasks only replace a row's run function.
const COMMANDS = {
  doctor: { summary: 'check that the tools yap needs are installed', run: notImplemented('doctor') },
  audit: { summary: 'check a video project against the house rules', run: notImplemented('audit') },
  beats: { summary: 'split narration into timed beats', run: notImplemented('beats') },
  captions: { summary: 'build captions from a transcript', run: notImplemented('captions') },
  'pad-wav': { summary: 'add silence to the end of a narration wav', run: notImplemented('pad-wav') },
  scaffold: { summary: 'create a new video project folder', run: notImplemented('scaffold') },
  render: { summary: 'render the video project to mp4', run: notImplemented('render') },
  narrate: { summary: 'turn the script into narration audio', run: notImplemented('narrate') },
};

// Prints each command name with its one-line summary.
function printHelp() {
  const lines = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(10)} ${c.summary}`);
  process.stdout.write(`usage: yap <command> [args]\n\ncommands:\n${lines.join('\n')}\n`);
}

// Runs the requested command and returns the exit code.
function main(argv) {
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
  return command.run(argv.slice(1)) ?? 0;
}

process.exitCode = main(process.argv.slice(2));
