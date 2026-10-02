# Gates and render

Purpose: prove every chapter page is correct and still matches its audited text, then render the ones that pass to
`chapter.mp4`, one chapter at a time in story order. Nothing unverified is rendered.

## 1. Render each chapter as soon as it is narrated

Right after `yap narrate` prints `narrated` for a chapter, start its render:

```
yap render .yap/<slug>/chapters --root <repo> --only <id>
```

`--root` is the user's repository. This is the only way a chapter is rendered; never call the render tool
yourself. It may run in the background while you write, scaffold, audit and narrate the next chapter. Keep at most
as many renders running as the doctor's "Free RAM" line says ("N at a time"); when that many are running, wait for
one to finish before starting another.

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
| `not narrated yet` | run `yap narrate` on it |
| `chapter changed after narrate` | something changed since narrate: redo the chapter |
| `layout check failed` | the page fails the layout check (often a code line too wide): see section 2, redo the chapter |

Redo means: fix the spec, delete the chapter folder (`rm -r .yap/<slug>/chapters/<id>`), then `yap scaffold`,
`yap audit`, `yap narrate` (see [narrate.md](narrate.md)), then render it again with `--only <id>`.

## 2. Looking at a layout failure

Everything you need from Hyperframes is in this file; there is no other skill to read and nothing to search the
disk for. To see what the layout check found, and frames around the moments pieces move:

```
npx --yes hyperframes@0.8.112 check .yap/<slug>/chapters/<id> --snapshots --at-transitions
npx --yes hyperframes@0.8.112 snapshot .yap/<slug>/chapters/<id> --frames 10
```

Open the PNGs and look: text cut off, two pieces on top of each other, a code card wider than the frame, an empty
screen at the start. A problem means a param or beat is wrong (too many lines, a code line too long, too long a
label, a late first beat): fix the spec and redo that chapter. Never patch `index.html`.

## 3. Confirm every chapter

When no render is still running, run one render over all chapters, ids in story order separated by commas:

```
yap render .yap/<slug>/chapters --root <repo> --only <id1>,<id2>,<id3>
```

Chapters already rendered from their current `build.json` print `ready (already rendered)` and are not rendered
again; any other chapter is checked and rendered now. Exit 0 means every chapter is ready. `--force` renders a
finished chapter again anyway; the normal flow never needs it. `--dry-run` prints `would render` or `would skip`
for each chapter and runs no check or render. `--cap <n>` limits renders at once in a run over several chapters.

## 4. If a render fails

1. Read the reason on the `failed` line.
2. Run `yap doctor`; show any fix text to the user and stop if a required check fails.
3. Run `yap render .yap/<slug>/chapters --root <repo> --only <id>` again for that chapter. Finished chapters are
   never redone unless their build changed.

## 5. Hand-off

When every chapter is `ready`, print each `.yap/<slug>/chapters/<id>/chapter.mp4` path on its own line, in story
order (the storyboard's order in `script.md`, not folder order), and say that the browser player arrives in a
later version. Do not mention any other command.

**Gate:** the final `yap render ... --only <all ids>` exited 0 with `ready` for every chapter, and each `chapter.mp4` exists.
