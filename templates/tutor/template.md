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

**The first chapter says the promise.** Within its first three sentences the old guy says what the thing being taught
makes and what one thing the video follows through it ("The engine turns a written script into a narrated video; we
follow that one line."), so the example never sounds like a random sentence. The map's kicker says the same from the
first frame (`Template engine · script → narrated video`).

**Each chapter adds one new step.** Never say again what an earlier chapter already claimed (who stands where, that
the page lights the speaker); a chapter that only repeats is folded into its neighbour. The last stop gets its own
mechanism, with its own code, like every other stop.

**Follow a setting through.** When a chapter sets a value (a speed, a pause), a later sentence says what it changes
downstream ("a slower voice would push that end later, not this start"), so no setting is a dead end.

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
- "My voice is called George, written `bm_george` in the template, at a speed of 0.97."
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
in 1:1), drawn on near-black. Draw every chapter with the map scene, `examples/map.mjs` in this folder: it writes a
`design` scene file (`{"piece": "design", "params": {"file": "scenes/<id>.html"}, "beat": 0}`), and
`examples/sample-make.mjs` is the whole sample video built on it (script, sources, specs and scenes).

- **The map never goes away.** Four lanes on top, the same in every chapter and in the order the example travels
  (the arrows are the hand-offs), drawn empty first. Each sentence adds one card and nothing is replaced: the newest
  card glows, older ones dim. Every card takes its lane's colour. Keep every value in the lane where it lives (a speed
  is part of the voice, not the timing). A chapter reopens the map with the stops already passed as one dimmed card
  each, and those cards keep the numbers a later question needs (`starts 3.77 s` over `3.22 s + 550 ms`).
- **The band zooms into one lane.** Under the lanes, a band points up at the lane it is about and shows one thing at
  a time: real code, a record's rows, two settings side by side, or the what-if. Code never covers the map.
- **Code in the band:** two to four whole, neighbouring lines, read from the file (`lineAt`), never typed. Light a
  line on the sentence that says what it does, then move the light to the next line on its sentence. Every name on a
  shown line is either said ("each gap adds silent frames") or drawn faint (`lineAt(..., key, mute)`, the line stays
  whole); never skip a line between two shown ones. A line too long for the band is wrapped under itself (panel
  `size` 30 to 34), never cut.
- **No value before its sentence, in the code too:** a panel shows only lines whose values are already said. When the
  next value sits a few lines down, give it its own panel on its own sentence (the speed panel, then the pause panel),
  instead of showing the whole block early.
- **The chip and the band agree:** on a claim, the band shows the file its source chip names (or a record drawn from
  it). When the voice moves to another file, the band moves too; a "So" line that only says what it means is a
  `framing` line with no chip.
- **Show a setting by changing it:** early on, put the two settings side by side in the band (another template, then
  this one), one row per choice, and end on what stays the same (a row where both columns say our line).
- **Plain name first, then the code name:** "a voice called George", and `bm_george` only where the code shows it.
  At most three new terms per chapter, counting every code name visible on screen and every new proper name (a voice,
  a template, a role like "narrator"); a name that never comes back is left out.
- **Define a term by what it is, correctly, the first time:** "frames, tiny slices of audio; each gap adds silent
  frames", never "frames, tiny slices of silence" when the next sentence counts every frame. Rename a term that clashes
  with something the viewer already knows (audio frames are not video frames), or say which one it is.
- **Derive numbers from the video itself** when you can (a time from its own opening), say where they come from
  ("this video's timing record"), and draw the record as rows when the voice names it.
- **The quick check is answerable from the screen:** during the question and its three-second hold, every number the
  answer needs is on the map (light that card again) and in the band, with a `?` where the answer goes; the answer
  takes the `?`'s place on the sentence that says it.
- **The recap lights the map:** light one card per phrase of the closing line ("who talks, how fast, and where they
  stand"), each on the moment its phrase is said (from the chapter's own timing record), so the summary points at what
  the viewer saw, the last lane included.
- **Sources:** cite one source per claim, so the chip under the board stays one short `file:line`. The stage crops a
  long path from the left, so the chip always ends on the file name and line. When a chip names a record rather than
  code (a `beats.json`), the voice says so ("this video's timing record") and quotes the line it reads from.
- Keep it big and simple: at most four cards in a lane, labels of two to five words, and a card's grey detail at
  least 28 px on the 1920 board (readable at 720p) or no detail at all. The template draws the
  characters, the props and the source chips itself; never draw them in the scene.

**Gate:** every sentence has a `speaker` (`newguy`, `oldguy` or `oldguy-laughs`), every claim is the old guy's, the new guy speaks in at most a third of the lines, no line is over 20 words, only the quick check ends in "?", and each chapter aims for 30 to 60 seconds.
