# Phase 1 acceptance run

Date: 2026-10-03. Branch `phase-1-generator`. First run of the plugin against real Claude, real Kokoro TTS,
real whisper timing and real Hyperframes renders.

## Verdict

| Goal | Result | Number |
|---|---|---|
| Positive run makes 3 to 5 verified, rendered chapters | PASS | 5 chapters, 25.5 to 32.1 s each, 145.7 s of video |
| Mechanical checks (audit, durations, audio, captions, no position references) | PASS after fix | 49 of 50 checks passed on the run's files; the 1 failure (a caption past the end) is fixed in `b82bf05` and re-verified on real audio |
| Negative run: no chapters, says so plainly, one question | PASS | 10 s, nothing written but the hook's `session.json` |
| First playable chapter under 5 minutes | **FAIL** | 518 s (8 min 38 s) |
| 3-minute video under 15 minutes | PASS (extrapolated) | 2 min 26 s of video in 634 s (10 min 34 s); a 3-minute video would take an estimated 12 to 13 minutes |
| `hyperframes check` clean before render | **FAIL** | 3 of 5 chapters failed `clipped_text`; Claude rendered anyway |

## Machine

Apple M3, 8 GB RAM (macOS reported 0.2 to 0.9 GB free during the runs), macOS 26.2, 6.5 to 7.8 GB free disk,
Node 26.7.0, Claude Code 2.1.288 (model claude-opus-5-5), Hyperframes 0.8.112 (pinned, via npx), static ffmpeg 6.0
from `spikes/.tools` (`source spikes/env.sh`; Homebrew ffmpeg 8.1.2 is broken on this Mac:
`Library not loaded: libx265.216.dylib`), whisper-cli from Homebrew, Kokoro model cached (326 MB).

Data dir for the runs: `.superpowers/acceptance/data` (git-ignored), holding `venv/` and `doctor-ok`.

## How the runs were made

```
source spikes/env.sh; export CLAUDE_PLUGIN_DATA=<repo>/.superpowers/acceptance/data
cd <fresh temp copy of fixtures/todo-app>
claude -p --setting-sources project,local --plugin-dir <repo> --permission-mode bypassPermissions \
  --max-budget-usd 10 --output-format json "<request>" </dev/null
```

Deviation from the brief: `--setting-sources project,local` was added. Without it the nested Claude loads the
owner's user-level plugins and hooks (a "caveman mode" hook that rewrites the reply style, superpowers,
context-mode and others), which would contaminate the voice and behaviour being measured. A probe confirmed that
with the flag the only plugin skill visible is `yap:yap` and no caveman instruction is present. `--safe-mode` was
tried first and rejected: it also drops `--plugin-dir` (no `yap` skill at all). The wrapper is
`.superpowers/acceptance/run.sh` (git-ignored); it polls every 5 s and logs when each file first appears.

Temp project dirs, kept for inspection:

- Positive run: `/tmp/yap-pos-0Ptu` (all chapters, snapshots, mp4s)
- Negative run: `/tmp/yap-neg-qPuf`
- Probes: `/tmp/yap-probe-1KPH` (plugin env vars, skill name), `/tmp/yap-probe2-awqH` (`--safe-mode`),
  `/tmp/yap-probe3-OXgt` (`--setting-sources` isolation)

## Step 1: Doctor

First run, before any venv existed (`node bin/yap.cjs doctor --data-dir <dataDir>`, exit 1):

```
ok   Node: Node 26.7.0 (need 22 or newer)
ok   ffmpeg: ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers
FAIL Python venv: no venv at <dataDir>/venv
     fix: python3 -m venv <dataDir>/venv && <dataDir>/venv/bin/pip install kokoro-onnx soundfile
ok   Kokoro model: 326 MB at ~/.cache/hyperframes/tts/models/kokoro-v1.0.onnx (need over 300 MB)
ok   Free disk: 7.7 GB free (need 1 GB)
ok   whisper-cli: found on PATH
ok   Free RAM: 0.2 GB free, so 1 at a time
note Chrome: could not read the Hyperframes doctor output
     fix: run `hyperframes browser ensure` to download a Chrome for rendering
```

Following the venv fix text word for word failed (finding F2). The venv was then made with
`uv venv --python 3.12` plus `uv pip install kokoro-onnx soundfile` (3 s, 127 MB, packages cached). The Chrome
note was a real bug (finding F7, fixed). Final doctor, exit 0:

```
ok   Node: Node 26.7.0 (need 22 or newer)
ok   ffmpeg: ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers
ok   Python venv: <dataDir>/venv imports kokoro_onnx and soundfile
ok   Kokoro model: 326 MB at ~/.cache/hyperframes/tts/models/kokoro-v1.0.onnx (need over 300 MB)
ok   Free disk: 6.5 GB free (need 1 GB)
ok   whisper-cli: found on PATH
ok   Free RAM: 0.9 GB free, so 1 at a time
ok   Chrome: cache: $HOME/.cache/puppeteer/chrome-headless-shell/mac_arm-151.0.7922.71/chrome-headless-shell-mac-arm64/chrome-headless-shell
```

The suspected ffmpeg bug did not exist: `checkFfmpeg` already runs `HYPERFRAMES_FFMPEG_PATH` when it is set
(`lib/doctor.cjs`), so it passed against the static build while the Homebrew one is broken.

## Step 2: Fixture

`fixtures/todo-app/` (commit `844cd1a`): `add.js`, `list.js`, `complete.js`, `storage.js` (JSON file, path from
`TODO_FILE`), `server.js` (POST /todos, GET /todos, POST /todos/<id>/done), a 10-line `README.md`, and `smoke.js`.
`node fixtures/todo-app/smoke.js` prints `todo-app smoke: ok` (adds over HTTP, rejects a blank title with 400,
lists, completes, reads the saved file). It has no billing, payment or checkout code.

## Step 3: Positive run, `/yap how adding a todo works`

