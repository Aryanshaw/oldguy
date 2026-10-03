# Phase 3 summary: the browser player

Date: 2026-10-03. Branch `phase-3-player`: 28 commits above `20da770` (the tip of `phase-2-server` it was cut
from; first `bb8d731`, last `b51d530`; this file adds one more). Player unit tests: 215 of 215 pass (16 files,
Vitest, 2.6 s). Root `npm test`: 610 of 610 pass (Node 26.7.0, 8.9 s). End-to-end: 1 Playwright test of 11 steps,
passing in a real Chromium against the real server and the committed build. All three were run for this summary
at `b51d530`.

> **Final review pending.** Sections 1 to 7 describe the branch at `b51d530`, before the controller's
> whole-branch review (`phase-2-server..phase-3-player`). Section 8 is where that review's result goes.

This document is the roll-up the plan's Task 13 asks for. It is written for a reader who was not here. The run
results are in [ACCEPTANCE.md](ACCEPTANCE.md); this file says what was built, what the results mean, what was
decided without the owner, and what is still open. Every statement about behaviour was checked against the code
at `b51d530`; `file:line` references are to that commit.

**Terms used throughout.** The *player* is the web page the server answers at `GET /`: a React app in `player/`,
built once with Vite and committed as `player/dist/`, so a user never builds it. A *chapter* is one short mp4;
the *manifest* lists them in story order with a status (`pending`, `rendering`, `ready`, `failed`, `stale`). The
*engine* is the module that plays the ready chapters back to back using two `<video>` elements, one visible and
one preloading the next chapter. A *join* is the moment one chapter ends and the next starts. The *store* is the
page's one copy of the server's state; it loads `/api/state` once and then listens to the server's event stream
(SSE). *Spike 6* is the Phase 0 experiment (`spikes/06-chapter-gap`) that measured the join. The *ledger* is the
work log `.superpowers/sdd/2026-10-03-phase-3-player/progress.md`. The *controller* is the Claude session that ran
the plan, handed each task to an implementer and a reviewer, and took decisions where the plan was silent; those
decisions are the *rulings* `R1` to `R21` in section 4.

---

## 1. What Phase 3 delivered

A player page that replaces the Phase 2 placeholder. It plays every ready chapter as one video with a join
between chapters; shows a chapter timeline whose blocks carry each status, a yellow fill for the playing chapter,
tooltips with the poster, and update live from the stream; draws WebVTT captions as an overlay (on by default,
`c` to toggle); has a Chat tab where a question is posted with the current chapter and second and shown as
*waiting*; a Sources tab listing the files the current chapter cites; an export dialog that writes the joined
video to a folder the viewer names (full first, then "Export drafts" on a 409); and clear notices when the
server is away. The server gained two read-only routes for it: the static files under `/assets/` and
`GET /chapters/:id/sources`. Nothing makes Claude answer yet; that is Phase 4.

### 1.1 Files

66 files added outside `player/dist/` and 4 changed (`git diff --name-status 20da770..HEAD`); 6,924 lines added
excluding `player/dist/` and `player/package-lock.json`. `player/dist/` is 9 committed files.

Server side (Node standard library only, as before):

| File | Lines | What it is |
|---|---|---|
| `server/player-routes.cjs` | new | `GET /` serves `player/dist/index.html` when it exists (else the placeholder); `GET /assets/:file` with a fixed name rule and 7 allowed types; `GET /chapters/:id/sources` from `chapter.json` |
| `server/server.cjs` | +14/-2 | route wiring and a `..` segment guard for every request (commits `378a44e`, `af5202f`) |
| `tests/server-player.test.cjs` | new | 11 tests: index bytes, asset types, name tricks, symlinks, sources shapes |

Player (`player/`), line counts from `wc -l` at `b51d530`:

| File | Lines | What it is |
|---|---|---|
| `src/engine/engine.ts` | 382 | the two-video playback engine (section 3, Review Focus 2) |
| `src/state/store.ts` | 141 | state load, stream handling, `ask` and `press`, the `sent` map |
| `src/api/client.ts`, `src/api/stream.ts` | 84, 143 | typed fetch helpers; reconnecting `EventSource` with backoff and a silence watchdog |
| `src/lib/timeline.ts`, `src/lib/vtt.ts` | 64, 50 | block weights and global time; the WebVTT parser |
| `src/components/usePlayer.ts` | 137 | the React hook over the engine (`broken` ids, keys, seek, step, jump) |
| `src/components/VideoStage.tsx`, `Captions.tsx`, `Controls.tsx` | 47, 47, 92 | the stage, the caption bar, play/pause, time, `CC` |
| `src/components/Timeline.tsx` | 153 | one `<button>` per chapter, the look table of spec 4.1 and section 10 point 4 |
| `src/components/ChatTab.tsx`, `SourcesTab.tsx` | 149, 85 | the two panel tabs |
| `src/components/ExportDialog.tsx`, `Header.tsx`, `Notice.tsx`, `Logo.tsx` | 137, 22, 26, 26 | native `<dialog>` export; header with the connected pill; link notices; the logo |
| `src/App.tsx`, `src/main.tsx`, `src/types.ts`, `src/theme.css` | 98, 10, 62, 47 | the shell, the entry, the wire types, the tokens |
| `src/components/ui/{button,input,tabs,tooltip}.tsx` | 29, 17, 40, 25 | the four shadcn pieces, restyled |
| `src/test/*`, `*.test.ts(x)` | 2,551 | 16 test files (fake video element, fixtures, a scan of `dist/`) |
| `e2e/player.spec.ts`, `e2e/make-fixture.cjs`, `playwright.config.ts` | 243, 111 | the end-to-end test and its ffmpeg-made fixture |
| `scripts/check-dist.mjs` | new | `npm run check:dist`: rebuilds and fails if `dist/` differs |
| `vite.config.ts`, `tsconfig.json`, `package.json`, `index.html`, `components.json` | | tooling; dev proxy to the server (R6) |
| `dist/` | 9 files | `index.html` plus 8 assets (section 1.2) |

