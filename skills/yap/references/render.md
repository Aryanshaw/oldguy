# Gates and render

Purpose: prove every chapter page is correct and still matches its audited text, then render the ones that pass to
`chapter.mp4`. Nothing unverified is rendered.

## 1. Dry run first

```
yap render .yap/<slug>/chapters --root <repo> --dry-run
```

`--root` is the user's repository. The dry run performs every check the real render does except the layout check
(it prints that command instead) and renders nothing: for each chapter it prints `<id>: ready` or `<id>: failed (<reason>)`. Fix every `failed` chapter before going on.
The reasons and what they mean:

| Reason starts with | Fix |
|---|---|
| `narration.txt no longer matches` | the text was edited after scaffold: redo the chapter |
| `audit:` | a source or sentence fails: fix the spec, redo the chapter |
| `not narrated yet` | run `yap narrate` on it |
| `chapter changed after narrate` | something changed since narrate: redo the chapter |
| `layout check failed` | the page fails `hyperframes check` (often a code line too wide): fix the spec, redo the chapter |

Redo means: fix the spec, delete the chapter folder (`rm -r .yap/<slug>/chapters/<id>`), then `yap scaffold`,
`yap audit`, `yap narrate` (see [narrate.md](narrate.md)).

## 2. Hyperframes check

Read the `hyperframes-cli` skill for the exact flags. For each chapter page:

```
npx --yes hyperframes@0.8.112 check .yap/<slug>/chapters/<id>
```

It lints the page, then opens it in a browser to look for runtime errors, failed requests, overlapping or
overflowing layout, and contrast. Exit 0 with no errors is the pass. Treat layout errors as real defects.

## 3. Snapshots of moving parts

Pieces animate in, so look at frames around the moments things move:

```
npx --yes hyperframes@0.8.112 check .yap/<slug>/chapters/<id> --snapshots --at-transitions
npx --yes hyperframes@0.8.112 snapshot .yap/<slug>/chapters/<id> --frames 10
```

Open the PNGs and look: text cut off, two pieces on top of each other, a code card wider than the frame, an empty
screen at the start. A problem means a param or beat is wrong (too many lines, too long a label, a late first beat):
fix the spec and redo that chapter. Never patch `index.html`.

## 4. Render

```
yap render .yap/<slug>/chapters --root <repo>
yap render .yap/<slug>/chapters --root <repo> --cap 1
```

This is the only way a chapter is rendered; never call the render tool yourself. It re-runs the narration-text
check, the claim audit and the build-record check, then runs `hyperframes check` on the page (the layout check),
skips any chapter that fails any of them, and renders the rest at draft
quality, several at a time (the cap comes from free memory; `--cap <n>` sets it, and `--cap 1` is the safe choice
on a small machine). It removes an old `chapter.mp4` before each attempt, retries a failed chapter once on its
own, and prints one line per chapter. Exit 0 means every chapter is `ready`. Every chapter that passes is rendered
again on each run, so finish fixing before you run it.

## 5. If a render fails

1. Read the reason on the `failed` line.
2. Run `yap doctor`; show any fix text to the user and stop if a required check fails.
3. Run `yap render` again, with `--cap 1` if memory looked tight. Every chapter that passes the checks renders
   again on each run, not only the one that failed.

## 6. Hand-off

When every chapter is `ready`, print each `.yap/<slug>/chapters/<id>/chapter.mp4` path on its own line and say
that the browser player arrives in a later version. Do not mention any other command.

**Gate:** `yap render` exited 0 with `ready` for every chapter, and each `chapter.mp4` exists.
