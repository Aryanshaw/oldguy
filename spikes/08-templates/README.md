# Spike 08: one chapter in a template (peter-and-stewie, stand-in art)

Question: does the video-templates design (`docs/superpowers/specs/2026-10-07-video-templates-design.md`) hold up on
the real pipeline: per-speaker voices, estimated word timing, a 9:16 stage with speaker swaps, one-word captions and a
slot, rendered by the pinned Hyperframes, with the fact-check unchanged?

Run: `node build.mjs <python of a venv with kokoro-onnx and soundfile>`, then in `out/wrong-lines/`:
`npx --yes hyperframes@0.8.112 check .` and `npx --yes hyperframes@0.8.112 render . -q draft -w 2 -o chapter.mp4`.
`out/` is git-ignored. The art is stand-in SVG; the background is CSS blocks, not gameplay footage.

Inputs: `template/template.json` (the spec's shape, 9:16 only) and `chapter.json` (8 lines, Stewie and Peter, about
how `yap reply` refuses a wrong line; Peter's 4 lines are claims citing `cli/client.mts:141`, `:142` and
`lib/audit.mts:97`).

## Results (2026-10-07, cloud container, 16 GB)

| Check | Result |
|---|---|
| `yap audit` on lines with a `speaker` field | passes unchanged; the same file with a wrong line (99) or a claim without sources fails (exit 1) |
| Two Kokoro voices (`bm_george` 1.15x, `am_adam` 1.1x), joined with 120 ms gaps | 8 lines, 22.4 s |
| `hyperframes check` on the 1080x1920 stage | passed after fixing one real overlap it found; 21/21 text contrast checks pass |
| `hyperframes render`, draft | 1080x1920 H.264 + AAC, 22.4 s, rendered in 28.6 s |
| Frames at 1.2, 5.5, 10.6, 16.2, 20.6 s against `timing.json` | the caption word, the speaker, the slot prop and the source chip all match the timing at every sample |

## Findings for the spec

1. **Narrate must load the voice model once per chapter, not once per line.** Each `hyperframes tts` call reloads
   Kokoro: about 10 s per line, 87 s for 8 lines. A 10-chapter podcast (~80 lines) would spend ~13 minutes on
   voices alone. Narrate should speak all of a chapter's lines in one Python process (the venv already has
   `kokoro_onnx`), per voice and speed.
2. **`max_words_per_line` is worth enforcing.** Stewie's first line came out at 13 words against the template's 12;
   nothing stopped it. The planned audit check would.
3. **Text over busy backgrounds needs a backing plate.** The source chip is hard to read where it crosses the moving
   blocks and Peter's cap. Stages should put captions and chips on a plate or keep a clear band for them.
4. **Keyword props can arrive late.** A prop keyed to the last word of a line (`check`, `never`) is on screen only
   briefly. `visual_beat: "keyword"` should fall back to the line start when the keyword is in the last third.
5. **Estimated word timing is unverified.** Captions follow the estimate, but without whisper there is nothing to
   compare it with; the first real run with whisper should measure the drift.
