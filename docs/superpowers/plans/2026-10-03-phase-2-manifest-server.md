# Yap Phase 2: Manifest and Local Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Per the owner's standing preference, this plan carries **signatures, test cases and logic sketches, not full implementations**. Write the real code in plain, commented style: a one- or two-line plain-words comment above every function and above every non-obvious step.

**Goal:** Turn the chapter folders Phase 1 writes into something a browser can use: a `manifest.json` that lists chapters in story order, and a zero-dependency local server that serves the chapter videos (with range requests), keeps the manifest as its only writer, takes chat messages and Claude's replies, pushes live updates, and exports the finished video.

**Architecture:** Pure, tested libraries (`lib/manifest.cjs`, `lib/chapter-scan.cjs`, `lib/events.cjs`, `lib/range.cjs`, `lib/http-guard.cjs`) sit under a thin `server/server.cjs`. The server owns `manifest.json` and writes it atomically through one queue. Chapters become "ready" when the Phase 1 signal appears (`chapter.mp4` plus a `render.json` that matches `build.json`). A small client side (`yap reply`, `yap add-chapter`, `yap set-status`) lets Claude talk to the server. A placeholder HTML page lists chapters so the server can be checked in a real browser; the real player is Phase 3.

**Tech Stack:** Node 22+ (CommonJS, `node:http`, `node:test`, no runtime dependencies), ffmpeg (injected in tests), Chrome for the one real-browser check.

**Spec:** `docs/superpowers/specs/2026-10-02-yap-design.md` (sections 4.2 to 4.4, 4.9, 7, 8) plus the amendments proposed in `docs/phase-1/SUMMARY.md` section 6 (A1 to A9). **Phase 1 contract this plan builds on:** `docs/phase-1/SUMMARY.md` sections 1.3 and 7.

## Global Constraints

- Node 22+; `bin/`, `lib/`, `server/` use **no runtime dependencies** (standard library only).
- The server binds to `127.0.0.1` only, on a random free port, and every request needs the session key (URL query on first load, then a cookie; API calls also accept an `x-yap-key` header). A request with a missing or wrong key gets 403.
- **Only the server writes `manifest.json`**, atomically (temp file then rename), through one in-process queue.
- Chapter folders are read-only to the server except for `poster.jpg`, `state/` files and export output. It never edits `chapter.json`, `build.json`, `render.json`, audio or video.
- A URL never names a path: video and poster routes take a chapter **id**, look it up in the manifest, and build the path from the manifest's folder, never from the request.
- "This video is current" means exactly: `chapter.mp4` exists and `render.json.build_sha256` equals the sha256 of the folder's `build.json` bytes (Phase 1 contract). Anything else is not `ready`.
- Ignore transient folders in chapter dirs: `.narrate-*/`, `work-*/`, `snapshots/`.
- No money, price or token talk in any product file or output (owner rule).
- Tests: flat `tests/<name>.test.cjs`, run with `npm test` (Node 26 needs the glob script). Servers in tests use port 0 and temp dirs; no test touches real ffmpeg, Hyperframes, Claude or the network.
- Branch: create `phase-2-server` from `phase-1-generator` at execution time. Do not merge or push without the owner's approval. Commit messages end with the attribution lines the owner's session requires.

## Review Focus

Conditions the spec implies but the happy path will not exercise, most likely first. Each is pinned by a named test in the task that owns it.

