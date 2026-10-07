# oldguy: Rename Implementation Plan

> **For agentic workers:** work through this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Per the owner's standing preference, this plan gives **file lists, commands, test cases and logic sketches, not
> full implementations**. Most of the work is mechanical renaming. Write any new code in the plain, commented style
> of the existing code: a one- or two-line plain-words comment above every function and every non-obvious step.

**Goal:** Rename the product from Yap to oldguy everywhere a user or a contributor meets it, and replace the alarm
clock mascot with the old guy. Behaviour does not change.

**Spec:** `docs/superpowers/specs/2026-10-07-oldguy-rename-design.md`, approved by the owner on 2026-10-07. Its
Decisions table is the source of truth for every old → new name. When this plan and the spec disagree, the spec
wins; fix the plan.

**Tech stack:** unchanged. Node 22.18+ running `.mts` directly, `node:test` at the root, Vite, React, Tailwind and
Vitest in `player/`.

## Baseline (measured 2026-10-07 on `claude/dazzling-cannon-snmbp4` at `59774f7`)

| Check | Result |
|---|---|
| `npm test` (root: `tsc` check, then `tests/*.test.cjs`) | 694 tests, 689 pass, 0 fail |
| `cd player && npx vitest run` | 16 files, 227 tests pass |
| `cd player && npm run check:dist` | `player/dist matches a fresh build` |

A root `npm ci` is needed before `npm test` (otherwise: `TS2688: Cannot find type definition file for 'node'`).

## Global constraints

- **One branch:** `claude/dazzling-cannon-snmbp4`. Commit after each task. Stage files by explicit path, never with
  `git add -A`. Push only at the end of a task whose checks pass.
- **No compatibility layer.** There are no users, so do not add a `/yap` alias, a `.yap/` fallback, an `x-yap-key`
  fallback or a `getyap` shim. Old names are deleted, not aliased.
- **Behaviour is preserved.** After every task:
  - the root test count never drops below 694 and the fail count stays at 0
  - the player tests stay at 227 or more
  - `check:dist` passes

  Test counts only go up, from the new guard in Task 1.
- **Renames use `git mv`** so history follows the files.
- **Lockfiles** are regenerated with `npm install` (root, and `packages/oldguy` if it has one), never edited by
  hand.
- **Historical docs are not edited.** Leave these untouched:
  - `docs/phase-*/`
  - `docs/superpowers/plans/` (except this file)
  - `docs/superpowers/specs/` (except the rename spec)
  - `docs/spikes/`
  - `spikes/`
  - `docs/phase-3/mockups/`
  - `.claude/skills/`
- **Copy rules from the spec:**
  - the product is always written `oldguy`, lowercase and one word, even at the start of a sentence
  - the headline is "Ask the old guy."
  - "Claude yaps. You watch." is kept as the subline, and is the only place the word "yap" survives in shipped
    files
- **Commits** end with the session's attribution lines (`Co-Authored-By:` and `Claude-Session:`).

## Review focus

These are conditions a happy-path run won't exercise, most likely first. Each one is pinned by the task that owns
it.

1. **Finding the running server by its command line.** `tests/acceptance-check.cjs` and `lib`/`cli` code match the
   server process with patterns like `pgrep -f "yap.cjs serve --dir …"`. After the launcher becomes
   `bin/oldguy.cjs`, every such pattern must change in the same commit, or the server is started twice or never
   stopped. *(Task 4)*
2. **The plugin data folder name.** Claude Code names a plugin's data folder after `plugin@marketplace` (today
   `…/plugins/data/yap-yap`). `packages/getyap/lib.cjs` builds this path itself, and `lib/data-dir.mts` trusts only
   folders under the data root. With `oldguy@oldguy` the folder becomes `oldguy-oldguy`, so the installer, the
   doctor's pass marker and the venv path must all agree on it. *(Tasks 5 and 6)*
