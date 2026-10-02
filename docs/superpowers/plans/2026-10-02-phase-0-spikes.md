# Yap Phase 0: Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Per the owner's standing preference, this plan carries **commands and logic sketches, not full implementations**. A spike's code is throwaway; its **result document is the deliverable**.

**Goal:** Turn the 7 unverified assumptions in the spec into pass/fail answers, each with evidence and a stated consequence for the design, before any real building starts.

**Architecture:** One task per spike. Each task runs a small, cheap experiment, records evidence, and writes `docs/spikes/NN-<name>.md` in a fixed format (question, method, result, evidence, consequence). A final task rolls the results into a table and proposes spec amendments for the owner to approve. No product code is written in this phase.

**Tech Stack:** Claude Code CLI (`claude -p`, `--resume`, `--fork-session`, Monitor tool), Hyperframes CLI v0.8.x (`render`, `tts`, `transcribe`, `doctor`), Node 22+, ffmpeg, a browser (Chrome) for the gap test, plain shell.

**Spec:** `docs/superpowers/specs/2026-10-02-yap-design.md` (section 9 lists the spikes; section 13 the phases).

## Global Constraints

- Nothing in this phase may spend money beyond the owner's own Claude tokens. No paid generation services.
- Spike code lives in `spikes/NN-<name>/` and is labelled throwaway in its README. It is committed as evidence, never imported by product code.
- Every result document uses the format in Task 0 and ends with a **Consequence** line that names the spec section to change, or says "no change".
- A spike's verdict is exactly one of **PASS**, **FAIL**, **PARTIAL** (with what works and what does not). "Inconclusive" is not allowed: narrow the experiment until it is conclusive.
- Record the machine used (OS, CPU, RAM) in every result that measures time or memory, so the numbers are not mistaken for universal ones.
- Never run anything against the owner's production systems. Spikes touch only this repo, temp folders, and Claude/Hyperframes tools.
- Commit messages end with the two attribution lines the owner's session requires.

## Review Focus

These are the conditions a spike is most likely to get wrong by testing only the happy case on the author's machine. Each has a pinned check in the task that owns it.

1. **Memory on a smaller laptop.** The parallel-render spike passes on a 36 GB Mac and fails on an 8 GB one. Record per-render peak memory so the conclusion can be scaled. *(Task 3)*
2. **First-run download cost.** Kokoro and Whisper models download once; a slow network or a blocked download changes "works offline" into "fails on first run". Record sizes and time. *(Tasks 4, 5)*
3. **Resuming from a different folder.** `claude --resume` may only find sessions for the folder it was started in. The server will not always run from the same folder. *(Task 1)*
4. **A long, expensive session.** Resume costs tokens in proportion to the session's size. A cheap test session hides this. Measure with a session that already has real context. *(Task 1)*
5. **Laptop sleep and a long idle.** A listener that survives 30 minutes awake may die on lid-close or after a timeout. *(Task 7)*

---

## File Structure

```
spikes/
  README.md                       index + the throwaway warning
  01-resume/      run.sh  README.md
  02-parallel-render/  compose/  run.sh  README.md
  03-narration-timing/  run.sh  README.md
  04-kokoro-local/  run.sh  README.md
  05-install-hook/  README.md      (research, no code)
  06-chapter-gap/   index.html  serve.sh  README.md
  07-monitor-idle/  README.md      (run live in a session)
docs/spikes/
  TEMPLATE.md
  01-resume.md … 07-monitor-idle.md
  SUMMARY.md                       table + proposed spec amendments
```

---

### Task 0: Environment and result template

**Files:** create `spikes/README.md`, `docs/spikes/TEMPLATE.md`, `docs/spikes/ENV.md`.

**Interfaces:** Produces the result-document format every later task fills in, and a known-good toolchain.

- [ ] **Step 1: Check the toolchain and write what you find to `docs/spikes/ENV.md`.**
  Run: `node -v` (must be 22+), `npx hyperframes doctor --json | jq .ok`, `ffmpeg -version`, `claude --version`, and note OS, CPU and RAM (`sysctl -n machdep.cpu.brand_string hw.memsize`).
  Expected: all succeed. **Known failure on the owner's Mac:** Homebrew `ffmpeg` cannot load `libx265.216.dylib`. If `ffmpeg -version` fails, fix it with `brew reinstall x265 ffmpeg`. If you cannot, download a static ffmpeg/ffprobe into `spikes/.tools/` and export `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH`, and record which route you used in `ENV.md`.
