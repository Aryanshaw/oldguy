// Builds stage.html from stage.src.html: every PIC(name) becomes assets/<name>.webp as a data URI. The stage driver
// copies only speaker pictures and background footage into a chapter, so the reacting poses and the props travel
// inside the stage itself. Run after changing stage.src.html or a picture:  node templates/old-and-new/build-stage.mjs
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const src = fs.readFileSync(path.join(here, 'stage.src.html'), 'utf8');
const out = src.replace(/PIC\(([a-z/-]+)\)/g, (_, name) => {
  const bytes = fs.readFileSync(path.join(here, 'assets', `${name}.webp`));
  return `"data:image/webp;base64,${bytes.toString('base64')}"`;
});
fs.writeFileSync(path.join(here, 'stage.html'), out);
console.log(`stage.html: ${out.length} bytes`);
