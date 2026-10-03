# Phase 2 acceptance run

Date: 2026-10-03. Branch `phase-2-server`, commit tested `570a58cb13362116711f3bd006f24cb97896b79a`
(`fix: export works on drives without hard links; folder names like 2024-recap are allowed`).
The local server (`yap serve`) checked against real files, a real ffmpeg and real HTTP, with a synthetic project
so that no Claude run, TTS or Hyperframes render is needed.

## Verdict

| Step | Result | Checks |
|---|---|---|
| 1. Start with `serve --detach`, `state/server.json`, key cookie, page | PASS | 7 of 7 |
| 2. Key guard, manifest, posters, media serving | PASS | 17 of 17 |
| 3. Real browser check (by hand, Chrome 154) | PASS | 8 of 8 |
| 4. Live updates, chat with a CLI reply, chapter commands | PASS | 14 of 14 |
| 4b. Heartbeat | PASS | 3 of 3 |
| 5. Export | PASS | 9 of 9 |
| 6. Hostile requests | PASS | 11 of 11 |

The final script was run three times in a row; each run: **61 passed, 0 failed of 61**, exit 0. No server and no
temp folder was left behind after any run (`pgrep -fl "yap.cjs serve"` empty, no `yap-p2-accept-*` in `$TMPDIR`).
`npm test` still runs 575 tests, all passing (the script's name does not end in `.test.cjs`).

## Machine

Apple M3, macOS 26.2 (25C56), Node 26.7.0. Static ffmpeg 6.0 and ffprobe 4.4 (tessus build) from `spikes/.tools`,
through `source spikes/env.sh` (`HYPERFRAMES_FFMPEG_PATH`, `HYPERFRAMES_FFPROBE_PATH`); the Homebrew ffmpeg on this
Mac does not start (`Library not loaded: libx265.216.dylib`), and the script refuses it with that one line.

## How to re-run

```
source spikes/env.sh
node tests/phase2-acceptance.cjs            # every check, then stops the server and removes the temp folder
node tests/phase2-acceptance.cjs --keep     # builds and starts only; prints URL (with key) and TMPDIR, leaves it running
node tests/phase2-acceptance.cjs --stop <TMPDIR>   # stops that server (pid confirmed by its ping) and removes the folder
```

The script uses the Node standard library only. It prints one line per check, `PASS|FAIL <name>: <what was observed>`,
keeps going after a failure, and exits 1 when any check failed. It stops the server and removes the temp folder at
the end, also on a failure and on Ctrl-C (tested: an interrupt during Step 4b exits 130 and leaves nothing behind).
Without the two environment variables it stops with `HYPERFRAMES_FFMPEG_PATH is not set: run source spikes/env.sh first`.

### The synthetic project

`<tmp>/proj/.yap/demo/` with `script.md`, `sources.json`, `order.json` and four chapter folders. The story order in
`order.json` is `zeta-intro, alpha-setup, mid-flow, beta-wrap` (not alphabetical on purpose).

Each chapter holds a real H.264 + AAC clip made by the static ffmpeg (`testsrc2` 320x180 at 25 fps plus a `sine`
tone, `-movflags +faststart`; 3.2, 4.4, 3.8 and 4.92 s long, about 120 KB each), `chapter.json`, `narration.txt`, a
24 kHz mono `narration.wav`, `beats.json` whose `durationS` is ffprobe's length of the clip, `captions.vtt`,
`captions.json`, `index.html`, `build.json` written by `buildRecord()` from `lib/build-record.cjs`, and `render.json`
naming the sha256 of those `build.json` bytes. `mid-flow` is the stale one: after its `render.json` was written its
`index.html` changed and `build.json` was written again, as a second narrate would do. Building the project takes
about 0.6 s.

The server is started with the real CLI, `node bin/yap.cjs serve --detach --dir <slugDir>`, with the two variables
exported so the poster frames come from the static ffmpeg. Everything after that goes over `node:http`, or raw
`node:net` where the request must reach the server exactly as written. Chat replies and chapter changes use the real
CLI (`yap reply`, `yap add-chapter`, `yap set-status`).

## Results

Values below are from the third of the three final runs; the other two differ only in ports, pids, keys and a few
milliseconds.

## Step 1: start and `state/server.json`

| Check | Result | Observed |
|---|---|---|
| `1.detach-prints-url` | PASS | exit 0, printed `http://127.0.0.1:<port>/?key=<32 hex>`, the same URL as in server.json |
| `1.server-json-exists` | PASS | present |
| `1.server-json-mode-0600` | PASS | mode 0600 |
| `1.server-json-fields` | PASS | keys url, key, port, pid, started_at; url is `http://127.0.0.1:<port>/?key=<key>` |
| `1.pid-alive` | PASS | the pid is a running process |
| `1.key-in-query-302-cookie` | PASS | `GET /?key=<key>`: 302, `Location: /`, `Set-Cookie: yap_key_<port>=<key>; HttpOnly; SameSite=Strict; Path=/` |
| `1.cookie-get-page-200-lists-chapters` | PASS | `GET /` with that cookie: 200 `text/html; charset=utf-8`, all 4 titles in story order, 3 `<video>` elements (the stale chapter has none) |

## Step 2: key guard, manifest, posters, media

| Check | Result | Observed |
|---|---|---|
| `2.no-key-403-every-route` | PASS | 403 for GET `/`, `/api/state`, `/api/ping`, `/api/stream`, `/chapters/<id>/video`, `/poster`, `/captions`, an unknown route, HEAD `/video`, and POST `/api/message`, `/api/reply`, `/api/chapters`, `/api/heartbeat`, `/api/export` |
| `2.wrong-key-403` | PASS | a wrong key in the header: 403; in the query: 403 |
| `2.state-with-key-200` | PASS | 200 `application/json`; keys manifest, thread, claude_connected, now |
| `2.manifest-order-is-order-json` | PASS | zeta-intro, alpha-setup, mid-flow, beta-wrap |
| `2.ready-row.zeta-intro` | PASS | ready, duration_s 3.2 = ffprobe 3.2, build_sha256 equals the sha256 of build.json |
| `2.ready-row.alpha-setup` | PASS | ready, 4.4 = 4.4, build_sha256 matches |
| `2.ready-row.beta-wrap` | PASS | ready, 4.92 = 4.92, build_sha256 matches |
| `2.poster.zeta-intro` | PASS | manifest `chapters/zeta-intro/poster.jpg`; route 200 `image/jpeg`, 9253 bytes, starts FF D8 |
| `2.poster.alpha-setup` | PASS | same, starts FF D8 |
| `2.poster.beta-wrap` | PASS | same, starts FF D8 |
| `2.stale-row` | PASS | mid-flow: status stale, poster null |
| `2.range-100-199` | PASS | 206, `Content-Range: bytes 100-199/123368`, 100 bytes equal to the file's bytes 100..199 |
| `2.range-0-open` | PASS | `bytes=0-`: 206, `Content-Range: bytes 0-123367/123368`, the whole file byte for byte |
| `2.no-range-200` | PASS | 200, `Accept-Ranges: bytes`, `video/mp4`, 123368 bytes |
| `2.head-video` | PASS | 200, `Content-Length: 123368`, no body |
| `2.stale-video-404` | PASS | 404 `{"error":"not found"}` |
| `2.captions-vtt` | PASS | 200 `text/vtt; charset=utf-8`, body starts `WEBVTT` |

The duration check is true by construction here: the script writes ffprobe's length into `beats.json`, and the
server reads `duration_s` from there. The export check in Step 5 (joined length against the sum of the chapter
lengths) is the one that compares the server's work with real video lengths.

## Step 3: real browser check

Done by hand in Google Chrome 154.0.8037.95 against the script's `--keep` server (same synthetic project, commit
`570a58c` plus the acceptance script). Values were read from the page with the browser's own scripting console;
the page itself ships no scripts.

