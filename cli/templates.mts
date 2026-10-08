// `oldguy templates`: lists the templates, sets the project's default, shows one, downloads its big media; and
// `oldguy video`: records the template and shape a new video folder is made in (video.json).
//   oldguy templates                          list: id, description, shapes, which one the project uses
//   oldguy templates <id> [16:9|9:16|1:1]     set the project's template (and shape) in .oldguy/settings.json
//   oldguy templates <id> --show              details: description, shapes, pace, assets still to download
//   oldguy templates <id> --fetch             download the assets still missing (only after the user agreed)
//   oldguy video --dir .oldguy/<slug> [--template <id>] [--shape <shape>]
import fs from 'node:fs';
import path from 'node:path';
import { parseFlags } from './args.mts';
import { listTemplates, loadTemplate, templateIds, isShape, SHAPE_LIST } from '../lib/template.mts';
import { readSettings, writeSettings, chooseForVideo, writeVideoChoice } from '../lib/settings.mts';
import { missingAssets, fetchAsset, megabytes } from '../lib/assets.mts';
import { resolveDataDir } from '../lib/data-dir.mts';
import type { Template } from '../lib/template.mts';
import type { Getter } from '../lib/assets.mts';

const USAGE = `usage: oldguy templates [<id> [${SHAPE_LIST.join('|')}] | <id> --show | <id> --fetch]`;
const VIDEO_USAGE = `usage: oldguy video --dir .oldguy/<slug> [--template <id>] [--shape ${SHAPE_LIST.join('|')}]`;

// The project folder: where the command is run (Claude runs it from the project root, like every oldguy command).
function projectDir(): string {
  return process.cwd();
}

// The plugin data folder, where downloaded template media lives beside the voice venv.
function dataDir(): string {
  // process.cwd() is an absolute path, so a folder is always found
  return resolveDataDir({ env: process.env, cwd: process.cwd(), fs }) as string;
}

// Downloads a URL with Node's own fetch; its body is read chunk by chunk.
const httpsGet: Getter = async (url) => {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  // a web ReadableStream is async-iterable in Node
  return res.body as unknown as AsyncIterable<Uint8Array>;
};

// Prints a usage problem and the valid choices, then returns exit code 2.
function refuse(message: string): number {
  process.stderr.write(`oldguy templates: ${message}\n${USAGE}\n`);
  return 2;
}

// One line per template: id, shapes, description, and an arrow at the project's current one.
function listLines(current: string): string[] {
  return listTemplates().map((t) => `${t.id === current ? '→' : ' '} ${t.id.padEnd(20)} ${t.shapes.join(' ').padEnd(16)} ${t.description}`);
}

// The details of one template, with the media still to download and its size.
function showLines(t: Template, data: string): string[] {
  const missing = missingAssets(t, data);
  const pace = t.pace;
  const voices = t.speakers.length ? t.speakers.map((s) => `${s.id} (${s.voice}, ${s.side})`).join(', ') : `one narrator (${t.narrator_voice})`;
  const sample = path.join(t.dir, 'sample.mp4');
  return [
    `${t.title} (${t.id}, version ${t.version})`,
    t.description,
    `shapes: ${t.shapes.join(', ')} (default ${t.default_shape})`,
    `voices: ${voices}`,
    `pace: chapters of ${pace.chapter_seconds[0]} to ${pace.chapter_seconds[1]} s, captions ${pace.captions}, pictures on each ${pace.visual_beat}` +
      (pace.max_words_per_line ? `, at most ${pace.max_words_per_line} words per line` : ''),
    missing.length ? `to download first: ${missing.map((a) => `${a.path} (${megabytes(a.bytes ?? 0)})`).join(', ')}` : 'nothing to download',
    `script rules: ${path.join(t.dir, 'template.md')}`,
    ...(fs.existsSync(sample) ? [`sample: ${sample}`] : []),
  ];
}

// Loads a template by id, or explains which ids exist (exit 2) by throwing.
function templateOrRefuse(id: string): Template {
  if (!templateIds().includes(id)) throw new Error(`unknown template "${id}"; use one of ${templateIds().join(', ')}`);
  return loadTemplate(id);
}

