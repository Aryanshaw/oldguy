# Templates

Purpose: tell the verified explanation the way the video's template says (its voices, characters, layout and pace)
without changing what is checked. Every claim still cites real lines, under every template.

## 1. Which template and shape

- The project's default is in `.oldguy/settings.json`, set by `/oldguy:templates` (`oldguy templates <id> [shape]`).
  No file means `explainer` at `16:9`, today's look.
- The request may name one in plain words ("as tutor", "vertical", "square"). That overrides the default for this
  video only. Vertical is `9:16`, square is `1:1`, wide is `16:9`.
- A name that is not a template: run `oldguy templates`, show the list and ask which one. Never guess.
- In the scope step, before any chapter, record the choice for this video:

```
oldguy video --dir .oldguy/<slug> [--template <id>] [--shape 9:16]
```

It prints `video: <id> at <shape>`. If it says the shape fell back to the template's default, tell the user once.
From then on every step reads the video's template from `video.json`: scaffold, audit, narrate and render, and every
chapter added later. A video keeps one template; to change it, remake it (section 6).

## 2. Media to download first

Run `oldguy templates <id> --show`. If it lists "to download first", tell the user what and how big, and ask. Only
after a clear yes run `oldguy templates <id> --fetch`. On a no, the template cannot be used: say so and stop, or
offer the default. Never download without asking; narrate refuses a template whose media is missing.

## 3. The script

Read the template's `template.md` (its path is in `--show`): who says what, the shape of one exchange, the tone, what
the slot shows. Then write the sentences as usual, with these additions:

- **Speakers.** A template with characters needs `"speaker": "<id>"` on every sentence, from its list; a narrator
  template (explainer) takes none. Claims keep their sources whoever says them. Never move a claim into a framing line
  to dodge a source.
- **Line length.** A template may cap words per line (`--show` prints it). Write short lines; the audit counts them.
- **Length.** Aim for the template's chapter seconds; there is no limit on the whole video.
- **Teaching.** Every template keeps the rules of [teaching.md](teaching.md): one example followed through, a "So"
  line per chapter, labels on screen. Characters change who says it, never whether it teaches.

The audit adds the template's rules to the claim checks: an unknown or missing speaker, or a line over the cap, fails
the chapter, and the usual redo path applies.

## 4. The picture

The scene goes in the template's slot. Ready pieces and designed scenes are still drawn on the 1920x1080 stage of
[visuals.md](visuals.md); the stage scales them into the slot, so keep them big and simple when the slot is small
(a tall video). The template draws its own characters, captions and source chips from the timing: never draw those
in the scene.

A piece may start on a word of its sentence instead of the sentence start: add `"word": "<one word of that
sentence>"` to the scene entry. A word in the last third of its line starts at the line start instead.

## 5. Narrate and render

Unchanged commands. Narrate prints `timing lines` for a template with speakers (each line timed exactly from its
own audio). Render refuses a chapter built in another template or shape than the video's: narrate it again.

## 6. Remake

A `remake` event (the viewer picked a template in the page's Templates gallery) carries `template` and `shape`:

1. `oldguy ack <id>`.
2. `oldguy remake --from .oldguy/<slug> --template <id> --shape <shape>`. It prints the new folder; it carries the
   checked `sources.json`, `script.md` and `order.json` over, and records the new template. The old video stays up.
3. Do section 2 for the new template, asking before any download.
4. For each chapter in `order.json`, a chapter subagent writes its spec in the new template's way (section 3) from
   the carried sources and script, then scaffolds, audits, narrates and renders it in the new folder. The sources
   were checked already, and the audit checks every claim again.
5. When every chapter is ready: `oldguy serve --detach --dir .oldguy/<slug>-<id>` (the folder remake printed), then
   reply in the old page's chat, giving the new link ("Open the remade video"). If a chapter fails after the redo
   path, say which in the reply.

**Gate:** the video's template and shape were recorded with `oldguy video`, any download was asked for first, every sentence fits the template's speakers and line cap, and a remake built a new folder while the old video stayed playable.
