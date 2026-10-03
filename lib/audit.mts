// Claim audit: proves every claim in a chapter's narration points at real code, and every code-card line shows the
// repository's real line (whole, or visibly cut with …).
import fs from 'node:fs';
import path from 'node:path';

// One thing that failed the audit: where (a source id, "sentence 2", "scene[0] line 4") and why.
type Finding = { id: string; reason: string };

// What audit reports: whether everything held, and every failure found.
type AuditResult = { ok: boolean; failures: Finding[] };

// One source a claim can point at: a file, a 1-based inclusive line range and a quote that must sit on those lines.
// The shape is the chapter spec's contract; its fields are validated again here, so the loose ones stay unknown.
type Source = { id?: unknown; file: string; lines?: unknown; quote?: unknown };

// One narration sentence as the audit reads it.
type AuditSentence = { kind?: unknown; source_ids?: unknown };

// The params of a code-card scene entry, before they are checked.
type CodeCardParams = { file?: unknown; lines?: unknown };

// One scene entry; only code-card entries are audited.
type SceneEntry = { piece?: unknown; params?: CodeCardParams | null };

// One code-card line as written in the scene, before it is checked.
type CardLineInput = { no?: unknown; text?: unknown };

// What audit takes: the repository root, the sources, the sentences and (optionally) the scene.
type AuditInput = { root: string; sources: Source[]; sentences: AuditSentence[]; scene?: unknown };

// Either why a file cannot be used, or the thing found.
type Failed = { reason: string };

const MAX_FILE_BYTES = 2 * 1024 * 1024;
// The mark a code-card line must end with when it shows only the start of a longer line.
const CUT_MARK = '…';
const TAB_SPACES = '    ';
const DIFFERS = 'text differs from the repository line';

// Collapses all whitespace runs (tabs, CRLF, spaces) to one space so layout differences do not matter.
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// True when a relative path (from path.relative or path.normalize) is absolute or climbs out with "..".
function escapesRoot(rel: string): boolean {
  return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
}

// Resolves a source path against the root and refuses anything whose real location leaves the root.
function resolveInsideRoot(root: string, file: string): Failed | { real: string } {
  let realRoot: string;
  let real: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return { reason: 'root not found' };
  }
  try {
    real = fs.realpathSync(path.resolve(realRoot, file));
  } catch {
    return { reason: `file not found: ${file}` };
  }
  const rel = path.relative(realRoot, real);
  if (escapesRoot(rel)) {
    return { reason: `file outside root: ${file}` };
  }
  return { real };
}

// Reads a source file as UTF-8 text; refuses non-files, huge files, binary and invalid UTF-8.
function readTextFile(real: string, file: string): Failed | { text: string } {
  const stat = fs.statSync(real);
  if (!stat.isFile()) return { reason: `not a regular file: ${file}` };
  if (stat.size > MAX_FILE_BYTES) return { reason: `file too large (over 2 MB): ${file}` };
  const bytes = fs.readFileSync(real);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('nul byte');
    return { text };
  } catch {
    return { reason: `not valid UTF-8 text: ${file}` };
  }
}

// True when the value is a whole number (a type guard, so the checks after it can compare it).
function isWholeNumber(value: unknown): value is number {
  return Number.isInteger(value);
}

// Checks the 1-based inclusive line range is whole numbers inside the file; returns a reason if not.
function checkLineRange(lines: unknown, lineCount: number): string | null {
  const [start, end]: unknown[] = Array.isArray(lines) ? lines : [];
  if (!isWholeNumber(start) || !isWholeNumber(end) || start < 1 || start > end) {
    return `invalid line range ${start}-${end}`;
  }
  if (end > lineCount) return `lines ${start}-${end} past end of file (${lineCount} lines)`;
  return null;
}

