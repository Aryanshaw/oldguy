# Phase 2 summary: the manifest and the local server

Date: 2026-10-03. Branch `phase-2-server`: 25 commits above `46f59cd` (the tip of `phase-1-generator` it was
cut from; first `f81c83c`, last `f598229`). `npm test`: 575 tests, 575 pass, 0 fail (Node 26.7.0, 8.7 s, run for
this summary at `f598229`). Acceptance script: 61 of 61 checks, three runs in a row, plus 8 of 8 checks by hand
in Chrome.

> **Read section 11 first.** Sections 1 to 10 describe the branch at `f598229`, before the final whole-branch
> review. That review found four more defects, which were fixed in five commits (`3619183` to `ef84d53`).
> The branch tip is now `ef84d53`: 30 commits above `46f59cd`, `npm test` 596 of 596, acceptance script still
> 61 of 61. Section 11 lists what those commits changed and which statements in sections 2, 3, 4 and 8 they
> overtake.

This document is the roll-up the plan's Task 12 asks for. It is written for a reader who was not here. The
detailed run results are in [ACCEPTANCE.md](ACCEPTANCE.md); this file says what was built, what the results
mean, and what is still open. Every statement about behaviour was checked against the code at `f598229`;
`file:line` references are to that commit.

**Terms used throughout.** *Yap* is a Claude Code plugin that turns "explain how X works in this codebase" into
a few short narrated *chapter* videos (Phase 1 built that part). A *slug folder* is `.yap/<slug>/` in the user's
project: one folder per video. The *manifest* is `manifest.json` in the slug folder: the ordered list of chapters
and what state each is in. A *row* is one chapter's entry in the manifest. The *server* is a small web server
that runs on the user's own machine, on the address `127.0.0.1` (reachable only from that machine). The *session
key* is a random 32-character secret made at each server start; every request must carry it. *SSE* (server-sent
events) is the standard way a web page keeps one connection open and receives a stream of named events. The
*build* of a chapter is the fingerprint file `build.json` that Phase 1's `yap narrate` writes; `render.json`
names the build a video was made from. The *ledger* is the work log
`.superpowers/sdd/2026-10-03-phase-2-manifest-server/progress.md`. The *controller* is the Claude session that
ran the plan, handed each task to an implementer and a reviewer, and took decisions where the plan was silent.

---

## 1. What Phase 2 delivered

