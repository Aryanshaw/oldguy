// The `yap pad-wav <in> <out> [--lead <ms>] [--tail <ms>]` command.
const fs = require('node:fs');
const { padWav } = require('../lib/wav.cjs');

const MAX_BYTES = 200 * 1024 * 1024;
const USAGE = 'usage: yap pad-wav <in> <out> [--lead <ms>] [--tail <ms>]';

// Reads one non-negative millisecond option, falling back to its default when absent.
function readMs(args, flag, fallback) {
  const at = args.indexOf(flag);
  if (at === -1) return fallback;
  const raw = args[at + 1];
  const ms = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`${flag} needs a number of milliseconds, 0 or more`);
  return ms;
}

// Splits the arguments into input path, output path and the two silence lengths.
function parseArgs(args) {
  const valueAt = new Set(['--lead', '--tail'].map((f) => args.indexOf(f) + 1).filter((i) => i > 0));
  const paths = args.filter((a, i) => !a.startsWith('--') && !valueAt.has(i));
  if (paths.length !== 2) throw new Error(USAGE);
  return { input: paths[0], output: paths[1], leadMs: readMs(args, '--lead', 40), tailMs: readMs(args, '--tail', 120) };
}

// Pads the input wav and writes the output; exit 0 = done, 2 = any problem (one stderr line).
function runPadWav(args) {
  try {
    const { input, output, leadMs, tailMs } = parseArgs(args);
    if (fs.statSync(input).size > MAX_BYTES) throw new Error(`${input} is over 200 MB, refusing to load it`);
    fs.writeFileSync(output, padWav(fs.readFileSync(input), { leadMs, tailMs }));
    return 0;
  } catch (err) {
    process.stderr.write(`yap pad-wav: ${err.message.replace(/\s*\n\s*/g, ' ')}\n`);
    return 2;
  }
}

module.exports = { runPadWav };
