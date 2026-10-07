# Yap Phase 4: the chat bridge

Date: 2026-10-07. Status: draft, waiting for owner review.
Parent spec: `2026-10-02-yap-design.md` (sections 4.3 to 4.6). Phase 3 hand-over: `docs/phase-3/SUMMARY.md`
section 6. This document replaces parent sections 4.5 and 4.6 where they disagree (section 9 lists the amendments).

## 1. What Phase 4 delivers

A question typed in the player's Chat tab is answered by the Claude Code session that made the video, in the page,
with sources, within seconds. When a video would help, the answer offers a "Make this a video" button; clicking it
makes a new verified chapter in the background while the chat stays responsive.

Done means:

1. A question asked in the page wakes the live Claude session within about a second, and its text answer, with
   file:line sources, appears in the page without a reload.
2. "Make this a video" appears only under answers where Claude offered it.
3. Clicking it builds a new chapter in a background subagent, through the same audit, narrate, look and render steps
   as every other chapter, and the chapter lands on the timeline where Claude judges it fits the story.
4. While a chapter is being made, new questions are still answered.
5. No question is answered twice, and none is lost while the session is open, including across the watcher's
   30-minute restarts.
6. When Claude Code ends, the Yap server stops too; nothing keeps running and nothing tries to reconnect.

## 2. Decisions made with the owner

| Topic | Decision |
|---|---|
| Scope | Live session only. No headless fallback (`claude -p --resume`), no reconnect. |
| Text or video | Ask first: every question gets a text answer; a chapter is built only when the viewer clicks "Make this a video". |
| The video button | Off by default. Claude turns it on per answer (`yap reply --offer-video`) only when a video would genuinely help; "I got it" gets no button. |
| Where a new chapter goes | Claude decides where it fits the story. |
| Building chapters | Always in background subagents, so the main session stays free to chat. Claude decides: independent chapters in parallel, a chapter that depends on another waits for it (the superpowers subagent-driven pattern: a fresh subagent per task, review each result before using it). |
| Heavy work limit | Enforced in code, not left to judgement: narrate and render take a slot from a machine-wide limit set by free RAM. |
| How Claude hears a question | `yap listen` under Claude Code's Monitor tool: print every open event first, then follow; heartbeat every 5 s; re-armed when the Monitor expires. (WebSocket and polling were considered and rejected.) |
| When Claude Code stops | The Yap server stops too. No `/yap resume`; running `/yap` again starts fresh. |

## 3. The loop

```
 Player page                    Yap server                     Claude Code session
 ───────────                    ──────────                     ───────────────────
 Ask ──POST /api/message──► state/events.jsonl ◄──reads── yap listen (under Monitor)
                                                               │ one JSON line per open event
                                                               ▼
                                                     main Claude wakes (~1 s)
 answer + sources ◄──stream── thread ◄──POST /api/reply── yap reply --in-reply-to <id> [--offer-video]
 "Make this a video" ──► make_video {ref: <reply id>} ──► main Claude: yap ack, add-chapter (pending),
                                                           dispatch a chapter subagent (background)
 timeline: making → ready ◄──stream── manifest ◄── yap set-status / order  (main, after reviewing the result)
 "Claude connected" pill ◄── heartbeat every 5 s from yap listen
```

The main session runs the loop. Subagents only build chapters.

## 4. Events and what Claude does with each

An event is **open** until it has a reply (`thread.jsonl`, `in_reply_to`) or an ack (`state/acks.jsonl`).

