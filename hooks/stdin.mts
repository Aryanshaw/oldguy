// Reading what Claude Code sends a hook on stdin, shared by the SessionStart and SessionEnd hooks.

const READ_LIMIT_MS = 500;

// The JSON Claude Code sends the hook on stdin (any field may be missing or of another type).
type HookInput = Record<string, unknown>;

// Reads all of stdin, but gives up after a short wait so a pipe that never closes cannot hang the session.
function readStdin(): Promise<string> {
  return new Promise<string>((resolve) => {
    let text = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(text);
    };
    const timer = setTimeout(finish, READ_LIMIT_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => { text += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });
}

// Turns the stdin text into a plain object, or null when it is not a JSON object.
function parseInput(text: string): HookInput | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as HookInput) : null;
  } catch {
    return null;
  }
}


export { readStdin, parseInput };
export type { HookInput };
