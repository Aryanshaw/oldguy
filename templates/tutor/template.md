# Old Guy Tutor

Two characters on screen, drawn from the oldguy brand kit. On the left, **the new guy** (`newguy`): day one on the
job, curly hair, backwards blue cap, a "HELLO my name is NEW GUY" sticker, keen and a little lost, never afraid to ask
the dumb question everyone else is thinking. On the right, **the old guy**: the oldguy mascot himself, a chubby
red-bearded grandpa-dev in a "#1 DEV" cap, headset mic, pencil behind his ear, sunflower tee, sandals and a
"LEGACY CODE FUEL" mug, who has seen every bug since 1987. The new guy asks; the old guy explains, like he is talking
to a ten-year-old. The scene builds up on the board between them; the room around it holds a few of his props (the mug,
the cap, the pencil), small and off the board.

## Who says what

- **Every sentence has a `speaker`:** `newguy`, `oldguy` or `oldguy-laughs`. There is no narrator.
- **`oldguy` and `oldguy-laughs` are the same man in the same voice.** Use `oldguy` for his ordinary lines (he thinks
  with his mug between lines and points while he talks). Use `oldguy-laughs` for a line that is a joke or that laughs
  at one: it shows him laughing. At most two `oldguy-laughs` lines per chapter, never two in a row.
- **The old guy carries every claim.** Each `claim` sentence is his (either id), with its sources, exactly as under
  any template.
- **The new guy speaks only `framing` lines:** a question, a guess, a "wait, what", a joke, or saying back what he just
  learned in his own words. He never states a fact about the code. If a fact must be said back, the old guy says it.
- **The new guy speaks in at most a third of the lines.** The old guy does the teaching.

## The shape of one exchange

1. The new guy asks the dumb question, plainly: "Okay, dumb question: which line are we even following."
2. The old guy answers with an everyday comparison first, then the real thing with its code name and real value.
3. The old guy says the "So" line: what this means for the new guy (and the viewer).
4. Optionally the new guy says it back, wrong or half right, and the old guy fixes it in one line.

A chapter opens on where the running example is now, in the first or second sentence (either speaker may say it).

**Questions and the pause.** Narrate holds three seconds after any sentence that ends in "?". That hold is for the
viewer's quick check, so:
- the new guy's everyday questions end in a full stop, written as statements ("Okay, so how does it know when to
  start." or "I still don't get the pause thing.");
- the one real question mark in a chapter, if any, is the old guy's quick check near the end ("Quick one, kiddo: if
  my pause were 1000 milliseconds, when would our line start?"), followed by the new guy's guess and the old guy's
  answer with the reason.

## The old guy's voice

Goofy, yappy, very sure of himself, warm. Tiny words. Short sentences, about 10 to 14 words, never more than 20 (the
template's line cap). He compares code to everyday things a kid knows: a recipe, a lunchbox, a stopwatch, a TV remote,
a school play. He drops a joke or an aside about the old days, but each one is short and sits in its own framing
sentence (often an `oldguy-laughs` line) or in half a sentence; it never replaces the fact, and never carries a number
or a code name the viewer needs.

Example lines:
- "Back in my day, we had one voice, and it was mine." (`oldguy-laughs`)
- "Think of a template like a lunchbox: same sandwich, different box."
- "The template says my voice is `bm_george`, at a speed of 0.97."
- "Each line is said on its own, like kids taking turns in a school play."
- "So the page never guesses: it listens to the sound and counts."
- "Trust me, kiddo, I have seen that bug since 1987." (one "1987" or "back in my day" joke per chapter at most,
  and no more than two in the whole video; the rest of the fun comes from his comparisons and the new guy's questions)
- "Heh, like a stopwatch that never blinks, and never naps." (`oldguy-laughs`)

Not like this: "As one can observe, the asynchronous pipeline orchestrates per-sentence synthesis." (long, no picture,
no kid could follow it).

## The new guy's voice

Short, eager, honest. Five to twelve words, one sentence per line (a colon or comma, never a second full stop). He asks what a beginner would really ask, sometimes guesses wrong, and
sometimes teases the old guy (who then laughs).
- "Okay, dumb question: what even is a template."
- "So it just waits a bit after each line."
- "Makes sense, you've been right since 1987."

## Teaching still holds

Every rule in `references/teaching.md` holds: one running example followed through and named in full early in each
chapter, a "So" line in every chapter (the old guy's), real values from the code or a real run, code on screen in at
least half the chapters, a what-if quick check near the end, and a closing recap line of at most twelve words. Jokes
are extra, never instead.

## The slot

The board between the characters: a 1920x1080 scene scaled down (to about 0.72 in 16:9, about 0.54 in 9:16 and 0.71
in 1:1), drawn on near-black. The stage makes the kit's labels and code bigger, lights code lines near-black on
yellow, and draws an arrow between neighbouring flow lanes. Build it from the ready pieces:

- **The map:** a `flow` with the same lanes in every chapter, in the order the example travels (so the arrows are the
  hand-offs). Each sentence adds one step; keep every value in the lane where it lives (a speed is part of the voice,
  not the timing).
- **Show a setting by changing it:** early on, put the same example through two settings as two steps in the same
  lane (another template's value, then this one's), and say what stays the same.
- **Code:** a `code-card` replaces the map while it is up (pieces play one after another), so give it one or two
  sentences, not more. Those sentences cite exactly the lines the card shows, so the source chip and the card agree,
  and the old guy says what the lit line does. Then the map comes back with everything it held.
- **Derive numbers from the video itself** when you can (a time from its own opening), and say where they come from.
- Keep it big and simple: at most six things in a lane, labels short. The template draws the characters, the props
  and the source chips itself; never draw them in the scene.

**Gate:** every sentence has a `speaker` (`newguy`, `oldguy` or `oldguy-laughs`), every claim is the old guy's, the new guy speaks in at most a third of the lines, no line is over 20 words, only the quick check ends in "?", and each chapter aims for 30 to 60 seconds.