- [ ] **Step 2: Write `docs/spikes/TEMPLATE.md`** with these headings in order: **Question**, **Method** (commands, one paragraph), **Machine** (from ENV.md), **Result** (`PASS` / `FAIL` / `PARTIAL`), **Evidence** (command output excerpts, numbers), **Consequence** (the spec section to change and how, or "no change").
- [ ] **Step 3: Write `spikes/README.md`** saying: this folder is throwaway evidence, never imported by product code; one folder per spike.
- [ ] **Step 4: Commit** `docs: spike template and environment notes`.

---

### Task 1: Spike 1 — session id and `claude -p --resume` as the fallback

**Question:** Can a server answer a queued chat message when no live Claude session is listening, by resuming the original session headlessly, without corrupting it and at an acceptable cost?

**Files:** `spikes/01-resume/run.sh`, `spikes/01-resume/README.md`, `docs/spikes/01-resume.md`.

**Interfaces:** Consumes the template from Task 0. Produces, for the spec's section 4.5: (a) how to read a session id, (b) the exact resume command, (c) whether a fork is needed.

Facts already confirmed from `claude --help`: `-p/--print`, `--output-format`, `--resume <session-id>`, `--fork-session` ("create a new session ID instead of reusing the original").

- [ ] **Step 1: Write `run.sh` sketch** that, in a fresh temp folder `D1`:
  1. `claude -p "Remember the code word KIWI. Reply OK." --output-format json` and extract `session_id` from the JSON.
  2. `claude -p --resume <id> "What was the code word?"` and assert the reply contains `KIWI`.
  3. Run the same with `--fork-session`; assert the reply contains `KIWI` **and** that the original session's transcript file is unchanged (hash before/after; transcripts live under `~/.claude/projects/<folder-slug>/<id>.jsonl`).
