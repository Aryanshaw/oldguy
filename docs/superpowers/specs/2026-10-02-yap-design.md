# Yap — Claude yaps, you watch

Status: design, approved by the owner on 2026-10-02 and amended on 2026-10-03 with the Phase 0 results (`docs/spikes/SUMMARY.md`). Date: 2026-10-02.

## 1. What this is

Yap is a Claude Code skill (shipped as a plugin from a GitHub repo) that turns
"explain how X works in this codebase" into a short narrated video, then lets the
viewer ask follow-up questions from a browser player. Simple questions get a text
answer. Complex questions become new chapters that are added to the video.

It runs entirely on the user's machine and on the user's own Claude tokens. There is
no server we host and no account.

### Why it exists

People new to a codebase will not read a long plan, spec or README, but they will
watch a three-minute video. Yap makes the video, and keeps it honest: every claim on
screen is checked against the code first.

### Who it is for

Anyone who has to understand a feature in a codebase they did not write: new
joiners, reviewers, product people, and a developer approving a plan Claude wrote.

### Product positioning (agreed with the owner)

- Claude still does the planning and the work. Yap is the **review surface**: the
  human watches the video to understand the plan or feature, then approves or asks.
  It does not replace the written plan. The verified `script.md` stays the source of
  truth; the video is how a human reads it.
- Tied to Claude Code on purpose. Other agents are out of scope.

## 2. Goals and success criteria

1. A first draft of a 2–3 minute video is playable within 5 minutes of the request.
2. A full-quality 3-minute video finishes within 15 minutes.
3. Every claim in a caption or narration line points to a file and line that exist and
   contain what the line says. A chapter that fails this check is not published.
4. A question asked in the player becomes a finished chapter in under 3 minutes and
   does not re-render any other chapter.
5. After the first message, the viewer never has to go back to the terminal.
6. Export gives one MP4 plus the verified script and sources.

## 3. Non-goals for v1 (decided)

- Podcast or reel formats, named characters, and voice cloning (v2). v1 has one
  format: the walkthrough, narrated with a normal synthetic voice, captions always on.
- Agents other than Claude Code.
- Hosting, accounts, multi-user sessions, sharing links.
- Drag-to-reorder in the player (reordering is done by asking Claude in the chat).
- The "code changed since this video" warning. v1 only records the commit.

## 4. Architecture

```
Claude Code session (the brain)             Browser (the viewer)
  skill: scope, read, verify, storyboard,     player (React, prebuilt)
         scenes, narrate, render                video + timeline + chat/sources
  Monitor ── tail events ◄───────┐                    │ chat, buttons
  bin/yap.cjs ── API calls ───►│                    ▼
                              local server (Node, zero deps, 127.0.0.1)
                              serves player + chapter MP4s, owns manifest
                                     │
                                     ▼
                  .yap/<slug>/   manifest.json, script.md, sources.json,
                                   chapters/<id>/, state/events.jsonl, state/thread.jsonl
```

### 4.1 One folder per video: `.yap/<slug>/`

```
script.md                 verified script (source of truth for humans and Claude)
sources.json              every cited file:line, with the quoted text
manifest.json             ordered list of chapters (see 4.2); only the server writes it
chapters/<id>/            id is stable and has no number in it
  scene.html              the chapter's **standalone root composition** with its own
                          `data-duration` (a sub-composition fragment cannot be rendered alone)
  narration.txt  narration.wav  captions.vtt  captions.json (word timings)
  chapter.mp4  poster.jpg
  sources.json            sources used by this chapter
state/events.jsonl        browser → Claude, one JSON object per line
state/thread.jsonl        Claude → browser, replies shown in the chat
```

### 4.2 `manifest.json`

```json
{
  "version": 1,
  "title": "How a background job runs",
  "slug": "job-flow",
  "audience": "beginner",
  "verified_against_commit": "abc1234",
  "chapters": [
    {
      "id": "ch-intro",
      "title": "The problem",
      "parent_id": null,
      "placement_reason": "core",
      "status": "ready",
      "quality": "full",
      "duration_s": 24.6,
      "video": "chapters/ch-intro/chapter.mp4",
      "poster": "chapters/ch-intro/poster.jpg",
      "captions": "chapters/ch-intro/captions.vtt",
      "question": null
    },
    {
      "id": "ch-worker-dies",
      "title": "What if the worker dies halfway?",
      "parent_id": "ch-worker-claim",
      "placement_reason": "follow-up to ch-worker-claim",
      "status": "rendering",
      "quality": "draft",
      "duration_s": null,
      "question": "what happens if the worker dies halfway?"
    }
  ]
}
```

