#!/usr/bin/env node
// Contact sheet for library items (repo-only tool): each SVG at full cell size and as a 240px-wide thumbnail,
// labelled with its name, size and palette tokens, rendered to PNG in Chromium.
// Usage: node tools/art/sheet.mjs --out OUT.png [--title T] [--ground TOKEN] [--cell 560] [--cols 2]
//        FILE.svg[@TOKEN][#N][=LABEL]...  (@TOKEN sets that item's ground; #N marks a composite of N items, so the
//        size limit is N times the item limit; =LABEL replaces the file name)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadPalette, svgErrors, svgStats } from './check.mjs';

// Playwright is a dev tool here, not a dependency: use the repo's copy if any, else the global install.
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const where of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(where); } catch { /* try the next one */ }
  }
  throw new Error('playwright not found: npm i -g playwright (Chromium comes from PLAYWRIGHT_BROWSERS_PATH)');
}

// Parse argv into options and item specs.
function parseArgs(argv) {
  const opt = { out: '', title: 'contact sheet', ground: 'indigo', cell: 560, cols: 2, items: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opt.out = argv[++i];
    else if (a === '--title') opt.title = argv[++i];
    else if (a === '--ground') opt.ground = argv[++i];
    else if (a === '--cell') opt.cell = Number(argv[++i]);
    else if (a === '--cols') opt.cols = Number(argv[++i]);
    else {
      // FILE.svg[@TOKEN][#N][=LABEL]
      const m = a.match(/^([^@#=]+)(?:@([^#=]+))?(?:#(\d+))?(?:=(.+))?$/);
      opt.items.push({ file: m[1], ground: m[2], count: Number(m[3] || 1), label: m[4] });
    }
  }
  return opt;
}

// Escape text for HTML.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The sheet page: a grid of cells, each with the full-size drawing, its 240px thumbnail and a label.
export function sheetHtml(opt, palette) {
  // Grounds may be named "grounds.indigo" or just "indigo" (token names are unique across groups).
  const hexOf = new Map();
  for (const [hex, name] of palette) { hexOf.set(name, hex); hexOf.set(name.split('.')[1], hex); }
  const cells = opt.items.map((it) => {
    const svg = fs.readFileSync(it.file, 'utf8');
    const stats = svgStats(svg, palette);
    const errors = svgErrors(svg, palette, { maxKb: 20 * it.count });
    const bg = hexOf.get(it.ground || opt.ground) || it.ground || opt.ground;
    const body = svg.replace(/<\?xml[^>]*>/, '');
    return `<div class="cell">
      <div class="big" style="background:${bg}">${body}</div>
      <div class="row"><div class="thumb" style="background:${bg}">${body}</div>
      <div class="label"><b>${esc(it.label || path.basename(it.file))}</b><br>${stats.kb} KB · ${stats.paths} paths · ${stats.tokens.length} fills
      <br><span class="tok">${esc(stats.tokens.join(', '))}</span>
      ${errors.length ? `<br><span class="err">${esc(errors.join('; '))}</span>` : `<br><span class="ok">check ok${it.count > 1 ? ` (composite of ${it.count} items)` : ''}</span>`}</div></div>
    </div>`;
  });
  const { cell, cols } = opt;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:#f4f2ee;font:14px/1.35 -apple-system,Helvetica,Arial,sans-serif;color:#222;width:${cols * (cell + 24)}px}
    h1{font-size:20px;margin:0 0 16px}
    .grid{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:24px}
    .big{width:${cell}px;height:${cell}px;display:flex;align-items:center;justify-content:center;border-radius:6px;overflow:hidden}
    .big svg{width:92%;height:92%}
    .row{display:flex;gap:12px;margin-top:10px;align-items:flex-start}
    .thumb{width:240px;height:240px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:4px}
    .thumb svg{width:100%;height:100%}
    .tok{color:#666;font-size:12px}.err{color:#b00020;font-size:12px}.ok{color:#2e7d32;font-size:12px}
  </style></head><body><h1>${esc(opt.title)}</h1><div class="grid">${cells.join('')}</div></body></html>`;
}

// Render the sheet to a PNG; returns the output path.
export async function renderSheet(opt) {
  const palette = loadPalette();
  const html = sheetHtml(opt, palette);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: opt.cols * (opt.cell + 24) + 48, height: 800 } });
    await page.setContent(html);
    fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
    await page.screenshot({ path: opt.out, fullPage: true });
  } finally {
    await browser.close();
  }
  return opt.out;
}

// CLI entry.
async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.out || !opt.items.length) {
    console.error('usage: node tools/art/sheet.mjs --out OUT.png [--title T] [--ground TOKEN] [--cell 560] [--cols 2] FILE.svg[@TOKEN][=LABEL]...');
    return 2;
  }
  console.log(await renderSheet(opt));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