// Loads a repository file as its list of lines (CRLF read as LF), or says why it cannot be used.
function readRepoLines(root: string, file: string): Failed | { lines: string[] } {
  const located = resolveInsideRoot(root, file);
  if ('reason' in located) return located;
  const loaded = readTextFile(located.real, file);
  if ('reason' in loaded) return loaded;
  // a trailing newline does not start a new line, so drop it before counting
  return { lines: loaded.text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') };
}

// Returns the reason one source fails (bad file, bad range, quote not there) or null if it holds.
function checkSource(root: string, source: Source): string | null {
  const quote = normalise(typeof source.quote === 'string' ? source.quote : '');
  if (quote === '') return 'empty quote';
  const loaded = readRepoLines(root, source.file);
  if ('reason' in loaded) return loaded.reason;
  const { lines } = loaded;
  const rangeProblem = checkLineRange(source.lines, lines.length);
  if (rangeProblem) return rangeProblem;
  // checkLineRange just proved lines is two whole numbers
  const [start, end] = source.lines as [number, number];
  const joined = normalise(lines.slice(start - 1, end).join('\n'));
  return joined.includes(quote) ? null : `quote not on lines ${start}-${end}`;
}

// Splits a code line into its indentation width and its words: a tab counts as four spaces, CR and trailing
// whitespace are dropped, and inner whitespace runs collapse the way the claim audit's do.
function codeShape(text: string): { indent: number; body: string } {
  const plain = text.replace(/\r/g, '').replace(/\t/g, TAB_SPACES).trimEnd();
  return { indent: plain.length - plain.trimStart().length, body: normalise(plain) };
}

// Returns why one card line does not show its repository line, or null: it must equal the line, or be a strict
// prefix of a longer line that ends with … so the cut is visible.
function checkCardLine({ no, text }: { no: number; text: string }, fileLines: string[]): string | null {
  if (no > fileLines.length) return `line number past end of file (${fileLines.length} lines)`;
  const repo = codeShape(fileLines[no - 1]);
  const cut = text.trimEnd().endsWith(CUT_MARK);
  const shown = codeShape(cut ? text.trimEnd().slice(0, -CUT_MARK.length) : text);
  if (shown.indent !== repo.indent || !repo.body.startsWith(shown.body)) return DIFFERS;
  const longer = repo.body.length > shown.body.length;
  if (cut) return longer ? null : '… but line is not longer';
  return longer ? 'truncated without …' : null;
}

// Audits one code-card piece against its file; one failure for an unusable card, else one per wrong line.
function checkCodeCard(root: string, params: CodeCardParams | null | undefined, index: number): Finding[] {
  const card = `scene[${index}]`;
  if (!params || typeof params.file !== 'string' || !Array.isArray(params.lines)) {
    return [{ id: card, reason: 'code-card needs params with "file" and "lines"' }];
  }
  const loaded = readRepoLines(root, params.file);
  if ('reason' in loaded) return [{ id: card, reason: loaded.reason }];
  const failures: Finding[] = [];
  params.lines.forEach((line: CardLineInput | null | undefined, i: number) => {
    // a line the audit cannot place in the file is a failure, never skipped
    if (!line || !isWholeNumber(line.no) || line.no < 1 || typeof line.text !== 'string') {
      failures.push({ id: `${card} lines[${i}]`, reason: 'needs a whole line number "no" and "text"' });
      return;
    }
    const reason = checkCardLine({ no: line.no, text: line.text }, loaded.lines);
    if (reason) failures.push({ id: `${card} line ${line.no}`, reason });
  });
  return failures;
}

// Returns every reason one sentence fails; only the exact kind "framing" is exempt from needing sources.
function checkSentence(sentence: AuditSentence, knownIds: Set<unknown>): string[] {
  const reasons: string[] = [];
  if (sentence.kind === 'framing') return reasons;
  // anything else is held to the claim rule, so a typo cannot slip past the check
  const ids: unknown[] = Array.isArray(sentence.source_ids) ? sentence.source_ids : [];
  if (ids.length === 0) reasons.push('claim has no source ids');
  const unknown = ids.find((id) => !knownIds.has(id));
  if (unknown !== undefined) reasons.push(`unknown source id ${unknown}`);
  // make a misspelt kind visible instead of silently treating it as a claim
  if (sentence.kind !== 'claim') reasons.push(`unknown kind "${sentence.kind}"`);
  return reasons;
}

// Audits every source, sentence and code-card piece and reports all failures, not just the first.
// A missing scene means no cards (scaffold and narrate already insist the scene is a list).
function audit({ root, sources, sentences, scene = [] }: AuditInput): AuditResult {
  const failures: Finding[] = [];
  const knownIds = new Set(sources.map((s) => s.id));
  for (const source of sources) {
    const reason = checkSource(root, source);
    if (reason) failures.push({ id: String(source.id), reason });
  }
  sentences.forEach((sentence, index) => {
    for (const reason of checkSentence(sentence, knownIds)) failures.push({ id: `sentence ${index}`, reason });
  });
  (Array.isArray(scene) ? scene : []).forEach((entry: SceneEntry | null | undefined, index: number) => {
    if (entry && entry.piece === 'code-card') failures.push(...checkCodeCard(root, entry.params, index));
  });
  return { ok: failures.length === 0, failures };
}

export { audit, escapesRoot };
export type { Finding, AuditResult, AuditInput, Source, AuditSentence };