Rules:

- **Order is the array order.** Nothing else encodes order. Moving or inserting a
  chapter is a manifest edit; no files are renamed and nothing is re-rendered.
- **Claude decides where a new chapter goes.** A follow-up to an existing chapter goes
  next to its parent (`parent_id` set). An independent topic goes at the end.
- **Timestamps are computed**, never stored: the player adds up durations in order.
- **Chapters stand alone.** Narration and captions may not refer to neighbours by
  position or time ("last chapter", "next", "at 1:30"). A chapter may open with a
  one-sentence intro. This keeps insertion safe.
- `status`: `rendering`, `ready`, `failed`. `quality`: `draft` or `full`.

### 4.3 Local server

A zero-dependency Node file, bound to `127.0.0.1`, with a random session key in the URL
and a cookie, exactly like the superpowers brainstorming companion. State is files, so
a restart loses nothing.

| Endpoint | Used by | Purpose |
|---|---|---|
| `GET /` | browser | the player |
| `GET /api/state` | browser | manifest + thread |
| `GET /api/stream` (SSE) | browser | live updates |
| `POST /api/message` | browser | append a chat message or button event to `events.jsonl` |
| `GET /chapters/:id/video` | browser | chapter MP4; **HTTP range requests are required** (instant seeking) |
| `POST /api/export` | browser | export to a folder the user picks |
| `POST /api/reply` | Claude | add an answer (text + sources) to the thread |
| `POST /api/chapters` | Claude | add, reorder, or update the status of a chapter |
| `POST /api/heartbeat` | Claude | "a live session is listening" |

The **server is the only writer of `manifest.json`**, and writes it atomically (temp
file, then rename). Claude never edits the manifest directly.

Claude talks to the server through one bundled script, `bin/yap.cjs`
(`yap reply`, `yap add-chapter`, `yap set-status`, `yap listen`), so the user
approves one command instead of many `curl` calls.

### 4.4 Event format (`state/events.jsonl`)

```json
{"id":"evt_12","ts":"2026-10-02T10:01:00Z","type":"message",
 "text":"why does the worker claim the job first?",
 "context":{"chapter_id":"ch-worker-claim","t":12.3}}
```

Other `type`s: `make_video` (button under a text answer), `just_text` (button under a
chapter in progress), `retry_chapter`, `export`. Every event carries the playback
context (which chapter, which second), so Claude knows what the viewer was looking at.

### 4.5 The bridge: Claude ↔ browser

1. After the video is generated, the skill starts the server and runs `yap listen` under Claude Code's
   **Monitor** tool. `yap listen` tails `events.jsonl` with `tail -n 0 -F` (plain `tail -F` replays the last 10
   lines when it starts) and posts a heartbeat every 5 seconds. Each new line wakes Claude within about a second,
   even from idle (spike 7).
2. **A Monitor lives at most 30 minutes.** The skill re-arms it every time the expiry notice arrives. Events written
   in the short gap are not lost: every event has an `id` (4.4), `yap listen` resumes from the last id Claude
   acknowledged, and Claude replays any unacknowledged lines. While the player is open this costs one small turn
   every 30 minutes plus one turn per question. Whether to use Monitor's `ws` source (the server pushes events over a
   WebSocket) instead of a file tail is decided in Phase 4; it has the same 30-minute cap.
3. Claude reads the event, decides **text or chapter**, and acts (4.6).
4. **Fallback (automatic).** If the server sees no heartbeat for 15 seconds, it answers the queued event by running
   `claude -p --resume <session-id> --fork-session --max-budget-usd <generous cap> "<message>" --output-format json </dev/null`
   from any folder. It always uses a **fork**, never a plain resume (a plain resume appends to the original
   transcript and would collide with a live session), and it closes stdin (`</dev/null`) or the call stalls 3 seconds
   and prints a warning. The user's own Claude tokens pay for it; **no cost is shown anywhere in Yap** (owner's
   decision), so the cap exists only as a safety limit and is configurable. If the headless call fails, the chat shows
   "Claude isn't connected: run `/yap resume` in Claude Code". Queued messages are never lost.
