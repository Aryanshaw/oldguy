# Flat art engine: TED-Ed-style illustrated shots for the real-life-analogy template

Date: 2026-10-08. Status: design approved in conversation, awaiting spec review.

## 1. Why

The real-life-analogy template should look like a TED-Ed lesson (reference: "Hawking's black hole paradox explained",
TED-Ed): flat vector art, solid fills, no outlines, a small warm-on-cool palette, geometric people, chalky white
overlays, hand-lettered cards, one idea per shot. A first attempt built every person and prop from code
(`templates/real-life-analogy/kit/kit.js`). It renders, but it falls short: stiff identical bodies, quiet faces, thin
props. The gap is drawing quality, not animation.

So the drawing comes from a small art library made once with an image model (the sg MCP, paid, one-time), vectorised
and shipped in the repo. Each video then composes shots from that library in code, for free. Claude never draws; it
writes a shot list, and an engine places, layers and animates the art.

## 2. What TED-Ed does that we copy

- One running example travels the whole video and changes form (their apple; ours is the real request or value).
- One everyday metaphor per chapter, chosen for that chapter's concept; never two in one shot.
- About one new picture per sentence (~5 s). Clarity comes from one-sentence-one-picture, not pauses.
- Ground colour changes per chapter. Each chapter opens on a tilted, hand-lettered concept title card.
- Labels are hand-lettered with chalk leader lines. Real values hang off objects on paper cards by chalk strings.
- Characters react at the problem line (hand over mouth, shock, shrug).
- The ending echoes the opening image (bookend).

## 3. Architecture

Four units, each with one job.

### 3.1 Art library: `art/flat/` (made once, ships in the repo)

| Part | Count | Notes |
| --- | --- | --- |
| Cast | 3 base bodies × 8 poses = 24 | Recoloured in code (skin, hair, clothes) into many different-looking people |
| Hosts | old guy, new guy × 8 poses = 16 | Flat redraws of the brand characters; eye and mouth layers cut from each pose |
| Props | 30 | 15 everyday metaphor objects (counter, mailbox, belt, shelf, scale, door, …), 15 code objects (server, database, queue, browser, file, key, lock, …) |
| Grounds | 0 | Drawn in code from a few named layouts (`plain`, `room-corner`, `sky`, `starfield`, `floor`) in any palette colour |

Poses: stand, point, hold, think, shock, shrug, laugh, close-up face.

About 70 SVGs at ~30 KB each, ~2 MB in all: small enough to ship in the repo; no GitHub Release.

`art/flat/catalog.json` lists every item: `id`, `kind` (cast, host, prop), `tags`, `size` (a real-world size class,
so a bell is never bigger than a person), `colors` (the recolourable fill groups, for cast), and named `anchors`
(`hand`, `eye`, `top`, `card`, `floor`) as points in the drawing's own coordinates. Host poses also list their
`eyes` and `mouth` layer ids.

### 3.2 Pipeline: `tools/art/` (run once per item, not shipped in the plugin)

1. Generate with the sg MCP from a fixed style prompt plus reference images (see §4).
2. Remove the background (bria / birefnet).
3. Vectorise with `vtracer` at a low colour count.
4. Snap every fill to the nearest palette colour.
5. Simplify paths; target under 40 KB per SVG.
6. Hosts: split eyes and mouth into their own layers (auto-detected face region, confirmed by hand).
7. Mark anchors: auto-guess, then confirm or fix in a small local HTML anchor tool that writes `catalog.json`.
8. Run the item check (§6) and add the item to its category contact sheet.

A prop a video needs and the library lacks goes through the same pipeline once and is committed. The library grows
only with real use.

### 3.3 Shot compiler: `lib/shots.mts`

Input: `shots.json` in the chapter folder. Output: the chapter's `index.html` (SVG scene plus a GSAP timeline on the
existing beat times). It runs between narrate and render.

```
script.md → narrate → beats.json
Claude writes shots.json → shots.mts validates (catalog + rules) → compiles index.html → hyperframes render → look sheet
```

Chapter-level fields: `metaphor`, `example`, `ground` (palette colour), `title` (title card text). One shot per
sentence:

```json
{
  "beat": 3,
  "ground": { "id": "room-corner", "color": "indigo" },
  "cast": [{ "who": "newguy", "pose": "shock", "at": "left", "scale": 1 }],
  "props": [{ "id": "shop-counter", "at": "center" }, { "id": "bell", "on": "shop-counter.top", "focus": true }],
  "card": { "title": "THE ORDER", "code": "cart.checkout()", "lit": "checkout", "src": "shop.js:12", "hang": "bell.card" },
  "chalk": [{ "burst": "bell" }, { "sight": ["newguy.eye", "bell"] }, { "label": "the bell = checkout", "to": "bell" }],
  "camera": { "move": "push", "to": "bell", "crop": "mid" },
  "keep": ["shop-counter"]
}
```