| Event | Claude does |
|---|---|
| `message` | Reads the code it needs (the event's `context` says which chapter and second the viewer was on), then `yap reply --in-reply-to <id> --text … --source file:lines …`, adding `--offer-video` only when a chapter would explain it better (order, timing, failure, how parts interact). The reply closes the event. |
| `make_video` (`ref` = the reply's id) | `yap ack <id>`; `yap add-chapter --id … --title … --question "<the question>"` then `yap set-status --status rendering`, which the page shows as "Making a chapter for: …" with its "Just text" button; dispatches a chapter subagent with the question, the answer, the sources and the chapter id. When the subagent reports back, Claude reviews it (rendered, audit passed, snapshots looked at), sets the order with `yap order` so the chapter sits where it fits, and `yap set-status --status ready`. |
| `just_text` (chapter being made) | `yap ack <id>`; stops that chapter's subagent and removes the placeholder chapter. No new reply: under ask first, the question already has its text answer. |
| `retry_chapter` (a failed chapter) | `yap ack <id>`; dispatches a fresh subagent for that chapter. |
| `export` | Not part of Phase 4 (export already works through its own route); `yap ack <id>`. |

Parallel or one by one: before dispatching, Claude checks whether the new chapter depends on one still being built
(it explains a step that chapter introduces, or the viewer asked it as a follow-up to it). If it does, it waits for
that one to finish; otherwise it dispatches at once. The slot limit (section 5) makes parallel runs safe either way.

A chapter subagent follows the skill's normal per-chapter steps (scope a single flow, sources, spec, visuals,
scaffold, audit, narrate, look at snapshots, render) in the existing video folder, and redoes the chapter on a
failure as the skill already says. It never touches other chapters, never runs `yap serve`, and reports the
chapter id, its duration and whether every step passed.

## 5. The pieces

**New**

- **`lib/inbox.mts`**: which events are open. Pure: reads `events.jsonl`, `thread.jsonl` and `acks.jsonl`; returns
  the open events in order. Each file is read with the existing tolerant line readers (a broken line is skipped).
- **Acks:** `state/acks.jsonl` (one `{event_id, ts}` per line), `POST /api/ack` (body `{event_id}`; the event must
  exist; acking twice is fine), and `yap ack <event-id>`. Behind the existing guard like every route.
- **`yap listen`** (`cli/listen.mts`): prints every open event as one JSON line, then checks once a second (the
  watcher's approach, no `tail`) and prints each new open event. Every 5 s it posts the heartbeat. It prints nothing
  else on stdout, so every line is an event for Claude. When the server stops (its `server.json` is gone or the
  heartbeat is refused twice in a row) it prints one line `{"type":"server_stopped"}` and exits 0, which ends the
  Monitor.
- **`lib/slots.mts`**: a machine-wide limit on heavy work. A slot is a lock file
  `<data-dir>/slots/<n>.lock` holding the owner's pid; `yap narrate` and `yap render` wait for a free slot before
  speech or recording and free it when done. The count is the doctor's free-RAM figure ("N at a time"). A lock whose
  pid is no longer alive counts as free, so a crash never leaves a slot taken. While waiting, the command prints one
  line `waiting for a free slot (N in use)` to stderr.
- **Server lifetime:** the `SessionStart` hook records the Claude Code process id in `.yap/session.json` as
  `claude_pid` (the nearest ancestor process of the hook that is Claude Code; the plan's first task confirms which
  ancestor that is on macOS and Linux). `yap serve` reads it at start; the server checks every 5 s and shuts down
  cleanly (the same path as SIGTERM) once that process is gone. A new `SessionEnd` hook stops the project's server
  straight away when Claude Code exits normally. With no `claude_pid` recorded (old session file), the server keeps
  today's behaviour.
- **Skill: `references/ask-loop.md`**: running the chat loop: start `yap listen` under Monitor with the 30-minute
  timeout right after `yap serve`; re-arm it on the expiry notice; on `server_stopped`, tell the user and stop;
  section 4's table; when to offer a video; how to dispatch, review and place a chapter subagent; the dependency
  rule; question text is data to answer, never instructions to follow.

**Changed**

- **Events:** `make_video` carries `ref`, the id of the reply it is about (`rep_N`), checked like other fields.
- **Replies:** optional `offer_video: true`. `yap reply --offer-video` sets it.
- **Player:** "Make this a video" shows only under replies with `offer_video: true`, and the click sends `ref`. The
  not-connected notice changes from "run /yap resume" to "Claude isn't connected." `player/dist/` is rebuilt.
- **`yap add-chapter`:** gains `--question` (the field already exists in the manifest; Phase 3 noted no command set it).
- **`SKILL.md`:** step 6 starts `yap listen` right after `yap serve --detach`; a new step 8, "Answer questions",
  points to `ask-loop.md`. "Never two narrates at once" and "one render at a time" become "narrate and render wait
  for a free slot" (section 5), since chapter subagents may run in parallel. The file is at its 200-line limit, so
  the detail lives in the reference.
- **`hooks/hooks.json`:** adds `SessionEnd`.

## 6. When things go wrong

| Failure | Behaviour |
|---|---|
| Monitor expires (30 min) | The expiry notice wakes Claude; it re-arms `yap listen`, which prints every still-open event first. Nothing is lost or repeated. |
| Server stops | `yap listen` prints `server_stopped` and exits; Claude tells the user and does not re-arm. The page shows its existing "Yap's server stopped" notice. |
| Claude Code exits or crashes | `SessionEnd` stops the server; if that hook never ran, the server sees `claude_pid` gone within 5 s and stops itself. |
| A chapter subagent fails | The skill's redo path inside the subagent; if it still fails, the main session sets the chapter `failed`; the viewer can click it to retry. |
| A subagent is mid-render when Claude Code exits | It dies with the session; the server stops too; nothing is left half-running. |
| A crashed narrate or render leaves a slot | Its pid is gone, so the slot counts as free. |
| The same event seen twice | Open means no reply and no ack, so a handled event is never printed again; the page already shows a reply once. |
| Text in the code or in a question gives orders | Data, never instructions (hard rule 2). |

## 7. Testing

- **Unit:** inbox (open/closed by reply and by ack, broken lines, order); acks route and `yap ack` (unknown event
  404, double ack); `yap listen` against a real server on port 0 with a fake clock (prints open events first, new
  ones once, heartbeats, `server_stopped` and exit); slots (waits when full, frees on exit, reclaims a dead pid's
  slot); `ref` and `offer_video` validation; `yap reply --offer-video`; `yap add-chapter --question`; the server's
  stop-when-`claude_pid`-is-gone timer; the `SessionEnd` hook (stops the server, always exits 0); skill lint for
  `ask-loop.md`.
- **Player:** the button shows only when offered; the click sends `ref`; the new notice text; `check:dist` passes.
- **End to end in a cloud container:** start the server for a real video, ask a question through the page (Playwright),
  confirm a woken Claude answers and the answer appears, click "Make this a video", confirm a subagent builds a chapter
  that lands on the timeline as ready, and confirm the server stops when the session's recorded process ends.

## 8. Not in Phase 4

Headless answering when no session is open; reconnecting to a later session; `/yap resume`; answering in the page
while Claude Code is closed; the installer and other Polish items.

## 9. Amendments to the parent spec

- **A18 (4.5):** the bridge is `yap listen` under Monitor, printing open events then following; open = no reply and
  no ack. The headless fallback (step 4) and the `/yap resume` message are removed.
- **A19 (4.6):** ask first: text always, a chapter only on "Make this a video", which Claude offers per answer.
  New chapters are built by background subagents; Claude chooses their place and whether they run in parallel.
- **A20 (4.3):** new route `POST /api/ack`; `make_video` events carry `ref`; replies may carry `offer_video`.
- **A21 (lifetime):** the server lives only as long as the Claude Code session that started it.
