# Yap Phase 3: the player

Date: 2026-10-03. Status: draft, waiting for owner review.
Parent spec: `2026-10-02-yap-design.md` (sections 4.3 to 4.10, 8, 13). This document adds
detail for Phase 3 and lists the changes it makes to the parent spec as amendments A10 to
A16 (section 9). Nothing here takes effect until the owner approves it.

## 1. What Phase 3 delivers

The browser UI served at `GET /`: one page that plays the chapters of a Yap video as a
single video, shows a chapter timeline, lets the viewer ask questions, lists sources, and
exports the result. It replaces the Phase 2 placeholder page.

Phase 3 is a client. It adds no server routes. It reads and writes only through the
Phase 2 API. Claude answering questions is Phase 4; in Phase 3 a posted question is stored
and shown as waiting.

Done means:

1. A video with several chapters plays start to finish with no visible stall at a join.
2. The timeline shows every chapter state from the manifest and updates live over SSE.
3. A question typed in the chat is posted, appears in the thread, and survives a reload.
4. Export writes the files to a folder the viewer names.
5. `player/dist/` is committed and CI fails when it differs from a fresh build.

## 2. Decisions already made with the owner

| Topic | Decision |
|---|---|
| Scope | Player only. No editing in the browser. Reorder, delete and retime go through chat. |
| Framework | React + Vite, as in the parent spec. |
| Styling | Tailwind + shadcn/ui, restyled to the look below. |
| Look | Neo-Brutalism on a cream ground. Mockup: `docs/phase-3/mockups/style-directions-v2.html`, tab 1. |
| Brand | Board: `docs/phase-3/mockups/brand-board.html`. Logo is a speech bubble holding a play triangle, next to a tilted yellow "yap" block. |
| Layout | Parent spec option B: large video, timeline under it, right panel with Chat and Sources. |

## 3. Look and tokens

One token file, `player/src/theme.css`, holds the palette as CSS variables and feeds the
Tailwind theme. The first four values are the same as `scene-kit/theme.css`.

| Token | Value | Use |
|---|---|---|
| `--yk-yellow` | `#F6C945` | current chapter, primary surfaces, viewer's chat bubbles |
| `--yk-orange` | `#FF8A1F` | primary buttons, rendering state, follow-up tint |
| `--yk-black` | `#14110A` | borders, shadows, text, played chapters, video ground |
| `--yk-cream` | `#FFF1CC` | page ground |
| `--yk-white` | `#FFFFFF` | panel and card ground |
| `--yk-red` | `#FF6B57` | failed state only |

Rules:

- Borders are 3px solid black. Shadows are hard offsets (4px or 8px, no blur). Corner
  radius is 10 to 14px. No gradients, no blur, no glow.
- Type: Archivo (900 for headings and buttons, 700 and 500 for text), self-hosted in
  `player/` so the page makes no network request. File references use the system
  monospace stack.
- There is no green. A ready chapter has the neutral look; only rendering, failed and
  stale carry a signal.
- shadcn components used: Button, Tabs, Tooltip, Dialog, Input. Each is restyled once in
  `player/src/components/ui/`. No other shadcn component is added without a reason.

## 4. Screen

```
+--------------------------------------------------------------+
| [yap]  Claude yaps. You watch.      (Claude connected) [Export]|
+----------------------------------------+---------------------+
|                                        | [Chat] [Sources]    |
|              video (16:9)              |                     |
|                    captions            |  thread             |
|                                        |                     |
+----------------------------------------+                     |
| (play)  Chapter title           2:05 / 5:35  [CC]            |
| [01 ..][02 ..][03 ....][> ..][04 ..][//////][x ..]| [ ask  ] |
+----------------------------------------+---------------------+
```

Under 1000px wide the panel moves below the timeline. The panel can be collapsed.

### 4.1 Timeline

One block per manifest chapter, in manifest order, width proportional to `duration_s`.
The chapter title is printed inside the block and cut with an ellipsis when it does not
fit. Hovering or focusing a block shows a tooltip with the full title, the duration and
the poster frame.

| Chapter state | Look | Click |
|---|---|---|
| ready, already played | black block, cream text | seek to its start |
| ready, current | yellow fill up to the playhead, lifted 4px with a shadow | seek inside it |
| ready, not yet played | white block | seek to its start |
| follow-up (`parent_id` set) | dashed border, pale orange ground, placed after its parent | as above |
| `rendering` | animated orange and cream diagonal stripes, label "rendering" | none |
| `failed` | red block with a retry mark | posts a retry message (5.3) |
| `stale` | white block, dashed grey border, struck-through title, label "out of date" | none |
| `quality: draft` | small "draft" tag in the block corner, added to any state above | unchanged |

Only `ready` chapters are playable. Playback skips the others. A chapter that turns
`ready` while the viewer watches becomes playable without a reload.

### 4.2 Video area and captions

