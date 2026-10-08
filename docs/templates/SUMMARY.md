# Video templates, Phase A: the engine

Built 2026-10-08 on branch `claude/sweet-cori-go32dh`. Design: `docs/superpowers/specs/2026-10-07-video-templates-design.md`;
plan: `docs/superpowers/plans/2026-10-07-video-templates.md`; parent spec amendments A25 to A29.

## What exists

A template is a folder `templates/<id>/`; the engine does all timing, so a new template is data and layout only.

| Layer | Files | What it does |
|---|---|---|
| Model | `lib/template.mts`, `lib/voices.mts` | loads and checks `template.json` (every problem at once): speakers, voices, pace, shapes, slot boxes, assets |
| Choice | `lib/settings.mts` | project default (`.oldguy/settings.json`), request override, the video's own `video.json` |
| Rules | `lib/template-checks.mts` | added checks only: speakers, words per line, keyword anchors; used by scaffold, audit, narrate, render |
| Voice | `lib/speak.py`, `lib/voice.mts`, `lib/wav.mts` | one Kokoro process per chapter, per-speaker voice and speed, lines joined with the template's gap |
| Timing | `lib/word-times.mts` | the timing record (lines, speakers, words), word estimates, keyword anchors |
| Stage | `lib/stage.mts`, `lib/pieces.mts` | builds `index.html` from `stage.html` markers: background loop, scaled slot, speakers, captions, chips |
| Assets | `lib/assets.mts`, `lib/build-record.mts` | download on first use with consent, size and sha256; assets fingerprinted in `build.json` |
| Commands | `cli/templates.mts`, `cli/remake.mts` | `oldguy templates`, `oldguy video`, `oldguy remake` |
| Server | `server/api.mts`, `server/server.mts` | `remake` events, `GET /api/templates`, the manifest records the template |
| Player | `player/src/components/{Header,VideoStage,RemakeMenu}.tsx` | label, 9:16 and 1:1 stages, Remake as… |
| Skills | `skills/templates/`, `skills/oldguy/references/templates.md`, `.claude/skills/new-template/` | users, the main skill, contributors |

Shipped template: `explainer` only (today's look). `tests/fixtures/templates/duo/` is a two-speaker test template.

## Measured

| Check | Result |
|---|---|
| Golden test: three chapter pages snapshotted before the change | byte for byte the same through the stage driver |
| An existing explainer chapter re-narrated with the new code | `index.html` identical; every file fingerprint identical (only the commit moved) |
| Old rendered chapters, render `--dry-run` with the new code | `would skip (already rendered)` |
| New 2-chapter explainer video at 9:16 | rendered 1080x1920; check passed; the 16:9 scene sits scaled in the middle |
| Speaker chapter (duo, 8 lines, 9:16), whole pipeline | scaffold, audit, narrate 10.2 s, render ready, 1080x1920 21 s; frames match `beats.json` (speaker, word caption, chip, keyword prop, background) |
| One Kokoro process vs one tts call per line (spike's 8 lines) | 9.7 s warm (49 s cold first read of the model) against 87 s |
| Tests | 784 node tests (6 skipped: network or platform), 235 player tests, typecheck, build, check:dist |

## Not done or not verified

- Templates B to D (`real-life-analogy`, `tutor`, `peter-and-stewie`): their folders, art and footage; `peter-and-stewie`
  needs the owner's character art and gameplay footage.
- A remake run end to end through the page with the live listen loop (the pieces are unit- and server-tested).
- `/oldguy:templates` in a real Claude Code session.
- Word-timing drift against whisper (spike finding 5): no whisper in the container.
- Tall templates: explainer's scenes are drawn for 16:9 and only scaled into a tall frame, so text gets small; a real
  tall template should give its slot a layout that fits (or pieces may later learn shapes).
- Playback in a real browser (H.264), carried over from `docs/STATUS.md`.
