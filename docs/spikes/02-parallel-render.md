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
**PASS.** Three chapters rendered at once finished in about 0.4x the sequential time with no failures.
The sampled memory rise was about 1 GB in every mode, even on this 8 GB laptop that was already swapping.

*Correction history:* the first write-up of this spike said parallel was 4.4x slower. That was a measurement
bug (in `par` mode the script's `wait` also waited for the memory sampler, so "610 s" was how long it was left
running). A second version used numbers from runs whose logs were overwritten. **This version replaces both**:
every run below was re-done after fixing the script, and each one's per-second memory samples, render logs and
exit codes are kept in `spikes/02-parallel-render/results/` with a one-line summary in `results.tsv`.

## Evidence (all from `results.tsv`, 74 s of video, 3 chapters, `--quality draft`)

| Run | Workers per render | Wall time | Sampled peak (baseline) | Peak rise | Failures |
|---|---|---|---|---|---|
| one after another | 2 | 82 s | 2109 MB (1237) | 872 MB | 0 |
| **3 at once** | 2 | **33 s** | 2404 MB (1364) | 1040 MB | 0 |
| one after another | auto | 127 s | 2236 MB (1390) | 846 MB | 0 |
| **3 at once** | auto | **47 s** | 2286 MB (1432) | 854 MB | 0 |
| one chapter alone | 1 | 34 s | 2105 MB (1207) | 898 MB | 0 |
| one chapter alone | 2 | 39 s | 2176 MB (1161) | 1015 MB | 0 |
| one chapter alone | 4 | 16 s | 2388 MB (1798) | 590 MB | 0 |

- **Like for like (same workers per render):** parallel over sequential = 33 / 82 = **0.40** (`-w 2`) and
  47 / 127 = **0.37** (`auto`). The pass line was 0.6.
- **Peak memory:** one render alone rises by roughly 0.6 to 1.0 GB over the idle baseline (`-w 2`: 1.0 GB); three at
  once rise by about the same, 0.85 to 1.04 GB. **Caveat:** the sampler sums RSS, which under-counts pages
  macOS has pushed to swap, and swap was 9 to 10 GB used throughout. So three at once did not need three times
  the RAM, but it ran on a machine that was swapping the whole time; treat the figure as "workable on 8 GB", not as
  a measured memory requirement. (`/usr/bin/time -l` is useless here: it reported 137 MB because it only sees the
  parent `node` process, not Chrome.)
- Timing noise between repeats is large (single `-w 1` 34 s vs `-w 2` 39 s is noise, not a trend), because other apps
  shared the machine. The three-at-once advantage (about 2.5x) is far outside that noise.
- **Hyperframes detects low memory by itself.** Its log says "Low-memory render profile active ... pinned to 1
  worker. Override with --no-low-memory-mode or PRODUCER_LOW_MEMORY_MODE=false" (seen in an earlier, unlogged
  run; the render logs under `results/` can be checked for the same line). Passing `--workers` explicitly
  overrides it.
- **A sub-composition cannot be rendered on its own** (`hyperframes render -c compositions/s1-intro.html` fails
  with "Composition has zero duration"): each chapter must be a standalone root composition.

## Consequence
- Spec section 5.8: keep "chapters render in parallel", capped, with an explicit `--workers 2` each. Cap rule
  (derived from the data): peak rise about 1 GB per render plus 2 GB headroom, so
  `cap = max(1, min(3, floor(free_RAM_GB - 2)))`. On this laptop with about 1 to 2 GB free that gives 1, yet
  3 at once still worked (while swapping), so the rule is conservative; the doctor may let the user raise it.
- Spec section 6: "lower workers on low memory" already happens inside Hyperframes `auto`; Yap passes explicit
  `--workers` and falls back to one chapter at a time after a failure.
- Spec section 4.1: `scene.html` must be a standalone root composition (own `data-duration`).
- First playable draft of a 3-minute video: about 1.5 to 2 minutes of wall time here.
- Untested: more than 3 at once, `looks` or `delivery` quality (heavier), and a 16 GB machine.
