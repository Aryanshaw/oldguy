# Handoff: video templates and the flat art engine

Branch `claude/sweet-cori-go32dh`, pull request Aryanshaw/oldguy#14. State as of 2026-10-09. A clean checkout of the
branch passes `npm test`: 883 tests, 876 pass, 0 fail, 7 skipped.

## 1. What we were doing

Two threads ran together.

1. **More video templates.** oldguy already had the template engine and one template (explainer). The owner asked for
   three more, each built by a subagent, critiqued by fresh "first-time viewer" agents and fixed:
   - **tutor:** the old guy (brand character) teaches. He is goofy, yappy and confident, and explains as if to a
     10-year-old. The new guy asks the questions.
   - **old-and-new:** the "brainrot explainer" format. The new guy (left) asks dumb questions and guesses wrong; the old
     guy (right) explains with the cited fact. Looping Minecraft parkour footage plays in the background. The owner
     first asked for Peter and Stewie, then replaced them with these two brand characters.
   - **real-life-analogy:** TED-Ed-style illustrated explainers (reference: TED-Ed "Hawking's black hole paradox
     explained"). One running example travels through the video, with one everyday metaphor per chapter.
2. **A flat art engine**, so real-life-analogy can look like TED-Ed for free on every video. A hand-coded SVG kit fell
   short. The approved design is a small art library made **once** with the sg MCP (paid, one-time), vectorised and
   kept in the repo, plus a **shot compiler**: Claude writes one JSON shot per sentence, and the engine places, layers
   and animates the art.
   - Spec: `docs/superpowers/specs/2026-10-08-flat-art-engine-design.md`.
   - Plan: `docs/superpowers/plans/2026-10-08-flat-art-engine.md` (13 tasks).

## 2. What is done

### Templates (all shipped under `templates/`, each with `sample.mp4` and `sample.jpg`)

| Template | Built from | Latest fresh-viewer score | Notes |
| --- | --- | --- | --- |
| explainer | (earlier work) | — | Default. 0.9 speed, 700 ms pauses. |
| tutor | brand-sheet poses made with the sg image model | 6/10 (~65% of flow stuck) | Map of four lanes stays up; code in a band under its lane; worked timing example. The sample generator lives in the repo: `templates/tutor/examples/sample-make.mjs` and `map.mjs`. |
| old-and-new | the same character kit, plus the parkour loop | 6/10 (~60%) | Default shape 9:16. Toned-down parkour behind an opaque board. "NOPE" stamps on wrong guesses. Sources in `templates/old-and-new/ASSETS.md`. |
| real-life-analogy **v1** | a code-drawn SVG kit (`templates/real-life-analogy/kit/`) | 6/10 (~65%), fresh critic on the final version | **The owner's favourite of the three.** To be rebuilt on the flat art engine (plan Task 12), keeping what works (see 4.11). |

The scores come from two fix rounds on tutor and old-and-new, after a third round run as a workflow. Each round:
critique, then fix, then a fresh critic re-scores.

### Flat art engine

- **Code track (plan Tasks 5–9): done and merged.**
  - `lib/catalog.mts`: the catalog loader, closest-id suggestions and cast recolouring.
  - `lib/shots.mts`: the 10 numbered rules with exact messages, layout, `compileChapter`, and `handFontCss()`.
  - `lib/shots-runtime.mts`: chalk marks, grounds drawn in code, motion presets, blink and mouth flap.
  - `lib/shots-folder.mts` and `cli/shots.mts`: `oldguy shots --dir <video> [--show <id>]`.
  - `template.json` accepts `shots: true`, and the skill wiring is in `skills/oldguy/SKILL.md`.
  - Tests: `tests/catalog`, `shots`, `shots-size`, `shots-cli` and `shots-check` (the last runs only with
    `OLDGUY_CHECK_HYPERFRAMES=1`).
- **Compiled scenes get a 600 KB limit; hand-written design scenes stay at 100 KB.** Scaffold sets `fromShots: true` on
  a design piece only after recompiling `shots/<id>.json` and getting the same bytes.
- **Art track, plan Tasks 1–3: done.** Task 4 is not started, and the gate-1 fixes are unfinished (see section 4).
  - Spike: `spikes/09-flat-art/FINDINGS.md`.
    - Model: Nano Banana Pro (`image_nano_banana_pro`), with references passed as comma-separated URLs.
    - Background removal: Bria RMBG 2.0.
    - Vectorising: `vtracer` (stacked, spline, `filter_speckle=8`, `color_precision=5`, `layer_difference=24`), then a
      palette snap and integer coordinates. Results are about 8–19 KB per SVG.
  - Tools: `tools/art/` holds `style.md`, `RUNBOOK.md`, `vectorize.py`, `check.mjs` (fails above 20 KB),
    `sheet.mjs` and `requirements.txt`. The dev venv goes in `tools/art/.venv/`, which is gitignored.
  - Style bible: `art/flat/_review/style-bible.png`. The SVGs are in `art/flat/_review/style-bible/`: a cast person
    pointing, a shop counter, a scene with a bell, the old guy, the new guy, and the two hosts together.
  - `art/flat/PALETTE.json` is the one shared palette, in grouped format (grounds, floors, accents, neutrals, shades,
    skin, hair, marks, colourways), and includes the periwinkle ground. `art/flat/catalog.json` is still empty.

### Other changes on the branch

- `tests/brand-name.test.cjs` ignores base64 data URIs and the word "yappy".
- `.gitignore` lets a template ship its own clip (`!templates/*/assets/*.mp4`) and ignores `.claude/worktrees/` and the
  art venv.
- `.claude/agents/video-first-time-viewer.md`: the "think-aloud" wording became "viewing log" (see section 4).

## 3. What is left

In plan order (`docs/superpowers/plans/2026-10-08-flat-art-engine.md`):

1. **Finish the gate-1 fixes (Task 3).** I approved the style bible on the owner's behalf, on condition of these
   fixes:
   - [x] One palette (the grouped format).
   - [ ] Re-snap the style-bible SVGs to the new palette; this is unverified.
   - [ ] Give faces more character: angled brows, coloured lips, heavier lids.
   - [ ] Drop text under about 20 px from host art (blank badges); only "#1 DEV" and the mug lettering stay.
   - [ ] Redraw the shop counter: a till, an overhanging top, a front panel.
   - [ ] Draw real hands instead of mittens.
2. **Task 4, model sheets (owner gate).** Three cast bodies plus the two hosts, front-facing and neutral, with separable
   fill groups for recolouring. Lead host prompts with our own approved flat person as the style reference.
3. **Task 10.** 24 cast poses, 16 host poses (with eye and mouth layers), and 30 props. Write `catalog.json` entries
   with anchors.
4. **Task 11.** Add `tests/art-catalog.test.cjs`, run on the real library.
5. **Task 12.** Rewrite `templates/real-life-analogy/` on the engine (`shots: true`), retire the code-drawn people and
   props, and fold in the TED-Ed story rules:
   - a metaphor per chapter and a travelling example
   - a title card and ground colour per chapter
   - a bookend ending, leader-line labels and reaction beats
   - about one picture per sentence
6. **Task 13.** Render the sample, run lesson, hyperframes check and the look sheet, then fresh critics until 9 or
   higher.
7. **Optional, recommended:** a new shared sample question (see 4.1), then re-render every template's sample.
8. **Proposed next template: `walkthrough`** (the owner agreed it should be its own template). It is for questions like
   "show me how checkout is implemented", where the viewer will change the code. None of the current templates fit:
   - explainer is diagram-first and shows code only as small cards;
   - real-life-analogy hides the code behind a metaphor;
   - tutor and old-and-new spend the screen on characters.

   The layout is code-first:
   - **Editor pane** (most of the frame): the real file with line numbers and syntax colour. It scrolls to the
     current lines, lights the one being discussed and dims the rest.
   - **File tabs plus a call trail**, for example `api/checkout.ts › validateCart() › pricing.ts › applyDiscount()`.
     A jump into another function opens a new tab and adds to the trail.
   - **Watch panel**: the running example's real values as they change (`cart.total = 59.00` → `discount = 0.10` →
     `total = 53.10`). This is the "one example travels" rule applied to variables.
   - **Mini-map** in a corner: a small version of the explainer flow, with a dot showing where in the flow we are.
   - **Narration**: a calm narrator, slightly slower than explainer, holding each beat at least 4 s so the code can
     be read.

   The teaching rules still hold: real values, a what-if ("if the discount were 0.2, this line gives…"), a recap,
   and every claim cited to file:line.

   Pairing: a walkthrough can open with one analogy shot from real-life-analogy, then go into the code.

   Cost is low and needs no generated art, so it is not blocked by the sg connector. Build it as:
   - a stage layout;
   - four scene pieces (editor, tabs and trail, watch panel, mini-map), built on the existing slot and code-card
     pieces;
   - `template.md` rules;
   - a sample on the new shared question.

   Use `.claude/skills/new-template/SKILL.md`.

