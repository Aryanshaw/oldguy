# Yap video templates

Date: 2026-10-07. Status: draft, waiting for owner review.
Parent spec: `2026-10-02-yap-design.md`. This document adds templates; where it disagrees with the parent, section 12
lists the amendments.

## 1. What templates deliver

Today Yap makes one kind of video: a calm narrator explaining a flow, landscape, with Claude-designed scenes. A
**template** is a different way of *telling* the same verified explanation: two cartoon characters bickering over
gameplay footage, a professor building it up from basics, a real-life analogy. The user types their question and picks
a template; nothing else.

Two independent axes:

- **Topic**: *what* is explained (an architecture tour, onboarding, a PR walkthrough, a bug postmortem). Comes from the
  question.
- **Template**: *how* it is told (voices, characters, layout, pace, script shape). Comes from the template choice.

Any topic works with any template. The fact-check does not depend on the template: every claim still cites real lines.

Done means:

1. A user can list templates, set one for the project, or name one in a single request, and get a video in it.
2. `peter-and-stewie` produces a video in the reel's format: gameplay background, the speaking character on screen,
   one-word captions, props popping in on key words, two distinct voices.
3. The video's shape (16:9 by default, 9:16 or 1:1 on request) is honoured by the stage and the player.
4. From the player, **Remake as…** turns an existing video into another template or shape without re-checking facts.
5. Today's videos look and behave the same: the current look becomes the default template, `explainer`.
6. Nobody can loosen the fact-check through a template: claim lines without sources fail the audit as today.

## 2. Decisions made with the owner

| Topic | Decision |
|---|---|
| Who makes templates | Only the Yap repo ships templates. Others contribute new ones by pull request. |
| Depth | The architecture supports script, cast and stage changes (tiers 1 to 3); the first build is tier 1. |
| Characters | Each template has fixed characters. No cast option: users type the question and pick a template. |
| Scope of a template | Whole video. Follow-up chapters use the video's template. |
| Shape | 16:9 by default; the user can ask for 9:16 or 1:1. One shape per video. |
| Template structure | A fixed stage (code) plus one creative slot that Claude designs per chapter. |
| Template as a skill | No. A template is a folder loaded on demand. Two skills are added: `/yap:templates` (users) and a repo-only `new-template` skill (contributors). |
| Choosing | `/yap:templates <id> [shape]` sets the project's template; plain words in a request override it once. |
| Pace | Each template sets its pace. No limit on total video length; chapter length is guidance only. |
| Player | Shows the template and shape, and offers **Remake as…**. Not a video editor. |
| Assets | Small assets in the repo; big media downloaded on first use, with consent and a checksum. |
| Voices | Kokoro's stock voices, one per speaker. Voice cloning stays out of scope (open item). |

## 3. A template

A template is a folder in the plugin, `templates/<id>/`. Ids are lowercase words joined by hyphens.

```
templates/peter-and-stewie/
  template.json   identity, shapes, speakers, pace, assets
  template.md     script rules for Claude, loaded only when this template is used
  stage.html      the fixed layout, one per shape, with one creative slot
  assets/         small files: character PNGs, stickers, fonts
  sample.mp4      a short preview for /yap:templates and the landing page
```

### 3.1 template.json

```json
{
  "id": "peter-and-stewie",
  "title": "Peter and Stewie",
  "description": "Stewie asks, Peter explains, gameplay runs behind.",
  "shapes": ["16:9", "9:16", "1:1"],
  "default_shape": "16:9",
  "speakers": [
    { "id": "stewie", "voice": "bm_george", "side": "left",  "image": "assets/stewie.png", "talking": "assets/stewie-talk.png" },
    { "id": "peter",  "voice": "am_adam",   "side": "right", "image": "assets/peter.png",  "talking": "assets/peter-talk.png" }
  ],
  "pace": {
    "voice_speed": { "stewie": 1.15, "peter": 1.1 },
    "line_gap_ms": 120,
    "max_words_per_line": 12,
    "captions": "word",
    "visual_beat": "keyword",
    "chapter_seconds": [30, 60]
  },
  "assets": [
    { "path": "assets/stewie.png" },
    { "path": "background.mp4", "url": "https://github.com/Aryanshaw/yap/releases/download/assets-1/parkour.mp4",
      "sha256": "…", "bytes": 23000000 }
  ]
}
```

