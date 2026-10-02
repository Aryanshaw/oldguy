# Phase 0 summary (2026-10-02)

Machine: Apple M3, **8 GB RAM**, about 4 GB disk free (a low-end laptop on purpose, so the numbers are a
cautious baseline). Details in `ENV.md`.

## Results

| # | Spike | Verdict | One-line finding | Spec sections affected |
|---|---|---|---|---|
| 1 | `claude -p --resume` fallback | PARTIAL | Works from any folder and a fork leaves the original alone, but a cold resume of a mid-size session cost about 1.38 USD per message | 4.5 |
| 2 | Parallel chapter renders | **PASS** | 3 chapters at once took 0.37 to 0.40x the sequential time (like for like) for about +1 GB sampled; sub-compositions cannot render alone | 4.1, 5.8, 6 |
| 3 | Narration timing | PARTIAL | Word timing accurate to 0.12 s but needs whisper.cpp (Hyperframes silently ran `brew install`); a sentence-share fallback is within 0.32 s with no dependency | 5.1, 5.5, 5.6 |
| 4 | Kokoro local | **PASS** | Free, keyless, offline after download; needs Python packages (127 MB) and a 353 MB model; first run 342 s | 5.1, 5.6, 11 |
| 5 | Install hook | PARTIAL | No install-time hook; a `SessionStart` hook works and receives `session_id`, `transcript_path`, `cwd`, `source` | 5.1, 10 |
| 6 | Chapter gap | **PASS** | 20 to 35 ms between chapters, seeks 23 to 90 ms; keep one MP4 per chapter | 4.7 |
| 7 | Monitor long idle | PARTIAL | Wakes Claude from idle in about 1 s, but a Monitor expires after at most 30 minutes, so the bridge needs a re-arm loop | 4.5 |

No verdict is "inconclusive".

**Plan steps not run as written** (each is also disclosed in its own result document):
1. Laptop sleep (spike 7) and a listening check of audio across chapters (spike 6): both need the owner present.
2. A 35-minute single Monitor (spike 7): impossible at the 30-minute cap; the expiry test replaced it.
3. A live concurrent resume against an idle interactive session (spike 1): replaced by file-level evidence (a fork never
   touches the original transcript; a plain resume appends to it).
4. Whether the "newest transcript" rule holds when two sessions share a folder (spike 1): not tested. The
   `SessionStart` hook (spike 5) makes it unnecessary.
5. Spot-check of three words by ear (spike 3): no audio output in this session.
6. "Wi-Fi off" (spike 4): replaced by `sandbox-exec` denying all network.
7. Three plain runs of the gap test (spike 6): two plain runs, one overlap run, one seek run.

## Phase 1 go / no-go

**GO.** Narration works (spikes 3 and 4 are PARTIAL with a working path that adds only Python packages and a
model download), rendering works and is faster in parallel (spike 2 PASS). Spikes 1 and 7 only affect the
chat bridge (Phase 4) and do not block the generator.

## Proposed spec amendments (each needs the owner's approval; none is applied)

1. **4.1** `scene.html` is a **standalone root composition** with its own `data-duration` (a sub-composition
   fragment cannot be rendered alone).
2. **4.5, listener:** `yap listen` tails with `tail -n 0 -F` under Monitor at the 30-minute maximum and **re-arms on
   every expiry notice**, resuming from the last acknowledged event id so nothing is lost. Replace "idle cost is
   zero" with "one small turn per 30 minutes plus one per question". Decide in Phase 4 whether to use Monitor's
   `ws` source instead.
3. **4.5, fallback:** `claude -p --resume <id> --fork-session --max-budget-usd <cap> "<msg>" --output-format json
   </dev/null`; never a plain resume while a live session may use the id; **opt-in, with the cost shown** (about
   1.4 USD per cold message on a mid-size session).
4. **4.5 / 10, session id:** a `SessionStart` hook (`hooks/hooks.json`) writes `{session_id, transcript_path, cwd}` to
   `.yap/session.json` on `startup` and `resume`.
5. **4.7 / 4.3:** the server must support **HTTP range requests**; keep one MP4 per chapter and two video
   elements; add an audio-continuity check (each chapter's WAV starts and ends with a few ms of silence).
6. **5.1, doctor:** runs from a `SessionStart` hook that only prints a hint, plus `/yap doctor` and first use; it
   checks Node, Hyperframes, a **working** ffmpeg, free RAM and **at least 1 GB free disk** (Hyperframes' own cache
   reached 1.0 GB here), and a **Python venv that Yap creates** (`kokoro-onnx`, `soundfile`) with
   `HYPERFRAMES_PYTHON` pointing at it. `whisper-cli` is an optional upgrade, installed only with the user's consent.
7. **5.5 / 5.6, timing:** default timing = WAV duration shared across sentences by character count (about 0.3 s
   error); word-level timing via `transcribe` is opt-in. Narration is written one sentence per beat.
8. **5.8 / 6, rendering:** render up to 3 chapters at once with an explicit `--workers 2` each, capped by `max(1, min(3, floor(free_RAM_GB - 2)))`; never rely on
   `--workers auto` on a low-memory machine (Hyperframes pins itself to 1 worker there); drop to one chapter at a
   time after a failure.
9. **11, dependencies and README:** list Python 3 plus 130 MB of packages, a 353 MB voice model, and the optional
   487 MB whisper model; warn that `hyperframes transcribe` calls `brew install whisper.cpp` on its own on macOS.
10. **9 and 13:** mark the seven spikes as answered, with a link to each result.

## Decisions the owner should make

- Are the optional whisper features (word-level captions) wanted in v1, given the Homebrew install they trigger?
- Is a paid fallback (spike 1) acceptable as an opt-in, or should v1 drop it and show "reconnect Claude" only?
- Distribution: plugin route only (hooks work), or also `npx skills add` (no hooks, so a first-use doctor)?

## Things done during Phase 0 that the owner should know

- Hyperframes ran `brew install whisper.cpp` on the owner's machine during spike 3. It was not requested. New
  formulae: `whisper.cpp`, `llama.cpp`, `ggml`, `libomp`. Upgraded: `openssl@3`, `sdl3`, `sdl2-compat`,
  `ca-certificates`. The new ones can be removed with `brew uninstall whisper.cpp llama.cpp ggml libomp`
  (check `brew uses --installed <name>` first); the upgrades cannot be cleanly undone and are harmless.
- Spike 1 resumed (as a fork) one of the owner's real sessions to measure cost. The fork copy and all other
  temporary test sessions and a test plugin data folder were **deleted at the end of Phase 0**; the evidence
  that matters is copied into `spikes/01-resume/evidence/` and `spikes/05-install-hook/evidence/`.
- The cache folder `~/.cache/hyperframes` is now about 1.0 GB (Kokoro 353 MB, whisper 487 MB, Chrome and fonts).
- `claude -p` headless calls (spike 1) cost about 3 USD in total.
- A first write-up of spike 2 had a measurement error; it was corrected the same day (see that document).