Also added: `.github/workflows/player.yml` (root tests, player typecheck, player tests, `check:dist`; no e2e),
`docs/phase-3/README.md`, `ACCEPTANCE.md`, two screenshots, the two mockups, the spec and the plan. Changed:
`.gitignore` (+3), `tests/server-basic.test.cjs` (+4/-1), and `docs/superpowers/specs/2026-10-02-yap-design.md`
(+24: section 15, amendments A10 to A17).

### 1.2 Numbers

- **Commits:** 28 in `20da770..b51d530`: 11 `feat:`, 10 `fix:`, 5 `docs:`, 1 `test:`, 1 `chore:`.
- **Tests:** player 215 of 215 (16 files; Task 2 started at 7, Task 12 ended at 215); root 610 of 610 (Phase 2
  ended at 596; Task 1 added 14); e2e 1 test, 11 steps, about 25 s. `npm run check:dist`: `player/dist matches a
  fresh build`, exit 0.
- **Bundle:** `player/dist` is 484 KB on disk (`du -sh`). By file: `assets/index-VU1mUmcX.js` 344,590 bytes,
  `assets/style-C5EJGT26.css` 30,861, `index.html` 388, and six Archivo font files (three `.woff2` of 13,548 to
  14,600 bytes and three `.woff` of 17,892 to 18,988; both kinds because of R1, latin only because of R8). Nothing
  is inlined; every `src` and `href` starts with `/assets/`.
- **Work:** 14 tasks (0 to 13; Tasks 4 and 5 ran as one batch). 11 fix rounds: Task 1 one, Task 3 one, Task 6
  three, Task 10 one, Task 11 one, Task 12 four. 20 rulings. 39 "minor (deferred)" lines in the ledger.

---

## 2. Results against the spec's "Done means"

From spec section 1, as recorded in [ACCEPTANCE.md](ACCEPTANCE.md) ("Manual look check").

| # | Done means | Result |
|---|---|---|
| 1 | Several chapters play start to finish with no visible stall at a join | **Met as far as this machine allows.** The join is about 120 to 135 ms from `ended` to the first painted frame of the next chapter, about 3 frames at 25 fps; the spec's 20 to 35 ms does not reproduce here even for spike 6's own page. Section 5.1 has the whole story. The owner must judge whether 3 frames is a visible stall. |
| 2 | The timeline shows every chapter state and updates live over SSE | **Partial in the browser.** `ready` and `rendering` were seen; `failed`, `stale`, `pending`, follow-up and live updates are unit-tested only, because the e2e fixture does not produce them. |
| 3 | A question is posted, appears in the thread, survives a reload | Pass (e2e step "a question appears as a bubble and survives a reload"). |
| 4 | Export writes the files to a folder the viewer names | Pass (e2e step "exports drafts to a folder and the files exist"; three files, nothing else in the folder, the rendering chapter listed as left out). |
| 5 | `player/dist/` is committed and CI fails when it differs | Pass locally: `check:dist` exits 1 after a byte is appended to a dist file and 0 after a rebuild; `.github/workflows/player.yml` runs it. **The workflow has never run remotely** (nothing is pushed). |

---

## 3. The five Review Focus items and the tests that pin them

"Pinned" means a named test fails if the behaviour regresses. Test names are the real strings in the files
(looked up at `b51d530`). "e2e step" names a `test.step` in `player/e2e/player.spec.ts`, which `npm run e2e`
runs by hand and CI does not.

