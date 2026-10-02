# Yap — Claude yaps, you watch

Status: design, awaiting owner review. Date: 2026-10-02.

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
  scene.html              the Hyperframes composition for this chapter
  narration.txt  narration.wav  captions.vtt
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
| `GET /chapters/:id/video` | browser | chapter MP4, with range requests |
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

1. After the video is generated, the skill starts the server and runs
   `yap listen` under Claude Code's **Monitor** tool. It tails `events.jsonl` and
   posts a heartbeat every 5 seconds. Each new line wakes Claude. Idle cost is zero.
2. Claude reads the event, decides **text or chapter**, and acts (4.6).
3. **Fallback.** If the server sees no heartbeat for 15 seconds, it starts
   `claude -p --resume <session-id>` to answer the queued event, so the viewer is not
   stuck. This depends on a spike (section 9). If the fallback is unavailable, the chat
   shows "Claude isn't connected: run `/yap resume` in Claude Code". Queued messages
   are never lost; they stay in `events.jsonl`.

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
- Playback of several MP4s as one video: the player preloads the next chapter and
  switches without a visible gap. (Checked in a spike if the gap is noticeable.)
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

## 5. Generating a video (the skill's workflow)

The skill is one `SKILL.md` that orchestrates the steps below; each step's detail is in
`references/` so the main file stays short.

1. **Doctor** (at install, and again after any render failure): checks Node,
   `hyperframes doctor --json` (gate on `.ok`), `hyperframes browser ensure`, that
   `ffmpeg -version` actually runs (a broken Homebrew ffmpeg that cannot load a
   library is the failure we met), and the Kokoro voice model. It prints the exact fix
   for anything missing. It does **not** install the Hyperframes domain skills: like
   `brag`, `SKILL.md` lists the ones it needs (`hyperframes-core`, `-animation`,
   `-creative`, `-keyframes`, `-cli`) in its "Read:" lines, and on first use Claude
   installs any that are missing with the Hyperframes `skills` subcommand. (Confirmed
   from the owner's first `brag` run, where Claude ran that subcommand on its own.)
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
6. **Narration**: Kokoro via `hyperframes tts`, one file per chapter. Captions are
   always on.
7. **Gates per chapter**: `hyperframes check`; **dense snapshots around moving parts**
   (the prototype's overlapping packets were only found after a full render); and the
   **claim audit**: every captioned claim's file and line must exist and contain the
   quoted text.
8. **Render, draft first**: each chapter renders at `--quality draft` (in parallel,
   bounded by `--workers`), is registered with the server, and the viewer can start
   watching. A `delivery`-quality render then runs in the background and replaces the
   draft; `quality` flips to `full`.
9. **Open the player**: start the server, open the default browser, set up Monitor.

## 6. Failure handling

- **Render fails** (Chrome, ffmpeg, memory): the chapter is `failed` with a one-line
  reason and the fix command; other chapters are unaffected; there is a retry button.
  Low memory lowers the worker count automatically.
- **Claim audit fails**: the chapter is not published. Claude fixes the narration or
  removes the claim. Nothing unverified is shipped silently.
- **Claude session gone**: messages stay queued; fallback or "not connected" (4.5).
- **Server crash**: all state is files; restart and continue.
- **Code changed later**: each chapter records the commit it was verified against.
  The warning UI is v2.

## 7. Security

- Server bound to `127.0.0.1`; random session key in the URL, remembered in a cookie.
- Only the server writes `manifest.json`.
- Chat text is the user's own input. Text Claude reads from the repository while
  verifying is treated as data, never as instructions.
- Export writes only into the folder the user chose.
- `.yap/` is added to `.gitignore` guidance in the README.

## 8. Testing

- Unit tests (plain Node): manifest operations (insert, reorder, atomic write, computed
  timestamps), claim audit, event queue and heartbeat, `yap.cjs` commands.
- Server contract tests for every endpoint in 4.3.
- Player: component tests, plus one end-to-end test with a tiny fixture video.
- Doctor: tested with mocked missing and broken dependencies.
- A full "generate a video from a small fixture repo" run needs a real render, so it
  runs locally or nightly, not on every pull request.

## 9. Spikes before we rely on these (unverified)

1. Can the session id be read from inside a session, and does `claude -p --resume <id>`
   on a closed session behave cleanly? Also: how to avoid starting a second Claude
   while the live one is just slow.
2. Do chapters really render in parallel with `--workers` without exhausting memory?
3. Can scene timing follow Kokoro's narration timing (word or sentence timestamps)?
4. Is Kokoro through `hyperframes tts` free and fully local, with no key? (The `brag`
   plugin uses it for narration, which suggests yes.)
5. Does a plugin install hook exist for running the doctor at install time? If not, the
   doctor runs on first use.
6. Is the gap between chapters noticeable in the player when playing several MP4s in a
   row? If so, join chapters ahead of time.
7. Does the Monitor tool keep working across a long idle period without cost?

## 10. Repository layout

```
yap/
  .claude-plugin/ plugin.json
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

- Claude Code (Monitor tool, skills, plugins), Node 22+, ffmpeg, Hyperframes (CLI via
  `npx`; its domain skills install on first use as in section 5, step 1).
- The user's Claude tokens pay for everything. A prototype video took about 44 minutes
  and 290k tokens; the scene kit, draft-first rendering, and parallel chapters are what
  bring that down. Real numbers must be measured and published in the README.
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
