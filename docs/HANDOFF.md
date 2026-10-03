> **Internal working note. Not for publication.** Remove or rewrite this file before the repository is ever made public (it records private working context).

# Yap — handoff (continue the discussion in `~/Documents/pracice/yap`)

Updated 2026-10-03. Read this first, then the spec and `docs/phase-1/SUMMARY.md`.

## 0. Where we are

- Repo: `~/Documents/pracice/yap`. Branches (nothing pushed or merged, owner approval needed):
  `master` (spec only) <- `phase-0-spikes` (~17 commits) <- `phase-1-generator` (~60 commits,
  now also holds the Phase 2 plan, commit `c254f21`).
- Spec: `docs/superpowers/specs/2026-10-02-yap-design.md`, approved, amended with Phase 0 results.
  **Do not re-derive it; read it.**
- **Phase 0 (spikes) done.** Evidence in `docs/spikes/` (SUMMARY.md, ENV.md). Key facts: parallel
  renders beat sequential (0.37-0.40x), chapter gap handled, local Kokoro TTS needs no key,
  `hyperframes transcribe` silently runs `brew install whisper.cpp` (installer must ask consent).
- **Phase 1 (generator) done.** Plugin skeleton, `bin/yap.cjs` (doctor, audit, beats, captions,
  pad-wav, scaffold, render, narrate), `lib/`, `scene-kit/`, hooks, `skills/yap`, 304 tests
  (`npm test`), real runs (positive: first playable chapter in ~145 s; negative request creates
  nothing). Roll-up: `docs/phase-1/SUMMARY.md` (folder contract in 1.3, Phase 2 hand-over in 7).
- **Phase 2 (manifest + local server): plan written, not started.**
  `docs/superpowers/plans/2026-10-03-phase-2-manifest-server.md` (Tasks 0-12, 7 Review Focus
  risks). Waiting on the owner for: (1) approval of spec amendments A1-A9
  (`docs/phase-1/SUMMARY.md` section 6; Task 0 is blocked until then), (2) execution method
  (recommended: subagent-driven, one whole-branch review at the end). Branch `phase-2-server`
  is created from `phase-1-generator` at execution time.
- Later: Phase 3 player (React+Vite prebuilt), Phase 4 chat bridge (Monitor), Polish (README,
  demo video, `npx yap-setup` installer with consent checklist).
- Name: **Yap** ("Claude yaps. You watch."). Domain `justyap.dev` or `justyap.io` (owner buys;
  not yet bought).

## 1. Discovery: how the idea started (the problem statement)

1. The owner (solo dev of "vindex", a legal-tech app) had Claude run a large refactor
   ("Part C: job planner") with subagents. Afterwards the owner wanted to *understand* the
   new job flow and asked for it explained as a diagram, then asked for a **video** made
   with Hyperframes.
2. A subagent produced a 3:10, 1080p, silent, captioned explainer
   (`~/Desktop/job-flow-explainer.mp4`). The owner called it "outstanding".
3. The owner then asked how it was built, and realised it could be a product: **anyone new
   to a codebase, or who finds something hard to understand, asks Claude and gets a video
   explaining it.** Like the `brag` plugin, but for understanding, not launching.
