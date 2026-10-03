import { describe, expect, test } from 'vitest';
import { cueAt, parseVtt } from './vtt';

const VTT = `WEBVTT

1
00:00:00.000 --> 00:00:02.500
Each page becomes its own small job.

00:00:02.500 --> 00:01:04.000 line:90%
A second cue
on two lines.
`;

describe('parseVtt', () => {
  test('parses cues with and without ids', () => {
    expect(parseVtt(VTT)).toEqual([
      { start: 0, end: 2.5, text: 'Each page becomes its own small job.' },
      { start: 2.5, end: 64, text: 'A second cue\non two lines.' },
    ]);
  });
  test('cueAt picks the cue covering t', () => {
    const c = parseVtt(VTT);
    expect(cueAt(c, 1)?.text).toMatch(/^Each/);
    expect(cueAt(c, 2.5)?.text).toMatch(/^A second/);
    expect(cueAt(c, 99)).toBeNull();
  });
  test('cueAt prefers the later cue when two overlap', () => {
    const c = parseVtt('WEBVTT\n\n00:00.000 --> 00:05.000\nA\n\n00:03.000 --> 00:08.000\nB\n');
    expect(cueAt(c, 4)?.text).toBe('B');
  });
  test('mm:ss.mmm times without hours', () => {
    expect(parseVtt('WEBVTT\n\n01:02.500 --> 01:04.000\nHi\n')).toEqual([
      { start: 62.5, end: 64, text: 'Hi' },
    ]);
  });
  test('CRLF line endings', () => {
    expect(parseVtt('WEBVTT\r\n\r\n00:00.000 --> 00:01.000\r\nHi\r\nthere\r\n')).toEqual([
      { start: 0, end: 1, text: 'Hi\nthere' },
    ]);
  });
  test('NOTE and STYLE blocks are skipped', () => {
    const t = 'WEBVTT\n\nNOTE a comment\n00:00.000 --> 00:09.000\n\nSTYLE\n::cue { color: red }\n\n00:00.000 --> 00:01.000\nReal\n';
    expect(parseVtt(t)).toEqual([{ start: 0, end: 1, text: 'Real' }]);
  });
  test('strips tags and decodes entities', () => {
    const t = 'WEBVTT\n\n00:00.000 --> 00:01.000\n<b>Bold</b> <c.x>cls</c> &lt;a&gt; &amp; b\n';
    expect(parseVtt(t)[0].text).toBe('Bold cls <a> & b');
  });
  test('drops a cue with a bad time line', () => {
    const t = 'WEBVTT\n\n00:00.000 -> nope\nBad\n\n00:01.000 --> 00:02.000\nGood\n';
    expect(parseVtt(t)).toEqual([{ start: 1, end: 2, text: 'Good' }]);
  });
  test('empty, header only, and garbage give []', () => {
    expect(parseVtt('')).toEqual([]);
    expect(parseVtt('WEBVTT')).toEqual([]);
    expect(parseVtt('\u0000\u0001�--> \n\n\n-->')).toEqual([]);
  });
  test('drops a cue whose end is not after its start', () => {
    expect(parseVtt('WEBVTT\n\n00:02.000 --> 00:02.000\nA\n\n00:03.000 --> 00:01.000\nB\n')).toEqual([]);
  });
  test('sorts by start', () => {
    const t = 'WEBVTT\n\n00:05.000 --> 00:06.000\nB\n\n00:01.000 --> 00:02.000\nA\n';
    expect(parseVtt(t).map((c) => c.text)).toEqual(['A', 'B']);
  });
});
