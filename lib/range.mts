// Serving one file to a browser video player: understanding the Range header and streaming the right bytes.
import fs from 'node:fs';
import path from 'node:path';
import { leavesFolder } from './chapter-scan.mts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

// What a Range header asks for: nothing, something unreadable, something impossible, or one byte range.
type RangeRequest =
  | { kind: 'none' | 'invalid' | 'unsatisfiable' }
  | { kind: 'single'; start: number; end: number };
// The device and inode number that identify one file on disk, as the caller saw them when it checked the file.
type FileIdentity = { dev: number; ino: number };
// An error that carries the HTTP status the caller should answer with.
type StatusError = Error & { status: number };
// Opens a read stream on an already-open file (Node ignores the path when a file handle is given).
type CreateReadStream = (path: null, options: { fd: fs.promises.FileHandle; start: number; end: number }) => Readable;
// What serveFile needs besides the request and response.
type ServeOptions = { contentType: string; identity?: FileIdentity | null; createReadStream?: CreateReadStream };
// A file inside a chapter folder that passed every safety check, with the identity it had then.
type SafeFile = { path: string } & FileIdentity;

// Reads a Range header for a file of `size` bytes. Gives { kind: 'none' } (no header), 'invalid' (unreadable, reversed,
// not bytes, or several ranges: send the whole file), 'unsatisfiable' (nothing to send: 416), or 'single' with start/end.
function parseRange(header: string | undefined, size: number): RangeRequest {
  if (header === undefined || header === '') return { kind: 'none' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'invalid' };
  if (m[1] === '') {
    // "-N" means the last N bytes; a suffix longer than the file is the whole file.
    const n = Number(m[2]);
    if (n === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'single', start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? Infinity : Number(m[2]);
  if (end < start) return { kind: 'invalid' };
  if (start >= size) return { kind: 'unsatisfiable' };
  return { kind: 'single', start, end: Math.min(end, size - 1) };
}

// Opens the file for reading without following a link at the last step, and checks it is the very file the caller
// checked (same device and inode). Anything else, or a file that is gone, is a 404.
async function openChecked(absPath: string, identity?: FileIdentity | null): Promise<{ handle: fs.promises.FileHandle; size: number }> {
  const notFound: StatusError = Object.assign(new Error('not found'), { status: 404 });
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(absPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    // a failed open always throws a system error with a code
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR') throw notFound;
    throw err;
  }
  try {
    const stat = await handle.stat();
    const same = !identity || (stat.dev === identity.dev && stat.ino === identity.ino);
    if (!stat.isFile() || !same) throw notFound;
    return { handle, size: stat.size };
  } catch (err) {
    await handle.close().catch(() => {});
    throw err;
  }
}

// Sends the file at absPath with range support. The file is opened once and its size read from that same open handle,
// so size and bytes always come from one file. identity ({dev, ino}) is what the caller checked; createReadStream can be
// replaced (tests). HEAD gets the headers only. The handle is closed on every path: errors, a client that leaves
// (even before the file is open), or a file that ends sooner than promised (then the connection is dropped).
async function serveFile(req: IncomingMessage, res: ServerResponse, absPath: string, { contentType, identity, createReadStream = fs.createReadStream as unknown as CreateReadStream }: ServeOptions): Promise<void> {
  // Watch for the client leaving from the very start, before any waiting happens.
  let gone = res.destroyed;
  let stream: Readable | null = null;
  res.on('close', () => { gone = true; if (stream) stream.destroy(); });
  const { handle, size } = await openChecked(absPath, identity);
  let closed = false;
  // Closes the handle once, whoever finishes first.
  const close = () => { if (!closed) { closed = true; handle.close().catch(() => {}); } };
  try {
    if (gone) return close();
    const range = parseRange(req.headers.range, size);
    const headers: Record<string, string | number> = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes' };
    if (range.kind === 'unsatisfiable') {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
      res.end();
      return close();
    }
    const single = range.kind === 'single';
    const start = single ? range.start : 0;
    const end = single ? range.end : size - 1;
    const promised = size === 0 ? 0 : end - start + 1;
    if (single) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = promised;
    res.writeHead(single ? 206 : 200, headers);
    if (req.method === 'HEAD' || size === 0) { res.end(); return close(); }
    // The stream is given the open handle itself, so it closes the handle properly (even mid-read) when it ends or is destroyed.
    stream = createReadStream(null, { fd: handle, start, end });
    let sent = 0;
    stream.on('data', (chunk: Buffer) => { sent += chunk.length; });
    stream.on('error', () => res.destroy());
    stream.on('close', close);
    // Ending early (file shrank) must not leave the client waiting for the rest: drop the connection instead.
    stream.on('end', () => (sent < promised ? res.destroy() : res.end()));
    stream.pipe(res, { end: false });
    if (gone) stream.destroy();
  } catch (err) {
    close();
    throw err;
  }
}

// Returns { path, dev, ino } for `name` inside chapterDir, or null unless the folder is a real folder (not a link) and the
// file is a regular file whose real path stays inside the folder's real path (compared by path pieces, not text prefix).
function safeChapterFile(chapterDir: string, name: string): SafeFile | null {
  try {
    if (!fs.lstatSync(chapterDir).isDirectory()) return null;
    const real = fs.realpathSync(path.join(chapterDir, name));
    if (leavesFolder(path.relative(fs.realpathSync(chapterDir), real)) || path.relative(chapterDir, real) === '') return null;
    const stat = fs.lstatSync(real);
    return stat.isFile() ? { path: real, dev: stat.dev, ino: stat.ino } : null;
  } catch {
    return null;
  }
}

export { parseRange, serveFile, safeChapterFile };
export type { RangeRequest, FileIdentity, ServeOptions, SafeFile, CreateReadStream };
