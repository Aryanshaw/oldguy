# Spike 3: can scene timing follow the narration?

## Question
Can we get reliable word- or sentence-level timing from the narration audio so scene beats line up
with the voice?

## Method
`spikes/03-narration-timing/`. A 3-sentence, 31-word narration was spoken by `hyperframes tts`
(Kokoro, af_heart voice). True duration measured with ffprobe. Then `hyperframes transcribe
narration.wav --json` (word-level timestamps), compared against the true duration and against a
no-dependency fallback: split the text into sentences and share the true duration in proportion to
character counts.

## Machine
Apple M3, 8 GB, memory-starved (see `ENV.md`).

## Result
**PARTIAL.** Accurate word timing is available, but only through a heavy, system-modifying dependency.
A zero-dependency fallback is accurate enough for chapter beats.

## Evidence
- `tts` output: `durationSeconds` 9.301 (ffprobe: 9.3013 s). **No timing data** beyond the total.
- `transcribe` (engine `whisper`, model `small.en`): 31 words, each with `start`/`end` seconds
  (`{"text":"job","start":0.07,"end":0.28}`), exit 0.
  - **Accuracy:** last word ends at 9.42 s against the true 9.30 s: error **0.12 s** (limit 0.3 s).
  - **Sentence ends:** whisper 2.30 / 6.92 / 9.42 s.
  - **First run took 253 s** (it downloaded the 487 MB `ggml-small.en.bin` model); **a repeat takes 2 s.**
- **Side effect to know about:** the first `transcribe` found no `whisper-cli`, and Hyperframes
  **ran `brew install whisper.cpp` on its own**, without asking. Cellar timestamps show what changed on the
  owner's Homebrew at 22:38 to 22:39 local time: **newly installed** `whisper.cpp` 1.9.4, `llama.cpp` 0.5.0,
  `ggml` 0.25.3 and `libomp` 23.1.2; **upgraded** (a newer version added beside the old one) `openssl@3`
  (now 3.6.5), `sdl3` (3.4.16), `sdl2-compat` (2.32.72) and `ca-certificates` (2026-09-25). `hyperframes doctor`
  still reported "whisper-cpp: Not found" afterwards (it checks a different name). This modified the owner's
  machine during Phase 0 and was not planned; Yap must never trigger it silently.
- **Fallback (no dependency):** sentence ends at 2.22 / 6.60 / 9.30 s (character-proportional). Errors against
  whisper: 0.08 s, 0.32 s, 0.12 s. Worst case 0.32 s on three sentences.
- Not done: spot-checking three words by ear (no audio output in this session). The whisper timings
  agree with the true duration to 0.12 s, which is the evidence used.

## Consequence
- Spec section 5.5 and 5.6: the **default** timing source is the fallback: take the exact duration from
  the generated WAV and place beats at sentence boundaries by character share (error about 0.3 s).
  No extra dependency, nothing installed.
- **Word-level timing is an opt-in upgrade** ("karaoke captions"): `hyperframes transcribe`, only after
  the user agrees to install `whisper.cpp` (about 5 packages through Homebrew on macOS) and a 487 MB
  model. The doctor offers it; the skill never installs it silently.
- Spec section 5.1 (doctor): add a check "whisper-cli present" (not "whisper-cpp") as optional, and
  state the Homebrew side effect in the README.
- Narration scripts should be written one sentence per beat so sentence-level timing is enough.
- Note for `hyperframes tts` callers: the JSON has `durationSeconds` per call, so synthesize
  **one WAV per sentence** if exact per-sentence timing is wanted without any ASR (costs one call per sentence).