Rules:

- `speakers` may be empty. The template then has one off-screen narrator, using `narrator_voice` (default `af_heart`),
  which is how `explainer` works.
- Every `voice` must be a Kokoro voice that `hyperframes tts --list` reports.
- `captions` is `word` or `line`. `visual_beat` is `keyword`, `line` or `sentence`.
- `chapter_seconds` is guidance (section 5.3). There is no field for total video length.
- An asset without `url` must exist in the repo. An asset with `url` must have `sha256` and `bytes`.

### 3.2 template.md

Plain instructions for the script, in the house style of the skill's references:

- who says what (for example "Stewie asks or doubts; Peter explains and carries every claim")
- the shape of one exchange
- the tone
- what the slot should show on each line

It ends with a **Gate** line, like every reference.

### 3.3 stage.html

The fixed part of the look, written once per template:

- the background
- the speaking character, with talking and idle poses
- the captions in the template's rhythm
- one **slot** element, where the chapter's scene (Claude's design) is placed

It has a layout for each shape it lists. It reads the chapter's timing file (beats and word times), not hard-coded
times.

### 3.4 The three first-party templates and one future one

| Id | Tier | Speakers | Stage |
|---|---|---|---|
| `explainer` (default) | — | none (narrator) | the slot is the whole frame; today's look |
| `real-life-analogy` | 1 | none (narrator) | as explainer; only the script rules differ |
| `tutor` | 2 | one professor | the professor in a corner, the slot as a blackboard |
| `peter-and-stewie` | 3 | two | background footage, speaker swaps, word captions, slot for props |

## 4. Changes to the chapter

- **Sentences gain `speaker`.** It is the id of a template speaker, or absent for the narrator. The existing `kind`
  stays: `claim` lines must cite sources, `framing` lines (questions, jokes, reactions) are exempt, exactly as today.
- **The scene draws in the slot.** Today's pieces (title, steps, code-card, callout, flow, design) render inside the
  stage's slot instead of the full frame. For `explainer`, the slot is the full frame, so nothing changes.
- **`build.json` records `template`, `template_version` and `shape`.** A render is reused only for the same template,
  version and shape.
- **`manifest.json` records the video's `template` and `shape`.** The player reads them.
- **`.yap/settings.json` (new) holds the project's `template` and `shape`.** It is written by `yap templates`. With no
  file, the template is `explainer` and the shape is 16:9.

## 5. Making a video with a template

The steps are today's; steps 3 to 5 change.

1. **Scope.** Unchanged. The number of chapters follows the material, not a length limit.
2. **Read and verify.** Unchanged and template-independent. The checked sources are kept so a remake can reuse them.
3. **Script.**
   - Claude reads `template.md` and writes each chapter's sentences with a `speaker` each, within
     `max_words_per_line`.
   - `yap audit` adds two checks: every `speaker` exists in the template, and every line stays within
     `max_words_per_line`.
4. **Narrate.**
   - Each line is spoken with its speaker's voice and `voice_speed` (`hyperframes tts --voice --speed`). The lines are
     joined with `line_gap_ms` of silence into `narration.wav`.
   - Word times come from whisper when present. Otherwise they are estimated inside each line from word length, so
     `captions: "word"` still works.
   - The doctor notes that whisper makes word captions tighter.
5. **Render.**
   - The chapter's `index.html` is the template's `stage.html` in the video's shape, with the scene in the slot and
     the chapter's assets copied into its folder (as GSAP is today).
   - Each chapter starts the background loop at a different offset.
6. **Serve, chat, Make this a video.** Unchanged. New chapters use the video's template and shape.

### 5.1 Pace

The template's `pace` block applies:

- `voice_speed` and `line_gap_ms` in narrate
- `max_words_per_line` in the script and the audit
- `captions` and `visual_beat` in the stage

Users cannot change pace; they pick a different template.

