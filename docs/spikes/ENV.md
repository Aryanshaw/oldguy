# Spike environment (2026-10-02)

| Item | Value |
|---|---|
| Machine | Apple M3, 8 cores, **8 GB RAM** (about 1.2 GB available at the start of Phase 0), macOS 26.2 |
| Disk | about 4.4 GB free (tight: model downloads in spikes 3 and 4 matter) |
| Node | v26.7.0 |
| Claude Code | 2.1.287 |
| Hyperframes | 0.8.112 (latest) |
| Chrome | Hyperframes' own cached `chrome-headless-shell` 151 (already installed) |
| Docker | installed, not running |
| whisper-cpp | **not installed** (needed by `hyperframes transcribe`) |
| Kokoro TTS | **not installed** (installs on first use) |
| ffmpeg | Homebrew's `/opt/homebrew/bin/ffmpeg` is **broken**: it links `libx265.216.dylib`, the installed x265 ships a different version |

## ffmpeg route used

Homebrew was **not** touched (no `brew reinstall`): static `ffmpeg-static` (ffmpeg 6.0) and
`ffprobe-static` were copied into `spikes/.tools/` (git-ignored). `source spikes/env.sh` sets
`HYPERFRAMES_FFMPEG_PATH`, `HYPERFRAMES_FFPROBE_PATH`, `FFMPEG` and `FFPROBE`. Every spike
runs with that file sourced.

## What this machine means for the results

The test laptop is a low-memory one (8 GB). Memory results here are close to a worst
reasonable case for a developer laptop. A 16 GB or 32 GB machine will do better.