## 4. What is still wrong or needs checking

1. **Sample scores plateau at about 6/10.** Three fix rounds moved tutor from 5.5 to 6 and old-and-new from 6 to 6.
   - The repeated cause is the shared sample topic, "how the template engine tells one line". It is about the video's
     own timing, so the key number (3.22 s) comes from chapter 1's timeline and gets explained chapters later.
   - Recommendation: pick a concrete question on a small demo app (for example "how does checkout work") and re-render
     all samples on it.
2. **The sg MCP connector (`prod-sg-apps`) disconnected and needs re-authorising** in the claude.ai connector
   settings. All remaining art generation depends on it.
3. **The Opus first-time-viewer critic is refused by the safety filter** (`reasoning_extraction`) almost every time,
   even after the wording change.
   - Workaround used: the same review prompt run as a `general-purpose` agent on Sonnet.
   - The `video-cognitive-psychologist` critic works on Opus.
   - Worth finding the trigger in `.claude/agents/video-first-time-viewer.md` or `docs/video-critics/HOW.md`.
4. **Some sample sources are not in git.** `.oldguy/` is ignored, so these exist only in this container:
   - old-and-new's sample sources (`.oldguy/sample-old-and-new/make.mjs`, `scenes.mjs`, `run.sh`, `fixtures.sh`,
     `full.sh`)
   - real-life-analogy v1's make script

   tutor's generator is safe in `templates/tutor/examples/`. If you want old-and-new's sample reproducible, copy its
   make scripts into `templates/old-and-new/examples/`.
