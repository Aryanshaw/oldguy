// The `oldguy audit <chapter.json> --root <repo> [--template <id or folder>]` command: reads a chapter file and prints
// each failure. The template's rules are added to the claim checks: by default the template of the video folder the
// chapter sits in (explainer when it chose none); --template names another, or a template folder being written.
import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../lib/audit.mts';
import { loadTemplate } from '../lib/template.mts';
import { templateOfVideo, slugDirOfChapter } from '../lib/settings.mts';
import type { AuditSentence, Source } from '../lib/audit.mts';
import type { Template } from '../lib/template.mts';

// The parts of chapter.json the audit reads.
type ChapterFile = { sources: Source[]; sentences: AuditSentence[]; scene?: unknown };

const USAGE = 'usage: oldguy audit <chapter.json> --root <repo> [--template <id or folder>]';

// Pulls the chapter path, --root and --template values out of the arguments; returns null if the chapter or root is missing.
function parseArgs(args: string[]): { chapter: string; root: string; template?: string } | null {
  const valueOf = (flag: string) => {
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
  };
  const taken = new Set(['--root', '--template'].map((f) => args.indexOf(f) + 1).filter((i) => i > 0));
  const root = valueOf('--root');
  const chapter = args.find((a, i) => !a.startsWith('--') && !taken.has(i));
  return chapter && root ? { chapter, root, template: valueOf('--template') } : null;
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

// The template to audit against: a folder holding template.json, a shipped id, or the chapter's video folder's template.
function chooseTemplate(given: string | undefined, chapterFile: string): Template {
  if (given === undefined) return templateOfVideo(slugDirOfChapter(path.dirname(chapterFile)));
  if (fs.existsSync(path.join(given, 'template.json'))) return loadTemplate(path.basename(path.resolve(given)), path.dirname(path.resolve(given)));
  return loadTemplate(given);
}

// Runs the audit; exit 0 = clean, 1 = failures printed one per line, 2 = usage, unreadable chapter or unknown template.
function runAudit(args: string[]): number {
  const parsed = parseArgs(args);
  if (!parsed) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  let chapter: ChapterFile;
  let template: Template;
  try {
    chapter = loadChapter(parsed.chapter);
  } catch (err) {
    process.stderr.write(`oldguy audit: cannot use chapter file ${parsed.chapter}: ${(err as Error).message}\n`);
    return 2;
  }
  try {
    template = chooseTemplate(parsed.template, parsed.chapter);
  } catch (err) {
    process.stderr.write(`oldguy audit: ${(err as Error).message}\n`);
    return 2;
  }
  const result = audit({ root: parsed.root, sources: chapter.sources, sentences: chapter.sentences, scene: chapter.scene, template });
  for (const f of result.failures) process.stdout.write(`${f.id}: ${f.reason}\n`);
  return result.ok ? 0 : 1;
}

export { runAudit };
