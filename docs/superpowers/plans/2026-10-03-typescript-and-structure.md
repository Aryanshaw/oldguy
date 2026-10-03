# Yap: TypeScript and Code Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Per the owner's standing preference, this plan carries **signatures, test cases, commands and logic sketches, not full implementations**. Most of the work is mechanical conversion; write the real code in plain, commented style (a one- or two-line plain-words comment above every function and every non-obvious step, as in the existing code).

**Goal:** Give the Yap codebase a typed, layered structure before Phase 3 builds on it: all runtime code in TypeScript that Node runs directly (no build step, no new runtime dependency), the command-line adapters in their own `cli/` folder, and tests that keep the structure from rotting.

**Architecture:** Source files become ES modules in TypeScript (`.mts`) that Node 22.18+ runs by stripping the types. `typescript` is a devDependency used only by `npm run check` (`tsc --noEmit`); it is never loaded at run time. The command entry points (`bin/yap.cjs`, `hooks/session-start.cjs`) stay tiny plain-JavaScript launchers so that an old Node prints one clear sentence instead of a syntax error, and so every path the skill, hooks, tests and docs already use stays valid. Data shapes (manifest row, events, stream events, API payloads) are exported as types from the module that owns them, so the Phase 3 player can `import type` them.

**Tech Stack:** Node 22.18+ (type stripping on by default), TypeScript (check only), `@types/node@22`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-02-yap-design.md` (sections 4.3, 10, 11, 14). This plan changes no behaviour. **Phase 2 contract it must preserve:** `docs/phase-2/SUMMARY.md` sections 2, 3 and 11.

## Decision record (owner agreed 2026-10-03; one point corrected by evidence)

1. No Express: zero runtime dependencies stays. Of 52 installed plugins only 3 ship `node_modules`, and those run their own installers; Claude Code gives no install step.
2. TypeScript, run directly by Node, `typescript` as devDependency only.
3. The command-line adapters move into `cli/`.
4. **Correction.** The owner agreed to `.cts` (CommonJS) on the strength of my recommendation. A probe on 2026-10-03 showed it fails the purpose: in a `.cts` file, `require('./a.cts')` returns an untyped value, so `tsc` did **not** catch a deliberate `number`-to-`string` error across files, and `import` syntax cannot be used (Node rejects it in `.cts`, and `import x = require()` is not erasable). The same probe with `.mts` (ES modules) caught the error, ran on Node 22.18 and 26.7, and a plain `.cjs` file could `require()` the `.mts` file. **This plan therefore uses `.mts`.** The owner must confirm this change at the plan review.

## Global Constraints

- **Node floor 22.18.** Verified on this machine: 22.18.0 runs `.ts`/`.mts`/`.cts` with no flag and no warning; 22.17.0 needs `--experimental-strip-types` and prints an experimental warning; 20.18.0 fails. `package.json` gets `"engines": {"node": ">=22.18"}`.
- **No runtime dependencies** in `bin/`, `lib/`, `cli/`, `server/`, `scene-kit/`, `hooks/` (owner rule). `typescript` and `@types/node` are devDependencies only. `@types/node` is pinned to major 22 so the type checker rejects Node APIs newer than the floor.
- **Erasable syntax only** (`erasableSyntaxOnly`): no `enum`, `namespace`, constructor parameter properties, or `import x = require()`. The code has none today (checked by grep, and it has no classes).
- **Strict types.** `strict: true`. No `any` and no `@ts-ignore` / `@ts-nocheck`; `@ts-expect-error` only with a reason on the same line. Values from `JSON.parse` are `unknown` and are narrowed by validation, not cast.
- **Imports** use explicit `.mts` extensions and `import type` for type-only imports (`verbatimModuleSyntax`). `__dirname` becomes `import.meta.dirname`.
- **Layering** (enforced by a test in Task 6): `scene-kit/` and `lib/` import only from each other and from `node:*`; `server/` may import `lib/` and `scene-kit/`; `cli/` may import `lib/` and `server/`; `bin/` and `hooks/` are launchers and import only `cli/`, `lib/` and `lib/node-floor.cjs`. No import cycles.
- **Plain-JavaScript exceptions:** `lib/node-floor.cjs` (with `lib/node-floor.d.cts`), `bin/yap.cjs`, `hooks/session-start.cjs`. They must run on any Node, so they carry no TypeScript.
- **Tests stay `.cjs`** (out of scope to convert) and load the `.mts` modules with `require()`, which Node 22.18 supports for ES modules without top-level `await`. No module may use top-level `await`.
- **Behaviour is preserved.** `npm test` count never drops below the baseline of 599; the acceptance script stays 66 of 66. No money, price or token talk in any file.
- **Commits:** end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. No push or merge without the owner. Branch `typescript-structure`, cut from `master` (`20da770`) at execution time. Never `git add -A`; stage by explicit path.

## Review Focus

Conditions the plan implies but a happy-path run will not exercise, most likely first. Each is pinned by a named test or step in the task that owns it.

1. **An old Node runs the command or the hook.** Node 22.17 or older must get one plain sentence (what is wrong, how to fix), exit code 1 from the command and 0 from the hook (a session must still start), and never a `SyntaxError` dump. *(Task 0, Task 5)*
2. **A test or module that relied on changing a CommonJS export object.** ES module exports cannot be reassigned. Any such code must fail loudly in the conversion task, not be silently skipped. *(Tasks 2 to 5)*
3. **An import cycle or top-level `await`.** Either breaks `require()` of an ES module from the `.cjs` tests with a confusing error. *(Task 6 cycle test)*
4. **Yap installed inside a `node_modules` folder.** Node refuses to strip types there. The launcher must say so in one sentence. *(Task 0)*
5. **A child process that starts the command by path.** `lib`/`cli` code spawns `bin/yap.cjs serve`, and the acceptance script finds the server with `pgrep -f "yap.cjs serve --dir ..."`. Both must keep working because the launcher keeps its path and name. *(Task 5, Task 7)*

## File Structure

```
bin/yap.cjs                  launcher (plain JS): checks Node, then imports bin/yap.mts
bin/yap.mts                  the command table and main()
hooks/session-start.cjs      launcher (plain JS), same pattern, exits 0 on a Node problem
hooks/session-start.mts      the hook body
lib/node-floor.cjs           plain JS: nodeProblem(version, dir) -> string | null
lib/node-floor.d.cts         its types
lib/*.mts                    pure and domain modules (was lib/*.cjs)
cli/*.mts                    command-line adapters (was lib/*-cli.cjs and lib/cli-args.cjs)
server/*.mts                 the HTTP server (was server/*.cjs)
scene-kit/*.mts              scene pieces (was scene-kit/*.cjs)
tsconfig.json                type-check settings (no emit)
docs/ARCHITECTURE.md         layers, conventions, how to add a module or a command
tests/code-rules.test.cjs    layering, cycles, no-any rules
tests/node-floor.test.cjs    the Node-floor message and, when other Node versions exist, a real run
```

---

### Task 0: Tooling and the Node floor

**Files:** Create `tsconfig.json`, `lib/node-floor.cjs`, `lib/node-floor.d.cts`, `tests/node-floor.test.cjs`. Modify `package.json`, `lib/doctor.cjs`, `tests/doctor.test.cjs`.

**Interfaces:** Produces `nodeProblem(version: string, dir: string): string | null` (CommonJS export of `lib/node-floor.cjs`) and the `NODE_FLOOR` string `'22.18.0'`. Consumed by Tasks 3 and 5.

- [ ] **Step 1: Write failing tests** (`tests/node-floor.test.cjs`, plain `node:test`): `nodeProblem('22.18.0', '/x/yap/bin')` is `null`; `'26.7.0'` is `null`; `'22.17.0'`, `'22.9.1'`, `'20.18.0'` each return one line that contains the running version and `22.18` and no newline; `nodeProblem('22.18.0', '/p/node_modules/yap/bin')` returns one line that mentions `node_modules`; Windows-style `C:\\p\\node_modules\\yap\\bin` also does; a garbage version string (`'banana'`) returns a problem line, never throws. In `tests/doctor.test.cjs` add: the doctor's Node check fails with the same sentence as its fix text when given version `22.17.0` and passes for `22.18.0` (read how the existing checks are injected and follow that; the doctor has no Node check today).
- [ ] **Step 2: Run** `npm test` → the new tests FAIL (module not found).
- [ ] **Step 3: Implement.** `lib/node-floor.cjs`: compare `major.minor.patch` numerically (do not parse with a regex that accepts `22.18`-prefixed garbage); message form: `Yap needs Node 22.18 or newer; this is Node <v>. Install a newer Node from https://nodejs.org and run it again.` and for the folder case: `Yap cannot run from inside a node_modules folder (Node does not read TypeScript there). Install it as a Claude Code plugin instead.` `lib/node-floor.d.cts`: declare both exports. `lib/doctor.cjs`: add the Node check using `nodeProblem`, in the style of its neighbours, with the message as the fix text. `package.json`: add `"engines": {"node": ">=22.18"}`; add devDependencies `typescript` (latest) and `@types/node@^22` with `npm install -D typescript @types/node@^22`; add scripts `"check": "tsc -p tsconfig.json"` and `"pretest": "npm run check"`. `tsconfig.json`: `module` and `moduleResolution` `nodenext`, `target` `es2023`, `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `skipLibCheck`, `types: ["node"]`, `include: ["lib/**/*.mts"]` (a list that later tasks extend; with no `.mts` files yet, create one empty file `lib/_check.mts` containing `export {};` and delete it in Task 2).
- [ ] **Step 4: Run** `npm run check` (exit 0) and `npm test` (all pass; the count is 599 plus the new tests).
- [ ] **Step 5: Commit** `build: typescript check, node 22.18 floor and its message`.

