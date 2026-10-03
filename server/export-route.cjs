'use strict';
// POST /api/export: writes the finished video, script and sources into a folder the viewer chose.
const path = require('node:path');
const { loadManifest } = require('../lib/manifest.cjs');
const { exportVideo, checkDest } = require('../lib/export.cjs');
const { ffmpegPath } = require('../lib/poster.cjs');

// Answers {file, files, skipped} on success. The body is checked first (dest, mode); only one export runs at a time.
async function handleExport({ req, res, state, sendJson, readJsonBody }) {
  const { dest, mode } = await readJsonBody(req);
  const destDir = checkDest(dest, state.slugDir);
  if (mode !== undefined && typeof mode !== 'string') return sendJson(res, 400, { error: 'mode must be text' });
  if (state.exporting) return sendJson(res, 409, { error: 'an export is already running' });
  state.exporting = true;
  try {
    const manifest = loadManifest(path.join(state.slugDir, 'manifest.json'));
    const result = await exportVideo({
      manifest, slugDir: state.slugDir, destDir, mode,
      ffmpeg: state.deps.ffmpeg || ffmpegPath(), exec: state.deps.exec,
    });
    sendJson(res, 200, result);
  } catch (err) {
    // A failed ffmpeg run is a server-side failure but its short reason is safe to show (base names only).
    if (err && err.status === 500) return sendJson(res, 500, { error: String(err.message).replace(/\s+/g, ' ') });
    throw err;
  } finally {
    state.exporting = false;
  }
}

module.exports = { handleExport };
