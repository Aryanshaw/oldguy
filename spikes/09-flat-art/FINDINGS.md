# Spike 09: flat art pipeline (generate, cut, vectorise, snap, render)

Date: 2026-10-08. Plan: `docs/superpowers/plans/2026-10-08-flat-art-engine.md`, Task 1.

**Result: pass.** One generated image of a person holding an apple becomes a 26.5 KB SVG with 8 palette fills, no
visible seams at 1920 wide, and it reads at 240 wide. See `compare.jpg` (source PNG, SVG at 1920, a 1:1 face crop of
the 1920 render, SVG at 240) and `apple-person.svg`.

## Exit criteria

| Criterion | Target | Result |
| --- | --- | --- |
| SVG size | ≤ 40 KB | 27,122 bytes (26.5 KB) |
| Fills | ≤ 8 | 8 (`coral`, `ground-blue`, `ground-indigo`, `hair-4`, `hair-6`, `ink`, `skin-2`, `skin-3`) |
| Paths | (record) | 19 traced, 17 after merging same-fill runs |
| Seams at 1920 | none visible | none in the face crop or along limbs; `hierarchical=stacked` paints each layer over a full shape below, so there are no gaps to show |
| Reads at 240 | yes | apple, face direction, brows, eyes, hands all read |

## Model choice

Same prompt and the same two references (a TED-Ed apple close-up and a strip of TED-Ed people panels, both kept
locally, never committed) sent to three edit models:

| Model (sg MCP tool) | Result |
| --- | --- |
| **Nano Banana Pro** (`image_nano_banana_pro`, `references` = comma-separated URLs) | **Chosen.** Closest to TED-Ed: flat fills, bar brows, dot eyes, one-stroke nose, long neck, simple hands, plain white ground. About 20 s. 896×1200 PNG. |
| FLUX.2 Pro Edit (`image_flux_2_pro_edit`) | Good, but adds interior line work (sleeve cuffs, fold lines, neckline) that becomes thin dark paths. |
| Seedream 4.5 Edit (`image_seedream_4_5_edit`) | High-angle camera, knitted texture, soft edges; least TED-like. Slowest. |

Background removal: Bria RMBG 2.0 (`image_bria_rmbg_2_0`) gives a clean alpha. It matters: the white gap between the
legs is enclosed, so the "flood white in from the border" fallback missed it and filled it with trouser colour.

## vtracer settings that won

`colormode=color`, `hierarchical=stacked`, `mode=spline`, `filter_speckle=8`, `color_precision=5`,
`layer_difference=24`, `corner_threshold=60`, `length_threshold=4.0`, `splice_threshold=45`, `path_precision=1`.
Trace the cut-out PNG as generated, **then** snap each fill to the nearest `PALETTE.json` colour (CIE76 ΔE), with an
optional per-item allow-list of tokens (`--allow`), then bake each path's `translate` into its coordinates and merge
consecutive same-fill paths (paint order is kept).

Tried and rejected:

- **Snap the pixels to the palette before tracing** (`--presnap`, with a mode filter and a fringe-absorb step): fewer
  stray colours, but every edge becomes a pixel staircase and vtracer turns it into lumpy curves; the brows lose their
  bar shape. 28 KB, 8 fills, visibly worse.
- **`mode=polygon`**: tiny (5-10 KB) but faceted, and traced from a 2× upscale it shows dark slivers between layers.
- **Upscaling 2× before tracing** (spline): smoother, but 51 KB.
- **0.5px same-colour stroke** (the seam fallback): not needed; seams never showed. Kept as `--seam` in
  `vectorize.py` for the record, pipeline-only; `check.mjs` rejects any stroke in the library.

## Palette notes

`art/flat/PALETTE.json` was tuned during the spike: the first draft had `ink` 4.4 ΔE from `ground-indigo` and `peach`
8 ΔE from `skin-2`, so traced regions flickered between the two. The closest pair is now 9.6 ΔE (`ground-paper` /
`card`). Without an allow-list the spike image snaps to 9 fills (eyes to `hair-1`, brows to `ink`); the allow-list
makes it 8. The token names are fixed (another branch creates the same file): there is no pale blue (TED-Ed's lab
coat colour) and no tan for khakis; `lilac` and `hair-4` stand in.

## Rendering

Chromium (`/opt/pw-browsers`, Playwright) renders the SVG inline at 1920 and 240 wide on the TED-Ed periwinkle ground.
No halos against the ground: the cut-out alpha is thresholded at 50% before tracing, so edges are vector edges, not
soft raster ones. One faint hairline of the sweater colour shows along the trouser edge at 1920 (a stacked layer
peeking out under an anti-aliased edge); invisible at normal viewing size.

## Cost

3 image generations (one per model) + 1 background removal.
