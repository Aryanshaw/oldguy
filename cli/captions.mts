// The `oldguy captions <beats-or-words.json> [--vtt <out.vtt>] [--json <out.json>]` command.
import fs from 'node:fs';
import { buildCaptions } from '../lib/captions.mts';
import type { Word } from '../lib/beats.mts';
import { parseFlags, guarded } from './args.mts';

const USAGE = 'usage: oldguy captions <beats-or-words.json> [--vtt <out.vtt>] [--json <out.json>]';

// Reads a list of {text, start, end} items (beats or words).
function readItems(file: string): Word[] {
  const items: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ok = Array.isArray(items) && items.length > 0
    && items.every((w: unknown) => {
      const x = w as Partial<Word> | null | undefined;
      return x && typeof x.text === 'string' && Number.isFinite(x.start) && Number.isFinite(x.end);
    });
  if (!ok) throw new Error(`${file} is not a non-empty list of {text, start, end}`);
  // every entry was just proved to have text and finite times
  return items as Word[];
}

// Writes the caption files that were asked for; asking for neither is an error.
function runCaptions(args: string[]): number | 2 {
  return guarded('captions', () => {
    const { positional, flags } = parseFlags(args, ['--vtt', '--json']);
    if (positional.length !== 1 || (!flags['--vtt'] && !flags['--json'])) throw new Error(USAGE);
    const { vtt, json } = buildCaptions(readItems(positional[0]));
    if (flags['--vtt']) fs.writeFileSync(flags['--vtt'], vtt);
    if (flags['--json']) fs.writeFileSync(flags['--json'], `${JSON.stringify(json, null, 2)}\n`);
    return 0;
  });
}

export { runCaptions };
