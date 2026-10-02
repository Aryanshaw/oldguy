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
