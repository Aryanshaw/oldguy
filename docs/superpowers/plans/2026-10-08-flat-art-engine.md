# oldguy: Flat Art Engine Implementation Plan

> **For agentic workers:** implement task by task; steps use checkbox (`- [ ]`) syntax for tracking.
>
> Per the owner's standing preference, this plan carries **signatures, test cases, commands and logic sketches, not
> full implementations**. Write the real code in the house style: a one- or two-line plain-words comment above every
> function and every non-obvious step.

**Goal:** TED-Ed-quality illustrated shots for the `real-life-analogy` template: a ~70-item flat SVG art library made
once (sg MCP), and a shot compiler that turns one JSON shot per sentence into the chapter's scene.

**Spec:** `docs/superpowers/specs/2026-10-08-flat-art-engine-design.md`.

**Architecture:**
- `art/flat/` holds the library: SVGs plus `catalog.json` (ids, tags, size classes, colour groups, anchors, host
  eye/mouth layers). Ships in the repo (~2 MB).
- `tools/art/` holds the one-time pipeline (style prompt, clean, vectorise, palette snap, check, contact sheet, anchor
  tool). Repo-only; never imported by `lib/`, `cli/`, `server/`.
- `lib/shots.mts` validates `shots/<id>.json` against the catalog and `rules.md`, then writes `scenes/<id>.html`: a
  design scene that uses the scene kit's existing `beat(n)` (`scene-kit/design.mts:147`) for timing. So it runs
  **before** scaffold, needs no beat times, and plugs into the existing `{"file": "scenes/<id>.html"}` design piece
  (`lib/chapter.mts:120`) with no change to scaffold, narrate or render.
- `oldguy shots --dir .oldguy/<slug>` (new `cli/shots.mts`) compiles every chapter's shots.
- `templates/real-life-analogy/` is rewritten on top of it; the code-built people and props in `kit/kit.js` are
  retired, its chalk marks and vendored font move into the compiler's runtime.

**Tech stack:** unchanged for shipped code (Node 22.18+ `.mts`, `node:test`, GSAP as the scene kit loads it,
Hyperframes 0.8.112). The pipeline adds repo-only tools: Python `vtracer` (MIT, `pip install vtracer`) in a dev venv,
and the sg MCP tools (image edit model, bria / birefnet background removal), called by the agent following
`tools/art/RUNBOOK.md`.

## Decision record (owner agreed 2026-10-08)

1. One-time paid generation is fine; every video afterwards composes from the library for free.
2. Cast: 3 base bodies × 8 poses, recoloured in code; plus old guy and new guy × 8 poses as hosts.
3. Motion: pose swaps, pop-in, chalk draw-on, camera push/pan; hosts also blink and flap their mouth. No rigging.
4. Approach 1: asset library + shot list compiler, with a `raw` SVG escape hatch.
5. Library ~70 items, ~2 MB, in the repo. Backgrounds drawn in code. New props only when a video needs them.
6. Owner approves the style bible and the model sheets before mass generation.
7. Story: one running example through the video; one everyday metaphor per chapter; title card and ground colour
   per chapter; bookend ending.

## Global constraints

- **No behaviour change** for explainer, tutor, old-and-new or existing videos. The compiler only produces
  `scenes/*.html`; nothing in narrate, stage or render changes.
- **No runtime dependencies** in `lib/`, `cli/`, `server/`, `scene-kit/` (layering enforced by
  `tests/code-rules.test.cjs`). `tools/art/` may use dev-only tools and is not imported by shipped code.
- **The fact-check never depends on the art.** Cards carry `src` (file:line) and are checked against the chapter's
  sources; `oldguy lesson` still gates every sample.
- **TDD per task:** failing test, implement, pass, commit. `npm test` green at every commit.
- **Owner gates are hard stops:** Tasks 3 and 4 end by showing contact sheets and waiting for approval.

## File map

