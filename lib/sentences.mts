// Words whose trailing full stop is not the end of a sentence.
const ABBREVIATION_BEFORE_DOT = /(?:^|[\s(])(?:e\.g|i\.e|vs|etc)$/i;
// Characters that may sit between the end mark and the space (closing quote or bracket).
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»']);
// What the next sentence may start with: a capital, a digit, an opening quote or bracket.
const SENTENCE_START = /^[\p{Lu}\d"'“‘(\[]/u;

// Tells whether the text at `pos` looks like the start of a new sentence.
function startsSentence(text: string, pos: number): boolean {
  // the caller checks pos is inside the text, so a code point is always there
  const ch = String.fromCodePoint(text.codePointAt(pos) as number);
  return SENTENCE_START.test(ch);
}

// Finds where a run of . ! ? marks ends, starting at `i`.
function endOfMarkRun(text: string, i: number): number {
  let k = i;
  while (k < text.length && '.!?'.includes(text[k])) k++;
  return k;
}

// A single full stop after e.g / i.e / vs / etc is not a sentence end.
function isAbbreviation(text: string, i: number, runEnd: number): boolean {
  if (text[i] !== '.' || runEnd - i !== 1) return false;
  return ABBREVIATION_BEFORE_DOT.test(text.slice(Math.max(0, i - 4), i));
}

// A run like "..." is an ellipsis and stays inside its sentence.
function isEllipsis(text: string, i: number, runEnd: number): boolean {
  return text[i] === '.' && runEnd - i > 1;
}

// Splits narration into sentences; never throws, same input gives same output.
function splitSentences(input: unknown): string[] {
  // newlines and runs of spaces become one space so a sentence is one line
  const text = String(input ?? '').replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '`') {
      // jump over a whole code span so dots inside it never split
      const close = text.indexOf('`', i + 1);
      i = close === -1 ? i + 1 : close + 1;
    } else if (ch === '.' || ch === '!' || ch === '?') {
      const runEnd = endOfMarkRun(text, i);
      let m = runEnd;
      while (m < text.length && CLOSERS.has(text[m])) m++;
      const splits = text[m] === ' ' && m + 1 < text.length && startsSentence(text, m + 1)
        && !isEllipsis(text, i, runEnd) && !isAbbreviation(text, i, runEnd);
      if (splits) {
        out.push(text.slice(start, m));
        start = m + 1;
      }
      i = m;
    } else {
      i++;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

export { splitSentences };
