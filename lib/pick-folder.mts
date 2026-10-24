// Opens this computer's own folder picker, so the viewer chooses where an export goes instead of typing a path.
// The server runs on the viewer's computer, so the dialog it opens is the one they see.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Runs a program with an argument list and answers its output; the real one never uses a shell. A test hands in a fake.
type PickExec = (file: string, args: string[], opts: { signal?: AbortSignal }) => Promise<{ stdout: string }>;

const PROMPT = 'Export the video to';

// The picker commands to try in order, for each system. Cancel makes the macOS and Linux pickers exit non-zero;
// the Windows one prints nothing.
const PICKERS: Record<string, [string, string[]][]> = {
  // "activate" brings the dialog in front of the browser
  darwin: [['osascript', ['-e', 'activate', '-e', `POSIX path of (choose folder with prompt "${PROMPT}")`]]],
  win32: [['powershell', ['-NoProfile', '-STA', '-Command',
    'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; ' +
    `$d.Description = '${PROMPT}'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`]]],
  linux: [
    ['zenity', ['--file-selection', '--directory', `--title=${PROMPT}`]],
    ['kdialog', ['--getexistingdirectory', '.', '--title', PROMPT]],
  ],
};

// An error that carries the HTTP status the server answers with.
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

// Answers the chosen folder, or null when the viewer cancelled. Throws a 501 when no picker could be opened.
async function pickFolder({ platform = process.platform, exec = promisify(execFile) as PickExec, signal }:
  { platform?: string; exec?: PickExec; signal?: AbortSignal } = {}): Promise<string | null> {
  for (const [file, args] of PICKERS[platform] || []) {
    try {
      const out = (await exec(file, args, { signal })).stdout.trim();
      return out === '' ? null : out;
    } catch (err) {
      const e = err as { code?: unknown };
      if (e.code === 'ENOENT') continue; // not installed: try the next picker
      if (typeof e.code === 'number') return null; // the picker closed without a folder
      throw err;
    }
  }
  throw httpError(501, 'this computer has no folder picker oldguy can open; type the folder path instead');
}

export { pickFolder };
export type { PickExec };