---

### Task 1: Move the command-line adapters into `cli/` (still CommonJS)

**Files:** Move with `git mv`: `lib/audit-cli.cjs` → `cli/audit.cjs`, `beats-cli` → `cli/beats.cjs`, `captions-cli` → `cli/captions.cjs`, `client-cli` → `cli/client.cjs`, `doctor-cli` → `cli/doctor.cjs`, `narrate-cli` → `cli/narrate.cjs`, `render-cli` → `cli/render.cjs`, `scaffold-cli` → `cli/scaffold.cjs`, `server-cli` → `cli/server.cjs`, `wav-cli` → `cli/wav.cjs`, and `lib/cli-args.cjs` → `cli/args.cjs`. Modify `bin/yap.cjs`, every `require` of those files in `cli/`, `lib/`, `server/` and `tests/`.

**Interfaces:** No signature changes. `runAudit`, `runBeats`, … `runServe` keep their names and behaviour.

- [ ] **Step 1: Write the failing test first.** `tests/cli-layout.test.cjs`: no file in `lib/` has a name ending `-cli.cjs`; every file in `cli/` exports at least one function whose name starts with `run`; `lib/cli-args.cjs` no longer exists. Run it → FAIL.
- [ ] **Step 2: Move and rewire.** `git mv` each file above. Fix requires: in `cli/*`, `./cli-args.cjs` → `./args.cjs`, other `./x-cli.cjs` → `./x.cjs`, and requires of `lib` modules become `../lib/x.cjs`; `cli/server.cjs`'s `require('../server/server.cjs')` and its `path.join(__dirname, '..', 'bin', 'yap.cjs')` stay correct because `cli/` is at the same depth as `lib/`; `bin/yap.cjs` requires `../cli/*.cjs`. Update `tests/*.cjs` with a loop, for example `for n in audit beats captions client doctor narrate render scaffold server wav; do sed -i '' "s#/lib/$n-cli\.cjs#/cli/$n.cjs#g" tests/*.cjs; done` and `sed -i '' "s#/lib/cli-args\.cjs#/cli/args.cjs#g" tests/*.cjs`; then `grep -rn "\-cli\.cjs\|cli-args" lib cli server bin hooks tests skills docs/phase-2 | grep -v "^docs/superpowers"` must show only intentional mentions.
- [ ] **Step 3: Run** `npm test` → all pass, the same count as before plus the new layout test; `node bin/yap.cjs --help` lists the same ten commands.
- [ ] **Step 4: Commit** `refactor: command-line adapters live in cli/`.

