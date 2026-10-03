import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dist = join(process.cwd(), 'dist');
const indexPath = join(dist, 'index.html');
const built = existsSync(indexPath);
const assetsDir = join(dist, 'assets');
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const EXT = /\.(js|css|woff2|woff)$/;
const FORBIDDEN = ['data:', 'blob:', 'http://', 'https://'];

const assets = () => (existsSync(assetsDir) ? readdirSync(assetsDir) : []);

describe.skipIf(!built)('dist obeys the server policy', () => {
  it('index.html has no inline style or script', () => {
    const html = readFileSync(indexPath, 'utf8');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('style=');
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
  });

  it('index.html and css files name no data:, blob: or outside address', () => {
    const files = [indexPath, ...assets().filter((f) => f.endsWith('.css')).map((f) => join(assetsDir, f))];
    for (const f of files) {
      const text = readFileSync(f, 'utf8').replace(/\/\*![\s\S]*?\*\//g, '');
      for (const bad of FORBIDDEN) expect(text, `${f} contains ${bad}`).not.toContain(bad);
    }
  });

  it('every src and href in index.html starts with /assets/', () => {
    const html = readFileSync(indexPath, 'utf8');
    const refs = [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(r.startsWith('/assets/'), r).toBe(true);
  });

  it('every asset has a safe name and an allowed extension', () => {
    const names = assets();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(NAME.test(n), n).toBe(true);
      expect(EXT.test(n), n).toBe(true);
    }
  });
});
