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
| Join: outgoing element's `ended` to the first painted frame of the incoming visible element (spike 6's metric; asserted <= 160 ms per join, a regression guard set from measured data, see below) | pass | R20, three runs: 129/123, 128/134, 124/130 ms |
| Audio coverage: each chapter's `played` ranges merge to one range covering [0, 2.9]; no `error` event; both `video.error` null; visible element not muted | pass | |
| Caption cue "One intro caption line." visible in chapter one | pass | |
| Escape closes the export dialog in a real browser | pass | |
| Seek into another chapter lands at the right offset (ArrowRight from 0:00: chapter two, `currentTime` between 1.7 and 2.4 on the visible element, clock 0:05) | pass | |
| Click third block: chip shows "Three end", clock at least 0:06 | pass | |
| Question + Enter shows a yellow bubble; survives a reload | pass | |
| Export: type folder, Export gives 409, Export drafts lists 3 files, all exist on disk and nothing else is in the folder; the rendering chapter is listed as left out | pass | |
| Stop the server: page shows "Yap's server stopped." within 60 s | pass | |

### Join measurements

Asserted: `ended` of the outgoing element to the first painted frame (`requestVideoFrameCallback`, `expectedDisplayTime`, visible element only) of the incoming one, at most 160 ms per join (`JOIN_ENDED_TO_FRAME_MAX_MS`). Spec 5.1 rule 2 and spike 6 expect 20-35 ms; that does not reproduce on this machine (see "Join investigation"). The bar was first 100 ms and failed at 117-135 ms in every run; controller ruling R20 set it to 160 ms, the worst join in the investigation (about 132 ms; single e2e runs have reached 134-135 ms) plus about one frame. It is a regression guard against the swap getting slower, not the spec's target.

Logged only (not asserted), per join, two runs of `npm run e2e`:

| Run | Join | ended to first frame | play()/playing after ended | canplay after ended | last frame to first frame | raw timeupdate gap |
|---|---|---|---|---|---|---|
| 1 | 1 | 121 ms | 42 ms | none | 183 ms | 257 ms |
| 1 | 2 | 135 ms | 2 ms | none | 183 ms | 260 ms |
| 2 | 1 | 131 ms | 2 ms | none | 183 ms | 263 ms |
| 2 | 2 | 121 ms | 2 ms | none | 167 ms | 264 ms |

The raw `timeupdate` gap sits on Chromium's ~265 ms `timeupdate` cadence and says nothing about stalls. `canplay` did not fire on the incoming element after `ended` (it was already loaded). `play`/`playing` fire 2 ms after `ended` (one run 42 ms), so the call to play is prompt; the remaining ~120 ms until a frame is painted is not explained by these events. The `Cache-Control: no-store` suspicion is not supported: one request per chapter video during a play, none at the swap. The server header was not touched.

After R18 (idle element hidden with `opacity: 0`, `pointer-events: none`, `aria-hidden` instead of `visibility: hidden`), three runs:

| Run | Join | ended to first frame | play()/playing after ended | canplay | last frame to first frame | raw timeupdate gap |
|---|---|---|---|---|---|---|
| 1 | 1 | 117 ms | 5 ms | none | 183 ms | 262 ms |
| 1 | 2 | 126 ms | 3 ms | none | 167 ms | 250 ms |
| 2 | 1 | 121 ms | 5 ms | none | 183 ms | 251 ms |
| 2 | 2 | 129 ms | 1 ms | none | 167 ms | 254 ms |
| 3 | 1 | 124 ms | 7 ms | none | 183 ms | 265 ms |
| 3 | 2 | 130 ms | 4 ms | none | 183 ms | 263 ms |

No change: the hiding style makes no difference. `canplay` still does not fire on the incoming element. These runs failed the 100 ms bar then in force; no other engine change was tried.

Environment caveat: headless Chromium; `expectedDisplayTime` may include compositor latency that spike 6 did not measure the same way.

After R20 (bar set to 160 ms, nothing else changed), three runs, all pass:

| Run | Join | ended to first frame | play()/playing after ended | canplay | last frame to first frame | raw timeupdate gap |
|---|---|---|---|---|---|---|
| 1 | 1 | 129 ms | 27 ms | none | 200 ms | 242 ms |
| 1 | 2 | 123 ms | 3 / 4 ms | none | 150 ms | 263 ms |
| 2 | 1 | 128 ms | 2 ms | none | 183 ms | 257 ms |
| 2 | 2 | 134 ms | 3 ms | none | 183 ms | 252 ms |
| 3 | 1 | 124 ms | 2 ms | none | 183 ms | 256 ms |
| 3 | 2 | 130 ms | 2 ms | none | 167 ms | 255 ms |

### Join investigation

Throwaway script (not committed) ran spike 6's page (`plain` mode, opacity hiding) and the player against the e2e fixture's clips, same Playwright Chromium, 3 runs each. Metric: `ended` to the first painted frame of the visible element, in ms (`expectedDisplayTime`; the frame-callback time is about 0-17 ms lower), joins 1 and 2 per run.

| Experiment | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| A. spike 6, muted, headless | 78 / 80 | 76 / 79 | 93 / 94 |
| B. spike 6, unmuted, headless | 109 / 116 | 118 / 105 | 120 / 110 |
| C. player, both videos muted, headless | 90 / 96 | 94 / 81 | 93 / 80 |
| Player, unmuted, headless (as shipped) | 124 / 129 | 132 / 124 | 120 / 129 |
| D. spike 6, muted, headed | 96 / 84 | 90 / 78 | 85 / 91 |
| D. player, unmuted, headed | 128 / 117 | 119 / 128 | 122 / 117 |

Conclusions:
- The player matches spike 6's page under the same conditions: unmuted, both sit at about 105-130 ms; muted, both at about 76-96 ms. The player's swap code adds roughly 10 ms at most.
- Muting accounts for about 30-40 ms (not 80+): audio output start-up after the swap. The player must play sound, so it cannot be muted.
- Headed vs headless makes no difference (spike 6 headed: 78-96 ms).
- Spike 6's recorded 20-35 ms did not reproduce with this machine, Chromium build and clips (even muted it reads 76-96 ms here). Clips or Chromium version are the remaining differences; they were not isolated further.
- No player change was made. With sound on, a 100 ms bar is not reachable in this harness even by the spike's own page. Ruling R20 set the e2e bar to 160 ms (worst ~132 ms plus about one frame) as a regression guard; the 20-35 ms target is flagged for the owner.

## Manual look check

Screenshots (fixture, paused in chapter one with its caption showing): `docs/phase-3/acceptance-1440.png`, `docs/phase-3/acceptance-900.png`.
Compared against mockup tab 1 (`style-directions-v2.html`, Neo-Brutalism).

Done means (spec section 1):

| # | Line | Result | Note |
|---|---|---|---|
| 1 | Several chapters play start to finish with no visible stall at a join | met as far as this machine allows | about 120 ms join (about 3 frames at 25 fps), the same as spike 6's own page measured here; the 20-35 ms target in spec 5.1 rule 2 is not reproducible on this Chromium. Flagged for the owner. |
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