3. **The session file.** The SessionStart hook writes `<project>/.yap/session.json`, and every command reads it
   back. The writer (hook) and every reader must switch to `.oldguy/` together, or commands lose the data folder and
   fall back to the wrong Python. *(Task 5)*
4. **The auth header.** `lib/ask-server.mts` sends `x-yap-key` and `lib/http-guard.mts` reads it. If only one side
   changes, every chat request from the player is rejected. *(Task 5)*
5. **Player build drift.** `player/dist` is committed and CI compares it with a fresh build. Any change under
   `player/src` or `player/index.html` needs `npm run build` and the new `dist/` committed in the same task.
   *(Tasks 7 and 8)*
6. **Version sync.** A root test checks that the plugin version equals the installer package version and reads
   `packages/getyap/package.json` by path. *(Task 6)*

## File map

| Old | New |
|---|---|
| `bin/yap.cjs`, `bin/yap.mts` | `bin/oldguy.cjs`, `bin/oldguy.mts` |
| `skills/yap/**` | `skills/oldguy/**` |
| `packages/getyap/**` | `packages/oldguy/**` |
| `tests/getyap.test.cjs` | `tests/oldguy-installer.test.cjs` |
| `docs/assets/mascot.svg`, `mascot-dark.svg` | same paths, new art |
| (new) | `docs/assets/oldguy-full.svg` |
| (new) | `tests/brand-name.test.cjs` |

---

### Task 1: Guard test for leftover names (written first, fails until Task 9)

Purpose: a test that fails while any shipped file still says "yap", so nothing is missed and nothing slips back in
later.

- [ ] Create `tests/brand-name.test.cjs`:
  - List tracked files with `git ls-files`.
  - Skip:
    - the historical paths from Global constraints, with the whole `docs/superpowers/plans/` folder (this plan
      included)
    - `docs/superpowers/specs/2026-10-07-oldguy-rename-design.md`
    - lockfiles
    - binary files: `.png`, `.webp`, `.mp4`, `.wav`, and `player/dist/**` assets except `index.html`
  - For each remaining file, find lines matching `/yap/i`, then drop lines matching
    `/Claude yaps\. You watch\./`.
  - Also flag any **path** (not only content) matching `/yap/i`, outside the skipped prefixes.
  - Fail with a list of `file:line: text`, so the output is a to-do list.
  - Mark it `{ todo: 'until the rename lands (Task 9)' }` so the suite stays green while the work is in progress.
- [ ] Run `node --test tests/brand-name.test.cjs`. Expect it to report as todo and list about 1,000 hits.
- [ ] Commit: `test: guard against the old product name`.

### Task 2: Plugin identity

- [ ] `.claude-plugin/plugin.json`:
  - `name: "oldguy"`
  - description that starts with "Ask the old guy." and keeps what it does
  - `homepage` and `repository` set to `https://github.com/Aryanshaw/oldguy`
- [ ] `.claude-plugin/marketplace.json`: marketplace `name: "oldguy"`, `metadata.description` set to
  "oldguy: Ask the old guy. Claude yaps. You watch.", `plugins[0].name: "oldguy"`.
- [ ] Update any test that reads these files (search `tests/` for `plugin.json` and `marketplace.json`).
- [ ] Check: `npm test` is green.
- [ ] Commit: `rename: plugin and marketplace are oldguy`.

### Task 3: Skill

- [ ] `git mv skills/yap skills/oldguy`.
- [ ] `skills/oldguy/SKILL.md`:
  - frontmatter `name: oldguy`
  - the description and body use `/oldguy`, `/oldguy doctor` and `oldguy <cmd>` for CLI calls
  - prose uses "oldguy" or "the old guy"
- [ ] In `skills/oldguy/references/*.md`, apply the same changes to:
  - every command and CLI call
  - every `.yap/` path
  - every `yk-*` class and `--yk-*` variable named in the visuals guide (these become `og-*`, see Task 7)
- [ ] `skills/oldguy/examples/journey.html`: the title, the visible text and any `yk-` classes.
- [ ] `tests/skill-lint.test.cjs`: point it at `skills/oldguy`, and update the expected skill name and the expected
  command strings.