// Runs `oldguy templates`; exit 0 done, 1 a download failed, 2 usage or an unknown id or shape.
async function runTemplates(args: string[]): Promise<number> {
  const flags = args.filter((a) => a.startsWith('--'));
  const words = args.filter((a) => !a.startsWith('--'));
  if (flags.some((f) => f !== '--show' && f !== '--fetch') || flags.length > 1 || words.length > 2) return refuse('unexpected arguments');
  const settings = readSettings(projectDir());
  if (words.length === 0) {
    if (flags.length) return refuse(`${flags[0]} needs a template id`);
    process.stdout.write(`${listLines(settings.template).join('\n')}\n`);
    return 0;
  }
  let t: Template;
  try {
    t = templateOrRefuse(words[0]);
  } catch (err) {
    return refuse((err as Error).message);
  }
  if (flags[0] === '--show') {
    process.stdout.write(`${showLines(t, dataDir()).join('\n')}\n`);
    return 0;
  }
  if (flags[0] === '--fetch') {
    const data = dataDir();
    const missing = missingAssets(t, data);
    try {
      for (const a of missing) {
        process.stdout.write(`downloading ${a.path} (${megabytes(a.bytes ?? 0)})\n`);
        await fetchAsset(t, a, data, httpsGet);
      }
    } catch (err) {
      process.stderr.write(`oldguy templates: ${(err as Error).message}\n`);
      return 1;
    }
    process.stdout.write(missing.length ? `${t.id}: ready\n` : `${t.id}: nothing to download\n`);
    return 0;
  }
  const shape = words[1];
  if (shape !== undefined && !isShape(shape)) return refuse(`unknown shape "${shape}"; use one of ${SHAPE_LIST.join(', ')}`);
  const chosen = chooseForVideo(settings, { template: t.id, ...(shape ? { shape } : {}) }, t);
  writeSettings(projectDir(), { template: chosen.template, shape: chosen.shape });
  const note = chosen.shapeFallback ? ` (${t.id} has no ${shape ?? settings.shape} layout, so its default ${chosen.shape} is used)` : '';
  const missing = missingAssets(t, dataDir());
  const fetchNote = missing.length ? `; it needs ${missing.map((a) => megabytes(a.bytes ?? 0)).join(' + ')} downloaded before its first video (oldguy templates ${t.id} --fetch)` : '';
  process.stdout.write(`project template: ${chosen.template} at ${chosen.shape}${note}${fetchNote}\n`);
  return 0;
}

// Runs `oldguy video`: records the template and shape a video folder is made in, from the project default and the
// request's override. Exit 0 done, 2 usage, an unknown template or shape, or a change to a video that has chapters.
function runVideo(args: string[]): number {
  let flags: Record<string, string>;
  try {
    const parsed = parseFlags(args, ['--dir', '--template', '--shape']);
    flags = parsed.flags;
    if (parsed.positional.length || !flags['--dir']) throw new Error('needs --dir');
  } catch (err) {
    process.stderr.write(`oldguy video: ${(err as Error).message}\n${VIDEO_USAGE}\n`);
    return 2;
  }
  try {
    const shape = flags['--shape'];
    if (shape !== undefined && !isShape(shape)) throw new Error(`unknown shape "${shape}"; use one of ${SHAPE_LIST.join(', ')}`);
    const settings = readSettings(projectDir());
    const t = templateOrRefuse(flags['--template'] ?? settings.template);
    const chosen = chooseForVideo(settings, { template: t.id, ...(shape ? { shape } : {}) }, t);
    writeVideoChoice(flags['--dir'], { template: chosen.template, shape: chosen.shape });
    const note = chosen.shapeFallback ? ` (${t.id} has no ${shape ?? settings.shape} layout, so its default ${chosen.shape} is used)` : '';
    process.stdout.write(`video: ${chosen.template} at ${chosen.shape}${note}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`oldguy video: ${(err as Error).message}\n`);
    return 2;
  }
}

export { runTemplates, runVideo };
