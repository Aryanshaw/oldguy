// The `oldguy scaffold <spec.json> --root <dir>` command: creates a chapter folder from a spec file.
import fs from 'node:fs';
import { parseFlags } from './args.mts';
import { scaffoldChapter } from '../lib/chapter.mts';
import type { ScaffoldInput } from '../lib/chapter.mts';

const HELP = `usage: oldguy scaffold <spec.json> --root <dir>
Creates <dir>/chapters/<id>/ with chapter.json and narration.txt, then prints that folder.
spec.json:
  {"id": "What if it fails?", "title": "What if it fails?",
   "sources":   [{"id": "s1", "file": "app/jobs.py", "lines": [10, 14], "quote": "exact text on those lines"}],
   "sentences": [{"text": "exactly one sentence", "kind": "claim" | "framing", "source_ids": ["s1"]}],
   "scene":     [{"piece": "title", "params": {...}, "beat": 0}]}
The id is slugged (a-z, 0-9, single hyphens, no leading digits, at most 60 characters); an existing chapter is never overwritten.
Pieces and their params:
  title      {"heading": text, "sub": text (optional)}
  steps      {"items": [{"label": text, "detail": text (optional)}]}
  code-card  {"file": text, "lines": [{"no": number, "text": text, "highlight": true (optional)}]}
             each line is the repository line as it is, or its start cut at 68 columns ending in …
  callout    {"text": text, "pointTo": up|down|left|right (optional, default down)}
  flow       {"kicker": text (optional), "heading": text (optional),
              "lanes": [{"id": lane-id, "label": text, "note": text (optional)}] (2 to 5),
              "steps": [{"lane": lane-id, "label": text, "detail": text (optional), "at": sentence index,
                         "kind": ok|fail (optional)}] (1 to 14, at most 6 per lane)}
             a diagram that stays up: each step appears with sentence "at" (from the piece's beat to before the
             next piece's beat, never going back) and stays; the newest step and its lane light up
  design     {"file": "scenes/<id>.html" (inside the --root folder; copied into chapter.json) or "html": text}
             a scene you design: <style>, markup on a 1920x1080 stage, and one <script data-oldguy-timeline> of
             tl.from/to/fromTo/set calls timed with beat(n), startS and endS; no scripts, handlers, src/href or url()
"beat" is the 0-based index of the sentence a piece appears with; beats must go up. A piece stays on screen
until the next piece's beat starts; the last one stays until the chapter ends.
`;

// Reads the spec file and creates the chapter; exit 0 = created, 1 = spec refused, 2 = usage.
function runScaffold(args: string[]): number {
  if (args.includes('--help')) {
    process.stdout.write(HELP);
    return 0;
  }
  let positional: string[];
  let flags: Record<string, string>;
  try {
    ({ positional, flags } = parseFlags(args, ['--root']));
  } catch (err) {
    process.stderr.write(`oldguy scaffold: ${(err as Error).message}\n${HELP}`);
    return 2;
  }
  if (positional.length !== 1 || !flags['--root']) {
    process.stderr.write(HELP);
    return 2;
  }
  try {
    // read as it is; scaffoldChapter checks every field
    const spec = JSON.parse(fs.readFileSync(positional[0], 'utf8')) as Omit<ScaffoldInput, 'root'>;
    const dir = scaffoldChapter({ ...spec, root: flags['--root'] });
    process.stdout.write(`${dir}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`oldguy scaffold: ${String((err as Error).message).replace(/\s*\n\s*/g, ' ')}\n`);
    return 1;
  }
}

export { runScaffold };
