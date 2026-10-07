// Builds the player into a temp folder and compares it with dist/: same file list, same sha256 for each file.
// Exit 0 when equal, 1 (listing the differing files) when not.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// Sorted relative paths (with / separators) of every file under dir.
function list(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? list(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1).split('\\').join('/')]))
    .sort();
}
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const tmp = mkdtempSync(join(tmpdir(), 'oldguy-dist-'));
const out = join(tmp, 'dist');
let bad = [];
try {
  execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir'], { cwd: root, stdio: 'pipe' });
  const have = list(dist);
  const fresh = list(out);
  for (const f of have) if (!fresh.includes(f)) bad.push(`only in dist/: ${f}`);
  for (const f of fresh) if (!have.includes(f)) bad.push(`missing from dist/: ${f}`);
  for (const f of have) if (fresh.includes(f) && hash(join(dist, f)) !== hash(join(out, f))) bad.push(`differs: ${f}`);
} catch (e) {
  bad = [`could not build: ${(e.stderr && e.stderr.toString().trim().split('\n').slice(-3).join(' | ')) || e.message}`];
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (bad.length) {
  console.error('player/dist is not a fresh build. Run `npm run build` in player/ and commit dist/.');
  for (const line of bad) console.error(`  ${line}`);
  process.exit(1);
}
console.log('player/dist matches a fresh build');
