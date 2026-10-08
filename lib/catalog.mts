// The flat art library (art/flat/): catalog.json lists every drawing (cast, hosts, props) with its size class, named
// anchor points and, for cast, the fill colours that can be swapped; PALETTE.json names every colour the art and the
// shots may use. This module reads and checks both, finds items, and recolours a cast drawing into a colourway.
import fs from 'node:fs';
import path from 'node:path';

// A point in a drawing's own viewBox units.
type Anchor = { x: number; y: number };
// A size class: how big the thing is in the world, so a bell is never drawn bigger than a person.
type Size = 'tiny' | 'small' | 'medium' | 'large' | 'person' | 'huge';
// The face layers of a host drawing, by element id in its file: open and shut eyes, closed and open mouth.
type Layers = { eyes: string; eyesShut: string; mouth: string; mouthOpen: string };
// One drawing in the library.
type Item = {
  id: string;
  kind: 'cast' | 'host' | 'prop';
  file: string;
  tags: string[];
  size: Size;
  viewBox: [number, number, number, number];
  anchors: Record<string, Anchor>;
  colors?: Record<string, string>;
  layers?: Layers;
  body?: string;
  pose?: string;
  faces?: 'left' | 'right';
};
// PALETTE.json as written: named groups of token -> hex, and the cast colourways (group -> token).
type PaletteFile = { version: 1; groups: Record<string, Record<string, string>>; colourways: Record<string, Record<string, string>> };
// The palette as the code uses it: every token's hex, by token name, and the file it came from.
type Palette = { tokens: Record<string, string>; colourways: Record<string, Record<string, string>>; raw: PaletteFile };
// A loaded and checked library: its items, its palette and the folder the files live in.
type Catalog = { version: 1; items: Item[]; palette: Palette; dir: string };

const SIZES: Size[] = ['tiny', 'small', 'medium', 'large', 'person', 'huge'];
const KINDS = ['cast', 'host', 'prop'];
const LAYER_NAMES = ['eyes', 'eyesShut', 'mouth', 'mouthOpen'] as const;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// The library that ships with oldguy.
const ART_DIR = path.join(import.meta.dirname, '..', 'art', 'flat');

// True when the value is a plain object (not null, not a list).
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// True when the value is a finite number.
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Lists every problem with a parsed PALETTE.json: #RRGGBB values, token names used once across groups, and colourways
// that name real tokens.
function paletteErrors(raw: unknown): string[] {
  if (!isObject(raw) || !isObject(raw.groups) || !isObject(raw.colourways)) return ['PALETTE.json must hold an object with groups and colourways'];
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const [group, tokens] of Object.entries(raw.groups)) {
    if (!isObject(tokens)) { errs.push(`${group} must map token names to colours`); continue; }
    for (const [name, hex] of Object.entries(tokens)) {
      if (typeof hex !== 'string' || !HEX.test(hex)) errs.push(`${group}.${name} must be a #RRGGBB colour`);
      if (seen.has(name)) errs.push(`${group}.${name} repeats a token name`);
      seen.add(name);
    }
  }
  for (const [name, way] of Object.entries(raw.colourways)) {
    if (!isObject(way)) { errs.push(`colourway ${name} must map groups to tokens`); continue; }
    for (const [group, token] of Object.entries(way)) {
      if (typeof token !== 'string' || !seen.has(token)) errs.push(`colourway ${name}.${group} names no palette token "${String(token)}"`);
    }
  }
  return errs;
}

// Reads and checks dir/PALETTE.json; returns the tokens flattened by name.
function loadPalette(dir: string = ART_DIR): Palette {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'PALETTE.json'), 'utf8'));
  } catch {
    throw new Error(`PALETTE.json in ${dir} is missing or not valid JSON`);
  }
  const errs = paletteErrors(raw);
  if (errs.length) throw new Error(`palette in ${dir} is invalid: ${errs.join('; ')}`);
  // paletteErrors just proved the shape
  const file = raw as PaletteFile;
  const tokens: Record<string, string> = {};
  for (const group of Object.values(file.groups)) for (const [name, hex] of Object.entries(group)) tokens[name] = hex.toUpperCase();
  return { tokens, colourways: file.colourways, raw: file };
}

