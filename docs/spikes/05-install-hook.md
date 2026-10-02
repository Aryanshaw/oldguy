# Spike 5: is there an install-time hook for the doctor?

## Question
Can a Claude Code plugin run a command when it is installed? If not, what is the best moment to run the
doctor, and what can a hook tell us (for example the session id needed by spike 1)?

## Method
1. Asked the `claude-code-guide` agent for the documented hook events and install-time behaviour.
2. Read a real plugin: `brag` (`.claude-plugin/plugin.json`, no hooks) and `claude-video/watch`
   (`hooks/hooks.json`, a `SessionStart` setup check).
3. **Tested it for real:** a throwaway plugin (`spikes/05-install-hook/plugin/`) with a `SessionStart`
   command hook that logs its stdin JSON and environment, loaded with `claude -p --plugin-dir <path>`,
   then a second run with `--resume`.

## Machine
Claude Code 2.1.287 on macOS (see `ENV.md`).

## Result
**PARTIAL.** No install-time hook exists (none documented, none observed). A `SessionStart` hook works well and gives
more than the docs the agent found claim.

## Evidence
- The guide agent found **no documented install-time hook** and no documented stdin schema; the doc page it cited
  lists events under a different, newer "mods" API. Its "not documented" answers were therefore not relied on
  for items 3 to 5; the real test replaced them.
- `brag` declares **no hooks at all**; its setup happens inside `SKILL.md` (the first-run Hyperframes skills
  install seen in the owner's chat history). `watch` uses `hooks/hooks.json` with a `SessionStart` command,
  `bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/check-setup.sh`, timeout 5 s, that prints a "run setup once" hint.
- **Real test, first start:** the hook ran once and received on stdin
  `{"session_id":"a4d42837-...","transcript_path":"/Users/.../.claude/projects/<folder>/<id>.jsonl","cwd":"...","hook_event_name":"SessionStart","source":"startup"}`.
  Environment: `CLAUDE_PLUGIN_ROOT` (the plugin folder), `CLAUDE_PLUGIN_DATA`
  (`~/.claude/plugins/data/<plugin>/`, persistent per plugin), `CLAUDE_PROJECT_DIR` (the project folder).
- **Resume:** the same hook fired again with `"source":"resume"` and the same `session_id`.
- Not tested: plugins distributed only through `npx skills add` (no `plugin.json`): hooks are almost certainly
  not available there.

## Consequence
- Spec section 5.1 (doctor): there is no install-time hook, so the doctor runs from a **`SessionStart` hook** in
  `hooks/hooks.json` (fast, under 5 s): it checks a marker file in `${CLAUDE_PLUGIN_DATA}` and only prints a
  one-line "run `/yap doctor`" hint until the full doctor has passed; the full doctor (Node, Hyperframes,
  ffmpeg, Python venv, Kokoro) runs from `/yap doctor` and on first use of `/yap`, and re-runs after a render
  failure. For the `npx skills add` route, the doctor runs on first use of `/yap` only.
- **Resolves spike 1's open item:** the same hook can write `{session_id, transcript_path, cwd}` to
  `.yap/session.json` on every `startup` and `resume`, so the server always knows the live session id for the
  headless fallback, with no "newest transcript" guessing.
- Spec section 10 (repo layout): add `hooks/hooks.json` and `hooks/session-start.sh`.
- README: recommend the **plugin** install (`/plugin install`) over `npx skills add`, because only the plugin route can run hooks.
