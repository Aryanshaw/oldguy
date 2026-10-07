# The old guy: brand art

`oldguy-concept-*.webp` are the concept images generated on 2026-10-07. They are the source of truth for how the old
guy looks (see `docs/superpowers/specs/2026-10-07-oldguy-rename-design.md`).

## How the shipped SVGs were made

The large art is traced from the full-resolution concept boards, not redrawn, so it stays faithful to them. Both
tools are free and run locally:

- [VTracer](https://github.com/visioncortex/vtracer) (`pip install vtracer`) turns the colour image into SVG paths
- [SVGO](https://github.com/svg/svgo) (`npx svgo@3.3.2`) shrinks the result

| File | Source | Notes |
|---|---|---|
| `docs/assets/mascot.svg`, `player/src/assets/oldguy-mark.svg` | board B, panel 01, head in the yellow disc | the board's black background is removed by a mask grown from the coloured shapes, so his black outlines survive; stray wordmark fragments are dropped by keeping only the disc's connected region |
| `docs/assets/oldguy-full.svg` | board A, panel 02, full body | the cream background is flood-filled away from the corners |

Trace settings (VTracer):

- `colormode=color`, `hierarchical=stacked`, `mode=spline`
- `filter_speckle=6`, `color_precision=6`, `layer_difference=24`
- `corner_threshold=60`, `length_threshold=4.0`, `splice_threshold=45`, `path_precision=2`

Then run `svgo --multipass -p 2` (`-p 1` breaks the mug text and the glasses). Last, replace the fixed
`width`/`height` with a `viewBox`, and add `role="img"` and an `aria-label`.

## The favicon is hand-built

A traced head turns to mush at 16–32px, so the favicon, `player/src/assets/favicon.svg`, is a simplified hand-built mark: a
yellow disc, the cap, the mop, the beard and the open mouth. It has no glasses, pencil or headset. Keep it in step
with the traced art if the character changes.
