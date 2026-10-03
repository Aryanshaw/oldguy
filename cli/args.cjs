'use strict';

// Separates plain arguments from `--flag value` pairs; throws on a flag that is unknown or has no value.
function parseFlags(args, allowed) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    } else if (!allowed.includes(args[i])) {
      throw new Error(`unknown option ${args[i]}`);
    } else if (args[i + 1] === undefined || args[i + 1].startsWith('--')) {
      throw new Error(`${args[i]} needs a value`);
    } else {
      flags[args[i]] = args[++i];
    }
  }
  return { positional, flags };
}

// Reads a flag as a number of seconds (0 or more), or returns the fallback when absent.
function secondsFlag(flags, name, fallback) {
  if (flags[name] === undefined) return fallback;
  const n = flags[name].trim() === '' ? NaN : Number(flags[name]);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} needs a number of seconds, 0 or more`);
  return n;
}

// Runs a command body and turns any error into one stderr line and exit code 2.
function guarded(name, body) {
  try {
    return body();
  } catch (err) {
    process.stderr.write(`yap ${name}: ${String(err.message).replace(/\s*\n\s*/g, ' ')}\n`);
    return 2;
  }
}

module.exports = { parseFlags, secondsFlag, guarded };
