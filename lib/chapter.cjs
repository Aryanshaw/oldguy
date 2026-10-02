'use strict';
// A chapter folder: creating it from a spec, timing its scene pieces, and building its root composition.
const fs = require('node:fs');
const path = require('node:path');
const { splitSentences } = require('./sentences.cjs');

const KIT_DIR = path.join(__dirname, '..', 'scene-kit');
const GSAP_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';
const MAX_ID_LENGTH = 60;

// The scene pieces a chapter may use, by the name written in chapter.json.
const PIECES = {
  title: require('../scene-kit/title.cjs'),
  steps: require('../scene-kit/steps.cjs'),
  'code-card': require('../scene-kit/code-card.cjs'),
  callout: require('../scene-kit/callout.cjs'),
};

// Turns a free-text id into a folder name: lower-case a-z0-9 words joined by single hyphens, never starting with a digit.
function slugChapterId(raw) {
  const text = String(raw ?? '');
  // a slash means someone passed a path; refuse it rather than quietly rewrite it into something else
  if (/[\\/]/.test(text)) throw new Error(`chapter id "${text}" looks like a path; give a plain name`);
  const slug = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-0-9]+/, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/, '');
  if (!slug) throw new Error(`chapter id "${text}" is empty once reduced to letters, digits and hyphens`);
  return slug;
}

// Splits narration into sentences and insists on exactly one per listed sentence (one sentence per beat).
function narrationSentences(text, expected) {
  const sentences = splitSentences(text);
  if (sentences.length !== expected) {
    throw new Error(`narration has ${sentences.length} sentences but the chapter lists ${expected}; each listed sentence must be exactly one sentence`);
  }
  return sentences;
}

// Renders one piece with the scene kit; an unknown piece name is an error that lists the ones that exist.
function renderPiece({ piece, params }, window) {
  if (!Object.hasOwn(PIECES, piece)) {
    throw new Error(`unknown piece "${piece}"; use one of ${Object.keys(PIECES).join('|')}`);
  }
  return PIECES[piece].render(params, window);
}

// Checks each scene entry: a known piece with params the kit accepts, on a whole beat index that moves forward.
function checkScene(scene, sentenceCount) {
  if (!Array.isArray(scene)) throw new Error('"scene" must be a list');
  let previousBeat = -1;
  scene.forEach((entry, i) => {
    const beat = entry && entry.beat;
    if (!Number.isInteger(beat) || beat < 0 || beat >= sentenceCount || beat <= previousBeat) {
      throw new Error(`scene[${i}]: beat must be a whole sentence index from 0 to ${sentenceCount - 1}, after the previous piece's beat`);
    }
    previousBeat = beat;
    // a throwaway render lets the scene kit itself reject bad params (such as an unknown pointTo)
    try {
      renderPiece(entry, { startS: 0, durationS: 1, idPrefix: 'check' });
    } catch (err) {
      throw new Error(`scene[${i}]: ${err.message}`);
    }
  });
}

// Checks the sentence list has text on every entry and that joined up it still reads as that many sentences.
function checkSentences(sentences) {
  if (!Array.isArray(sentences) || sentences.length === 0) throw new Error('"sentences" must be a non-empty list');
  sentences.forEach((s, i) => {
    if (!s || typeof s.text !== 'string' || !s.text.trim()) throw new Error(`sentences[${i}] needs non-empty "text"`);
  });
  const narration = sentences.map((s) => s.text).join(' ');
  narrationSentences(narration, sentences.length);
  return narration;
}

// Creates chapters/<slug>/ with chapter.json and narration.txt; checks everything first and never overwrites.
function scaffoldChapter({ root, id, title, sources, sentences, scene }) {
  const slug = slugChapterId(id);
  if (typeof title !== 'string' || !title.trim()) throw new Error('"title" must be non-empty text');
  if (!Array.isArray(sources)) throw new Error('"sources" must be a list');
  const narration = checkSentences(sentences);
  checkScene(scene, sentences.length);

  const chaptersDir = path.join(root, 'chapters');
  const dir = path.join(chaptersDir, slug);
  // the slug has no dots or slashes, but prove the folder sits inside chapters/ before writing anything
  if (path.dirname(dir) !== chaptersDir) throw new Error(`chapter id "${slug}" would leave the chapters folder`);
  fs.mkdirSync(chaptersDir, { recursive: true });
  try {
    fs.mkdirSync(dir);
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`chapter "${slug}" already exists at ${dir}; pick another id or remove it`);
    throw err;
  }
  const chapter = { id: slug, title, sources, sentences, scene };
  fs.writeFileSync(path.join(dir, 'chapter.json'), `${JSON.stringify(chapter, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'narration.txt'), `${narration}\n`);
  return dir;
}

// Rounds a length in seconds up to the next tenth; an exact tenth stays (integer maths so 9.4 is not read as 9.400001).
function roundUpTenth(seconds) {
  return Math.ceil(Math.round(seconds * 1e6) / 1e5) / 10;
}

// Gives each scene piece its time window: from its sentence's start to the next piece's start, the last to the end.
function pieceWindows(scene, beats, durationS) {
  return scene.map((entry, i) => {
    const startS = beats[entry.beat].start;
    const endS = i + 1 < scene.length ? beats[scene[i + 1].beat].start : durationS;
    return { piece: entry.piece, params: entry.params, startS, durationS: Number((endS - startS).toFixed(3)) };
  });
}

// Builds the standalone chapter page: one 1920x1080 root, the theme, GSAP, and every piece on one paused timeline.
function buildRootComposition({ id, durationS, pieces }) {
  // the id lands in an attribute and a script, so only an already-slugged id is accepted
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`composition id "${id}" must be a slug (a-z, 0-9, hyphens)`);
  if (!Number.isFinite(durationS) || durationS <= 0) throw new Error('composition duration must be a number of seconds above 0');
  const theme = fs.readFileSync(path.join(KIT_DIR, 'theme.css'), 'utf8');
  const rendered = pieces.map((p, i) => renderPiece(p, { startS: p.startS, durationS: p.durationS, idPrefix: `p${i}` }));
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=1920, height=1080" />',
    `<title>${id}</title>`,
    `<script src="${GSAP_URL}"></script>`,
    // the stage is a fixed 1920x1080 box the pieces are laid over
    '<style>',
    'html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: var(--yk-black); }',
    '#root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: var(--yk-black); }',
    theme,
    '</style>',
    '</head>',
    '<body>',
    `<div id="root" data-composition-id="${id}" data-start="0" data-width="1920" data-height="1080" data-duration="${durationS}">`,
    ...rendered.map((r) => r.html),
    '</div>',
    '<script>',
    'const tl = gsap.timeline({ paused: true });',
    ...rendered.map((r) => r.timeline).filter(Boolean),
    `window.__timelines[${JSON.stringify(id)}] = tl;`,
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

module.exports = { slugChapterId, scaffoldChapter, checkScene, buildRootComposition, pieceWindows, roundUpTenth, narrationSentences };