| Check | Result | Observed |
|---|---|---|
| Opening the printed URL (key in the query) | PASS | lands on `http://127.0.0.1:<port>/` with no key left in the address bar |
| Page lists the chapters in story order | PASS | `Zeta intro`, `Alpha setup`, `Mid flow`, `Beta wrap` (order.json order, not alphabetical), each with its status |
| Page has no scripts | PASS | `document.scripts.length` is 0 |
| Each ready video loads its metadata | PASS | three `<video>` elements, all `readyState` 4, 320x180, durations 3.2 s, 4.4 s, 4.92 s: equal to `duration_s` in `/api/state` |
| The stale chapter shows no video | PASS | `Mid flow` shows the word `stale` and has no `<video>` element |
| A ranged request from the page | PASS | `fetch` with `Range: bytes=0-99` on chapter 2: 206, `Content-Range: bytes 0-99/174315`, `video/mp4` |
| Playing chapter 2 | PASS | from 0.4 s the clock reached 2.195 s after about 1.5 s; 155 frames decoded; no media error |
| Seeking inside chapter 2 | PASS | seek to 3.5 s then back to 0.4 s; both `seeked` events fired; the frame's burnt-in timecode reads `00:00:00.400`; buffered range 0 to 4.4 s |

Screenshot: `frames/placeholder-page-chrome.jpg` (taken after the seek back to 0.4 s).

