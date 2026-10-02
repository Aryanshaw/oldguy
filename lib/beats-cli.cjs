// The `yap beats <narration.txt> --duration <s> [--words <transcript.json>] [--lead <s>]` command.
const fs = require('node:fs');
const { splitSentences } = require('./sentences.cjs');
const { beatsFromDuration, beatsFromWords } = require('./beats.cjs');
const { parseFlags, secondsFlag, guarded } = require('./cli-args.cjs');

const USAGE = 'usage: yap beats <narration.txt> --duration <seconds> [--words <transcript.json>] [--lead <seconds>]';

// Reads a transcript file that must hold a list of {text, start, end} words.
function readWords(file) {
  const words = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ok = Array.isArray(words) && words.every((w) => w && typeof w.text === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end));
  if (!ok) throw new Error(`${file} is not a list of {text, start, end} words`);
  return words;
}

// Prints the narration's beats as JSON; timed by transcript words when given, otherwise by character share of --duration.
function runBeats(args) {
  return guarded('beats', () => {
    const { positional, flags } = parseFlags(args, ['--duration', '--words', '--lead']);
    if (positional.length !== 1) throw new Error(USAGE);
    const leadS = secondsFlag(flags, '--lead', 0);
    const duration = secondsFlag(flags, '--duration', undefined);
    if (duration === undefined) throw new Error(USAGE);
    const sentences = splitSentences(fs.readFileSync(positional[0], 'utf8'));
    if (!sentences.length) throw new Error(`${positional[0]} has no sentences`);
    const beats = flags['--words']
      ? beatsFromWords(sentences, readWords(flags['--words']), { leadS })
      : beatsFromDuration(sentences, duration, { leadS });
    process.stdout.write(`${JSON.stringify(beats, null, 2)}\n`);
    return 0;
  });
}

module.exports = { runBeats };