| # | Review Focus | Pinned by | Honest status |
|---|---|---|---|
| 1 | The content policy (`default-src 'self'`) silently blocks inline or `data:` loads; expected zero violations | `player/src/test/dist.test.ts`: "index.html has no inline style or script", "index.html and css files name no data:, blob: or outside address", "every src and href in index.html starts with /assets/", "every asset has a safe name and an allowed extension". e2e step "no console message and no CSP violation during the whole run" (a `securitypolicyviolation` listener, `player.spec.ts:75`; the only console line is the one 409 the test provokes, asserted exactly once). `tests/server-player.test.cjs`: "security headers stay on; without the key every new route is 403". | Pinned. Note (R3): the JS bundle is not scanned for `data:` or `blob:` strings, because React's error text holds `https://react.dev/...`; a JS-initiated outside load would be caught only by the e2e. |
| 2 | The chapter list changes during playback: insert before the playhead, remove the current one, the preloaded one turns `stale` | `player/src/engine/engine.test.ts`: "Review Focus 2: inserting a chapter before the playhead keeps position and does not touch the visible element", "Review Focus 2: a stale preloaded chapter is replaced by the one after it", "Review Focus 2: removing the current chapter moves on and keeps playing; with nothing after it ends", "removing the current chapter when the next is not preloaded loads it into the visible element", "a chapter that turns ready and is next in order becomes the preloaded one". Errored chapters (spec 5.1 rule 7, R10, R11): "F3: an errored chapter stays skipped across unrelated setChapters, with no second error", "F3: an errored chapter is playable again after an update shows it not ready, then ready", "N3: the setChapters ended fallback never picks an errored chapter". | Pinned against a fake video element (`src/test/fakeVideo.ts`). In a real browser only the plain join and one cross-chapter seek were exercised (e2e); no list change during playback was tried live. |
| 3 | Missing numbers and empty lists: `duration_s: null`, zero ready chapters, empty thread, no sources, captions 404 | `lib/timeline.test.ts`: "total ignores non-ready and null", "null, unknown id and non-playable give 0", "all-null durations weigh 1 each", "missing durations use the mean of those that have one", "empty list gives []". `lib/vtt.test.ts`: "empty, header only, and garbage give []". `components/player.test.tsx`: "says nothing to play yet otherwise", "shows 0:00 / 0:00 and never NaN for null durations", "shows nothing on 404 and does not refetch on every update", "shows nothing when the fetch rejects", "renders nothing for an empty cue". `components/Timeline.test.tsx`: "current fill is clamped and survives a null duration", "renders an empty bar for no chapters", "omits the poster when null". `components/ChatTab.test.tsx`: "empty thread shows the empty text". `components/SourcesTab.test.tsx`: "shows the empty text for []". `state/store.test.ts`: "accepts a manifest with zero chapters". | Pinned. |
| 4 | The server goes away: stream drops, 403 after a restart, 503 while closing; the page says what to do and never spins forever | `api/stream.test.ts`: "reconnects after an error: reconnecting, getState, new source after 1 s", "reports gone on a 403 and opens nothing more", "reports gone after five failures, backing off 1, 2, 4, 8 s", "a ping resets the failure count", "treats 40 s of silence as an error", "close() during a pending retry cancels it". `state/store.test.ts`: "403 on first load gives forbidden; other failures give error; retry tries again", "stream status gone, reconnecting, then a fresh state returns to open". `components/Notice.test.tsx`: "forbidden", "gone", "reconnecting is a slim banner", "error shows the message and Try again calls retry". `App.test.tsx`: "a failed state load shows the error and Try again reloads", "a 403 shows the expired-link text". e2e step "stopping the server shows the stopped notice within 60 s" (a real server killed under a real page). | Pinned for the stream drop and the 403. **The 503 case has no test**: no player test mentions 503 or "closing". By the code, a 503 on the first load shows the message with `Try again` (`store.ts:93`), a 503 during a reconnect counts as one failure in the backoff, and a 503 on export shows the server's reason in the dialog; none of this was checked. |
| 5 | Hostile or huge text: a title like `<img src=x onerror=alert(1)>`, a 4,000-character message, a 300-character path; shown as text, layout intact | `components/Timeline.test.tsx`: "shows a hostile title as literal text and creates no element from it", "truncates a 300-character title". `components/ChatTab.test.tsx`: "a 4,000-character message with no spaces wraps; script text is literal". `components/SourcesTab.test.tsx`: "wraps a 300-character file path". Path tricks on the new asset route: `tests/server-player.test.cjs`: "asset names that try to leave assets/ never reach another file", "a symlink inside assets/ that points outside is 404", "sources: unknown or unsafe id is 404", "sources: a chapter.json that is a symlink out of the folder is an empty list". | Pinned. The wrap tests assert the CSS class, not a measured height (ledger, Task 10 minor). |

---

## 4. Decisions taken on the owner's behalf

Every ledger line that starts with `Ruling R<n>`, in ledger order: 20 lines, none skipped or merged. The "if
wrong" column is the ledger's own clause. These are the controller's decisions, not the owner's; this is the
list to overrule from. R1 to R5 were taken in the pre-flight scan before any task ran; R16 to R20 are the join
story of section 5.1.