`/yap` reached the skill directly; no natural-language fallback was needed. Exit 0, 22 turns, 632.6 s wall,
115.4 s of it model time. Output `.yap/add-todo/` with `script.md`, `sources.json`, `specs/`, and five chapters:

| Chapter | Seconds | Words | Beats | mp4 first seen |
|---|---|---|---|---|
| where-the-request-lands | 31.7 | 88 | 6 | 634 s |
| checking-the-title | 30.8 | 90 | 6 | 518 s |
| giving-the-todo-an-id | 25.5 | 85 | 6 | 543 s |
| saving-the-todo | 25.6 | 78 | 6 | 568 s |
| sending-the-answer-back | 32.1 | 90 | 7 | 599 s |

Each chapter folder holds `chapter.json`, `narration.txt`, `narration.wav`, `beats.json`, `captions.vtt`,
`captions.json`, `index.html`, `build.json`, `chapter.mp4` (plus `snapshots/` from `hyperframes check`).
All five used word-level timing (whisper).

Where the time went (seconds from the request, from the session transcript):

| Phase | From | To | Took |
|---|---|---|---|
| doctor, read code, scope, verify, storyboard, write specs (one Python script that copies quotes from the files) | 0 | 61 | 61 |
| scaffold and audit all five | 64 | 68 | 4 |
| narrate all five, one after another | 70 | 152 | 82 (about 16 s each) |
| `find / -path '*hyperframes-cli*/SKILL.md'` (whole-disk search, finding F4) | 155 | 206 | 51 |
| dry run, `hyperframes check --snapshots --at-transitions` x5, re-checks, looking at snapshots | 209 | 475 | 266 |
| `yap render --cap 1` (all five, one at a time) | 479 | 631 | 152 (about 30 s each) |

The reply, verbatim:

> All five chapters rendered. Each sentence about the code passed the source check, and each chapter runs 25 to 32
> seconds. Play them in this order: (five `.yap/add-todo/chapters/<id>/chapter.mp4` paths) Four code lines were too
> wide for the code card. On screen, each one wraps onto a second line with no line number; the code text itself
> is unchanged. A browser player is coming in a later version.

