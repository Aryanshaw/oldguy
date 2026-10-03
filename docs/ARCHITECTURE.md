# Architecture

Yap is a Claude Code plugin. Claude follows the skill in `skills/yap/` and runs the `yap` command for the steps that must be exact (checking claims, timing narration, rendering, serving the finished chapters). This note says how the code is laid out and the rules that keep it that way. `tests/code-rules.test.cjs` enforces most of them.

## Layers

Each folder may import only from the folders in its row (and from itself). A layer never reaches "up".

| Folder | What lives there | May import from |
|---|---|---|
| `scene-kit/` | The small HTML/animation pieces a chapter is drawn from | itself |
| `lib/` | Pure and domain modules: the chapter folder, manifest, events, audit, narration, rendering, export, the doctor | `scene-kit/` |
| `server/` | The local web server (guard, routes, live stream, watcher glue) | `lib/`, `scene-kit/` |
| `cli/` | One adapter per `yap` command: reads arguments, calls the modules, prints one result | `lib/`, `server/` |
| `bin/`, `hooks/` | Start files: the `yap` command and the SessionStart hook | `cli/`, `lib/` |

No two files import each other in a loop (a loop breaks loading an ES module from the `.cjs` tests).

## Languages and files

- All program code is TypeScript in ES modules (`.mts`). Node 22.18 or newer runs it directly by stripping the types; nothing is built or compiled. `typescript` is a dev tool only (`npm run check` runs `tsc --noEmit`, and `npm test` runs it first).
- Only erasable TypeScript syntax is allowed (no `enum`, `namespace`, constructor parameter properties). No `any`, no `@ts-ignore`; a `@ts-expect-error` needs a reason on the same line. Parsed JSON is `unknown` and is narrowed by a check, not cast.
- Imports name their extension (`./x.mts`). Type-only imports use `import type`.
- Three files stay plain JavaScript (`.cjs`) because they must run on any Node: `bin/yap.cjs`, `hooks/session-start.cjs` and `lib/node-floor.cjs` (its types are in `lib/node-floor.d.cts`). The first two are launchers: they check the Node version and, if it is too old, print one plain sentence (`yap` exits 1, the hook exits 0 so a session still starts), then load the `.mts` file next to them. Every path the skill, the hooks, the tests and the child processes use points at the launchers and never changes.
- Tests are `.cjs` files in `tests/` (flat, named `*.test.cjs`) and load the `.mts` modules with `require()`.
- The Node floor is 22.18 because that is the first release that runs TypeScript with no flag and no warning. `yap doctor` checks it too.

## Data shapes

The shapes other code depends on are exported as types from the module that owns the data, so the future player can `import type` them and never keeps a second copy:

- `lib/manifest.mts`: `ManifestRow`, `Manifest`, `ChapterStatus`, `Quality`
- `lib/events.mts`: `ViewerEvent`, `Reply`, `ThreadEntry`
- `lib/chapter-scan.mts`: `ScannedChapter`, `ScanStatus`
- `lib/chapter.mts`: `ChapterSpec`, `ChapterSentence`, `ChapterSource`
- `lib/sse.mts`: `StreamEvent` (the four events the server streams) and their payloads
- `server/api.mts`: the request and response of every route (`MessageBody`, `ReplyBody`, `ChaptersBody`, `ExportBody`, `StateResponse`, ...)
- `server/types.mts`: what a route handler is given (`RouteContext`), the server's state, `StartOptions`, `RunningServer`

`server/contract.check.mts` holds type-only assertions on the most important ones. It is never run or imported; `npm run check` fails if a shape drifts.

## Conventions

- Anything that touches the clock, the disk, the network or another program is passed in (`deps`), so tests run nothing real.
- Comments say what a function does and why, in plain words, above every function and every non-obvious step.
- Small files with one job; named exports only.
- No runtime dependencies in any source folder. Only Node's own modules.
- No talk of what running Yap costs in any file the user can see.

## How to add

**A library module:** create `lib/<name>.mts`; export the functions and the types other code needs; write `tests/<name>.test.cjs` first; it may import only from `lib/` and `scene-kit/`.

**A route:** write the handler in `server/` taking a `RouteContext`, check every field of the body before using it, add a row to `API_ROUTES` in `server/api.mts` and its request and response types to the same file, and add tests that start a real server on port 0 (see `tests/server-api.test.cjs`). Every route sits behind the guard in `lib/http-guard.mts`; a new route needs nothing extra for that.

**A command:** create `cli/<name>.mts` exporting a `run...` function that takes the argument list and returns the exit code (print one result line; send problems to stderr), add a row to the table in `bin/yap.mts`, and describe it in `skills/yap/SKILL.md` (the skill lint checks that every `yap <command>` it mentions exists).

## Checks

- `npm run check` — the type checker.
- `npm test` — type check, then every unit and server test.
- `source spikes/env.sh && node tests/phase2-acceptance.cjs` — the real server, real ffmpeg and real HTTP (about three minutes; it starts and stops its own server).
