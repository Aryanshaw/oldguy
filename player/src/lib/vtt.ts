import type { Cue } from '@/types';

const TIME = /^(?:(\d{1,}):)?(\d{1,2}):(\d{2})\.(\d{3})$/;

function parseTime(s: string): number | null {
  const m = TIME.exec(s);
  if (!m) return null;
  const sec = Number(m[3]);
  if (sec > 59) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + sec + Number(m[4]) / 1000;
}

function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Parse WebVTT text into cues sorted by start. Never throws; bad cues are dropped. */
export function parseVtt(text: string): Cue[] {
  if (typeof text !== 'string') return [];
  const cues: Cue[] = [];
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    while (lines.length && lines[0].trim() === '') lines.shift();
    const first = lines[0] ?? '';
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(first)) continue;
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0 || at > 1) continue;
    const m = /^\s*(\S+)\s+-->\s+(\S+)/.exec(lines[at]);
    if (!m) continue;
    const start = parseTime(m[1]);
    const end = parseTime(m[2]);
    if (start === null || end === null || end <= start) continue;
    const body = clean(lines.slice(at + 1).join('\n')).trim();
    cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The cue covering t (start <= t < end); the later one if several overlap. */
export function cueAt(cues: Cue[], t: number): Cue | null {
  for (let i = cues.length - 1; i >= 0; i--) {
    if (cues[i].start <= t && t < cues[i].end) return cues[i];
  }
  return null;
}
