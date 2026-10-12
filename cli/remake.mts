// `oldguy remake --from .oldguy/<slug> --template <id> [--shape <shape>]`: starts a new video folder that tells an
// existing video again in another template or shape. It copies what was checked (sources.json), the script and the
// story order, records the new template and shape (video.json), and prints the new folder. The old video is never
// touched; the chapters are then written, audited, narrated and rendered in the new folder as usual.
import fs from 'node:fs';
import path from 'node:path';
import { parseFlags } from './args.mts';
import { loadTemplate, templateIds, isShape, SHAPE_LIST } from '../lib/template.mts';
import { readVideoChoice, writeVideoChoice } from '../lib/settings.mts';

const USAGE = `usage: oldguy remake --from .oldguy/<slug> --template <id> [--shape ${SHAPE_LIST.join('|')}]`;
// The files a remake carries over: the checked sources, the script they back, and the story order.
const CARRIED = ['sources.json', 'script.md', 'order.json'];

// Makes the new folder and returns it with the template and shape it records.
function remake(from: string, templateId: string, shapeAsked: string | undefined): { dir: string; template: string; shape: string; wanted: string; fallback: boolean } {
  const src = path.resolve(from);
  if (!fs.existsSync(path.join(src, 'sources.json'))) throw new Error(`${from} has no sources.json, so there are no checked sources to remake from`);
  if (!templateIds().includes(templateId)) throw new Error(`unknown template "${templateId}"; use one of ${templateIds().join(', ')}`);
  if (shapeAsked !== undefined && !isShape(shapeAsked)) throw new Error(`unknown shape "${shapeAsked}"; use one of ${SHAPE_LIST.join(', ')}`);
  const t = loadTemplate(templateId);
  const old = readVideoChoice(src);
  // the asked shape, else the old video's shape when the template has it, else the template's own default
  const wanted = shapeAsked ?? old.shape;
  const fallback = !(t.shapes as string[]).includes(wanted);
  const shape = fallback ? t.default_shape : wanted;
  if (old.template === t.id && old.shape === shape) throw new Error(`${from} is already ${t.id} at ${shape}`);
  const base = path.basename(src).replace(new RegExp(`-${old.template}$`), '');
  const dir = path.join(path.dirname(src), `${base}-${t.id}${old.template === t.id ? `-${shape.replace(':', 'x')}` : ''}`);
  try {
    fs.mkdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${dir} already exists: open that video, or delete the folder to remake again`);
    throw err;
  }
  for (const name of CARRIED) {
    if (fs.existsSync(path.join(src, name))) fs.copyFileSync(path.join(src, name), path.join(dir, name));
  }
  writeVideoChoice(dir, { template: t.id, shape });
  return { dir, template: t.id, shape, wanted, fallback };
}

// Runs the command; exit 0 = the new folder is printed, 2 = usage or a refusal (message on stderr).
function runRemake(args: string[]): number {
  try {
    const { positional, flags } = parseFlags(args, ['--from', '--template', '--shape']);
    if (positional.length || !flags['--from'] || !flags['--template']) throw new Error('needs --from and --template');
    const r = remake(flags['--from'], flags['--template'], flags['--shape']);
    const note = r.fallback ? ` (${r.template} has no ${r.wanted} layout, so its default ${r.shape} is used)` : '';
    process.stdout.write(`${r.dir}\n${r.template} at ${r.shape}${note}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`oldguy remake: ${(err as Error).message}\n${USAGE}\n`);
    return 2;
  }
}

export { runRemake, remake };
