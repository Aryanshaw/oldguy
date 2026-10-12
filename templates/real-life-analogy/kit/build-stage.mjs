// Writes ../stage.html from the kit: the palette tokens, the paper-card styles and the hand-lettered font. The stage
// driver copies only a template's background and speaker pictures into a chapter folder, so the font travels inline,
// as a data URL in an @font-face (Patrick Hand, SIL Open Font License 1.1, see fonts/OFL.txt). Run it after changing
// kit.js's CSS:  node templates/real-life-analogy/kit/build-stage.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(new URL(import.meta.url).pathname);
const RLA = createRequire(import.meta.url)(path.join(here, 'kit.js'));
const font = fs.readFileSync(path.join(here, 'fonts', 'patrick-hand.woff2')).toString('base64');
const stage = [
  '<style>',
  '/* Real-Life Analogy: TED-Ed-style flat illustration. Written by kit/build-stage.mjs; edit kit.js, not this file.',
  '   The scene (built with kit/kit.js) fills the frame and paints its own ground past the frame edges, so the tall',
  '   and square shapes are ground all the way. Font: Patrick Hand by Patrick Wagesreiter, SIL OFL 1.1. */',
  `@font-face { font-family: 'RLA Hand'; font-style: normal; font-weight: 400; src: url(data:font/woff2;base64,${font}) format('woff2'); }`,
  `#root { background: ${RLA.P.indigo}; }`,
  RLA.CSS,
  '</style>',
  '<!-- oldguy:slot -->',
  '',
].join('\n');
fs.writeFileSync(path.join(here, '..', 'stage.html'), stage);
console.log(`stage.html written (${Math.round(stage.length / 1024)} KB)`);
