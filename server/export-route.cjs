'use strict';
// POST /api/export: writes the finished video, script and sources into a folder the viewer chose.
const path = require('node:path');
const { loadManifest } = require('../lib/manifest.cjs');
const { exportVideo, checkDest } = require('../lib/export.cjs');
const { ffmpegPath } = require('../lib/poster.mts');

// Answers {file, files, skipped} on success. The body is checked first (dest, mode); only one export runs at a time.
async function handleExport({ req, res, state, sendJson, readJsonBody }) {
  if (state.closing) return sendJson(res, 503, { error: 'the server is closing' });
  const body = await readJsonBody(req);
  const extra = Object.keys(body).find((k) => k !== 'dest' && k !== 'mode');
  if (extra !== undefined) return sendJson(res, 400, { error: `unknown field "${extra.replace(/\s+/g, ' ').slice(0, 40)}"` });
  const { dest, mode } = body;
  if (mode !== undefined && typeof mode !== 'string') return sendJson(res, 400, { error: 'mode must be text' });
  if (typeof dest !== 'string') return sendJson(res, 400, { error: 'dest must be a folder path' });
  const destDir = checkDest(dest, state.slugDir);
  if (state.exporting) return sendJson(res, 409, { error: 'an export is already running' });
  // The body took time to arrive: look again, so an export never starts once close() has begun.
  if (state.closing) return sendJson(res, 503, { error: 'the server is closing' });
  state.exporting = true;
  try {
    const manifest = loadManifest(path.join(state.slugDir, 'manifest.json'));
    // close() uses stopExport to abort the run and wait until its cleanup is done.
    const stopper = new AbortController();
    const running = exportVideo({
      manifest, slugDir: state.slugDir, destDir, mode, signal: stopper.signal,
      ffmpeg: state.deps.ffmpeg || ffmpegPath(), exec: state.deps.exec,
    });
    state.stopExport = async () => { stopper.abort(); await running.catch(() => {}); };
    const result = await running;
    sendJson(res, 200, result);
  } catch (err) {
    // A failed ffmpeg run is a server-side failure but its short reason is safe to show (base names only).
    if (err && err.status === 500) return sendJson(res, 500, { error: String(err.message).replace(/\s+/g, ' ') });
    throw err;
  } finally {
    state.exporting = false;
    state.stopExport = null;
  }
}

module.exports = { handleExport };