5. **Session id.** A `SessionStart` hook (`hooks/hooks.json`) writes `{session_id, transcript_path, cwd}` to
   `.yap/session.json` on every `startup` and `resume`, so the server always knows the live session id.

### 4.6 Answering a question: text or chapter

- **Text answer**: a question about one fact ("what does `register()` do?"). The reply
  includes file:line citations, which also fill the Sources tab. A **Make this a
  video** button sits under it.
- **New chapter**: a question about order, timing, failure, or how pieces interact
  ("what if the worker dies halfway?"). Claude tells the viewer in the chat, runs the
  generation steps (5) for one chapter, and adds it. A **Just text** button sits
  under the chapter while it renders.
- Claude's routing rule is written in the skill's `references/ask-loop.md`. The viewer
  can always override with the two buttons.
- Every new chapter's narration is checked against the code before it renders, exactly
  like the original chapters.

### 4.7 The player (React + Vite, built once, `dist/` committed)

- **Layout** (owner chose option B): large video; a **timeline** under it; a right
  panel with two tabs, **Chat** and **Sources**. The chapter list does not take panel
  space.
- **Timeline**: a segmented bar, one segment per chapter, like YouTube chapters.
  Hovering a segment shows the chapter title and its poster frame. A chip next to the
  time shows the current chapter's name. A follow-up chapter has a slightly different
  tint next to its parent. A chapter that is rendering is a **yellow segment with a
  ⏳**, then turns green. A failed chapter is red with a retry button. Clicking any
  segment jumps to it, and earlier chapters stay playable while a new one renders.
- **Chat tab**: messages, answers, the two buttons, and a "Claude isn't connected" state.
- **Sources tab**: the file:line references for the current chapter and for any answer.
- **Export** button: asks the server to write the final files (4.9).
- Playback of several MP4s as one video: two `<video>` elements; the player preloads the next chapter into the idle one
  and switches on `ended`. Measured gap: 20 to 35 ms (about one frame), seeks 23 to 90 ms (spike 6). Each chapter's
  narration WAV starts and ends with a few milliseconds of silence so the audio does not click at a join; an
  audio-continuity check is part of the player tests.
- The player source lives in `player/`; the built bundle in `player/dist/` is committed
  and a CI check fails if they differ. Users never run a build.

### 4.8 Where Yap shows a browser

- **Watching the player**: the user's default browser (the server opens the URL).
- **Rendering frames**: Hyperframes' own pinned Chrome (`hyperframes browser ensure`
  downloads it). The pin exists because pixel output drifts across Chrome versions.

### 4.9 Export

The server joins the chapters in manifest order with ffmpeg and writes, to a folder the
user picks: `<slug>.mp4`, `script.md`, `sources.json`. If some chapters are still
`draft`, export offers to wait for the full-quality render or to export drafts.

### 4.10 House style (v1 default)

- **Look:** retro yellow, orange and black, for the player and as the scene kit's
  default palette. The chapter segments, the pending ⏳ block and the buttons all use
  it. The palette is a theme file, so a user can swap it.
- **Voice:** polite, cheery and efficient. It explains hard ideas in short, digestible
  chapters, like a friendly retro helper. The narration prompt in
  `references/narrate.md` carries this tone.
- **Mascot:** an original retro character with its own silhouette (for example a
  wind-up alarm clock). In v1 it is a logo and an optional corner badge only. It must
  not copy any existing character. A speaking, animated host is a v2 idea.
- **Brand line:** "Claude yaps. You watch."

### 4.11 Setup: the installer (v1)

The generic `skills` installer (`npx skills add`) only copies skill files: it cannot run setup or install
dependencies, and it has no hooks. Yap therefore ships its own small installer, run as `npx yap-setup` (final name
to be decided), with an interactive checklist like the one `skills` shows:

1. It checks what is already present: Node 22+, a **working** ffmpeg, Hyperframes, a usable Python, free disk and RAM.
2. It shows the prerequisites as a list the user ticks, each with its size, and installs **only what is ticked**:
   - Voice: a Python venv Yap creates under its own folder with `kokoro-onnx` and `soundfile` (about 130 MB) plus
     the Kokoro model (353 MB). Pre-ticked.
   - Word-by-word captions (pre-ticked): `whisper.cpp` through Homebrew on macOS, plus the 487 MB `small.en` model.
     The screen says plainly that Homebrew will install `whisper.cpp` and its dependencies. Nothing else may trigger
     that install silently (in Phase 0 `hyperframes transcribe` did it unprompted).
   - Fix a broken ffmpeg when one is found (for example a Homebrew build that cannot load `libx265`).
