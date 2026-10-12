// The timing record a chapter page is built from: when each line (sentence) starts and ends, who says it, and when
// each word is said. Narrate fills the lines from the audio; the words come from inside each line, estimated from
// word length (the same estimate the captions have always used), so word captions work without whisper.
import { spokenWords } from './template-checks.mts';

// One spoken line: its time span, its speaker (absent for the narrator), its kind and the sources a claim cites.
type TimedLine = { text: string; start: number; end: number; speaker?: string; kind: 'claim' | 'framing'; chips: string[] };
// One spoken word: the line it belongs to, the text shown, and its time span.
type TimedWord = { line: number; text: string; start: number; end: number };
// Everything a stage needs to place things in time.
type Timing = { durationS: number; lines: TimedLine[]; words: TimedWord[] };

// Splits each line's time across its words by length (a short word gets a short slice), in order.
function estimateWords(lines: { text: string; start: number; end: number }[]): TimedWord[] {
  return lines.flatMap((l, line) => {
    const parts = l.text.split(/\s+/).filter(Boolean);
    const total = parts.reduce((n, p) => n + p.length, 0) || 1;
    let used = 0;
    return parts.map((text) => {
      const start = l.start + (used / total) * (l.end - l.start);
      used += text.length;
      return { line, text, start, end: l.start + (used / total) * (l.end - l.start) };
    });
  });
}

// When a piece anchored to a word of its line appears: at that word, unless the word falls in the last third of the
// line, where it would show only briefly, so then at the line's start (spike finding 4). No word: the line's start.
function anchorTime(timing: Timing, line: number, word?: string): number {
  const start = timing.lines[line].start;
  if (word === undefined) return start;
  const target = spokenWords(word)[0];
  const words = timing.words.filter((w) => w.line === line);
  const at = words.findIndex((w) => spokenWords(w.text)[0] === target);
  if (at === -1 || at >= Math.ceil((words.length * 2) / 3)) return start;
  return words[at].start;
}

export { estimateWords, anchorTime };
export type { Timing, TimedLine, TimedWord };
