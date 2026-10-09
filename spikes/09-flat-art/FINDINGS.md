# Spike 09: flat art pipeline (generate, cut, vectorise, snap, render)

Date: 2026-10-08. Plan: `docs/superpowers/plans/2026-10-08-flat-art-engine.md`, Task 1 (plus what Task 3 taught).

**Result: pass.** One generated image of a person holding an apple becomes an 8.3 KB SVG with 8 palette fills, no
visible seams at 1920 wide, and it reads at 240 wide. See `compare.jpg` (source PNG, SVG at 1920, a face crop of the
1920 render, SVG at 240) and `apple-person.svg`.

## Exit criteria

| Criterion | Target | Result |
| --- | --- | --- |
| SVG size | ≤ 20 KB (was 40 in the plan; tightened mid-task) | 8,480 bytes (8.3 KB); 26.5 KB on the first pass, see the size pass |
| Fills | ≤ 8 | 8 (`coral`, `ground-blue`, `ground-indigo`, `hair-4`, `hair-6`, `ink`, `skin-2`, `skin-3`) |
| Paths | (record) | 19 traced, 17 after merging same-fill runs |
| Seams at 1920 | none visible | none in the face crop or along limbs; `hierarchical=stacked` paints each layer over a full shape below, so there are no gaps to show |
| Reads at 240 | yes | apple, face direction, brows, eyes, hands all read |

## Model choice

Same prompt and the same two references (a TED-Ed apple close-up and a strip of TED-Ed people panels, both kept
locally, never committed) sent to three edit models:

| Model (sg MCP tool) | Result |
| --- | --- |
| **Nano Banana Pro** (`image_nano_banana_pro`, `references` = comma-separated URLs, optional `size: "2K"`) | **Chosen.** Closest to TED-Ed: flat fills, bar brows, dot eyes, one-stroke nose, long neck, simple hands, plain white ground. 896×1200 by default, 1792×2400 at `2K`. |
| FLUX.2 Pro Edit (`image_flux_2_pro_edit`) | Good, but adds interior line work (sleeve cuffs, fold lines, neckline) that becomes thin dark paths. |
| Seedream 4.5 Edit (`image_seedream_4_5_edit`) | High-angle camera, knitted texture, soft edges; least TED-like. Slowest. |