### 5.2 Remake as…

1. The player's **Remake as…** sends a viewer event `remake` with `template` and `shape` over the chat bridge (a new
   event type next to `make_video`).
2. Claude acks it and makes a **new video folder**. It reuses step 2's checked sources and redoes steps 3 to 5 for
   every chapter in the new template.
3. Chapters are built by subagents under the existing memory slots.
4. The page shows "Remaking as <template>…", and the old video stays playable.
5. The new video gets its own folder, `.yap/<slug>-<template>/`, and its own server and link once every chapter is
   ready. Each server still serves exactly one video folder.
6. When the remake is ready, Claude replies in the old page's chat with the new link ("Open the remade video"). The
   old folder is kept.

### 5.3 Length

- There is no limit on the total length. Claude decides from the question and the code how many chapters it needs.
- Each chapter aims for the template's `chapter_seconds`. Narrate prints the seconds, and Claude may split a long
  chapter.
- Exceeding `chapter_seconds` is never an error.
- This replaces the fixed "20 to 40 seconds per chapter, 2 to 3 minutes per video" rules for every template, including
  `explainer`, whose `chapter_seconds` is `[20, 40]` as guidance.

## 6. Assets

| Kind | Example | Format | Where |
|---|---|---|---|
| Characters | Peter, Stewie (idle and talking poses) | transparent PNG | repo |
| Stickers | "BOOM" burst | PNG or SVG | repo |
| Fonts | caption font | woff2 | repo |
| Background footage | parkour gameplay | muted mp4, square (for example 1440x1440), loops | download on first use |
| Sounds | pop, whoosh, a quiet beat | mp3 or wav | download on first use |

**Big media is downloaded on first use:**

- It is hosted as GitHub Release attachments and listed in `template.json` with `url`, `sha256` and `bytes`.
- The first time a template is used, Yap asks once, naming the size. It downloads into the plugin data folder
  (`<data>/templates/<id>/`), next to the voice venv, so every project shares one copy.
- A checksum mismatch deletes the file and reports which one failed.
- The same consent rule as `yap setup` applies: nothing is downloaded without a yes.

**The footage is square** so one file serves every shape by cropping.

## 7. Commands and surfaces

### 7.1 `/yap:templates` (new plugin skill) and `yap templates` (new CLI command)

```
yap templates                          list: id, description, shapes, which one the project uses
yap templates <id> [16:9|9:16|1:1]     set the project's template (and shape) in .yap/settings.json
yap templates <id> --show              details: description, shapes, pace, assets still to download, sample path
```

- The skill is a thin wrapper that runs the command and shows its output.
- An unknown id or shape prints the valid ones and exits 2.

### 7.2 In a request

The `/yap` skill reads a template and shape named in plain words ("as peter-and-stewie, vertical") and uses them for
that video only. An unknown name gets the list and a question; Claude never guesses.

### 7.3 The player

- **Header label:** `<template> · <shape>`.
- **Remake as…:** a menu of the other templates and shapes. It sends `remake` (section 5.2), shows its progress, and
  ends with a link to the remade video in the chat.
- **Vertical and square video:** the stage is sized to the shape, beside the chat. The timeline and controls are
  unchanged.

### 7.4 The landing page (later, getyap.dev)

- A gallery with one card per template, playing its `sample.mp4`.
- Every sample is made from the same example repo and question.
- The gallery is built from the template folders.

### 7.5 Contributors

- **`.claude/skills/new-template/` (repo-only, not shipped):**
  - scaffolds a template folder
  - checks the stage in every listed shape
  - renders a fixture chapter
  - produces `sample.mp4`
  - runs the template tests
- **`CONTRIBUTING.md`** gains "Adding a template".

## 8. Skill changes

- **`SKILL.md`** gets one pointer line to `references/templates.md`, keeping it within its 200-line limit. Step 1
  (scope) notes the template and shape in use, and the per-chapter length rule becomes "aim for the template's
  `chapter_seconds`".
- **`references/templates.md`** (new) covers:
  - reading `.yap/settings.json` and request overrides
  - loading `template.md`
  - writing speaker lines
  - the asset download consent
  - handling `remake` events