1. **A web page in another browser tab calling the server** (cross-site request, DNS rebinding with a hostile `Host` header, a guessed port). Every route must refuse without the key, and refuse any `Host` that is not `127.0.0.1:<port>` or `localhost:<port>`; POSTs must also refuse a foreign `Origin`. *(Task 4)*
2. **Path escapes**: chapter ids like `../x`, encoded slashes, backslashes, NUL bytes, symlinked chapter folders or `chapter.mp4` pointing outside the project. *(Tasks 2, 5)*
3. **Range requests as real video elements send them**: `bytes=0-`, `bytes=100-`, `bytes=-500`, a start past the end (416), several ranges, a `HEAD`, a file that changes size while playing. A wrong answer makes the player stall. *(Task 5)*
4. **A crash or two writers hitting the manifest at once**: the file must always be valid JSON, and updates must not be lost. *(Tasks 1, 6)*
5. **Hostile or broken chat input**: invalid JSON, a huge body, a message with a NUL byte, a partial last line in `events.jsonl`, a thread file someone hand-edited. *(Tasks 3, 6)*
6. **A chapter that stops being current** (re-narrated, `build.json` changed, `chapter.mp4` deleted) after it was shown as ready. It must flip back, and the video route must not serve a stale file as current. *(Tasks 2, 7)*
7. **Claude disconnects** (no heartbeat). `claude_connected` must turn false after 15 seconds and true again on the next heartbeat. *(Task 6)*

---

## File Structure

```
server/server.cjs            http server: start/stop, routing table, SSE hub wiring
lib/manifest.cjs             manifest model: init, validate, insert, reorder, status, timeline, atomic save
lib/chapter-scan.cjs         read a chapters folder: order.json, per-chapter status and facts
lib/events.cjs               events.jsonl and thread.jsonl: append, read-after, validation, caps
lib/range.cjs                parse Range headers, build 200/206/416 responses for a file
lib/http-guard.cjs           key, cookie, Host and Origin checks, JSON body reader with caps
lib/sse.cjs                  SSE hub: clients, broadcast, ping
lib/poster.cjs               poster.jpg extraction through an injected ffmpeg
lib/export.cjs               ordered concat + script.md + sources.json, injected ffmpeg
lib/watcher.cjs              watch a project's chapters for ready/stale changes
lib/server-cli.cjs           `yap serve [--detach]`, state/server.json (URL, key, pid)
lib/client-cli.cjs           `yap reply | add-chapter | set-status` (talk to the server)
skills/yap/...               order.json written by the skill; hand-off starts the server
tests/*.test.cjs             one file per lib file plus server contract tests
docs/phase-2/ACCEPTANCE.md   Task 11 results
```

---

### Task 0: Branch and spec amendments (gate: owner approval)

**Files:** `docs/superpowers/specs/2026-10-02-yap-design.md` (new section 14 at the end), `docs/phase-2/README.md`.

**Interfaces:** Produces the spec text the rest of this plan argues from. **Do not start this task until the owner has approved amendments A1 to A9** in `docs/phase-1/SUMMARY.md` section 6 (the plan review is where that happens). If they are not approved, stop and report.

- [ ] **Step 1:** Create branch `phase-2-server` from `phase-1-generator`.
- [ ] **Step 2:** Append a dated section **"14. Amendments of 2026-10-03 (from Phase 1)"** to the spec containing A1 to A9 copied verbatim from `SUMMARY.md` section 6 (each with its heading), plus a short list "Phase 2 additions": the manifest row fields `build_sha256`, `verified_against_commit` and `story_index` (position), `claude_connected` in the state, `state/server.json` (url, key, pid; mode 0600), and the placeholder page. Do not edit the accepted sections above.
- [ ] **Step 3:** Write `docs/phase-2/README.md` (10 lines): what this folder holds.
- [ ] **Step 4: Commit** `docs: spec amendments from phase 1`.

---

### Task 1: Manifest model (`lib/manifest.cjs`)

**Interfaces:** Produces
```
newManifest({title, slug, audience}) -> manifest
validateManifest(obj) -> {ok, errors[]}
insertChapter(m, row, {after?}) -> manifest   // after = id of the parent/predecessor; default end
reorderChapters(m, ids[]) -> manifest         // must be a permutation of existing ids
setChapterFields(m, id, patch) -> manifest    // status, quality, duration_s, build_sha256, ...
timeline(m) -> [{id, start, end}]              // from order + duration_s; null durations count as 0 and are flagged
saveManifest(file, m) / loadManifest(file)     // atomic write (temp + rename); load validates
```
Chapter row (spec 4.2 plus Phase 2 fields): `{id, title, parent_id, placement_reason, status:'rendering'|'ready'|'failed'|'stale', quality:'draft'|'full', duration_s, video, poster, captions, question, build_sha256, verified_against_commit}`. All functions are pure and return new objects.