- [ ] Check: `npm test` is green.
- [ ] Commit: `rename: skill is /oldguy`.

### Task 4: CLI launcher and command names

- [ ] `git mv bin/yap.cjs bin/oldguy.cjs` and `git mv bin/yap.mts bin/oldguy.mts`. Inside the launcher, the import
  path becomes `./oldguy.mts`.
- [ ] Root `package.json`: `name: "oldguy"`, `bin: { "oldguy": "bin/oldguy.cjs" }`, and the description. Then run
  `npm install` to regenerate `package-lock.json`.
- [ ] Every user-visible string in `bin/`, `cli/`, `lib/`, `server/` and `hooks/` that names the product or a
  command changes `yap <cmd>` to `oldguy <cmd>` and `/yap` to `/oldguy`. This covers usage, help, errors, log
  lines and hints. Find them with `git grep -n -i 'yap' -- bin cli lib server hooks scene-kit`.
- [ ] **Review focus 1.** Every spawn of the launcher and every process match changes in this same commit:
  - `git grep -n 'yap.cjs'` must return only historical docs
  - this includes `tests/acceptance-check.cjs`, `tests/phase2-acceptance.cjs` and any `pgrep`/`ps` pattern
- [ ] `lib/node-floor.cjs`: the product name in its one-sentence message.
- [ ] Rebuild the hook launchers if `hooks/*.cjs` are generated, or edit them directly if they are hand-written
  (check first).
- [ ] Tests: update `tests/cli.test.cjs`, `server-cli`, `client-cli`, `node-floor`, `doctor`, `setup`, `hook` and
  the rest for new paths and strings. Search with `git grep -n -i 'yap' -- tests`.
- [ ] Check: `npm test` is green, `node bin/oldguy.cjs --help` prints `oldguy` usage, and
  `node bin/oldguy.cjs doctor --json` runs.
- [ ] Commit: `rename: the command is oldguy`.

### Task 5: Runtime identifiers

All of these flip together in one commit (review focus 2, 3 and 4).

- [ ] **Project folder.** `.yap` → `.oldguy`:
  - hook writer: `hooks/session-start.mts`, `hooks/session-end.mts`
  - readers: `lib/data-dir.mts`, `lib/export.mts`, `cli/*`, `server/*`
  - `.gitignore`
  - Find them with `git grep -n "\.yap"`.
- [ ] **Auth header.** `x-yap-key` → `x-oldguy-key`, in `lib/ask-server.mts` (the sender), `lib/http-guard.mts`
  (the reader), and the player client if it sends the header (check `player/src`).
- [ ] **Env var.** `YAP_DEV_PORT` → `OLDGUY_DEV_PORT`, wherever it is read and documented.
- [ ] **Temp prefixes.** `yap-` → `oldguy-` in every `mkdtemp`, temp file name and `os.tmpdir()` join in `lib/` and
  `cli/`. Test fixtures that use `yap-` prefixes get renamed too, for consistency.
- [ ] **Scene markers.** In `scene-kit/design.mts` and in any skill reference or test that writes or parses them:
  `data-yap-timeline` → `data-oldguy-timeline`, and `yapBeats` → `oldguyBeats`.
- [ ] **Plugin data folder.** Wherever code or tests spell the folder `yap-yap`, it becomes `oldguy-oldguy`. Keep
  `lib/data-dir.mts`'s trust rule as is: it checks the root, not the name.
- [ ] Tests: `data-dir`, `http-guard`, `export`, `design`, `hook` and every server test. Update the fixture
  `tests/fixtures/hook-stdin-sample.txt` if it contains `.yap`.
- [ ] Check: `npm test` is green, and `git grep -n -E "x-yap|YAP_|\.yap\b|data-yap|yapBeats|yap-yap"` returns only
  historical docs.
- [ ] Commit: `rename: runtime identifiers use oldguy`.

