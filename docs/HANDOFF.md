# Yap — handoff (continue the discussion in `~/Documents/pracice/yap`)

Written 2026-10-02. Read this first, then the spec. Nothing here is code: the repo holds
only a design spec so far.

## 0. Where we are

- Repo: `~/Documents/pracice/yap` (git, branch `master`, 3 commits, only the spec file).
- Spec: `docs/superpowers/specs/2026-10-02-yap-design.md` (336+ lines). It already records
  the architecture, manifest/event formats, server API, player layout, generation
  workflow, failure handling, security, testing, 7 spikes, repo layout, v1 non-goals.
  **Do not re-derive it; read it.**
- Process state (superpowers:brainstorming, *architectural* path): design sections 1–4
  were presented and approved in conversation; the spec was written and committed.
  **The next gate is the owner reviewing the written spec.** Only after approval: invoke
  `superpowers:writing-plans`, then the owner picks an execution method. No code before
  that (hard gate).
- Name: **Yap** ("Claude yaps. You watch."). Domain: `justyap.com` and every `yap.*` are
  taken; `justyap.dev` and `justyap.io` were available on 2026-10-02 (owner buys; not yet
  bought).

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

Prototype project (temporary scratchpad, may be gone — copy `src/` into the repo as scene-kit
seed if still there): `/private/tmp/claude-501/-Users-aryanshaw-Documents-pracice-worktrees-vindex-app/6493f579-010d-4b28-9f8a-8e37e98d4602/scratchpad/job-flow-video/`
(scene sources in `src/`, QC frames in `../qc/`, static ffmpeg in `../tools/`). The flow
notes it was written from: `…/scratchpad/job-flow-notes.md`.

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

- Owner reviews the spec (the gate). Then `writing-plans`.
- The 7 spikes in spec §9 (session id + `claude -p --resume`; parallel chapter renders;
  scene timing vs Kokoro; Kokoro free/local with no key; plugin install hook for doctor;
  gap between chapter MP4s; Monitor long-idle behaviour). Each should be answered cheaply
  before the plan depends on it.
- Buy `justyap.dev` or `justyap.io` (owner action). Hostinger MCP is available for DNS/hosting
  if wanted; domain purchase needs explicit owner approval.
- Optional ideas raised, not in spec: "canon" vocabulary; stale-code warning (v2); drag
  reorder (v2); speaking mascot host (v2); podcast/reel format with user-chosen characters (v2).

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

## 7. Loose ends from the same session (not Yap; FYI only)

- vindex repo (`~/Documents/pracice/worktrees/vindex-app`, branch `feat/oio-appeal`): Part C
  job-planner refactor is committed; ledger `.superpowers/sdd/2026-10-01-refactor-C-job-planner/progress.md`;
  open owner decisions there: parked finding I2, remaining ponytail cuts, a row-for-row
  e2e vs `main`. A dev stack (API :8000, arq worker, Next :3000) started from that repo
  against the prod DB was still running when this was written — ask before leaving it up.
- Owner was asked to add two lines to `.claude/settings.local.json` (allow `Bash(uv --directory api run *)`,
  `Bash(pnpm *)` and an autoMode note); they said they updated it.

## 8. Suggested skills for the next session

- `superpowers:brainstorming` — resume at the **spec review gate**; then hand off to
  `superpowers:writing-plans` (the only allowed next skill after approval).
- `superpowers:writing-plans` → `superpowers:subagent-driven-development` (or
  `superpowers:executing-plans`) for execution; `superpowers:test-driven-development`.
- Build-time: `plugin-dev:create-plugin`, `plugin-dev:plugin-structure`,
  `plugin-dev:skill-development`, `plugin-dev:hook-development` (install-time doctor),
  `write-a-skill`.
- Video engine: `hyperframes` (entry), `hyperframes-cli`, `hyperframes-core`,
  `hyperframes-animation`, `hyperframes-creative`, `general-video`, `media-use` (TTS).
- Player UI: `frontend-design:frontend-design`, `ui-ux-pro-max:ui-ux-pro-max`, `design-taste-frontend`.
- Reference/inspiration: `brag:brag` (read its SKILL.md and README for plugin shape).
- Hygiene: `ponytail:ponytail-review` on the scene kit/server when built; `discuss` for open-ended
  brainstorming.
