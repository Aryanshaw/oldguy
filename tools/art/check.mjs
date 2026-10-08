#!/usr/bin/env node
// Per-item checks for the flat art library (repo-only tool; the same rules as the library test).
// Usage: node tools/art/check.mjs FILE.svg... [--max-kb 20] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PALETTE_FILE = path.join(ROOT, 'art', 'flat', 'PALETTE.json');

// The palette as a map from upper-case hex to token name.
export function loadPalette(file = PALETTE_FILE) {
  const pal = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map(Object.entries(pal).map(([name, hex]) => [hex.toUpperCase(), name]));
}

// Every problem with one SVG's text, as plain sentences; [] means it passes.
export function svgErrors(svg, palette, { maxKb = 20 } = {}) {
  const errors = [];
  const kb = Buffer.byteLength(svg) / 1024;
  if (kb > maxKb) errors.push(`${kb.toFixed(1)} KB is over the ${maxKb} KB limit`);
  const vb = svg.match(/<svg[^>]*\sviewBox="([^"]+)"/);
  if (!vb) errors.push('no viewBox on the root <svg>');
  else if (vb[1].trim().split(/[\s,]+/).map(Number).some((n) => !Number.isFinite(n))) errors.push(`bad viewBox "${vb[1]}"`);
  // Flat art: no outlines, no gradients, no filters, no embedded images or text.
  if (/\sstroke(-width)?\s*=|stroke\s*:/.test(svg)) errors.push('has a stroke (outlines are not allowed)');
  for (const tag of ['linearGradient', 'radialGradient', 'filter', 'pattern', 'image', 'text', 'mask', 'clipPath']) {
    if (new RegExp(`<${tag}[\\s>/]`).test(svg)) errors.push(`has a <${tag}> element`);
  }
  if (/\sopacity\s*=|fill-opacity|style\s*=/.test(svg)) errors.push('has opacity or inline style (fills must be solid attributes)');
  // Every fill must be a palette colour, written as #RRGGBB.
  const fills = new Set([...svg.matchAll(/\sfill="([^"]+)"/g)].map((m) => m[1]));
  for (const f of fills) {
    if (f === 'none') continue;
    if (!palette.has(f.toUpperCase())) errors.push(`fill ${f} is not a PALETTE.json colour`);
  }
  if (!/<path[\s>]/.test(svg)) errors.push('has no <path>');
  return errors;
}

// Size, path count and the palette tokens one SVG uses (for reports and contact-sheet labels).
export function svgStats(svg, palette) {
  const fills = [...new Set([...svg.matchAll(/\sfill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase()))];
  return {
    kb: Math.round(Buffer.byteLength(svg) / 102.4) / 10,
    paths: (svg.match(/<path[\s>]/g) || []).length,
    tokens: fills.map((f) => palette.get(f) || f).sort(),
  };
}

// CLI: check each file, print one line per file, exit 1 if any fails.
function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const mi = args.indexOf('--max-kb');
  const maxKb = mi >= 0 ? Number(args[mi + 1]) : 20;
  const files = args.filter((a, i) => !a.startsWith('--') && !(mi >= 0 && i === mi + 1));
  if (!files.length) {
    console.error('usage: node tools/art/check.mjs FILE.svg... [--max-kb 20] [--json]');
    return 2;
  }
  const palette = loadPalette();
  let bad = 0;
  const report = [];
  for (const file of files) {
    const svg = fs.readFileSync(file, 'utf8');
    const errors = svgErrors(svg, palette, { maxKb });
    const stats = svgStats(svg, palette);
    if (errors.length) bad++;
    report.push({ file, ok: !errors.length, errors, ...stats });
    if (!json) {
      const head = `${errors.length ? 'FAIL' : 'ok  '} ${file}: ${stats.kb} KB, ${stats.paths} paths, ${stats.tokens.length} fills (${stats.tokens.join(', ')})`;
      console.log([head, ...errors.map((e) => `       - ${e}`)].join('\n'));
    }
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