| Path | New/changed | Purpose |
| --- | --- | --- |
| `art/flat/catalog.json`, `art/flat/{cast,hosts,props}/*.svg` | new | the library |
| `art/flat/PALETTE.json` | new | palette tokens (hex) shared by pipeline, compiler and tests |
| `art/flat/CREDITS.md` | new | how the art was made; font licence |
| `tools/art/RUNBOOK.md` | new | step-by-step generation runbook for an agent |
| `tools/art/style.md` | new | the fixed style prompt + reference image list |
| `tools/art/vectorize.py` | new | PNG → SVG (vtracer), palette snap, simplify |
| `tools/art/check.mjs` | new | per-item checks (same rules as the catalog test) |
| `tools/art/sheet.mjs` | new | contact sheets per category, full and thumbnail size |
| `tools/art/anchors.html` | new | local tool: click to set anchors / face layers, writes catalog entries |
| `lib/catalog.mts` | new | loads and validates `catalog.json`; recolour maps |
| `lib/shots.mts` | new | shot validation, layout, compile to scene HTML |
| `lib/shots-runtime.js` | new | the in-page runtime (placement already resolved; motion presets, chalk, blink, flap) |
| `cli/shots.mts` | new | `oldguy shots --dir` |
| `bin/oldguy.cjs` | changed | register `shots` |
| `templates/real-life-analogy/*` | rewritten | template on the engine |
| `tests/catalog.test.cjs`, `tests/shots.test.cjs`, `tests/art-catalog.test.cjs`, `tests/fixtures/flat-art/` | new | tests |
| `skills/oldguy/SKILL.md`, `references/templates.md` | changed | run `oldguy shots` before scaffold when the template has `shots: true` |

---

## Task 1: Pipeline spike (prove the art path before building on it)

**Files:** `spikes/09-flat-art/` (scratch, committed as a record).

- [ ] Make a dev venv for tools: `python3 -m venv tools/art/.venv && tools/art/.venv/bin/pip install vtracer pillow`
  (add `tools/art/.venv/` to `.gitignore`).
- [ ] Generate **one** flat test image with the sg MCP (image edit model, a TED-Ed reference frame as
  reference — kept locally, never committed, since it is third-party art — prompt from a draft `tools/art/style.md`): a person holding an apple, plain
  background.
- [ ] Background removal (bria / birefnet) → PNG with alpha.
- [ ] `vtracer` with `colormode=color`, `filter_speckle=8`, `color_precision=5`, `layer_difference=24`,
  `mode=spline`; record size and path count.
- [ ] Palette snap: replace each fill with the nearest `PALETTE.json` colour (CIE76 ΔE); merge same-colour paths.
- [ ] Render the SVG at 1920 wide and at 240 wide in Chromium; compare with the PNG.
- [ ] **Exit criteria** (write findings to `spikes/09-flat-art/FINDINGS.md`): SVG ≤ 40 KB, ≤ 8 fills, no visible
  seams at 1920, reads at 240. If seams show, try `mode=polygon` and a 0.5px same-colour stroke fallback *only in
  the pipeline* (rules still forbid authored outlines); record which settings win.

## Task 2: Palette, style prompt, runbook

**Files:** `art/flat/PALETTE.json`, `tools/art/style.md`, `tools/art/RUNBOOK.md`.

- [ ] `PALETTE.json`: grounds (indigo `#1E1A4D`-ish, blue, off-white, near-black), warm accents (coral, peach,
  yellow, lilac, orange), skin tones (5), hair (6), chalk white, card paper, ink. Names are the tokens shots use.
- [ ] `style.md`: the fixed prompt (flat vector, solid fills, no outlines, no gradients, no texture, geometric face:
  dot eyes, bar brows, one-stroke nose; palette as hex; centred on plain `#FFFFFF`; one subject; full body unless
  the pose says close-up), negative list, and per-kind templates (`cast pose`, `host pose`, `prop`).
- [ ] `RUNBOOK.md`: exact MCP calls in order (upload references with `upload_to_cdn_base64`, edit model call, poll,
  download, background removal, `vectorize.py`, `check.mjs`, anchors, sheet), naming
  (`cast/body-a-point.svg`, `hosts/oldguy-shock.svg`, `props/mailbox.svg`), and the retry rule (regenerate with a
  one-line fix note; max 3 tries, then flag).
- [ ] Commit.

## Task 3: Style bible — OWNER GATE

- [ ] Generate 4 frames per `RUNBOOK.md`: a cast person (body A, `point`), a prop (`shop-counter`), a full scene
  (person + counter + bell, the composed-shot example from the spec), and old guy + new guy together.
- [ ] Vectorise, check, build `tools/art/sheet.mjs` output `art/flat/_review/style-bible.png`.
- [ ] Run two critic agents (`video-perception-psychologist`, plus a style-consistency prompt) against the TED-Ed
  reference frames; fix and regenerate until both say "matches".
- [ ] **Stop. Send the sheet to the owner. Do not continue until approved.** Approved frames become the reference
  set in `style.md`.

## Task 4: Model sheets — OWNER GATE

