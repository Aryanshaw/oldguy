# Narrate

Purpose: turn each scaffolded chapter into speech, timed beats, captions and a chapter page, from the exact words
the audit approved.

## The house voice

Polite, cheery and efficient: a friendly helper who likes explaining things. Short sentences. Plain words. Name the
thing on screen ("this line", "the `add` function") rather than describing a picture. Say what happens and why,
once, and move on. No filler ("so basically", "as you can see"), no jokes at the code's expense, and nothing about
what making the video uses up (the repository's own payment code is a flow like any other: explain it).
Audience is a beginner: explain a term the first time it appears, in half a sentence.

Each entry is exactly one sentence, each chapter stands alone, and no sentence mentions another chapter or a time.
The rules and the splitter traps are in [storyboard.md](storyboard.md).

## Before narrating

1. `yap audit .yap/<slug>/chapters/<id>/chapter.json --root <repo>` must exit 0.
2. `narration.txt` must be the chapter's sentences joined with single spaces. Scaffold wrote it that way; do not
   touch it.

## The command

```
yap narrate .yap/<slug>/chapters/<id>
```

It checks the sentences and the scene again, makes the speech with the local voice, pads a little silence at both
ends, works out when each sentence starts (word-level if `whisper-cli` is present, otherwise shared by length),
cuts captions from the audited sentences, and builds the chapter page. On success it prints:

```
<id>: narrated, 31.2 s, 4 beats, timing words
```

and the folder gains `narration.wav`, `beats.json`, `captions.vtt`, `captions.json`, `index.html` and
`build.json`. Run it once per chapter. It takes a while per chapter; do not run several at once.

Check the printed seconds: a chapter under 20 s or over 40 s goes back to the storyboard (add or trim sentences
in the spec, then redo the chapter).

## The build record

`build.json` holds fingerprints of the audited sentences, the scene, `narration.txt`, `narration.wav` and
`index.html`. `yap render` compares them and refuses a chapter where anything changed after narrate. It is a
safety net against mistakes (a stray edit, a half-finished redo), not a lock against someone who writes it by hand
on purpose. You never write or edit `build.json` by hand.

## Redoing a chapter

Never edit `chapter.json` or `narration.txt` after narrate. `chapter.json` may be fixed before narrate; after it,
the CLI messages and this list agree on the one path:

1. Fix `.yap/<slug>/specs/<id>.json`.
2. Delete the chapter folder: `rm -r .yap/<slug>/chapters/<id>` (scaffold never overwrites).
3. Run `yap scaffold`, then `yap audit`, then `yap narrate` for that chapter only.

## If it fails

`yap narrate` exits 1 with one line saying why. A sentence or scene problem: fix the spec and redo the chapter.
A speech or timing tool problem: run `yap doctor`, show the fix text, stop.

**Gate:** `yap narrate` printed `narrated` for every chapter, each 20 to 40 s, and each folder has the six generated files.
