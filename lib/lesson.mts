// Lesson check: the rules that make a video teach instead of list, checked over a whole video folder before any
// chapter is made. A viewer follows one example through the flow, hears what each step means for them, and reads
// labels on screen while listening instead of a second copy of the narration. See skills/oldguy/references/teaching.md.
import fs from 'node:fs';
import path from 'node:path';
import { readOrder } from './chapter-scan.mts';

// One thing that breaks a lesson rule: where ("video", a chapter id, "<id> sentence 2") and why.
type LessonFinding = { id: string; reason: string };

// One chapter as the lesson check reads it: its sentences, the text of each scene file it designs, the labels its
// ready pieces show, and whether it puts code on screen (a code card, or code in a designed scene).
type LessonChapter = { id: string; sentences: { text: string }[]; scenes: string[]; labels?: string[]; code?: boolean };

// The whole video: the running example named in script.md (null when it names none) and the chapters in story order.
type LessonInput = { example: string | null; chapters: LessonChapter[] };

// A sentence longer than this is two sentences.
const MAX_SENTENCE_WORDS = 25;
// A chapter's sentences average at most this many words.
const MAX_AVERAGE_WORDS = 18;
// More sentences than this is more than one idea: split the chapter.
const MAX_SENTENCES = 8;
// On-screen text longer than this is a sentence to read, not a label to glance at.
const MAX_LABEL_WORDS = 8;
// Share of chapters that must name the running example, and show it on screen.
const EXAMPLE_SHARE = 0.7;
// A chapter that names the example does so within its first sentences, so it opens on where the example is.
const EXAMPLE_OPENING = 2;
// The closing line of the video is a recap the viewer could repeat.
const MAX_RECAP_WORDS = 12;
// At least this share of chapters shows real code.
const CODE_SHARE = 0.5;
// A sentence that says what a step means for the viewer starts with "So".
const CONSEQUENCE = /^So\b/;
// Words that point at another chapter by its place, or at a moment by its time: a chapter may be watched alone.
const POSITION_WORDS = /\b(next|previous|last|first|earlier|later|following|prior|second|third|fourth|fifth|\d+)\s+(chapter|part|section|video)\b|\b(chapter|part|section)\s+(\d+|one|two|three|four|five)\b|\b(coming up|up next)\b|\b\d+:\d\d\b/i;
// Small words that do not identify an example.
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'one', 'that', 'this', 'from', 'into', 'its', 'our', 'your', 'who', 'what']);

// Counts the words in a piece of text.
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// The words that identify the running example: its words of three letters or more, minus small common ones.
function exampleWords(example: string): string[] {
  return [...new Set(example.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])].filter((w) => !STOP_WORDS.has(w));
}

// True when a text names the example in full: every one of its words.
function namesExample(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.every((w) => new RegExp(`\\b${w}`).test(lower));
}

// Everything a viewer reads in a chapter: the designed scenes' text and the ready pieces' labels.
function screenTexts(chapter: LessonChapter): string[] {
  return [...chapter.scenes.flatMap(sceneTexts), ...(chapter.labels ?? [])];
}

