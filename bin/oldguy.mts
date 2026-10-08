// oldguy CLI: looks the command up in a table and runs it. bin/oldguy.cjs (plain JavaScript) loads this file once it has
// checked that the Node running it can read TypeScript.

import { runAudit } from '../cli/audit.mts';
import { runPadWav } from '../cli/wav.mts';
import { runBeats } from '../cli/beats.mts';
import { runCaptions } from '../cli/captions.mts';
import { runDoctorCli } from '../cli/doctor.mts';
import { runSetupCli } from '../cli/setup.mts';
import { runScaffold } from '../cli/scaffold.mts';
import { runNarrate } from '../cli/narrate.mts';
import { runRender } from '../cli/render.mts';
import { runServe } from '../cli/server.mts';
import { runListen } from '../cli/listen.mts';
import { runTemplates, runVideo } from '../cli/templates.mts';
import { runRemake } from '../cli/remake.mts';
import { runReply, runAddChapter, runSetStatus, runRemoveChapter, runOrder, runAck } from '../cli/client.mts';

// A command: what `--help` says about it, and the function that runs it (it returns the exit code, or nothing for 0).
type Command = { summary: string; run: (args: string[]) => number | void | Promise<number | void> };

// One row per command.
const COMMANDS: Record<string, Command> = {
  doctor: { summary: 'check that the tools oldguy needs are installed', run: runDoctorCli },
  setup: { summary: 'show what is missing; --install <items> installs only the items you agreed to', run: runSetupCli },
  audit: { summary: 'check that every claim in a chapter points at real code', run: runAudit },
  beats: { summary: 'split narration into timed beats', run: runBeats },
  captions: { summary: 'build captions from a transcript', run: runCaptions },
  'pad-wav': { summary: 'add silence to the start and end of a narration wav', run: runPadWav },
  scaffold: { summary: 'create a chapter folder from a spec (oldguy scaffold --help)', run: runScaffold },
  render: { summary: 'audit every chapter, then render the ones that pass to mp4', run: runRender },
  narrate: { summary: 'make a chapter\'s narration audio, beats, captions and page', run: runNarrate },
  serve: { summary: 'start the local video player server (--detach to run in the background)', run: runServe },
  reply: { summary: 'answer the viewer in the player chat (--in-reply-to, --text, --source, --offer-video)', run: runReply },
  listen: { summary: 'print open viewer questions as they arrive, for Claude Code\'s Monitor (heartbeats the page)', run: runListen },
  ack: { summary: 'mark a viewer event as handled when it gets no text reply: oldguy ack <evt_n>', run: runAck },
  'add-chapter': { summary: 'add a chapter to the story (--id, --after, --title, --parent, --reason, --question)', run: runAddChapter },
  'set-status': { summary: 'set a chapter\'s status (--id, --status)', run: runSetStatus },
  'remove-chapter': { summary: 'take a chapter that will not be made out of the story (--id; delete its folder first)', run: runRemoveChapter },
  templates: { summary: 'list templates; <id> [shape] sets the project default; <id> --show or --fetch', run: runTemplates },
  remake: { summary: 'start a new video folder that tells a video again in another template or shape (--from, --template, --shape)', run: runRemake },
  video: { summary: 'record the template and shape a video folder is made in (--dir, --template, --shape)', run: runVideo },
  order: { summary: 'write the story order (and move chapters on a running page): oldguy order <id,id,...>', run: runOrder },
};

// Prints each command name with its one-line summary.
function printHelp(): void {
  const lines = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(10)} ${c.summary}`);
  process.stdout.write(`usage: oldguy <command> [args]\n\ncommands:\n${lines.join('\n')}\n`);
}

// Runs the requested command (waiting if it is async) and returns the exit code.
async function main(argv: string[]): Promise<number> {
  const [name] = argv;
  if (name === undefined || name === '--help' || name === '-h') {
    printHelp();
    return 0;
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
  if (!command) {
    process.stderr.write(`usage: oldguy <${Object.keys(COMMANDS).join('|')}> (try --help)\n`);
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
    // whatever was thrown: an Error has a message, anything else is printed as it is
    const e = err as { message?: unknown } | null | undefined;
    process.stderr.write(`oldguy: ${e && e.message ? e.message : err}\n`);
    process.exitCode = 2;
  },
);
