// Checking a whole video folder's shot lists: every chapter in order.json, its shots/<id>.json against the art library
// and the rules, with its sentences and sources taken from specs/<id>.json. Kept apart from lib/shots.mts so that
// scaffold (lib/chapter.mts) can use the compiler without importing the folder scan, which imports chapter.mts.
import fs from 'node:fs';
import path from 'node:path';
import { readOrder } from './chapter-scan.mts';
import { shotErrors, shotWarnings, isObject } from './shots.mts';
import type { Catalog } from './catalog.mts';
import type { ChapterShots, SourceRange } from './shots.mts';

// One chapter's result: its problems and warnings, and its shots when they could be read.
type ChapterResult = { id: string; errors: string[]; warnings: string[]; shots?: ChapterShots };

// Reads a JSON file; null when it is missing or not JSON.
function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// The cited ranges in a chapter spec's sources: [{file, lines: [from, to]}].
function specSources(spec: Record<string, unknown>): SourceRange[] {
  const list: unknown[] = Array.isArray(spec.sources) ? spec.sources : [];
  return list.flatMap((s) => {
    if (!isObject(s) || typeof s.file !== 'string' || !Array.isArray(s.lines) || s.lines.length !== 2) return [];
    const [a, b] = s.lines;
    return typeof a === 'number' && typeof b === 'number' ? [{ file: s.file, lines: [a, b] as [number, number] }] : [];
  });
}

// Checks every chapter of a video folder, in order.json's order: shots/<id>.json against the library and the rules,
// with its sentences and sources taken from specs/<id>.json. The first chapter's first shot sets the bookend the
// last chapter's last shot must echo.
function checkShotsFolder(slugDir: string, cat: Catalog): ChapterResult[] {
  const { ids } = readOrder(slugDir);
  if (!ids || ids.length === 0) throw new Error('no chapters in order.json: run oldguy order first');
  const read = ids.map((id) => {
    const raw = readJsonFile(path.join(slugDir, 'shots', `${id}.json`));
    const spec = readJsonFile(path.join(slugDir, 'specs', `${id}.json`));
    return { id, shots: isObject(raw) ? (raw as ChapterShots) : undefined, spec: isObject(spec) ? spec : undefined };
  });
  const first = read[0].shots;
  return read.map(({ id, shots, spec }, i): ChapterResult => {
    const errors: string[] = [];
    if (!shots) errors.push(`shots/${id}.json is missing or not JSON`);
    if (!spec) errors.push(`specs/${id}.json is missing or not JSON: write the spec (its sentences and sources) before the shots`);
    if (!shots || !spec) return { id, errors, warnings: [] };
    if (shots.id !== id) errors.push(`"id" must be "${id}", the chapter's id in order.json`);
    const sentences = Array.isArray(spec.sentences) ? spec.sentences.length : 0;
    errors.push(...shotErrors(shots, cat, { sentences, sources: specSources(spec), first, last: i === read.length - 1 }));
    return { id, errors, warnings: shotWarnings(shots), shots };
  });
}

export { checkShotsFolder };
export type { ChapterResult };
