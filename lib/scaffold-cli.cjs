'use strict';
// The `yap scaffold <spec.json> --root <dir>` command: creates a chapter folder from a spec file.
const fs = require('node:fs');
const { parseFlags } = require('./cli-args.cjs');
const { scaffoldChapter } = require('./chapter.cjs');

const HELP = `usage: yap scaffold <spec.json> --root <dir>
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
"beat" is the 0-based index of the sentence a piece appears with; beats must go up. A piece stays on screen
until the next piece's beat starts; the last one stays until the chapter ends.
`;

// Reads the spec file and creates the chapter; exit 0 = created, 1 = spec refused, 2 = usage.
function runScaffold(args) {
  if (args.includes('--help')) {
    process.stdout.write(HELP);
    return 0;
  }
  let positional;
  let flags;
  try {
    ({ positional, flags } = parseFlags(args, ['--root']));
  } catch (err) {
    process.stderr.write(`yap scaffold: ${err.message}\n${HELP}`);
    return 2;
  }
  if (positional.length !== 1 || !flags['--root']) {
    process.stderr.write(HELP);
    return 2;
  }
  try {
    const spec = JSON.parse(fs.readFileSync(positional[0], 'utf8'));
    const dir = scaffoldChapter({ ...spec, root: flags['--root'] });
    process.stdout.write(`${dir}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`yap scaffold: ${String(err.message).replace(/\s*\n\s*/g, ' ')}\n`);
    return 1;
  }
}

module.exports = { runScaffold };
