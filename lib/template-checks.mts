// The checks a template adds to a chapter, on top of the ones every chapter already has. A template can only add
// checks: who may speak, how long a line may be, and where a keyword anchor points. The claim rule (every claim cites
// a real source) lives in lib/audit.mts and never looks at the template.
import type { Template } from './template.mts';

// One problem: where (sentence 2, scene[0]) and why.
type TemplateFinding = { id: string; reason: string };
// What the checks read from a sentence and a scene entry; anything else is ignored here.
type CheckedSentence = { text?: unknown; speaker?: unknown };
type CheckedScene = { beat?: unknown; word?: unknown };

// The words of a sentence as a viewer hears them: split on spaces, punctuation around each word dropped, lower-cased.
function spokenWords(text: string): string[] {
  return text.split(/\s+/).map((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
}

// Counts the words in a sentence the way the words-per-line cap counts them (anything between spaces is one word).
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Lists every way the sentences and scene break the template's rules (an empty list when they hold).
function checkAgainstTemplate(sentences: CheckedSentence[], scene: unknown, t: Template): TemplateFinding[] {
  const found: TemplateFinding[] = [];
  const ids = t.speakers.map((s) => s.id);
  const cap = t.pace.max_words_per_line;
  sentences.forEach((s, i) => {
    const at = `sentence ${i}`;
    if (s.speaker !== undefined) {
      if (ids.length === 0) found.push({ id: at, reason: `template ${t.id} has a narrator only; remove "speaker"` });
      else if (typeof s.speaker !== 'string' || !ids.includes(s.speaker)) found.push({ id: at, reason: `unknown speaker "${String(s.speaker)}"; template ${t.id} has ${ids.join(', ')}` });
    } else if (ids.length > 0) {
      found.push({ id: at, reason: `needs a "speaker": one of ${ids.join(', ')}` });
    }
    const text = typeof s.text === 'string' ? s.text : '';
    if (cap !== undefined && wordCount(text) > cap) found.push({ id: at, reason: `${wordCount(text)} words; template ${t.id} allows ${cap} per line` });
  });
  (Array.isArray(scene) ? scene : []).forEach((entry: CheckedScene | null, i: number) => {
    if (!entry || entry.word === undefined) return;
    const at = `scene[${i}]`;
    const beat = typeof entry.beat === 'number' ? sentences[entry.beat] : undefined;
    const word = typeof entry.word === 'string' ? spokenWords(entry.word) : [];
    if (word.length !== 1) { found.push({ id: at, reason: '"word" must be one word from its sentence' }); return; }
    const text = beat && typeof beat.text === 'string' ? beat.text : '';
    if (!spokenWords(text).includes(word[0])) found.push({ id: at, reason: `"word" "${String(entry.word)}" is not in sentence ${String(entry.beat)}` });
  });
  return found;
}

export { checkAgainstTemplate, spokenWords, wordCount };
export type { TemplateFinding };