- **`references/ask-loop.md`** gains the `remake` row.

## 9. Errors

| Situation | Behaviour |
|---|---|
| Unknown template id | List the valid ids and stop; no guessing. |
| Shape not supported by the template | Say which shapes it supports and use its default, saying so. |
| Big asset not downloaded | Ask once. On no, the template cannot be used; there is no silent fallback. |
| Download fails or checksum mismatch | Delete the file; name the file and the reason; a retry is safe. |
| A line names an unknown speaker | `yap audit` fails the chapter; the existing redo path applies. |
| A claim line without sources | Audit failure, as today, whatever the speaker. |
| A chapter far past `chapter_seconds` | Not an error; narrate prints the seconds. |
| No whisper, word captions | Estimated word times; the doctor notes whisper. |
| Remake fails partway | The old video is untouched; the new folder is marked failed; the chat says so and offers a retry. |
| Template removed in a later release | Old videos still play (already rendered); Remake and new chapters say the template is gone. |

## 10. Testing

TDD, as in every phase.

- **Template loader:** every shipped `template.json` is valid, including voices that exist, shapes, pace fields, and
  assets present or listed with url, sha256 and bytes.
- **Audit:** the unknown-speaker and words-per-line checks; claim lines still need sources under every template.
- **Narrate** (fake programs, as today's tests use):
  - per-speaker voice and speed
  - line gaps
  - word-time estimation without whisper
- **Stage:** every shipped template renders a fixture chapter in every listed shape. Snapshot checks cover:
  - speaker swaps on the right line
  - the caption word at a given time
  - the slot holding the scene
- **Settings and commands:** `yap templates` list, set and show; request overrides; `.yap/settings.json` round trip.
- **Assets:** a checksum check against a local fixture server, refusal on mismatch, the consent prompt.
- **Player:** the label, the Remake menu sending `remake`, and vertical and square layouts at both page widths.
- **End to end:** one real `peter-and-stewie` 9:16 run on a fixture repo, with frames inspected.

## 11. Build order

1. **Template system plus `explainer`.** Today's look expressed as a template, proving nothing changed. Also
   `/yap:templates`, `.yap/settings.json`, the player label, vertical support in the player, and Remake.
2. **`real-life-analogy`** (tier 1: script only).
3. **`tutor`** (tier 2: one character).
4. **`peter-and-stewie`** (tier 3: two characters, background footage, word captions, props).

Each step has its own plan and ships on its own.

## 12. Amendments to the parent spec

- **A25 (5, step 2 and the chapter rules):** chapter length is guidance taken from the template's `chapter_seconds`;
  there is no limit on total video length.
- **A26 (3 and 12):** "podcast or reel formats" and "named characters" move from out of scope to templates (this
  spec). Voice cloning stays out of scope.
- **A27 (4.7):** the player shows the template and shape, offers Remake as…, and plays 9:16 and 1:1 video.
- **A28 (4.3):** new viewer event `remake` with `template` and `shape`.

## 13. Spike results (`spikes/08-templates/`)

A one-chapter spike (stand-in art, 9:16) ran the design on the real pipeline:
- the audit passed unchanged with speaker lines and failed broken copies
- two Kokoro voices were joined with the template's gaps
- `hyperframes check` passed
- the render came out 1080x1920 in 29 s for 22 s of video
- sampled frames matched the timing (caption word, speaker, slot prop, source chip)

Changes it calls for:

- **Narrate speaks a chapter's lines in one Python process** (Kokoro loaded once), not one `hyperframes tts` call per
  line. Measured: about 10 s per call.
- **Stages keep captions and source chips on a backing plate** or in a clear band.
- **A keyword prop whose word falls in the last third of its line appears at the line's start.**
- **The first run with whisper measures how far estimated word times drift.**

## 14. Not in this spec

- Voice cloning: the stock voices only approximate the characters.
- A cast option, per-chapter templates, user-adjustable pace, and a video editor in the player.
- The landing page itself (only its gallery's source is defined here).
- Which footage and character art ship with `peter-and-stewie`: the owner supplies them.
