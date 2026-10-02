# Spike 4: Kokoro narration is free, local and keyless

## Question
Does `hyperframes tts` work with no API key, after a one-time download, and then fully offline?

## Method
`spikes/04-kokoro-local/`. First run with a stripped environment
(`env -i HOME PATH HYPERFRAMES_PYTHON=...`, so no API key variables can leak in). Then a second run
inside `sandbox-exec -p '(version 1)(allow default)(deny network*)'`, which makes any network call
fail. `hyperframes tts --list` for voices.

## Machine
Apple M3, 8 GB, memory-starved (see `ENV.md`). Python 3.14 is the system Python; the venv used
Python 3.12 (see below).

## Result
**PARTIAL.** Free, keyless and offline-capable: **PASS**. "Nothing extra to install": **FAIL**. It needs
a Python package set and a 353 MB one-time model download.

## Evidence
- **First attempt, no Python packages:** `{"ok":false,"error":"The kokoro-onnx package is not installed.
  Run: pip install kokoro-onnx soundfile (or point HYPERFRAMES_PYTHON at a venv python that has them)"}`.
  `hyperframes doctor` marks "TTS (Kokoro)" as "Not installed (optional)", which understates this.
- **Install:** `uv venv --python 3.12` then `uv pip install kokoro-onnx soundfile`: **27 s, 127 MB** venv
  (onnxruntime, espeak data, numpy and others). Run with `HYPERFRAMES_PYTHON=<venv>/bin/python`.
- **First tts run (clean env, no keys):** exit 0, **342 s** including the download of
  `kokoro-v1.0.onnx` (326 MB) and `voices-v1.0.bin` (28 MB) into `~/.cache/hyperframes/tts/`
  (cache grew 345 MB). Output WAV and JSON (`durationSeconds` only; no word or sentence timing).
- **Second run with all network denied:** exit 0, valid WAV. **No network is needed after the download.**
  It took 75 s for a 2-second clip on this machine (model load plus memory pressure).
- **Voices:** 12 listed by the CLI (English: Heart, Nova, Sky, Adam, Michael, Emma, Isabella, George;
  plus Spanish, French, Japanese, Chinese), 54 in total per the Kokoro project. Default `af_heart`.
- **No API key** variable was present in the environment for either run.

## Consequence
- Spec section 11 / README: the claim "narration is free and local" stays. Add the real cost:
  **Python 3 plus `pip install kokoro-onnx soundfile` (about 130 MB) and a one-time 353 MB model
  download.** Both are free.
- Spec section 5.1 (doctor): add checks for a usable Python (3.10 to 3.12 known good; the system
  3.14 was not tried) and for the two packages, and set `HYPERFRAMES_PYTHON` to a venv Yap creates
  under its own folder, so the user's Python is never modified. The doctor should offer to create it.
- Spec section 5.6: warn that narration generation is slow on a low-memory machine; run it once per
  chapter, and cache the WAV by a hash of the text so an edited chapter does not redo untouched ones.
- Disk: the first video needs at least about 0.5 GB free for Kokoro, plus space for renders.