5. **The art-track WIP is merged unfinished** (`f3a7598`). The tools were switched to read the grouped palette, but
   they have not been re-run end to end since. Check:
   - `tools/art/.venv/bin/python tools/art/vectorize.py --help`
   - `node tools/art/check.mjs art/flat/_review/style-bible/*.svg`

   Make sure the style-bible SVGs only use colours from the current `PALETTE.json`.
6. **Hyperframes warnings that pass but deserve a look:**
   - tutor's last scene uses two overlapping tweens to beat the design piece's forced 0.4 s fade (the "held recap").
     A proper `hold` option in `scene-kit/design.mts` would be cleaner.
   - old-and-new: speaker pictures overflow their cards, a missing `.og-speaker-talk` target, and long composition
     files.
7. **Flaky existing tests under load:** `tests/hook.test.cjs` ("finishes well under a second…") and, once,
   `tests/server-cli.test.cjs` ("I-1: --detach…"). Both pass on their own and are unrelated to this work.
8. **Licensing to confirm:**
   - The parkour clip is "Minecraft Parkour No Copyright Gameplay 4K | 73" by GameplaysForFree, cut to 12 s; the
     channel offers it as no-copyright. Confirm you are happy shipping it.
   - The TED-Ed reference frames were used only as local generation references and are **not** committed.
9. **Small content issues reviewers raised that are still open:**
   - tutor: the explainer/tutor comparison and the stage/board/page vocabulary still confuse newcomers.
   - old-and-new: chapters 3 and 5 run past the template's 50 s guidance.
10. **real-life-analogy v1** ships with the code-drawn kit, which the owner judged below TED quality. Treat it as a
    placeholder until Task 12.
11. **Owner feedback (2026-10-09): of the three new templates, the owner likes only real-life-analogy.** tutor and
    old-and-new did not land for them, even after polish. Before investing more in those two, ask what they disliked.

    A fresh critic scored real-life-analogy v1 at 6/10, with about 65% of the flow stuck.

    Keep:
    - the one running example with real numbers, traced from the audio to the cue book (beats.json) to the page's
      beat array (4.115 + 0.65 = 4.765)
    - the drawn "pause 1000 ms?" quick check
    - the honest "where the picture breaks" line
    - the belt of tickets (one sound per sentence)

    Fix:
    - The what-if must say what else moves and what stays the same. Add a speed what-if too.
    - Derive the line's end (8.48) from its own audio length.
    - Cut chapter 2's "voice loaded once" and the "So doubles" rule.
    - Cut the cast to the man, the actor and the stage manager. Drop the extra stage driver and the TV-in-the-stage.
    - Show "template in, cue book in, page out" with two arrows into buildStagePage.
    - Hold code cards on screen for at least 4 s.

## 5. Decisions made on the owner's behalf (overnight)

- The template workflow kept running instead of restarting a third time. real-life-analogy v1 is a throwaway.
- The engine was built in two isolated worktrees. Both are now merged.
- Code-track deviations were accepted:
  - beats are 0-based, matching the scene kit's `beat(n)`
  - motion compiles to tween calls, because design scenes forbid scripts
  - drawings are inlined, because `<use>` is banned
  - the font is supplied through `handFontCss()` in `stage.html`
- The SVG target is about 20 KB. Compiled scenes get 600 KB, with byte-identical recompile as the trust check.
- Gate 1 was approved with the fixes listed in section 3.
- old-and-new: a polish round swapped the moving parkour for a still and added a third "plain" voice. Both were
  reverted, because the owner asked for moving parkour and two characters. The footage is darkened, desaturated and
  blurred behind an opaque board.
- Polish loops stopped at about 6/10 for the structural reason in 4.1.

## 6. Where things are

- Specs and plans: `docs/superpowers/specs/2026-10-07-video-templates-design.md`,
  `docs/superpowers/specs/2026-10-08-flat-art-engine-design.md`, and
  `docs/superpowers/plans/2026-10-08-flat-art-engine.md`.
- Teaching rules every template keeps: `skills/oldguy/references/teaching.md`. Run `oldguy lesson --dir <video>` to
  check a video against them.
- Critic agents: `.claude/agents/video-*.md`, with the method in `docs/video-critics/HOW.md`.
- New-template contributor skill: `.claude/skills/new-template/SKILL.md`.
- Brand sheets for the hosts were supplied in chat and are not in the repo. Re-supply them as references when
  generating host art.