4. Problem statement (owner's words, paraphrased): people (esp. with ADHD) will not read
   long plan/spec files, but they will watch a video. The video is a **review surface**
   for work Claude already planned. It does **not** replace the written plan (the verified
   script stays the source of truth).
5. Business shape: published separately on GitHub, runs fully on the user's machine with the
   user's own Claude tokens, no infrastructure. Tied to Claude Code on purpose ("half the
   population uses it").

## 2. How the prototype video was made (evidence for the design)

Source: the subagent's transcript (84 tool calls, 44.1 min, ~290k tokens). Steps:
load skill `hyperframes` → `general-video` → `hyperframes-core`; read the owner-supplied
flow notes as the script; **verify facts against real code** (grep, JobSpec fields, etc.);
scaffold a Hyperframes project; write `BRIEF.md` + `STORYBOARD.md` (7 scenes); write
`index.html`, `shared.css`, one HTML/SVG/GSAP file per scene (`src/s1…s7`) assembled by
`build.mjs` into sub-compositions; loop *build → lint → snapshot scene → read contact-sheet
image → fix*; gates (`hyperframes check`, animation-map audit, coverage snapshots); render
MP4; hit a broken Homebrew ffmpeg → diagnosed, used static ffmpeg via env override; found
overlapping packets in frames of the *final* MP4 → fixed → re-rendered.
Tools used: Bash, Write, Read (also reads images), Skill, ToolSearch only. No paid
generators, no voiceover.

Measured time split (from transcript timestamps): setup/research 5.5 min; scenes 1–4
12.8 min (inventing helpers); scenes 5–7 3.4 min (helpers existed → ~1 min/scene = the case
for a **scene kit**); gates 2.9; first render + ffmpeg fix 11.3; fix + second render 8.2.
About 19 min was rendering (two full 1080p renders ≈ 6–8 min each, ~14 min of pure waiting).
Lessons that shaped the spec: reusable scene kit; dense snapshots around moving parts (the
overlap was only caught after a full render); draft-first rendering; per-chapter parallel
renders; a doctor check for ffmpeg/Chrome/TTS.

Prototype project: a temporary session folder (may be gone). Copy its `src/` into the repo as the scene-kit seed if it still exists.

## 3. How the design evolved (decisions + why; the spec has the result)

| Topic | Decision | Why / what was rejected |
|---|---|---|
| Audience/positioning | Review surface for plans/features; not a plan replacement | Owner agreed: "Claude still does the planning, the human just watches". The verified `script.md` stays canonical |
| Generation scope | v1 = generator + chapter format + localhost player + export (parts 1–4) | Podcast/reel formats, characters, voice cloning → v2 (owner: "not important for v1") |
| Interaction | Browser player with timeline and chat; chat reaches Claude without the terminal | Owner's idea, modelled on superpowers' visual companion |
| Bridge | Claude Code **Monitor** tailing `events.jsonl` in the live session; fallback `claude -p --resume <session>` if no session | The companion is pull-based (Claude reads events only on its next turn); Monitor gives push. Fallback idea is the owner's; unverified (spike 1) |
| Chapters | One MP4 per chapter + `manifest.json`; order = array order; stable ids; chapters stand alone (no "next/last" references) | Owner: "adding a scene = appending a section, no full re-render". Rejected: one long timeline with cached re-render |
| Chapter placement | Claude decides: follow-up goes next to its parent, independent goes at end | Owner's decision; manifest-only change |
| Manifest writer | Only the server writes it (atomic); Claude uses `bin/yap.cjs` | Avoids races; one permission-approved command instead of many curls |
| Player tech | React + Vite, built once, `dist/` committed | Owner pointed out users never build; I had wrongly objected to a build step |
| Player layout | Option B: big video, YouTube-style segmented timeline with chapter titles + thumbnails, side panel with tabs Chat / Sources; pending chapter = yellow ⏳ segment | Owner chose B; chapters live on the timeline, not in the panel |
| Browsers | Watch in any default browser; render with Hyperframes' pinned Chrome (`hyperframes browser ensure`) | Owner OK with Chrome; pin avoids pixel drift |
| Doctor | Checks node, `hyperframes doctor --json .ok`, browser, a working ffmpeg, Kokoro voice; run at install if a hook allows | The broken-ffmpeg failure we met |
| Audio | Normal synthetic narration (Kokoro via `hyperframes tts`, as `brag --voice` does); captions always on | Voice cloning not needed |
| Characters | User-chosen characters are v2 | Owner: no trademark worry; I noted non-commercial use does not remove likeness/trademark issues, and advised against copying Disney's **Miss Minutes** (name or look) — keep only the retro/cheery vibe |
| House style | Retro yellow + orange + black, cheery polite tone, original mascot | Inspired by Miss Minutes' vibe, not her design |

### Name journey (so you don't redo it)
Rejected with evidence (GitHub/npm checks on 2026-10-02): `walkthrough` (too plain),
`Maker` (generic, many repos), `lore` (Epic Games' Lore VCS 8.8k★), `tldw` (video
summarizers, opposite meaning), `eli5` (existing Claude skill, 1.6k★), `loremaster`
(owner: too long), `lorecast` (clean but not chosen), `canon` (great meaning — verified
claim = canon — but Canon Inc. owns imaging/video space), `lorecroft`/`lore craft`
(double-O spelling friction), `minutely` ("too generic"), `chronie` (collides with `cronie`
cron daemon), `cuckoo`, `flipclock`, `windup`, `betamax`. **Chosen: Yap** (Gen Z word for
talking a lot). Collisions are in unrelated spaces (`yapi` API tool 27k★, `yapf` formatter
14k★); npm `yap` is taken but irrelevant for a GitHub-distributed plugin. Owner also liked
`lowkey` as the alternative. Canon vocabulary ("canon check" for the claim audit,
"canon" for verified claims) was proposed as optional product language — not in the spec.

## 4. Open items

- Owner: approve A1-A9, choose execution method, then Phase 2 starts.
- Owner: approve merge/push of `phase-0-spikes` and `phase-1-generator` (not done).
- Owner: buy domain; pick installer name (placeholder `yap-setup`).
- Remove this file before the repo is ever public.
- Not proven yet: marketplace install (only `--plugin-dir` tested), 16 GB machine, interactive
  sessions, human listening/audio-sync check, `CLAUDE_PLUGIN_DATA` on a real install.
- Known debt: kept example folders have v1 `build.json` (render refuses; re-narrate if used as
  fixtures), parked I4 (titles/steps/callouts/framing text not audited), ~45 deferred minors in
  `.superpowers/sdd/2026-10-03-phase-1-generator/` (git-ignored ledger).
- Owner rules: show no cost/price/token talk anywhere in Yap; spec amendments need approval;
  plain-words comments above every function and step; no runtime deps in `bin/`, `lib/`, `server/`.
- Ideas not in spec: stale-code warning (v2), drag reorder (v2), speaking mascot (v2),
  podcast/reel format (v2).

## 5. Environment facts

- Hyperframes skills live in `~/.claude/skills/hyperframes*` (cli, core, animation,
  creative, registry, studio, keyframes, audio) and `media-use`. CLI: `render --quality
  draft|looks|delivery`, `--workers`, `doctor --json`, `browser ensure`, `tts`.
- Reference plugin for packaging/README/examples/docs site: `~/.claude/plugins/cache/brag/brag/0.2.2`
  (`skills/`, `scripts/`, `docs/`, `examples/`, `PRODUCT.md`); narration there uses Kokoro.
- Reference for the localhost companion: `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/brainstorming/{visual-companion.md,scripts/server.cjs}`
  (zero-dependency server, session key in URL + cookie, `state_dir/events`).
- `/opt/homebrew/bin/ffmpeg` is broken on the owner's Mac (links `libx265.216`, installed is
  `.217`); `brew reinstall ffmpeg` should fix it. Hyperframes honours
  `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH`.
