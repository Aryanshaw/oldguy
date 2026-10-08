---
name: templates
description: List oldguy's video templates, set the one this project uses (and its shape: 16:9, 9:16 or 1:1), or show one. Use when someone says "/oldguy:templates", "which video templates are there", "make my videos vertical", or "use the tutor template".
---

# /oldguy:templates

A template is how an oldguy video is told: its voices, characters, layout and pace. The fact-check is the same under
every template. This skill only runs one command and shows what it prints.

`oldguy` below means `node <plugin-root>/bin/oldguy.cjs`, the plugin root being the folder two levels above this
SKILL.md (Claude Code prints the skill's base directory when the skill loads; do not guess an install path). Run it
from the project root.

## What to run

| The user asks | Run |
|---|---|
| `/oldguy:templates` alone, or which templates exist | `oldguy templates` |
| to use a template, maybe with a shape | `oldguy templates <id>` or `oldguy templates <id> 9:16` |
| what a template is like | `oldguy templates <id> --show` |

Show the output as it is printed; the arrow marks the template the project uses now. Shapes: `16:9` is wide (the
default), `9:16` is tall (phone), `1:1` is square. "Vertical" means `9:16`, "square" means `1:1`.

## Rules

1. **Never guess an id.** If the user names a template that is not in the list, run `oldguy templates`, show the list
   and ask which one they meant. An unknown id or shape makes the command exit 2 with the valid ones; show that.
2. **Ask before downloading.** If setting or showing a template prints "to download first" or "needs ... downloaded",
   tell the user the size and ask. Only after a clear yes, run `oldguy templates <id> --fetch`. Never run it otherwise.
3. **Say what changed.** After setting a template, repeat the printed line, including any shape that fell back to the
   template's default. The choice applies to the next new video; videos already made keep their template.
4. Nothing in this skill talks about what making a video uses up.