`who` is a host id (`oldguy`, `newguy`) or a cast id with a colourway (`body-b/teal`).

The compiler owns, so Claude does not:

- **Placement:** `at` (left, center, right, thirds); `on`, `hang` and `sight` resolved through catalog anchors;
  scale normalised by size class.
- **Depth:** ground, back props, cast, front props, card, chalk.
- **Motion presets on the beat:** new items pop in with a small overshoot; chalk draws on; the camera pushes or pans
  across the sentence; a pose change snaps on the beat; host mouths flap while their line plays (word times from
  `captions.json`); hosts blink every 3–5 s. No idle wiggle.
- **Continuity:** `keep` carries items into the next shot so a scene builds up; anything not kept fades out.
- **Text:** only on cards, labels and title cards. Cards in the hand-lettered font; code in monospace with the key
  word lit.
- **Chapter frame:** adds the title card shot; checks the bookend (the last chapter's final shot reuses the first
  shot's ground and focus prop).
- **Escape hatch:** a `raw` shot holds a one-off SVG diagram for what the library cannot show.

Kept from the code kit: the chalk marks (burst, sight line, strings, leader label, underline, circle) and the vendored
hand-lettered font (Patrick Hand, OFL). Retired: the code-built people and props.

### 3.4 Template: `templates/real-life-analogy/`

`template.md` tells Claude how to pick the metaphor per chapter (match the concept's shape: who hands what to whom),
carry the running example, write the hook and the "For example," turn, say where a metaphor breaks, and write
`shots.json` (with worked examples). `rules.md` holds the numbered visual rules the compiler enforces. `look.md` holds
the yes/no list for the frame contact sheet. Calm narrator, speed ~0.95, `line_gap_ms` ~650.

## 4. Keeping the library in one style

- **Style bible first:** 4 reference frames (a person, a prop, a full scene, the hosts together), approved by the
  owner before anything else is generated. Every later prompt uses them as image references plus a fixed style
  prompt: flat vector, solid fills, no outlines, no gradients, no texture, geometric faces (dot eyes, bar brows), the
  palette as exact hex values, centred on a plain background.
- **Hosts:** the owner's two brand sheets are the identity reference. The flat redraws keep each one's defining
  features (old guy: "#1 DEV" cap, red beard, glasses, headset, mug; new guy: curly hair, backwards blue cap with
  tag, "HELLO NEW GUY" sticker, VISITOR badge) in TED-flat style.
- **Cast:** one neutral front model sheet per body first; every pose of that body uses its sheet as reference.
- **Batches with approval gates:** (1) style bible, 4 images, owner approves; (2) model sheets, 3 bodies + 2 hosts,
  owner approves; (3) poses and props, ~60. About 70 images plus retries.

## 5. Errors

- Unknown asset, pose or anchor: the compiler stops with an exact message, e.g. `shot 4: prop "toaster" not in
  catalog; closest: "oven", "kettle"; or use a raw shot`.
- Rule broken (two focus items, text outside a card/label/title, more than one new item in a shot, a card with no
  `src`, no title card, no bookend): fails with the rule number from `rules.md`.
- Layout clash: after placement the compiler checks bounding boxes; the card overlapping the focus item, or anything
  leaving the frame, is an error.
- Raw shots must pass `hyperframes check` and the look sheet; the compiler logs a chapter's raw-shot count, and more
  than 2 means the library is missing something.

## 6. Testing

- `tests/shots.test.cjs`: schema, anchor maths (`on`, `hang`, `sight`), depth order, `keep` continuity, the bookend
  rule, and every error message, on fake catalog fixtures (no real art needed).
- `tests/art-catalog.test.cjs`, on the real library, for every entry: the file exists; fills are palette colours; no
  strokes or gradients; under the size limit; every anchor lies inside the drawing's box; host poses have eye and
  mouth layers.
- `tests/templates-shipped.test.cjs` (exists) covers the template.
- Sample video: the same example repo and question as the other templates' samples; must pass `oldguy lesson`,
  `hyperframes check`, the look sheet, and a fresh `video-first-time-viewer` critic at 9/10 or more.

## 7. Out of scope

- Full puppet rigging; limb animation beyond host blink and mouth flap.
- Generated backgrounds.
- Generating art at render time.
- Other templates using the library (tutor and old-and-new keep their own art; sharing can come later).