---

### Task 2: Convert the leaf modules (no imports from other Yap modules)

**Files (rename `.cjs` → `.mts` with `git mv`, then edit):** `scene-kit/{callout,code-card,escape,shared,steps,title}`, `lib/{sentences,wav,beats,captions,build-record,render-schedule,audit,hyperframes,data-dir,ask-server,http-guard,poster,sse}`. Delete `lib/_check.mts`. Modify `tsconfig.json` `include` to `["lib/**/*.mts", "scene-kit/**/*.mts"]`, and `require` paths in `lib/*.cjs`, `server/*.cjs`, `cli/*.cjs`, `tests/*.cjs` that name these files.

**Interfaces:** Each module exports exactly what it exported before, now as named `export function …` / `export const …` with parameter and return types. Types worth naming and exporting here (they are used downstream): `Beat`, `Word`, `Caption` (beats, captions), `BuildRecord`, `BuildFingerprint` (build-record), `Finding`/`AuditResult` (audit), `RenderJob` (render-schedule), `AskResult` (ask-server: `{ok: true, status, headers, body} | {ok: false, reason: 'refused' | 'timeout' | 'other'}`), `Guard`, `GuardVerdict` (http-guard), `Hub`, `StreamEvent` (sse: the union of `state | chapter | reply | ping` with each payload shape).

