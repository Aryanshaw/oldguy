# Phase 4 summary: the chat bridge

Date: 2026-10-07. Branch: `claude/admiring-turing-vi8pw2`. Spec: `docs/superpowers/specs/2026-10-07-phase-4-chat-bridge-design.md`.

## 1. What was built

| Piece | Where | What it does |
|---|---|---|
| Event `ref`, reply `offer_video` | `lib/events.mts`, `server/api.mts` | `make_video` names the reply it is about; a reply may offer a video. |
| Acks and the inbox | `lib/events.mts` (`appendAck`), `lib/inbox.mts`, `POST /api/ack`, `yap ack` | An event is open until it has a reply or an ack. |
| `yap listen` | `cli/listen.mts` | Prints every open event as one JSON line, then each new one once; heartbeats every 5 s; prints `{"type":"server_stopped"}` and exits 0 when the server is gone. |
| CLI flags | `cli/client.mts` | `yap reply --offer-video`, `yap add-chapter --question`. |
| Memory slots | `lib/slots.mts`, `cli/narrate.mts`, `cli/render.mts` | Narrate and render wait for one of `renderCap(free RAM)` machine-wide slots; a dead holder's slot is reclaimed. |
| Server lifetime | `lib/owner.mts`, `hooks/session-start.mts`, `cli/server.mts` | The hook records `claude_pid`; `yap serve` shuts down cleanly once that process is gone. |
| SessionEnd hook | `hooks/session-end.{cjs,mts}`, `hooks/hooks.json` | Stops the project's live Yap servers when Claude Code exits (only a server that answers as that folder's real server). |
| Player | `player/src` (`ChatTab`, `store`, `client`, `types`, `App`) | "Make this a video" only under offered replies; the click sends `ref`; new notice text; the side panel has a bounded height so the chat scrolls inside it. |
| Watcher | `server/chapter-sync.mts` | An idle chapter folder no longer turns a `rendering` row back into `pending`. |
| Skill | `skills/yap/SKILL.md` step 8, `references/ask-loop.md` | Start `yap listen` under Monitor, answer every event, offer a video only for order/timing/failure questions, build chapters with subagents (parallel unless one builds on another), review before placing. |

Tests: root suite 665 (660 pass, 5 skipped as before), player 219, Phase 2 acceptance 66/66.

## 2. End-to-end run (this container, 2026-10-07)

On the 7-chapter video `how-yap-works-v2`:

1. `yap serve --detach`, then `yap listen` under the Monitor tool. The page (Playwright, Chromium) showed "Claude connected".
2. A question typed in the page ("What happens if two chapters render at the same time?") reached the session as
   `evt_1` within about a second. The answer went back with `yap reply --offer-video` and two sources; the page showed
   it with its source chips and the "Make this a video" button (evidence 1).
3. Clicking the button arrived as `make_video` with `ref: rep_1`. The session acked it, added `two-at-once` with its
   question, set it `rendering`, and dispatched a chapter subagent.
4. While the subagent worked, a second question was asked and answered (no video offered, so no button), and the
   page showed "Making a chapter for: …" (evidence 2).
5. The subagent built the chapter by the skill's steps (audit, narrate, snapshots, render; it redid the chapter
   twice on its own findings) and reported `ready`, 31.6 s. The session re-audited it, looked at its frames
   (evidence 4), placed it after `four-checks` with `yap order`, and set it `ready`. The video became 8 chapters, 3:58.
6. Running the SessionEnd hook stopped the server; `yap listen` printed `server_stopped` and exited, ending the Monitor.

## 3. Found and fixed during the run

- **The chat panel overflowed** (owner report): the panel had no height limit, so the question box was pushed off
  screen as the chat grew. Fixed with a bounded panel height (evidence 3).
- **Owner review of the page:** the "Hide panel" button took its own row and pushed the side panel below the video's
  top line. The button was removed (the panel is always shown) and both columns now start on the same line.
- **"Making a chapter for…" vanished** once the subagent created the chapter folder: the watcher reset `rendering` to
  `pending`. Fixed in `mapStatus`, with a test.

## 4. Open items

1. ~~**Reply sources are not checked.**~~ Fixed: `yap reply` checks every `--source` against the repository
   (the file exists, the lines are inside it) and refuses the reply otherwise (`--root`, default the current folder).
2. ~~**The timeline gets crowded.**~~ Fixed: the timeline is now a scrolling track, like a video editor's. Each clip is
   6 px per second (at least 140 px, so title and status fit), a ruler above shows video time, a red playhead marks the
   current spot and the track follows it while playing; a mouse wheel scrolls it sideways. A short video still fills
   the row.
3. ~~**"Asked for a video" resets on reload.**~~ Fixed: `GET /api/thread` marks a reply `video_asked` once a
   `make_video` event names it, so the button stays pressed after a reload.
4. **Videos do not play in this container's Chromium.** It has no H.264 decoder (`canPlayType` empty), so the page
   marks every chapter "failed, retry" there. The video route itself answers 206 correctly. Real Chrome and Safari
   play H.264; worth a check on the owner's machine.
5. **Not exercised live:** the 30-minute Monitor expiry and re-arm (covered by the listener's "print every open event
   first" tests), and `claude_pid` detection on macOS (unit-tested with a `node …/claude` process table; on Linux it
   found the real Claude Code process).
6. **Chapter sources drift.** After these code changes, two chapters of `how-yap-works-v2` fail their audit (their
   quoted lines moved). This is the audit doing its job; they need a redo before any re-render.
