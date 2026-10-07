# Doctor

Purpose: make sure every tool Yap needs is present before any work starts, and tell the user exactly what to fix
when something is missing. Yap installs only what the user agrees to, through `yap setup`.

## When to run it

- On the first `/yap` use in a project (the session hook prints a hint until the doctor has passed once).
- When the user types `/yap doctor`.
- After any render failure, before retrying.

## The command

```
yap doctor
yap doctor --json
yap doctor --data-dir <dir>
```

`--data-dir` is where the Python venv and the "doctor passed" marker live. Leave it out: the default is the plugin's
data folder (the session hook records it in `.yap/session.json`, which every yap command reads), or `./.yap` when
there is none. `--json` prints `{ ok, checks }` for scripts.

## What it checks

Required (any failure means stop):

| Check | Passes when |
|---|---|
| Node | version 22.18 or newer |
| ffmpeg | `ffmpeg -version` actually runs (not just exists on PATH) |
| Python venv | the venv imports `kokoro_onnx` and `soundfile` |
| Kokoro model | the voice model file is present and over 300 MB |
| Free disk | at least 1 GB free |

Notes (reported, never a failure):

| Check | Meaning |
|---|---|
| whisper-cli | present: word-level captions; absent: sentence-level captions |
| Free RAM | how many chapters will render at once |
| Chrome | Hyperframes has a browser for rendering |

## Reading the output

Each line starts with `ok`, `FAIL` or `note`. A failed line has a `fix:` line under it. Exit code 0 means every
required check passed; 1 means at least one failed; 2 means bad usage.

## What to do with a failure

1. Run `yap setup`. It lists what it can install (each item with its size and the exact programs it runs) and what
   the user has to fix by hand.
2. Show the user that list word for word and ask which items to install. Do not install anything yet.
3. After a clear yes, run `yap setup --install <only the items they agreed to>` (comma-separated, for example
   `yap setup --install voice,chrome`). It runs those items, then the doctor again.
4. For a manual item, show its `fix:` line and stop until the user says it is fixed, then run `yap doctor` again.
5. Never run a package manager or a fix line yourself.

| Item | What it installs |
|---|---|
| `voice` | a Python venv in Yap's data folder with kokoro-onnx and soundfile, and the Kokoro voice model |
| `captions` | whisper.cpp through Homebrew (macOS only; elsewhere it is manual) |
| `chrome` | the Chrome Hyperframes renders with |

**Gate:** `yap doctor` exits 0.