- [ ] **Step 1: Write the failing check.** Add to `tests/code-rules.test.cjs` (create it; Task 6 grows it) one test: no file under `scene-kit/` or the leaf list in `lib/` ends in `.cjs`. Run → FAIL.
- [ ] **Step 2: Convert one file at a time, leaf first.** For each: `git mv x.cjs x.mts`; change `const { a } = require('./y.cjs')` to `import { a } from './y.mts'` (use `import type` for types); `const fs = require('node:fs')` to `import fs from 'node:fs'`; `module.exports = { a, b }` to `export { a, b }` (or `export` on each declaration); add types; replace `__dirname` with `import.meta.dirname`. Leave a comment-only note where a type is a judgment call. Where a function takes an options bag or injected dependencies (`deps`), define a named `type` for it next to the function. Keep behaviour byte for byte.
- [ ] **Step 3: After each file** run `npm run check` and the test files that cover it (`node --test tests/<name>.test.cjs`). Update the `require` strings in `lib/*.cjs`, `server/*.cjs`, `cli/*.cjs`, `tests/*.cjs` with the loop pattern from Task 1 (`s#/lib/$n\.cjs#/lib/$n.mts#g`, same for `scene-kit`).
- [ ] **Step 4: Gate for Review Focus 2.** Run `grep -n "module\.exports\.\|exports\.[a-zA-Z]* *=" lib scene-kit` (none left) and `grep -rn "require('\.\./\(lib\|scene-kit\)/[a-z-]*\.mts')" tests | grep -v "const {\|const [a-zA-Z]* = require"` to spot tests that use a module in an unusual way; any test that reassigns a property of a loaded module is rewritten to use the module's injected `deps` instead and noted in the report.
- [ ] **Step 5: Run** `npm run check`, `npm test` (count unchanged plus new tests; all pass).
- [ ] **Step 6: Commit** `refactor: leaf modules in typescript`.

---

### Task 3: Convert the domain modules and export the data-contract types

**Files:** `lib/{chapter,chapter-scan,manifest,events,doctor,narrate,render-chapters,range,watcher,live-server,export}.cjs` → `.mts`. Extend `tsconfig.json` nothing (the `lib/**` glob already covers them). Update requires as before.

**Interfaces — the types that become the shared contract (names are binding; Phase 3 imports them):**
- `lib/manifest.mts`: `ChapterStatus = 'pending' | 'rendering' | 'ready' | 'failed' | 'stale'`, `Quality = 'draft' | 'full'`, `ManifestRow` (every field from `docs/phase-2/SUMMARY.md` section 3: `id, title, parent_id, placement_reason, status, quality, duration_s, video, poster, captions, question, build_sha256, verified_against_commit`, each with its exact nullable type), `Manifest`, and the existing functions typed to take and return them. `STATUSES` is derived from one `as const` array so the type and the list cannot drift.
- `lib/events.mts`: `EventType`, `ViewerEvent`, `Reply`, `ThreadEntry` (with `role: 'viewer' | 'claude'`).
- `lib/chapter-scan.mts`: `ScanStatus = 'ready' | 'stale' | 'rendering' | 'pending'`, `ScannedChapter`, `ProjectScan`.
- `lib/chapter.mts`: `ChapterSpec`, `ChapterSource`, `ChapterSentence`.
- `lib/doctor.mts`: `DoctorCheck`, `DoctorReport`; its Node check uses `nodeProblem` from `lib/node-floor.cjs` (import it as `import { nodeProblem } from './node-floor.cjs'`; the `.d.cts` supplies the types).