- The video sits on a black ground with a 3px border and an 8px shadow.
- Captions are drawn by the player as an overlay (black bar, yellow text, lower third),
  from the chapter's `captions.json`. They are on by default. A CC button and the `c` key
  toggle them; the choice is kept in `localStorage`.
- Native `<track>` elements are not used: two swapping video elements make track
  handover unreliable.

### 4.3 Chat tab

- The thread from `GET /api/state`, then live `reply` events.
- The viewer's messages are yellow bubbles on the right. Claude's replies are white cards
  on the left with their `file:line` sources as chips.
- Under a text answer: **Make this a video**. Under a chapter that is rendering because of
  a question: **Just text**. Both are the override buttons of parent spec 4.6.
- When `claude_connected` is false the composer stays usable and a notice reads "Claude
  isn't connected: run `/yap resume` in Claude Code". Messages posted in that state are
  queued by the server, and the thread shows them as waiting.
- In Phase 3 nothing answers. Acceptance covers posting, the waiting state and the notice.
  There is no fake responder.

### 4.4 Sources tab

The `file:line` references of the current chapter, then those of each answer in the
thread. The current chapter's group is highlighted and follows playback.

### 4.5 Export

The Export button opens a dialog with one field, the destination folder as an absolute
path, remembered in `localStorage`. A browser page cannot open a native folder picker
that returns a path, so the viewer types or pastes it. The server validates the path
(Phase 2 Task 8) and its error text is shown under the field.

If any chapter is `draft`, the dialog offers "Export drafts now" and "Wait for full
quality". Waiting keeps the dialog open and enables export when no draft remains. On
success the dialog lists the written files.

### 4.6 Keyboard and access

Space plays and pauses. Left and right seek 5 seconds. `[` and `]` go to the previous and
next chapter. `c` toggles captions. Every control is reachable by Tab and has a visible
focus ring. Timeline blocks are buttons with the chapter title and state in their
accessible name. Animations stop under `prefers-reduced-motion`.

## 5. Architecture

```
player/
  package.json          React, Vite, Tailwind, shadcn deps live here only
  src/
    engine/             playback engine: plain TypeScript, no React
    api/                fetch + SSE client, one typed module
    state/              one store built from /api/state and SSE events
    components/         Timeline, VideoStage, Captions, ChatTab, SourcesTab, ExportDialog
    components/ui/      restyled shadcn pieces
    theme.css
  dist/                 committed build output
```

The repository root keeps zero runtime dependencies. Everything the player needs is in
`player/package.json`. Users never run a build.

### 5.1 Playback engine

A plain module that owns two `<video>` elements and knows nothing about React.

```
createEngine({ videoA, videoB, urlFor }) -> {
  setChapters(chapters)            // playable = status 'ready', in manifest order
  play() / pause()
  seek({ chapterId, offset })      // the only seek primitive
  position() -> { chapterId, offset, globalTime, duration }
  on('time' | 'chapter' | 'state' | 'error', handler)
}
```

Rules:

1. Position is always `{chapterId, offset}`. Global seconds are computed from the current
   chapter list each time, never stored. A chapter inserted before the playhead changes
   the global time shown and does not move playback.
2. The idle element preloads the next playable chapter. On `ended` the engine swaps the
   visible element and starts the next one. The target is the 20 to 35 ms join measured
   in spike 6.
3. A seek into another chapter loads it into the idle element, waits for `canplay`, then
   swaps. The visible element keeps its last frame until then.
4. If the preloaded chapter stops being playable (stale, failed, removed), the engine
   drops it and preloads the next playable one.
5. If the current chapter is removed, playback moves to the next playable chapter at
   offset 0, or pauses at the end.
6. The first `play()` may be refused by the browser's autoplay rule. The engine reports
   it and the UI shows a large play button. The page never starts with sound on its own.
7. A media error on one chapter marks it locally as unplayable, reports it, and playback
   continues with the next chapter.

### 5.2 Data flow

1. On load: `GET /api/state` fills the store with `{manifest, thread, claude_connected}`.
2. `GET /api/stream` (SSE) then keeps it current: `state` replaces the manifest, `reply`
   appends to the thread, `chapter` updates one chapter, `ping` proves the link is alive.
3. If the stream drops, the client reconnects with backoff and refetches `/api/state`
   before trusting new events. A banner reads "Reconnecting" while it is down.
4. The store hands the chapter list to the engine on every manifest change.
5. Writes: `POST /api/message` for questions and button presses, `POST /api/export` for
   export. The player never calls `/api/chapters`, `/api/reply` or `/api/heartbeat`.

The access key arrives in the URL on first load and the server sets a cookie (Phase 2).
The player uses relative URLs only and never reads or stores the key.

### 5.3 Contracts to confirm before planning

Phase 2 was still being built when this was written. The plan's first task checks each of
these against the Phase 2 code as built and records the answer:

1. The event types `POST /api/message` accepts. The player needs four: a question, "make
   this a video", "just text", and "retry chapter `<id>`". If Phase 2 accepts fewer, the
   missing ones are a small additive change to Phase 2's type list, raised with the owner.
