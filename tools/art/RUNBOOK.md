# Flat art runbook (for an agent)

How to make one library item: generate → cut → vectorise → check → (anchors) → sheet. Repo-only; nothing here is
imported by `lib/`, `cli/` or `server/`. The fixed prompts are in `style.md`; the palette is `art/flat/PALETTE.json`.
Findings behind every setting: `spikes/09-flat-art/FINDINGS.md`.

## 0. One-time setup

```sh
python3 -m venv tools/art/.venv
tools/art/.venv/bin/pip install -r tools/art/requirements.txt   # vtracer, pillow, numpy, scipy
```

Chromium for renders comes from Playwright (`/opt/pw-browsers` here; `sheet.mjs` finds a global `playwright`).
Work in a scratch folder outside the repo (`$W` below). Raw PNGs, cut-outs and reference images never go in git.

## 1. References (once per session)

Media inputs to the sg tools must be public URLs. Upload each local reference with a one-shot URL (no base64 in the
conversation):

1. `mcp__prod-sg-apps__create_upload_url { file_name: "flatart-<name>.jpg", content_type: "image/jpeg" }`
2. `curl -sS --fail-with-body -F "file=@$W/refs/<name>.jpg;type=image/jpeg" "<upload_url>"` → JSON with `url`.

(The URL is single-use and lasts 15 minutes. `upload_to_cdn_base64` also works but puts the whole file in the
conversation; use it only if curl cannot reach the API.)

Reference sets (see `style.md` for which prompt uses which):

| Set | Images | Notes |
| --- | --- | --- |
| `ted` | TED-Ed frames from "Hawking's black hole paradox explained" (people strip, apple close-up, crowd frame) | Third-party art: local only, never committed, never published. Crop away browser chrome and subtitles first. |
| `bible` | the approved style-bible items (`art/flat/_review/style-bible/*.svg`, rendered to PNG to upload) | After Task 3 approval these replace most of `ted`. |
| `hosts` | the owner's two brand sheets, panel 02 of each | Identity only (features, colours); never copy the sketchy line style. |
| `model` | the approved model sheet of the body or host being posed | Task 4 onwards: every pose of a body uses its model sheet. |

## 2. Generate

Model: **Nano Banana Pro** (`mcp__prod-sg-apps__image_nano_banana_pro`). It took the TED-Ed look best of the three
tried (FLUX.2 Pro Edit adds line work; Seedream 4.5 Edit adds texture and odd camera angles).

```
image_nano_banana_pro {
  prompt: <STYLE block + the kind's template from style.md, filled in>,
  references: "<url1>,<url2>,<url3>",      # comma-separated public URLs, up to ~5 work
  aspect_ratio: "3:4",                     # person 3:4, prop 4:3 or 1:1, scene 16:9
  size: "2K"                               # hosts and anything with lettering; default size is fine otherwise
}
```

It returns an `action_id` at once. Poll with `mcp__prod-sg-apps__poll_row_status { action_ids: [id] }` (it waits ~25 s
inside; poll ids from different apps separately). The queue can sit for minutes: if a poll times out, wait (a
background `sleep`), then poll again or read the row with the app's `action: "list_results", row_ids: [...]`. Never
resubmit a job that is only slow. Download the PNG: `curl -sS -o $W/gen/<id>.png <url>`. Look at it before going on.

One character per image. Two hosts in one 4:3 image leave the lettering too small to survive tracing; generate each
host alone at `2K` and put them side by side afterwards.

## 3. Cut the background

```
image_bria_rmbg_2_0 { image: "<generated png url>" }    # then poll, then curl the PNG with alpha
```

Bria keeps enclosed gaps (between legs, under an arm) transparent; the local key in `vectorize.py` does not.
`image_birefnet_v2_remove_background` is the backup. Scene frames on a dark ground skip Bria (it can remove a dark
detail that matches the ground) and use the local key, step 4.

## 4. Vectorise

```sh
tools/art/.venv/bin/python tools/art/vectorize.py $W/cut/<id>.png art/flat/<kind>/<id>.svg \
  --allow <comma list of the tokens the item should use>
```

Defaults are the spike winners: vtracer `color`, `stacked`, `spline`, `filter_speckle=8`, `color_precision=5`,
`layer_difference=24`, `length_threshold=8`, long side ≤ 1400 px; fills snapped to the nearest palette token (CIE76),
translates baked in, whole-number coordinates written as relative commands, same-fill runs merged. `--allow` keeps
near-miss colours from landing on an unrelated token (for example eyes on `hair-1` instead of `ink`).

Per kind (what the style bible needed; see the findings):

| Kind | Flags | Typical size |
| --- | --- | --- |
| cast person, prop | defaults | 3-9 KB |
| host or anything with lettering | `--presnap --clean 1 --min-area 40` (small lettering: `--clean 0 --min-area 10 --speckle 3`) | 15-19 KB |
| scene frame on a flat ground (reference only) | uncut frame, `--ground <token> --key-tol 10 --holes 150 --erode 2 --speckle 4` | ~12 KB |

`--presnap` snaps pixels to the palette before tracing and absorbs the anti-aliased fringes, which keeps letters clean
at the cost of slightly lumpier curves. `--erode` shaves the rim that would otherwise snap to a dark token and read
as an outline on a dark ground. Never use `--mode polygon` or `--seam` for library items.

## 5. Check

```sh
node tools/art/check.mjs art/flat/<kind>/<id>.svg
```

Must print `ok`: ≤ 20 KB, viewBox present, every fill a palette colour, no stroke / gradient / filter / image / text
/ opacity. If it is over 20 KB: `--length 10`, then `--max-side 1000`; if still over, regenerate with "fewer, bigger
shapes" and less lettering. Judge the result at use size (a person renders at most ~620-820 px tall), not blown up.

## 6. Anchors and face layers

Task 10 adds `tools/art/anchors.html`; until then, note anchor guesses (hand, eye, top, card, floor) in the item's
catalog entry by hand.

## 7. Contact sheet

```sh
node tools/art/sheet.mjs --out art/flat/_review/<batch>.png --title "<batch>" --ground ground-indigo \
  art/flat/<kind>/<id>.svg[@<ground token>][#<items in a composite>][=<label>] ...
```

Each item at full cell size and in a 240 px box, labelled with size, path count, tokens and the check result. Read
the PNG yourself, then compare against the TED-Ed frames side by side (scratch only, never committed).

## 8. Naming

`art/flat/cast/body-a-point.svg`, `art/flat/hosts/oldguy-shock.svg`, `art/flat/props/shop-counter.svg`. Lower-case,
hyphens, body or host first, then pose. Review sheets live in `art/flat/_review/`.

## 9. Retry rule

If a result breaks the style (outlines, shading, texture, wrong colours, extra objects, cropped limbs, garbled text),
regenerate with the same prompt plus **one** line saying what to fix ("no outline around the hair", "show both feet").
At most 3 tries per item; then flag it in the review sheet and move on. Keep a log of every generation (prompt,
references, action id, verdict) in the scratch folder so the count is known.
