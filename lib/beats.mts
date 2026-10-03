// One spoken word with its start and end time in seconds.
type Word = { text: string; start: number; end: number };

// One sentence with its start and end time in seconds.
type Beat = { text: string; start: number; end: number };

// Options for timing beats: how many seconds of lead-in silence come before the first one.
type BeatOptions = { leadS?: number };

// How far (in words) the end of a sentence may drift from where we expect it.
const RESYNC_WINDOW = 4;

// Lower-cases a word and drops punctuation so spoken and written forms compare equal.
function normalise(text: unknown): string {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// Splits a sentence into its words (code spans and such stay as written).
function wordsOf(sentence: string): string[] {
  return sentence.split(/\s+/).filter(Boolean);
}

// Guesses sentence times from length alone: each sentence gets a share of the audio equal to its share of the characters.
function beatsFromDuration(sentences: string[], durationS: number, { leadS = 0 }: BeatOptions = {}): Beat[] {
  // refuse a length we cannot divide up, and sentences with nothing to measure
  if (!Number.isFinite(durationS) || durationS <= 0) throw new Error('duration must be a finite number greater than 0');
  sentences.forEach((s, i) => {
    if (!s.trim()) throw new Error(`sentence ${i} has no text`);
  });
  const total = sentences.reduce((n, s) => n + s.length, 0);
  let used = 0;
  return sentences.map((text) => {
    const start = (used / total) * durationS;
    used += text.length;
    return { text, start: start + leadS, end: (used / total) * durationS + leadS };
  });
}

// True when a heard word can be the last word of a sentence: same word, a merge ending in it, or the tail piece of a split that carries the full stop.
function closesSentence(heard: string, lastToken: string): boolean {
  const n = normalise(heard);
  if (!n) return false;
  return n.endsWith(lastToken) || (lastToken.endsWith(n) && /[.!?]\W*$/.test(heard));
}

// Finds the word that really ends a sentence: the expected spot if it matches, else the nearest match within a few words.
function findSentenceEnd(words: Word[], expected: number, lastToken: string, lo: number, hi: number): number {
  const matches = (i: number) => i >= lo && i <= hi && closesSentence(words[i].text, lastToken);
  for (let d = 0; d <= RESYNC_WINDOW; d++) {
    if (matches(expected - d)) return expected - d;
    if (matches(expected + d)) return expected + d;
  }
  return Math.min(Math.max(expected, lo), hi);
}

// Works out, for each sentence, which transcript words belong to it, as [firstIndex, lastIndex] pairs.
function assignWords(sentences: string[], words: Word[]): [number, number][] {
  const ranges: [number, number][] = [];
  let next = 0;
  sentences.forEach((sentence, i) => {
    const parts = wordsOf(sentence);
    const isLast = i === sentences.length - 1;
    // every later sentence still needs at least one word, so leave room for them
    const hi = words.length - (sentences.length - i);
    const end = isLast
      ? words.length - 1
      : findSentenceEnd(words, next + parts.length - 1, normalise(parts[parts.length - 1]), next, hi);
    ranges.push([next, end]);
    next = end + 1;
  });
  return ranges;
}

// Times each sentence from the words a speech recogniser heard, re-syncing on sentence-final words if counts drift.
function beatsFromWords(sentences: string[], words: Word[], { leadS = 0 }: BeatOptions = {}): Beat[] {
  if (!words.length) throw new Error('no words to time the beats from');
  if (words.length < sentences.length) throw new Error('fewer words than sentences in the transcript');
  let previousEnd = 0;
  return assignWords(sentences, words).map(([first, last], i) => {
    // never start before the previous beat ended, and never end before we start
    const start = Math.max(words[first].start, previousEnd);
    const end = Math.max(words[last].end, start);
    previousEnd = end;
    return { text: sentences[i], start: start + leadS, end: end + leadS };
  });
}

export { beatsFromDuration, beatsFromWords };
export type { Word, Beat, BeatOptions };
