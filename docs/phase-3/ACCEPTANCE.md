# Phase 3 acceptance

Run on 2026-10-03 in Chromium (Playwright, headless shell 153) against the real server and the committed `player/dist/`.
There was no real `/yap` output in `.yap/`, so every check used the fixture from `player/e2e/make-fixture.cjs`:
three ready chapters of 3 s (testsrc video, a different sine pitch each, H.264 + AAC) and a fourth chapter that is only a `work-x` folder (`rendering`).

Needs: `HYPERFRAMES_FFMPEG_PATH` pointing at a working ffmpeg (Homebrew's ffmpeg is broken on this Mac, so the static one under `spikes/.tools` was used; `source spikes/env.sh`).

## End-to-end test (`npm run e2e`, one test, 24 s)

| Check | Result | Measured |
|---|---|---|
| Keyed URL loads, title equals `manifest.title`, four timeline blocks, the fourth `rendering` | pass | title "demo" |
| No console message, page error or `securitypolicyviolation` for the whole run | pass | the only console line is Chromium's log of the one 409 the test provokes (full export with drafts); asserted to occur exactly once |
| Play: time passes 6.5 s within 12 s (two joins crossed) | pass | clock 0:06 to 0:09 |
| Join gap, brief's measure (last `timeupdate` of one chapter to first of the next) | see note | 259 ms and 259 ms; in-chapter `timeupdate` cadence 265 ms |
| Join gap, last painted frame of one chapter to first painted frame of the next (`requestVideoFrameCallback`, visible element only) | pass (< 250) | 183 ms and 183 ms |
| No video `error` event, both `video.error` null, visible element not muted | pass | |
| Caption cue "One intro caption line." visible in chapter one | pass | |
| Escape closes the export dialog in a real browser | pass | |
| Seek into another chapter lands at the right offset (ArrowRight from 0:00: chapter two, `currentTime` between 1.7 and 2.4 on the visible element, clock 0:05) | pass | |
| Click third block: chip shows "Three end", clock at least 0:06 | pass | |
| Question + Enter shows a yellow bubble; survives a reload | pass | |
| Export: type folder, Export gives 409, Export drafts lists 3 files, all exist on disk and nothing else is in the folder; the rendering chapter is listed as left out | pass | |
| Stop the server: page shows "Yap's server stopped." within 60 s | pass | |

### Join gap note (needs the owner)

The brief's measure cannot read below the browser's `timeupdate` rate: Chromium fires it about every 250 to 265 ms, so even a perfect join reads about 250 ms.
The raw number (259 ms) sits on that floor, i.e. it is the cadence, not a stall; the test asserts the gap minus the in-chapter cadence is under 250 ms.
The test also measures the real visual gap with painted frames: about 183 ms (a little over four frames at 25 fps) where one frame would be 40 ms.
That passes the 250 ms threshold but is a visible-if-small pause, not a seamless join.

Cause check (the `Cache-Control: no-store` suspicion): not the cause. In a full play the page made exactly one `GET /chapters/<id>/video` per chapter (206, `range: bytes=0-`, `cache-control: no-store`), none at the swap. So the idle element is not refetching; the ~140 ms beyond a frame is in the engine's swap (it waits for the playing chapter to end before starting the next). Server header left untouched, threshold not loosened (the 250 ms bar is applied to the stricter frame measure).
Raise with the owner whether a gap near 180 ms meets "no visible stall at a join" (spec section 1, item 1), or whether the engine should start the next element a little before the current one ends.

## Manual look check

Screenshots (fixture, paused in chapter one with its caption showing): `docs/phase-3/acceptance-1440.png`, `docs/phase-3/acceptance-900.png`.
Compared against mockup tab 1 (`style-directions-v2.html`, Neo-Brutalism).

Done means (spec section 1):

| # | Line | Result | Note |
|---|---|---|---|
| 1 | Several chapters play start to finish with no visible stall at a join | concern | plays 0:00 to 0:09 across two joins; each join pauses about 183 ms (see above) |
| 2 | Timeline shows every chapter state and updates live over SSE | partial | ready and rendering seen in the browser; failed, stale, pending, follow-up and live updates are unit-tested only, the fixture does not produce them |
| 3 | A question is posted, appears in the thread, survives a reload | pass | bubble with "waiting" and the "Claude isn't connected" notice |
| 4 | Export writes the files to a folder the viewer names | pass | mp4, script.md, sources.json; the rendering chapter listed as left out |
| 5 | `player/dist/` is committed and CI fails when it differs | pass | `npm run check:dist` exits 1 after touching a dist file, 0 after rebuild; `.github/workflows/player.yml` runs it (not run remotely) |

Timeline look rows (spec 4.1):

| State | Result | Note |
|---|---|---|
| ready, already played | pass | black block, cream text (seen during a run); not in the committed screenshots |
| ready, current | pass | white block lifted with shadow, yellow fill to the playhead (900px shot); at the end of playback the whole block is yellow |
| ready, not yet played | pass | white block |
| follow-up | not exercised | unit-tested; fixture has no `parent_id` |
| rendering | pass | orange and cream stripes, black "rendering" label |
| failed | not exercised | unit-tested |
| stale | not exercised | unit-tested |
| draft tag | pass | "draft" tag on every block (the server marks new rows draft) |

Differences from the mockup:

- Mockup blocks carry a number prefix ("01 Why a planner"); the player prints the title only (spec 4.1 says title).
- A chapter with no `chapter.json` shows its folder name as its title (the fourth block, "four-rendering"); the fixture's choice, not a player fault.
- At 1440 the right panel is shorter than the mockup's (it grows with content); the mockup panel is full height.
- At 900 px the panel sits below the timeline as the spec says; the page scrolls.
- Header: logo mark, "yap" block and tagline match; the connected pill shows "Claude not connected" because nothing is connected.
