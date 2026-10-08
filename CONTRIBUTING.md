# Contributing to oldguy

Issues and pull requests are welcome. Start with [docs/STATUS.md](docs/STATUS.md) (what is built, what is open) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the code is laid out, and the rules the tests enforce).

## Setup

```
npm ci
npm test                    # type check, then every test in tests/

cd player
npm ci
npm test                    # player unit tests
npm run typecheck
npm run build               # player/dist is committed: rebuild it after player changes
npm run check:dist          # confirms player/dist matches a fresh build
```

Run the CLI straight from the checkout with `node bin/oldguy.cjs --help`. To try the plugin from your checkout, start
Claude Code with `--plugin-dir /path/to/oldguy`.

## House rules

- Nothing in oldguy talks about what making a video uses up or charges.
- Every function and step has a plain-words comment above it.
- `bin/`, `lib/` and `server/` have no runtime dependencies.
- Design changes go into the spec (`docs/superpowers/specs/2026-10-02-yap-design.md`) as amendments.

## Adding a template

Video templates live in `templates/<id>/`: `template.json`, `template.md`, `stage.html` and small assets. A template
changes how an explanation is told (voices, characters, layout, pace), never what is checked. The engine does all
the timing, so a template is data and layout only. The repo-only skill `.claude/skills/new-template/` walks through
it. In short: scaffold the folder, try it with `OLDGUY_TEMPLATES_DIR=$PWD/templates node bin/oldguy.cjs templates <id> --show`,
keep `npm test` green (`tests/templates-shipped.test.cjs` checks every shipped template), render a chapter in every shape
it lists with `hyperframes check` passing, and add a `sample.mp4`. Big media goes in a GitHub Release with its sha256
and size in `template.json`. The design is `docs/superpowers/specs/2026-10-07-video-templates-design.md`.

## Releasing

Raise the same version in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json` and
`packages/oldguy/package.json` (a test fails if they differ), merge, then `cd packages/oldguy && npm publish`.
