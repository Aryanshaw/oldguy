'use strict';

// True when a word finishes a sentence (full stop, ! or ?, maybe followed by a closing quote or bracket).
function endsSentence(text) {
  return /[.!?]["'”’)\]»]*$/.test(text);
}

// Turns seconds into the VTT clock format HH:MM:SS.mmm.
function stamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`;
}

// Cuts a beat into its words, giving each a slice of the beat's time by how long the word is.
function wordsOfBeat(beat) {
  const parts = beat.text.split(/\s+/).filter(Boolean);
  const total = parts.reduce((n, p) => n + p.length, 0);
  let used = 0;
  return parts.map((text) => {
    const start = beat.start + (used / total) * (beat.end - beat.start);
    used += text.length;
    return { text, start, end: beat.start + (used / total) * (beat.end - beat.start) };
  });
}

// Accepts words or beats (a beat has spaces in its text) and returns a flat, in-order word list with sane times.
function toWords(items) {
  let previousEnd = 0;
  return items.flatMap((item) => (/\s/.test(item.text.trim()) ? wordsOfBeat(item) : [item])).map((w) => {
    // never start before the previous word ended, never end before starting
    const start = Math.max(w.start, previousEnd);
    const end = Math.max(w.end, start);
    previousEnd = end;
    return { text: w.text, start, end };
  });
}

// Groups words into cues: a new cue starts at a sentence end, at maxWords, or when maxCueS would be exceeded.
function groupCues(words, maxWords, maxCueS) {
  const cues = [];
  let cue = [];
  words.forEach((w) => {
    const full = cue.length >= maxWords || (cue.length > 0 && w.end - cue[0].start > maxCueS);
    if (full) {
      cues.push(cue);
      cue = [];
    }
    cue.push(w);
    if (endsSentence(w.text)) {
      cues.push(cue);
      cue = [];
    }
  });
  if (cue.length) cues.push(cue);
  return cues;
}

// Builds the VTT text and the per-word json from words or beats.
function buildCaptions(items, { maxWords = 7, maxCueS = 3.5 } = {}) {
  const words = toWords(items);
  const blocks = groupCues(words, maxWords, maxCueS).map((cue) => {
    const times = `${stamp(cue[0].start)} --> ${stamp(cue[cue.length - 1].end)}`;
    return `${times}\n${cue.map((w) => w.text).join(' ')}`;
  });
  return { vtt: `WEBVTT\n\n${blocks.join('\n\n')}\n`, json: words };
}

module.exports = { buildCaptions };