- [ ] **Step 1: Write failing type tests.** Add `tsc`-only assertions in a file `lib/_contract.check.mts` (included by tsconfig, excluded from runtime because nothing imports it) that uses `satisfies` and a tiny `Equal<A, B>` helper to assert: `ChapterStatus` equals the union above; `ManifestRow['poster']` is `string | null`; `Parameters<typeof insertChapter>[1]` accepts a `ManifestRow`; `StreamEvent['event']` equals `'state' | 'chapter' | 'reply' | 'ping'`. Run `npm run check` → FAIL until the types exist. (This is the one place a type error is the test; it must fail first.)
- [ ] **Step 2: Convert in dependency order:** `chapter`, `chapter-scan`, `manifest`, `events`, `range`, `watcher`, `live-server`, `export`, `doctor`, `narrate`, `render-chapters`. After each file: `npm run check` and its covering tests.
- [ ] **Step 3: Narrow, don't cast.** Every `JSON.parse` result is `unknown` and goes through the module's existing validation; the validators become type guards (`function isManifestRow(v: unknown): v is ManifestRow`). Where the existing code reads an untrusted field it keeps its checks. No `as` casts except one, commented, at a boundary where the check has just proved the shape.
- [ ] **Step 4: Run** `npm run check` and `npm test` (all pass, count unchanged plus new).
- [ ] **Step 5: Commit** `refactor: domain modules in typescript with exported contract types`.

---

### Task 4: Convert the server

**Files:** `server/{export-route,chapter-sync,api,server}.cjs` → `.mts`. Extend `tsconfig.json` `include` with `"server/**/*.mts"`.

**Interfaces:** `startServer(options: StartOptions): Promise<RunningServer>` with `StartOptions = { slugDir: string; key?: string; port?: number; deps?: ServerDeps }` and `RunningServer = { url: string; key: string; port: number; address: string; family: string; server: import('node:http').Server; state: ServerState; close(): Promise<void> }`. `ServerDeps` names every injectable that exists today (`now`, `exec`, `ffmpeg`, `intervalMs`, `scan`, `pingMs`, `posterWaitMs`, `queueWaitMs`, `logError`, `fs`, `afterCheck`, `createReadStream`, `heartbeatMs`, … read the file for the exact list) with its function type. `Route = { method: string; pattern: string; handler(ctx: RouteContext): void | Promise<void> }`. `server/api.mts` exports the request and response types of every route (`MessageBody`, `ReplyBody`, `ChaptersBody` as a discriminated union on `op`, `StateResponse`, `ExportBody`, `ExportResult`). **The server's public behaviour and every response body stay identical.**

- [ ] **Step 1: Write failing tests.** In `tests/code-rules.test.cjs` add: `server/*.cjs` no longer exists. In `lib/_contract.check.mts` add type assertions: `ChaptersBody` is a union whose `op` values are exactly `'add' | 'reorder' | 'set'`; `StateResponse['manifest']` is `Manifest`; `RunningServer['close']` returns `Promise<void>`. Run → FAIL.
- [ ] **Step 2: Convert in order:** `export-route`, `chapter-sync`, `api`, `server`. `ServerState` is a named type listing every field the handlers read; where `state` is built up in steps, build it in one expression or type the partial explicitly (no `Partial<…>` hiding missing fields at the end).
- [ ] **Step 3: Run** `npm run check`, `npm test` (the server suites are the net: `server-*.test.cjs`, `sse`, `watcher`, `export`, `client-cli`).
- [ ] **Step 4: Run the real server once:** `source spikes/env.sh && node tests/phase2-acceptance.cjs` → 66 passed, 0 failed (the launcher is still `.cjs`, so this exercises the converted server through the unchanged entry point).
- [ ] **Step 5: Commit** `refactor: server in typescript`.