3. It registers the plugin with `claude plugin install` (the command exists; its use with Yap is tested in Phase 1) and
   runs the doctor to confirm.

The plugin route is the supported one because only a plugin can carry the `SessionStart` hook (spike 5). The
`npx skills add` route still works but has no hooks, so the doctor runs on first use of `/yap` and the session id comes
from the newest transcript in the project folder. The doctor is also reachable as `/yap doctor`.

## 5. Generating a video (the skill's workflow)

The skill is one `SKILL.md` that orchestrates the steps below; each step's detail is in
`references/` so the main file stays short.

1. **Doctor** (from the installer, from `/yap doctor`, on first use, and again after any render failure; a fast
   `SessionStart` hook only prints a one-line hint until the full doctor has passed, using a marker file in
   `${CLAUDE_PLUGIN_DATA}`): checks Node, `hyperframes doctor --json` (gate on `.ok`), `hyperframes browser ensure`, that
   `ffmpeg -version` actually runs, the Yap Python venv and the Kokoro model, `whisper-cli` (for word-level captions),
   and **at least 1 GB of free disk** (Hyperframes' own cache reached 1.0 GB in Phase 0). It prints the exact fix for
   anything missing and never installs system packages itself; the installer does that, with consent. It does **not**
   install the Hyperframes domain skills: like `brag`, `SKILL.md` lists the ones it needs (`hyperframes-core`,
   `-animation`, `-creative`, `-keyframes`, `-cli`) in its "Read:" lines, and on first use Claude installs any that are
   missing with the Hyperframes `skills` subcommand (confirmed from the owner's first `brag` run).
2. **Scope**: the viewer names a feature. Claude narrows it to one flow, asks at most
   one question if it is ambiguous, and sets the length (default 2–3 minutes) and the
   audience (beginner).
3. **Read and verify**: Claude reads the code and writes `script.md` and
   `sources.json`. Every claim has a file:line.
4. **Storyboard**: a list of chapters of 20–40 seconds, each with narration text and
   the scene-kit pieces it will use.
5. **Scenes from the scene kit**: `scene-kit/` holds ready HTML/GSAP pieces: swim lanes,
   table cards, packets moving along wires, callouts, step lists, before/after, and a
   **code card** that highlights the exact lines. Claude fills pieces in; it does not
   invent layout from scratch. (In the prototype video, scenes 1–4 took 12.8 minutes
   while the helpers were being invented, and scenes 5–7 took 3.4 minutes once they
   existed.)
6. **Narration and timing**: Kokoro via `hyperframes tts` (with `HYPERFRAMES_PYTHON` set to Yap's venv), one WAV per
   chapter, written **one sentence per beat**. Beat and caption timing come from `hyperframes transcribe` (word-level,
   accurate to about 0.12 s, spike 3), which is part of v1 setup. If whisper is not installed, the fallback is the
   WAV's exact duration shared across sentences by character count (error about 0.3 s) and sentence-level captions.
   Captions are always on. Generated WAVs are cached by a hash of their text, so an edited chapter does not redo
   untouched ones.
7. **Gates per chapter**: `hyperframes check`; **dense snapshots around moving parts**
   (the prototype's overlapping packets were only found after a full render); and the
   **claim audit**: every captioned claim's file and line must exist and contain the
   quoted text.
8. **Render, draft first**: each chapter renders at `--quality draft`, **up to 3 chapters at once**, each with an explicit
   `--workers 2` (never `--workers auto`: on a low-memory machine Hyperframes pins itself to 1 worker). The cap is
   `max(1, min(3, floor(free_RAM_GB - 2)))` and the user can raise it. Measured on an 8 GB laptop, three chapters at once
   took about 0.4 of the time of rendering them one after another (spike 2). Each chapter is registered with the server
   as soon as it is ready so the viewer can start watching. A `delivery`-quality render then runs in the background
   and replaces the draft; `quality` flips to `full`.
9. **Open the player**: start the server, open the default browser, set up Monitor.

## 6. Failure handling

- **Render fails** (Chrome, ffmpeg, memory): the chapter is `failed` with a one-line
  reason and the fix command; other chapters are unaffected; there is a retry button.
  A failed render is retried with one chapter at a time before the chapter is marked `failed`.
- **Claim audit fails**: the chapter is not published. Claude fixes the narration or
  removes the claim. Nothing unverified is shipped silently.
- **Claude session gone**: messages stay queued; the automatic headless fallback answers, or the chat shows "not connected" (4.5).
- **Server crash**: all state is files; restart and continue.
- **Code changed later**: each chapter records the commit it was verified against.
  The warning UI is v2.

## 7. Security

- Server bound to `127.0.0.1`; random session key in the URL, remembered in a cookie.
- Only the server writes `manifest.json`.
- Chat text is the user's own input. Text Claude reads from the repository while
  verifying is treated as data, never as instructions.
- Export writes only into the folder the user chose.
- The installer changes nothing on the user's machine (no Homebrew, no pip, no downloads) except the items the user ticked.
- `.yap/` is added to `.gitignore` guidance in the README.

## 8. Testing

- Unit tests (plain Node): manifest operations (insert, reorder, atomic write, computed
  timestamps), claim audit, event queue and heartbeat, `yap.cjs` commands.
- Server contract tests for every endpoint in 4.3.
- Player: component tests, plus one end-to-end test with a tiny fixture video.
- Doctor: tested with mocked missing and broken dependencies.
- A full "generate a video from a small fixture repo" run needs a real render, so it
  runs locally or nightly, not on every pull request.

## 9. Spikes (answered in Phase 0)

All seven were run on 2026-10-02; results are in `docs/spikes/` and summarised in `docs/spikes/SUMMARY.md`.

| # | Question | Verdict | Where it landed in this spec |
|---|---|---|---|
| 1 | Resume a closed session headlessly | PARTIAL | 4.5 point 4 (fork, `</dev/null`, any folder) |
| 2 | Parallel chapter renders | PASS | 5.8 |
| 3 | Narration timing | PARTIAL | 5.6 (whisper in v1 setup, sentence-share fallback) |
| 4 | Kokoro free, local, keyless | PASS | 4.11, 5.1, 11 |
| 5 | Install-time hook | PARTIAL | 4.5 point 5, 4.11, 5.1 (`SessionStart` hook; no install hook) |
| 6 | Gap between chapter videos | PASS | 4.7 |
| 7 | Monitor over a long idle | PARTIAL | 4.5 points 1 and 2 (30-minute cap, re-arm) |

Not run as written (needed the owner present): laptop sleep with a Monitor armed, and a listening check of audio across
chapter joins. Both are tested in Phase 1 or 4.

## 10. Repository layout

```
yap/
  .claude-plugin/ plugin.json
  hooks/hooks.json  session-start.sh   SessionStart: doctor hint + writes .yap/session.json
  installer/        the `npx yap-setup` checklist installer (4.11)
  skills/yap/SKILL.md
  skills/yap/references/  scope.md verify.md storyboard.md scene-kit.md
                            narrate.md render.md ask-loop.md doctor.md
  scene-kit/                reusable HTML/GSAP pieces
  server/server.cjs
  bin/yap.cjs
  player/  src/  dist/      dist/ is committed
  docs/    examples/        a demo video made by Yap, made about Yap
  README.md  LICENSE
```

## 11. Dependencies and assumptions

- Claude Code (Monitor tool, skills, plugins, hooks), Node 22+, a working ffmpeg, Hyperframes (CLI via `npx`; its domain
  skills install on first use as in section 5, step 1).
- For narration: Python 3 with `kokoro-onnx` and `soundfile` in a venv Yap creates (about 130 MB) and a one-time 353 MB
  voice model. For word-level captions: `whisper.cpp` (Homebrew on macOS) and a one-time 487 MB model. Free disk of
  about 1 GB or more. All free and local; the voice works with no network after the download.
- The user's own Claude tokens pay for everything, including the background fallback. **Yap shows no cost anywhere**
  (owner's decision). A prototype video took about 44 minutes; the scene kit, draft-first rendering and parallel
  chapters are what bring that down, and real timings are measured in Phase 1.
- Name: **Yap** (owner's choice: a Gen Z word for talking a lot, which is exactly what Claude does in the video). Domain: `justyap.dev` or `justyap.io` (`justyap.com` and every `yap.*` are taken; checked 2026-10-02, not yet bought).

## 12. Out of scope, listed so nobody builds it by accident

Podcast/reel formats, characters, voice cloning, other agents, hosting, sharing,
drag-reorder, stale-code warning, accounts.

## 13. Build phases (agreed with the owner)

One spec, but not one plan. Each phase gets its own short plan, written just before it
starts, because earlier phases change what later ones need.

| Phase | Result | Why this order |
|---|---|---|
| 0. Spikes | Pass/fail answers to the 7 items in section 9 | Two can change the design: the `claude -p --resume` fallback and parallel chapter renders |
| 1. Generator | One verified, narrated, draft-rendered chapter from a feature request | The core value; everything else wraps it |
| 2. Chapters and server | Several chapters in a manifest, served locally, with API and tests | The data model the player needs |
| 3. Player | Browser UI: timeline, tabs, pending segment, export | Worth building only once real chapters exist |
| 4. Chat bridge | Browser questions become answers and new chapters | Riskiest and most novel, so it comes after the parts it needs are proven |
| Polish | README, a demo video made by Yap about Yap, the doctor | Last |

---

## 14. Amendments of 2026-10-03 (from Phase 1)

The owner approved amendments A1 to A9 on 2026-10-03. They supersede the sections they name; the accepted text above is left as written.

### A1. Section 4.1, the chapter folder

Current:

```
chapters/<id>/            id is stable and has no number in it
  scene.html              the chapter's **standalone root composition** with its own
                          `data-duration` (a sub-composition fragment cannot be rendered alone)
  narration.txt  narration.wav  captions.vtt  captions.json (word timings)
  chapter.mp4  poster.jpg
  sources.json            sources used by this chapter
```

Proposed:

```
specs/<id>.json           the spec Claude hands to `yap scaffold`, one per chapter
chapters/<id>/            id is a stable slug with no number in it
  chapter.json            id, title, sources (file, lines, quote), sentences (claim|framing, source_ids), scene
  narration.txt           the sentences joined by one space
  narration.wav           16-bit 24 kHz mono, 40 ms lead and 120 ms tail silence
  beats.json              one timed beat per sentence; timing "words" or "sentence-share"
  captions.vtt  captions.json (word timings)
  index.html              the chapter's **standalone root composition** with its own
                          `data-duration` (Hyperframes renders a folder whose root page is index.html)
  build.json              v2 fingerprint of the audited text, its commit and the six built files
  chapter.mp4             present only after a successful render
  render.json             the build.json hash the video was rendered from
```

And drop `poster.jpg` from 4.1 and from the manifest example in 4.2 (`"poster"`), or mark it "produced by
Phase 2". Phase 1 does not make posters. The per-chapter `sources.json` is folded into `chapter.json`; the
slug-level `sources.json` stays.

### A2. Section 4.2, `verified_against_commit` per chapter

Current (manifest example): `"verified_against_commit": "abc1234",` once per video.

Proposed: keep the field, but state that its source is each chapter's `build.json`
(`verified_against_commit`, full 40-character id or `null` when the project is not a git repo or `--root` was
not given), and that chapters made at different times may carry different commits. Add to the chapter entry:
`"verified_against_commit": "<40 hex or null>"`.

### A3. Section 4.5 point 5, `session.json`

Current: "writes `{session_id, transcript_path, cwd}` to `.yap/session.json` on every `startup` and `resume`".

Proposed: "writes `{session_id, transcript_path, cwd, source, data_dir, updated_at}` to `.yap/session.json` on
every `startup` and `resume`. `data_dir` is the plugin data folder Claude Code gave the hook
(`CLAUDE_PLUGIN_DATA`), or `null` when that folder is not inside `<config>/plugins/data/`. Every `yap` command
reads `data_dir` from the nearest `session.json` above the working folder when the variable is not in its own
environment, because Claude Code sets it for hooks but not for Claude's shell (measured, Phase 1)."

### A4. Section 5 step 1, the Hyperframes skills

Current: "It does **not** install the Hyperframes domain skills: like `brag`, `SKILL.md` lists the ones it
needs (`hyperframes-core`, `-animation`, `-creative`, `-keyframes`, `-cli`) in its "Read:" lines, and on first
use Claude installs any that are missing with the Hyperframes `skills` subcommand".

Proposed: "Yap ships no Hyperframes skills and never sends Claude to look for one. The exact pinned commands it
needs (`npx --yes hyperframes@<version> check|snapshot|render|tts|transcribe`) are written inline in
`references/render.md` and `narrate.md`." (In Phase 1 a reference to an unshipped skill made Claude search the
whole disk for 51 s.)

### A5. Section 5 steps 5 to 8, the per-chapter pipeline

Current step 7 and 8 (summarised): gates per chapter (`hyperframes check`, dense snapshots, claim audit), then
"each chapter renders at `--quality draft`, up to 3 chapters at once ... Each chapter is registered with the
server as soon as it is ready ... A `delivery`-quality render then runs in the background".

Proposed replacement for steps 5 to 8:

- "**Scenes.** Four kit pieces in v1: `title`, `steps`, `code-card`, `callout`. A code card holds at most 68
  columns per line (a tab counts 4) and never wraps; a longer line is shown as a prefix ending in a visible
  `…`. The audit checks every card line against the repository, exactly like a quote."
- "**Per-chapter pipeline, in story order.** For each chapter: scaffold, audit, narrate, then render as a
  blocking foreground step before the next chapter starts. The first chapter is playable within about 150 s on
  an 8 GB machine (measured). Claude never ends its turn while a render runs, and gives narrate and render a
  10-minute command limit."
- "**Check gate.** `yap render` runs `hyperframes check` on every chapter it is about to render and refuses the
  chapter on any layout error; the skill does not get to render around it. Dense snapshots are a manual
  tool for Claude, not a gate."
- "**Render.** Draft quality, `--workers 2`, one chapter at a time in v1. The scheduler still supports a cap
  of up to 3 with one lone retry, but the skill does not use it, because overlapping narrate and render on an
  8 GB machine starved whisper and because a background render dies with a headless session. Whether Phase 2's
  server restores overlap is an open decision. A `delivery`-quality re-render is deferred past Phase 2."
- Drop "Generated WAVs are cached by a hash of their text" from step 6; Phase 1 caches at the render level
  (`build.json` and `render.json`), and narrate always re-speaks.

### A6. Section 5 step 6 / 5.6, captions

Current: "Captions are always on."

Proposed: "Captions are written as files (`captions.vtt`, `captions.json`) and are part of the build fingerprint.
They are not burned into the mp4. Whether and how the player shows them (on by default, toggle) is decided in
Phase 3." Today, a viewer of the raw mp4 sees no captions.

### A7. Section 6, failure handling

Add two bullets:

- "**Chapter changed after narrate** (any of `chapter.json`, `narration.txt`, the wav, beats, captions or
  `index.html`): `yap render` refuses it with a one-line redo instruction. The only recovery is fix the spec,
  delete the folder, scaffold, audit, narrate again. Claude never edits those files in place."
- "**Layout check fails** (`hyperframes check` reports clipped or overflowing text or a runtime error): the
  chapter is `failed` with the check's first output line; the old video, if any, is kept; nothing renders until
  the spec is fixed."

And refine "Code changed later": "each chapter's `build.json` records the commit it was verified against (HEAD
of `--root` at narrate time; a dirty working tree is not detected in v1)."

### A8. Section 4.1 / 4.2, machine-readable story order (new)

Current: order lives only in the manifest, which only the server writes; in Phase 1 it lives in `script.md`
prose and in the order Claude passes to `--only`.

Proposed: "The skill writes `.yap/<slug>/order.json`: `{"chapters": ["<id>", ...]}` in story order, before the
first scaffold, and rewrites it when a chapter is added. Phase 2's server seeds the manifest's chapter order
from it and then owns the order." (Alternative, if the owner prefers one file: an `order` list at the top of
`sources.json`.) Without this, Phase 2 would have to parse `script.md` headings.

### A9. Section 10, repository layout

Current: `hooks/hooks.json  session-start.sh`. Actual: `hooks/session-start.cjs` (Node, not shell). And the
`lib/` and `scene-kit/` folders plus `tests/` and `fixtures/` should be listed as they exist.

### Phase 2 additions

- Manifest chapter `status` values are `pending | rendering | ready | failed | stale`. `pending` = scaffolded or narrated, not rendered yet; `stale` = a video exists but no longer matches the audited build.
- Manifest row fields `build_sha256` and `verified_against_commit`; order = array position (story index), so no stored `story_index` field is needed.
- `claude_connected` in `GET /api/state`.
- `GET /api/state` `thread` = viewer messages (from `events.jsonl`) merged with Claude's replies (from `thread.jsonl`) in time order.
- `state/server.json` holds `url`, `key`, `port`, `pid`, `started_at`; file mode 0600.
- The placeholder page at `GET /` (replaced by the real player in Phase 3).

---

## 15. Amendments of 2026-10-03 (from Phase 3)

Amendments A10 to A17 come from the Phase 3 spec (`2026-10-03-phase-3-player-design.md`), sections 9 and 10. They are copied as written there, except A14, which is reworded to point at both places that define the looks. Section numbers inside an amendment name the section of this spec it changes; "point 1" in A17 names the numbered point of Phase 3 spec section 10. They supersede the sections they name; the accepted text above is left as written.

- **A10, section 4.7.** Add: "Styling uses Tailwind and shadcn/ui components restyled to
  the house look. The player's dependencies live in `player/package.json`; the repository
  root stays free of runtime dependencies."
- **A11, section 4.7.** Replace "then turns green" with "then takes the normal ready
  look". The player uses no green.
- **A12, section 4.10.** Add cream `#FFF1CC` as the player's page ground and white as its
  panel ground. The look is Neo-Brutalism: 3px black borders, hard offset shadows, flat
  colour.
- **A13, A6 follow-up.** Captions are shown by the player as an overlay, on by default,
  with a toggle. This closes the question A6 left to Phase 3.
- **A14, section 4.7.** Add the `pending`, `stale` and `draft` looks from section 4.1 and section 10 point 4 of the Phase 3 spec.
- **A15, section 4.9.** "A folder the user picks" becomes "a folder the user names as an
  absolute path in the export dialog".
- **A16, section 4.10.** The logo is the speech bubble with a play triangle plus the
  tilted "yap" block. The alarm-clock mascot stays a corner badge and needs a redraw
  before release; the current drawing reads as a bear. Not blocking Phase 3.
- **A17, parent spec section 4.3.** Add the two routes of point 1 to the endpoint table.

## 16. Amendments of 2026-10-07 (from Phase 4)

From `2026-10-07-phase-4-chat-bridge-design.md` section 9, word for word.

- **A18 (4.5):** the bridge is `yap listen` under Monitor, printing open events then following; open = no reply and
  no ack. The headless fallback (step 4) and the `/yap resume` message are removed.
- **A19 (4.6):** ask first: text always, a chapter only on "Make this a video", which Claude offers per answer.
  New chapters are built by background subagents; Claude chooses their place and whether they run in parallel.
- **A20 (4.3):** new route `POST /api/ack`; `make_video` events carry `ref`; replies may carry `offer_video`.
- **A21 (lifetime):** the server lives only as long as the Claude Code session that started it.

## 17. Amendments of 2026-10-07 (from Polish)

- **A22 (4.11, installer):** there is no separate `npx yap-setup` package. `yap setup` prints what is missing (each
  item with its size and the exact programs it runs) and `yap setup --install <items>` installs only the items the
  user agreed to: `voice` (venv and Kokoro model), `captions` (whisper.cpp through Homebrew, macOS only) and `chrome`.
  ffmpeg, Node and disk stay manual. The plugin installs with `/plugin marketplace add Aryanshaw/yap` then
  `/plugin install yap@yap`. Hard rule 5 of the skill now allows `yap setup --install` after the user's explicit yes.
- **A23 (A16, mascot):** the alarm clock is redrawn so it no longer reads as a bear, as a placeholder: the owner
  plans an original character of their own for the logo and mascot (`docs/STATUS.md`).
- **A24 (updates A22):** the terminal installer exists after all, as the npm package `getyap` (after the planned
  domain getyap.dev), built in `packages/getyap/`. `npx getyap` installs or updates the plugin through
  `claude plugin marketplace add|update` and `claude plugin install|update`, then shows `yap setup`'s list from the
  installed plugin as a terminal checklist and installs only the ticked items (`--yes` takes all). It is plain
  JavaScript because Node does not run TypeScript from `node_modules`. `yap setup` stays the route from inside
  Claude Code.