- [ ] **Step 2: Run it.** Expected: step 2 and 3 pass. Record the exact commands and the JSON field name for the id.
- [ ] **Step 3: Different folder (Review Focus 3).** From a *different* temp folder `D2`, run `claude -p --resume <id> "code word?"`. Record PASS/FAIL and the exact error if it fails. If it fails, test whether `cd D1` first works, and record that the server must run from the session's folder.
- [ ] **Step 4: Can a live session learn its own id?** In an interactive session, find the id without hooks: the newest `.jsonl` under `~/.claude/projects/<folder-slug>/` is the live session's transcript, and its file name is the id. Verify by comparing against the id a hook-free `claude -p --output-format json` run in that folder reports, and by checking the id Claude shows in its own attribution line if present. Record how reliable the "newest file" rule is when two sessions share a folder.
- [ ] **Step 5: Cost with a real, large session (Review Focus 4).** Pick an existing long session (for example this one's transcript under `~/.claude/projects/`), resume it with `--fork-session -p "Say OK."`, and read the cost/token usage from the JSON output. Record tokens and dollars for one resumed message at that context size.
- [ ] **Step 6: Concurrency.** While an interactive session is idle, run `--resume --fork-session` against it from a second terminal. Record whether the interactive session is affected (it should not be, because the fork gets a new id).
- [ ] **Step 7: Write `docs/spikes/01-resume.md`.** Verdict rules: PASS if steps 1 and 2 pass and the fork leaves the original untouched; PARTIAL if it only works from the original folder or costs more than about 0.50 USD per message at a realistic context size. Consequence: update spec section 4.5 with the exact command, the folder requirement, and the cost warning, or remove the fallback if FAIL.
- [ ] **Step 8: Commit** `docs: spike 1 result (claude -p --resume fallback)`.

---

### Task 2: Spike 7 — Monitor over a long idle (do this early; it needs wall-clock time)

**Question:** Does a Monitor watching an events file keep working across a long idle, wake Claude on a new line, and cost nothing while idle? Does it survive laptop sleep?

**Files:** `spikes/07-monitor-idle/README.md`, `docs/spikes/07-monitor-idle.md`.

**Interfaces:** Produces the facts for spec section 4.5: the Monitor settings to use (timeout, persistence) and the limits to document.

This spike runs inside an interactive Claude Code session, because Monitor is a session tool. Start it first and do other tasks while it waits.

- [ ] **Step 1: Read the Monitor tool's own schema** (load it with ToolSearch) and write down every parameter that bears on lifetime: timeout, persistence, output limits. Record them in the result document verbatim.
- [ ] **Step 2: Create the events file** `spikes/07-monitor-idle/events.jsonl` (empty) and start `tail -F` on it under Monitor with the longest lifetime the tool allows. Note the start time.
- [ ] **Step 3: Baseline.** Record the session's token usage now (the status line or `/cost`).
- [ ] **Step 4: Idle 35 minutes** (more than the common 30-minute default) doing nothing in this session. Then append one JSON line to `events.jsonl` from another terminal. Expected: Claude is woken within about 5 seconds and can read the line. Record the delay.
- [ ] **Step 5: Idle cost.** Compare token usage before the idle and just before the append. Expected: no change.
- [ ] **Step 6: Sleep test (Review Focus 5).** Start a fresh Monitor, close the lid for 2 minutes, reopen, append a line. Record whether the Monitor is still alive and whether the line wakes Claude.
- [ ] **Step 7: Write `docs/spikes/07-monitor-idle.md`.** PASS if step 4 wakes within about 5 s and step 5 shows zero idle cost. PARTIAL if it dies at a timeout or after sleep: record the limit and design the fix (a re-arm step in the skill, or a heartbeat the server uses to notice and tell the viewer "Claude isn't connected"). Consequence: spec section 4.5 gets the real limits.
- [ ] **Step 8: Commit** `docs: spike 7 result (Monitor long idle)`.

---

### Task 3: Spike 2 — parallel chapter renders

**Question:** Can chapters render in parallel with Hyperframes without failing or exhausting memory, and how much faster is it?

**Files:** `spikes/02-parallel-render/compose/` (three tiny compositions), `spikes/02-parallel-render/run.sh`, `docs/spikes/02-parallel-render.md`.

**Interfaces:** Produces numbers for spec sections 5.8 and 6: the safe default for `--workers`, how many chapters to render at once, and a memory figure per render.

Facts confirmed from `hyperframes render --help`: `--quality draft|looks|delivery`, `--workers <n|auto>` ("each worker launches a separate" browser), `-c/--composition`, `-o`.

- [ ] **Step 1: Make three small compositions** (12 seconds each, 1080p, a few animated shapes and a caption) with the Hyperframes entry skill and `hyperframes init`. They only need to be realistic in size, not in content.
- [ ] **Step 2: Write `run.sh` sketch** that renders them (a) sequentially at `--quality draft`, then (b) as three background processes at once, and records for each run the wall time and peak memory (`/usr/bin/time -l` on macOS reports "maximum resident set size"), and the exit code.
- [ ] **Step 3: Run it twice** to see variance. Record all numbers.
- [ ] **Step 4: Per-render peak memory (Review Focus 1).** Report the peak for one render alone, and for the three together. State what machine RAM would be needed for N parallel chapters (peak × N + 2 GB headroom).
- [ ] **Step 5: Check that `--workers` inside one render also parallelises.** Render one chapter with `--workers 1` and `--workers auto`; record the difference. Decide whether the plan should parallelise across chapters, within a chapter, or both.
- [ ] **Step 6: Write `docs/spikes/02-parallel-render.md`.** PASS if the three-at-once run finishes with no failures in at most 0.6 times the sequential time and peak total memory stays under half of installed RAM. PARTIAL if it works but needs a cap (record the safe cap). FAIL if renders crash or corrupt output. Consequence: spec section 5.8 gets the real concurrency default; section 6 gets the "lower workers on low memory" rule's actual threshold.
- [ ] **Step 7: Commit** `docs: spike 2 result (parallel renders)`.

---

### Task 4: Spike 3 — can scene timing follow narration?

**Question:** Can we get reliable word- or sentence-level timing from narration audio so scene beats line up with the voice?

**Files:** `spikes/03-narration-timing/run.sh`, `docs/spikes/03-narration-timing.md`.

**Interfaces:** Produces a timing recipe for spec section 5.5-5.6: where the beat times come from and what extra dependency it costs.

Facts confirmed from `--help`: `hyperframes tts` runs a local Kokoro-82M model and can output JSON; `hyperframes transcribe` returns word-level timestamps and may need `whisper-cpp` ("--optional ... if whisper-cpp is unavailable").

- [ ] **Step 1: Write a three-sentence narration** (about 25 words) to `narration.txt`. Generate audio: `npx hyperframes tts narration.txt -o narration.wav --json`. Record whether the JSON includes any timing.
- [ ] **Step 2: Measure true duration** with `ffprobe` (or the static copy) and compare it with any duration the tts output reports.
- [ ] **Step 3: Try `npx hyperframes transcribe narration.wav --json`.** Record: does it work on this machine without extra installs, what engine it used, how long it took, and the first few word timestamps.
- [ ] **Step 4: Accuracy.** Compare the transcript's last-word end time with the true audio duration (error should be under 0.3 s) and spot-check three words by playing the audio and noting where they start.
- [ ] **Step 5: Fallback recipe.** If transcribe is unavailable or slow, compute sentence boundaries by splitting the text on sentence ends and distributing the true duration in proportion to character counts. Compare these estimated boundaries with the transcript's real ones (if you got them) and record the error.
- [ ] **Step 6: Write `docs/spikes/03-narration-timing.md`.** PASS if `transcribe` works with no manual install and error is under 0.3 s. PARTIAL if it needs `whisper-cpp` or a model download (record the install step and size) or only the character-proportional fallback is accurate enough (under 0.5 s). Consequence: spec section 5 states the timing source and the doctor check list gains the extra dependency if any.
- [ ] **Step 7: Commit** `docs: spike 3 result (narration timing)`.

---

### Task 5: Spike 4 — Kokoro is free, local, and keyless

**Question:** Does `hyperframes tts` work with no API key, after a one-time download, and then fully offline?

**Files:** `spikes/04-kokoro-local/run.sh`, `docs/spikes/04-kokoro-local.md`.

**Interfaces:** Produces the first-run cost (download size and time) for the README and doctor, and confirms the "no cost to the user" claim.

- [ ] **Step 1: Find where models are cached** (`npx hyperframes tts --help`, then check the cache folder it mentions or `~/.cache`). Record the path and, if a model is already there, delete only that model's folder so the first run is a true first run (record that you did so).
- [ ] **Step 2: First run with a clean environment.** `env -i HOME="$HOME" PATH="$PATH" npx hyperframes tts "Hello from Yap." -o first.wav`. This proves no API key variable is needed. Record the download size (cache folder size after) and total time.
- [ ] **Step 3: Offline run (Review Focus 2).** Turn Wi-Fi off, or block the network for the process, and run again with new text. Expected: works. Record the result.
- [ ] **Step 4: Voices.** Run `npx hyperframes tts --list` and record how many voices exist and which are English, so the narration prompt can name a default.
- [ ] **Step 5: Write `docs/spikes/04-kokoro-local.md`.** PASS if steps 2 and 3 both succeed with no keys. PARTIAL if it needs a key or a network for each run. Consequence: spec section 11 states the exact one-time download size and that narration is free and local, or removes that claim.
- [ ] **Step 6: Commit** `docs: spike 4 result (Kokoro local)`.

---

### Task 6: Spike 6 — gap between chapter videos in the player

**Question:** When the player plays several MP4 chapters back to back, is the gap between them noticeable?

**Files:** `spikes/06-chapter-gap/index.html`, `spikes/06-chapter-gap/serve.sh`, `docs/spikes/06-chapter-gap.md`.

**Interfaces:** Produces the decision for spec section 4.7: switch between per-chapter videos, or join them ahead of time.

- [ ] **Step 1: Make three 8-second test clips** with different colors and a running frame counter (ffmpeg `testsrc2`, H.264, 30 fps, the same encoding settings Hyperframes uses at `draft`).
- [ ] **Step 2: Write `index.html` sketch** with two `<video>` elements (current and next). While the current plays, the next has `preload="auto"` and has been seeked to 0. On the current's `ended`, immediately call `next.play()` and swap visibility. Log `performance.now()` at `ended` and at the next video's first `playing` event, and print `gap_ms` to the page and the console.
- [ ] **Step 3: Serve and measure.** `serve.sh` runs a static server (`python3 -m http.server`). Open the page in Chrome, play through all three clips three times, and read the gaps from the console (use the claude-in-chrome tools or the DevTools console).
- [ ] **Step 4: Try the alternative.** Repeat with the next clip started slightly *before* the current ends (for example 100 ms), crossfading. Record whether the visual gap disappears.
- [ ] **Step 5: Seeking across chapters.** Click to a random point in chapter 2 and then chapter 3 and record how long until the picture appears (`seek_to_playing_ms`). Timeline clicks need to feel instant.
- [ ] **Step 6: Write `docs/spikes/06-chapter-gap.md`.** PASS if the gap is under 150 ms in the plain approach, or the crossfade removes it. FAIL if neither does. Consequence: if FAIL, spec 4.7 says chapters are pre-joined into a single stream in the background (and individual chapter files stay for editing).
- [ ] **Step 7: Commit** `docs: spike 6 result (chapter gap)`.

---

### Task 7: Spike 5 — is there an install-time hook for the doctor?

**Question:** Can a Claude Code plugin run a command when it is installed? If not, what is the best moment to run the doctor?

**Files:** `spikes/05-install-hook/README.md`, `docs/spikes/05-install-hook.md`.

**Interfaces:** Produces the doctor's trigger for spec section 5.1.

This is research, not code. Primary sources only.

- [ ] **Step 1: Ask the `claude-code-guide` agent** (and check the plugin docs it points to) what plugin hook events exist (for example `SessionStart`) and whether anything runs at install time. Record the answer with the doc URL.
- [ ] **Step 2: Inspect a real plugin.** Read `~/.claude/plugins/cache/brag/brag/0.2.2/.claude-plugin/plugin.json` and any `hooks` it declares. Record how `brag` handles first-run setup (the screenshot evidence shows it installs Hyperframes skills when first used).
- [ ] **Step 3: Test the fallback.** Create a throwaway plugin in a temp folder with a `SessionStart` hook that writes a marker file once, install it from the local path, start a session, and confirm the marker appears exactly once per start (not per message). Record the result.
- [ ] **Step 4: Write `docs/spikes/05-install-hook.md`.** PASS if a documented install-time hook exists. PARTIAL if only `SessionStart` or first-use works (then the doctor runs at first use of `/yap` and caches "ok" in a state file). Consequence: spec section 5.1 says which, and the README tells users what to expect.
- [ ] **Step 5: Commit** `docs: spike 5 result (install hook)`.

---

### Task 8: Roll-up and spec amendments

**Files:** `docs/spikes/SUMMARY.md`.

**Interfaces:** Consumes all seven results. Produces the go/no-go for Phase 1 and a list of proposed spec edits.

- [ ] **Step 1: Write `SUMMARY.md`** with a table: spike, verdict, one-line finding, spec section affected. Under it, a "Proposed spec amendments" list, each item quoting the current spec text and the replacement.
- [ ] **Step 2: Decide the Phase 1 go/no-go in writing.** Phase 1 (the generator) can start if spikes 3 and 4 are PASS or PARTIAL (narration works) and spike 2 is PASS or PARTIAL (rendering is workable). If spike 1 or 7 FAIL, the chat bridge needs redesign, but that is Phase 4 and does not block Phase 1; say so.
- [ ] **Step 3: Self-check** that every spike in spec section 9 has a result file and that no verdict is "inconclusive".
- [ ] **Step 4: Commit** `docs: phase 0 summary and proposed spec amendments`.
- [ ] **Step 5: Hand the amendments to the owner.** Do **not** edit the spec: the owner approves each amendment, then a separate commit applies them.

---

## Order of work

Task 0 first. Then **start Task 2 (Monitor idle) immediately** and run Tasks 1, 3, 4, 5, 6 and 7 while its 35 minutes pass. Task 8 last. Estimated effort: Task 0 about 10 minutes, each spike 15 to 30 minutes, the roll-up 15 minutes; about 3 hours of agent time with the idle wait overlapped.
