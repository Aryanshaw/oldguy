# TypeScript and structure migration: results

Branch `typescript-structure` (7 commits above `06f6320`, which is `master` plus the plan). Plan:
`docs/superpowers/plans/2026-10-03-typescript-and-structure.md`. Behaviour is unchanged; what changed is the language
the program is written in, where the command adapters live, and the rules that keep the structure from rotting.

## What changed

| Before | After |
|---|---|
| `lib/*.cjs`, `server/*.cjs`, `scene-kit/*.cjs`, `bin/yap.cjs`, `hooks/session-start.cjs` (CommonJS, untyped) | the same modules as typed ES modules (`.mts`): 24 in `lib/`, 6 in `server/`, 6 in `scene-kit/`, `bin/yap.mts`, `hooks/session-start.mts` |
| 10 `lib/*-cli.cjs` adapters and `lib/cli-args.cjs` | 11 files in `cli/` (`cli/audit.mts`, `cli/client.mts`, ... `cli/args.mts`) |
| `bin/yap.cjs` held the command table | `bin/yap.cjs` is a small plain-JavaScript launcher; the table is `bin/yap.mts`; likewise `hooks/session-start.cjs` and `.mts` |
| nothing checked the Node version | `lib/node-floor.cjs` (plain JavaScript): Node older than 22.18, or Yap inside a `node_modules` folder, gets one plain sentence; the doctor uses the same sentence |
| no type checking | `npm run check` (`tsc --noEmit`), run before every `npm test`; `typescript` and `@types/node@22` are dev dependencies only |
| structure by habit | `tests/code-rules.test.cjs` (layering, no import loops, no `any`, no top-level `await`, explicit extensions, every `cli/` file exports a `run...` function) and `docs/ARCHITECTURE.md` |

Nothing the skill, the hooks, the tests, the child processes or the acceptance script use by path changed: they all
point at `bin/yap.cjs` and `hooks/session-start.cjs`. No runtime dependency was added.

## Results

| Check | Result |
|---|---|
| `npm run check` | exit 0, no errors |
| `npm test` (Node 26.7.0), three runs in a row | 619 tests, 619 pass, 0 fail each time (baseline before this work: 599) |
| `npm test` under Node 22.18.0 (the floor) | 619 tests, 619 pass, 0 fail |
| `node tests/phase2-acceptance.cjs` (real server, real ffmpeg, real HTTP) | 66 passed, 0 failed of 66 |
| Node 22.17.0: `yap --help`, `yap doctor`, the hook | one sentence each: `yap: Yap needs Node 22.18 or newer; this is Node 22.17.0. ...`; the command exits 1, the hook exits 0; no syntax error (also pinned by two tests that run the real launchers under 22.17 and 22.18 and were shown to fail when the version check is disabled) |
| Node 22.18.0 and 26.7.0: `yap --help` | the normal command list |
| The player can use the shapes | a file outside the repo that does `import type { Manifest, ManifestRow, ChapterStatus } ...`, `StreamEvent`, `ChaptersBody`, `StateResponse` and uses them compiles clean with `tsc`, and a deliberate mistake (`const bad: ChapterStatus = 'done'`) is rejected with `Type '"done"' is not assignable to type '"failed" | "pending" | "ready" | "rendering" | "stale"'` |

Each task was checked by taking the types out of every converted file (Node's own `stripTypeScriptTypes`) and comparing
what is left against the original file, after removing comments, imports and spacing. The only differences found were
helper wrappers, alias variables introduced so a cast has a name, `'busy' in x` style checks, and a few expressions
rewritten to give the same result for every input (each listed in the ledger).

## Decisions

1. No Express: zero runtime dependencies stays. Of 52 installed plugins only 3 ship `node_modules`, and those install
   their own; Claude Code gives a plugin no install step.
2. TypeScript, run directly by Node, with `typescript` as a dev tool.
3. **`.mts` (ES modules), not `.cts` (CommonJS).** The owner agreed to `.cts` on the strength of a recommendation that
   turned out wrong. Probe on 2026-10-03: in a `.cts` file `require('./a.cts')` is untyped, so `tsc` did not catch a
   deliberate `number`-to-`string` error across files, and `import` syntax cannot be used. The same probe with `.mts`
   caught the error, ran on Node 22.18 and 26.7, and a plain `.cjs` file could `require()` the `.mts` file.
4. Plain-JavaScript launchers keep every external path stable and give an old Node a readable message.
5. The command adapters moved into `cli/` and lost the `-cli` suffix; the shared helper is `cli/args.mts`.
6. The executor changed from subagent-driven to native part-way (after Task 2) at the owner's instruction, because
   dispatching subagents began to be refused by the session's permission check. Tasks 0 to 2 were written by
   subagents and checked by the controller; Tasks 3 to 7 were written and checked by the controller. The fresh-eyes review
   at the end could not be dispatched (the session refused the reviewer), so the last review was a self-review by the
   controller: weaker than an independent one, and the owner should decide whether it is enough before merging.

## What was not done

- Tests are still `.cjs` and are not type-checked.
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are off; each can be turned on later, one at a time.
- No bundling; no behaviour change, new route, new command or bug fix. Things noticed on the way are in the ledger.
- A project that imports Yap's types must have `@types/node` available: the type files import modules that use Node's
  types, so the checker needs them (shown by the first attempt of the player proof above, which failed until the Node
  types were provided). Phase 3 can either rely on `@types/node` (normal in a Vite project) or add a types-only entry file.

## Final review (self-review, no independent reviewer was available)

Re-checked at the end: stale `.cjs` mentions in source (one comment fixed), every `as` cast (the only uncommented ones
are the ~15 `(err as Error).message` casts on caught values and a few one-line casts next to their checks), the five
Review Focus items (1 and 4: `tests/node-floor.test.cjs`, including real runs under Node 22.17 and 22.18; 2: the whole
suite loads every module through `require()` and passes; 3: `tests/code-rules.test.cjs`; 5: the acceptance script and
`tests/server-cli.test.cjs`), and the rule tests (each is run on a made-up file that breaks it). No Critical or Important
finding. Deferred minors: the ~15 `(err as Error).message` casts could become one helper; `source.lines as [number,
number]` in `lib/audit.mts` states a contract the runtime does not enforce (unchanged behaviour); the launcher's
node_modules message is tested through `nodeProblem`, not by running a launcher from inside a `node_modules` folder;
`tests/code-rules-lib.cjs` finds imports with regular expressions, so an unusual import form could escape it.

## Proposed spec amendments (for the owner; none applied)

- Section 11 (Dependencies and assumptions): the Node floor is 22.18 (type stripping with no flag), not "Node 22+".
- Section 10 (Repository layout): source is TypeScript ES modules (`.mts`); `cli/` holds the command adapters;
  `bin/yap.cjs` and `hooks/session-start.cjs` are plain-JavaScript launchers; `docs/ARCHITECTURE.md` exists.