- A fresh repo needs: Node, ffmpeg, Hyperframes via `npx`.

## 6. Working with this owner (preferences observed)

- One question per message, with a recommendation; plain words; explain from fundamentals;
  no jargon walls (their codebase rules ask for 15-year-old-level explanations).
- Wants real evidence: check names/availability/claims before asserting (I ran GitHub/npm
  searches and a Hostinger availability check, read-only).
- Pushes back and is often right (React prebuilt dist; fallback to `claude -p`); concede
  with a reason when so.
- Brainstorming skill rules apply: no implementation before spec approval + plan.
- A caveman-style terse mode and a TL;DR-first style were active in the previous session;
  match whatever the new repo's instructions say.

## 7. Suggested skills for the next session

- Next: `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) on the
  Phase 2 plan once the owner approves; `superpowers:test-driven-development`.
- Build-time: `plugin-dev:create-plugin`, `plugin-dev:plugin-structure`,
  `plugin-dev:skill-development`, `plugin-dev:hook-development` (install-time doctor),
  `write-a-skill`.
- Video engine: `hyperframes` (entry), `hyperframes-cli`, `hyperframes-core`,
  `hyperframes-animation`, `hyperframes-creative`, `general-video`, `media-use` (TTS).
- Player UI: `frontend-design:frontend-design`, `ui-ux-pro-max:ui-ux-pro-max`, `design-taste-frontend`.
- Reference/inspiration: `brag:brag` (read its SKILL.md and README for plugin shape).
- Hygiene: `ponytail:ponytail-review` on the scene kit/server when built; `discuss` for open-ended
  brainstorming.