### Task 6: npm installer package

- [ ] `git mv packages/getyap packages/oldguy`.
- [ ] `packages/oldguy/package.json`:
  - `name: "oldguy"`
  - `bin: { "oldguy": "index.cjs" }`
  - `homepage: "https://github.com/Aryanshaw/oldguy"`
  - repository url `…/Aryanshaw/oldguy.git` with `directory: "packages/oldguy"`
  - `bugs` URL
  - a description that starts with "Install oldguy into Claude Code"
- [ ] `packages/oldguy/lib.cjs`:
  - `MARKETPLACE = 'Aryanshaw/oldguy'` and `PLUGIN = 'oldguy@oldguy'`
  - the `marketplace update` argument becomes `'oldguy'`
  - the data folder name follows review focus 2
  - every message and the help text change
- [ ] Rewrite `packages/oldguy/README.md`: `npx oldguy`, the headline and the subline.
- [ ] `git mv tests/getyap.test.cjs tests/oldguy-installer.test.cjs` and update its requires and expectations. Fix
  the version-sync test so it reads `packages/oldguy/package.json` (review focus 6).
- [ ] Check: `npm test` is green, and `cd packages/oldguy && npm pack --dry-run` shows name `oldguy` with
  `index.cjs`, `lib.cjs` and `README.md`.
- [ ] Commit: `rename: npm installer is oldguy`.

### Task 7: Player (copy and tokens)

- [ ] **Tokens.** `yk` → `og` everywhere in `player/src`:
  - the Tailwind theme variables `--color-yk-*` → `--color-og-*`
  - the utility classes (`bg-yk-yellow` → `bg-og-yellow`, `text-yk-black/70` → `text-og-black/70`, and so on)
  - any raw `var(--yk-…)`
  - `scene-kit/theme.css` and the visuals guide if they use `yk` (keep these in step with Task 3)
  - Do it with a scoped `sed` over `player/src` and `scene-kit`, then check with
    `git grep -n -E '\byk-|--yk-|-yk-' -- player/src scene-kit skills` (expect no hits).
- [ ] `player/index.html`: `<title>oldguy</title>`.
- [ ] `player/src/components/Header.tsx`: the headline "Ask the old guy.", with "Claude yaps. You watch." under it.
- [ ] Every other user-facing string in components that says "yap" (search `player/src`), and the matching
  component tests (`ChatTab.test.tsx`, `SourcesTab.test.tsx` and others).
- [ ] Check in `player/`: `npm run typecheck`, `npx vitest run` (227 or more pass), then `npm run build` and
  `npm run check:dist`.
- [ ] Commit, including `player/dist`: `rename: player says oldguy`.

### Task 8: The old guy art

Source of truth: `docs/assets/brand/oldguy-concept-*.webp` and the spec's Branding section. All art is hand-built
SVG in the palette (`#F6C945 #FF8A1F #14110A #FFF1CC #FF6B57`, plus skin, beard grey and denim tones as needed). It
has thick `#14110A` outlines and flat fills, with no gradients and no raster images. **Don't change the
character:** dopey half-lidded squint, one buck tooth, open mouth, ginger-and-grey mop and beard, trucker cap with a
"#1 DEV" patch, glasses on the cap, headset, pencil.

- [ ] `docs/assets/mascot.svg`: a bust (head and cap) on a transparent background, with a `viewBox` of about
  `0 0 160 160`, `role="img"` and an `aria-label` describing the old guy.
- [ ] `docs/assets/mascot-dark.svg`: the same bust with outlines and patch text tuned to read on dark backgrounds,
  as the current dark file does.
- [ ] `docs/assets/oldguy-full.svg`: full body from Body A: finger raised, "LEGACY CODE FUEL" mug, torn yellow
  shirt, socks and sandals.
- [ ] `player/src/components/Logo.tsx`:
  - the mark becomes the head in a yellow circle
  - the wordmark text becomes `oldguy` on the existing tilted yellow chip
  - `size="sm"` uses the **small mark**: cap, mop and open mouth only, with no glasses, pencil or headset
