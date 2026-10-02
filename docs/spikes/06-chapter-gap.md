# Spike 6: gap between chapter videos in the player

## Question
When the player plays several MP4 chapters back to back, is the gap between them noticeable?

## Method
`spikes/06-chapter-gap/`. Three 8-second 720p H.264 clips (ffmpeg `testsrc2`, 30 fps) served from a local
static server with HTTP range support. `index.html` holds two `<video>` elements: while one plays, the
other is preloaded (`preload="auto"`). **plain:** on `ended`, call `next.play()` and swap which one is
visible. **overlap:** start the next clip 100 ms before the current one ends. The gap is the time from
`ended` (or `play()`) to the next clip's first painted frame (`requestVideoFrameCallback`), read in Chrome.
A seek test jumps into a random point of a clip and times until a frame is painted.

## Machine
Apple M3 laptop, Chrome (driven through the claude-in-chrome tools), local server, muted clips.

## Result
**PASS.** The plain approach already has a gap of about 1 frame; no pre-joining is needed.

## Evidence
| Mode | Transition gaps (ms) |
|---|---|
| plain, run 1 | 33.0, 23.6 |
| plain, run 2 | 32.0, 35.3 |
| overlap (start 100 ms early) | 23.0, 19.9 |
| seek to a random point (6 tries, loading a new clip each time) | 51, 23, 90, 27, 27, 34 |

The pass line was 150 ms. A frame at 30 fps is 33 ms, so the plain gaps are about one frame and the
overlap mode saves roughly another frame.

Limits of this test: clips were **muted**, so a click or silence at the join in the **audio** is not
covered; clips were local (a remote server would add network time for the next clip, covered by
preloading); only 2 transitions per run and 2 plain runs, which is enough to rule out a large gap but not a
rare stall.

## Consequence
- Spec section 4.7: keep one MP4 per chapter and the two-video-element player (preload the next, switch on
  `ended`). No background pre-joining is needed. The "gap check" spike can be closed.
- Add to the player's test list: one check that audio is continuous across a chapter boundary (generate the
  narration so each chapter's WAV starts and ends with a few milliseconds of silence, which avoids clicks).
- Timeline clicks to another chapter feel instant (23 to 90 ms to first frame) with range requests, so the
  server (spec 4.3) **must support HTTP range requests**; Python's `http.server` does not.
