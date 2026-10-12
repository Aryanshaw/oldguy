// Speaks a chapter's lines, each in its speaker's voice and speed, with one Kokoro process for the whole chapter
// (lib/speak.py), then joins them with the template's gap of silence. The line times come straight from the audio
// lengths, so they are exact: no recogniser is needed to know when each line starts.
import fs from 'node:fs';
import path from 'node:path';
import { joinWavs } from './wav.mts';
import type { RunProgram } from './narrate.mts';

// One line to speak.
type SpokenLine = { text: string; voice: string; speed: number };
// What speakLines needs: the venv's python, the model and voices files, the gap (one for every join, or one after
// each line), a work folder and the program runner.
type SpeakOptions = { python: string; model: string; voices: string; gapMs: number | number[]; work: string; run: RunProgram };
// The joined audio (not yet padded) and when each line starts and ends in it, in seconds.
type Spoken = { wav: Buffer; spans: { start: number; end: number }[] };

const SPEAK_PY = path.join(import.meta.dirname, 'speak.py');

// Reads speak.py's one JSON line; anything else is reported as it is.
function parseReply(stdout: string | undefined): { error?: string; line?: number | null; lines?: { file: string }[] } {
  try {
    const reply: unknown = JSON.parse(String(stdout || '').trim().split('\n').pop() || '');
    return reply !== null && typeof reply === 'object' ? reply : {};
  } catch {
    return {};
  }
}

// Speaks every line in one process and joins them; a failing line is named by its index.
async function speakLines(lines: SpokenLine[], { python, model, voices, gapMs, work, run }: SpeakOptions): Promise<Spoken> {
  if (lines.length === 0) throw new Error('nothing to speak');
  const outDir = path.join(work, 'lines');
  fs.mkdirSync(outDir, { recursive: true });
  const request = path.join(work, 'speak-request.json');
  fs.writeFileSync(request, JSON.stringify({ out_dir: outDir, lines }));
  const r = await run(python, [SPEAK_PY, model, voices, request]);
  const reply = parseReply(r.stdout);
  if (r.code !== 0 || reply.error) {
    const where = typeof reply.line === 'number' ? ` (line ${reply.line}: "${lines[reply.line]?.text ?? ''}")` : '';
    throw new Error(`speaking failed${where}: ${reply.error || String(r.stderr || '').trim() || `exit code ${r.code}`}`);
  }
  if (!Array.isArray(reply.lines) || reply.lines.length !== lines.length) throw new Error(`speak.py made ${reply.lines?.length ?? 0} of ${lines.length} lines`);
  const parts = reply.lines.map((l) => fs.readFileSync(path.join(outDir, path.basename(l.file))));
  return joinWavs(parts, gapMs);
}

export { speakLines, SPEAK_PY };
export type { SpokenLine, SpeakOptions, Spoken };