A manifest and a server with no installed packages (Node's standard library only). `yap serve` starts the
server for one slug folder. The server looks at the chapter folders once a second, keeps `manifest.json` in step
with what the files prove, takes one poster picture per ready chapter with ffmpeg, serves each ready chapter's
video with byte-range support (so a browser can seek), stores viewer messages and Claude's replies in two plain
files, pushes live updates to open pages, and can join the ready chapters into one mp4 in a folder the viewer
names. Four new commands let Claude talk to it (`yap reply`, `yap add-chapter`, `yap set-status`) and write the
story order (`yap order`). The skill now writes the story order before the first chapter and starts the server
after the last render. The page at `/` is a placeholder (a list of chapters with a plain `<video>` each); the
real player is Phase 3.

### 1.1 Files

New code: 16 files, 2,176 lines (4 in `server/`, 12 in `lib/`). Line counts from `git diff --stat 46f59cd..HEAD`.

| File | Lines | What it is |
|---|---|---|
| `server/server.cjs` | 281 | start and stop, the route table, the placeholder page, the media routes, the one manifest write queue, `state/server.json` |
| `server/api.cjs` | 198 | the JSON routes: state, stream, message, reply, chapters, heartbeat (not in the plan's file list; accepted by ruling 13) |
| `server/chapter-sync.cjs` | 134 | turns what the watcher saw into manifest rows and queues poster pictures (not in the plan's file list; ruling 17) |
| `server/export-route.cjs` | 41 | `POST /api/export`: checks the body, allows one export at a time (not in the plan's file list) |
| `lib/manifest.cjs` | 179 | the manifest model: validate, insert, reorder, set fields, timeline, atomic save, load |
| `lib/chapter-scan.cjs` | 196 | reads chapter folders and `order.json`; decides ready, stale, rendering or pending |
| `lib/events.cjs` | 155 | `state/events.jsonl` (viewer to Claude) and `state/thread.jsonl` (Claude to viewer): append, read, validate |
| `lib/range.cjs` | 108 | parses a `Range` header and streams the right bytes of one checked file |
| `lib/http-guard.cjs` | 128 | the Host, Origin and key checks, and the size- and time-limited JSON body reader |
| `lib/sse.cjs` | 66 | the hub of open event streams: add, broadcast, ping, drop a client that stops reading |
| `lib/poster.cjs` | 50 | one ffmpeg frame grab to `poster.jpg` |
| `lib/export.cjs` | 228 | joins ready chapters with ffmpeg and copies `script.md` and `sources.json`, never replacing a file |
| `lib/watcher.cjs` | 71 | looks at the folders every second and reports what changed |
| `lib/server-cli.cjs` | 105 | `yap serve [--dir] [--detach]` |
| `lib/client-cli.cjs` | 180 | `yap reply`, `yap add-chapter`, `yap set-status`, `yap order` |
| `lib/ask-server.cjs` | 56 | the one HTTP client the commands use (not in the plan's file list; added in Task 9) |

Changed: `bin/yap.cjs` (+7 lines, five new commands in the table), `lib/audit.cjs` (the `escapesRoot` path check
pulled out so `lib/events.cjs` can reuse it), `skills/yap/SKILL.md` and `skills/yap/references/render.md`
(`yap order`, `yap serve --detach`, the new hand-off), `docs/superpowers/specs/2026-10-02-yap-design.md` (+141
lines: section 14, the Phase 1 amendments A1 to A9 the owner approved, plus a "Phase 2 additions" list).

Tests: 14 new files under `tests/` (`manifest`, `chapter-scan`, `events`, `http-guard`, `server-basic`,
`server-cli`, `range`, `server-media`, `server-api`, `sse`, `watcher`, `poster`, `export`, `client-cli`), an
extended `tests/skill-lint.test.cjs`, and `tests/phase2-acceptance.cjs` (843 lines, run by hand, not part of
`npm test`). Docs: `docs/phase-2/README.md`, `ACCEPTANCE.md`, `frames/placeholder-page-chrome.jpg`, this file.

### 1.2 Numbers

- **Commits:** 25 in `46f59cd..f598229`: 10 `feat:`, 12 `fix:`, 1 `test:`, 2 `docs:` (the spec amendments and
  the acceptance results; this file adds one more).
- **Tests:** 575 of 575 pass (my run, Node 26.7.0, 8.7 s). Phase 1 ended at 304, so Phase 2 added 271. No test
  uses real ffmpeg, the network, Hyperframes or Claude; servers in tests listen on a free port in a temp folder.
- **Acceptance:** 61 of 61 scripted checks against a real server, real ffmpeg and real HTTP, three consecutive
  runs at commit `570a58c`; 8 of 8 hand checks in Google Chrome 154. Details in section 5.

---

## 2. The server API exactly as built

Taken from the code, not from the plan. Where the code differs from the plan or the spec, the row says so.

### 2.1 Rules that apply to every request

Checked in this order, before any route is looked up (`server/server.cjs:144-146`, `lib/http-guard.cjs:42-56`).
Every refusal is `403 {"error":"forbidden"}` with no further reason.

| Rule | Exactly |
|---|---|
| Address | The server listens on `127.0.0.1` only, on a free port chosen by the system at each start (`server/server.cjs:235`). |
| Host check | The `Host` header must be exactly `127.0.0.1:<port>` or `localhost:<port>` (letter case ignored). Anything else, or no `Host`, is refused. This is what stops a hostile website whose name was pointed at `127.0.0.1`. |
| Origin rule | For every method except `GET` and `HEAD`: if an `Origin` header is present it must be `http://127.0.0.1:<port>` or `http://localhost:<port>`; `Origin: null` is refused; no `Origin` header passes (that is how the CLI calls). The plan said "POSTs"; the code is stricter and covers every method that is not a plain read (`lib/http-guard.cjs:49-51`). |
| Key sources | The key is read from the first of these that is present: the `x-yap-key` header, then the cookie named `yap_key_<port>`, then the `?key=` query value (`lib/http-guard.cjs:20-32`). A wrong header is not rescued by a right cookie. Compared in constant time. |
| The cookie | Set only by `GET /?key=<key>`, which answers `302` to `/` with `Set-Cookie: yap_key_<port>=<key>; HttpOnly; SameSite=Strict; Path=/` (`server/server.cjs:48-50`). It has no expiry (it lasts for the browser session). **Differs from the plan and spec, which say a cookie named `yap_key`**: the port is in the name so two Yap servers on one machine do not overwrite each other's cookie (ruling 11). |
| Headers on every response | `Content-Security-Policy: default-src 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` (`server/server.cjs:18-23`). The last one applies to videos too. |
| Request bodies | Every `POST` body must be `Content-Type: application/json` (else `415`), one JSON object (else `400`), at most 65,536 bytes (else `413`), and must arrive within 10 seconds (else `408`) (`lib/http-guard.cjs:65-104`). After a 413 or 408 the answer is sent first and the connection is then dropped. |
| Server timeouts | 10 s to send the request headers, 30 s for the whole request (`server/server.cjs:231-232`). An open event stream and a video download are responses, so they are not cut. |
| Routing errors | Unknown path: `404 {"error":"not found"}`. Known path, wrong method: `405 {"error":"method not allowed"}`. A request target that cannot be parsed: `400 {"error":"bad request"}`. A handler that fails unexpectedly: `500 {"error":"internal error"}` with the detail written to the server's error output only. Error bodies are always one line of JSON `{"error": "<text>"}`. |

A URL never names a file path. Media routes take a chapter id, require it to be a plain slug that is listed in
the manifest, and build the path from the slug folder, the id and a fixed file name (`server/server.cjs:63-91`).

### 2.2 Routes

"Browser" means the page (today the placeholder, in Phase 3 the player). "CLI" means the `yap` commands.
Common statuses from 2.1 (403, 404, 405, 413, 415, 408, 500) are not repeated in each row.

| Method and path | Called by | Request | Success | Errors specific to it |
|---|---|---|---|---|
| `GET /` | browser | optional `?key=<key>` | With `key` in the query: `302`, `Location: /`, sets the cookie. Without: `200 text/html`, the placeholder page (title, each chapter's title and status, a `<video>` for each `ready` row, no scripts). | `500` if `manifest.json` became unreadable after start |
| `GET /api/ping` | CLI (`yap serve --detach`) | none | `200 {"ok":true,"pid":<server process id>}` | none. **Not in the spec's endpoint table.** |
| `GET /chapters/:id/video` and `HEAD` | browser | optional `Range: bytes=...` | `200` whole file, or `206` with `Content-Range` for one range; always `Accept-Ranges: bytes`, `Content-Length`, `Content-Type: video/mp4`. `HEAD` gives the headers only. | `404` when the id is not a listed slug, the row is not `ready`, the files on disk are not ready *at this moment* (re-checked per request, ruling 5), or the file is a link out of the folder, missing or swapped between check and open. `416` with `Content-Range: bytes */<size>` when the range starts past the end. Several ranges, a reversed range or a non-`bytes` unit are ignored and the whole file is sent (`lib/range.cjs:9-24`). `HEAD` is not in the spec's table. |
| `GET /chapters/:id/poster` | browser (not used by the placeholder page) | optional `Range` | `200 image/jpeg` | `404` unless the row's `poster` field is set, even if a `poster.jpg` file exists. `HEAD` is `405`. **Not in the spec's table.** |
| `GET /chapters/:id/captions` | browser (not used by the placeholder page) | optional `Range` | `200 text/vtt; charset=utf-8` (the chapter's `captions.vtt`) | `404` when the row or the file is missing. Does not require `ready`. **Not in the spec's table.** |
| `GET /api/state` | browser | none | `200 {"manifest": <the manifest>, "thread": [...], "claude_connected": true or false, "now": <server clock, ms>}`. Thread entries are described in 2.4. | `500` if the manifest is unreadable |
| `GET /api/stream` | browser | none | `200 text/event-stream`, stays open; the first event is `state` (see 2.3) | none |
| `POST /api/message` | browser | `{"type": "message" or "make_video" or "just_text" or "retry_chapter" or "export", "text": <up to 4000 characters; required for "message">, "context": {"chapter_id": <slug>, "t": <seconds, 0 or more>}}`; `text` and `context` optional except as noted; other fields are ignored | `200 {"event": {"id":"evt_<n>","ts":<ISO time>,"type":...,"text":...,"context":...}}`; one line is appended to `state/events.jsonl`; a `state` event goes to every open stream | `400` for an unknown type, missing or over-long text, a NUL byte, a context that is not exactly `{chapter_id, t}`, or a stored line over 8,192 bytes |
| `POST /api/reply` | CLI (`yap reply`) | `{"in_reply_to": "evt_<n>", "text": <1 to 4000 characters>, "sources": [{"file": <relative path inside the project>, "lines": "12" or "12-20"}]}`; `sources` optional | `200 {"reply": {"id":"rep_<n>","ts":...,"in_reply_to":...,"text":...,"sources":[...]}}`; one line appended to `state/thread.jsonl`; a `reply` event goes to every open stream | `400` when `in_reply_to` is not a stored event id, the text is missing or too long, or a source path is absolute or leaves the project |
| `POST /api/chapters` | CLI (`yap add-chapter`, `yap set-status`); `reorder` has no CLI command | one of three shapes, by `op` (below) | `200 {"manifest": <the new manifest>}`; a `chapter` event goes to every open stream | below |
| ... `op: "add"` | | `{"op":"add","id":<slug>,"title"?, "parent_id"?, "placement_reason"?, "question"?, "after"?}`; any other field is refused | a new row with status `pending`, quality `draft`, title defaulting to the id; placed right after `after`, else right after `parent_id`, else at the end (`server/api.cjs:123-138`) | `409` the id already exists; `400` wrong type, unknown field, `after` or `parent_id` naming no chapter, or an id that is not a slug |
| ... `op: "reorder"` | | `{"op":"reorder","ids":[every chapter id exactly once]}` | the rows in that order | `400` for anything that is not a full permutation; the manifest is unchanged |
| ... `op: "set"` | | `{"op":"set","id":<slug>,"fields":{...}}` where fields may hold only `status`, `quality`, `title`, `placement_reason`, `question` | the row with those fields changed | `404` unknown id; `400` a field outside that list or a bad value; `409` when `status` is set to `ready` and the files on disk do not prove a current video right now (`server/api.cjs:157-159`); `500 {"error":"could not save the manifest"}` when the save fails |
| `POST /api/heartbeat` | Claude (no command sends it yet; `yap listen` is Phase 4) | any JSON object, for example `{}` | `200 {"ok":true}`; `claude_connected` is true for the next 15 seconds; a `state` event is sent only if this beat turned it from false to true | none |
| `POST /api/export` | browser (no CLI command; the placeholder page has no button) | `{"dest": <absolute path of an existing folder>, "mode": "full" or "drafts"}`; `mode` optional, default `full`; any other field is refused | `200 {"file": "<slug>.mp4", "files": [names written], "skipped": [{"id", "reason"}]}`, base names only | `400` bad `dest` (relative, holds `..`, not an existing folder, a link, or the project's `.yap` folder or inside it), bad `mode`, unknown field; `409` an export is already running, no ready chapter, a ready chapter is still a draft in `full` mode (the message names them), the manifest slug is not a plain file name, the folder cannot be written into, or no free name was found; `500` with a one-line reason (`ffmpeg failed: <last line, paths cut to base names>`, `export was stopped`, or `could not write the export files`); `503` while the server is closing. **`mode`, `files` and `skipped` are not in the spec** (ruling 18). |

`reorder` is reachable only by a direct `POST`; no row can be removed through the API (there is no delete op).

### 2.3 Stream events

Wire format: `event: <name>`, then `data: <one line of JSON>`, then a blank line (`lib/sse.cjs:5-7`). No `id:` or
`retry:` lines are sent, so a page that reconnects simply gets a fresh `state` first.

| Event | When | Payload |
|---|---|---|
| `state` | first thing on every new stream; after each stored `POST /api/message`; when a heartbeat turns `claude_connected` from false to true | the same object as `GET /api/state`: `{manifest, thread, claude_connected, now}` |
| `reply` | after each stored `POST /api/reply` | the stored reply plus `"role":"claude"`: `{id, ts, in_reply_to, text, sources?, role}` |
| `chapter` | after a `POST /api/chapters` | `{op: "add" or "reorder" or "set", id?, manifest}` (`id` absent for `reorder`) |
| `chapter` | after the watcher changed rows | `{op:"scan", manifest}` |
| `chapter` | when a chapter folder that was seen earlier is gone | `{op:"scan", id, reason:"chapter folder is missing", manifest}` |
| `chapter` | after a poster was recorded | `{op:"scan", id, manifest}` |
| `ping` | every 15 seconds | `{now: <ms>}` |

No event is sent when `claude_connected` turns false 15 seconds after the last heartbeat; the value is worked out
when someone asks (`server/api.cjs:43-45`). See section 8, "found while writing this summary".

A stream whose reader stops reading is dropped once more than 1 MB is waiting for it (`lib/sse.cjs:12,24`).

### 2.4 The chat files and the thread

- `state/events.jsonl`: one viewer event per line, ids `evt_1`, `evt_2`, ... The next id is the largest valid id
  in the file plus one (ruling 10), so ids never repeat or go backwards even after a hand edit. A broken, partial
  or odd-id line is skipped, never fatal.
- `state/thread.jsonl`: one reply per line, ids `rep_1`, `rep_2`, ... It holds replies only (ruling 4).
- The `thread` in `/api/state` is the `message` events (each with `"role":"viewer"`) merged with the replies
  (each with `"role":"claude"`), sorted by `ts`, viewer first on a tie (`server/api.cjs:54-60`). Events of the
  other four types are stored but do not appear in the thread, and no route returns them (checked by a probe: a
  stored `export` event left the thread length unchanged).

### 2.5 Commands

All commands take `--dir <slugDir>`; without it they use the only folder under `./.yap/` that holds a
`chapters/` folder, and stop with a usage error if there is none or more than one (ruling 7,
`lib/server-cli.cjs:13-24`). Every command prints one line. Lines from the server are flattened to one line and
cut at 300 characters.

| Command | Does | Prints on success | Exit codes |
|---|---|---|---|
| `yap serve [--dir <slugDir>]` | runs the server in the foreground until Ctrl-C or SIGTERM, then closes cleanly and removes `state/server.json` | the URL, `http://127.0.0.1:<port>/?key=<key>` | 0 after a clean stop; 2 for bad usage **and for any start failure** (for example an invalid `manifest.json`), printed as `yap serve: <reason>` (`lib/server-cli.cjs:99-102`) |
| `yap serve --detach [--dir <slugDir>]` | if a server for this folder is alive (its `state/server.json` names a port and key whose `/api/ping` answers with the same process id) it is reused; otherwise a stale `server.json` is removed and a background server is started and waited for, up to 10 s | the URL (rebuilt from the port and key, never copied from the file) | 0 URL printed; 1 `a server for this folder is running but not answering` (process alive, silent for 5 s) or `yap serve: the server did not start within 10 seconds`; 2 bad usage |
| `yap reply --in-reply-to <evt_n> --text <text> [--source <file>:<a>-<b> ...]` | `POST /api/reply`; `--source` may repeat and is split at the last colon | `reply rep_<n> sent` | 0 / 1 / 2 (below) |
| `yap add-chapter --id <id> [--after <id>] [--title <t>] [--parent <id>] [--reason <text>]` | `POST /api/chapters` with `op:"add"`; there is no flag for `question` | `chapter <id> added at position <n>` (1-based) | 0 / 1 / 2 |
| `yap set-status --id <id> --status <pending or rendering or ready or failed or stale>` | `POST /api/chapters` with `op:"set"` and only the status | `chapter <id> is <status>` | 0 / 1 / 2 |
| `yap order <id,id,...>` | writes `<slugDir>/order.json` as `{"chapters":[...]}` atomically; needs no server | `order written: <n> chapters` | 0; 1 `yap order: could not write order.json (<code>)`; 2 bad ids, a repeat, an empty list or extra words |

For `reply`, `add-chapter` and `set-status`: exit 2 means the arguments were refused before anything was sent
(`yap <command>: <reason>`), including an id that is not a plain slug. Exit 1 means the request did not succeed,
with one of: ``no server is running: start it with `yap serve --detach` `` (no usable `server.json`, nothing
listening, or the process is gone), `the server did not answer in time` (5 s, one deadline for the whole
request), `the server answered in a way yap could not read`, `the server sent an unexpected answer`, or the
server's own error text. The commands read the port and key from `state/server.json` and always connect to
`127.0.0.1`; a `server.json` with an odd port, pid or key is treated as "no server".

`state/server.json` is `{url, key, port, pid, started_at}`, mode 0600, written as a new file and renamed into
place so it is never written through a link (`server/server.cjs:173-187`); the server refuses to start if
`state/` is a link. It is removed on a clean stop.

---

## 3. The manifest as written

### 3.1 Shape

Top level (`lib/manifest.cjs:24-26`): `version` (always 1), `title`, `slug`, `audience`,
`verified_against_commit`, `chapters`. When no `manifest.json` exists the server creates one with `title` and
`slug` both set to the slug folder's name and `audience` `"beginner"` (ruling 2, `server/server.cjs:162-168`).
The top-level `verified_against_commit` is created `null` and nothing ever sets it; the per-row field is the one
that is filled. A `manifest.json` that exists but is invalid stops the start; it is not repaired or replaced.

Each row has exactly these 13 fields; any other field makes the manifest invalid (`lib/manifest.cjs:12-16`).

| Field | Values | Where it comes from |
|---|---|---|
| `id` | a slug (`[a-z0-9-]`, starts with a letter, the Phase 1 rule); unique | the chapter folder's name, or `--id` |
| `title` | non-empty text | `chapter.json`'s `title` when the watcher creates the row (the id if there is none); `--title` or the id when added through the API. Not refreshed afterwards except by `op:"set"`. |
| `parent_id` | `null` or an existing id; no cycles | `null` for watcher rows; `--parent` for added rows |
| `placement_reason` | text or `null` | `"core"` for watcher rows; `--reason` or `null` for added rows |
| `status` | `pending`, `rendering`, `ready`, `failed`, `stale` | 3.2 |
| `quality` | `draft` or `full` | always `draft` unless set through the API; Phase 2 makes no full-quality renders |
| `duration_s` | `null` or seconds, 0 or more | `beats.json`'s `durationS`, re-read at every change |
| `video` | `null` or a relative path | `chapters/<id>/chapter.mp4` for watcher rows, whether or not the file exists yet; `null` for rows added through the API (see section 8) |
| `poster` | `null` or `chapters/<id>/poster.jpg` | set after a frame grab succeeded; 3.3 |
| `captions` | `null` or a relative path | `chapters/<id>/captions.vtt` for watcher rows, whether or not the file exists; `null` for rows added through the API |
| `question` | text or `null` | `null` unless set through the API |
| `build_sha256` | `null` or 64 hex characters | the sha256 of the folder's `build.json` bytes at the last change |
| `verified_against_commit` | `null` or a commit id | `build.json`'s `verified_against_commit` (only when `build.json` is version 2) |

The three path fields are records, not proof: the routes never read them. Path fields must be relative with no
`..` and no backslash. Order is the array order; nothing else stores it. `lib/manifest.cjs` also exports
`timeline(m)` (start and end second per chapter from the durations); no route uses it.

### 3.2 The five statuses and how each arises

The scan (`decideStatus`, `lib/chapter-scan.cjs:117-121`) can say four things about a folder; it never says
`failed`.

| Status | Arises from the scan when | Arises from the API when | Notes |
|---|---|---|---|
| `ready` | `chapter.mp4` is a real file inside the chapter folder, `build.json` is version 2, and `render.json`'s `build_sha256` equals the sha256 of today's `build.json` bytes | `op:"set"` with `status:"ready"`, but only if the scan says ready at that moment, else `409` | the only status in which the video is served |
| `stale` | a usable `chapter.mp4` exists but the test above fails: `render.json` missing or unreadable, naming a different build, `build.json` missing, edited, or of the old version 1 | `op:"set"` | "there is a video, and it is not proven current" |
| `rendering` | no usable `chapter.mp4`, and the chapter folder holds a `work-*` folder (Hyperframes' work folder) | `op:"set"` | |
| `pending` | no usable `chapter.mp4` and no `work-*` folder; also a chapter folder that is itself a link (it is not read) | `op:"add"` (every new row), `op:"set"` | **A deleted `chapter.mp4` gives `pending`, not `stale`** (ruling 16). The plan's Review Focus 6 and its Task 11 step 4 said "flip to stale". |
| `failed` | never from the scan. The watcher sets it when a chapter folder it has seen earlier in this server run is gone (`server/chapter-sync.cjs:59-63`, ruling 6) | `op:"set"` | A scan of `pending` never overwrites `failed`; `ready`, `stale` and `rendering` from the scan always do (ruling 14, `server/chapter-sync.cjs:10-12`). No reason text is stored in the row. |

The watcher (`lib/watcher.cjs`) scans every 1,000 ms, never two scans at once, and reports new folders, folders
whose status or build hash changed, and folders now gone. The first scan runs before `yap serve` prints the URL,
so the manifest is filled when the page first loads. For a folder it does not know, the sync adds a row; for one
it knows, it updates `status`, `duration_s`, `build_sha256` and `verified_against_commit` only
(`server/chapter-sync.cjs:55`). A chapter folder directly under `chapters/` whose name is not a slug, or which
is a link or a plain file, is skipped.

### 3.3 Posters: "not ready means no poster"

After a row turns `ready` without a poster, or with a new build, one ffmpeg frame is taken (at 1 s, or the middle
if the chapter is shorter than 2 s; 20 s limit), written to a temp file, and moved to `poster.jpg` only if the
chapter is still ready with the same build. Then the row's `poster` is set and a `chapter` event is sent. A
failed grab is logged and leaves `poster: null`; the chapter stays `ready`.

The rule is kept in one place: every manifest change, from any source, passes through a step that sets `poster`
to `null` on every row whose status is not `ready` (`server/server.cjs:191-194`, ruling 19). So a poster in the
manifest always belongs to a row that is `ready` now, and the poster route answers 404 for any row whose
`poster` is `null`.

### 3.4 Order

- `order.json` (`{"chapters":[ids]}`, written by `yap order`) is read by the scan. Ids that are not slugs and
  repeats are dropped; ids with no folder are ignored; folders not named in it follow alphabetically. A file of
  the wrong shape is ignored and the folders are listed alphabetically.
- It **seeds** the manifest: when the manifest is empty, rows are created in that order. A folder that appears
  later is placed right after the nearest chapter that precedes it in `order.json` and is already in the
  manifest; at the front if `order.json` lists it first; at the end if `order.json` does not list it (ruling 15).
- The watcher **never moves an existing row**. After seeding, the only thing that changes the order is
  `POST /api/chapters` with `op:"reorder"`, or `op:"add"` with `after` or `parent_id`. Rewriting `order.json`
  later moves nothing, in the same run or after a restart (checked by a probe; see section 8).

### 3.5 One writer, one queue

Only the server writes `manifest.json`. Every change, from the API, the watcher or the poster step, is a job on
one in-process queue (`server/server.cjs:198-211`): load the file, apply a pure change from `lib/manifest.cjs`,
drop posters of rows that are not ready, validate, write a temp file in the same folder, rename it over the old
one. Jobs run one at a time; a failed job leaves the old file and does not block the next. The one write outside
the queue is the creation of a missing manifest at start, before the server listens.

### 3.6 Example (made by the code, with placeholder values)

This manifest was written by the real server in a temp folder, for this summary: three chapter folders (one
ready, one whose `render.json` names another build, one not rendered), `order.json` listing them in this order, a
stand-in for ffmpeg, then one `op:"add"` request as `yap add-chapter` sends it. The chapter names are borrowed
from Phase 1's example; the `build_sha256` and the commit id (40 times `c`) are test values, not real ones.

```json
{
  "version": 1,
  "title": "add-todo",
  "slug": "add-todo",
  "audience": "beginner",
  "verified_against_commit": null,
  "chapters": [
    {
      "id": "where-the-request-arrives",
      "title": "Where the request arrives",
      "parent_id": null,
      "placement_reason": "core",
      "status": "ready",
      "quality": "draft",
      "duration_s": 30.6,
      "video": "chapters/where-the-request-arrives/chapter.mp4",
      "poster": "chapters/where-the-request-arrives/poster.jpg",
      "captions": "chapters/where-the-request-arrives/captions.vtt",
      "question": null,
      "build_sha256": "92a6f6165e7cc40ad7e4aebfc297e0cd317c95998f64a7066e866a476a499808",
      "verified_against_commit": "cccccccccccccccccccccccccccccccccccccccc"
    },
    {
      "id": "checking-the-title",
      "title": "Checking the title",
      "parent_id": null,
      "placement_reason": "core",
      "status": "stale",
      "quality": "draft",
      "duration_s": 26.2,
      "video": "chapters/checking-the-title/chapter.mp4",
      "poster": null,
      "captions": "chapters/checking-the-title/captions.vtt",
      "question": null,
      "build_sha256": "92a6f6165e7cc40ad7e4aebfc297e0cd317c95998f64a7066e866a476a499808",
      "verified_against_commit": "cccccccccccccccccccccccccccccccccccccccc"
    },
    {
      "id": "what-if-the-title-is-empty",
      "title": "What if the title is empty?",
      "parent_id": "checking-the-title",
      "placement_reason": "follow-up to checking-the-title",
      "status": "pending",
      "quality": "draft",
      "duration_s": null,
      "video": null,
      "poster": null,
      "captions": null,
      "question": null,
      "build_sha256": null,
      "verified_against_commit": null
    },
    {
      "id": "saving-and-replying",
      "title": "Saving and replying",
      "parent_id": null,
      "placement_reason": "core",
      "status": "pending",
      "quality": "draft",
      "duration_s": 25.7,
      "video": "chapters/saving-and-replying/chapter.mp4",
      "poster": null,
      "captions": "chapters/saving-and-replying/captions.vtt",
      "question": null,
      "build_sha256": "92a6f6165e7cc40ad7e4aebfc297e0cd317c95998f64a7066e866a476a499808",
      "verified_against_commit": "cccccccccccccccccccccccccccccccccccccccc"
    }
  ]
}
```

Things the example shows: the title is the folder name; the stale and the unrendered rows still carry a `video`
path; the added row sits right after its parent and has `null` paths.

---

## 4. Results against the plan's goal and the seven Review Focus items

**The goal**, part by part: a `manifest.json` in story order (built, sections 3 and 5); a server with no
installed packages that serves chapter videos with range requests (built; played and seeked in Chrome); the
server as the manifest's only writer (built, 3.5); chat messages and Claude's replies (built; the reply path was
driven by the real CLI, not by a real Claude session); live updates (built; folder changes reached the stream in
0.9 to 1.1 s); export (built; 12.5 s of video joined in 72 to 91 ms, draft quality only).

**The Review Focus items.** "Pinned" means a named test fails if the behaviour regresses. Test names are the
real strings in `tests/` (each was looked up in its file); names starting with a digit and a dot are checks in
`tests/phase2-acceptance.cjs`, which is run by hand and is not part of `npm test`.

| # | Review Focus | Pinned by | Honest status |
|---|---|---|---|
| 1 | A web page in another tab calling the server: no key, hostile `Host`, foreign `Origin`, a guessed port | `tests/http-guard.test.cjs`: "no key, wrong key and wrong-length key are refused with 403", "Host must be exactly 127.0.0.1:port or localhost:port, and is checked before the key", "POST needs an absent or own Origin; null and foreign origins are refused", "a request target the URL parser rejects is refused, never thrown (guard unit)". `tests/server-basic.test.cjs`: "every route refuses without the key and with a wrong key (403 JSON)", "Host: evil.example is refused even with the right key; both own hosts pass", "POST: foreign Origin 403, no Origin and own origin pass the guard (404 for the unknown route)", "two servers each accept their own cookie and refuse the other one", "listens on 127.0.0.1 only, url carries the key, key is 32 hex and differs between starts". `tests/sse.test.cjs`: "stream needs the key (403 without it)". `tests/export.test.cjs`: "route: needs the key". Acceptance: `2.no-key-403-every-route`, `2.wrong-key-403`, `6.forged-host-403`, `6.foreign-origin-post-403`, `6.cookie-wrong-name-403`. | Pinned, with two notes. (a) The unit test named "every route" tries 5 method and path pairs written in Task 4; the check that walks 14 method and path pairs (all 13 routes and one unknown path) without a key is the acceptance script, which `npm test` does not run. The guard does run before the router for every request by construction (`server/server.cjs:145`). (b) "A guessed port" has no test of its own: the defence is the random port plus the 32-hex key, which the last server-basic test pins. |
| 2 | Path escapes: `../x`, encoded slashes, backslashes, NUL, linked chapter folders, `chapter.mp4` pointing outside | `tests/chapter-scan.test.cjs`: "chapter.mp4 symlinked outside the folder is never ready and adds an issue", "a broken chapter.mp4 link is never ready, adds an issue, and follows the no-video rule", "a symlinked chapter folder is skipped by scanProject with an issue that says it is a link", "scanChapter refuses a symlinked chapter folder: pending with a link issue, never ready". `tests/server-media.test.cjs`: "hostile ids are 404 and nothing leaks the temp path" (12 ids, 3 routes each, raw sockets), "a media file that is a link pointing outside the chapter is 404", "a chapter folder that is a link is 404", "chapter.mp4 itself linked to a file outside the chapter is 404 on /video", "file swapped for a link between the check and the open is 404, secret not served". Export: "I-1: an unsafe manifest slug is refused (409): nothing written anywhere, ffmpeg not run", "a chapter.mp4 that is a link out of its folder is skipped". Acceptance: `6.escape-dotdot-slash-404`, `6.escape-dotdot-404`. | Pinned |
| 3 | Range requests as video elements send them; a file that changes size while playing | `tests/range.test.cjs` (all 6 tests, for example "start at or past the end, and bytes=-0, are unsatisfiable", "bad syntax, reversed, other units and multi-range are invalid (whole file)"). `tests/server-media.test.cjs`: "video without Range: 200, whole file, exact length, mp4 type, no-store", "video ranges: open ended, from, suffix and middle give 206 with the exact slice", "unsatisfiable range is 416 with bytes */size; bad and multi ranges get the whole file", "HEAD on video: same headers, no body; HEAD on poster is not allowed", "a file that really shrinks mid-response breaks the connection within a second and the server lives on", "a client that hangs up mid-video does not stop the server". Acceptance: `2.range-100-199`, `2.range-0-open`, `2.no-range-200`, `2.head-video`, `6.range-past-end-416`, and playing and seeking in Chrome. | Pinned |
| 4 | A crash, or two writers on the manifest at once | `tests/manifest.test.cjs`: "a crash between write and rename leaves the old manifest intact and no temp file", "saveManifest writes valid JSON, leaves no temp file, and two saves stay valid". `tests/server-api.test.cjs`: "50 simultaneous chapter writes: valid manifest, every add exactly once, no temp files left", "a failed save keeps the old manifest, answers 500 without detail, and the next request still works", "state.updateManifest is one queue: a failing job does not break the next". | Pinned for one server process. Not covered: two server processes on the same slug folder. `yap serve --detach` reuses a live server instead of starting a second; plain `yap serve` does not check (section 8). |
| 5 | Hostile or broken chat input | `tests/events.test.cjs`: "partial last line is skipped and the next append starts a fresh line", "garbage lines are skipped, not fatal", "validation: unknown type, text limits, NUL, context shape", "whole line over maxBytes is rejected and nothing is written", "partial last thread line is skipped and the next reply starts a fresh line". `tests/server-api.test.cjs`: "hostile message input: every case is a clean 4xx and nothing is stored", "a partial last line in events.jsonl and a hand-edited thread file do not break state or new messages". `tests/http-guard.test.cjs`: "readJsonBody rejects wrong type (415), bad JSON and non-objects (400)", "readJsonBody rejects an over-cap body with 413 and destroys the request, with or without Content-Length". Acceptance: `6.body-10mb-413`, `6.body-10mb-chunked-413`. | Pinned |
| 6 | A chapter that stops being current must flip back, and its video must not be served as current | `tests/chapter-scan.test.cjs`: "mp4 without render.json is stale", "render.json naming a different build is stale", "editing build.json after render makes the chapter stale". `tests/watcher.test.cjs`: "deleting chapter.mp4 turns the row pending; the video is a 404 before the poll runs", "editing build.json turns the row stale (404 before the poll); re-rendering flips it back and re-takes the poster once". `tests/server-media.test.cjs`: "video is 404 when the build changed after the manifest said ready". `tests/server-api.test.cjs`: "set status ready is refused (409) unless the files prove it right now". Acceptance: `4.mp4-gone-video-404-immediately`, `4.mp4-gone-not-ready-within-3s`, `4.build-edit-stale-within-3s`, `4.build-restored-ready-within-3s`, `2.stale-video-404`. | Pinned, with one deviation from the plan's words: a deleted `chapter.mp4` flips the row to `pending`, not `stale` (ruling 16). The purpose (not ready, not served) is met and tested. |
| 7 | Claude disconnects: `claude_connected` false after 15 s, true on the next heartbeat | `tests/server-api.test.cjs`: "heartbeat: claude_connected false at start, true after a beat, false again after 15 s" (injected clock). `tests/sse.test.cjs`: "a heartbeat that flips claude_connected sends a state event". Acceptance: `4b.connected-false-at-first`, `4b.heartbeat-then-true`, `4b.false-after-16s` (a real 16 s wait). | Pinned for the value in `/api/state`. **Gap:** nothing is sent on the stream when the value turns false, and no test asks for it; an open page learns of the disconnect only at its next `state` event or its own request (section 8). |

**Self-check (plan Step 2):** items 2, 3 and 5 are fully pinned by tests in `npm test`; item 1 is pinned except
that "a guessed port" has no test of its own and the all-routes walk lives in the hand-run script; item 4 is
pinned for one server process only; item 6 is pinned with the `pending` deviation; item 7 is pinned for the
value but has a gap for the live update.

---

## 5. Acceptance results

From [ACCEPTANCE.md](ACCEPTANCE.md). Machine: Apple M3, macOS 26.2, Node 26.7.0, static ffmpeg 6.0 and ffprobe
4.4 from `spikes/.tools` (the Homebrew ffmpeg on this Mac does not start). Commit tested: `570a58c`. The project
was synthetic: four chapters with real H.264 and AAC clips of 3.2, 4.4, 3.8 and 4.92 s made by ffmpeg, story
order `zeta-intro, alpha-setup, mid-flow, beta-wrap` (not alphabetical on purpose), `mid-flow` made stale. No
Claude run, speech or Hyperframes render was involved. The server was started with the real CLI.

| Step | What it checked | Result |
|---|---|---|
| 1 | `serve --detach` prints the URL; `state/server.json` exists, mode 0600, five fields; the key in the query gives 302 and the `yap_key_<port>` cookie; the page lists 4 titles in story order with 3 videos | 7 of 7 |
| 2 | 403 without or with a wrong key on 14 method and path pairs; manifest in `order.json` order; each ready row's duration and build hash; a real JPEG poster per ready chapter (9,253 bytes for the first); the stale row has no poster and its video is 404; ranges `100-199` and `0-` byte for byte; 200 without a range; `HEAD`; captions | 17 of 17 |
| 3 | Chrome, by hand (below) | 8 of 8 |
| 4 | stream opens with `state`; video renamed away: `/video` 404 after 1 ms, row `pending` after 915 ms; renamed back: `ready` after 1,018 ms and a new poster after 1,071 ms; `build.json` edited: `stale` after 955 ms, restored: `ready` after 1,020 ms; a message, a CLI reply with a source, the `reply` event, the thread in order; `yap add-chapter` and `yap set-status` | 14 of 14 |
| 4b | heartbeat: false, true after a beat, false after a real 16 s | 3 of 3 |
| 5 | export in `drafts` mode: 200 in 73 ms; `demo.mp4`, `script.md`, `sources.json`; joined length 12.542 s against 12.520 s (0.022 s apart; the plan allowed 0.2 s); texts byte-identical; a second export writes `demo-2.mp4`, `script-2.md`, `sources-2.json` and leaves the first set untouched; `full` mode is 409 naming the three drafts; `dest` inside `.yap` is 400; no work folder left | 9 of 9 |
| 6 | forged `Host` 403; a malformed request target gets the server's own 400 and the server keeps answering; two path-escape ids 404; a 10 MB body with a length and chunked, both 413; a range past the end 416; a foreign `Origin` 403; a cookie named `yap_key` without the port 403; 300 hung-up connections, then a normal answer from the same process | 11 of 11 |

Total scripted: 61 of 61, three runs in a row, exit 0, no server and no temp folder left behind.

**Chrome (step 3, Google Chrome 154.0.8037.95, by hand against the script's `--keep` server):** opening the
printed URL lands on `/` with no key left in the address bar; the four titles are in story order with their
status; the page has 0 scripts; the three ready videos load their metadata (320x180; 3.2, 4.4 and 4.92 s, equal
to `duration_s`); the stale chapter shows the word `stale` and no video; a ranged `fetch` from the page gets 206;
chapter 2 plays (from 0.4 s to 2.195 s in about 1.5 s, 155 frames decoded, no media error) and seeks (to 3.5 s
and back to 0.4 s, both `seeked` events fired). Screenshot: `frames/placeholder-page-chrome.jpg`. One thing to
know: Chrome does not load video metadata in a background tab; it loaded at once when the tab became visible.

**Observations (measured, not pass or fail; ranges over the three runs):** start to URL printed 92 to 173 ms;
all three posters in the manifest 126 to 209 ms after the start; export 72 to 91 ms; folder changes seen in 0.9
to 1.1 s; server memory after the run 82 to 84 MB; `manifest.json` with 5 rows 2,494 bytes; stop on SIGTERM 51
to 55 ms with `state/server.json` removed.

**One caveat the acceptance document states itself:** the duration check in step 2 is true by construction (the
script writes ffprobe's length into `beats.json`, and the server reads `duration_s` from there). The export
check is the one that compares the server's work with real video lengths.

**Findings:** no check failed. One Minor: the detached server's error output goes nowhere (section 8).

---

## 6. How the work was done

Each task was built test-first by one implementer, reviewed read-only by a second agent, fixed if needed, and
re-reviewed, with the outcome recorded in the ledger. The reviews of Tasks 4, 5 and 6 used the most capable
model by ruling 8, because they are the security and concurrency tasks; the ledger shows Task 8 (export) got the
same. Eleven fix rounds in all. (There are 12 `fix:` commits: one, `ef402d0`, was part of Task 9's first
implementation, closing two Minors carried over from Task 4.)

| Task | Fix rounds | The most important thing the review caught |
|---|---|---|
| 0 Spec amendments | 0 | nothing above Minor |
| 1 Manifest model | 1 | the tests were written after the code; the reviewer's own 23 deliberate bugs found two the tests missed (temp file outside the manifest's folder, a negative duration accepted) |
| 2 Chapter scan | 1 | the broken-link and "`chapter.mp4` is a folder" branches had no test; a linked chapter folder is now refused |
| 3 Events and thread | 1 | a hand-edited huge id was written and then never read back (a silently lost message); ids could go backwards and collide |
| 4 Guard and server skeleton | 1 | **Critical:** one malformed request, with no key, stopped the server process. Also: `server.json` could be written through a link; the cookie was shared between servers on different ports |
| 5 Video serving | 1 | **Critical:** a client hanging up at the wrong moment left a file open, and on Node 26 that stopped the server; a file that shrank mid-download left the browser waiting for ever |
| 6 State, stream, chat, chapters | 1 | a wrong-typed field gave a 500 instead of a 400; a stream reader that never read made the server hold 139 MB (measured), now capped at 1 MB |
| 7 Watcher and posters | 2 | after a restart, the poster of an older build could be shown for a newer video; round 2: a row set to `failed` through the API kept its old poster, fixed by the one-place rule in 3.3 |
| 8 Export | 2 | a manifest slug of `../escaped` wrote outside the chosen folder; the round-1 fix then broke export to USB sticks and SD cards (drives without hard links, checked on a real exFAT image), fixed in round 2 |
| 9 Client commands | 1 | an answer of `{"ok":true}` with no process id was taken for a busy Yap server, so `--detach` refused to start for 5 s |
| 10 Skill | 0 | nothing above Minor (7 Minors) |
| 11 Acceptance | 0 | 61 of 61; one Minor (the detached server's logs) |

**The one process incident.** While Task 9's fix was being made, three uncommitted files appeared in the working
tree that no task had made: a change to `package.json` (a `shadcn` dev dependency and a reformatted `bin`), a new
`.mcp.json` and a new `package-lock.json`. The fixer's commit `404ee01` swept them in, although its report said
otherwise. The controller recommitted the same change without them as `17eb2aa` (the old sha `404ee01` is
superseded and is not on the branch). **Those three files are still uncommitted in the working tree, for the
owner to decide.** For the owner to judge: the `package.json` change adds a dev dependency to a project whose
rule is no runtime packages for `bin/`, `lib/` and `server/`.

Smaller things the ledger records: the Task 5 implementer ran `git stash` and `git stash pop` once by mistake
(checked afterwards: nothing lost); a test child process left running by a hanging test run was found and
stopped; one reviewer could not remove a scratch folder it had made under the system temp folder (outside the
repository).

---

## 7. Decisions taken on the owner's behalf

Every ledger line that contains the word "Ruling", in ledger order: 20 lines. Each gives what was decided, why,
and what follows if it was the wrong call. These are the controller's decisions, not the owner's; this is the
list to overrule from.

1. **R1: the manifest has five statuses,** `pending`, `rendering`, `ready`, `failed`, `stale`. *Why:* the plan's
   Task 1 listed four and its Task 2 produced `pending`; a chapter that is scaffolded or narrated but not
   rendered needs an honest state. The spec's 4.2 lists only three. *If wrong:* one value to remove.
2. **R2: at start the server loads `manifest.json` if it is valid, else creates one** with the title and slug
   both set to the folder name and audience `beginner`. The title stays the slug in Phase 2. *Why:* nothing
   supplies a title, slug or audience at server start. *If wrong:* Phase 3 shows the slug as the title until a
   title source exists.
3. **R3: a reply's `in_reply_to` is checked against the events file,** which the reply function is handed.
   *Why:* the plan's signature gave it only the thread file. *If wrong:* nothing lost.
4. **R4: the `thread` in `/api/state` is the `message` events merged with the replies,** ordered by time, each
   tagged `viewer` or `claude`; `thread.jsonl` itself holds replies only. *Why:* the plan's acceptance step
   expects the thread to show both. *If wrong:* one merge function to move if Phase 3 wants them separate.
5. **R5: the video route needs the row to be `ready` and a fresh scan of the folder to say `ready` at request
   time.** *Why:* the manifest can be up to one poll (1 s) behind the files; this closes that window for Review
   Focus 6. *If wrong:* one small hash per video request.
6. **R6: the watcher marks a row `failed` for a missing folder only if it saw that folder earlier in this server
   run;** rows whose folder never existed keep their status. *Why:* `yap add-chapter` creates a row before its
   folder exists. *If wrong:* after a restart, the row of a folder deleted while the server was down stays as it
   was.
7. **R7: `serve`, `reply`, `add-chapter`, `set-status` and `order` all take `--dir <slugDir>`;** without it, the
   only folder under `./.yap/` that has `chapters/`, else a usage error. *Why:* the plan gave `--dir` only to
   `serve`. *If wrong:* extra flags in the skill text.
8. **Models:** mid-size model for implementers and reviewers; the most capable model to review Tasks 4, 5 and 6
   and for the final review. *Why:* those are the security and concurrency tasks. *If wrong:* not stated in the
   ledger; the risk is a weaker review on the other tasks.
9. **Task 2, finding I1 rejected:** names like `work-1` or `snapshots` directly under `chapters/` are not
   filtered out. *Why:* Phase 1 writes those folders *inside* a chapter folder, and filtering the names one
   level up would silently drop a chapter legitimately titled, say, "Snapshots". *If wrong:* a stray tool folder
   directly under `chapters/` shows up as a pending chapter.
10. **Task 3: the next id is the largest valid id in the file plus one,** and a line whose number is not a safe
    integer is an invalid line. *Why:* the plan's "derived from the last valid line" does not keep ids rising
    after a hand edit. *If wrong:* a full read of the file on every append (the files are small).
11. **Task 4: the cookie is named `yap_key_<port>`.** *Why:* browsers do not separate cookies by port, so two
    Yap servers would overwrite each other's key. The plan and spec say `yap_key`. The key still reaches every
    other web service on `127.0.0.1` in the `Cookie` header; that is accepted for v1 (same-user local programs,
    a fresh key per start, dead when the server stops) and was to be stated here. *If wrong:* another local web
    service can read a live session key.
12. **Task 5: a response that sent fewer bytes than its `Content-Length` must drop the connection,** so the
    browser sees a broken transfer and not a hang. *Why:* the brief's "stream error ends the connection cleanly"
    is read as covering a file that ends early. *If wrong:* nothing lost.
13. **Task 6: the API routes live in a new file, `server/api.cjs`.** *Why:* it keeps `server/server.cjs` to
    start, stop, guard wiring and the route table; the plan listed only `server/server.cjs`. *If wrong:* nothing
    lost.
14. **Task 7, status mapping: a scan of `pending` never overwrites a row that is `failed`;** `ready`, `stale` and
    `rendering` from the scan always win. *Why:* a failure reported through the API must not be wiped by an idle
    folder. *If wrong:* a failed row stays failed until a render starts or the API resets it.
15. **Task 7, placement: a newly found chapter goes right after the nearest id that precedes it in `order.json`
    and is already in the manifest** (front if `order.json` lists it first, end if it is not listed); the watcher
    never reorders existing rows. *Why:* the plan says only "added in order.json order". *If wrong:* none
    expected. (This summary found one effect: rewriting `order.json` later moves nothing; section 8.)
16. **Task 7: a deleted `chapter.mp4` makes the row `pending` (or `rendering`), not `stale`;** only an edited
    `build.json` or a missing `render.json` gives `stale`. *Why:* with no video there is nothing to be stale.
    The plan's Review Focus 6 says "flip to stale" and its Task 11 step 4 expects `stale`. *If wrong:* wording in
    Task 11; the acceptance run reads "not ready (pending)" for that step.
17. **Task 7: the extra file `server/chapter-sync.cjs` is accepted,** for the same reason as `server/api.cjs`.
    *If wrong:* nothing lost.
18. **Task 8, export: mode `drafts` exports every ready chapter; mode `full`, the default, answers 409 naming the
    draft chapters** when any ready chapter is still a draft. Since Phase 2 has no full-quality renders, the
    caller must pass `drafts`. **All three output names share one number** so nothing in the folder is
    overwritten (`<slug>-2.mp4`, `script-2.md`, `sources-2.json`). *Why:* the spec says only "writes
    `<slug>.mp4`, `script.md`, `sources.json`"; the plan says never overwrite the mp4. *If wrong:* numbered names
    on the two text files.
19. **Task 7, finding I1: a row that leaves `ready` gets `poster: null`,** so the next flip to ready always takes
    a new frame; no new manifest field. *Why:* a poster of an older build was shown for a newer video after a
    restart. *If wrong:* one extra frame grab after a round trip from ready to stale and back.
20. **Task 8: the output-name rule was relaxed.** The first fix required the manifest slug to follow the chapter
    id rule, which refuses folder names like `2024-recap`, `Demo` and `my_video` that the server otherwise serves
    happily. The name is now accepted when it matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$` and holds no `..`.
    *If wrong:* a wider name set, still with no path separator and no `..`.

---

## 8. What is still manual, weak or not proven

### Found while writing this summary (not in the ledger; not fixed, as this task changes no code)

- **A chapter added through the API never gets its `video` and `captions` paths.** `yap add-chapter` creates a
  row with `video: null` and `captions: null`. When that chapter's folder later appears and is rendered, the
  watcher updates only status, duration, build hash and commit (`server/chapter-sync.cjs:55`). Checked by a
  probe against the real server in a temp folder: the row became `ready` with a poster, `/chapters/<id>/video`
  answered 200, and the row still said `"video": null, "captions": null`. Nothing in Phase 2 breaks, because the
  routes use fixed file names, but a player that reads `row.video` to decide whether a chapter can be played
  would treat every follow-up chapter as having no video.
- **A disconnect is not pushed.** `claude_connected` turns false 15 s after the last heartbeat only when someone
  asks (`server/api.cjs:43-45`); the only push is on the false-to-true flip (`server/api.cjs:110`). Probe: after
  a heartbeat and a 16 s clock jump, `/api/state` said false and no stream event had been sent. A page that only
  listens to the stream will show "connected" until some other `state` event arrives.
- **Rewriting `order.json` after the manifest exists moves nothing,** in the same run or after a restart (probe:
  the order was reversed in `order.json`; the manifest order did not change either time). This follows from
  ruling 15, but `skills/yap/SKILL.md:108-110` tells Claude to run `yap order` again "if a chapter is later
  added, removed or moved", which reads as if a move takes effect. In the normal flow the server starts only
  after the last render, so the manifest is seeded once from the final `order.json` and nothing is lost. A second
  `/yap` run over a slug folder that already has a `manifest.json` would keep the old order. There is no command
  for `op:"reorder"`, and no way to remove a row short of deleting `manifest.json` while the server is stopped.
- **The top-level `verified_against_commit` is always `null`** (`lib/manifest.cjs:25`); only the per-row field is
  filled.
- **The `video` and `captions` paths are written whether or not the files exist** (`server/chapter-sync.cjs:19`):
  in the probe a `pending` row with no mp4 and no `captions.vtt` carried both paths, and its captions route
  answered 404. The status and the routes are the truth; the paths are not.
- **A row's title is never refreshed from `chapter.json`.** The refresh is guarded by "the row has no title"
  (`server/chapter-sync.cjs:56`), which cannot be true for a valid manifest. A row added without `--title` keeps
  its id as the title.
- **`yap serve` exits 2 for every start failure,** not only for bad usage (`lib/server-cli.cjs:99-102`): an
  invalid `manifest.json` or a linked `state/` folder gives the same code as a mistyped flag.
- **`ACCEPTANCE.md`'s verdict table still says step 3 is "Pending"** (`docs/phase-2/ACCEPTANCE.md:14`) although
  the step 3 section below it records 8 passes. That document is not edited here.
- **Two ledger Minors no longer match the code** (the code wins): the "dead branch in `abort`" in
  `lib/range.cjs` is gone (the file has no `abort` function now), and `buildState` is no longer exported from
  `server/api.cjs`.

### Not covered by acceptance

- **No second browser.** Only Chrome 154 was tried.
- **No real marketplace install.** Still the open item from Phase 1; nothing in Phase 2 tested a plugin
  installed the way a user would install it.
- **No real Claude session drove `yap reply`.** The reply, add-chapter and set-status commands were run by the
  script. Nothing sends heartbeats in real use yet (`yap listen` is Phase 4), so `claude_connected` is false in
  every real session today. The skill change (order, serve, hand-off) was checked by lint tests only, not by a
  real `/yap` run.
- **The session key reaches other local web services.** Cookies are not separated by port, so a browser sends
  `yap_key_<port>` to every service on `127.0.0.1` in the `Cookie` header (ruling 11, accepted for v1).
- **Server logs are discarded under `--detach`.** The background server is started with its output thrown away
  (`lib/server-cli.cjs:79`), which is the mode the skill uses. A failed poster grab, a failed manifest save or
  the detail of a 500 cannot be read afterwards. There is no log file.
- **Export is draft quality only.** No full-quality render exists, so `mode:"full"` always answers 409 and every
  export must ask for `drafts`. Nothing in the product calls the export route yet.
- **Captions are not shown.** `captions.vtt` is served by a route, but the placeholder page has no caption
  track, and the videos have no burnt-in captions. `captions.json` (word timings) has no route.
- **No thread and no posters on the placeholder page.** Both exist only in `/api/state` and the poster route.
- **Real chapters.** The clips were 3 to 5 s test patterns of about 120 KB. No real 20 to 40 s chapter of
  several megabytes was served, seeked or exported, and nobody watched or listened to an exported file.

### Deferred Minors from the ledger, grouped

**Security**

- Pages on another port of `127.0.0.1` count as the same site, so the browser sends them the cookie and their
  `GET`s pass the guard (only non-GET methods are Origin-checked, `lib/http-guard.cjs:49-51`). The browser still
  blocks such a page from reading the answer. (Task 4, M-1)
- Plain `yap serve` (no `--detach`) does not check for a live server on the same folder
  (`lib/server-cli.cjs:59-69`): two servers can then write one manifest, and the first to stop deletes the
  other's `server.json`. (Task 4, M-2)
- Any error carrying a 4xx status has its message sent to the client (`server/server.cjs:134`); safe today
  because every such message is a fixed sentence. (Task 4, M-4)
- The export route checks "closing" before it waits for the body (`server/export-route.cjs:10-11`), so a request
  already sending its body when the server begins to close can still start an export. Read from the code, not
  reproduced.
- A chapter file can be swapped between the export's check and ffmpeg reading it; this needs write access to
  the project.
- The export name pattern (`lib/export.cjs:85`) lets Windows reserved names such as `CON` and a trailing dot
  through.
- A `chapter.mp4` that is a link to another file inside the same chapter folder counts as ready.
- The scan trusts a `build.json` that says `version: 2` without checking the rest of its shape
  (`lib/chapter-scan.cjs:98`).
- Manifest validation accepts paths like `a//b` and does not type-check `question`, `build_sha256` or
  `placement_reason`.
- `startServer` returns the raw server object, so a caller could close it and skip the removal of `server.json`.

**Robustness**

- When the background server dies at once (for example on an invalid manifest), `--detach` waits the full 10 s
  and prints only the generic sentence (`lib/server-cli.cjs:81-88`); the real reason went to the discarded
  output. (Task 4, M-3)
- A ping answered with a 5xx or `{ok:false}` counts as "no server", so `--detach` removes `server.json` and
  starts a second server over a live but unhealthy one. (Task 9, M-1)
- A row whose folder was deleted while the server was down is never flagged (ruling 6).
- A deleted `poster.jpg` is never noticed; the scan reports `hasPoster` (`lib/chapter-scan.cjs:149`) and nothing
  reads it.
- A row that goes ready, then non-ready through the API, then ready through the API with unchanged files, stays
  ready with no poster until the next folder change or restart.
- A crash during an export leaves a hidden `.yap-export-*` folder in the chosen folder; it does not block the
  next export.
- The manifest save does not force the bytes to disk before the rename, so a power cut can lose the last change
  (the file stays valid).
- If the machine's clock moves backwards, `claude_connected` can stay true long after the last heartbeat
  (`server/api.cjs:43-45`). The stream's `ping` uses the real clock even when a test clock is injected.
- Event ids with leading zeros (`evt_007` and `evt_7`) can coexist. `readEventsAfter` throws on an empty id; no
  route reads events after an id at all yet.
- Text of 4,000 characters in a script with three-byte characters exceeds the 8,192-byte line limit and is
  refused with a 400, so the real limit for such text is lower than 4,000 characters.
- The body reader used without a response object on a plain stream (not a socket) would crash; the server always
  hands handlers the bound version.
- The 300-character cut on command output can split a two-unit character and print a replacement character. A
  repeated flag silently takes the last value.
- Manifest model edges: `insertChapter(m, null)` throws a raw TypeError; a `null` entry in `chapters` also
  reports a false duplicate; a parent cycle is reported once per member; the model's "never changes its input"
  is shallow (rows are shared between the old and new manifest).
- A leftover dead check at `lib/range.cjs:100`; `escapeHtml` and `sendJson` are exported from
  `server/server.cjs:281` and no code under `lib/`, `server/` or `bin/` imports them (handlers get `sendJson`
  through their context).

**Tests**

- The stream-timeout test cannot fail (`tests/sse.test.cjs:232`); the behaviour was checked by the reviewer by
  hand (a stream stayed open 36 s across a real timeout sweep).
- Task 1's tests were written after the code; the fix round added tests shown able to fail.
- The export test for the five "links not supported" error codes cannot fail on its own (other tests cover the
  fallback).
- No test covers the foreground `yap serve` path through a real SIGTERM (the acceptance run did observe the
  stop and the removal of `server.json`). The detach tests can leave a child behind if their own time limit
  fires first.
- The child server in `tests/server-media.test.cjs` survives if the test process is killed hard; the hang-up
  storm tests use about 600 ports per run, so many parallel runs can exhaust ports.
- The "busy for 5 s" test in `tests/server-cli.test.cjs` depends on wall-clock time.
- Not tested: event text with a newline, U+2028 or a lone surrogate; an unreadable (`EACCES`) `chapters/`
  folder; the one-line error messages of `setChapterFields` and `reorderChapters` for ids with newlines. One
  manifest test is redundant.
- Skill lints: the rule that allows `yap serve --detach` in the background can be passed by a sentence that
  backgrounds something else on the same line without the words render or narrate; nothing stops the skill
  text from telling Claude to use `reply`, `add-chapter` or `set-status` in the main flow; `export` is still in
  the list of commands that do not exist yet (`tests/skill-lint.test.cjs:18`), correctly, since there is no
  `yap export`; no lint for "do not write the URL to a file"; the ordering lints do not read
  `references/render.md`.

**Wording**

- `skills/yap/SKILL.md:172` says "the printed URL" even when `yap serve` printed a problem line instead; Step 6
  does not say to start the server only if the last render exited 0; the file is 199 lines against a 200-line
  limit, so the next addition needs a cut.
- The plan's Task 11 step 4 and Review Focus 6 still say `stale` for a deleted video (ruling 16).
- One inaccurate comment in the export code, some over-long lines and style nits (in the review files).

---

## 9. PROPOSED SPEC AMENDMENTS (for the owner's approval; none applied)

The spec is `docs/superpowers/specs/2026-10-02-yap-design.md`. Its section 14 already holds a short "Phase 2
additions" list (five status names, the two new row fields, `claude_connected`, the merged thread,
`state/server.json`, the placeholder page). The items below either correct text that list did not touch or add
what it leaves out. Per the house rule the accepted text is not edited; these would land as a dated superseding
section.

### B1. Sections 4.3 and 7, the key and the cookie

Current (4.3): "bound to `127.0.0.1`, with a random session key in the URL and a cookie". Current (7): "random
session key in the URL, remembered in a cookie."

Proposed: "Every request must carry the session key (32 hex characters, new at each start). It is read from the
`x-yap-key` header, else the cookie `yap_key_<port>`, else the `?key=` query value. `GET /?key=<key>` answers
302 to `/` and sets `yap_key_<port>=<key>; HttpOnly; SameSite=Strict; Path=/`. The port is part of the cookie
name because browsers do not separate cookies by port. The `Host` header must be `127.0.0.1:<port>` or
`localhost:<port>`. For any method other than GET and HEAD, an `Origin` header, when present, must be the
server's own. A refusal is always 403. Known limit: the browser also sends this cookie to other web services on
`127.0.0.1`."

### B2. Section 4.2, the status line

Current: "`status`: `rendering`, `ready`, `failed`. `quality`: `draft` or `full`."

Proposed: "`status` is one of `pending`, `rendering`, `ready`, `failed`, `stale`. `ready`: `chapter.mp4` exists
and `render.json` names today's `build.json`. `stale`: a video exists but is not proven current. `rendering`: no
video, and a `work-*` folder is present. `pending`: no video and no work folder. `failed`: set through the API,
or by the server when a chapter folder it has seen is gone; a scan of `pending` does not clear it. `quality`:
`draft` or `full`."

### B3. Section 14, "Phase 2 additions", `stale` against `pending` for a deleted video

Current: "`pending` = scaffolded or narrated, not rendered yet; `stale` = a video exists but no longer matches
the audited build."

Proposed, added to that bullet: "A chapter whose `chapter.mp4` is deleted becomes `pending` (or `rendering`),
not `stale`: with no video there is nothing to be stale. In every status but `ready`, the video route answers
404 and the row's `poster` is `null`."

### B4. Section 4.9, export

Current: "writes, to a folder the user picks: `<slug>.mp4`, `script.md`, `sources.json`. If some chapters are
still `draft`, export offers to wait for the full-quality render or to export drafts."

Proposed: "`POST /api/export` takes `{dest, mode}`. `dest` is an absolute path to an existing folder that is not
a link and is not the project's `.yap` folder or inside it. `mode` is `full` (the default) or `drafts`: `full`
answers 409 naming the chapters that are still drafts; `drafts` exports every ready chapter. Chapters that are
not ready are left out and listed in the answer. The output name is the manifest's `slug`, which must match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$` and hold no `..`, else 409. Nothing in the folder is ever replaced: if any
of the three names is taken, all three get the same number (`<slug>-2.mp4`, `script-2.md`, `sources-2.json`).
The answer is `{file, files, skipped}` with base names only. One export runs at a time."

### B5. Section 4.3, the endpoint table and `state/server.json`

Current: nine rows; no ping, poster or captions route; `HEAD` not mentioned.

Proposed additions: "`GET /api/ping` (CLI): `{ok:true, pid}`, so `yap serve --detach` can tell a live Yap server
for this folder from a stale `state/server.json`. `HEAD /chapters/:id/video`. `GET /chapters/:id/poster`:
`poster.jpg`, 404 while the row's `poster` is `null`. `GET /chapters/:id/captions`: `captions.vtt`." And change
`GET /` from "the player" to "the player (Phase 2: a placeholder page)". The fields of `state/server.json` are
already in section 14; add: "written as a new file and renamed into place, removed on a clean stop; the server
refuses to start if `state/` is a link."

### B6. Section 14, A8: `order.json` and `yap order`

Current: "The skill writes `.yap/<slug>/order.json` ... before the first scaffold, and rewrites it when a
chapter is added. Phase 2's server seeds the manifest's chapter order from it and then owns the order."

Proposed: "The skill writes it with `yap order <id,id,...>`. The server uses it twice only: to seed an empty
manifest, and to place a chapter folder that appears later (right after the nearest earlier id already in the
manifest; first if `order.json` lists it first; last if it is not listed). The server never moves an existing
row because `order.json` changed. After seeding, order changes only through `POST /api/chapters` (`reorder`, or
`add` with `after` or `parent_id`)." And either drop "moved" from the skill's instruction to rerun `yap order`,
or decide that a changed `order.json` should reorder (an open decision, section 10).

### B7. Section 4.2, the example and `verified_against_commit`

Current: the example shows `"verified_against_commit": "abc1234"` once at the top, and rows without
`build_sha256` or a per-row commit; the second row omits `video`, `poster` and `captions`.

Proposed: every row always has all 13 fields (`id`, `title`, `parent_id`, `placement_reason`, `status`,
`quality`, `duration_s`, `video`, `poster`, `captions`, `question`, `build_sha256`, `verified_against_commit`),
with `null` where unknown; a manifest with an unknown field is invalid. The top-level `verified_against_commit`
is either removed or defined; today it is always `null`. Replace the example with the one in section 3.6 of this
summary.

### B8. Section 4.3, the commands

Current: "`yap reply`, `yap add-chapter`, `yap set-status`, `yap listen`".

Proposed: "`yap serve [--detach]`, `yap reply`, `yap add-chapter`, `yap set-status`, `yap order` (built in Phase
2) and `yap listen` (Phase 4). Each takes `--dir <slugDir>` and defaults to the only folder under `./.yap/` that
has `chapters/`. Each prints one line and exits 0 (done), 1 (no server, or it refused) or 2 (bad usage)."

### B9. Section 4.4, the reply format and the limits

Current: the event example only.

Proposed, added: "`state/thread.jsonl` holds Claude's replies, one per line:
`{"id":"rep_3","ts":"...","in_reply_to":"evt_12","text":"...","sources":[{"file":"src/app.js","lines":"10-12"}]}`.
Event and reply ids are `evt_<n>` and `rep_<n>`; the next id is the largest valid one in the file plus one.
Text is at most 4,000 characters and a stored line at most 8,192 bytes. `context` is exactly `{chapter_id, t}`
or absent. A broken or partial line is skipped, never fatal."

The split of the routes into `server/api.cjs`, `server/chapter-sync.cjs` and `server/export-route.cjs` is not a
spec matter and is not proposed here.

---

## 10. What Phase 3 (the React player) can rely on, and what it must add or decide first

### Can rely on

- **One request tells the page everything:** `GET /api/state` gives `{manifest, thread, claude_connected, now}`.
  The same object arrives as the first event on `GET /api/stream` and after every message.
- **Authentication from the page needs no code.** The user opens `http://127.0.0.1:<port>/?key=<key>`; the
  server sets the cookie and redirects to `/`. The cookie is `HttpOnly`, so page scripts cannot read the key and
  do not need to: the browser attaches it to every same-origin request, including `fetch`, `<video src>`,
  `<track src>`, `<img src>` and `EventSource` (which cannot set headers, so the cookie is its only way in).
  The page must be loaded from the server itself, at `/`. For `POST`s from the page the browser adds its own
  `Origin`, which the guard accepts; the body must be sent as `Content-Type: application/json`.
- **Media URLs are built from the chapter id, never from the manifest's path fields:**
  `/chapters/<id>/video`, `/chapters/<id>/poster`, `/chapters/<id>/captions`. Ids are slugs, so they need no
  escaping.
- **Status meanings (section 3.2).** Play a chapter only when `status` is `ready`; the video route answers 404
  in every other status, checked against the files at request time. Show a poster only when the row's `poster`
  is not `null`. `duration_s` can be `null`.
- **Range requests work as Chrome sends them** (200, 206, 416, `HEAD`), measured by playing and seeking.
- **Playing chapters back to back:** the list of `ready` rows in array order, each a separate mp4 URL with a
  known `duration_s` (equal to the real length in the acceptance run), so the spec's plan of two `<video>`
  elements with the next chapter preloaded in the idle one fits what the server offers. Timeline positions are
  the running sum of `duration_s` (the server has a `timeline()` function but no route exposes it). The join
  itself was not tried in Phase 2.
- **Live updates:** event names `state`, `reply`, `chapter`, `ping`, with the payloads in section 2.3. Every
  `chapter` event carries the whole new manifest, so the page can replace its copy rather than patch it. Folder
  changes arrive in about 1 s. After a reconnect the first event is a full `state`.
- **Chat:** `POST /api/message` with `{type:"message", text, context:{chapter_id, t}}` returns the stored event;
  the thread entries carry `role` `viewer` or `claude`; replies carry `in_reply_to` and optional
  `sources:[{file, lines}]` with `lines` as `"12"` or `"12-20"`.
- **Captions** come from `/chapters/<id>/captions` as WebVTT, cut from the audited sentences (Phase 1).
  **Posters** come from `/chapters/<id>/poster` and always belong to the current build of a ready chapter.
- **Export:** `POST /api/export` with `{dest, mode:"drafts"}`; the answer lists what was written and what was
  left out.
- **Limits to design around:** bodies up to 65,536 bytes; message text up to 4,000 characters; one export at a
  time; a stream that stops reading is dropped at 1 MB of backlog.

### Must add or decide first

1. **A way to serve the player's files.** No route serves static files; `GET /` builds a page from a string.
   The response header `Content-Security-Policy: default-src 'self'` allows scripts, styles, fonts, images and
   media only from the server itself: no inline `<script>` or `<style>`, no outside address, no `data:` or
   `blob:` addresses. So the built bundle must be served by new routes on this server and must not rely on
   inline code, or the policy must be widened deliberately.
2. **Fix or work around the `null` paths on added chapters** (section 8). Either the watcher fills `video` and
   `captions` when a folder appears for an existing row, or the player is told never to read those fields.
3. **How the page learns that Claude disconnected.** No event is sent when `claude_connected` turns false. Either
   the server pushes a `state` event when the 15 s window runs out, or the page asks `/api/state` on a timer.
4. **Where the Sources tab gets its data.** No route serves `sources.json`, `chapter.json` or `script.md`; the
   spec's Sources tab ("file:line references for the current chapter") has no source of data yet.
5. **Captions on screen.** Whether they are on by default, and whether word-level highlighting is wanted; that
   needs a route for `captions.json`, which does not exist. (Word-by-word display was out of scope for Phase 2.)
6. **A real title.** The manifest title is the folder name (ruling 2). Decide where the human title comes from.
7. **A failed chapter has no stored reason.** The reason is sent once, in the `chapter` event; after a reload
   the row says only `failed`. The scan's list of problems per chapter is not exposed by any route either.
8. **Reordering and removing.** `op:"reorder"` exists with no command; no op removes a row; `order.json` is not
   re-read for existing rows. Decide what "move" and "remove" mean before the timeline shows them.
9. **Export in the player.** The route needs an absolute folder path as text; a web page cannot hand one over
   from a folder picker. Decide how the viewer names the folder. Today the request must also say
   `mode:"drafts"`.
10. **A restarted server is a new address.** Each start picks a new port and a new key, so an open page cannot
    reconnect to a restarted server; the user needs the new URL. Decide whether that is acceptable or whether
    the port should be remembered.
11. **`Cache-Control: no-store` is on the videos too.** Whether that hurts the two-element preload has not been
    measured.
12. **The other four event types** (`make_video`, `just_text`, `retry_chapter`, `export`) are accepted and
    stored, but nothing reads them and they are not in the thread. Their buttons will do nothing until Phase 4
    builds `yap listen`.
13. **The three uncommitted files** (`package.json` change, `.mcp.json`, `package-lock.json`) look like setup for
    Phase 3's interface work. The owner should decide whether they belong on this branch, on the Phase 3 branch
    or nowhere, before Phase 3 starts.
14. **Still owed from Phase 1:** one real marketplace install end to end, and one real `/yap` run that ends with
    the server started and the URL handed over (the skill change has only been lint-checked).

---

## 11. After the final review (what changed after `f598229`)

A fresh reviewer read the whole branch (Tasks 0 to 10, `46f59cd..570a58c`) and judged it ready to merge after
four fixes: no Critical finding, four Important, fifteen Minor. One fixer made the fixes, test first, in five
commits. A second reviewer then checked that fix wave: every finding addressed, each with a test that fails when
the key line is reverted, nothing Critical or Important left, ready to merge. Full texts:
`final-review.md` and `review-finalfix.md` in the ledger folder.

Measured by the controller at `ef84d53`: `npm test` 596 tests, 596 pass, 0 fail (Node 26.7.0, 8.8 s). The fixer
re-ran the acceptance script against the real server: 61 of 61, no check changed.

### 11.1 What the five commits changed

| Commit | Finding | Behaviour now |
|---|---|---|
| `3619183` | Two servers could run on one folder (a foreground `yap serve` never looked for a live one), and closing deleted `state/server.json` even when another server had written it | `startServer` refuses to start when `state/server.json` names a live Yap server for this folder (same ping rule as `--detach`), with the line `a server for this folder is already running`; a foreground `yap serve` prints it and exits 1. Closing removes `server.json` only if it still holds this server's own pid and key |
| `3da2c69` | The stream never told the page that Claude had disconnected (only the change to connected was sent) | Every heartbeat arms one 15 s timer; when it runs out with no newer heartbeat the server sends a `state` event, whose `claude_connected` is then `false` |
| `92e7c40` | `video` and `captions` in a manifest row meant different things depending on who wrote the row; a row's title never followed `chapter.json` after a redo | One rule in the manifest write queue, next to the poster rule: `video` is `chapters/<id>/chapter.mp4` and `captions` is `chapters/<id>/captions.vtt` exactly when the row is `ready`, both `null` otherwise. The watcher sets a row's title from `chapter.json` whenever that title is a non-empty string different from the row's |
| `96a9937` | Writes could still happen after closing had finished | The export route checks again, just before it starts, whether the server is closing (503 `the server is closing`). Closing waits, with a bound, for the manifest queue to empty; a manifest change that arrives after closing began gets 503 and is not run. A heartbeat while closing also gets 503. The queue no longer rewrites the file when a job changed nothing |
| `ef84d53` | A row that claimed a video whose folder had vanished while the server was down was never flagged | On the first check after start, a row that says `ready`, `stale` or `rendering` but has no chapter folder becomes `failed` (reason `chapter folder is missing`). `pending` and `failed` rows without a folder are left alone |

### 11.2 Statements above that these commits overtake

- Section 2 (API): add the start refusal, and the 503 answers while closing for `POST /api/export`,
  `POST /api/chapters` and `POST /api/heartbeat`. The `state` event is now also sent when Claude's heartbeat
  runs out.
- Section 3 (manifest): `video` and `captions` follow the rule in 11.1; the example manifest's non-ready rows
  would now show both as `null`. Titles follow `chapter.json`.
- Section 4 (Review Focus): item 4 now has a test for a second server on the same folder; item 7 now has tests
  for the stream event when the heartbeat runs out. Item 1 is unchanged (the walk over every route without a
  key is still only in the hand-run acceptance script; the guard runs before routing, so it is covered by
  construction).
- Section 8, "found while writing this summary": items 1, 2, 5 and 6 are fixed by `92e7c40` and `3da2c69`.
  Items 3, 4 and 7 are still open (see 11.4). Item 8 (the acceptance table said Step 3 was pending) is
  corrected in ACCEPTANCE.md.

### 11.3 Decisions taken on the owner's behalf in the final round (add to section 7)

1. One server per folder is enforced by asking the server named in `state/server.json` whether it is alive, not
   by a lock file. If wrong: two starts in the same instant can both pass the check.
2. A disconnect is pushed by a 15 s timer per heartbeat. Downside: one timer.
3. `video` and `captions` are set exactly when a row is `ready`, and a chapter folder's `chapter.json` title
   replaces the row's title. Downside: a title set through the API (`POST /api/chapters`, op `set`) is replaced the
   next time that chapter's status or build changes, and at every restart, once its folder exists.
4. The earlier ruling that a row without a folder is left alone was narrowed: at start, a row claiming a video
   with no folder becomes `failed`. Downside: none seen.
5. Moving an existing chapter by rewriting `order.json` is NOT supported and was NOT fixed (there is no second
   fix round). `skills/yap/SKILL.md` tells Claude to run `yap order` again when a chapter is moved; once the
   manifest exists that changes nothing on the page. Adding and removing chapters works. The owner chooses:
   change the skill's wording, or add a `yap reorder` command over the existing `reorder` operation of
   `POST /api/chapters`. While open: Claude may believe a move took effect when the page still shows the
   old order.

### 11.4 Still open after the final round (add to section 8)

- The Task 11 acceptance script and ACCEPTANCE.md were not reviewed by a second agent: both attempts to send
  them to a reviewer were refused by the session's permission checks, and the controller did not go around
  that. Their results stand on the three scripted runs, the fixer's fourth run and the hand check in Chrome.
- Unreadable `chapters/` folder at start: every row that claims a video is marked `failed` with the reason
  `chapter folder is missing`; it heals on the next readable check (reproduced by the reviewer).
- A live process that holds `state/server.json` but never answers refuses a new start only after 5 s, and the
  message then has no address in it.
- A server that is closing still answers the liveness ping, so a `yap serve` typed right after Ctrl-C can be
  refused once.
- A manifest change refused during closing is written to the error output as if it were a fault.
- A title-only edit of `chapter.json` (no redo) is not noticed until that chapter's status or build next
  changes, because the watcher only acts when its comparison finds a difference.
- Top-level `verified_against_commit` in the manifest is always `null` (the per-chapter field is filled).
- `yap serve` exits 2 for every start failure except the new "already running" case, which exits 1.
- The fifteen Minor findings of the whole-branch review, and its sorting of the earlier deferred list into
  "can wait" and "not a real problem", are in `final-review.md`.