Script quality: every claim is grounded and correct for the fixture (title trimming and the `|| ''` fallback, the
400 from the server's catch, id = max + 1 or 1, `TODO_FILE`, 201 with a JSON body). One claim cites a code comment
(`// Writes the whole list back to the file.`) as its evidence alongside the real line.

## Step 4: Mechanical checks (`tests/acceptance-check.cjs`)

Run by hand: `source spikes/env.sh; node tests/acceptance-check.cjs /tmp/yap-pos-0Ptu`. Per chapter it checks:
all 9 files present, `yap audit` exit 0, `data-duration` equals the padded WAV rounded up to 0.1 s, 20 to 40 s,
mp4 duration within 0.5 s of `data-duration`, an audio stream, audio length within 0.5 s of video, mean volume
above -45 dB, no sentence pointing at another chapter by position, and a valid `captions.vtt` (header, cues
moving forward, none past the end).

| Check | where-the-request-lands | checking-the-title | giving-the-todo-an-id | saving-the-todo | sending-the-answer-back |
|---|---|---|---|---|---|
| files present | PASS | PASS | PASS | PASS | PASS |
| yap audit clean | PASS | PASS | PASS | PASS | PASS |
| data-duration = padded wav | PASS 31.7 / 31.642 | PASS 30.8 / 30.703 | PASS 25.5 / 25.440 | PASS 25.6 / 25.589 | PASS 32.1 / 32.069 |
| 20 to 40 s | PASS | PASS | PASS | PASS | PASS |
| mp4 duration ~ data-duration | PASS 31.700 | PASS 30.800 | PASS 25.500 | PASS 25.600 | PASS 32.100 |
| mp4 has audio (aac 48 kHz) | PASS | PASS | PASS | PASS | PASS |
| audio length ~ video | PASS | PASS | PASS | PASS | PASS |
| not silent (mean dB) | PASS -22.4 | PASS -22.4 | PASS -22.6 | PASS -22.7 | PASS -24.0 |
| no position references | PASS | PASS | PASS | PASS | PASS |
| captions.vtt valid | PASS 15 cues | PASS 15 cues | PASS 13 cues | PASS 14 cues | **FAIL** last cue ends 32.44 s in a 32.1 s chapter |

The caption failure is finding F6, fixed in `b82bf05`. Re-narrating a copy of that chapter with the fix gives a
last cue ending at 32.068 s against a 32.069 s WAV. The run's own files were not regenerated, so the check still
reports the old failure against `/tmp/yap-pos-0Ptu`.

## Step 5: Looking at it

Frames from each `chapter.mp4` at 0 %, 10 %, 30 %, 50 %, 70 % and 95 % are in `docs/phase-1/frames/<id>-<n>.png`
(960 wide, n = 0 to 5 in that order), with one 3x2 contact sheet per chapter in `docs/phase-1/frames/<id>-sheet.png`
(top row 0/10/30 %, bottom row 50/70/95 %).

- House style is clearly there: near-black background, yellow headings and card headers, orange highlight bars and
  callouts. Code is set in a light sans face on a dark card with yellow line numbers. Text is readable at 1080p.
- Pieces are hidden until their beat: the 0 % frame is black in all five chapters, and every piece fades in at its
  sentence's whisper start time (for example `giving-the-todo-an-id` piece 1 at 7.52 s = beat 2 start 7.52 s).
- One piece at a time, centred, with a lot of empty space above and below the card. Callouts are shown alone, so
  their pointer tail points at nothing (`callout` frames in every chapter).
- Long code lines wrap onto a second row with no line number (for example `add.js` line 10 and `storage.js`
  line 6). Nothing is cut off in the frames, but `hyperframes check` reports these as `clipped_text` errors
  (finding F3).
- A highlighted line is dimmed to 35 % until its own beat, which reads as orange text on an orange bar
  (`where-the-request-lands-2.png`, line 28); `hyperframes check` measured 1.29:1 contrast (finding F10).
- A new code card shows an empty body for about 0.4 s before its first line fades in, and the first line takes
  1 to 3 s to reach full opacity (`giving-the-todo-an-id-2.png` caught that moment). It looks like a hiccup, not
  a bug.
- In `giving-the-todo-an-id` the title card stays up for 7.4 s while the second sentence talks about `loadTodos`;
  the storyboard put no piece on that sentence.
- Captions are files only (`captions.vtt`); they are not burned into the mp4.

Audio: every mp4 has an aac 48 kHz stream as long as the video, mean volume -22.4 to -24.0 dB. Nobody listened to
it; sync was checked by timing only (pieces start on whisper word times, audio and video lengths match exactly).

## Step 6: Negative run, `/yap how billing works`

Exit 0, 3 turns, 10.1 s. Claude listed the files, read them and grepped for
`bill|pay|price|invoice|charge|stripe|checkout|subscri|plan`. Nothing was written except the hook's
`.yap/session.json` (no slug folder, no `script.md`, no `specs/`, no chapters). The reply, verbatim:

> I couldn't find any billing in this project. It's a small todo app with add, list, and complete, plus a JSON file
> for storage and an HTTP server. Nothing in it handles payments, prices, invoices, plans or subscriptions, so I
> haven't made any chapters or written any files.
>
> Did you mean one of the flows that does exist, like how adding a todo works (from `server.js` through `add.js`
> to `storage.js`), or something else?

Plain statement, exactly one question, no chapters: PASS. It skipped `yap doctor` (Step 0), which is harmless
here since it stopped at scope.

## Step 7: Measurements

- First playable chapter: 518 s from the request (goal under 300 s): **FAIL**.
- All chapters: 634 s for 145.7 s of video (goal: a 180 s video under 900 s). Narration and render scale with
  chapter count (about 16 s and 30 s per chapter); the other phases do not. A sixth chapter would add about 50 s,
  so a 3-minute video would take an estimated 12 to 13 minutes: PASS by extrapolation, not measured.
- Tokens, positive run: 38 input, 63,589 cache-write, 999,715 cache-read, 12,002 output (4,251 of it thinking).
- Tokens, negative run: 6 input, 23,267 cache-write, 60,708 cache-read, 535 output.

## Open items from the ledger

| Item | Answer | Evidence |
|---|---|---|
| (a) Does `npx --yes hyperframes@0.8.112 render <chapter-dir>` accept a folder holding only `index.html` and its assets? | Yes | all five chapter folders (no `hyperframes.json`, no `meta.json`) rendered; mp4 durations equal `data-duration` to the millisecond |
| (b) Scene pieces hidden until their beat? | Yes | 0 % frames are black in all five chapters; each piece is a `fromTo` from opacity 0 at its beat's start time |
| (c) Narration audible and in sync? | Yes, by measurement | aac stream in every mp4, mean -22.4 to -24.0 dB, audio length = video length; piece starts equal whisper beat starts. No human listened. |
| (d) Is `CLAUDE_PLUGIN_DATA` set in Claude's shell, and does the hook write `.yap/session.json`? | Not set; hook writes it | probe without the export: `echo PD=$CLAUDE_PLUGIN_DATA PR=$CLAUDE_PLUGIN_ROOT` printed `PD= PR=`. The hook itself did get it (Claude Code created `~/.claude/plugins/data/yap-inline/` and the hook printed the doctor hint). `.yap/session.json` was written in every temp project. See finding F1. |
| (e) Do `--at-transitions` and `--frames` exist in 0.8.112? | Yes, on different commands | `hyperframes check --help` lists `--at-transitions` and `--snapshots`; `hyperframes snapshot --help` lists `--frames` (default 5) and `--at` |
| (f) Does `/yap` reach the skill? | Yes | the positive and negative runs both used `/yap ...`; the skill's real name is `yap:yap` and `/yap` resolved to it |

## Findings

| # | What happened | Evidence | Severity | Status |
|---|---|---|---|---|
| F1 | `CLAUDE_PLUGIN_DATA` reaches the hook but not Claude's Bash shell. So `yap doctor` and `yap narrate`, run by Claude, fall back to `<project>/.yap` for the venv and the pass marker, while the hook checks `~/.claude/plugins/data/yap-inline/doctor-ok`. For a real user the doctor asks for a venv inside every project, and the "run /yap doctor" hint never goes away. This acceptance run only worked because the variable was exported by hand. | probe `/tmp/yap-probe-1KPH`: `PD= PR=`; hook output in that session's transcript. Observed with `--plugin-dir`; not tested with a marketplace-installed plugin. | Important | Left: needs a design choice (for example the skill passes `--data-dir` to every command, or a fixed per-user data folder) |
| F2 | The doctor's venv fix text (`python3 -m venv ... && .../pip install ...`) fails on this Mac: `python3` is 3.14 and `ensurepip` exits 1. It also leaves a half-made `venv/` folder, so the next doctor still says "no venv". | `Error: Command '[.../venv/bin/python3.14', '-m', 'ensurepip', ...]' returned non-zero exit status 1` | Important | Left: which Python and tool to recommend (3.12, uv) is the owner's call |
| F3 | `hyperframes check` failed (exit 1, `clipped_text`) on 3 of 5 chapters because code lines over about 70 characters wrap inside the code card. Claude rendered anyway and explained the wrap in its reply, although `render.md` says to treat layout errors as real defects and fix the spec. Visually the wrap is readable and nothing is cut off. `yap render` does not run `hyperframes check`, so nothing enforces this gate. | check output in the session transcript; frames `saving-the-todo-*.png` | Important | Left: decide whether the code card should fit long lines so the checker accepts them, or the storyboard should cap quoted line length, or the skill should accept the wrap |
| F4 | `SKILL.md` step 6 and `render.md` say to read the `hyperframes-cli` skill, which yap does not ship. Claude ran `find / -path '*hyperframes-cli*/SKILL.md'` over the whole disk (51 s) and found the copy inside the npx cache. | transcript, 155 s to 206 s | Important | Left: skill text change (state the needed `check`/`snapshot` flags inline, which `render.md` mostly already does, and drop the reference) |
| F5 | First playable chapter took 518 s, not under 300 s. The pipeline only starts rendering after every chapter is narrated and checked, then renders all of them; the 51 s disk search and 266 s of checks sit in front of the first render. Render order is alphabetical by id (`lib/render-chapters.cjs:22` sorts the folder names), so the opening chapter (`where-the-request-lands`) rendered last, at 634 s. | timeline table above; `lib/render-chapters.cjs:22` | Important | Left: pipeline shape (render each chapter as soon as it passes; render in story order) is a design change |
| F6 | Whisper placed the last word's end 0.37 s after the audio ended, so the last caption cue (and beat) ran past the chapter. | `sending-the-answer-back/beats.json` last beat ends 32.44 s, WAV 32.069 s | Minor today (captions are not shown in the mp4); Important once a player shows the VTT | Fixed in `b82bf05` (beats clamped to the WAV length; test first; re-verified on real audio) |
| F7 | The doctor's Chrome check ran bare `hyperframes`, which is not on PATH, so it always said "could not read the Hyperframes doctor output", and its fix text named a command that does not exist. | first doctor output above | Minor | Fixed in `03cf599` (runs `npx --yes hyperframes@0.8.112 doctor --json`; fix text names the pinned command) |
| F8 | One `yap narrate` run (a re-narrate during verification, not the acceptance run) failed with `hyperframes tts failed: exit code 1` and no reason: stderr was empty. The same command passed on retry and when run by hand. | reproduced once only | Minor | Left: cause unknown (hypothesis: memory pressure on 8 GB, or tts reporting on stdout); narrate could include stdout in the message |
| F9 | `hyperframes check` warns `clip_media_fit` on every chapter: `data-duration` is the WAV length rounded up to 0.1 s, so the audio is 0.01 to 0.1 s shorter than its slot. Renders come out at `data-duration` exactly, so nothing visible. | check output | Minor | Left |
| F10 | A highlighted code line is dimmed to 35 % until its beat, so before then it is orange text on an orange bar (1.29:1 contrast per `hyperframes check`). | `where-the-request-lands-2.png` | Minor | Left: scene-kit styling |
| F11 | Some framing sentences lean on the chapter before ("With a good title in hand...", "The todo is saved...", "Now the new todo is ready..."). They name no chapter, so the checks pass, but the chapters do not fully stand alone. | `script.md` | Minor | Left: storyboard guidance |
| F12 | The chapter page loads GSAP from `cdn.jsdelivr.net`, so every check and render needs the network. | `index.html` line 7 | Minor | Left |
| F13 | Claude's first scaffold call failed because it put the command in a variable (`$Y scaffold`), which zsh does not split; it fixed this itself with a shell function. | transcript at 64 s | Minor | Left |
| F14 | Hand-off went slightly beyond Step 7: it added a sentence about the checks and the wrapped lines. No extra commands were mentioned. | reply above | Minor | Left |
| F15 | When run from a shell that has the owner's user settings, the nested Claude picks up user plugins and hooks (including one that changes reply style). Real users will have the same mix, so the voice can be affected by unrelated plugins. | probe 1 transcript (`CAVEMAN MODE ACTIVE` hook) | Minor | Left: worth knowing; this run isolated it with `--setting-sources project,local` |

## Re-run after the fix wave

Date: 2026-10-03, branch `phase-1-generator`. The same-command positive run and Step 6 by hand ran at `c8d2e5f`;
the stdin-open experiment and the negative run ran at `6a95b9d` (R3 fix in place) (fixes `c154361` F1, `9263977` F2, `9dfd292` F3,
`f1bfcfa` F4, `c8d2e5f` F5). Same machine, same harness (`.superpowers/acceptance/rerun/run.sh`, a copy of `run.sh`
that also records `date`; logs in `.superpowers/acceptance/rerun/`). `npm test`: 270 of 270 before, 272 of 272
after the two fixes below.

### Verdict

| Goal | First run | Re-run | Result |
|---|---|---|---|
| First playable chapter under 300 s | 518 s | **145 s** (same command); 190 s in the stdin-open experiment | PASS |
| All chapters, same command | 634 s, 5 of 5 | **1 of 4**: `claude -p` exited at 178 s while chapter 2 rendered in the background (finding R1) | **FAIL** |
| All chapters when the session stays alive (experiment, not the acceptance command) | - | 6 of 6 at 407 s, hand-off at 412 s (161.7 s of video) | PASS |
| Chapters made and rendered one by one, in story order | no (all narrated, then all rendered, alphabetical) | yes, in both runs | PASS |
| `hyperframes check` clean on every chapter, no wrapped code lines | 3 of 5 failed `clipped_text` | 4 of 4 and 6 of 6 rendered through the enforced check; re-run by hand: exit 0, 0 layout issues, no `clipped_text` | PASS |
| No whole-disk `find /` | 51 s search | none in either transcript | PASS |
| Hand-off lists the videos in story order | yes | same command: no hand-off (R1); experiment: yes, 6 paths in story order plus the one player line | FAIL / PASS |
| Mechanical checks (`tests/acceptance-check.cjs`) | 49 of 50 | 40 of 40 (same command, after Step 6 by hand) and 60 of 60 (experiment) | PASS |
| Negative run: nothing made, one question | PASS | PASS, 16 s | PASS |
| F1: yap commands find the data dir without the export | needed a hand export | yes, through `.yap/session.json` (observed, below) | PASS |
| F2: doctor's venv fix text works word for word | failed | yes, 2 s from the uv cache | PASS |

### Step 1: Doctor and F1, F2

`source spikes/env.sh; node bin/yap.cjs doctor --data-dir .superpowers/acceptance/data`: exit 0, every line `ok`
(Node 26.7.0, ffmpeg 6.0, venv imports kokoro_onnx and soundfile, Kokoro 326 MB, 7.6 GB disk, whisper-cli,
"0.2 GB free, so 1 at a time", Chrome from the puppeteer cache). 5.0 s.

F2: against an empty data dir the fix text is now `uv venv --python 3.12 <dir>/venv && uv pip install --python
<dir>/venv/bin/python kokoro-onnx soundfile`; against a half-made `venv/` it is the same prefixed with
`rm -r <dir>/venv`. Running the half-made one word for word in `/tmp` took 2.0 s (packages cached) and the next
doctor said `ok`.

F1, observed three ways:

1. Nested Claude, `CLAUDE_PLUGIN_DATA` not exported (`rerun/probe.sh f1-doctor "/yap doctor"`, 14 s): the hook
   wrote `"data_dir": "/Users/aryanshaw/.claude/plugins/data/yap-inline"` into `.yap/session.json`. Claude ran
   plain `node .../bin/yap.cjs doctor` (no `--data-dir`), and the doctor looked in that folder:
   `FAIL Python venv: no venv at /Users/aryanshaw/.claude/plugins/data/yap-inline/venv` with the uv fix text for
   that folder. Claude showed the fix and stopped, as the skill says. The hook printed the doctor hint. So the
   lookup works; that folder simply has no venv, and putting one there is outside what this run may touch.
2. Marketplace install, observed in an isolated config dir (`CLAUDE_CONFIG_DIR=/tmp/yap-cfg-...`, a local
   marketplace in `/tmp` wrapping a copy of the plugin, `claude plugin marketplace add` then
   `claude plugin install yap@yaptest`): the session's SessionStart hook ran even though that config was not logged
   in, and wrote `"data_dir": "/tmp/yap-cfg-.../plugins/data/yap-yaptest"`. So a marketplace install gets
   `<config>/plugins/data/<plugin>-<marketplace>`, and the hook does receive it. With a venv linked into that folder
   and no `CLAUDE_PLUGIN_DATA` in the shell, `yap doctor` run from a subfolder of the project found it
   (`ok Python venv: /tmp/yap-cfg-.../plugins/data/yap-yaptest/venv`) and wrote `doctor-ok` there; the hook then
   printed nothing (and still printed the hint for a data dir without the marker). `yap narrate` from the same
   subfolder narrated a copied chapter (25 s, timing words); with the venv moved away it failed, so it was really
   using the session's folder. The model was not run in this config (not logged in), so this is the CLI plus hook,
   not a full Claude session.
3. With the export (the acceptance runs): `.yap/session.json` still said `.../plugins/data/yap-inline`, while
   narrate used the exported acceptance venv. So Claude Code sets the hook's `CLAUDE_PLUGIN_DATA` itself
   (overriding the inherited value), but Claude's Bash shell inherits the outer export, and the explicit variable
   wins over the session file in `resolveDataDir`.

The acceptance runs below still export `CLAUDE_PLUGIN_DATA`: without it the real config's data dir has no venv
and every run would stop at the doctor, which would measure the wrong thing.

### Step 2: Positive run, `/yap how adding a todo works` (same command)

Started `Sat Oct 3 03:53:52 IST 2026`, project `/tmp/yap-pos-wYZJ`. Exit 0, 14 turns, 178 s wall (86.8 s model
time). Four chapters planned, in this story order:

| Chapter | Seconds | Beats | Timing | narration.wav first seen | chapter.mp4 first seen |
|---|---|---|---|---|---|
| the-request-arrives | 31.7 | 6 | words | 100 s | **145 s** |
| checking-the-title | 26.3 | 6 | words | 115 s | never (render killed, R1) |
| giving-it-an-id | 25.1 | 6 | sentence-share (R3) | 145 s | never |
| saving-and-replying | 31.3 | 6 | words | 170 s | never |

From the transcript (seconds from the request): 0 to 72 doctor, read code and all references, scope, verify,
storyboard and specs (one Python script); 75 scaffold failed with `$Y scaffold` in zsh, fixed with a shell
function at 78 (F13, again); 78 to 94 chapter 1 scaffold, audit, narrate; 97 `yap render ... --only
the-request-arrives` started in the background; 98 to 168 chapters 2, 3, 4 narrated while it rendered; 141 render
done (44 s including the layout check); 148 chapter 2's render started in the background; 170 Claude loaded the
Monitor tool, then ended its turn with "Chapter two is still rendering. I'll be notified when it finishes, and then
I'll start the renders for chapters three and four." The `-p` process exited at 178 s and the chapter 2 render's
output file reads `[killed]` (a `work-*` folder was left in its chapter). That reply was the whole hand-off.

Then the skill's own Step 6 command was run by hand in that folder: `yap render .yap/add-todo/chapters --root .
--only the-request-arrives,checking-the-title,giving-it-an-id,saving-and-replying`: exit 0 in 113 s,
`the-request-arrives: ready (already rendered)` then the other three `ready` in story order (about 38 s each). The
stale `work-*` folder was cleaned up. `--force --only giving-it-an-id` re-rendered it (32 s, new mtime), and a
plain re-run printed `ready (already rendered)` in 0 s. Composite time to all four: 178 s + 113 s, but the session
itself never got there.

Tokens: 22 input, 49,944 cache-write, 501,189 cache-read, 9,773 output (3,651 thinking).

Experiment, to tell "broken only headless" from "broken everywhere": the same invocation with
`--input-format stream-json --output-format stream-json --verbose` and stdin held open by a fifo
(`rerun/run-stream.sh`), started `Sat Oct 3 04:06:57 IST 2026`, project `/tmp/yap-posstream-gVaR`. Claude ended its
turn the same way at 249 s, but because the process stayed alive, the background render's notification started a
new turn (255 s), and the last one a third (408 s). Six chapters, all timing `words`:

| Chapter | Seconds | narration.wav | chapter.mp4 |
|---|---|---|---|
| the-request-arrives | 27.1 | 140 s | 190 s |
| reading-the-body | 31.9 | 160 s | 246 s |
| checking-the-title | 31.5 | 185 s | 322 s |
| picking-an-id | 25.0 | 200 s | 352 s |
| saving-to-disk | 26.1 | 226 s | 382 s |
| the-reply | 26.2 | 246 s | 407 s |

Chapters 3 to 6 were rendered by the Step 6 confirm run itself (255 to 404 s, one at a time, story order). The
hand-off at 412 s listed the six `chapter.mp4` paths in story order and said the player arrives later. Note: it
wrote its spec builder to `/tmp/yapgen/gen.cjs`, outside the project (removed afterwards). The process does not
exit on stdin EOF; it was stopped after the hand-off. This run had the R3 fix (`6a95b9d`): narrate and a render
overlapped five times and every chapter kept word timing. So the notify-and-continue pattern works when the session
lives on; an interactive session was not tested.

How long code lines were handled (68-column limit): no card wrapped. Claude cut long lines to a prefix: `add.js`
line 11 (85 columns) is shown as `const todo = { id, title: text, done: false,` and `server.js` line 20 (79) as
`try { resolve(raw ? JSON.parse(raw) : {}); }`. Neither card marks the cut, and the `giving-it-an-id` card is
spoken over with "...and the time it was created", the part that was cut off. In the experiment Claude first wrote
an abbreviated line `done: false, ... }` (not real code), noticed it and dropped it before scaffolding. Nothing in
yap compares code-card text with the file (finding R2).

### Step 3: Mechanical checks (`tests/acceptance-check.cjs /tmp/yap-pos-wYZJ`)

Run after Step 6 by hand (so all four have an mp4): exit 0, "all checks pass".

| Check | the-request-arrives | checking-the-title | giving-it-an-id | saving-and-replying |
|---|---|---|---|---|
| files present | PASS | PASS | PASS | PASS |
| yap audit clean | PASS | PASS | PASS | PASS |
| data-duration = padded wav | PASS 31.7 / 31.685 | PASS 26.3 / 26.208 | PASS 25.1 / 25.099 | PASS 31.3 / 31.258 |
| 20 to 40 s | PASS | PASS | PASS | PASS |
| mp4 duration ~ data-duration | PASS 31.700 | PASS 26.300 | PASS 25.100 | PASS 31.300 |
| mp4 has audio (aac 48 kHz) | PASS | PASS | PASS | PASS |
| audio length ~ video | PASS | PASS | PASS | PASS |
| not silent (mean dB) | PASS -22.4 | PASS -24.3 | PASS -22.6 | PASS -23.2 |
| no position references | PASS | PASS | PASS | PASS |
| captions.vtt valid | PASS 14 cues | PASS 14 cues | PASS 13 cues | PASS 15 cues |

The experiment's six chapters: 60 of 60 PASS (mean -22.5 to -24.1 dB, 13 to 16 cues each).

`npx --yes hyperframes@0.8.112 check <chapter>` by hand on the four: exit 0 each, "0 issues across 9 sample(s)"
for layout, 0 motion errors. Warnings only: contrast on dimmed highlighted lines (1.04:1 and 1.65:1, F10) and one
`clip_media_fit` (F9).

### Step 4: Looking at it, and memory

Frames at 0/10/30/50/70/95 % per chapter in `docs/phase-1/frames-rerun/<id>-<n>.png` plus `<id>-sheet.png`
(1.0 MB in all). `the-request-arrives/chapter.mp4` in that folder is not the one the session made at 145 s: the R3
reproduction re-rendered it with `--force` from the same build, so its frames and check rows come from that render.

- Better: no wrapped code line anywhere; every card line has its line number. Cards are smaller and tidier.
- Same: the 0 % frame is black in all four. Pieces still appear one at a time, centred, with much empty space;
  the callout still floats alone with its tail pointing at nothing (`the-request-arrives-5`,
  `checking-the-title-5`). A highlighted line before its beat is still orange text on an orange bar (`server.js`
  lines 18, 20, 28 in `the-request-arrives-2/4`; `storage.js` 16 in `saving-and-replying-2`) (F10). A new code
  card still shows an empty body for a moment (`the-request-arrives-3`, `saving-and-replying-1`).
- New to notice: between two pieces the screen goes almost fully black for about 0.5 s (measured in
  `giving-it-an-id` from 12.2 to 12.7 s, luma max 31 of 255), which is what `giving-it-an-id-3` caught. It is
  the old piece fading out before the new one fades in, so it is a design look, not a defect.
- Worse: a truncated code line looks like a whole line (`giving-it-an-id-5`, R2).

Memory: macOS swap was at 9.0 to 9.5 GB of 10 GB through the runs, free pages near zero, and the doctor said
"1 at a time". Nothing crashed and no `tts failed` happened in any run (narrate and a background render overlapped
three times in the acceptance run and five in the experiment). One effect was found: `giving-it-an-id` narrated
(116 to 143 s) while chapter 1 rendered and came out with `sentence-share` timing instead of word timing. A
reproduction (a forced render in the background, narrate on a copy of that chapter, and `whisper-cli --help` timed
every second) measured the first `whisper-cli --help` at **20.15 s** (then 0.1 to 0.35 s), over the 15 s limit
narrate borrowed from the doctor. Fixed in `6a95b9d` (R3). The first run's unexplained `hyperframes tts failed:
exit code 1` (F8) was reproduced exactly by pointing narrate at a data dir with no venv: Hyperframes prints
`{"ok":false,"error":"The kokoro-onnx package is not installed..."}` on stdout and nothing on stderr. Fixed in
`824278f` (narrate now shows that error). That re-narrate in the first run most likely ran without the export and
so without the venv; this is a strong hypothesis, not proven.

### Step 5: Negative run, `/yap how billing works`

`/tmp/yap-neg-6mWo`, exit 0, 3 turns, 16 s. It read the doctor and scope references, ran `yap doctor` (passed),
listed the files and grepped for billing words. Only `.yap/session.json` exists afterwards. The reply, verbatim:

> I couldn't find any billing in this project. It's a small todo app (`add.js`, `list.js`, `complete.js`,
> `storage.js`, `server.js`), and nothing in it handles payments, invoices, prices, plans or subscriptions.
>
> Did you mean another flow here, such as how adding a todo works (from `POST /todos` in `server.js` to the save
> in `storage.js`), or is the billing code in a different repository?

One question (one `?`), plain statement, no chapters: PASS. Tokens: 6 input, 27,672 cache-write, 62,221
cache-read, 627 output.

### Findings from the re-run

| # | What happened | Evidence | Severity | Status |
|---|---|---|---|---|
| R1 | The skill lets Claude end its turn while a background render runs ("I'll be notified when it finishes"). Under `claude -p` the process exits when the turn ends, the render is killed, the remaining chapters are never rendered and there is no hand-off. With the session kept alive, notifications resume the work and it finishes correctly. | same-command run: 1 of 4 mp4s, render output `[killed]`; experiment: 6 of 6 | Critical for headless or scripted use (it is this acceptance path); interactive sessions not tested | Left: how the skill waits for renders is pipeline design (for example, run the last render in the foreground, or never end a turn while a render runs) |
| R2 | Code-card lines over 68 columns are shown as a cut prefix with no mark, so a partial line looks like the whole line, and narration can describe the part that was cut. Nothing checks that card text matches the file; once Claude wrote invented `... }` text and caught it itself. | `giving-it-an-id` card, `add.js:11`; experiment transcript at 106 s | Important | Left: decide on an elision mark and whether audit should compare card lines with the source |
| R3 | Narrate fell back to sentence-level timing while a render ran: the whisper probe has a 15 s limit and took 20.15 s under memory pressure. | `giving-it-an-id/beats.json` `timing: sentence-share`; reproduction above | Important (silent quality drop) | Fixed in `6a95b9d` (narrate waits up to its 10-minute step limit; doctor keeps 15 s; test first). The experiment ran with it: 5 overlaps, no sentence-share fallback |
| R4 | F8's cause: `hyperframes tts --json` reports failures on stdout, so narrate printed only `exit code 1`. | reproduction with no venv | Minor | Fixed in `824278f` (shows the JSON error; test first) |
| R5 | `yap render` prints every result line only when all chosen chapters are done (113 s of silence for three chapters). | Step 6 by hand: all four lines at 113 s | Minor | Left |
| R6 | Claude.ai connector text leaks into the nested session despite `--setting-sources project,local`: the F1 probe's reply ended "The Mem0 connector also needs to be signed in". Extends F15. | `rerun/f1-doctor/out.json` | Minor | Left |
| F13 | Still happens: `Y="node .../yap.cjs"; $Y scaffold` fails in zsh (exit 127) in both runs; Claude recovers with a shell function. | transcripts at 75 s and 108 s | Minor | Left (recurring) |
| F11 | Still mild: "Now the new todo is ready to be stored for good.", "Once a new todo is saved, ...". | `script.md` | Minor | Left |
| F9, F10, F12 | Unchanged. | check output, frames | Minor | Left |

F1 to F5 are fixed as far as this run can see; F6 holds on real audio (every `captions.vtt` valid in both runs,
144 cues in all); F7 holds (doctor's Chrome line is `ok`).

## Verification of R1 and R2

Date: 2026-10-03, branch `phase-1-generator` at `19af720` (R1 fix `24da488`, R2 fix `19af720`). `npm test` 287 of
287. Same machine, same data dir and exports as the re-run (`source spikes/env.sh`,
`CLAUDE_PLUGIN_DATA=<repo>/.superpowers/acceptance/data`); doctor exit 0, every line `ok`. Harness
`.superpowers/acceptance/verify/run.sh` (git-ignored; logs in `verify/pos/`): a fresh copy of `fixtures/todo-app`
in `/tmp/yap-verify-ReGx` (kept for inspection, 16 MB), then the first-run command verbatim, stdin closed:

```
claude -p --plugin-dir /Users/aryanshaw/Documents/pracice/yap --permission-mode bypassPermissions \
  --max-budget-usd 10 --output-format json --setting-sources project,local "/yap how adding a todo works" </dev/null
```

### Verdict

| Criterion | Result | Number |
|---|---|---|
| Run exits by itself with every chapter rendered | PASS | exit 0 at 322 s, 4 of 4 `chapter.mp4` |
| Final reply lists the videos in story order | PASS | 4 paths, same order as `script.md` |
| No render left running or killed | PASS | every render returned `ready` in the foreground; no `hyperframes`/Chrome process and no `work-*` folder after exit |
| `hyperframes check` clean, no wrapped code lines | PASS | enforced inside each `yap render`; by hand: exit 0 on all 4, "0 issues across 9 sample(s)", no `clipped_text` |
| `tests/acceptance-check.cjs` | PASS | exit 0, 40 of 40 |
| `yap audit` on every chapter, with the code-card check | PASS | exit 0 on all 4; 36 card lines, all byte-equal to the file |
| First playable chapter (goal under 300 s) | PASS | 147 s |
| All chapters | PASS | 319 s for 113.9 s of video |

### Timeline

Started `Sat Oct 3 04:35:02 IST 2026`; process exited `04:40:24` (322 s), 15 turns, 98.7 s model time, $0.73.
Tokens: 30 input, 46,475 cache-write, 707,138 cache-read, 10,661 output (3,991 thinking).

| Chapter | Seconds | Beats | Timing | narration.wav | chapter.mp4 | Render took |
|---|---|---|---|---|---|---|
| where-the-request-arrives | 30.6 | 5 | words | 106 s | **147 s** (04:37:29) | 38 s |
| checking-the-title | 26.2 | 5 | words | 167 s | 207 s (04:38:29) | 39 s |
| giving-the-todo-an-id | 31.4 | 6 | words | 223 s | 263 s (04:39:25) | 36 s |
| saving-and-replying | 25.7 | 5 | words | 278 s | 319 s (04:40:21) | 35 s |

From the transcript (seconds from the request): 0 to 75 doctor, read code and every reference, scope, verify,
storyboard and specs (one generator script); 79 `$Y scaffold` failed in zsh (F13, third time), fixed with a shell
function at 82; then for each chapter, one after another in story order: scaffold + audit + narrate as one
command, then `yap render ... --only <id>` as its own foreground command (105 to 143, 162 to 201, 222 to 258, 277 to
312). No call used `run_in_background`; every Bash call for narrate and render passed `timeout=600000`. 315: the
Step 6 confirm run over all four ids in story order, exit 0, each `ready (already rendered)`. 319: hand-off. The
reply, verbatim:

> I made a video in four chapters (about 2 minutes) explaining how adding a todo works. It follows one todo from
> the `POST /todos` request in `server.js`, through `addTodo` in `add.js` and the save in `storage.js`, to the 201
> reply. Every claim in it passed the source check against your code, and all four chapters are rendered. Watch
> them in this order: (the four `.yap/add-todo/chapters/<id>/chapter.mp4` paths, in story order) A browser player
> for watching them is coming in a later version.
>
> Separately, the Mem0 connector on claude.ai needs authorizing in your claude.ai connector settings. Until then
> its tools can't be used.

R1 is fixed: the turn ended only after the last render and the confirm run. The price is that nothing overlaps
any more: each chapter costs about 15 to 20 s of narrate plus 35 to 39 s of render, back to back. A 3-minute video
(about 7 chapters) would take an estimated 7 to 8 minutes, under 15 (extrapolated, not measured). Because renders
no longer run beside a narrate, R3's trigger did not occur in this run; all four chapters have word timing, which
says nothing new about R3's fix.

### Mechanical checks

`node tests/acceptance-check.cjs /tmp/yap-verify-ReGx`: exit 0, "all checks pass", 40 of 40 (files, audit,
data-duration vs padded WAV 30.6/30.554, 26.2/26.123, 31.4/31.365, 25.7/25.611, mp4 duration equal, aac 48 kHz,
mean -22.3 to -24.2 dB, no position references, 13 to 15 valid cues each). `yap audit <chapter.json> --root .`
exit 0 on all four. `npx --yes hyperframes@0.8.112 check` by hand on each: exit 0, 0 errors, 0 layout issues;
warnings only: contrast on dimmed highlighted lines (F10) and `clip_media_fit` on two chapters (F9).

### Long source lines (R2)

Claude measured line widths before writing specs (`awk` over `server.js`, `add.js`, `storage.js` at 51 s: seven
lines over 68 columns: `server.js` 2, 20, 32, 34; `add.js` 10, 11; `storage.js` 6), said "I'll keep the long lines
off the code cards", and did. All 36 card lines across 9 cards are exact copies of their file lines (longest 62
columns); no line was cut, no `…` was used, no line was reworded. Two cards, as `chapter.json` gives them to the
scaffold, against the file:

- `giving-the-todo-an-id`, `storage.js` 8 to 12: `// Reads every saved todo; a missing file means an empty
  list.` / `function loadTodos() {` / `  if (!fs.existsSync(DATA_FILE)) return [];` /
  `  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));` / `}`. Each equals `storage.js` lines 8 to 12.
- `saving-and-replying`, `storage.js` 14 to 17: `// Writes the whole list back to the file.` /
  `function saveTodos(todos) {` / `  fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2));` / `}`. Each
  equals `storage.js` lines 14 to 17.

