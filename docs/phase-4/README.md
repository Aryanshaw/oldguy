# Phase 4: the chat bridge

Phase 4 makes the player's Chat tab answer. A question typed in the page wakes the Claude Code session that made
the video (`yap listen` under Claude Code's Monitor tool), Claude answers in text with sources, and offers a
"Make this a video" button only when a chapter would help. A click builds the chapter in a background subagent
while the chat stays responsive. The Yap server lives only as long as that Claude Code session.

## Documents

- Spec: [`../superpowers/specs/2026-10-07-phase-4-chat-bridge-design.md`](../superpowers/specs/2026-10-07-phase-4-chat-bridge-design.md).
- Parent spec: [`../superpowers/specs/2026-10-02-yap-design.md`](../superpowers/specs/2026-10-02-yap-design.md), section 16 holds the Phase 4 amendments A18 to A21.
- Phase 3 hand-over: [`../phase-3/SUMMARY.md`](../phase-3/SUMMARY.md) section 6.
