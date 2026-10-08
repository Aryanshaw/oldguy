# Old Guy & New Guy

The TikTok "brainrot explainer": two characters banter over looping Minecraft parkour gameplay, and the words pop up
one at a time in the middle of the screen. On the left, **the new guy** (`newguy`): day one on the job, wild curly
hair, backwards blue cap with the price tag still on, a "HELLO my name is NEW GUY" sticker and a VISITOR badge. He
asks the dumb, problem-first questions and makes eager, confident, wrong guesses. On the right, **the old guy**: the
oldguy mascot, a chubby red-bearded dev in a "#1 DEV" cap, headset, pencil behind his ear and a "LEGACY CODE FUEL"
mug. He is the explainer: gruff, goofy and very sure of himself, he corrects the new guy with the real fact and its
file and line. The scene builds up on the board above them.

The jokes change who tells it and how it sounds, never whether it is true. Every rule in `references/teaching.md`
holds.

## Who says what

- **Every sentence has a `speaker`:** `newguy`, `oldguy` or `oldguy-laughs`. There is no narrator.
- **`oldguy` and `oldguy-laughs` are the same man in the same voice.** `oldguy` is his ordinary line (he points while
  he talks). `oldguy-laughs` shows him laughing: use it for a line that is a joke or laughs at the new guy's guess.
  At most two per chapter, never two in a row.
- **The old guy carries every claim.** Each `claim` sentence is his (either id), with its sources, as under any
  template.
- **The new guy speaks only `framing` lines:** a question, a wrong guess, a "wait, what", or the fact said back in his
  own words after the old guy has said it. He never states a fact about the code that is not then corrected or
  confirmed by the old guy's next line, and a wrong guess is never left standing at the end of a chapter.
- **The new guy speaks in at most a third of the lines.** The old guy does the teaching.

## The shape of one exchange: guess, correction, reason

1. **The new guy names the problem or makes a guess**, and the guess is a real beginner misconception, the thing a
   newcomer to this code would actually believe: "So the robot reads the whole script in one go, right." or "Easy:
   the page just waits a fixed second between lines." Never a straw man nobody would think, and never a joke guess
   that teaches nothing.
2. **The old guy corrects it with the audited fact**: what really happens, with the code name and the real value,
   cited to its file and line. Start with the plain words, then the code name ("Nope: each line is spoken on its own,
   one clip per line.").
3. **The reason, or the "So" line**: why it is built that way, or what it means for the viewer.
4. Optionally a short aside from the old guy ("Back in my day, we timed it with a stopwatch.") in its own framing
   sentence, or the new guy saying the fact back right.

A chapter opens on where the running example is now, in the first or second sentence (either speaker may say it).

**Questions and the pause.** Narrate holds three seconds after any sentence ending in "?", the viewer's quick check.
So the new guy's everyday questions and guesses end in a full stop ("Wait, so how does it know when to start."). The
one real question mark in a chapter, if any, is the old guy's what-if near the end, then the new guy's guess and the
old guy's answer with the reason.

## The voices

- **The new guy:** `am_adam` at 1.12, young and upbeat. Five to twelve words, one sentence per line (a colon or comma
  inside, never a second full stop). Eager, a bit cocky, honest when lost.
- **The old guy:** `bm_george` at 1.0, older and gruff. Tiny words, sentences of about 10 to 14 words, never over 20
  (the line cap). Calls him "kid" or "rookie", compares code to everyday things (a stopwatch, a school play, a
  lunchbox), drops an odd "back in my day". Each joke sits in its own framing sentence or half a sentence; it never
  replaces the fact and never carries a number or a code name the viewer needs. Tie it to the point when you can
  (a sip of coffee before the pause, a stopwatch before the timing); a joke about nothing costs five seconds.

Example exchange:
- newguy: "Easy: the robot reads the whole script in one breath."
- oldguy-laughs: "Ha, one breath, kid: even I stop for a sip between lines." (the joke leads into the pause)
- oldguy: "Each line is spoken on its own, one clip per line." (claim)
- oldguy: "So every line gets its own pause before the next one starts." (claim)

Not like this: "As one can observe, the asynchronous pipeline orchestrates per-sentence synthesis." (long, no picture,
nobody laughs, nobody learns).

## Captions

The words go up one at a time in the middle of the frame, big, on a yellow plate: the format's look. Write so a word
read alone still makes sense: short plain words, code names said as words ("bm_george", "line gap"). Labels in the
slot are still at most eight words and never a copy of the line being spoken.

## The slot

The board above the characters: a 1920x1080 scene scaled to about 0.57 (16:9, 1:1) or 0.53 (9:16), on near-black.
At 9:16 that halves every size, so draw big: labels 44 px or more, numbers 56 px, code 40 px.

- **One designed scene per chapter** (`design` piece), the same parts in every chapter, so the viewer learns them once:
  the header, the four lanes of the flow along the top (the one we are at lit, the ones passed ticked), the running
  example on its yellow card, and a code chip along the bottom.
- **The new guy's guess is a card in his colours** (blue, a lime "NEW GUY'S GUESS" tag). When the old guy corrects
  it, it is struck through and stamped NOPE, and it stays crossed out until the board needs the space.
- **The old guy's props carry the numbers, never decorate.** His stopwatch reads each time as he says it; his
  LEGACY CODE FUEL mug drains while a pause lasts. Draw them as shapes in the scene (scenes cannot load pictures).
  A prop that carries no value stays off the board.
- **Draw the mechanism, keep it on screen.** When a chapter is about time, draw one track in seconds with each clip
  at its real start and end and the pause shaded between them, keep it for the whole chapter, and move things on it
  for the what-if (stretch the gap, slide the clip). Point at the template's own parts when they prove a point: the
  speakers below ("↓ new guy, old guy ↓"), the big word caption ("like the big word below").
- **Code is a chip, never a cut-away.** At most two real lines, with their line numbers, and a "⋮" row where lines
  are skipped. The board never disappears behind code.
- **A value the old guy quotes from the video itself** (a time from this video's own timing record) is said as such
  ("the new guy's question, the very start of this video, ends at 3.05 seconds").

At most about seven things on screen. The template draws the characters, the gameplay, the captions and the source
chips; never draw them in the slot.

**Gate:** every sentence has a `speaker`, every claim is the old guy's, each new-guy guess is a real misconception corrected in the next old-guy line or two with a cited fact, `oldguy lesson` prints `lesson ok`, and each chapter aims for 25 to 50 seconds.
