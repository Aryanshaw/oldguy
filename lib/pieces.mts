// The scene pieces a chapter is drawn from, by the name chapter.json uses, and the files every chapter page loads.
import path from 'node:path';
import * as title from '../scene-kit/title.mts';
import * as steps from '../scene-kit/steps.mts';
import * as codeCard from '../scene-kit/code-card.mts';
import * as callout from '../scene-kit/callout.mts';
import * as flow from '../scene-kit/flow.mts';
import * as design from '../scene-kit/design.mts';
import type { Rendered } from '../scene-kit/shared.mts';

const KIT_DIR = path.join(import.meta.dirname, '..', 'scene-kit');
// GSAP 3.14.2 from the npm package, kept in the repo (see scene-kit/vendor/README.md). Narrate copies it into the
// chapter folder and the page loads it from there, so checking and rendering a chapter need no network.
const GSAP_NAME = 'gsap.min.js';
const GSAP_FILE = path.join(KIT_DIR, 'vendor', GSAP_NAME);

// The scene pieces a chapter may use, by the name written in chapter.json.
const PIECES: Record<string, { render: (params: unknown, opts: unknown) => Rendered }> = {
  title,
  steps,
  'code-card': codeCard,
  callout,
  flow,
  design,
};

// Renders one piece with the scene kit; an unknown piece name is an error that lists the ones that exist.
function renderPiece({ piece, params }: { piece: string; params: unknown }, window: unknown): Rendered {
  if (!Object.hasOwn(PIECES, piece)) {
    throw new Error(`unknown piece "${piece}"; use one of ${Object.keys(PIECES).join('|')}`);
  }
  return PIECES[piece].render(params, window);
}

export { renderPiece, KIT_DIR, GSAP_NAME, GSAP_FILE };
