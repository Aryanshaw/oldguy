---
name: new-template
description: Add a new oldguy video template to this repository (a folder under templates/). Use when a contributor says "add a template", "new video template", or "make a template like peter-and-stewie". Repo-only; not shipped with the plugin.
---

# Adding a video template

A template is a folder `templates/<id>/`. It changes how a verified explanation is told, never what is checked. The
engine (lib/stage.mts, lib/narrate.mts) does all timing; a template is data and layout only. Read
`docs/superpowers/specs/2026-10-07-video-templates-design.md` section 3 first.

## 1. Scaffold the folder

```
templates/<id>/
  template.json   id (= folder name), version 1, title, description, shapes, default_shape, speakers, pace, assets
  template.md     script rules for Claude; ends with a **Gate:** line
  stage.html      <style> plus the markers, one per line; only <!-- oldguy:slot --> is required
  assets/         small files only (character pictures, stickers, fonts)
```

- `speakers: []` gives one narrator (`narrator_voice`, default `af_heart`); otherwise every voice must be in
  `lib/voices.mts`. `pace.voice_speed` is one number for a narrator, or one per speaker.
- `slots` gives the slot box per shape, `[x, y, width, height]`; a shape without one uses the whole frame.
- Big media (background footage, sounds): upload it as a GitHub Release attachment and list it with `url`, `sha256`
  and `bytes`; `background` names it and `background_seconds` gives its length. Footage is square, muted and loops.
- Stage markers: `background`, `slot`, `speakers`, `captions`, `chips`. Style `.og-speaker-left/right/center`,
  `.og-cap` (`.og-cap-word` / `.og-cap-line`) and `.og-chip`, and put captions and chips on a backing plate.
  `[data-shape="9:16"]` selectors give each shape its layout. No timing code in the stage.

## 2. Check it

Point oldguy at the working folder and look at what it says:

```
OLDGUY_TEMPLATES_DIR=$PWD/templates node bin/oldguy.cjs templates <id> --show
npm test
```

`tests/templates-shipped.test.cjs` loads every shipped template, checks its stage markers, assets and Gate line, and
builds a page in every shape it lists.

## 3. Render a fixture chapter in every shape

Make a small video in a scratch project with the template (`node bin/oldguy.cjs video --dir .oldguy/sample --template <id>
--shape <shape>`), then scaffold, audit, narrate and render one chapter per shape following `skills/oldguy`. Run
`npx --yes hyperframes@0.8.112 check` on each chapter folder (it must pass) and look at the snapshots: speaker swaps on
the right line, the caption word at its time, the scene in the slot, chips readable.

## 4. The sample

Render the same example repo and question as the other templates' samples, and keep the first chapter as
`templates/<id>/sample.mp4` (short, small). The landing page gallery is built from these.

**Gate:** `npm test` is green, `hyperframes check` passes in every listed shape, the snapshots were looked at, and `sample.mp4` exists.