2. The payload of the `chapter` and `state` SSE events.
3. The shape of `captions.json` (cue start, end, text) and the URL it is served from.
4. The `POST /api/export` request and response, including the `mode` field for drafts.
5. Whether a reply carries its sources as structured `file:line` items.

## 6. Failure handling

| Case | Behaviour |
|---|---|
| `/api/state` fails on load | Full-page message with the reason and a retry button. |
| 403 from any call | "This link has expired. Open the link printed by Yap again." |
| SSE drops | Banner, reconnect with backoff, refetch state. Playback continues. |
| A chapter's video fails to load | Block shown as failed locally, playback skips it. |
| Posting a message fails | The message stays in the composer with the error under it. Nothing is lost. |
| Export fails | The server's reason is shown in the dialog. |
| No playable chapter | Video area shows "The first chapter is rendering" and the timeline shows the stripes. |

## 7. Testing

- **Engine**: unit tests with fake video elements that fire `canplay`, `ended` and `error`
  on command. Cover every rule in 5.1, including insert before the playhead, removal of
  the current chapter and loss of the preloaded chapter.
- **Store and API client**: tests against recorded `/api/state` and SSE fixtures,
  including reconnect.
- **Components**: Timeline renders each row of the table in 4.1; ChatTab shows the
  disconnected notice and the waiting state; ExportDialog shows the draft choice and a
  server error.
- **One end-to-end test** in a real browser against the Phase 2 server and the tiny
  fixture video: play across a join, seek across chapters, post a message, export. It
  includes the audio-continuity check from parent spec 4.7.
- **Build check**: CI builds the player and fails if `player/dist/` differs.

## 8. Out of scope for Phase 3

Drag to reorder, trimming, deleting chapters from the UI, word-by-word caption
highlighting, a library of several videos, a settings screen, themes other than the
default, an animated mascot, and anything that makes Claude answer (Phase 4).

## 9. Amendments to the parent spec (need owner approval)

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
- **A14, section 4.7.** Add the `stale` and `draft` looks from 4.1 of this document.
- **A15, section 4.9.** "A folder the user picks" becomes "a folder the user names as an
  absolute path in the export dialog".
- **A16, section 4.10.** The logo is the speech bubble with a play triangle plus the
  tilted "yap" block. The alarm-clock mascot stays a corner badge and needs a redraw
  before release; the current drawing reads as a bear. Not blocking Phase 3.

## 10. Revision after reading Phase 2 as built (2026-10-03, needs owner approval)

Phase 2 finished after sections 1 to 9 were approved. `docs/phase-2/SUMMARY.md` sections
2, 3, 10 and 11 describe the server as built. Where this section disagrees with sections
1 to 9, this section wins. Section 5.3 is closed by it.

1. **Two read-only server routes are needed** (section 1 said none). No route serves
   static files, and no route serves a chapter's sources.
   - `GET /` answers `player/dist/index.html` when it exists, else the Phase 2 placeholder.
     `GET /assets/:file` serves one file from `player/dist/assets/`.
   - `GET /chapters/:id/sources` answers `{sources:[{file, lines:[a,b], quote}]}` read
     from the chapter's `chapter.json`.
2. **The server's content policy is `default-src 'self'`.** No inline script or style, no
   `data:` or `blob:` address, no outside host. The build must inline nothing, fonts are
   files, and the export dialog is a native `<dialog>` element, because the shadcn Dialog
   adds a style tag at run time, which the policy blocks. shadcn pieces used: Button,
   Tabs, Tooltip, Input.
3. **Captions arrive as WebVTT** from `GET /chapters/:id/captions`. There is no route for
   `captions.json`. The player parses the VTT itself (4.2).
4. **There are five statuses.** `pending` is added: a chapter that is listed but has no
   video and is not rendering. Look: white block, dashed black border, label "waiting".
   Not playable, no click.
5. **Export modes.** The player sends `mode:"full"` first. On `409` (drafts exist) the
   dialog names them and offers "Export drafts", which sends `mode:"drafts"`. Phase 2
   makes no full-quality renders yet, so there is no "wait for full quality" choice
   (replaces the second paragraph of 4.5).
6. **Button events are stored and not shown.** `make_video`, `just_text` and
   `retry_chapter` are accepted by `POST /api/message` and never appear in the thread.
   The player marks the button as sent, for that page load only.
7. **A failed chapter has no stored reason.** The block says "failed"; if a `chapter`
   event carried a reason during this page load, the tooltip shows it.
8. **A restarted server has a new address and key.** When state requests keep failing,
   the page says: "Yap's server stopped. Run /yap again and open the new link."
9. **Disconnect is pushed.** The server sends a `state` event when Claude's heartbeat
   runs out, so the page needs no timer.
10. **The title** shown in the header is the manifest's `title` (today the folder name).

- **A17, parent spec section 4.3.** Add the two routes of point 1 to the endpoint table.