- [ ] **Step 1: Write failing tests** (`tests/manifest.test.cjs`): `newManifest` has `version:1` and no chapters; `insertChapter` at end, after a parent, after an unknown id (error); duplicate id rejected; ids must match the Phase 1 slug rule; `reorderChapters` rejects a missing/extra/duplicate id; `setChapterFields` rejects unknown fields and invalid status; `timeline` adds durations in order and flags missing durations; `validateManifest` lists every problem (wrong version, bad status, `parent_id` pointing at nothing, duplicate ids, a row with a path containing `..`); `saveManifest` leaves no temp file, and a simulated crash between write and rename (throw in a fake fs) leaves the old file intact (Review Focus 4); two sequential saves keep valid JSON; `loadManifest` of garbage returns a clear error, not a crash.
- [ ] **Step 2: Run** `npm test` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: manifest model`.

---

### Task 2: Chapter scan and status (`lib/chapter-scan.cjs`)

**Interfaces:** Consumes the Phase 1 folder contract. Produces
```
readOrder(slugDir) -> string[] | null            // .yap/<slug>/order.json {"chapters":[ids]} (amendment A8), null if absent
scanChapter(chapterDir) -> {id, title, durationS, status, buildSha256, verifiedAgainstCommit, hasPoster, issues[]}
scanProject(slugDir) -> {order, chapters[]}      // order.json first, then remaining folders alphabetically
```
`status`: `ready` only when `chapter.mp4` exists (regular file, not a symlink out of the folder) and `render.json.build_sha256` equals sha256 of `build.json` bytes; `stale` when mp4 exists but the record is missing or differs; `rendering` when a `work-*` folder exists and no valid mp4; `failed` is never derived here (only set by the API); otherwise `draft` (narrated, not rendered) shown as `stale`-free `rendering`? **Ruling to carry:** use exactly `ready | stale | rendering | pending` from the scan (`pending` = narrated or scaffolded, no render yet); the manifest maps `pending` to `rendering` only while a render is known to be running (Task 7).

- [ ] **Step 1: Write failing tests** (`tests/chapter-scan.test.cjs`, temp dirs with tiny fake files): the Phase 1 example (folder with all files) is `ready`; mp4 present but `render.json` missing is `stale`; `render.json` differing from `build.json` is `stale`; `build.json` edited after render makes it `stale` (Review Focus 6); no mp4 is `pending`; `work-123/` present and no mp4 is `rendering`; transient folders ignored; `chapter.mp4` as a symlink to a file outside the folder is not `ready` and adds an issue (Review Focus 2); a folder whose name is not a slug is skipped with an issue; `readOrder` ignores unknown ids and duplicates, tolerates garbage JSON (returns null with an issue); durations come from `beats.json.durationS`, missing file gives `durationS: null` and an issue; old `build.json` version 1 gives status `stale` with the issue "narrated with an older version".
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: chapter scan and status`.

---

### Task 3: Events and thread files (`lib/events.cjs`)

**Interfaces:** Produces `appendEvent(file, {type, text?, context?, ...}, {now, maxBytes}) -> event`, `readEventsAfter(file, afterId) -> event[]`, `appendReply(file, {in_reply_to, text, sources?}) -> reply`, `readThread(file) -> entry[]`. Event ids are `evt_<n>`, monotonic, derived from the last valid line so they survive a restart. Types: `message`, `make_video`, `just_text`, `retry_chapter`, `export`. Limits: text at most 4000 characters, whole event at most 8 KB.

