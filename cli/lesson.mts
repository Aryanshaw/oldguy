// The `oldguy lesson --dir .oldguy/<slug>` command: checks the whole video against the lesson rules (one example
// followed through, a "So" line per chapter, short sentences, labels on screen, the planned badge once) and prints
// each finding. Run it after the specs are written and before the first scaffold.
import { checkLessonFolder } from '../lib/lesson.mts';
import { parseFlags, guarded } from './args.mts';

const USAGE = 'usage: oldguy lesson --dir .oldguy/<slug>';

// Runs the check; exit 0 = the video follows the rules, 1 = findings printed one per line, 2 = usage.
function runLesson(args: string[]): number {
  return guarded('lesson', () => {
    const { positional, flags } = parseFlags(args, ['--dir']);
    if (!flags['--dir'] || positional.length) throw new Error(USAGE);
    const findings = checkLessonFolder(flags['--dir']);
    for (const f of findings) process.stdout.write(`${f.id}: ${f.reason}\n`);
    if (findings.length === 0) process.stdout.write('lesson ok\n');
    return findings.length ? 1 : 0;
  });
}

export { runLesson };
