# Spike 1: `claude -p --resume` as the fallback bridge

## Question
When no live Claude session is listening, can the Yap server answer a queued chat message by
resuming the original session headlessly, without damaging it and at an acceptable cost?

## Method
`spikes/01-resume/run.sh` plus follow-up commands (throwaway temp folders). Start a session
with `claude -p ... --output-format json`, read `session_id`, then resume it three ways: same
folder, `--fork-session`, and from a different folder. Check the original transcript file
(`~/.claude/projects/<folder>/<id>.jsonl`) by hash and line count before and after. Then resume
a real 482 KB session with `--fork-session --max-budget-usd 1.5 "Say OK."` to measure cost.

## Machine
Apple M3, 8 GB (see `ENV.md`). Claude Code 2.1.287. The owner's account has many plugins and
skills installed, which inflates the fixed prompt that every headless call re-sends.

## Result
**PARTIAL.** It works, and a fork is safe. It is expensive, and it needs two precautions.

## Evidence
| Check | Result |
|---|---|
| `claude -p ... --output-format json` returns `session_id` | yes (also `total_cost_usd`, `usage`) |
| `--resume <id>` recalls earlier context | yes ("KIWI"), same `session_id` returned |
| Plain resume writes to the **original** transcript | yes: 57 to 72 lines, 72 to 91 on the next resume |
| `--resume <id> --fork-session` | new `session_id`, recalls "KIWI", **original file unchanged** (72 lines, same hash) |
| Resume from a **different folder** | works (finds the session by id, appends to the original transcript) |
| `claude -p` with no stdin | prints "no stdin data received in 3s" on stderr and waits 3 s; **spawn with `</dev/null`**. With `2>&1` this warning also breaks JSON parsing (it did, twice) |
| Fixed cost of one headless call, empty session | about 0.12 USD (about 29k to 35k tokens of cache creation) |
| Resume a 482 KB session with a cold cache | **1.38 USD** for "Say OK." (83k cache-creation tokens, 0 cache-read) |
| Live session can learn its own id | no env var carries it (`CLAUDE_CODE_BRIDGE_SESSION_ID` is a different, remote id). The newest `.jsonl` in the project folder matched this live session's id, which is also embedded in the session's scratchpad path. A `SessionStart` hook receives `session_id` (to be confirmed in spike 5). |

Not done: a live concurrent test against an idle interactive session. It is not needed: a plain
resume appends to the original file (shown above), so it would interleave with a live writer;
a fork never touches it (shown above).

## Consequence
Spec section 4.5 (the fallback) changes to:
- Command: `claude -p --resume <id> --fork-session --max-budget-usd <cap> "<message>" --output-format json </dev/null`
  run from any folder. Never a plain resume while a live session may be using that id.
- The fallback is **opt-in and shows its cost**: a cold resume of a mid-size session cost
  about 1.4 USD per message, and a fork starts cold every time. The player should say
  "Claude isn't connected: reconnect (free) or answer once headlessly (about X USD)".
- The session id comes from a `SessionStart` hook if spike 5 confirms it, else from the newest
  transcript in the project folder, else the user is asked to run `/yap resume`.
- Follow-up: measure whether replying to the *fork's own* id (a warm cache) is cheap enough to
  make a multi-message headless conversation viable (hypothesis, not tested).