// True when a relative file path stays inside the art folder.
function insideFolder(p: string): boolean {
  if (!p || path.isAbsolute(p) || p.includes('\\')) return false;
  return !path.posix.normalize(p).split('/').includes('..');
}

// Lists the problems with one item (its id is known to be text); `ids` collects ids to spot duplicates.
function itemErrors(it: Record<string, unknown>, dir: string, ids: Set<string>): string[] {
  const id = String(it.id);
  const errs: string[] = [];
  const at = (msg: string) => errs.push(`${id}: ${msg}`);
  if (!SLUG.test(id)) at('id must be a slug (a-z, 0-9, hyphens)');
  if (ids.has(id)) at('duplicate id');
  ids.add(id);
  if (!KINDS.includes(String(it.kind))) at('kind must be cast, host or prop');
  if (!Array.isArray(it.tags) || !it.tags.every((t) => typeof t === 'string')) at('tags must be a list of words');
  if (!SIZES.includes(it.size as Size)) at(`size "${String(it.size)}" must be one of ${SIZES.join(', ')}`);
  let svg = '';
  if (typeof it.file !== 'string' || !insideFolder(it.file)) {
    at('file must be a relative path inside the art folder');
  } else {
    try {
      svg = fs.readFileSync(path.join(dir, it.file), 'utf8');
    } catch {
      at(`file ${it.file} is missing`);
    }
  }
  const vb = it.viewBox;
  const box = Array.isArray(vb) && vb.length === 4 && vb.every(isNum) && vb[2] > 0 && vb[3] > 0 ? (vb as number[]) : null;
  if (!box) at('viewBox must be [x, y, width, height] with a size above 0');
  if (!isObject(it.anchors)) {
    at('anchors must map names to {x, y} points');
  } else {
    for (const [name, a] of Object.entries(it.anchors)) {
      if (!isObject(a) || !isNum(a.x) || !isNum(a.y)) { at(`anchor "${name}" must be {x, y}`); continue; }
      if (box && (a.x < box[0] || a.y < box[1] || a.x > box[0] + box[2] || a.y > box[1] + box[3])) {
        at(`anchor "${name}" (${a.x}, ${a.y}) is outside the viewBox ${box.join(' ')}`);
      }
    }
  }
  if (it.kind === 'cast' || it.kind === 'host') {
    if (typeof it.body !== 'string' || !SLUG.test(it.body) || typeof it.pose !== 'string' || !SLUG.test(it.pose)) at('a cast or host item needs body and pose');
  }
  if (it.kind === 'cast') {
    const colors = it.colors;
    if (!isObject(colors) || Object.keys(colors).length === 0) at('a cast item needs colors (group name to the fill used in its file)');
    else for (const [g, hex] of Object.entries(colors)) if (typeof hex !== 'string' || !HEX.test(hex)) at(`colors.${g} must be a #RRGGBB colour`);
  }
  if (it.kind === 'host') {
    const layers = it.layers;
    if (!isObject(layers) || !LAYER_NAMES.every((n) => typeof layers[n] === 'string' && layers[n])) {
      at('a host needs layers eyes, eyesShut, mouth and mouthOpen');
    } else if (svg) {
      for (const n of LAYER_NAMES) if (!svg.includes(`id="${String(layers[n])}"`)) at(`layer "${String(layers[n])}" is not an id in ${String(it.file)}`);
    }
  }
  if (it.faces !== undefined && it.faces !== 'left' && it.faces !== 'right') at('faces must be left or right');
  return errs;
}

