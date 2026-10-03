
// Plain arguments, and the `--flag value` pairs by flag name.
type ParsedFlags = { positional: string[]; flags: Record<string, string> };

// Separates plain arguments from `--flag value` pairs; throws on a flag that is unknown or has no value.
function parseFlags(args: string[], allowed: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
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
function secondsFlag<F extends number | undefined>(flags: Record<string, string>, name: string, fallback: F): number | F {
  if (flags[name] === undefined) return fallback;
  const n = flags[name].trim() === '' ? NaN : Number(flags[name]);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} needs a number of seconds, 0 or more`);
  return n;
}

// Runs a command body and turns any error into one stderr line and exit code 2.
function guarded<T>(name: string, body: () => T): T | 2 {
  try {
    return body();
  } catch (err) {
    // the bodies throw Errors with a message
    process.stderr.write(`yap ${name}: ${String((err as Error).message).replace(/\s*\n\s*/g, ' ')}\n`);
    return 2;
  }
}

export { parseFlags, secondsFlag, guarded };
export type { ParsedFlags };
