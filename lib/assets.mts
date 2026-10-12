// Template assets: small files ship in the template folder; big media (background footage, sounds) is downloaded on
// first use into the plugin data folder, <data>/templates/<id>/<path>, so every project shares one copy. A download
// happens only after the user agrees (the skill asks, naming the size), and is kept only if its size and sha256 match.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Asset, Template } from './template.mts';

// Fetches a URL and hands back its body as a stream of chunks; the real one is cli's https getter, tests use a local server.
type Getter = (url: string) => Promise<AsyncIterable<Uint8Array>>;

// Where an asset lives: in the template folder, or (downloaded ones) in the data folder.
function assetPath(t: Template, a: Asset, dataDir: string): string {
  return a.url === undefined ? path.join(t.dir, a.path) : path.join(dataDir, 'templates', t.id, a.path);
}

// True when a downloaded asset is on disk at its listed size (its sha256 was checked when it was downloaded).
function present(t: Template, a: Asset, dataDir: string): boolean {
  try {
    return fs.statSync(assetPath(t, a, dataDir)).size === a.bytes;
  } catch {
    return false;
  }
}

// The assets that must be downloaded before the template can be used.
function missingAssets(t: Template, dataDir: string): Asset[] {
  return t.assets.filter((a) => a.url !== undefined && !present(t, a, dataDir));
}

// A size in megabytes, rounded, for the question the skill asks.
function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

// Downloads one asset to a temp file beside its place, checks its size and sha256, then renames it into place. On any
// failure the temp file is deleted and the error names the file (and both hashes on a mismatch); a retry is safe.
async function fetchAsset(t: Template, a: Asset, dataDir: string, get: Getter): Promise<string> {
  if (a.url === undefined || a.sha256 === undefined || a.bytes === undefined) throw new Error(`${a.path} ships with the template; there is nothing to download`);
  const dest = assetPath(t, a, dataDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  try {
    const out = fs.openSync(tmp, 'wx');
    try {
      for await (const chunk of await get(a.url)) {
        bytes += chunk.length;
        // stop early on a body larger than listed, so a wrong URL cannot fill the disk
        if (bytes > a.bytes) throw new Error(`${a.path}: the download is larger than the listed ${a.bytes} bytes`);
        hash.update(chunk);
        fs.writeSync(out, chunk);
      }
    } finally {
      fs.closeSync(out);
    }
    if (bytes !== a.bytes) throw new Error(`${a.path}: downloaded ${bytes} bytes, expected ${a.bytes}`);
    const got = hash.digest('hex');
    if (got !== a.sha256) throw new Error(`${a.path}: checksum mismatch (expected ${a.sha256}, got ${got}); the file was deleted`);
    fs.renameSync(tmp, dest);
    return dest;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export { assetPath, missingAssets, fetchAsset, megabytes };
export type { Getter };