---

### Task 5: Convert the command-line adapters, the command table, the hook, and add the launchers

**Files:** `cli/*.cjs` → `cli/*.mts`; `bin/yap.cjs` → `bin/yap.mts` plus a new plain-JS `bin/yap.cjs`; `hooks/session-start.cjs` → `hooks/session-start.mts` plus a new plain-JS `hooks/session-start.cjs`. Extend `tsconfig.json` `include` to `["bin/**/*.mts", "cli/**/*.mts", "hooks/**/*.mts", "lib/**/*.mts", "scene-kit/**/*.mts", "server/**/*.mts"]`.

**Interfaces:** `bin/yap.mts` exports nothing and runs `main(process.argv.slice(2))` when imported (as `bin/yap.cjs` did). `type Command = { summary: string; run(args: string[], opts?: { timeoutMs?: number }): number | void | Promise<number | void> }`. The launchers: `bin/yap.cjs` is exactly: shebang `#!/usr/bin/env node`; `const { nodeProblem } = require('../lib/node-floor.cjs'); const problem = nodeProblem(process.versions.node, __dirname); if (problem) { process.stderr.write('yap: ' + problem + '\n'); process.exitCode = 1; } else { import('./yap.mts').catch((err) => { process.stderr.write('yap: ' + (err && err.message ? err.message : err) + '\n'); process.exitCode = 1; }); }` with a plain-words comment on why it is plain JavaScript. `hooks/session-start.cjs` is the same but writes the problem to stderr and leaves the exit code 0 so a session still starts. Both keep the executable bit.

- [ ] **Step 1: Write failing tests.** (a) `tests/cli.test.cjs` already spawns `bin/yap.cjs`; add one asserting `node bin/yap.cjs --help` still lists the ten commands. (b) `tests/node-floor.test.cjs` add: when `~/.nvm/versions/node/v22.17.0/bin/node` exists, `node bin/yap.cjs --help` run with it exits 1, prints exactly one line to stderr containing `22.18`, and no `SyntaxError`; the hook run with it exits 0 and prints one line; when `v22.18.0` exists, `--help` succeeds. Skip each when the Node binary is missing (print why). (c) `tests/code-rules.test.cjs`: no `.cjs` file other than the three launchers/floor files exists under `bin/`, `cli/`, `hooks/`, `lib/`, `server/`, `scene-kit/`. Run → FAIL.
- [ ] **Step 2: Convert** `cli/*` (typed `run…` functions taking `string[]`), then `bin/yap.mts` (the command table typed as `Record<string, Command>`; keep `Object.hasOwn` lookups), then `hooks/session-start.mts`. Write the two launchers.
- [ ] **Step 3: Review Focus 5.** `grep -rn "yap\.cjs" cli lib server tests skills hooks .claude-plugin package.json` — every mention still points at the launcher and still resolves; `cli/server.mts` spawns `process.execPath` with the launcher path (unchanged) and nothing else.
- [ ] **Step 4: Run** `npm run check`, `npm test`, and by hand with the other Nodes: `~/.nvm/versions/node/v22.17.0/bin/node bin/yap.cjs --help; echo "exit $?"` (one sentence, exit 1) and `~/.nvm/versions/node/v22.18.0/bin/node bin/yap.cjs --help` (the command list).
- [ ] **Step 5: Commit** `refactor: command adapters, command table and hook in typescript; plain-JavaScript launchers`.

---

### Task 6: Structure rules as tests, and the architecture note

**Files:** Modify `tests/code-rules.test.cjs`; create `docs/ARCHITECTURE.md`. Modify `docs/HANDOFF.md` (the status section).

**Interfaces:** Test helper (local to the test file) `importsOf(file: string): string[]` returning the relative specifiers found by a regex over `import … from '…'`, `import('…')` and `require('…')`.