- [ ] **Step 1: Write failing tests** (`tests/events.test.cjs`): ids increase and survive reopening; `readEventsAfter('evt_3')` returns only later ones; a partial last line (crash mid-append) is skipped and the next append starts on a fresh line; a hand-edited garbage line is skipped, not fatal (Review Focus 5); unknown `type` rejected; text over 4000 or a NUL byte rejected; `context` must be `{chapter_id: slug, t: number >= 0}` or absent; append is a single `O_APPEND` write (two interleaved appends never produce a torn line: run 200 appends from `Promise.all`); replies need `in_reply_to` matching an existing event id; sources are `[{file, lines}]` with the same path-safety rules as the audit (no absolute paths, no `..`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: events and thread files`.

---

### Task 4: HTTP guard and server skeleton (`lib/http-guard.cjs`, `server/server.cjs`, `lib/server-cli.cjs`)

**Interfaces:** Produces `createGuard({key, port}) -> {check(req) -> {ok, status, reason}}` (key via `?key=`, cookie `yap_key`, or `x-yap-key`; `Host` must be `127.0.0.1:<port>` or `localhost:<port>`; for POST, `Origin` absent or equal to `http://127.0.0.1:<port>`/`http://localhost:<port>`), `readJsonBody(req, {maxBytes}) -> Promise<object>`, `startServer({slugDir, key?, port?: 0, deps}) -> {url, key, port, close()}`, and CLI `yap serve [--dir <slugDir>] [--detach]` (the `--detach` form spawns a detached child, waits for `state/server.json`, prints the URL, exits 0). `state/server.json` = `{url, key, port, pid, started_at}` written with mode 0600. `GET /` sets the cookie and returns the placeholder page (a plain list of chapters from the manifest with a `<video controls>` per ready chapter; no scripts needed).

- [ ] **Step 1: Write failing tests** (`tests/http-guard.test.cjs`, `tests/server-basic.test.cjs`, real server on port 0 in a temp dir): no key => 403 on every route; wrong key => 403; key in query sets the cookie and later cookie-only requests pass; header key passes; `Host: evil.example` => 403 even with the right key (DNS rebinding, Review Focus 1); `Host: 127.0.0.1:<port>` and `localhost:<port>` pass; POST with `Origin: https://evil.example` => 403, with no Origin passes, with the server's own origin passes; the server listens only on 127.0.0.1 (check `server.address()`); `readJsonBody` rejects bodies over the cap (413), invalid JSON (400), wrong content type (415), a body that arrives slowly forever (timeout 408); `state/server.json` exists, is mode 0600, and holds the key; the key is at least 128 bits of randomness (32 hex chars) and differs between starts; unknown route 404 JSON; `close()` frees the port.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (router as a small table; every handler wrapped so an exception becomes a 500 JSON without a stack trace). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: local server skeleton with key, host and origin checks`.

---

### Task 5: Video and poster serving with range requests (`lib/range.cjs` + routes)

**Interfaces:** Produces `parseRange(header, size) -> {kind:'none'|'single'|'invalid'|'unsatisfiable', start?, end?}` and `serveFile(req, res, absPath, {contentType})`; routes `GET|HEAD /chapters/:id/video`, `GET /chapters/:id/poster`, `GET /chapters/:id/captions`. The server resolves `:id` through the manifest only, then re-checks that the real path of the file sits inside the chapter folder (no symlink escape) and is a regular file.

- [ ] **Step 1: Write failing tests** (`tests/range.test.cjs`, `tests/server-media.test.cjs`): no Range => 200 with `Accept-Ranges: bytes`, `Content-Length`, correct bytes; `bytes=0-` and `bytes=10-` and `bytes=-5` and `bytes=2-3` => 206 with the exact slice and `Content-Range`; `bytes=999999-` past the end => 416 with `Content-Range: bytes */<size>`; multiple ranges, a reversed range, `bytes=abc` => ignored (200 whole file) or 416 per RFC 7233 (choose and test one rule: treat multi-range as the whole file, invalid syntax as the whole file, unsatisfiable as 416); `HEAD` returns the headers with no body; content type `video/mp4`; an id with `../`, `%2e%2e`, backslash, NUL, or an unknown id => 404 with no path leaked; a `chapter.mp4` symlink to outside => 404 (Review Focus 2); a chapter whose status is not `ready` returns 404 for `/video` (Review Focus 6); a file that shrinks after the size was read does not hang the response (stream error ends the connection cleanly); the response never includes the absolute path in headers or body.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (stream with `fs.createReadStream({start, end})`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: video and poster serving with range requests`.

---

### Task 6: State, live updates, chat and chapter routes (`lib/sse.cjs` + routes)

**Interfaces:** Routes (all behind the guard): `GET /api/state` -> `{manifest, thread, claude_connected, now}`; `GET /api/stream` (SSE; events `state`, `reply`, `chapter`, `ping` every 15 s; each `data:` line is JSON; a new client gets one `state` event first); `POST /api/message` (browser -> `events.jsonl`, returns the event); `POST /api/reply` (Claude -> `thread.jsonl` and broadcast); `POST /api/chapters` with `{op:'add'|'reorder'|'set', ...}` (the only way Claude changes the manifest: validated with Task 1, saved through ONE promise queue so writes never interleave); `POST /api/heartbeat` (records the time; `claude_connected` is true when the last heartbeat is under 15 s old). Errors are JSON `{error}` with the right status; no stack traces.

- [ ] **Step 1: Write failing tests** (`tests/server-api.test.cjs`, `tests/sse.test.cjs`): state shape and that it never contains absolute paths; `POST /api/message` appends exactly one line and returns the event; invalid JSON 400, huge body 413, NUL byte 400, unknown type 400 (Review Focus 5); reply for an unknown event id 400; the SSE client gets `state` first, then a `reply` event when one is posted, and `ping`s (use a short test interval); a client that disconnects is removed (no leak: hub size returns to 0); `claude_connected` is false at start, true after a heartbeat, false again after 15 s (inject a clock) (Review Focus 7); **concurrency:** 50 simultaneous `POST /api/chapters` (add/set mix) leave a valid manifest containing all of them and no temp files (Review Focus 4); `add` with a duplicate id 409; `add after` an unknown parent 400; `reorder` with a non-permutation 400 and no change; `set` of `status:'ready'` for a chapter whose scan status is not ready is refused 409 (the server never claims ready what the files do not prove); a crash simulated mid-save keeps the old manifest.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: state, live updates, chat and chapter routes`.

---

### Task 7: Watcher and posters (`lib/watcher.cjs`, `lib/poster.cjs`)

**Interfaces:** Produces `startWatcher({slugDir, onChange, intervalMs, fs})` (polling `scanProject` every second; native watchers are unreliable on macOS network and temp folders, so poll) returning `{stop()}`; `onChange(diff)` where `diff` lists chapters whose scan status or `build_sha256` changed. `extractPoster({ffmpeg, mp4, out, atS}) -> Promise` via an injected `exec` (frame at 1 s or half the duration if shorter). The server wires them: on a chapter becoming `ready` it extracts `poster.jpg` (once per `build_sha256`), updates its manifest row (`status`, `duration_s`, `build_sha256`, `verified_against_commit`, `poster`) and broadcasts a `chapter` event; on a chapter going `stale` it flips the row and broadcasts. New chapter folders found by the scan are added in `order.json` order (amendment A8) with `placement_reason: 'core'`; if `order.json` is absent they are added alphabetically.

- [ ] **Step 1: Write failing tests** (`tests/watcher.test.cjs`, `tests/poster.test.cjs`, fake clock and fake ffmpeg exec): a new ready chapter appears in the manifest within one poll and a `chapter` event is broadcast; deleting `chapter.mp4` flips it to `stale` (Review Focus 6); editing `build.json` flips it to `stale`; re-rendering back to current flips it to `ready` again and re-extracts the poster only because `build_sha256` changed; poster extraction is called with argv arrays and absolute paths (an id named `--evil` never becomes an option); a failing ffmpeg leaves `poster: null` and an issue, the chapter stays `ready`; order follows `order.json`; unknown ids in `order.json` are ignored; a chapter in the manifest whose folder disappears is marked `failed` with a reason, not deleted; polling errors (unreadable folder) do not kill the watcher; `stop()` clears the timer.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: watcher, status flips and poster frames`.

---

### Task 8: Export (`lib/export.cjs`, route `POST /api/export`)

**Interfaces:** Produces `exportVideo({manifest, slugDir, destDir, ffmpeg, exec, mode:'full'|'drafts'}) -> {file, files[]}`. Joins the `ready` chapters in manifest order with the ffmpeg concat demuxer (a list file with escaped single-quoted absolute paths, `-c copy` because all chapters share encoding settings; fall back to re-encode only if the copy attempt fails), then writes `<slug>.mp4`, `script.md` and `sources.json` into `destDir`. The route takes `{dest}` and refuses anything not an absolute path to an existing directory the user chose (no `..`, not the project's `.yap` folder, not a symlink to elsewhere); it never overwrites an existing `<slug>.mp4` (adds `-2`, `-3`).

- [ ] **Step 1: Write failing tests** (`tests/export.test.cjs`, fake `exec`): concat list order equals manifest order and skips non-ready chapters (reported in the result); quotes and spaces and a single quote in a path are escaped correctly in the list file; no ready chapter => clear error, nothing written; existing output name gets a numeric suffix; `dest` relative, nonexistent, a file, or inside `.yap` => 400; argv arrays only; a failing ffmpeg removes the partial output and reports the reason; `script.md` and `sources.json` are copied byte for byte.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: export`.

---

### Task 9: Client commands (`lib/client-cli.cjs`)

**Interfaces:** `yap reply --in-reply-to <evt> --text <text> [--source file:a-b ...]`, `yap add-chapter --id <id> [--after <id>] [--title <t>] [--parent <id>] [--reason <text>]`, `yap set-status --id <id> --status <s>` and `yap order <id,id,...>` (writes `.yap/<slug>/order.json`, amendment A8). The first three read `state/server.json`, send the request with the key header, print one line, and exit 0/1/2 (2 for usage, 1 when the server refuses or is not running, with the sentence "no server is running: start it with `yap serve --detach`").

- [ ] **Step 1: Write failing tests** (`tests/client-cli.test.cjs`, a real server on port 0): each command's happy path changes the manifest/thread as expected; missing `server.json` => exit 1 with the sentence; stale `server.json` (pid dead, port closed) => exit 1; server 4xx surfaces its `error` text; `yap order` validates ids with the slug rule and writes atomically; unknown flags exit 2.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: client commands for the server`.

---

### Task 10: Skill updates (`skills/yap/`)

**Interfaces:** Consumes Tasks 4 and 9. The skill (a) writes `order.json` with `yap order` right after the storyboard and before the first scaffold, and rewrites it if chapters are added; (b) after the last render, runs `yap serve --detach` (a foreground command that returns quickly; the server itself is the one allowed background process) and prints the URL it returns; (c) hand-off now says the chapters are served at that URL and still lists the mp4 paths; (d) keeps every existing rule (foreground renders, never end the turn while a render runs, time limits, files only under `.yap/<slug>/`).

- [ ] **Step 1: Write failing lint tests** (`tests/skill-lint.test.cjs`, extend): `yap order` appears before `yap scaffold` in SKILL.md's flow; `yap serve --detach` appears after the final render step; the skill never tells Claude to run `yap serve` without `--detach`; every `yap <command>` mentioned exists; the banned-word rule still holds; no file tells Claude to start renders in the background (the server is the only exception and the lint must allow exactly `yap serve --detach`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Edit the skill files.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: skill writes order.json and starts the server`.

---

### Task 11: Acceptance in a real browser

**Files:** `docs/phase-2/ACCEPTANCE.md`, `tests/phase2-acceptance.cjs` (run by hand, not part of `npm test`).

**Interfaces:** Consumes everything. Uses synthetic chapter folders (tiny H.264 clips from the static ffmpeg's `testsrc2`, hand-written `chapter.json`/`beats.json`/`build.json`/`render.json` that satisfy the Phase 1 contract) so no Claude run or TTS is needed. Needs `source spikes/env.sh` (broken Homebrew ffmpeg).

- [ ] **Step 1:** Build a synthetic project with 4 chapters (one deliberately `stale`) in a temp dir; start `yap serve --detach`; check `state/server.json`.
- [ ] **Step 2: curl checks:** 403 without key; 200 with; a ranged request returns 206 with the right bytes; `GET /api/state` lists 4 chapters in `order.json` order with the stale one marked.
- [ ] **Step 3: Real Chrome check** (claude-in-chrome tools): open the URL, confirm the placeholder page lists the chapters, each ready video loads its metadata (duration matches the manifest), playing and seeking inside chapter 2 works (range requests), the stale chapter shows no video. Save screenshots under `docs/phase-2/frames/`.
- [ ] **Step 4: Live update check:** with the page open, rename `chapter.mp4` of one chapter and confirm via `/api/state` and the SSE stream that it flips to `stale` within 3 s; restore it and confirm `ready`; post a message with `POST /api/message` and a reply with `yap reply`; confirm the thread shows both.
- [ ] **Step 4b: Heartbeat:** `claude_connected` false, send a heartbeat, true, wait 16 s, false.
- [ ] **Step 5: Export** to a temp folder with the static ffmpeg and confirm the joined video's duration equals the sum of the ready chapters (ffprobe) within 0.2 s, plus `script.md` and `sources.json`.
- [ ] **Step 6: Hostile checks against the real server:** a request with a forged `Host`, a path-escaping id, a 10 MB body, a `Range: bytes=999999999-`; record each response.
- [ ] **Step 7: Commit** `docs: phase 2 acceptance results`.

---

### Task 12: Roll-up and review

- [ ] **Step 1:** `npm test` totals; list the files and routes added; write `docs/phase-2/SUMMARY.md` (what was built, the exact server API, the manifest as written, results of Task 11 with numbers, what was not proven, proposed spec amendments, and what Phase 3 (the player) can rely on).
- [ ] **Step 2: Self-check** that every Review Focus line has a named passing test or an acceptance step, and list them in the summary.
- [ ] **Step 3: Commit** `docs: phase 2 summary`.
- [ ] **Step 4:** Hand the branch to a fresh whole-branch reviewer (most capable model) with the plan, the spec, the Review Focus and the ledger rulings.

---

## Out of scope for Phase 2 (so nobody builds it by accident)

The React player (Phase 3), the chat bridge and `yap listen` (Phase 4), the `npx yap-setup` installer, the headless fallback, drag-to-reorder, word-by-word caption display, a real marketplace install test, and changes to how chapters are generated.

## Order of work

Task 0 first (needs the owner's approval of the amendments). Tasks 1 to 3 are independent and small. Task 4 needs Task 1 (manifest) for the placeholder page. Task 5 needs 2 and 4. Task 6 needs 1, 3 and 4. Task 7 needs 2, 4 and 6. Task 8 needs 1 and 4. Task 9 needs 4 and 6. Task 10 needs 4 and 9. Task 11 needs everything. Estimated effort: Tasks 1 to 3 about 30 to 45 minutes each, Tasks 4 to 8 about 60 to 90 minutes each, Tasks 9 and 10 about 45 minutes each, Task 11 about an hour, Task 12 about 30 minutes.
