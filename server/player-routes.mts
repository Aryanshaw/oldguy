// Routes for the built player page, its assets, and a chapter's sources.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../lib/manifest.mts';
import { slugChapterId } from '../lib/chapter.mts';
import { serveFile, safeChapterFile } from '../lib/range.mts';
import type { Route, RouteContext, ServerState } from './types.mts';

// One source entry as the player receives it.
type PlayerSource = { file: string; lines: [number, number]; quote: string };

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Where the built player lives: deps.playerDir (tests), else <repo>/player/dist.
function playerDir(state: ServerState): string {
  return state.deps.playerDir || path.join(HERE, '..', 'player', 'dist');
}

// The bytes of the built index.html, or null unless it is a plain file (a link or folder counts as absent).
function readPlayerIndex(state: ServerState): Buffer | null {
  try {
    const file = path.join(playerDir(state), 'index.html');
    return fs.lstatSync(file).isFile() ? fs.readFileSync(file) : null;
  } catch {
    return null;
  }
}

// Content type for each kind of asset the build may emit; any other extension is not served.
const ASSET_TYPES: Record<string, string> = {
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
async function handleAsset({ req, res, params, state, sendJson }: RouteContext): Promise<void> {
  const name = params.file;
  const contentType = ASSET_NAME.test(name) && !name.includes('..') ? ASSET_TYPES[path.extname(name)] : undefined;
  const real = contentType ? safeChapterFile(path.join(playerDir(state), 'assets'), name) : null;
  if (!contentType || !real) return sendJson(res, 404, { error: 'not found' });
  await serveFile(req, res, real.path, { contentType, identity: real, createReadStream: state.deps.createReadStream });
}

// True for a pair of whole numbers.
const isLines = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger);

// GET /chapters/:id/sources: the sources of a listed chapter from its chapter.json, keeping only well-formed entries.
// A missing, unreadable or source-less chapter.json is an empty list. The chapter need not be ready.
function handleSources({ res, params, state, sendJson }: RouteContext): void {
  let listed = false;
  try { listed = slugChapterId(params.id) === params.id && loadManifest(path.join(state.slugDir, 'manifest.json')).chapters.some((c) => c.id === params.id); } catch { /* not a valid id */ }
  if (!listed) return sendJson(res, 404, { error: 'not found' });
  let sources: PlayerSource[] = [];
  try {
    const real = safeChapterFile(path.join(state.slugDir, 'chapters', params.id), 'chapter.json');
    // chapter.json is written by the scaffold; anything in it is checked entry by entry below
    const list: unknown = real && (JSON.parse(fs.readFileSync(real.path, 'utf8')) as { sources?: unknown }).sources;
    if (Array.isArray(list)) {
      sources = list
        .filter((s): s is { file: string; lines: [number, number]; quote?: unknown } =>
          !!s && typeof s.file === 'string' && s.file !== '' && isLines(s.lines))
        .map((s) => ({ file: s.file, lines: [s.lines[0], s.lines[1]], quote: typeof s.quote === 'string' ? s.quote : '' }));
    }
  } catch { /* unreadable or not JSON: no sources */ }
  sendJson(res, 200, { sources });
}

const PLAYER_ROUTES: Route[] = [
  { method: 'GET', pattern: '/assets/:file', handler: handleAsset },
  { method: 'GET', pattern: '/chapters/:id/sources', handler: handleSources },
];

export { PLAYER_ROUTES, readPlayerIndex };