- [ ] **Step 1: Write the rule tests first** (each must be shown able to fail by a reverted one-line break, recorded in the report): (a) layering table from Global Constraints — `lib/` and `scene-kit/` files import nothing from `server/`, `cli/`, `bin/`, `hooks/`; `server/` nothing from `cli/`, `bin/`, `hooks/`; `cli/` nothing from `bin/`, `hooks/`; (b) no import cycles among `.mts` files (depth-first search over `importsOf`; the failure message prints the cycle); (c) no `any` in source (`: any`, `as any`, `<any>`, `any[]`), no `@ts-ignore`, no `@ts-nocheck`; each `@ts-expect-error` has text after it; (d) no top-level `await` (a line starting with `await ` at column 0 in a source file); (e) every `.mts` file imports with explicit `.mts`/`.cjs` extensions (no extensionless relative import); (f) every file in `cli/` exports a `run…` function (replaces the Task 1 layout test; delete that file).
- [ ] **Step 2: Write `docs/ARCHITECTURE.md`** (about 60 lines, plain words): the layers and who may import whom (a small table), what lives where, the data-contract types and the rule that a type lives in the module that owns the data, the launcher pattern and why (old Node message, stable path), the conventions (named exports, explicit extensions, `deps` injection for anything that touches the clock, disk, network or a child process, JSON in is `unknown`), how to add a library module, a route, and a command (three short checklists), and how to run `npm run check` / `npm test` / the acceptance script. State the Node floor and why.
- [ ] **Step 3: Update `docs/HANDOFF.md`** status section: the new layout, the Node floor, the `.mts` decision, and where `docs/ARCHITECTURE.md` is.
- [ ] **Step 4: Run** `npm test` (all pass), `npm run check`.
- [ ] **Step 5: Commit** `test: structure rules; docs: architecture note`.

---

### Task 7: Verification on the real thing and the roll-up

**Files:** Create `docs/phase-2/TYPESCRIPT-MIGRATION.md` (results). Modify `docs/phase-2/SUMMARY.md` only by appending a section "12. After the TypeScript migration" pointing at it.

- [ ] **Step 1:** `npm run check` (exit 0, no errors) and `npm test` (record totals; must be at least 599 plus the new tests, 0 failed), three runs in a row.
- [ ] **Step 2:** `source spikes/env.sh && node tests/phase2-acceptance.cjs` → 66 passed, 0 failed; confirm no leftover `yap.cjs serve` process.
- [ ] **Step 3: Other Node versions** (machine has them under `~/.nvm/versions/node/`): run `--help`, `doctor`, and the hook on 22.17.0 (expect the sentence), 22.18.0 and the default Node 26.7.0 (expect normal output); record the output lines. Run `npm test` once under 22.18.0 (`PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH npm test`) and record the totals: this is the floor the claim rests on.
- [ ] **Step 4: Type-sharing proof for Phase 3.** In a scratch folder outside the repo, a file containing `import type { Manifest, ManifestRow } from '<repo>/lib/manifest.mts'; import type { StreamEvent } from '<repo>/lib/sse.mts';` and a use of each type; `tsc --noEmit` on it passes. Record the command. This is the evidence that the player can import the contract.
- [ ] **Step 5: Write `docs/phase-2/TYPESCRIPT-MIGRATION.md`:** what changed (file moves table), the numbers, the Node-floor evidence, the decision record including the `.cts` correction, what was NOT done (tests still `.cjs`, no bundling, no `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`), and proposed spec amendments for the owner (Node 22.18 floor; `.mts` source with launchers; `cli/` folder in spec section 10's layout). None applied.
- [ ] **Step 6: Commit** `docs: typescript migration results`.
- [ ] **Step 7:** Hand the branch to a fresh whole-branch reviewer (most capable model) with this plan, the Review Focus, and the ledger.

---

## Out of scope

Converting the tests to TypeScript; bundling; `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (can be turned on later, one at a time); any behaviour change, new route, new command or bug fix found on the way (record it in the report instead); the Phase 3 player; renaming public command names; publishing to npm.

## Order of work

Task 0 first (floor and tooling). Task 1 (move) before any conversion so history stays readable. Tasks 2, 3, 4, 5 strictly in order: a file can only be converted after everything it imports, because an `.mts` importing an unconverted `.cjs` has no types. Task 6 then 7. Estimated effort: Task 0 about 45 minutes, Task 1 about 30, Task 2 about 90, Task 3 about 120, Task 4 about 90, Task 5 about 90, Task 6 about 60, Task 7 about 60.
