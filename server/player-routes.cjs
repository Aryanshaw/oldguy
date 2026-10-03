'use strict';
// Routes for the built player page, its assets, and a chapter's sources.
const fs = require('node:fs');
const path = require('node:path');
const { loadManifest } = require('../lib/manifest.cjs');
const { slugChapterId } = require('../lib/chapter.cjs');
const { serveFile, safeChapterFile } = require('../lib/range.cjs');

// Where the built player lives: deps.playerDir (tests), else <repo>/player/dist.
function playerDir(state) {
  return state.deps.playerDir || path.join(__dirname, '..', 'player', 'dist');
}

// The bytes of the built index.html, or null unless it is a plain file (a link or folder counts as absent).
function readPlayerIndex(state) {
  try {
    const file = path.join(playerDir(state), 'index.html');
    return fs.lstatSync(file).isFile() ? fs.readFileSync(file) : null;
  } catch {
    return null;
  }
}

// Content type for each kind of asset the build may emit; any other extension is not served.
const ASSET_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

// GET /assets/:file: one file straight inside <playerDir>/assets, whose real path stays inside that folder.
async function handleAsset({ req, res, params, state, sendJson }) {
  const name = params.file;
  const contentType = ASSET_NAME.test(name) && !name.includes('..') ? ASSET_TYPES[path.extname(name)] : undefined;
  const real = contentType && safeChapterFile(path.join(playerDir(state), 'assets'), name);
  if (!real) return sendJson(res, 404, { error: 'not found' });
  await serveFile(req, res, real.path, { contentType, identity: real, createReadStream: state.deps.createReadStream });
}

// True for a pair of whole numbers.
const isLines = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger);

// GET /chapters/:id/sources: the sources of a listed chapter from its chapter.json, keeping only well-formed entries.
// A missing, unreadable or source-less chapter.json is an empty list. The chapter need not be ready.
function handleSources({ res, params, state, sendJson }) {
  let listed = false;
  try { listed = slugChapterId(params.id) === params.id && loadManifest(path.join(state.slugDir, 'manifest.json')).chapters.some((c) => c.id === params.id); } catch { /* not a valid id */ }
  if (!listed) return sendJson(res, 404, { error: 'not found' });
  let sources = [];
  try {
    const real = safeChapterFile(path.join(state.slugDir, 'chapters', params.id), 'chapter.json');
    const list = real && JSON.parse(fs.readFileSync(real.path, 'utf8')).sources;
    if (Array.isArray(list)) {
      sources = list
        .filter((s) => s && typeof s.file === 'string' && s.file !== '' && isLines(s.lines))
        .map((s) => ({ file: s.file, lines: [s.lines[0], s.lines[1]], quote: typeof s.quote === 'string' ? s.quote : '' }));
    }
  } catch { /* unreadable or not JSON: no sources */ }
  sendJson(res, 200, { sources });
}

const PLAYER_ROUTES = [
  { method: 'GET', pattern: '/assets/:file', handler: handleAsset },
  { method: 'GET', pattern: '/chapters/:id/sources', handler: handleSources },
];

module.exports = { PLAYER_ROUTES, readPlayerIndex };
