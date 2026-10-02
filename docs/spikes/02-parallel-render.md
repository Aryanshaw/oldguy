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
**PARTIAL.** Rendering several chapters at once is **FAIL** on this machine. More workers inside one
render is **PASS** and is the right kind of parallelism.

## Evidence
| Run | Wall time | Notes |
|---|---|---|
| 3 chapters one after another, `-w auto` | **139 s** for 74 s of video (1.9x realtime) | peak sampled 2449 MB |
| 3 chapters **at once**, `-w auto` | **about 610 s** (609 one-second samples) | **4.4x slower than sequential**; outputs were correct, but the machine thrashed |
| 1 chapter (20 s), `-w 1` | 42 s | peak sampled 2227 MB |
| 1 chapter, `-w 2` | 22 s | |
| 1 chapter, `-w 3` | 30 s | |
| 1 chapter, `-w 4` | 17 s (about 0.85x realtime) | |
| 1 chapter, `-w auto` | 53 s, then 34 s on a repeat | noisy; not reliably better than 2 to 4 |

Memory: each render adds roughly 400 to 600 MB over the idle baseline (the sampler also counts
unrelated node processes, so treat this as approximate). Three at once exceeded the free RAM and
pushed the machine into heavy swapping.

Side finding that changes the chapter format: **a sub-composition cannot be rendered on its own**
(`hyperframes render -c compositions/s1-intro.html` fails with "Composition has zero duration").
Each chapter must be a standalone root composition with its own `data-duration`.

## Consequence
- Spec section 5.8: replace "each chapter renders at draft quality, in parallel" with "chapters
  render **one at a time**, each with `--workers` set from the machine (start at 2, up to 4 when
  free RAM allows)". Draft rendering runs at roughly 0.9x to 2x realtime here, so a first
  playable chapter takes seconds, and a 3-minute video takes about 3 to 6 minutes at draft.
- Spec section 6: the "lower workers on low memory" rule becomes the **default** (the doctor reads
  total and free RAM and picks the worker count), and a concurrency cap of 1 chapter at a time.
- Spec section 4.1: `scene.html` must be a standalone root composition (own `data-duration`),
  not a sub-composition fragment.
- On a 16 GB or larger machine, cross-chapter parallelism may help; that is untested and should not be
  promised.