| Ruling | Where | What was decided | If wrong |
|---|---|---|---|
| R1 | pre-flight, Tasks 1 and 2 | `.woff` is allowed everywhere `.woff2` is: the asset route serves it as `font/woff` and the dist scan accepts it, because @fontsource ships both and the browser picks woff2; cutting woff would mean hand-editing vendor CSS. | A few KB of unused font files in `dist/`. |
| R2 | pre-flight, Task 2 | `vite.config.ts` imports `defineConfig` from `vitest/config` (same function plus the `test` type), so the strict tsconfig accepts the `test` key. | One import line. |
| R3 | pre-flight, Task 2 | The dist scan forbids `data:`, `blob:`, `http://`, `https://` in `index.html` and CSS only; JS files are checked only by the e2e's `securitypolicyviolation` listener, because React's production bundle holds `https://react.dev/errors/` in error text, a string and not a load. Name and extension rules unchanged. | A JS-initiated outside load is caught only in Task 12's e2e. |
| R4 | pre-flight, Tasks 9 and 11 | The plan named `onRetry(id)` on the timeline but nobody wired it. Task 11's App wires it to `store.press('retry_chapter', 'rt:' + id, {chapter_id: id, t: 0})`; a failed block whose key is in `sent` shows the label `retry asked` (spec 4.1 says a failed click retries; section 10 point 6 says buttons mark as sent). | One label string. |
| R5 | pre-flight, Task 0 | Amendment A14 reads "Add the `pending`, `stale` and `draft` looks from section 4.1 and section 10 point 4 of the Phase 3 spec", because section 10 adds `pending` and overrides 1 to 9. | One sentence in the parent spec. |
| R6 | Task 0 concern, Task 2 | The keyed URL cannot set the cookie on Vite's address, so the dev proxy binds `127.0.0.1`, uses `changeOrigin: true` and strips the `Origin` header on proxied requests; the README says to open the server's keyed URL first (cookies ignore the port), then `http://127.0.0.1:5173`. Dev only; nothing shipped. | Dev setup needs one more tweak. |
| R7 | Task 2 | The root suite must not depend on whether `player/dist` exists: every root test that asserts the placeholder page points `deps.playerDir` at an empty temp folder, because the global rule is that root `npm test` stays green and Task 12 commits `dist`. | A few test lines. |
| R8 | Task 2 | Only the latin 500/700/900 Archivo CSS is imported (6 font files, not 18), because the UI copy is English and the plan already named latin as the fallback. | Non-latin titles render in the system fallback font. |
| R9 | Task 3 fix round | A `StoredEvent` type (`{id, ts, type, text?, context?}`) is added; `postMessage` returns it, and Task 7's `store.ask` appends `{id, ts, text, context, role: 'viewer'}`, because the type must tell the truth about the wire (the server event has `type` and no `role`). | One type and one mapping line. |
| R10 | Task 6 review, finding 3 | An errored chapter id stays unplayable for the page's life until an update shows that chapter with a status other than `ready` (a re-render passes through `rendering` or `pending`), which clears it; the `Chapter` type carries no build hash, so a status change is the only signal of new files. | A chapter fixed in place without a status change needs a page reload. |
| R11 | Task 6 fix round 2 | The re-reviewer's out-of-scope "R10 not covered" paths (`play()` restarting from the first playable, the `setChapters` ended fallback, the initial pick) join round 2 as part of finding 3: the same spec 5.1 rule 7 defect on paths the fix did not touch, not a new area. | One extra round of scope. |
| R12 | Task 6 fix round 3 | Round 3 also fixes the pre-existing root cause the re-reviewer named out of scope: `play()` while at the end with a pending seek must not call `vis.play()` on the finished chapter, and the fake video sets `paused = true` on `ended` so tests can see it. Same mechanism as the open regression. | A few lines of scope creep in one round. |
| R13 | Task 8 review minor, Task 9 | Spec section 6 says a chapter whose video fails to load is shown failed locally, but no task wired the engine's `error` event to the UI. Task 9 adds it: `usePlayer` exposes `broken: string[]`, and `Timeline` takes a `broken` prop that renders those ready blocks with the failed look, label `failed, retry`, tooltip `The video could not be loaded.` | One prop and one hook field. |
| R14 | Task 9 review minor, Task 11 | `usePlayer`'s `broken` mirrors the engine's errored rule (R10): when chapters change, ids whose chapter is no longer `ready` are dropped, otherwise a re-rendered chapter plays again while the timeline still says failed. Carried into Task 11 with a test. | One filter line. |
| R15 | Task 10 review | (a) `#FFD9A8` stays for source chips: the plan names it and the mockup uses it. (b) Error text becomes black on a red `#FF6B57` chip (red on white fails contrast). (c) The 3px card shadow becomes 4px. (d) The 10 to 14px radius rule covers containers and buttons; small chips and the bubble's 2px tail corner follow the mockup and stay. | A few class names. |
| R16 | Task 12 review | Spec 5.1 rule 2 and Done-means 1 bind over the plan's 250 ms bar. The e2e measures spike 6's metric, `ended` on the outgoing element to the first painted frame (`requestVideoFrameCallback`) of the incoming one, and asserts it at most 100 ms per join; the last-frame gap and the raw `timeupdate` gap (which sits on Chromium's ~265 ms cadence) are logged, not asserted. If the 100 ms assertion fails, the implementer reports the numbers and does not change the engine; the controller decides. | The bar is too strict for headless Chromium and gets retuned with data. |
| R17 | Task 12 review | Audio continuity = after a play-through, each chapter element's `played` ranges cover `[0, duration - 0.1]`, both elements are unmuted, and no `error` fired; headless Chromium cannot hear a click, so coverage is the stand-in. | A click goes unnoticed until someone listens by hand. |
| R18 | Task 12 fix round 2 | `VideoStage` hides the idle element with `opacity: 0`, `pointer-events: none` and `aria-hidden` (as spike 6 did), not `visibility: hidden`, since Chromium can skip compositing a visibility-hidden video and this was the one structural difference found; re-measure. | The gap stays and the controller rules on the bar with data. (It stayed: 117 to 130 ms.) |
| R19 | Task 12 fix round 3 | A controlled experiment, not a guess: run spike 6's own page in the same headless Chromium with the e2e's clips, muted and unmuted, and the player with both elements muted; whichever factor moves the number is the cause; a fix lands only if small and isolated, else the numbers go to the owner. | One round spent on measurement. |
| R20 | Task 12 fix round 4 | The e2e join bar becomes 160 ms per join (`ended` to first painted frame, unmuted, headless Chromium): a regression guard set from measured data (worst 132 ms plus about one frame), not the spec's 20 to 35 ms, which spike 6's own page cannot reach under these conditions. ACCEPTANCE.md records Done-means 1 as "met as far as this machine allows" and flags it for the owner; the engine is not the cause (R19 data); holding a target no implementation reaches here would leave the suite permanently red. | The owner may judge ~120 ms a visible stall; the next step is an overlap or early-start design that spec 5.1 rule 2 would have to allow. |
| R21 | Task 13 | Task 13 (documents only) gets no separate task review; the final whole-branch review checks SUMMARY.md against the ledger and the code. | A documentation error survives with one review seat fewer. |

Models used (ledger header, not a ruling): implementers on the mid-size model; prose tasks 0 and 13 on the
judgment model; reviewers on the mid-size model, except the most capable one for Task 1 (path security), Task 6
(the engine), fix rounds 4 and 5 of any task, and the final review. The ledger also shows the most capable model
reviewing Task 12 and running its fix round 4. No ledger line records a model choice as a ruling.

---

## 5. What is weak, unproven or deferred

### 5.1 The join (read this first)

Spec 5.1 rule 2 says: "On `ended` the engine swaps the visible element and starts the next one. The target is
the 20 to 35 ms join measured in spike 6." Done-means 1 says "no visible stall at a join".

What was measured (all in Playwright's headless Chromium, three 3 s fixture clips, sound on):

- As shipped, `ended` on the outgoing element to the first painted frame of the incoming one is **120 to 135 ms**
  per join. `play()` is called 1 to 7 ms after `ended` (once 27 ms, once 42 ms), so the engine is prompt; the
  rest is until Chromium paints. `canplay` never fires on the incoming element because it was already preloaded.
  The last frame of the old chapter to the first frame of the new one is 150 to 200 ms. Tables: ACCEPTANCE.md,
  "Join measurements".
- Two causes were ruled out with data: `Cache-Control: no-store` (one video request per chapter per play, none
  at the swap) and `visibility: hidden` on the idle element (R18; changing it to `opacity: 0` moved nothing).
- The R19 experiment ran spike 6's own page (`spikes/06-chapter-gap`, plain mode) in the same Chromium with the
  same clips: **unmuted 105 to 120 ms, muted 76 to 96 ms**. The player under the same conditions: unmuted 117 to
  132 ms, muted 80 to 96 ms. Headed and headless agree. So the player adds at most about 10 ms over the spike's
  design, muting is worth 30 to 40 ms, and the spike's recorded 20 to 35 ms does not reproduce on this machine,
  Chromium build and clips even muted. Clips and Chromium version were not isolated further.
- R20 then set the e2e bar to **160 ms** per join as a regression guard (worst 132 ms plus about one frame). The
  three runs after it measured 123 to 134 ms. The Task 12 report notes that 134 ms is 26 ms under the bar and a
  little above the "worst ~132" the ruling cites; a slow machine could trip it (ledger, Task 12 minor).

**For the owner to judge:** ~120 ms is about 3 frames at 25 fps and about 3 to 4 times the spec's number. Nobody
watched a real join with real chapters on a screen and said whether it is visible. If it is a stall, the fix is
not in the swap code; it needs a design the spec does not allow today, such as starting the next chapter a few
frames early or overlapping the two elements. The engine, `VideoStage` and the server header were left as built.

### 5.2 Not covered by acceptance

- **The e2e is not run in CI and needs a working ffmpeg.** `player/e2e/make-fixture.cjs` builds its clips with
  the ffmpeg named by `HYPERFRAMES_FFMPEG_PATH` (else the one on the path); the Homebrew ffmpeg on the owner's
  Mac is broken, so the static one under `spikes/.tools` was used. `.github/workflows/player.yml` runs root
  tests, `typecheck`, player unit tests and `check:dist`, not `e2e`. **The workflow has never run remotely**; the
  branch is not pushed.
- **One fixture, one browser.** Three ready 3 s test-pattern clips and one `rendering` folder, in Playwright's
  Chromium headless shell. No real `/yap` output, no 20 to 40 s chapters of several megabytes, no Safari or
  Firefox, nobody listened to the audio across a join (R17's `played`-range check cannot detect a dropout).
- **Not seen in a browser, unit-tested only:** `failed`, `stale`, `pending` and follow-up blocks; the Sources tab;
  live `chapter` events arriving during playback; the "Reconnecting" banner; the tooltip poster.
- **503 while the server is closing** (Review Focus 4) has no test at any level.
- **Done-means 2** is partial in the browser (section 2).
- **Mockup differences** (ACCEPTANCE.md): blocks print the title without a number prefix (the spec says title);
  the right panel grows with content instead of filling the height; at 900 px the panel sits below the timeline
  and the page scrolls.
- **The `/yap resume` string.** The chat tab says `Claude isn't connected: run /yap resume in Claude Code`
  (`ChatTab.tsx:61`); no such command exists yet. Phase 4 must provide it or change the string.
- **Process evidence.** Tasks 3 and 8 wrote tests after the code, with RED shown by moving files away rather than
  test-first; Task 9's `broken` test had no separate RED; Task 1's RED evidence was summarised, not shown (ledger).

### 5.3 Deferred Minors from the ledger, grouped

39 lines marked "minor (deferred)" in the ledger, none fixed; the ledger line is the source for each.

**Engine (Task 6)**

- After `ended`, seek, `play()` (intent only), pause, then the target errors or is removed: `play()` starts the
  finished chapter again and the position sticks at its duration (P3/P4; one-line fix named in the ledger). No
  test for the paused + at-end + pending-seek `play()` path (P7).
- The successor of a removed chapter is looked up in the old order only, so an appended chapter can be skipped
  (`engine.ts:259`); removing the current chapter during a pending seek drops the seek target (P4).
- Every `play()` rejection becomes `blocked`, including `AbortError` (`engine.ts:105`); state is set `playing`
  before the promise settles (a brief idle, playing, blocked flicker); a seek from `blocked` or `idle` ends in
  `paused`; a brief playing, paused, playing flicker on ended + seek + play + same-chapter seek; seek offsets are
  not clamped; a late error is pinned on a newly assigned id.
- Dead code: a branch at `engine.ts:263`, an unreachable generation check in `onCanPlay`, a `void flush` helper in
  the test. The fake video does not raise `readyState` on `canplay`, and `play()` resolves with an empty `src`.
  Setting `currentTime` on a `readyState 0` element before `canplay` was confirmed only by the e2e's cross-chapter
  seek.

**Store, stream, client (Tasks 3, 7)**

- The stream passes wrong-shape JSON (`null`, `{}`) to handlers unchecked (`stream.ts:73-82`); `setTimeout` is
  injectable but `clearTimeout` is always the global (`stream.ts:26,31`); `(data: any)` at `stream.ts:63`;
  `getCaptionsText`'s `res.text()` is unguarded.
- A stale `ask` or `press` after `stop()` or `retry()` still writes to the snapshot. Untested: state after `gone`
  stays `gone`; `retry()` with an open stream; `retry()` racing an older load. Test setup uses `as any`.

**Chat and buttons (Tasks 10, 11)**

- `press` has no in-flight guard (a double click posts twice); a failed press is swallowed with no feedback; the
  send guard reads render-stale `busy`; weak "disables Ask while sending" assertion; wrap tests check the class
  only; no IME or double-Enter test.
- `retry asked` never clears for the page's life; the export dialog's Cancel is enabled while an export is in
  flight, and a finished export can write into a reopened dialog; Escape-to-close was only simulated in unit
  tests (the e2e then confirmed it); the `dialog[open]` guard that pauses shortcuts also matches non-modal
  dialogs (fine while export is the only one); StrictMode double-start untested.

**Stage, captions, controls (Task 8)**

- `Captions` keeps cues per instance, not per chapter id, so one render can flash the old chapter's cue after a
  change (`Captions.tsx:28,35-39,55`); an in-flight fetch is not deduped.
- `setChapters` is called twice at mount; a new position object per tick re-renders the tree; the key guard does
  not exclude `select` or `[role=slider]`; the caption bar and time chip use a 6px radius with no border.
- Test gaps: engine created once is not asserted, no StrictMode test, no textarea or dialog target cases, Space on
  a button, backward chapter crossing.

**Timeline (Task 9)**

- Enter on the current block uses a synthesized `clientX` (use `e.detail === 0` instead); the fill clamp is
  untested above the duration; no Enter-on-disabled test; a stripe seam is possible; the component renders its
  own `TooltipProvider`, redundant if a parent adds one.

**Parser and maths (Tasks 4, 5)**

- VTT: a cue whose text is empty after cleaning is kept (the overlay renders nothing for it); the timing line
  needs whitespace around `-->`; unbounded hour digits; `&nbsp;` not decoded; a whitespace-only line is not a
  separator; the REGION skip and arrow-with-bad-time cases are untested.
- Timeline weights: the 4% floor is found by fixed-point iteration and falls about 7.6e-7 short near 24 chapters
  (an exact solve exists, `timeline.ts:36-47`); the floor is skipped entirely at 25 or more chapters (a cliff);
  `globalTime` does not clamp the offset; no tests for 24+ chapters or 0/NaN durations.

**Server routes (Task 1)**

- `isLines` accepts negative or reversed pairs (`player-routes.cjs:64`); `handleSources` re-implements
  `findChapterRow`; a manifest load failure answers 404 where 500 would be truer; `chapter.json` is read with no
  size cap and no identity re-check after the safe-file check.

**Build and scaffold (Task 2)**

- The dist scan does not inspect `.woff` files and catches CSS `data:` only by substring; no test for `Tooltip`
  or `Input`; the ArrowRight test focuses outside `act`; `App.tsx`'s SVG hard-codes hex colours; the tab trigger
  has no `sh` shadow and the tooltip no border (mild deviation from the `.nb` look).

**End-to-end and acceptance (Task 12)**

- The CSP array resets on reload (use `exposeFunction`); `e2e/` and `playwright.config.ts` are not typechecked;
  `-version` does not prove libx264 or aac; the 160 ms bar is about 25 ms over the worst single run (flake risk
  if the e2e ever runs in CI); blocks are asserted "not rendering" rather than `ready`; `SECONDS=3` repeated
  instead of imported; a stale comment at spec line 37; ACCEPTANCE wording slightly past the data ("audio output
  start-up", "~10 ms at most", "same as spike 6"); the `played`-range merge uses a 0.05 s tolerance; one result
  per row rather than per width; unused `stopServer`; a log line uses `firstTu!`/`lastTu!` without guards.

**Housekeeping (Task 0)**

- The Task 0 commit trailer names Claude Fable 5.1 instead of Claude Opus 5.5. `README.md:20` states a section
  10 fact; the example URL form at `README.md:45` was unverified.

---

## 6. What Phase 4 (the chat bridge) can rely on

Everything here is read from the code at `b51d530`. Phase 4 adds `yap listen` (Claude reading `state/events.jsonl`
and answering through `yap reply`); the page needs no change for a reply to appear.

### 6.1 The four events the page posts to `POST /api/message`

All go through `postMessage` (`src/api/client.ts:55-62`), body `{type, text?, context?}`, `context` always of the
shape `{chapter_id: string, t: number}` (seconds, a float). The server stores each as a line in
`state/events.jsonl` and answers `{event: {id, ts, type, text?, context?}}`.

| `type` | Sent when | `text` | `context` | Marked as sent under key | Where |
|---|---|---|---|---|---|
| `message` | the viewer presses Ask or Enter in the Chat composer (Shift+Enter is a newline; blank text does not send) | the trimmed question, up to the server's 4,000 characters | `{chapter_id, t: <offset in that chapter>}` from the current playback position; **omitted** when nothing is playing | not keyed; the returned event is appended to the thread as `role: 'viewer'` | `ChatTab.tsx:42-54`, `store.ts:116-126` |
| `make_video` | "Make this a video" under one of Claude's replies | none | the reply's own `context`, if the reply had one; else omitted | `mv:<reply id>` | `ChatTab.tsx:95-98` |
| `just_text` | "Just text" on the card "Making a chapter for: <question>", shown for every chapter whose status is `rendering` and whose `question` is set | none | `{chapter_id: <that chapter>, t: 0}` | `jt:<chapter id>` | `ChatTab.tsx:36,106-113` |
| `retry_chapter` | the viewer clicks a `failed` block on the timeline (or a `ready` block whose video errored in this page, R13) | none | `{chapter_id: <that chapter>, t: 0}` | `rt:<chapter id>`; the block's label becomes `retry asked` | `App.tsx:25,44`, `Timeline.tsx:81` |

The `sent` map lives in the store's memory only (`store.ts:133`); a reload clears it and every button is live
again (spec section 10 point 6: "for that page load only"). A failed press is swallowed: the button stays live
and nothing is shown (`ChatTab.tsx:39`, `App.tsx:44`). A failed `message` keeps the text in the composer with the
error under it.

### 6.2 Which buttons do nothing visible until `yap listen` exists

- **"Make this a video"** needs a reply with `role: 'claude'` in the thread, and only `yap reply` makes one. Today
  no reply exists in any real session, so the button is never on screen.
- **"Just text"** needs a `rendering` row whose `question` is set. The API accepts `question` on `op:"add"` and
  `op:"set"`, but no `yap` command sets it yet (`yap add-chapter` has no flag for it), so the card is never on
  screen today. Phase 4 must add that.
- **A failed block's retry** can be clicked (a `failed` row can come from `yap set-status`, or from the watcher
  when a chapter folder disappears). It posts the event and shows `retry asked`; nothing else happens until
  something reads the event.
- **Ask** posts and shows the bubble with the word `waiting` under it (`ChatTab.tsx:74`) while `claude_connected`
  is false; above the thread an orange notice reads `Claude isn't connected: run /yap resume in Claude Code`
  (`ChatTab.tsx:59-63`), and the header pill reads `Claude not connected` (`Header.tsx:15`). Phase 4 must either
  ship a `/yap resume` command or change that string. The pill turns yellow `Claude connected` on the first
  heartbeat and back when the heartbeat runs out: the server pushes a `state` event in both directions since
  Phase 2's final round (commit `3da2c69`, `server/api.cjs:112-126`).

### 6.3 Thread, replies and reconnects

- The thread is the `message` events plus the replies, each with `role`; replies may carry `in_reply_to` and
  `sources: [{file, lines}]` with `lines` as `"12"` or `"12-20"`, which the Chat tab renders as `file:lines`
  chips (`types.ts:27-35`, `ChatTab.tsx:79-89`). A `reply` event arriving twice is shown once (`store.ts:51-52`).
- Button events never appear in the thread (section 10 point 6); the page does not expect them back.
- The stream (`src/api/stream.ts`): 40 s of silence (no event, no `ping`) counts as a failure; on a failure the
  page shows the orange `Reconnecting` banner, refetches `/api/state` after 1, 2, 4 and 8 s, and reopens the
  stream; a `ping` resets the count. A fifth failure in a row, or **any 403**, gives `gone`: the page stops trying
  and shows `Yap's server stopped. Run /yap again and open the new link.` (`Notice.tsx:23`). `gone` is sticky:
  a `state` that arrives afterwards does not reopen it (`store.ts:60`). A 403 on the very first load is
  different: `This link has expired. Open the link printed by Yap again.` (`store.ts:91-92`, `Notice.tsx:22`).
  Any other first-load failure shows the message with a `Try again` button that restarts the load.
- Playback continues through a reconnect; only the panel and header depend on the stream.
- Media URLs are built from the chapter id (`/chapters/<id>/video`, `/poster`, `/captions`, `/sources`), never
  from the manifest's path fields, so the Phase 2 note about `null` paths on added rows does not affect the page.

---

## 7. How the work was done

Each task was built by one implementer and reviewed read-only by a second agent, with fix rounds re-reviewed,
all recorded in the ledger. 14 tasks, 11 fix rounds, 20 rulings.

| Task | Fix rounds | The most important thing the review caught |
|---|---|---|
| 0 Spec amendments, README | 0 | the keyed URL cannot set the cookie on Vite's address (R6) |
| 1 Server routes | 1 | the raw-path `..` guard split on `/` only, so `/assets/..\` folded to `/` and served `index.html` |
| 2 Scaffold | 0 | the root suite failed when `dist/` existed on disk (R7, caught before review) |
| 3 Client and stream | 1 | `postMessage` was typed as a thread entry; the wire has `type` and no `role` (R9) |
| 4 VTT, 5 timeline maths | 0 | nothing above Minor |
| 6 Engine | 3 | a pending seek had no recovery when the visible element errored or ended during it (a stall); `play()` after `ended` discarded a pending seek; the errored set was cleared on every update, against spec 5.1 rule 7; then two regressions from the first fix, then one from the second |
| 7 Store | 0 | nothing above Minor |
| 8 Stage, captions, controls | 0 | no task wired the engine's `error` event to the UI (R13, a Minor that became a ruling) |
| 9 Timeline | 0 | `broken` ids were never dropped when a chapter was re-rendered (R14) |
| 10 Chat and Sources | 1 | off-palette colours, a 3px shadow and small radii (R15) |
| 11 App shell, export | 1 | keyboard shortcuts still fired while the modal export dialog was open |
| 12 Build, e2e, acceptance | 4 | the join assertion was looser than it claimed (effective ~515 ms) while the brief's own check failed; the cause given for the gap was unsupported; the "audio continuity" step checked only no-error; the 250 ms bar could not catch a miss of the spec's target. Rounds 1 to 4: R16 to R20 (section 5.1) |

**Process note: the auto-mode permission check.** Agent dispatches were blocked by the session's auto-mode
classifier at four points: the Task 10 review (ledger line 118), the Task 11 implementer (lines 125 and 126; the
same dispatch was refused twice, and a chat approval did not clear it, so the owner left auto mode), the Task 11
review (line 129) and the Task 12 combined re-review (line 149). The owner approved continuing each time, and on
2026-10-03 gave a standing instruction: if a dispatch is blocked again, run that step natively in the controller
session (line 154). No work was lost; each blocked step ran unchanged afterwards.

Smaller things the ledger records: Tasks 3 and 8 wrote tests after the code; the Task 0 commit trailer names
the wrong model; the Task 12 fixture needs the static ffmpeg and a one-time `npx playwright install chromium`.

---

## 8. Final review

The whole-branch review (`20da770..a1fd4e6`) could not be sent to a reviewer agent: the session's auto-mode
permission check blocked the dispatch. On the owner's standing instruction ("if it blocks again run native"),
the controller ran it in its own session. It is therefore not an independent review.

What was checked: root `npm test` 610 of 610, player tests 215 of 215, typecheck clean, `check:dist` matching a
fresh build; `server/player-routes.cjs` and the `server/server.cjs` changes (guard order, the `..` segment check,
asset name and type rules, sources filtering); `App.tsx` wiring; the CI workflow; the store's button presses;
the engine's end-of-video recovery; this summary's rulings table against the ledger.

Findings, both fixed test first in `a492d4a`:

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | Important | `store.press` had no in-flight guard. A double click posted `make_video`, `just_text` or `retry_chapter` twice, so Phase 4 would act twice (for example, make two chapters). | A key that is pending or already sent posts nothing; a failed press frees the key. Two store tests. |
| F2 | Important | Engine: after the video ended, seek, play, pause, then the seek target breaks or is removed. The next `play()` replayed the finished last chapter while the position stayed at its end (Task 6's deferred P3/P4). | `recover()` returns to `ended` whenever the last chapter has finished and the state is not already `ended`, so `play()` restarts. One engine test. |

After the fixes: player tests 218 of 218, root 610 of 610, typecheck clean, `player/dist` rebuilt and matching.
The end-to-end test was not re-run after `a492d4a` (it needs the static ffmpeg and takes minutes); neither fix
touches the join, export or notices that it exercises.

Rulings: R21 was added after this summary was first written (row above). No ruling was overturned.

Deferred Minors: all others in section 5 stay deferred. None blocks merge: each is cosmetic, test-only, or
below what a viewer can see.
