# oldguy: Video Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Per the owner's standing preference, this plan carries **signatures, test cases, commands and logic sketches, not
> full implementations**. Write the real code in the house style: a one- or two-line plain-words comment above every
> function and every non-obvious step.

**Goal:** Let a video be told in a chosen **template** (voices, characters, layout, pace, script shape) and **shape**
(16:9, 9:16 or 1:1) without loosening the fact-check. Ship four templates: `explainer` (today's look, the default),
`real-life-analogy`, `tutor` and `peter-and-stewie`.

**Architecture:**
- A template is a folder `templates/<id>/` with `template.json`, `template.md`, `stage.html`, small assets and
  `sample.mp4`.
- A **stage driver** in `lib/stage.mts` builds each chapter page from the template's layout and the chapter's timing:
  - the background
  - the speaker swaps
  - captions (one word or one line)
  - keyword props and source chips
  - the slot, which holds today's scene pieces scaled into it
- Narrate learns per-speaker voices with one Kokoro process per chapter.
- The project's choice lives in `.oldguy/settings.json`, and each video records its own in `manifest.json`.
- The player shows the template, plays any shape, and sends `remake`.

**Spec:** `docs/superpowers/specs/2026-10-07-video-templates-design.md`, including section 13 (spike findings).
**Spike:** `spikes/08-templates/` shows the stage technique working on the real pipeline.

**Tech stack:** unchanged. Node 22.18+ running `.mts` directly, `node:test`, React/Vite/Vitest for the player, the
pinned Hyperframes 0.8.112, Kokoro through the plugin's Python venv.

## Decision record (owner agreed 2026-10-07)

1. Only the repo ships templates; others contribute by PR.
2. The architecture supports tiers 1 to 3. The build order is explainer, then real-life-analogy, then tutor, then
   peter-and-stewie.
3. Fixed characters per template; no cast option.
4. One template per video; follow-up chapters inherit it.
5. 16:9 by default; 9:16 and 1:1 on request; one shape per video.
6. A fixed stage plus one creative slot (approach 3).
7. A template is not a skill. `/oldguy:templates` is a plugin skill; `new-template` is a repo-only contributor skill.
8. `/oldguy:templates <id> [shape]` sets the project; plain words in a request override it once.
9. Each template sets its pace. There is no total-length limit; `chapter_seconds` is guidance.
10. The player shows `<template> · <shape>` and **Remake as…**.
11. Small assets live in the repo. Big media is downloaded on first use, with consent and a sha256.
12. Kokoro stock voices only. Voice cloning is out of scope.

## Global constraints

- **No behaviour change for existing videos.**
  - A manifest or settings file without template fields means `explainer` at 16:9.
  - For `explainer`, `index.html` must stay **byte-identical** to today's output, so existing `build.json`
    fingerprints stay valid and nothing turns "out of date". `RECORD_VERSION` is **not** bumped.
- **No runtime dependencies** in `bin/`, `lib/`, `cli/`, `server/`, `scene-kit/`, `hooks/` (owner rule; layering
  enforced by `tests/code-rules.test.cjs`).
- **The fact-check never depends on the template.**
  - `claim` lines need sources under every template.
  - Templates only add checks (unknown speaker, words per line); they never remove one.
- **TDD per task:** failing test, implement, pass, commit. `npm test` is green at every commit. Player tasks also run
  `npm test`, `npm run typecheck`, `npm run build` and `npm run check:dist` in `player/`.
- **`SKILL.md` stays at 200 lines or fewer**; template detail goes in `references/templates.md`.
- **Users never see what making a video uses up or charges** (house rule).
- Work on branch `claude/admiring-turing-vi8pw2` (restarted from `master` per the merged-PR rule). One PR per phase
  (A to D) unless the owner says otherwise.

## File map

| File | Status | Responsibility |
|---|---|---|
| `lib/template.mts` | new | Template types, loading, validation, listing |
| `lib/voices.mts` | new | The pinned list of Kokoro voice ids (checked against `hyperframes tts --list` in a test) |
| `lib/settings.mts` | new | `.oldguy/settings.json` read and write; the request-override merge |
| `lib/stage.mts` | new | Builds a chapter page from a template, shape, timing and scene |
| `lib/word-times.mts` | new | Word times estimated inside lines; keyword anchor resolution |
| `lib/speak.py` | new | One Kokoro process that speaks many lines with per-line voice and speed |
| `lib/voice.mts` | new | Runs `speak.py`, joins lines with gaps, returns line and word timing |
| `lib/assets.mts` | new | Resolves template assets (repo or data folder), downloads with checksum |
| `lib/chapter.mts` | change | `speaker` on sentences, `word` anchor on scene entries, page building through `stage.mts` |
| `lib/narrate.mts` | change | Multi-speaker path through `voice.mts`; the explainer path unchanged |
| `lib/audit.mts` | change | Speaker and words-per-line checks when a template is given |
| `lib/manifest.mts` | change | Optional `template` and `shape` on the manifest |
| `lib/events.mts` | change | New viewer event `remake` with `template` and `shape` |
| `lib/build-record.mts` | change | Optional `template` block (id, version, shape); assets fingerprinted |
| `cli/templates.mts` | new | `oldguy templates` list, set, show and fetch |
| `cli/remake.mts` | new | `oldguy remake`: a new video folder that reuses the checked sources |
| `cli/narrate.mts`, `cli/audit.mts`, `cli/scaffold.mts` | change | Read the video's template |
| `bin/oldguy.mts` | change | Register `templates` and `remake` |
| `templates/explainer/` and the other three | new | The four templates |
| `skills/templates/SKILL.md` | new | `/oldguy:templates` |
| `skills/oldguy/references/templates.md` | new | Template rules for the main skill |
| `skills/oldguy/SKILL.md`, `references/ask-loop.md`, `references/scope.md` | change | Pointer line, `remake` row, length as guidance |
| `.claude/skills/new-template/SKILL.md` | new | Contributor skill (repo only) |
| `player/src/...` | change | Label, any-shape stage, Remake menu, `remake` event |
| `tests/*.test.cjs` | new and change | One test file per new module, plus `tests/templates-shipped.test.cjs` |
| `CONTRIBUTING.md`, `docs/STATUS.md`, parent spec | change | Adding a template; status; amendments A25 to A28 |

---

# Phase A: the template system, with `explainer`

Ships: templates as folders, `/oldguy:templates`, settings, any-shape stage, the player label and vertical playback,
Remake, and assets. Today's videos are unchanged.

### Task A1: Template model and validation

**Files:** create `lib/template.mts`, `lib/voices.mts`, `tests/template.test.cjs`.

```ts
type Shape = '16:9' | '9:16' | '1:1';
type Speaker = { id: string; voice: string; side: 'left' | 'right' | 'center'; image?: string; talking?: string };
type Pace = { voice_speed: Record<string, number> | number; line_gap_ms: number; max_words_per_line: number;
  captions: 'word' | 'line'; visual_beat: 'keyword' | 'line' | 'sentence'; chapter_seconds: [number, number] };
type Asset = { path: string; url?: string; sha256?: string; bytes?: number };
type Template = { id: string; version: number; title: string; description: string; shapes: Shape[]; default_shape: Shape;
  speakers: Speaker[]; narrator_voice?: string; pace: Pace; assets: Asset[]; dir: string };

const SHAPES: Record<Shape, { width: number; height: number }>;  // 1920x1080, 1080x1920, 1440x1440
function templatesRoot(): string;                       // <plugin root>/templates
function loadTemplate(id: string, root?: string): Template;  // throws with every problem listed
function listTemplates(root?: string): Template[];      // sorted by id; explainer first
function validateTemplate(raw: unknown, dir: string): string[];  // [] when valid
```

**Validation rules (spec 3.1):**
- The id is a slug and matches the folder name.
- `version` is a positive integer.
- `shapes` is non-empty and contains `default_shape`.
- Speaker ids are unique slugs, and every voice is in `KOKORO_VOICES`.
- `voice_speed` is between 0.5 and 2.
- `line_gap_ms` is between 0 and 2000.
- `max_words_per_line` is at least 3.
- `chapter_seconds` has min ≤ max.
- Assets: a path stays inside the folder. An asset without `url` exists on disk; one with `url` has a 64-hex
  `sha256` and positive `bytes`.
- `template.md` and `stage.html` exist.

**Test cases:**
- a valid fixture loads
- each rule has one failing fixture whose message names the field
- an unknown id lists the valid ids
- `KOKORO_VOICES` equals the voices `hyperframes tts --list` prints (skipped when npx is offline)

- [ ] Write the tests, run them, see them fail. Implement. `npm test` green. Commit
  `feat: template model and validation`.

### Task A2: Settings and the video's choice

**Files:** create `lib/settings.mts`, `tests/settings.test.cjs`. Change `lib/manifest.mts` and its tests.

```ts
type VideoChoice = { template: string; shape: Shape };
function readSettings(projectDir: string): VideoChoice;          // missing or bad file → explainer, 16:9
function writeSettings(projectDir: string, choice: VideoChoice): void;  // atomic write
function chooseForVideo(settings: VideoChoice, override: Partial<VideoChoice>, t: Template): VideoChoice;
// an unsupported shape → the template's default_shape (the caller says so)
```

- The manifest gains optional `template` and `shape`.
- `validateManifest` accepts them, and `newManifest({ ..., template, shape })` sets them.
- An old manifest without them reads as explainer at 16:9.

**Test cases:**
- round trip
- missing file
- corrupt file
- override wins
- unsupported shape falls back
- an old manifest loads unchanged and re-saves byte-identical

- [ ] TDD as above. Commit `feat: project template settings; manifest records template and shape`.

### Task A3: Chapter model, speaker and keyword anchor

**Files:** change `lib/chapter.mts` and `tests/chapter.test.cjs`.

- `ChapterSentence` gains `speaker?: string`.
- `ChapterScene` gains `word?: string`: the piece starts on that word of its beat's sentence instead of the
  sentence start.
- `scaffoldChapter` takes an optional `template: Template`:
  - each `speaker` must be one of the template's speakers (or absent when it has none)
  - a sentence's word count must be ≤ `max_words_per_line`
  - a scene `word` must occur in its beat's sentence
- Without a template, behaviour is exactly today's.

**Test cases:**
- an unknown speaker fails
- 13 words against a cap of 12 fails (the spike's exact case)
- a `word` that is not in its sentence fails
- the no-template path keeps the existing tests green

- [ ] TDD. Commit `feat: chapters carry speakers and keyword anchors`.

### Task A4: Audit knows the template

**Files:** change `lib/audit.mts`, `cli/audit.mts`, `tests/audit.test.cjs`.

`oldguy audit <chapter.json> --root <repo> [--template <id>]`. When the chapter sits in a video folder, the template is
read from that folder's manifest. Added checks: unknown speaker, words per line. Every existing check is untouched.

**Test cases:**
- `spikes/08-templates/chapter.json` passes with the peter-and-stewie fixture template, except the 13-word line,
  which fails
- the spike's two broken copies (wrong line; claim without sources) still fail
- the same chapter without a template behaves as today

- [ ] TDD. Commit `feat: audit checks speakers and line length against the template`.

### Task A5: The explainer template, byte-identical

**Files:** create `templates/explainer/{template.json, template.md, stage.html}` and `lib/stage.mts`; change
`lib/chapter.mts` (`buildRootComposition` delegates to `buildStagePage`); create `tests/stage.test.cjs`.

```ts
type Timing = { durationS: number; lines: { start: number; end: number; speaker?: string }[];
  words: { line: number; text: string; start: number; end: number }[] };
function buildStagePage(input: { template: Template; shape: Shape; chapter: ChapterSpec; timing: Timing;
  pieces: PieceWindow[]; assetsDir: string }): string;
```

**`stage.html` contract.** It is a fragment, not a page:
- one `<style>` block that may use `{{W}}`, `{{H}}` and `[data-shape="9:16"]` selectors
- markup with these markers:
  - `<!-- oldguy:background -->`
  - `<!-- oldguy:slot -->` (a box with a size)
  - `<!-- oldguy:speakers -->`
  - `<!-- oldguy:captions -->`
  - `<!-- oldguy:chips -->`

`stage.mts` fills the markers and writes the GSAP timeline lines. `explainer`'s stage is today's 1920x1080 root with
only the slot marker, so for explainer at 16:9 the page is byte-identical to `buildRootComposition` today.

**The slot.** Scene pieces are authored for 1920x1080. The slot wraps them in a 1920x1080 box scaled with
`transform: scale()` to the slot's size, so no scene-kit piece changes.

**Test cases:**
- **golden test:** for three existing fixture chapters, `buildStagePage(explainer, '16:9')` equals the bytes
  `buildRootComposition` produced before this task (snapshot them first in the test fixtures)
- explainer at 9:16 produces `data-width="1080" data-height="1920"` and a scaled slot
- markers missing from a `stage.html` fail clearly

- [ ] Snapshot today's output first, then refactor. Commit `feat: stage driver and the explainer template`.

### Task A6: Stage features for speakers, captions, keyword props, chips and background

**Files:** change `lib/stage.mts`; create `lib/word-times.mts`; extend `tests/stage.test.cjs`; create
`tests/word-times.test.cjs`.

```ts
function estimateWords(lines: { text: string; start: number; end: number }[]): Timing['words'];  // length-weighted, 0.1 s inset
function anchorTime(timing: Timing, beat: number, word?: string): number;  // spec 13: last third → line start
```

The stage driver adds:
- **Speakers:** the speaking character is shown and the others hidden at each line start, with a talk bob (or a
  swap to the `talking` image) for the line.
- **Captions:** `word` shows one word per element; `line` shows one cue per line. Both sit on a backing plate
  (spike finding 3).
- **Source chips:** on `claim` lines, `file:line` of each source, on the plate band.
- **Background:** a template `background` asset becomes a muted looping `<video>`. Each chapter starts it at an
  offset of `hash(chapter id) mod length`. Without a background, the `stage.html` background is used.

**Test cases:**
- swap times equal line starts
- a word caption is visible exactly in its word window
- a keyword in the last third anchors at the line start
- chips appear only on claim lines
- the offset is stable per chapter id

**Visual check:** rebuild the spike chapter through `buildStagePage`, run `hyperframes check` (it must pass), and
look at five frames.

- [ ] TDD plus the visual check. Commit `feat: stage speakers, word captions, keyword props, chips, background`.

### Task A7: One Kokoro process per chapter (multi-speaker narrate)

**Files:** create `lib/speak.py`, `lib/voice.mts`, `tests/voice.test.cjs`; change `lib/narrate.mts` and
`tests/narrate.test.cjs`.

- **First, a probe** (recorded in the task report): confirm `kokoro_onnx` in the venv can load the model and voices
  from the Hyperframes cache (`~/.cache/hyperframes/tts/models/`). If the voices file is not there, `speak.py`
  fetches nothing and instead the fallback is one `hyperframes tts` call per **speaker run**: consecutive lines of
  one speaker joined into one call and split again at sentence beats. Pick one path, and write it in the plan
  report.
- **`speak.py`:** reads JSON on stdin `{ lines: [{ text, voice, speed }], out_dir }`, loads Kokoro once, writes
  `line<i>.wav`, and prints JSON durations.
- **`voice.mts`:**
  ```ts
  async function speakLines(lines: { text: string; voice: string; speed: number }[], opts: { python: string; gapMs: number; work: string; run: RunProgram }):
    Promise<{ wav: string; lines: { start: number; end: number }[] }>;
  ```
  It joins the lines with `gapMs` of silence through `lib/wav.mts` (no ffmpeg needed for PCM), adds the existing
  lead and tail padding, and returns the line times.
- **`narrate.mts`:**
  - When the template has speakers, it uses `speakLines`, builds beats from the line times (exact, one beat per
    line), and word times from whisper when available, otherwise `estimateWords`.
  - When the template has no speakers (explainer, analogy), it keeps the current single-call path unchanged.
  - `beats.json` gains `lines` and `words`.

**Test cases** (fake `run`, as the narrate tests already do):
- per-line voice and speed reach `speak.py`'s input
- gaps are placed correctly
- durations sum correctly
- a failing line names its index
- the explainer path's existing tests pass unchanged

- [ ] TDD plus one real run of the spike's 8 lines. Target: well under the spike's 87 s; record the time. Commit
  `feat: narrate speaks many voices in one Kokoro process`.

### Task A8: Assets, resolution and download

**Files:** create `lib/assets.mts`, `tests/assets.test.cjs`; change `lib/narrate.mts` (copy assets into the
chapter) and `lib/build-record.mts` (fingerprint the copies; optional `template` block `{ id, version, shape }`, absent
meaning explainer@16:9).

```ts
function assetPath(t: Template, a: Asset, dataDir: string): string;      // repo file, or <data>/templates/<id>/<path>
function missingAssets(t: Template, dataDir: string): Asset[];            // url assets not yet downloaded and verified
async function fetchAsset(t: Template, a: Asset, dataDir: string, get: Getter): Promise<void>;
// streams to a temp file, checks bytes and sha256, renames; on mismatch deletes and throws naming the file
```

**Test cases:**
- a local HTTP fixture server serves good and bad files
- mismatch → deleted, plus an error naming the file and both hashes
- an interrupted download leaves nothing behind
- `missingAssets` is empty after a good fetch
- a build record for explainer is unchanged (no `template` block)

- [ ] TDD. Commit `feat: template assets with checksummed download on first use`.

### Task A9: `oldguy templates` and `/oldguy:templates`

**Files:** create `cli/templates.mts`, `tests/templates-cli.test.cjs`, `skills/templates/SKILL.md`; change
`bin/oldguy.mts`.

```
oldguy templates                          list (id, description, shapes, ← current)
oldguy templates <id> [16:9|9:16|1:1]     set .oldguy/settings.json; prints what was set and any shape fallback
oldguy templates <id> --show              description, shapes, pace, missing assets with sizes, sample path
oldguy templates <id> --fetch             download missing assets (the skill runs this only after the user's yes)
```

An unknown id or shape exits 2 and lists the valid ones.

`skills/templates/SKILL.md` covers:
- running the command
- showing the output as is
- asking before `--fetch`, naming the size
- never guessing an id

**Test cases:**
- list marks the current template
- set writes settings
- show lists missing assets
- an unknown id exits 2
- the skill lint: the skill exists, names only real commands, stays within the line cap

- [ ] TDD. Commit `feat: oldguy templates and the /oldguy:templates skill`.

### Task A10: Remake (event, CLI helper, skill)

**Files:**
- `lib/events.mts`: add `remake` with required `template` and `shape`; validation messages like `ref`'s
- `server/api.mts`: `handleMessage` forwards `template` and `shape`
- `cli/remake.mts` (new), `bin/oldguy.mts`
- `skills/oldguy/references/ask-loop.md` (`remake` row), `skills/oldguy/references/templates.md` (new)
- tests: `tests/events.test.cjs`, `tests/server-api.test.cjs`, `tests/remake.test.cjs`

```
oldguy remake --from .oldguy/<slug> --template <id> [--shape <s>]
  → creates .oldguy/<slug>-<id>/ with: manifest (template, shape, chapter ids and titles, every row pending),
    sources.json and script.md copied, order.json copied; prints the new folder. Refuses if it exists.
```

**The skill's `remake` row:**
1. ack the event
2. `oldguy remake`
3. rewrite each chapter's sentences for the template (reusing the copied sources)
4. build chapters with subagents
5. `oldguy serve --detach` the new folder
6. reply in the old page's chat with the new link

**Test cases:**
- the event needs both fields
- an unknown template is refused at the server with 400
- the remake folder holds the copied files and pending rows
- a second remake to the same id refuses

- [ ] TDD. Commit `feat: remake a video in another template`.

### Task A11: Player (label, any shape, Remake menu)

**Files:**
- `player/src/types.ts`: manifest `template?` and `shape?`
- `player/src/components/Header.tsx`: label `<template> · <shape>` (shown when present)
- `player/src/components/VideoStage.tsx`: aspect from the shape (`aspect-video`, `aspect-[9/16]` or
  `aspect-square`), with a max height so a 9:16 stage fits beside the chat
- new `player/src/components/RemakeMenu.tsx`: lists templates from a new read-only route `GET /api/templates` (id,
  title, shapes) and sends `remake`
- `player/src/state/store.ts`
- `server/player-routes.mts` (the route)
- tests for each, plus `player/dist` rebuilt

**Test cases:**
- label text
- 9:16 class and max height at both page widths
- the menu lists templates except the current one
- choosing one posts `{ type: 'remake', template, shape }`
- a remake in progress shows "Remaking as …"

**Visual check:** screenshots at 1440 and 900 for 16:9 and 9:16 videos.

- [ ] TDD; `npm test`, `typecheck`, `build`, `check:dist`. Commit
  `feat(player): template label, vertical and square video, Remake menu`.

### Task A12: Skill text and length rules

**Files:**
- `skills/oldguy/SKILL.md`: one pointer line to `references/templates.md`; the per-chapter length rule becomes "aim for
  the template's `chapter_seconds`; no total length limit"
- `skills/oldguy/references/scope.md`: length from the material, not 2 to 3 minutes
- `references/templates.md`:
  - settings and request overrides
  - load `template.md`
  - write speaker lines
  - scene `word` anchors
  - asset consent
  - remake
- `tests/skill-lint.test.cjs`: required file list; `remake` and `templates` commands known

- [ ] Skill lint green; SKILL.md ≤ 200 lines. Commit `feat(skill): templates`.

### Task A13: Contributor skill and docs

**Files:**
- `.claude/skills/new-template/SKILL.md` (repo only), which:
  - scaffolds `templates/<id>/`
  - runs `oldguy templates <id> --show`
  - builds a fixture chapter through `buildStagePage` in every shape
  - runs `hyperframes check`
  - renders `sample.mp4`
  - runs `tests/templates-shipped.test.cjs`
- `CONTRIBUTING.md` "Adding a template"
- `tests/templates-shipped.test.cjs`: every folder in `templates/` loads, its stage has the markers, and its assets
  are present or downloadable

- [ ] Commit `docs: adding a template; contributor skill`.

### Task A14: Phase A acceptance and roll-up

- An existing explainer video: re-narrate and re-render one chapter. Its `index.html` is unchanged and its
  build record is still current.
- A new 2-chapter explainer video at 9:16 renders and plays in the player as a tall stage. Take screenshots.
- `/oldguy:templates` list, set and show work in a real Claude Code session (isolated config).
- Remake from 16:9 explainer to 9:16 explainer runs end to end through the page (Playwright plus the live loop, as
  in Phase 4).
- Write `docs/templates/SUMMARY.md` and update `docs/STATUS.md` and the parent spec's amendments A25 to A28.
- Open the PR only if the owner asks.

---

# Phase B: `real-life-analogy` (tier 1)

### Task B1: The template

**Files:** create `templates/real-life-analogy/{template.json, template.md, stage.html}`.

- No speakers; narrator `af_heart`.
- Pace: about the explainer's, `chapter_seconds` [25, 45].
- `template.md` rules:
  - open each chapter with one everyday analogy
  - map each part of the analogy to the code, as `claim` lines with sources
  - never let the analogy make a claim the code does not support
  - the slot shows the analogy and the code side by side
- `stage.html` is the explainer's layout with a two-column slot.

- [ ] `tests/templates-shipped.test.cjs` green. Make one real chapter on a fixture repo through the skill, then:
  audit, narrate, `hyperframes check`, render, look at frames. Generate `sample.mp4`. Commit
  `feat(templates): real-life-analogy`.

---

# Phase C: `tutor` (tier 2)

### Task C1: The template

**Files:** create `templates/tutor/...`.

- One speaker, `professor`, voice `bm_george` at 0.95.
- Art: the **owner supplies** the professor cut-outs (idle and talking). A clearly marked stand-in SVG is used until
  they arrive.
- Stage: the professor in the lower right; the slot styled as a blackboard; captions on a plate, `line` mode.
- `template.md` rules: start from the fundamental idea, build up one step per line, then name the real code.

- [ ] Shipped-templates test green. One real chapter in 16:9 and 9:16, with frames inspected. `sample.mp4`. Commit
  `feat(templates): tutor`.

---

# Phase D: `peter-and-stewie` (tier 3)

### Task D1: Assets

The **owner supplies:**
- the Peter and Stewie cut-outs (idle and talking)
- square muted gameplay footage (about 1440x1440, a 60 to 90 s loop)

Then:
- Upload the footage as a GitHub Release attachment (`assets-1`) and record `url`, `sha256` and `bytes` in
  `template.json`.
- Commit the small images to `templates/peter-and-stewie/assets/`.

### Task D2: The template

- Speakers: `stewie` (`bm_george` 1.15, left) and `peter` (`am_adam` 1.1, right).
- Pace:
  - `line_gap_ms` 120
  - `max_words_per_line` 12
  - `captions: "word"`
  - `visual_beat: "keyword"`
  - `chapter_seconds` [30, 60]
- `shapes` all three; default 16:9.
- `stage.html` layouts for each shape:
  - 16:9: speakers on the left and right edges, captions top-centre, slot centre
  - 9:16: as the reel (speaker bottom left or right, captions upper middle, slot middle)
  - 1:1: a compact version of 9:16
- `template.md` (from the reel's structure):
  - Stewie asks or doubts; Peter explains and carries every claim
  - Stewie pushes back once per chapter
  - each claim line names one visual for the slot

- [ ] Shipped-templates test green. A real 9:16 chapter on a fixture repo, then: audit, narrate (one Kokoro process),
  check, render, frames compared against `beats.json`. Do the same at 16:9.

### Task D3: Word timing drift (spike finding 5)

On a machine with whisper (the owner's Mac), narrate the same chapter twice, once with whisper and once with
estimated times, and measure the mean and maximum word-start difference. If the maximum is over 150 ms, estimated
timing gets a per-word correction from syllable counts. Record the result.

- [ ] Commit `feat(templates): peter-and-stewie`, with `sample.mp4` and the drift measurement in
  `docs/templates/SUMMARY.md`.

---

## Verification (every phase)

- Root `npm test` (type check plus all node tests) and the player checks green at each commit.
- Each phase ends with a real run of its template in at least two shapes, `hyperframes check` passing, and frames
  inspected against `beats.json`.
- Phase A's byte-identical golden test and the re-render of an existing chapter prove today's videos are unaffected.
- `docs/templates/SUMMARY.md` records what was measured and anything not verified (for example H.264 playback in a
  real browser, carried over from `docs/STATUS.md`).
