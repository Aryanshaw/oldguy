// The `yap audit <chapter.json> --root <repo>` command: reads a chapter file and prints each failure.
import fs from 'node:fs';
import { audit } from '../lib/audit.mts';
import type { AuditSentence, Source } from '../lib/audit.mts';

// The parts of chapter.json the audit reads.
type ChapterFile = { sources: Source[]; sentences: AuditSentence[]; scene?: unknown };

// Pulls the chapter path and --root value out of the arguments; returns null if either is missing.
function parseArgs(args: string[]): { chapter: string; root: string } | null {
  const rootAt = args.indexOf('--root');
  const root = rootAt === -1 ? undefined : args[rootAt + 1];
  const chapter = args.find((a, i) => !a.startsWith('--') && i !== rootAt + 1);
  return chapter && root ? { chapter, root } : null;
}

// Loads chapter.json and checks it has the sources and sentences lists the audit needs.
function loadChapter(file: string): ChapterFile {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { sources?: unknown; sentences?: unknown; scene?: unknown };
  if (!Array.isArray(data.sources) || !Array.isArray(data.sentences)) {
    throw new Error('chapter needs "sources" and "sentences" lists');
  }
  // both lists were just proved to be lists; the audit itself checks what is inside them
  return data as ChapterFile;
}

// Runs the audit; exit 0 = clean, 1 = failures printed one per line, 2 = usage or unreadable chapter.
function runAudit(args: string[]): number {
  const parsed = parseArgs(args);
  if (!parsed) {
    process.stderr.write('usage: yap audit <chapter.json> --root <repo>\n');
    return 2;
  }
  let chapter: ChapterFile;
  try {
    chapter = loadChapter(parsed.chapter);
  } catch (err) {
    process.stderr.write(`yap audit: cannot use chapter file ${parsed.chapter}: ${(err as Error).message}\n`);
    return 2;
  }
  const result = audit({ root: parsed.root, sources: chapter.sources, sentences: chapter.sentences, scene: chapter.scene });
  for (const f of result.failures) process.stdout.write(`${f.id}: ${f.reason}\n`);
  return result.ok ? 0 : 1;
}

export { runAudit };
