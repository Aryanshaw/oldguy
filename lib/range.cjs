'use strict';
// Serving one file to a browser video player: understanding the Range header and streaming the right bytes.
const fs = require('node:fs');
const path = require('node:path');

// Reads a Range header for a file of `size` bytes. Gives { kind: 'none' } (no header), 'invalid' (unreadable, reversed,
// not bytes, or several ranges: send the whole file), 'unsatisfiable' (nothing to send: 416), or 'single' with start/end.
function parseRange(header, size) {
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

// Ends a response early: the headers may already be out, so just drop the connection.
function abort(res) {
  if (!res.headersSent) { res.statusCode = 500; res.end(); } else res.destroy();
}

// Sends the file at absPath with range support. The file is opened once and its size read from that same open handle,
// so size and bytes always come from one file. createReadStream can be replaced (tests). HEAD gets the headers only. Errors and dropped clients close the handle.
async function serveFile(req, res, absPath, { contentType, createReadStream = fs.createReadStream }) {
  const handle = await fs.promises.open(absPath, 'r');
  let closed = false;
  // Closes the handle once, whoever finishes first.
  const close = () => { if (!closed) { closed = true; handle.close().catch(() => {}); } };
  try {
    const stat = await handle.stat();
    // The path may have been swapped for something else since the caller checked it.
    if (!stat.isFile()) throw Object.assign(new Error('not found'), { status: 404 });
    const { size } = stat;
    const range = parseRange(req.headers.range, size);
    const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes' };
    if (range.kind === 'unsatisfiable') {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
      res.end();
      return close();
    }
    const single = range.kind === 'single';
    const start = single ? range.start : 0;
    const end = single ? range.end : size - 1;
    if (single) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = size === 0 ? 0 : end - start + 1;
    res.writeHead(single ? 206 : 200, headers);
    if (req.method === 'HEAD' || size === 0) { res.end(); return close(); }
    // The stream is given the open handle itself, so it closes the handle properly (even mid-read) when it ends or is destroyed.
    const stream = createReadStream(null, { fd: handle, start, end });
    stream.on('error', () => { abort(res); });
    stream.on('close', close);
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    close();
    throw err;
  }
}

// Returns the real path of `name` inside chapterDir, or null unless the folder is a real folder (not a link) and the
// file is a regular file whose real path stays inside the folder's real path (compared by path pieces, not text prefix).
function safeChapterFile(chapterDir, name) {
  try {
    if (!fs.lstatSync(chapterDir).isDirectory()) return null;
    const root = fs.realpathSync(chapterDir);
    const real = fs.realpathSync(path.join(chapterDir, name));
    const rel = path.relative(root, real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

module.exports = { parseRange, serveFile, safeChapterFile };
