# Spike 7: Monitor over a long idle

## Question
Does a Monitor watching an events file keep working across a long idle, wake Claude on a new line, and
cost nothing while idle? Does it survive laptop sleep?

## Method
Claude Code's Monitor tool running `tail -F spikes/07-monitor-idle/events.jsonl`. (1) Read the tool's own
schema for lifetime limits. (2) Append a line while Claude is mid-turn. (3) Let a Monitor run past its
timeout and see what happens. (4) End the turn (go idle), then append a line 4 minutes later from a
background timer, and see whether Claude is woken.

## Machine
Apple M3 (see `ENV.md`). Interactive Claude Code session.

## Result
**PARTIAL.** Waking Claude from idle works and is immediate. A Monitor cannot live longer than 30 minutes, so
the bridge needs a re-arm loop. The 35-minute idle and the laptop-sleep tests could not be run as written.

## Evidence
- **Lifetime limits (from the tool schema):** every Monitor expires after `timeout_ms`; default 5 minutes,
  and "deadlines above 1,800,000 ms are capped to 1,800,000 ms" (30 minutes). At expiry Claude gets one
  notice and "can re-arm". There is also a `ws` source (open a WebSocket; each text frame is an event).
- **Mid-turn event:** a line appended at 16:34:39Z reached Claude with the very next tool result.
- **Expiry observed:** a Monitor armed at 16:34:36Z with the 30-minute maximum ended with
  `Monitor expired after 30m with 1 event delivered. Re-arm it if you still need the watch.`
- **Wake from idle, twice:** after the turn ended, (a) a re-armed Monitor started a new turn **12 s** later
  (it replayed an old line, see below), and (b) a line appended at **17:27:26Z** by a background timer 4
  minutes after the turn ended started a new turn at about 17:27:27Z, i.e. **about 1 s**.
- **`tail -F` replays the last 10 lines when it starts**, so a re-armed listener sees old events again.
  `tail -n 0 -F` avoids that.
- **Cost:** each wake is a full model turn (Claude re-reads its context). The session's token counter
  moved by about 1.8k tokens for one wake turn here; the real dollar cost depends on how much of the
  context is cached and was not measured. An *idle* Monitor with no event does not wake Claude, but the
  30-minute expiry notice does, so an open player costs one small turn every 30 minutes.
- **Not run:** the 35-minute single-Monitor idle (impossible: the cap is 30 minutes, so the expiry test above
  stands in for it) and the laptop-sleep test (needs the lid closed; the owner was away).

## Consequence
Spec section 4.5 (the bridge) changes to:
- The listener is `yap listen`, which tails with `tail -n 0 -F` (or reads from the last acknowledged event
  id), run under Monitor with `timeout_ms` 1,800,000.
- **Re-arm loop:** the skill re-arms the Monitor every time the expiry notice arrives. Events written during
  the short gap between expiry and re-arm must not be lost: every event has an `id` (section 4.4), the
  listener resumes from the last id Claude acknowledged, and Claude replays any unacknowledged lines.
- Replace "idle cost is zero" with "one small turn per 30 minutes while the player is open, plus one turn per
  question".
- Consider the Monitor `ws` source: the server pushes events over a WebSocket, so there is no file tail and no
  replay problem; it expires on the same 30-minute cap, so the re-arm loop is still needed. Decide in Phase 4.
- Laptop sleep: untested; the heartbeat (section 4.5) already tells the player "Claude isn't connected" if the
  Monitor is gone. Test it with the owner present before Phase 4.
