// Which template and shape a video uses. Three places, from loosest to firmest:
//   .oldguy/settings.json   the project's default, written by `oldguy templates <id> [shape]`
//   a request's own words  ("as tutor, vertical"), which override the default for that one video
//   .oldguy/<slug>/video.json  what the video was started with; every later step (narrate, audit, new chapters,
//                          the manifest the player reads) follows this file, so one video never mixes templates.
// A missing or unreadable file means explainer at 16:9, which is how every video before templates was made.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TEMPLATE, DEFAULT_SHAPE, isShape, loadTemplate, templatesRoot } from './template.mts';
import type { Shape, Template } from './template.mts';

// A template id and a shape: what one video, or the project by default, is made in.
type VideoChoice = { template: string; shape: Shape };
// What chooseForVideo decided, and whether the asked shape had to be replaced by the template's default.
type Chosen = VideoChoice & { shapeFallback: boolean };

const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const DEFAULT_CHOICE: VideoChoice = { template: DEFAULT_TEMPLATE, shape: DEFAULT_SHAPE };

// Reads {template, shape} from a JSON file; anything missing, unreadable or malformed gives the default choice.
function readChoiceFile(file: string): VideoChoice {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw === null || typeof raw !== 'object') return { ...DEFAULT_CHOICE };
    const r = raw as { template?: unknown; shape?: unknown };
    const template = typeof r.template === 'string' && SLUG.test(r.template) ? r.template : DEFAULT_TEMPLATE;
    const shape = isShape(r.shape) ? r.shape : DEFAULT_SHAPE;
    return { template, shape };
  } catch {
    return { ...DEFAULT_CHOICE };
  }
}

// Writes {template, shape} as JSON through a temp file and a rename, so a reader never sees half a file.
function writeChoiceFile(file: string, choice: VideoChoice): void {
  if (!SLUG.test(choice.template)) throw new Error(`template id "${choice.template}" must be a slug`);
  if (!isShape(choice.shape)) throw new Error(`shape "${String(choice.shape)}" must be 16:9, 9:16 or 1:1`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ template: choice.template, shape: choice.shape }, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// The project's settings file: <project>/.oldguy/settings.json.
function settingsFile(projectDir: string): string {
  return path.join(projectDir, '.oldguy', 'settings.json');
}

// The project's default template and shape.
function readSettings(projectDir: string): VideoChoice {
  return readChoiceFile(settingsFile(projectDir));
}

// Saves the project's default template and shape.
function writeSettings(projectDir: string, choice: VideoChoice): void {
  writeChoiceFile(settingsFile(projectDir), choice);
}

// Merges a request's override onto the project default for one video. A shape the template does not offer becomes the
// template's default shape, and shapeFallback says so (the caller tells the user).
function chooseForVideo(settings: VideoChoice, override: Partial<VideoChoice>, t: Template): Chosen {
  if (override.template !== undefined && override.template !== t.id) throw new Error(`the template given (${t.id}) is not the one asked for (${override.template})`);
  const asked = override.shape ?? settings.shape;
  const shapeFallback = !t.shapes.includes(asked);
  return { template: t.id, shape: shapeFallback ? t.default_shape : asked, shapeFallback };
}

// A video folder's choice file: <slugDir>/video.json.
function videoFile(slugDir: string): string {
  return path.join(slugDir, 'video.json');
}

// The template and shape a video folder was started with; a folder from before templates reads as explainer at 16:9.
function readVideoChoice(slugDir: string): VideoChoice {
  return readChoiceFile(videoFile(slugDir));
}

// True when a video folder has chosen its template.
function hasVideoChoice(slugDir: string): boolean {
  return fs.existsSync(videoFile(slugDir));
}

// Records the template and shape a video is made in. Refuses to change it once chapters exist: a video keeps one template.
function writeVideoChoice(slugDir: string, choice: VideoChoice): void {
  const current = hasVideoChoice(slugDir) ? readVideoChoice(slugDir) : null;
  const same = current && current.template === choice.template && current.shape === choice.shape;
  if (current && !same && fs.existsSync(path.join(slugDir, 'chapters')) && fs.readdirSync(path.join(slugDir, 'chapters')).length > 0) {
    throw new Error(`this video is already made as ${current.template} at ${current.shape}; remake it to change that`);
  }
  writeChoiceFile(videoFile(slugDir), choice);
}

// Loads the template a video folder is made in. A template that no longer ships is an error naming it.
function templateOfVideo(slugDir: string, root: string = templatesRoot()): Template {
  const { template } = readVideoChoice(slugDir);
  try {
    return loadTemplate(template, root);
  } catch (err) {
    throw new Error(`this video is made as ${template}: ${(err as Error).message}`);
  }
}

// The video folder a chapter folder belongs to: chapters/<id>/ sits two levels under it.
function slugDirOfChapter(chapterDir: string): string {
  return path.dirname(path.dirname(path.resolve(chapterDir)));
}

export {
  DEFAULT_CHOICE, templateOfVideo, readSettings, writeSettings, chooseForVideo, readVideoChoice, writeVideoChoice, hasVideoChoice, slugDirOfChapter,
  settingsFile, videoFile,
};
export type { VideoChoice, Chosen };