- [ ] Body A, B, C: neutral front, full body, varied age / build (e.g. lanky young, sturdy middle-aged, small older);
  each with clearly separable fill groups (skin, hair, top, bottom, shoes) so recolouring works.
- [ ] Old guy, new guy: neutral front, flat redraws of the brand sheets (old guy: "#1 DEV" cap, red beard, glasses,
  headset, mug; new guy: curly hair, backwards blue cap with tag, "HELLO NEW GUY" sticker, VISITOR badge).
- [ ] Sheet `art/flat/_review/model-sheets.png`; critics; **stop for owner approval.**

## Task 5: Catalog loader and recolouring (`lib/catalog.mts`)

**Files:** `lib/catalog.mts`, `tests/catalog.test.cjs`, `tests/fixtures/flat-art/` (3 tiny hand-written SVGs + a
catalog).

```ts
export type Anchor = { x: number; y: number };                    // in the SVG's own viewBox units
export type Item = {
  id: string; kind: 'cast' | 'host' | 'prop';
  file: string;                                                    // relative to art/flat/
  tags: string[]; size: 'tiny' | 'small' | 'medium' | 'large' | 'person' | 'huge';
  viewBox: [number, number, number, number];
  anchors: Record<string, Anchor>;                                 // hand, eye, top, card, floor, ...
  colors?: Record<string, string>;                                 // cast: group name -> fill in the file
  layers?: { eyes: string; eyesShut: string; mouth: string; mouthOpen: string }; // hosts
  body?: string; pose?: string;                                    // cast / host
};
export type Catalog = { version: 1; items: Item[] };
export function loadCatalog(dir?: string): Catalog;                // default: <repo>/art/flat
export function catalogErrors(raw: unknown, dir: string): string[];
export function findItem(c: Catalog, id: string): Item | undefined;
export function closest(c: Catalog, id: string, n?: number): string[];   // edit distance + tag overlap
export function colourway(item: Item, name: string): Record<string, string>; // group -> palette hex
export function recolour(svg: string, map: Record<string, string>): string;
```

Tests:
- [ ] a valid fixture catalog loads; `findItem` finds by id.
- [ ] `catalogErrors` names each problem: missing file, duplicate id, unknown size, anchor outside viewBox, host
  without all four layers, cast without `colors`.
- [ ] `closest('toaster')` on the fixture returns the nearest ids.
- [ ] `recolour` swaps only the listed fills and leaves others byte-identical.
- [ ] Colourways: `body-b/teal` style names resolve; unknown colourway is an error listing the known ones.

## Task 6: Shot schema and validation (`lib/shots.mts`, part 1)

```ts
export type Place = 'left' | 'center' | 'right' | 'left-third' | 'right-third';
export type Shot = {
  beat: number;
  ground?: { id: 'plain' | 'room-corner' | 'sky' | 'starfield' | 'floor'; color: string };
  cast?: { who: string; pose: string; at: Place; scale?: number; face?: 'left' | 'right' }[];
  props?: { id: string; at?: Place; on?: string; focus?: boolean; scale?: number }[];
  card?: { title?: string; code?: string; lit?: string; src: string; hang?: string; at?: Place };
  chalk?: ({ burst: string } | { sight: [string, string] } | { label: string; to: string } | { underline: string } | { circle: string })[];
  camera?: { move: 'hold' | 'push' | 'pan'; to?: string; crop?: 'wide' | 'mid' | 'close' };
  keep?: string[];
  raw?: string;                                                   // a one-off SVG; excludes cast/props/card
};
export type ChapterShots = { id: string; metaphor: string; example: string; ground: string; title: string; shots: Shot[] };
export function shotErrors(ch: ChapterShots, cat: Catalog, ctx: { sentences: number; sources: string[]; first?: ChapterShots; last: boolean }): string[];
```

Rules (numbered in `templates/real-life-analogy/rules.md`, quoted in messages as `rule 03`):
01 one shot per sentence (`beat` 1..n, each once, in order); 02 at most one `focus`; 03 at most one new item per
shot (items not in the previous shot's set or its `keep`); 04 text only on card / label / title; 05 every card has a
`src` that is one of the chapter's sources (file:line inside a cited range); 06 references (`on`, `hang`, `sight`,
`to`, `burst`) name an item in this shot plus an anchor it has; 07 `who` is a host id or a cast body with a
colourway, and the pose exists; 08 first chapter's first shot and last chapter's last shot share ground and focus
prop (bookend); 09 chapter has `metaphor`, `example`, `title`; 10 more than 2 `raw` shots in a chapter is a warning.

