// The `yap audit <chapter.json> --root <repo>` command: reads a chapter file and prints each failure.
const fs = require('node:fs');
const { audit } = require('../lib/audit.cjs');

// Pulls the chapter path and --root value out of the arguments; returns null if either is missing.
function parseArgs(args) {
  const rootAt = args.indexOf('--root');
  const root = rootAt === -1 ? undefined : args[rootAt + 1];
  const chapter = args.find((a, i) => !a.startsWith('--') && i !== rootAt + 1);
  return chapter && root ? { chapter, root } : null;
}

// Loads chapter.json and checks it has the sources and sentences lists the audit needs.
function loadChapter(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.sources) || !Array.isArray(data.sentences)) {
    throw new Error('chapter needs "sources" and "sentences" lists');
  }
  return data;
}

// Runs the audit; exit 0 = clean, 1 = failures printed one per line, 2 = usage or unreadable chapter.
function runAudit(args) {
  const parsed = parseArgs(args);
  if (!parsed) {
    process.stderr.write('usage: yap audit <chapter.json> --root <repo>\n');
    return 2;
  }
  let chapter;
  try {
    chapter = loadChapter(parsed.chapter);
  } catch (err) {
    process.stderr.write(`yap audit: cannot use chapter file ${parsed.chapter}: ${err.message}\n`);
    return 2;
  }
  const result = audit({ root: parsed.root, sources: chapter.sources, sentences: chapter.sentences, scene: chapter.scene });
  for (const f of result.failures) process.stdout.write(`${f.id}: ${f.reason}\n`);
  return result.ok ? 0 : 1;
}

module.exports = { runAudit };
