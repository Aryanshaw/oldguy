// The `oldguy beats <narration.txt> --duration <s> [--words <transcript.json>] [--lead <s>]` command.
import fs from 'node:fs';
import { splitSentences } from '../lib/sentences.mts';
import { beatsFromDuration, beatsFromWords } from '../lib/beats.mts';
import type { Word } from '../lib/beats.mts';
import { parseFlags, secondsFlag, guarded } from './args.mts';

const USAGE = 'usage: oldguy beats <narration.txt> --duration <seconds> [--words <transcript.json>] [--lead <seconds>]';

// True for something with text and finite start and end times.
function isTimedWord(w: unknown): boolean {
  const x = w as Partial<Word> | null | undefined;
  return Boolean(x && typeof x.text === 'string' && Number.isFinite(x.start) && Number.isFinite(x.end));
}

// Reads a transcript file that must hold a list of {text, start, end} words.
function readWords(file: string): Word[] {
  const words: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ok = Array.isArray(words) && words.every(isTimedWord);
  if (!ok) throw new Error(`${file} is not a list of {text, start, end} words`);
  // every entry was just proved to be a timed word
  return words as Word[];
}

// Prints the narration's beats as JSON; timed by transcript words when given, otherwise by character share of --duration.
function runBeats(args: string[]): number | 2 {
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

export { runBeats };
