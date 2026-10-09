'use strict';
// The flat art catalog loader: reading and checking catalog.json and PALETTE.json, finding items, and recolouring cast.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadCatalog, catalogErrors, findItem, closest, colourway, recolour, recolourMap, paletteErrors, loadPalette, ART_DIR,
} = require('../lib/catalog.mts');

const FIXTURE = path.join(__dirname, 'fixtures', 'flat-art');
const RAW = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'catalog.json'), 'utf8'));

// The problems catalogErrors finds in the fixture catalog after `edit`.
function problems(edit) {
  const raw = structuredClone(RAW);
  edit(raw);
  return catalogErrors(raw, FIXTURE);
}

// The fixture item with this id, from a raw catalog.
function item(raw, id) {
  return raw.items.find((i) => i.id === id);
}

test('the fixture catalog loads, with its palette, and findItem finds by id', () => {
  const cat = loadCatalog(FIXTURE);
  assert.equal(cat.version, 1);
  assert.equal(cat.items.length, 8);
  assert.equal(cat.dir, FIXTURE);
  assert.equal(findItem(cat, 'bell').size, 'small');
  assert.equal(findItem(cat, 'toaster'), undefined);
  assert.equal(cat.palette.tokens.indigo, '#221C55');
  assert.deepEqual(catalogErrors(RAW, FIXTURE), []);
});

test('the real library loads before any art exists', () => {
  const cat = loadCatalog();
  assert.equal(cat.dir, ART_DIR);
  assert.ok(Array.isArray(cat.items));
  assert.deepEqual(paletteErrors(JSON.parse(fs.readFileSync(path.join(ART_DIR, 'PALETTE.json'), 'utf8'))), []);
});

test('catalogErrors names each problem', () => {
  const cases = [
    [(r) => { item(r, 'bell').file = 'props/nope.svg'; }, 'bell: file props/nope.svg is missing'],
    [(r) => { item(r, 'oven').id = 'bell'; }, 'bell: duplicate id'],
    [(r) => { item(r, 'bell').size = 'giant'; }, 'bell: size "giant" must be one of tiny, small, medium, large, person, huge'],
    [(r) => { item(r, 'bell').anchors.card = { x: 500, y: 8 }; }, 'bell: anchor "card" (500, 8) is outside the viewBox 0 0 160 140'],
    [(r) => { delete item(r, 'oldguy-stand').layers.mouthOpen; }, 'oldguy-stand: a host needs layers eyes, eyesShut, mouth and mouthOpen'],
    [(r) => { item(r, 'oldguy-stand').layers.eyes = 'nope'; }, 'oldguy-stand: layer "nope" is not an id in hosts/oldguy-stand.svg'],
    [(r) => { delete item(r, 'body-a-stand').colors; }, 'body-a-stand: a cast item needs colors (group name to the fill used in its file)'],
    [(r) => { item(r, 'bell').kind = 'thing'; }, 'bell: kind must be cast, host or prop'],
    [(r) => { item(r, 'bell').file = '../catalog.json'; }, 'bell: file must be a relative path inside the art folder'],
    [(r) => { delete item(r, 'body-a-stand').pose; }, 'body-a-stand: a cast or host item needs body and pose'],
    [(r) => { item(r, 'bell').viewBox = [0, 0, 0, 10]; }, 'bell: viewBox must be [x, y, width, height] with a size above 0'],
  ];
  for (const [edit, message] of cases) {
    const found = problems(edit);
    assert.ok(found.includes(message), `${message}\n  got: ${found.join('\n       ')}`);
  }
  assert.deepEqual(catalogErrors({ version: 2, items: [] }, FIXTURE), ['catalog version must be 1']);
  assert.deepEqual(catalogErrors([], FIXTURE), ['catalog.json must hold an object with version and items']);
});

test('loadCatalog lists every problem in one error', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldguy-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const raw = structuredClone(RAW);
  item(raw, 'bell').size = 'giant';
  item(raw, 'oven').file = 'props/gone.svg';
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(raw));
  assert.throws(() => loadCatalog(dir), /catalog .* is invalid: bell: size "giant".*; oven: file props\/gone\.svg is missing/);
  fs.writeFileSync(path.join(dir, 'catalog.json'), '{ nope');
  assert.throws(() => loadCatalog(dir), /catalog.json in .* is not valid JSON/);
});

test('closest suggests the nearest ids by name and tags', () => {
  const cat = loadCatalog(FIXTURE);
  assert.deepEqual(closest(cat, 'toaster'), ['oven', 'shop-counter']);
  assert.deepEqual(closest(cat, 'bel', 1), ['bell']);
  assert.deepEqual(closest(cat, 'counter', 1, 'prop'), ['shop-counter']);
});

test('recolour swaps only the listed fills and leaves the rest byte for byte', () => {
  const svg = '<svg><rect fill="#FF6B57"/><circle fill="#ff6b57"/><path fill="#14110A"/><g fill="#FF6B57"></g></svg>';
  assert.equal(recolour(svg, { '#FF6B57': '#F6C945' }), '<svg><rect fill="#F6C945"/><circle fill="#F6C945"/><path fill="#14110A"/><g fill="#F6C945"></g></svg>');
  // one pass: a swap that lands on another listed colour is not swapped again
  assert.equal(recolour('<a fill="#111111"/><b fill="#222222"/>', { '#111111': '#222222', '#222222': '#333333' }), '<a fill="#222222"/><b fill="#333333"/>');
  assert.equal(recolour(svg, {}), svg);
});

test('colourways resolve per group and map the file fills to new ones', () => {
  const cat = loadCatalog(FIXTURE);
  const body = findItem(cat, 'body-a-stand');
  assert.deepEqual(colourway(body, 'yellow', cat.palette), { skin: '#F9D3B4', hair: '#E9C46A', top: '#F6C945', bottom: '#1F5FA8', shoes: '#14110A' });
  assert.deepEqual(recolourMap(body, 'yellow', cat.palette), { '#F0B48A': '#F9D3B4', '#1B1640': '#E9C46A', '#FF6B57': '#F6C945', '#1F5FA8': '#1F5FA8', '#14110A': '#14110A' });
  assert.throws(() => colourway(body, 'teal', cat.palette), /colourway "teal" is unknown; use one of coral, peach, yellow, lilac, orange, sky/);
});

test('paletteErrors checks hex values, unique token names and colourways', () => {
  const good = loadPalette(FIXTURE).raw;
  assert.deepEqual(paletteErrors(good), []);
  const bad = structuredClone(good);
  bad.groups.accents.coral = 'red';
  bad.groups.marks.indigo = '#000000';
  bad.colourways.coral.top = 'nope';
  assert.deepEqual(paletteErrors(bad), [
    'accents.coral must be a #RRGGBB colour',
    'marks.indigo repeats a token name',
    'colourway coral.top names no palette token "nope"',
  ]);
});