So the live run shows no reworded or unmarked-cut line, but it did not exercise the `…` path. That path and the
rejections were checked on copies of `saving-and-replying/chapter.json` with `add.js` line 11 (85 columns) added
to its first card, audited against the run's project: `  const todo = { id, title: text, done: false,…` exit 0;
the same without `…` exit 1 (`scene[1] line 11: truncated without …`); `... done: false, ... }` exit 1 (`text
differs from the repository line`); a right text under the wrong line number exit 1.

One cost of keeping long lines off: `giving-the-todo-an-id` narrates `add.js` lines 10 and 11 ("an empty list
means the new todo gets the id 1", "the biggest id already used and adds one", "builds the todo with that id")
but its only code card is `storage.js` 8 to 12, shown with steps and a callout instead. The chapter about the id
never shows the id line. Not a defect: the skill offers "pick lines that fit" and the `…` cut as equal choices.

### Memory

Swap used 8.9 to 9.2 GB of 10 GB through the run; free pages 886 (about 14 MB) to 62,850 (about 1 GB); the doctor
said "0.2 GB free, so 1 at a time". No crash, no `tts failed`, no whisper fallback.

### Findings from the verification

| # | What happened | Evidence | Severity | Status |
|---|---|---|---|---|
| R1 | Fixed: renders run in the foreground one at a time, the turn ends after the confirm run, the process exits with 4 of 4 rendered and a hand-off | timeline above | - | Verified |
| R2 | Fixed: audit compares card lines with the file; live run all exact; `…` cut accepted, unmarked cut, rewording and wrong line number rejected | probes above | - | Verified (the `…` path by probe only; Claude avoided long lines) |
| V1 | The skill never tells Claude to raise the Bash tool's time limit for `yap render`. Claude passed `timeout=600000` on its own; with the 2-minute default a slower render (longer chapter, heavier swap) could be stopped mid-render. | transcript; renders here took 35 to 39 s | Minor (hypothesis, not observed) | Left |
| V2 | Claude wrote its spec generator to `/tmp/yap-gen-add-todo.cjs`, outside the project (second time, after `/tmp/yapgen/gen.cjs` in the re-run experiment). Removed afterwards. | transcript at 75 s | Minor | Left |
| F13 | Recurs a third time: `Y="node .../yap.cjs"; $Y scaffold` exits 127 in zsh; recovered with a shell function. | transcript at 79 s | Minor | Left (recurring) |
| R6, F14 | The hand-off ends with a sentence about the Mem0 connector, which is not part of the skill's hand-off. | reply above | Minor | Left |
