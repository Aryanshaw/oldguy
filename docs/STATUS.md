# oldguy status

Where the project stands, what is still open, and what is deliberately left for later. Updated 2026-10-07.

Renamed from Yap to oldguy on 2026-10-07; older docs use the old name. See
`docs/superpowers/specs/2026-10-07-oldguy-rename-design.md`.

## Built

| Phase | What it gave | Read |
|---|---|---|
| 0. Spikes | Answers to the risky questions: parallel renders, the gap between chapters, local voice, install hooks | `docs/spikes/SUMMARY.md` |
| 1. Generator | One fact-checked, narrated, rendered chapter from a question about the code | `docs/phase-1/SUMMARY.md` |
| 2. Chapters and server | Several chapters in a manifest, served locally with an API and a live stream | `docs/phase-2/SUMMARY.md` |
| 3. Player | The browser player: video, timeline, captions, Chat and Sources tabs, export | `docs/phase-3/SUMMARY.md` |
| 4. Chat bridge | Questions typed in the page reach the live Claude Code session; answers and new chapters come back | `docs/phase-4/SUMMARY.md` |
| Polish | `oldguy setup` (installs only what the user agrees to), install from the plugin marketplace, README, MIT license, the old guy mascot (traced from the concept art) | this file, `README.md` |

The design and every amendment: `docs/superpowers/specs/2026-10-02-yap-design.md`. Code layout and rules:
`docs/ARCHITECTURE.md`.

## Open

Checks nobody has done yet:

- **Real Chrome and Safari playing the videos.** The test browser in the cloud container has no H.264 decoder,
  so playback was tested there with a VP9 copy only.
- **The pause between chapters.** Measured at about 120 ms against the design's 20 to 35 ms. Someone has to
  watch real chapters on a real screen and say whether it is visible (`docs/phase-3/SUMMARY.md` section 5.1).
- **Listening.** Nobody has listened end to end for audio dropouts at a chapter join or narration out of sync.
- **A 16 GB machine.** Renders were measured on 8 GB only.
- **An install on a fresh personal machine.** The npm installer (installing the plugin from GitHub) was tested
  under its old installer, `getyap`, in a cloud container with an empty Claude Code config; not yet on a real macOS
  laptop, and not yet as `npx oldguy`.
- **Phase 4 paths covered only by unit tests:** re-arming `oldguy listen` after the Monitor's 30-minute limit, and
  finding the Claude Code process on macOS.

Work to do:

- **Browser test in CI.** `player/e2e` exists but CI does not run it; a job with real Chrome would also check
  H.264 playback.
- **Demo video.** A video made by oldguy about oldguy. Postponed by the owner.
- **Fact-check coverage.** The audit checks narration and code against the repository; titles, steps, callouts and
  framing text on screen are not checked yet.
- **Deferred minor findings.** Each phase summary lists the small findings left on purpose; none blocks use.
- **Publish the rename.** These are owner steps, after this branch merges:
  - rename the GitHub repo to `Aryanshaw/oldguy`
  - publish `packages/oldguy` to npm as `oldguy` (`cd packages/oldguy && npm publish`, which needs npm two-factor
    authentication)
  - run `npm deprecate getyap "renamed: use npx oldguy"`

  The old installer, `getyap` 0.1.0, was checked from npm on an empty Claude Code config.
- **Domain.** None yet; the homepage fields point at the GitHub repo.
- **Releases.** Claude Code offers an update only when the version changes. To release, raise the same version in
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json` and `packages/oldguy/package.json`
  (`tests/versions.test.cjs` fails if they differ), merge, and publish oldguy again.

## Left for later on purpose (v2 or never)

Podcast or reel formats, named or speaking characters, voice cloning, agents other than Claude Code, hosting or
sharing videos, accounts, drag-to-reorder chapters, a warning when the code changed since a video was made, and
answering in the page while Claude Code is closed.

## House rules for contributors

- Nothing in oldguy talks about what making a video uses up or charges.
- Every function and step has a plain-words comment above it.
- `bin/`, `lib/` and `server/` have no runtime dependencies; `tests/code-rules.test.cjs` enforces the layers (`docs/ARCHITECTURE.md`).
- Changes to the design go into the spec as amendments.
