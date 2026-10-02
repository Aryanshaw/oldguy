# Spike 2: parallel chapter renders

## Question
Can chapters render in parallel with Hyperframes without failing or exhausting memory, and how
much faster is it?

## Method
`spikes/02-parallel-render/run.sh`. Three real chapters (the prototype's scenes: 20 s, 28 s and
26 s, 1080p, 74 s of video in total), each wrapped as a standalone one-scene project (`p1..p3`),
rendered with `hyperframes render . -q draft -w <workers>`. Modes: `seq` (one after another),
`par` (three processes at once), `single` (one chapter, varying `--workers`). A once-a-second
sampler summed the RSS of every node/chrome/ffmpeg process.

## Machine
Apple M3, 8 cores, **8 GB RAM**, and during the runs the swap file was **8.9 to 9.8 GB of 10 GB
used** (Cursor, Chrome and Claude Code were also running). This is a memory-starved laptop, close to
a worst realistic case. Timings are noisy for that reason; one-off differences under about 30%
should be ignored.

## Result
**PASS.** Three chapters rendered at once finished in about 40 to 50% of the sequential time with no
failures, and added only about 1.1 GB in total, even on this 8 GB laptop that was already swapping.

*Correction (same day):* the first version of this document said parallel was 4.4x slower. That was a
measurement bug: in `par` mode the script's `wait` also waited for the memory sampler, so the "610 s"
was how long it was left running, not the render time. The file timestamps and a fixed re-run show the
opposite. The table below is the corrected data.

## Evidence
| Run (74 s of video, 3 chapters, draft) | Wall time | Peak sampled memory (baseline) |
|---|---|---|
| one after another, `-w auto` | 139 s, then 105 s on a repeat | 2449 to 2594 MB (1.7 to 1.9 GB) |
| one after another, `-w 2` | 83 s | 2452 MB (1.6 GB) |
| **3 at once**, `-w auto` | **53 s** (56 s from file timestamps of the first run) | 2511 MB (1.4 GB): about +1.1 GB for all three |
| **3 at once**, `-w 2` | **34 s** | 2364 MB (1.2 GB): about +1.1 GB for all three |

Parallel over sequential: 0.40 to 0.50 with `auto`, 0.41 with `-w 2`. All outputs rendered, all exit
codes 0. Single chapter (20 s): `-w 1` 42 s, `-w 2` 22 s, `-w 3` 30 s, `-w 4` 17 s, `auto` 53 s then
34 s (noisy, because other apps were competing for memory).

Notes that matter for the design:
- **Hyperframes detects low memory by itself.** The render log says: "Low-memory render profile active
  ... pinned to 1 worker. Override with --no-low-memory-mode or PRODUCER_LOW_MEMORY_MODE=false." That is
  why `-w auto` is slower than an explicit `-w 2` to `-w 4` on this 8 GB machine.
- Memory is the sum of RSS for all node, chrome and ffmpeg processes and includes unrelated node processes
  (Claude Code itself), so use the differences, not the absolute numbers.
- **A sub-composition cannot be rendered on its own** (`hyperframes render -c compositions/s1-intro.html`
  fails with "Composition has zero duration"). Each chapter must be a standalone root composition.

## Consequence
- Spec section 5.8: keep "chapters render in parallel", but state the real behaviour: render up to **3
  chapters at once** with an explicit `--workers 2` each (about 0.4x of sequential time here). Never rely
  on `--workers auto` on a low-memory machine. Make the cap configurable (the doctor sets it from free RAM;
  start at `min(3, floor(free_RAM_GB / 1.5))`, minimum 1).
- Spec section 6: "lower workers on low memory" is already what Hyperframes does by itself in `auto`; Yap
  should pass explicit `--workers` instead and fall back to 1 chapter at a time on a render failure.
- Spec section 4.1: `scene.html` must be a standalone root composition (own `data-duration`).
- First playable draft of a 3-minute video is about 1.5 to 2 minutes of wall time here, so the "first draft in
  under 5 minutes" goal holds.
- Untested: more than 3 at once, `looks` or `delivery` quality (heavier), and a 16 GB machine.
