// The `yap captions <beats-or-words.json> [--vtt <out.vtt>] [--json <out.json>]` command.
const fs = require('node:fs');
const { buildCaptions } = require('../lib/captions.mts');
const { parseFlags, guarded } = require('./args.cjs');

const USAGE = 'usage: yap captions <beats-or-words.json> [--vtt <out.vtt>] [--json <out.json>]';

// Reads a list of {text, start, end} items (beats or words).
function readItems(file) {
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ok = Array.isArray(items) && items.length > 0
    && items.every((w) => w && typeof w.text === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end));
  if (!ok) throw new Error(`${file} is not a non-empty list of {text, start, end}`);
  return items;
}

// Writes the caption files that were asked for; asking for neither is an error.
function runCaptions(args) {
  return guarded('captions', () => {
    const { positional, flags } = parseFlags(args, ['--vtt', '--json']);
    if (positional.length !== 1 || (!flags['--vtt'] && !flags['--json'])) throw new Error(USAGE);
    const { vtt, json } = buildCaptions(readItems(positional[0]));
    if (flags['--vtt']) fs.writeFileSync(flags['--vtt'], vtt);
    if (flags['--json']) fs.writeFileSync(flags['--json'], `${JSON.stringify(json, null, 2)}\n`);
    return 0;
  });
}

module.exports = { runCaptions };