// Checks a parsed catalog.json whose files live in dir; returns every problem found ([] when it is valid).
function catalogErrors(raw: unknown, dir: string): string[] {
  if (!isObject(raw)) return ['catalog.json must hold an object with version and items'];
  if (raw.version !== 1) return ['catalog version must be 1'];
  if (!Array.isArray(raw.items)) return ['catalog items must be a list'];
  const ids = new Set<string>();
  const list: unknown[] = raw.items;
  return list.flatMap((it, i) => (isObject(it) && typeof it.id === 'string' ? itemErrors(it, dir, ids) : [`items[${i}] needs an id`]));
}

// Loads and checks the library in dir (the shipped art/flat by default) with its palette; a bad one lists every problem.
function loadCatalog(dir: string = ART_DIR): Catalog {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
  } catch {
    throw new Error(`catalog.json in ${dir} is not valid JSON`);
  }
  const errs = catalogErrors(raw, dir);
  if (errs.length) throw new Error(`catalog ${dir} is invalid: ${errs.join('; ')}`);
  // catalogErrors just proved every item's shape
  const items = (raw as { items: Item[] }).items;
  return { version: 1, items, palette: loadPalette(dir), dir };
}

// The item with this id, or undefined.
function findItem(c: Catalog, id: string): Item | undefined {
  return c.items.find((i) => i.id === id);
}

// The number of single-letter edits that turn a into b (Levenshtein distance).
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

// How far an item is from a wanted name: the nearest of its id, the words of its id and its tags (a word or tag
// costs one more than the id, so an exact id wins), and 0 when one name holds the other.
function distance(want: string, it: Item): number {
  if (it.id.includes(want) || want.includes(it.id)) return 0;
  const words = [...it.id.split('-'), ...it.tags];
  return Math.min(editDistance(want, it.id), ...words.map((w) => editDistance(want, w.toLowerCase()) + 1));
}

// The n ids nearest to a wanted name (of one kind when given), nearest first, ties by id.
function closest(c: Catalog, id: string, n: number = 2, kind?: Item['kind']): string[] {
  const want = id.toLowerCase();
  return c.items
    .filter((it) => kind === undefined || it.kind === kind)
    .map((it) => ({ id: it.id, d: distance(want, it) }))
    .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((x) => x.id);
}

// A cast item's colours in a named colourway: group -> new hex. An unknown colourway, or one missing a group the item
// has, is an error naming what exists.
function colourway(item: Item, name: string, palette: Palette): Record<string, string> {
  const way = Object.hasOwn(palette.colourways, name) ? palette.colourways[name] : undefined;
  if (!way) throw new Error(`colourway "${name}" is unknown; use one of ${Object.keys(palette.colourways).join(', ')}`);
  const out: Record<string, string> = {};
  for (const group of Object.keys(item.colors ?? {})) {
    if (!Object.hasOwn(way, group)) throw new Error(`colourway "${name}" has no colour for ${item.id}'s ${group}`);
    out[group] = palette.tokens[way[group]];
  }
  return out;
}

// The fill swaps that put a cast item into a colourway: the fill in its file -> the colourway's fill.
function recolourMap(item: Item, name: string, palette: Palette): Record<string, string> {
  const way = colourway(item, name, palette);
  const map: Record<string, string> = {};
  for (const [group, hex] of Object.entries(item.colors ?? {})) map[hex.toUpperCase()] = way[group];
  return map;
}

// Swaps the listed fill colours in an SVG in one pass (case does not matter); every other byte stays as it was.
function recolour(svg: string, map: Record<string, string>): string {
  const upper: Record<string, string> = {};
  for (const [from, to] of Object.entries(map)) upper[from.toUpperCase()] = to;
  return svg.replace(/fill="(#[0-9A-Fa-f]{6})"/g, (whole, hex: string) => (Object.hasOwn(upper, hex.toUpperCase()) ? `fill="${upper[hex.toUpperCase()]}"` : whole));
}

export { ART_DIR, SIZES, loadCatalog, catalogErrors, loadPalette, paletteErrors, findItem, closest, colourway, recolourMap, recolour };
export type { Anchor, Size, Layers, Item, Catalog, Palette, PaletteFile };