One thing to know when repeating this: while the tab is in the background Chrome does not load video metadata
at all (`readyState` stayed 0 and no request was made for 5 s). It loaded at once when the tab became visible.
That is the browser's behaviour for hidden tabs, not the server's; the same request made with `fetch` from the
hidden tab was answered straight away.

Not covered here: the thread is not shown on the placeholder page (it is in `/api/state` only), posters are not
shown on it either, and no other browser was tried.

## Step 4: live updates, chat, chapter commands

`alpha-setup` is the chapter changed on disk. The stream is open (`GET /api/stream` with the key header) for the whole step.

| Check | Result | Observed |
|---|---|---|
| `4.stream-first-event-state` | PASS | 200 `text/event-stream`; first event `state` |
| `4.mp4-gone-video-404-immediately` | PASS | `chapter.mp4` renamed away: `/video` 404 1 ms later |
| `4.mp4-gone-not-ready-within-3s` | PASS | status **pending** after 915 ms, poster null (see the note below) |
| `4.mp4-gone-chapter-event` | PASS | a `chapter` event (op scan) showing alpha-setup pending arrived 914 ms after the rename |
| `4.mp4-back-ready-within-3s` | PASS | renamed back: ready after 1018 ms |
| `4.mp4-back-poster-again` | PASS | poster set again 1071 ms after the rename back; poster.jpg is a new file (inode changed) |
| `4.build-edit-stale-within-3s` | PASS | a space appended to build.json: stale after 955 ms, poster null, `/video` 404 |
| `4.build-restored-ready-within-3s` | PASS | original bytes restored: ready after 1020 ms |
| `4.post-message` | PASS | `POST /api/message` `{type:'message', text:'why does it start there?', context:{chapter_id:'alpha-setup', t:1.5}}`: 200, id `evt_1` |
| `4.cli-reply-line` | PASS | `yap reply --in-reply-to evt_1 --text "..." --source src/app.js:10-12 --dir <slugDir>`: exit 0, prints `reply rep_1 sent` |
| `4.reply-event-on-stream` | PASS | `reply` event: id rep_1, role claude, in_reply_to evt_1, sources `[{"file":"src/app.js","lines":"10-12"}]` |
| `4.thread-viewer-then-claude` | PASS | `/api/state` thread: `viewer:evt_1, claude:rep_1` |
| `4.cli-add-chapter` | PASS | `yap add-chapter --id extra-topic --after alpha-setup --title "Extra"`: exit 0, prints `chapter extra-topic added at position 3`; manifest zeta-intro, alpha-setup, extra-topic, mid-flow, beta-wrap |
| `4.cli-set-status` | PASS | `yap set-status --id extra-topic --status failed`: exit 0, prints `chapter extra-topic is failed`; the row is failed, title Extra |

Note on the brief's wording: the brief expects `stale` when `chapter.mp4` is renamed away. With no video file there
is nothing to be stale, so the scan reports `pending` (`lib/chapter-scan.cjs` `decideStatus`); the controller ruled
that `pending` is the expected status. Observed: `pending`. A real stale (`build.json` edited) is covered by
`4.build-edit-stale-within-3s`. Every change was seen by the one-second folder watcher in 0.9 to 1.1 s.

## Step 4b: heartbeat

| Check | Result | Observed |
|---|---|---|
| `4b.connected-false-at-first` | PASS | `claude_connected` false |
| `4b.heartbeat-then-true` | PASS | `POST /api/heartbeat` `{}`: 200; then true |
| `4b.false-after-16s` | PASS | false again after a real 16 s wait |

## Step 5: export

`POST /api/export` with `{dest: <fresh folder in the run's temp dir>, mode: 'drafts'}`.

| Check | Result | Observed |
|---|---|---|
| `5.export-drafts-200` | PASS | 200 in 73 ms: `{"file":"demo.mp4","files":["demo.mp4","script.md","sources.json"],"skipped":[{"id":"extra-topic","reason":"not ready"},{"id":"mid-flow","reason":"not ready"}]}` |
| `5.export-files-present` | PASS | the folder holds demo.mp4, script.md, sources.json |
| `5.export-duration-and-streams` | PASS | ffprobe 12.542 s against the ready chapters' sum 12.520 s (0.022 s apart); 1 video and 1 audio stream |
| `5.export-texts-identical` | PASS | script.md and sources.json are byte-identical to the originals |
| `5.second-export-numbered` | PASS | second export into the same folder: 200, demo-2.mp4, script-2.md, sources-2.json |
| `5.first-set-untouched` | PASS | sha256 of demo.mp4, script.md, sources.json unchanged by the second export |
| `5.full-mode-409-names-drafts` | PASS | `mode: 'full'`: 409 `still drafts: zeta-intro, alpha-setup, beta-wrap; wait for the full render or export drafts` |
| `5.dest-yap-folder-400` | PASS | `dest` = the project's `.yap` folder: 400 `dest must not be the project .yap folder or inside it` |
| `5.no-hidden-work-folder-left` | PASS | no `.yap-export-*` folder in dest after both exports |

