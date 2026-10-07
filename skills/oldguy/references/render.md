# Gates and render

Purpose: prove every chapter page is correct and still matches its audited text, then render the ones that pass to
`chapter.mp4`, one chapter at a time in story order. Nothing unverified is rendered.

## 1. Render each chapter as soon as it is narrated

Right after `oldguy narrate` prints `narrated` for a chapter, render it, in the foreground, and wait for it to finish:

```
oldguy render .oldguy/<slug>/chapters --root <repo> --only <id>
```

Run it, the confirm run in section 3 and the Hyperframes commands in section 2 with the shell tool's longest time
limit, 10 minutes (`timeout` 600000 ms), never less: a render can take well over the default 2 minutes. If the host
detaches it anyway (a task id instead of the output), wait for that task to finish before doing anything else.

`--root` is the user's repository. This is the only way a chapter is rendered; never call the render tool
yourself. Run it as a normal command that you wait for: never detach it and never end your turn while it runs (the
session can end with your answer, and a running render dies with it). One render at a time; move on to the next
chapter only once it has printed its result.

For each chapter it runs four gates, in this order, and stops at the first that fails: the narration text still
matches `chapter.json`, the claim audit, the build record (nothing changed since narrate), and the layout check
(`npx --yes hyperframes@0.8.112 check <chapter-dir>`, which looks for clipped or overflowing text, runtime errors
and failed requests). Then it renders at draft quality, retries a failed render once, and records `render.json`
next to `chapter.mp4`. It removes an old `chapter.mp4` only right before an actual render. It prints one line per
chapter: `<id>: ready`, `<id>: ready (already rendered)` or `<id>: failed (<reason>)`.

| Reason starts with | Fix |
|---|---|
| `no such chapter` | the id is not a folder under `chapters/`: check the spelling |
| `narration.txt no longer matches` | the text was edited after scaffold: redo the chapter |
| `audit:` | a source or sentence fails: fix the spec, redo the chapter |
| `not narrated yet` | run `oldguy narrate` on it |
| `chapter changed after narrate` | something changed since narrate: redo the chapter |
| `layout check failed` | the page fails the layout check (often a code line too wide): see section 2, redo the chapter |

Redo means: fix the spec, delete the chapter folder (`rm -r .oldguy/<slug>/chapters/<id>`), then `oldguy scaffold`,
`oldguy audit`, `oldguy narrate` (see [narrate.md](narrate.md)), then render it again with `--only <id>`.

## 2. Looking at a layout failure

Everything you need from Hyperframes is in this file; there is no other skill to read and nothing to search the
disk for. To see what the layout check found, and frames around the moments pieces move:

```
npx --yes hyperframes@0.8.112 check .oldguy/<slug>/chapters/<id> --snapshots --at-transitions
npx --yes hyperframes@0.8.112 snapshot .oldguy/<slug>/chapters/<id> --frames 10
```

Open the PNGs and look: text cut off, two things on top of each other, a code card wider than the frame, an empty
screen at the start. A problem means a param, a beat or the designed scene is wrong (too many lines, a code line
too long, too long a label, a late first beat, boxes placed over each other): fix the spec or the scene file and
redo that chapter. Never patch `index.html`.

## 3. Confirm every chapter

After the last chapter's render has finished, run one render over all chapters, ids in story order separated by
commas, also in the foreground:

```
oldguy render .oldguy/<slug>/chapters --root <repo> --only <id1>,<id2>,<id3>
```

Chapters already rendered from their current `build.json` print `ready (already rendered)` and are not rendered
again; any other chapter is checked and rendered now. Exit 0 means every chapter is ready. `--force` renders a
finished chapter again anyway; the normal flow never needs it. `--dry-run` prints `would render` or `would skip`
for each chapter and runs no check or render. `--cap <n>` limits renders at once in a run over several chapters.

## 4. If a render fails

1. Read the reason on the `failed` line.
2. Run `oldguy doctor`; show any fix text to the user and stop if a required check fails.
3. Run `oldguy render .oldguy/<slug>/chapters --root <repo> --only <id>` again for that chapter. Finished chapters are
   never redone unless their build changed.

## 5. Server and hand-off

After the confirm run, and never before, start the server in the foreground (it returns in a few seconds):

```
oldguy serve --detach --dir .oldguy/<slug>
```

It prints one line: the URL. The URL holds a private key for this session; show it as printed and write it nowhere
else (no file, no commit). If it prints a problem instead, report that line and still hand off the mp4 paths.

Then tell the user the chapters can be watched at that URL (a simple page that lists the chapters), and print each
`.oldguy/<slug>/chapters/<id>/chapter.mp4` path on its own line, in story order (the storyboard's order in
`script.md`, not folder order). Do not mention any other command.

**Gate:** the final `oldguy render ... --only <all ids>` exited 0 with `ready` for every chapter, and each `chapter.mp4` exists.