// The text a viewer reads in a scene, one entry per run of text between tags; styles, scripts and code are left out
// because code is shown as it is in the repository.
function sceneTexts(html: string): string[] {
  const bare = html.replace(/<(style|script|pre|code)\b[\s\S]*?<\/\1>/gi, ' ');
  return bare.split(/<[^>]*>/).map((t) => t.replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// The sentence rules for one chapter: short sentences, a short chapter, one "So" line, no pointing by position.
function checkSentences(chapter: LessonChapter): LessonFinding[] {
  const out: LessonFinding[] = [];
  const counts = chapter.sentences.map((s) => wordCount(s.text));
  chapter.sentences.forEach((s, i) => {
    if (counts[i] > MAX_SENTENCE_WORDS) out.push({ id: `${chapter.id} sentence ${i}`, reason: `${counts[i]} words; at most ${MAX_SENTENCE_WORDS}, split it` });
    if (POSITION_WORDS.test(s.text)) out.push({ id: `${chapter.id} sentence ${i}`, reason: 'points at another chapter or a time; name the thing instead' });
  });
  if (chapter.sentences.length > MAX_SENTENCES) out.push({ id: chapter.id, reason: `${chapter.sentences.length} sentences; at most ${MAX_SENTENCES}, split the chapter` });
  const average = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
  if (average > MAX_AVERAGE_WORDS) out.push({ id: chapter.id, reason: `sentences average ${average.toFixed(1)} words; aim for 14, at most ${MAX_AVERAGE_WORDS}` });
  if (!chapter.sentences.some((s) => CONSEQUENCE.test(s.text.trim()))) out.push({ id: chapter.id, reason: 'no sentence starts with "So": say what this step means for the viewer' });
  return out;
}

// The screen rules for one chapter: labels, not sentences.
function checkScreen(chapter: LessonChapter): LessonFinding[] {
  const long = screenTexts(chapter).filter((t) => wordCount(t) > MAX_LABEL_WORDS);
  return long.map((t) => ({ id: chapter.id, reason: `on-screen text "${t.slice(0, 60)}" is ${wordCount(t)} words; show a label of at most ${MAX_LABEL_WORDS}, the voice says the rest` }));
}

// Checks a whole video against the lesson rules and returns every finding (none means it passes).
function checkLesson({ example, chapters }: LessonInput): LessonFinding[] {
  const out: LessonFinding[] = [];
  if (chapters.length === 0) return [{ id: 'video', reason: 'no chapters in order.json' }];
  for (const c of chapters) out.push(...checkSentences(c), ...checkScreen(c));
  const words = example ? exampleWords(example) : [];
  if (words.length === 0) {
    out.push({ id: 'video', reason: 'script.md names no running example: add a line "example: <the one thing the video follows>"' });
  } else {
    const allowed = chapters.length - Math.ceil(chapters.length * EXAMPLE_SHARE);
    const unsaid = chapters.filter((c) => !namesExample(c.sentences.map((s) => s.text).join(' '), words));
    if (unsaid.length > allowed) out.push({ id: 'video', reason: `the example "${example}" is not named in full in ${unsaid.map((c) => c.id).join(', ')}; follow it through at least ${Math.round(EXAMPLE_SHARE * 100)}% of chapters` });
    const unseen = chapters.filter((c) => !namesExample(screenTexts(c).join(' '), words));
    if (unseen.length > allowed) out.push({ id: 'video', reason: `the example "${example}" is not on screen in ${unseen.map((c) => c.id).join(', ')}; show it where it is` });
    for (const c of chapters) {
      const late = !unsaid.includes(c) && !namesExample(c.sentences.slice(0, EXAMPLE_OPENING).map((s) => s.text).join(' '), words);
      if (late) out.push({ id: c.id, reason: `the example is named only after sentence ${EXAMPLE_OPENING - 1}; open on where it is` });
    }
  }
  const withCode = chapters.filter((c) => c.code || c.scenes.some((html) => /<pre\b/i.test(html))).length;
  if (withCode < Math.ceil(chapters.length * CODE_SHARE)) out.push({ id: 'video', reason: `real code is on screen in ${withCode} of ${chapters.length} chapters; show it in at least half` });
  const last = chapters[chapters.length - 1].sentences.at(-1);
  if (last && wordCount(last.text) > MAX_RECAP_WORDS) out.push({ id: 'video', reason: `the closing line is ${wordCount(last.text)} words; end on a recap of at most ${MAX_RECAP_WORDS}` });
  const planned = chapters.filter((c) => c.scenes.some((html) => /\bog-planned\b/.test(html)));
  if (planned.length > 1) out.push({ id: 'video', reason: `the planned badge is in ${planned.length} chapters (${planned.map((c) => c.id).join(', ')}); say it once` });
  return out;
}

// Every string inside a piece's params: what a ready piece shows on screen.
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

// Reads the running example from script.md's "example:" line; null when the file or the line is missing.
function readExample(slugDir: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(slugDir, 'script.md'), 'utf8');
  } catch {
    return null;
  }
  const m = /^example:\s*(.+)$/im.exec(text);
  return m ? m[1].trim() : null;
}

// Reads one chapter's spec and the scene files it designs; a missing or broken spec is a finding.
function readChapter(slugDir: string, id: string): LessonChapter | LessonFinding {
  let spec: { sentences?: unknown; scene?: unknown };
  try {
    spec = JSON.parse(fs.readFileSync(path.join(slugDir, 'specs', `${id}.json`), 'utf8'));
  } catch {
    return { id, reason: `specs/${id}.json is missing or not JSON` };
  }
  const sentences = (Array.isArray(spec.sentences) ? spec.sentences : [])
    .map((s: { text?: unknown }) => ({ text: typeof s?.text === 'string' ? s.text : '' }));
  const entries: { piece?: unknown; params?: unknown }[] = Array.isArray(spec.scene) ? spec.scene : [];
  const labels = entries.filter((e) => e?.piece !== 'design' && e?.piece !== 'code-card').flatMap((e) => stringsIn(e?.params));
  const code = entries.some((e) => e?.piece === 'code-card');
  const files = entries.flatMap((e) => {
    const file = e?.piece === 'design' ? (e.params as { file?: unknown } | undefined)?.file : undefined;
    return typeof file === 'string' ? [file] : [];
  });
  const scenes: string[] = [];
  for (const file of files) {
    const full = path.resolve(slugDir, file);
    // a scene outside the video folder is scaffold's to refuse; here it is just not read
    if (!full.startsWith(path.resolve(slugDir) + path.sep)) continue;
    try { scenes.push(fs.readFileSync(full, 'utf8')); } catch { return { id, reason: `${file} cannot be read` }; }
  }
  return { id, sentences, scenes, labels, code };
}

// Checks the video folder: the chapters in order.json, their specs and scenes, and script.md's example.
function checkLessonFolder(slugDir: string): LessonFinding[] {
  const { ids } = readOrder(slugDir);
  if (!ids) return [{ id: 'video', reason: 'no order.json: run oldguy order first' }];
  const read = ids.map((id) => readChapter(slugDir, id));
  const broken = read.filter((r): r is LessonFinding => 'reason' in r);
  const chapters = read.filter((r): r is LessonChapter => !('reason' in r));
  return [...broken, ...checkLesson({ example: readExample(slugDir), chapters })];
}

export { checkLesson, checkLessonFolder, sceneTexts, exampleWords, MAX_SENTENCE_WORDS, MAX_SENTENCES, MAX_LABEL_WORDS, MAX_RECAP_WORDS };
export type { LessonFinding, LessonChapter, LessonInput };