## Step 6: hostile requests

All of these carry the right key and the right `Host` unless the check is about one of them, so the answer
shows the check under test and not the key guard.

| Check | Result | Observed |
|---|---|---|
| `6.forged-host-403` | PASS | `Host: evil.example` with the right key: 403 `{"error":"forbidden"}` |
| `6.absolute-form-bad-port-4xx` | PASS | raw `GET http://x:99999/ HTTP/1.1`: `HTTP/1.1 400 Bad Request` with body `{"error":"bad request"}` (the server's own answer, not Node's parser) |
| `6.answers-after-absolute-form` | PASS | `/api/ping` 200 afterwards, same pid |
| `6.escape-dotdot-slash-404` | PASS | raw `GET /chapters/..%2f..%2fetc/video`: `HTTP/1.1 404 Not Found` |
| `6.escape-dotdot-404` | PASS | raw `GET /chapters/%2e%2e/video`: `HTTP/1.1 404 Not Found` |
| `6.body-10mb-413` | PASS | 10 MB JSON body to `/api/message` with `Content-Length`: status line `HTTP/1.1 413 Payload Too Large` received; the client could write all 10 485 760 bytes without a reset |
| `6.body-10mb-chunked-413` | PASS | the same 10 MB sent chunked (no length): `HTTP/1.1 413 Payload Too Large` received |
| `6.range-past-end-416` | PASS | `Range: bytes=999999999-`: 416, `Content-Range: bytes */123368` |
| `6.foreign-origin-post-403` | PASS | `POST /api/heartbeat` with `Origin: https://evil.example` and the right key: 403 |
| `6.cookie-wrong-name-403` | PASS | only `Cookie: yap_key=<key>` (no port in the name): 403 |
| `6.300-hangups-then-ok` | PASS | 300 connections that sent `GET /api/state HTTP/1.1` and hung up (in 19 ms); then `/api/ping` 200 with the same pid |

## Observations

Measured, not pass/fail. Ranges are over the three final runs.

- Time from `yap serve --detach` to the URL being printed: 92 to 173 ms.
- Time from the start of `serve --detach` until all three posters were in the manifest: 126 to 209 ms (about 34 to
  36 ms after the URL was printed; each poster is one ffmpeg frame grab of a 320x180 clip).
- Export of the three ready chapters (stream copy, 12.5 s of video): 72 to 91 ms.
- Folder changes (video renamed away or back, build.json edited or restored) reached `/api/state` and the stream in
  0.9 to 1.1 s; a new poster after a chapter came back took about 1.1 s.
- Server resident memory after the run (`ps -o rss=`): 83 776 to 86 368 KB (82 to 84 MB).
- `manifest.json` after the run (5 rows): 2494 bytes.
- Events seen on the stream during Step 4 to 6: `state`, then `chapter` events for each folder change and poster,
  `state` after the message and after the heartbeat, `reply` for the CLI reply, and one `ping` (the 15 s keep-alive).
- Stopping the server with SIGTERM took 51 to 55 ms, and `state/server.json` was removed.

## Findings

No check failed, so there is no Critical or Important finding.

- **Minor: the detached server's error output goes nowhere.** `yap serve --detach` starts the child with
  `stdio: 'ignore'` (`lib/server-cli.cjs:79`), so everything the server writes through `state.logError` or
  `answerError` (a failed poster grab, a manifest save that failed, the stack of a 500) is thrown away in the mode the
  skill uses. Evidence: during this run the only way to tell "ffmpeg did not run" from "the poster was not recorded"
  would have been to look at `poster.jpg` on disk; the script records both for that reason. Suspected cause: by
  design for a quiet background process, but there is no log file to look at when something goes wrong. A
  `state/server.log` would make a field failure diagnosable.
- **Note, not a defect:** the brief's Step 4 expects `stale` when the video is renamed away; the product says
  `pending`, which the controller ruled correct (no video, nothing to be stale).
