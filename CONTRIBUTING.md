# Contributing to Yap

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

Run the CLI straight from the checkout with `node bin/yap.cjs --help`. To try the plugin from your checkout, start
Claude Code with `--plugin-dir /path/to/yap`.

## House rules

- Nothing in Yap talks about what making a video uses up or charges.
- Every function and step has a plain-words comment above it.
- `bin/`, `lib/` and `server/` have no runtime dependencies.
- Design changes go into the spec (`docs/superpowers/specs/2026-10-02-yap-design.md`) as amendments.

## Releasing

Raise the same version in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json` and
`packages/getyap/package.json` (a test fails if they differ), merge, then `cd packages/getyap && npm publish`.