Background removal: Bria RMBG 2.0 (`image_bria_rmbg_2_0`) gives a clean alpha and keeps enclosed gaps (between the
legs) transparent, which a "flood the background in from the border" key cannot. It can also eat a dark detail that
matches a dark ground (it removed the bell's indigo base in the scene frame), so scene frames use the local key.

## vtracer settings that won (the `vectorize.py` defaults)

`colormode=color`, `hierarchical=stacked`, `mode=spline`, `filter_speckle=8`, `color_precision=5`,
`layer_difference=24`, `corner_threshold=60`, `length_threshold=8`, `splice_threshold=45`, on the image scaled to at
most 1400 px on its long side. Trace the cut-out as generated, **then** snap each fill to the nearest `PALETTE.json`
colour (CIE76 ΔE), limited to a per-item allow-list (`--allow`); bake each path's `translate` in, write whole-number
coordinates as relative commands, and merge consecutive same-fill paths (paint order is kept).

Tried and rejected for plain items:

- **Snap pixels to the palette before tracing** (`--presnap`): edges become a pixel staircase and vtracer turns them
  into lumpy curves; the brows lose their bar shape. (It wins for items with small text, below.)
- **`mode=polygon`**: tiny but faceted, and traced from a 2× upscale it shows dark slivers between layers.
- **Upscaling 2× before tracing**: smoother, but 51 KB.
- **0.5px same-colour stroke** (the seam fallback): never needed; seams never showed. Kept as `--seam` for the record,
  pipeline-only; `check.mjs` rejects any stroke in the library.

## Size pass (target 20 KB)

Compiled chapter scenes inline every drawing, so the target dropped to about 20 KB per SVG. Spike image, same fills:

| Setting | Size | Look |
| --- | --- | --- |
| absolute coordinates, 1 decimal, `length_threshold=4` (first pass) | 26.5 KB | reference |
| relative commands (deltas, implicit repeats, no leading zeros), 1 decimal, length 4 | 16.7 KB | identical (lossless rewrite) |
| relative, 1 decimal, length 6 | 13.8 KB | identical at 1920 |
| relative, 1 decimal, length 10 | 11.4 KB | eyes and ears turn faceted when blown up |
| **relative, whole numbers, length 8, ≤ 1400 px** (default) | **8.3 KB** | identical at real size |

Whole-number coordinates looked wobbly in a 4,700 px tall test render, but that is not how the art is used: the
compiler draws a person at most ~620 px tall (`huge` 820), so one unit of a ≤ 1400-unit viewBox is under a pixel.
Judge at use size (render the item ~900 px tall), not blown up. Deltas are taken between points already on the grid,
so rounding never drifts. `check.mjs` fails anything over 20 KB.

## What the style-bible items needed (Task 3)

| Item | Settings | Size |
| --- | --- | --- |
| cast person (`body-a-point`) | defaults, Bria cut | 7.1 KB |
| prop (`shop-counter`) | defaults, Bria cut | 2.9 KB |
| scene frame (person + counter + bell) | `--ground indigo --key-tol 10 --holes 150 --erode 2 --speckle 4` on the uncut frame | 11.5 KB |
| host with text (`oldguy-stand`, from a `2K` image) | `--presnap --clean 1 --min-area 40`, Bria cut | 19.0 KB |
| host with small text (`newguy-wave`) | `--presnap --clean 0 --min-area 10 --speckle 3` | 15.8 KB |

- **Scene frames.** Tracing a frame with its ground merges dark trousers and hair into the indigo ground, and finer
  clustering picks up the ground's faint noise (102 KB). What works: key the flat ground out locally (`--key-tol`,
  `--holes` for the gap between the legs), shave 2 px off the subject (`--erode`; otherwise the anti-aliased rim
  snaps to a dark token and reads as an outline), trace, and paint the ground as one rectangle (`--ground`). That is
  also how the engine draws scenes.
- **Text on hosts.** The raw trace turns the anti-aliased rim of dark letters on a cream mug into a blue cluster and
  drops thin letters (`L`). Pre-snapping at 1400 px with the fringe absorb keeps "#1 DEV" and "LEGACY CODE FUEL"
  clean at 19 KB. Text much smaller than ~20 px in the source (the "HELLO" band, "VISITOR") only half survives.

## Palette notes

The spike ran on a flat draft palette (`ground-indigo`, `skin-2`, …, the names in the tables above). That draft had
`ink` 4.4 ΔE from `ground-indigo`, so traced regions flickered between the two; colours closer than about 8 ΔE in one
item need an allow-list.

After Gate 1 the draft was replaced by the code track's grouped file (`groups.<group>.<token>`, read by
`lib/catalog.mts`), plus `grounds.periwinkle #5558A5` (TED-Ed's most used ground) and `floors.periwinkleFloor`;
`neutrals.sky` covers pale-blue coats and `neutrals.wood` khakis. The tools name colours `group.token` and `--allow`
also takes the bare token. `apple-person.svg` was re-snapped to it. Its close pairs (`grounds.offwhite`/`marks.paper`
4.7 ΔE, each ground and its floor 6-7 ΔE, `skin5`/`hairBrown` 6.6, `peachDark`/`skin3` 7.1) never meet inside one
item if the allow-list picks one of each pair.

## Rendering

Chromium (`/opt/pw-browsers`, Playwright) renders the SVG inline at 1920 and 240 wide. No halos against the ground:
the cut-out alpha is thresholded at 50% before tracing, so edges are vector edges, not soft raster ones.

## Cost

Spike: 3 image generations (one per model) + 1 background removal.