- [ ] Favicon: an inline SVG data URL of the small mark in `player/index.html`.
- [ ] Check:
  - open each SVG in Chromium (Playwright screenshot) at 32px and at 256px, on light and dark backgrounds; the
    small mark must read as a face in a cap at 32px
  - player `typecheck`, `vitest`, `build` and `check:dist` all pass
- [ ] Commit, including `player/dist`: `brand: the old guy replaces the alarm clock`.

### Task 9: Living docs and CI

- [ ] `README.md`, rewritten top to bottom with the same structure:
  - hero `<picture>` using the new mascot files
  - `<h1>oldguy</h1>`, the headline, then the subline
  - badges pointing at `Aryanshaw/oldguy` and npm `oldguy`
  - install with `npx oldguy`, or `/plugin marketplace add Aryanshaw/oldguy` then `/plugin install oldguy@oldguy`
  - examples use `/oldguy …`
  - the commands table and `npx oldguy [--yes | --plugin-only]`
  - the FAQ answer "Why 'oldguy'?", in one or two lines: the old guy who can explain anything to anyone. Claude
    still yaps.
- [ ] `CONTRIBUTING.md`:
  - the title
  - `node bin/oldguy.cjs --help`
  - `--plugin-dir /path/to/oldguy`
  - the spec pointer: keep the old design spec path, and add the rename spec
  - the publish steps: `cd packages/oldguy && npm publish`
- [ ] `docs/ARCHITECTURE.md`: names and paths.
- [ ] `docs/STATUS.md`: names, plus the line "Renamed from Yap to oldguy on 2026-10-07; older docs use the old
  name."
- [ ] `scene-kit/vendor/README.md`: `oldguy narrate`.
- [ ] `.github/workflows/player.yml`: rename any step or path that mentions yap. The job logic doesn't change.
- [ ] Remove the `todo` from `tests/brand-name.test.cjs`. It must now pass. Fix whatever it lists. Don't widen its
  allowlist without a reason written next to the entry.
- [ ] Check: root `npm test` (count is 694 plus the new guard test, 0 fail), and the full player suite and
  `check:dist`.
- [ ] Commit: `docs: README and contributor docs say oldguy`.

### Task 10: End-to-end verification and handoff

- [ ] Run the spec's Verification list in full:
  - `git grep -i -n 'yap'` returns only the allowed set (the subline, historical paths, the rename spec, this plan)
  - root `npm test` passes
  - player `typecheck`, `vitest`, `build` and `check:dist` pass
  - `node bin/oldguy.cjs --help` and `node bin/oldguy.cjs doctor` work
  - `claude --plugin-dir .` lists `/oldguy`
  - the session-start hook (run with `tests/fixtures/hook-stdin-sample.txt` as stdin from a temp project) creates
    `.oldguy/session.json` and prints the `/oldguy doctor` hint
  - `npm pack --dry-run` in `packages/oldguy` passes
- [ ] Take a Playwright screenshot of the player (logo, header, favicon) and send it to the owner.
- [ ] Push the branch. Do **not** open a PR unless the owner asks.
- [ ] Hand the owner the steps only they can do, in this order:
  1. Rename the repo on GitHub: Settings → General → Repository name → `oldguy`.
  2. Run `git remote set-url origin https://github.com/Aryanshaw/oldguy` in each local checkout.
  3. Merge the branch into `master`.
  4. Re-check that `oldguy` is free on npm, then run `cd packages/oldguy && npm publish`.
  5. Run `npm deprecate getyap "renamed: use npx oldguy"`.
  6. Optionally, register a domain and update the homepage fields.

## Out of scope

- Template support for featuring the old guy as host (an opt-in flag, an intro sting, a corner avatar). The
  templates work owns that; this plan only ships the SVGs it will use.
- Giving the narration voice the old guy's persona.
- Any behaviour change, refactor or dependency bump.
