# Doctor

Purpose: make sure every tool Yap needs is present before any work starts, and tell the user exactly what to fix
when something is missing. Yap never installs anything itself.

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
| Node | version 22 or newer |
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

1. Show the user the failed check and its `fix:` line, word for word.
2. Stop. Do not run the fix yourself, do not install packages, do not download models.
3. When the user says it is fixed, run `yap doctor` again.

**Gate:** `yap doctor` exits 0.