Tests (fixture catalog):
- [ ] a good chapter returns `[]`.
- [ ] each rule fails with its number and an exact message, e.g.
  `shot 4: prop "toaster" not in catalog; closest: "oven", "kettle"; or use a raw shot`.
- [ ] `keep` makes a carried item not count as new (rule 03).
- [ ] bookend checked only when `last` is true and `first` given.

## Task 7: Layout (`lib/shots.mts`, part 2)

```ts
export type Box = { x: number; y: number; w: number; h: number };        // stage px, 1920x1080
export type Placed = { ref: string; item: Item; box: Box; z: number; flip: boolean };
export function layout(shot: Shot, cat: Catalog): { placed: Placed[]; card?: Box; errors: string[] };
```

Logic sketch:
- Floor line at y = 880. Size class → target height in px (`tiny` 70, `small` 140, `medium` 260, `large` 420,
  `person` 620, `huge` 820) × `scale`; width from the viewBox ratio.
- `at` → centre x (`left` 480, `left-third` 640, `center` 960, `right-third` 1280, `right` 1440); feet / base on the
  floor anchor (or the box bottom).
- `on: "counter.top"` → item's floor anchor sits on the target's `top` anchor (mapped through the target's box).
- Cast facing: `face` or auto (faces the focus item) → `flip`.
- Depth: ground 0, props without `on` 10 + index, cast 20, props with `on` 30, card 40, chalk 50.
- Card: 520 × auto (title + code lines), above the `hang` target's `card` anchor, clamped inside a 60px safe margin;
  shifted sideways if it overlaps the focus box.
- Errors: any box outside the safe frame; card overlapping the focus box after shifting; two cast at the same `at`.

Tests:
- [ ] a bell `on` a counter lands with its base on the counter top (±1px).
- [ ] a `small` prop is never taller than a `person` at scale 1.
- [ ] the card avoids the focus item; impossible cases report an error.
- [ ] depth order matches the list above.
- [ ] cast faces the focus item unless `face` says otherwise.

## Task 8: Compile to a scene (`lib/shots.mts`, part 3, and `lib/shots-runtime.js`)

```ts
export function compileChapter(ch: ChapterShots, cat: Catalog, artDir: string): string;   // scenes/<id>.html text
```

- Output is a design scene in the existing format (see `scene-kit/design.mts`): inline SVG symbols for every item
  used (recoloured once), one `<g>` per placed item per shot, the card as HTML on a paper plate, and a script block
  that builds the GSAP timeline with `beat(n)`.
- Motion presets (runtime, `lib/shots-runtime.js`, inlined): `popIn` (scale 0.86 → 1, back-out 0.5s, at
  `beat(n)`), `drawOn` (stroke-dashoffset, 0.6s, chalk only), `camera` (`push`: scale 1 → 1.08 over the sentence
  toward `to`; `pan`: translate across; `hold`: none), `fadeOut` for items not kept (0.3s before the next beat),
  pose swap (snap at the beat), title card (tilted −6°, hand-lettered, 1.8s, before shot 1).
- Hosts: `blink` every 3–5 s (deterministic sequence seeded by chapter id, swaps `eyes`/`eyesShut`, 120 ms);
  `flap` toggles `mouth`/`mouthOpen` every 110 ms while the host's line plays, from `beat(n)` to `beat(n+1) - gap`.
  (Per-word flap from `captions.json` is a later refinement; sentence windows are enough for v1.)
- Chalk marks from the retired `kit/kit.js` (burst, sight, strings, label with leader line, underline, circle) with
  the wobble filter; font `art/flat/fonts/patrick-hand.woff2` inlined as base64.
- Raw shots: the SVG text is wrapped and given `popIn`.

Tests:
- [ ] compiling a fixture chapter is deterministic (same input → same bytes).
- [ ] every used item appears once as a symbol; unused ones do not.
- [ ] the timeline references `beat(1)`…`beat(n)` in order, and nothing else times itself.
- [ ] items not kept get a fade before the next beat.
- [ ] hosts get blink and flap; cast does not.
- [ ] output passes `npx --yes hyperframes@0.8.112 check` on a scaffolded fixture chapter (one integration test,
  skipped when hyperframes is unavailable, like the existing render tests).

## Task 9: CLI and skill wiring

**Files:** `cli/shots.mts`, `bin/oldguy.cjs`, `skills/oldguy/SKILL.md`, `skills/oldguy/references/templates.md`,
`lib/template.mts` (accept an optional `shots: true` in `template.json`).

```
oldguy shots --dir .oldguy/<slug>     reads shots/<id>.json for every chapter in order.json, checks, writes scenes/<id>.html
```

- [ ] Exit 1 with all errors listed (grouped by chapter) when any check fails; otherwise prints `shots ok` and the
  scene paths.
- [ ] `--show <id>` writes a still contact sheet of the chapter's shots (one frame per beat, beats faked 3 s apart)
  to `shots/<id>.png` for a look before narrating.
- [ ] SKILL.md: when the video's template has `shots: true`, write `shots/<id>.json`, run `oldguy shots`, and point
  each spec's design piece at `scenes/<id>.html`; then `oldguy lesson` as today.
- [ ] Tests: CLI on a fixture project (ok path, error path, `--show` writes a PNG when Chromium is available).

## Task 10: Poses and props (generation)

- [ ] 24 cast poses (3 bodies × stand, point, hold, think, shock, shrug, laugh, close-up face), each from its
  approved model sheet as reference.
- [ ] 16 host poses (same 8 for old guy and new guy). Hosts: eyes and mouth layers via `anchors.html` (auto face
  box, then hand-confirm); a `mouthOpen` and `eyesShut` variant drawn by the pipeline as simple flat shapes in the
  face's colours (no extra generation).
- [ ] 30 props: everyday (shop-counter, bell, mailbox, envelope, parcel, conveyor-belt, shelf, book, scale, door,
  key-rack, ticket, clipboard, traffic-light, clock) and code (server, database, queue, browser-window, phone,
  laptop, file, folder, key, lock, cloud, plug, gear, magnifier, shield).
- [ ] For each: `vectorize.py` → `check.mjs` → anchors → catalog entry. Category sheets in `art/flat/_review/`.
- [ ] Critic pass over the sheets (style consistency vs the style bible); regenerate rejects.
- [ ] Send the final sheets to the owner (informational, not a gate unless they object).
- [ ] Commit in batches (cast, hosts, props) so a bad batch is easy to revert.

## Task 11: Library test (`tests/art-catalog.test.cjs`)

- [ ] For every catalog entry, on the real files: file exists; every `fill` is a `PALETTE.json` colour; no `stroke`,
  no `<linearGradient>`/`<radialGradient>`, no `filter`; ≤ 40 KB; every anchor inside the viewBox; hosts have all
  four layers; cast has `colors` covering skin, hair, top, bottom.
- [ ] Whole library ≤ 3 MB.

## Task 12: Template rewrite (`templates/real-life-analogy/`)

- [ ] `template.json`: `shots: true`, narrator `af_heart`, `voice_speed` 0.95, `line_gap_ms` 650, shapes 16:9
  (9:16 and 1:1 only once layouts are checked in them; v1 may ship 16:9 only).
- [ ] `template.md`: picking a metaphor per chapter (match the concept's shape: who hands what to whom), the running
  example, the hook and "For example," turn, one line where each metaphor breaks, writing `shots.json` (three worked
  chapters), reaction beats at the problem line, ~one new picture per sentence; ends with a **Gate:** line.
- [ ] `rules.md`: rules 01–10 from Task 6 plus the visual rules (one focus, burst on the focus, words only on
  cards/labels/titles, cast only from the library).
- [ ] `look.md`: yes/no list for the frame contact sheet (silhouette reads at 240px, one focus, card readable, ground
  colour changes per chapter, title card present, bookend, no overlaps).
- [ ] Remove `kit/kit.js` people and props; keep `kit/gallery.html` as a library gallery generated from the catalog.
- [ ] Fold in the earlier review notes that still apply: vary outfits and stance, big reactions, an extreme face
  crop shot, a conveyor with depth and items on it.

## Task 13: Sample video and scoring

- [ ] Same example repo and question as the other templates' samples. `oldguy shots` → scaffold → audit → narrate →
  render → `hyperframes check` in every listed shape → look sheet.
- [ ] `oldguy lesson` prints `lesson ok`.
- [ ] Fresh `video-first-time-viewer` and `video-perception-psychologist` critics; fix until both score ≥ 9.
- [ ] First chapter → `templates/real-life-analogy/sample.mp4` (≤ 3 MB) + `sample.jpg`.
- [ ] `npm test` green; commit; push.

## Order and parallelism

- Tasks 5–9 (code, fixture-driven) run in parallel with Tasks 1–4 and 10 (art).
- Task 1 must pass before Task 3. Tasks 3 and 4 are owner gates. Task 10 needs 4 approved and Task 5 merged.
- Task 12 needs 9 and 10; Task 13 needs 12.
