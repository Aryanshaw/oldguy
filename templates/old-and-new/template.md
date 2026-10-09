# Old Guy & New Guy

The TikTok "brainrot explainer", tuned so the board does the teaching: two characters banter under one big board,
over looping Minecraft parkour gameplay (the owner's call: the moving footage is the format). The board is the biggest thing on screen (about three
quarters of the frame at 16:9, the full width at 9:16); the characters are small speaker icons under it, and the big
word under the board flashes only the values and code names the voice says. On the left, **the new guy** (`newguy`): day one on the job, wild curly
hair, backwards blue cap with the price tag still on, a "HELLO my name is NEW GUY" sticker and a VISITOR badge. He
asks the dumb, problem-first questions and makes eager, confident, wrong guesses. On the right, **the old guy**: the
oldguy mascot, a chubby red-bearded dev in a "#1 DEV" cap, headset, pencil behind his ear and a "LEGACY CODE FUEL"
mug. He is the explainer: gruff, goofy and very sure of himself, he corrects the new guy with the real fact and its
file and line. The scene builds up on the board above them.

The footage keeps moving, at normal speed, but it never competes with the board: the stage darkens, desaturates and
softly blurs it, and the board is opaque, so the gameplay shows only around the board. Everything else on screen moves
only when it teaches: no props, no filler words, no source chips (the board's code card names its file and line).

The jokes change who tells it and how it sounds, never whether it is true. Every rule in `references/teaching.md`
holds.

## Who says what

- **Every sentence has a `speaker`:** `newguy`, `oldguy` or `oldguy-laughs`. Two characters, no narrator.
- **`oldguy` and `oldguy-laughs` are the same man in the same voice.** `oldguy` is his ordinary line (he points while
  he talks). `oldguy-laughs` shows him laughing: use it for a line that is a joke or laughs at the new guy's guess.
  At most two per chapter, never two in a row.
- **The old guy carries every claim.** Each `claim` sentence is his (either id), with its sources, as under any
  template.
- **The new guy speaks only `framing` lines:** a question, a wrong guess, a "wait, what", or the fact said back in his
  own words after the old guy has said it. He never states a fact about the code that is not then corrected or
  confirmed by the old guy's next line, and a wrong guess is never left standing at the end of a chapter.
- **The new guy speaks in at most a third of the lines.** The old guy does the teaching.
- **Show a setting by changing it.** When the topic is something configurable, the old guy replays the running
  example once under the other setting ("Nope, watch the plain explainer say it: your todo is saved."), word for word
  as he first said it; then he names what changed (with sources) and a "So" line says what stayed.

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

**The promise, in the first ten seconds.** Right after the running example is first said, one framing sentence
names every stop the video follows ("We follow it through four stops: script, voice, timing and page."), and each
stop lights on the board's map at the word that names it.

**The first chapter is short: one line, four stops.** It names the running example, promises the stops and corrects
one guess; anything else (what a template is, which settings exist) gets at most one line there, because a first-time
viewer has nothing to hang it on yet.

**Before and after, early.** When the video is about a setting (a template, a flag, a policy), the first chapter
plays the running example under two settings: the old guy's line, then his replay under the other setting, with the
board showing the two columns side by side: the same words on top, the settings that differ below.
**Compare only what the replay shows.** The replay is spoken inside this video, by this template's voices and with
its pauses: never name the other template's pause, voice or speed after it as if the viewer just heard it. Compare what the viewer
sees and hears (who talks, where), or draw the other value as a bar and say it is that template's setting in its own
videos. **One sentence fills at most two cells** (or two values on the board): "who and where" is one sentence, the
pace another.

**Every term is defined the first time it is said**, in half a sentence ("one clip, a little sound, per line"), and the
name the voice says is the name on the board ("timing record (beats.json)", not just `beats.json`). A value is said
with what it means ("speed 0.95, a touch slower than normal") or left out; a setting nobody explains is noise. At most three new
terms a chapter and one a sentence; move a value the next chapter needs into an earlier chapter's before-and-after
when a chapter would bring in more.

**Plain words for a word that means something else.** When the code's name for a thing is an everyday word with
another meaning (`frames`, which a viewer hears as video frames), say the plain words with it and tell them apart
once: "it counts frames, audio samples, 24,000 every second, not video frames". The board shows the definition
("frame = one sample per channel"), the rate as a label as well as aloud ("24,000 every second"), and "not video
frames" once.

**A setting is introduced as a setting.** The first time the template's own numbers come up, one sentence says what
they are ("these two numbers are template settings: speed and gap"), each wears a SETTING tag, and each is drawn as
a dial with its value and what turning it does to the running example ("speed 0.95 → a longer clip", "gap 520 ms →
a later start"). Say once what the value means on its scale ("0.95 is below 1, so slower"). Show the settings' whole
block of lines from the file, nothing skipped: a "⋮" in the middle of the lines being explained hides how they sit
together.

**Code the voice explains.** A code line goes on the board only when a sentence says what it does in plain words
("each start is the frames so far, divided by the sample rate"), and its key words are lit on that sentence. **The lit
word is the spoken word**: say "frames" when the code says `frames`, "used, out of the total" when it says
`used / total`; never light `frames` while saying "samples". A line nobody explains stays off the board, even when
it is the real source.

**Every number on screen feeds the running example.** A viewer keeps the numbers that build one timeline (when the
line starts, how long it lasts, where each word falls) and loses the rest. A side rule with its own number (the
longer pause after a "So" line, a regex) is cut, or said in one aside without a number on the board. A setting's
value stays only when it is tied to the example ("speed 0.95, a touch slow, so the clip runs longer"), and never in a
chapter about time where the viewer would try to add it up.

**A formula gets its real numbers plugged in.** When a step computes something ("each start is the frames so far,
divided by the sample rate"), show it once with this video's own values, read from its narration wav or its timing
record and cited: "68,030 ÷ 24,000 = 2.835 s". Define each term of it in half a sentence ("frames, audio samples,
24,000 every second"). A formula with no numbers in it teaches the names, not the step. **Put the number on the thing
it measures** (the new guy's bar reads "his clip = 68,030 samples"), and work the sum out in large type (92 px) in
the board's empty space, at 9:16 the lower half under the track, one term a row ("68,030 samples", "÷ 24,000 per
second", "= 2.835 s"), each row at the word that says it and **held for the whole sentence**; fold it into one small
row when the next step needs the space.

**A record is a row.** When the step hands over a record, draw it as one row of a table with its columns named
("LINE · START · END": "Your todo is saved." · 3.355 · 5.168), the values as the record keeps them, captioned with the
file and its lines. **Round once, aloud**: when the board shows fewer places than the record, one sentence says it
("rounded, 3.355 is 3.36") and the cell shows it ("3.355 → 3.36"); every later sum uses the rounded values.

**One clock per chapter.** A chapter's times all come from one timeline, drawn once. Never quote a pause from this
chapter's own audio ("your line just got 520 ms") while the board shows another chapter's clock: the viewer
cannot place it.

**Derive every number.** A derived value is worked out on the board as a sum on the sentence that says it
("2.835 s + 520 ms = 3.355 s", "5.17 − 3.36 = 1.81 s"). A rule ("each word gets its share of the letters") is drawn
with its real values, not only named: the letter counts as they add up ("4+4+2+6 = 16"), and every slice's real start
and end on the bar. **Work a rule out on two items, so its variable reads**: one item alone makes `used` look like a
constant; "Your: 3.36 + 0/16 × 1.81 = 3.36" next to "todo: 3.36 + 4/16 × 1.81 = 3.81", with "used 0" and "used 4"
under the slices and the label "used = letters before this word", shows what it counts. Shown sums must add up as shown, to two decimals:
compute in whole milliseconds and check the board's arithmetic before narrating.

**Questions and the pause.** Narrate holds three seconds after any sentence ending in "?", the viewer's quick check.
So the new guy's everyday questions and guesses end in a full stop ("Wait, so how does it know when to start."). The
one real question mark in a chapter, if any, is the old guy's what-if near the end, then the new guy's guess and the
old guy's answer with the reason. **The answer names every consequence** the board can show, not only the first: if
the pause grows, the line starts later, its end moves with it, and every word slice slides by the same amount ("So it
starts at 3.84, ends at 5.65, and every word slides 0.48 later"), each appearing on the board as it is said.
**Every step of the answer is its own sum**: the change itself first ("1000 − 520 = 480 ms"), then what it moves
("3.36 + 0.48 = 3.84", "5.17 + 0.48 = 5.65"). **Say what stays the same**, aloud and on the board ("the clip stays
1.81 seconds, and each word keeps its share of the letters"). When two settings shape the example, **give the other
setting its own what-if row**: the bar redrawn under the first one (a slower speed: the clip longer, its end and
slices stretched, the start still 3.36), with the reason said ("the start depends only on the line before it, and
the pause"). A what-if row's value nobody computed is drawn, not numbered ("end later →", "was 5.17").
**The quick check gets its own chapter** when the words chapter would pass eight sentences: the question, the guess,
the steps, what stays, the second row, the recap.

## The voices

- **The new guy:** `am_adam` at 1.05, young and upbeat. Five to twelve words, one sentence per line (a colon or comma
  inside, never a second full stop). Eager, a bit cocky, honest when lost.
- **The old guy:** `bm_george` at 0.95, older, slower and gruff. Tiny words, sentences of about 10 to 14 words, never over 20
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

Pace: aim for 140 to 160 words a minute over a chapter and at most 170 inside speech; the speeds above and the 520 ms
pause (1040 ms after a "So" line, at least 3 s after a question) give that when lines stay short.

## Captions

The big word on its yellow plate under the board shows **only values and code names**: a spoken word with a digit,
an underscore or a dot inside (520, 3.57, bm_george, beats.json). The stage hides every other word, so filler never
flashes. Say values as digits and code names as written so they show. Labels in the slot are still at most eight
words and never a copy of the line being spoken.

## The slot

The board above the characters: a 1920x1080 scene scaled to about 0.74 (16:9), 0.73 (1:1) or 0.54 (9:16), on
near-black; at 9:16 it spans the frame's width (at least 70% of it, always). A 1080 px frame shows on a phone about
390 px wide, so one stage pixel is about 0.2 phone pixels at 9:16. Draw big: labels 48 px or more, numbers 64 px,
and **code 72 px or more** (about 14 px on a phone) on a card nearly the stage's width. At 72 px a card row holds
about 41 characters: when a line with its number would not fit, drop the line-number column and name the line in the
card's label; when the line alone would not fit, wrap it onto a second, indented row at a space (whole lines, never
cut short). Never shrink the code to fit. No small kicker line: the title and the map are the header.

- **One designed scene per chapter** (`design` piece), the same parts in every chapter, so the viewer learns them once:
  the header (the chapter title, and the four stops of the flow joined by arrows: the one we are at lit, the ones
  passed ticked), the running example on its yellow card, and a code card along the bottom labelled with a short
  file name and its line numbers.
- **Hand-offs are arrows, and the end is the whole flow.** A chapter ends on its hand-off to the next stop, drawn on
  the board ("TIMING → PAGE 3.36 – 5.17"), so the frame held at the chapter break is full, never a blank board. The
  last sentence of the video draws every stage in one row joined by arrows, the running example travelling through
  them, **each stage box filled with its number** as the recap says it: a recap box with only a word in it repeats
  the voice. **File each number under the stop that makes it**: Script 16 letters; Voice the settings, speed 0.95 and
  gap 520 ms; Timing the 3.36 s start, the 1.81 s length and the 5.17 s end; Page the 4 word slices. A number under
  the wrong stop teaches the wrong map.
- **The new guy's guess is a card in his colours** (blue, a lime "NEW GUY'S GUESS" tag). When the old guy corrects
  it, it is struck through and stamped NOPE, and it stays crossed out until the board needs the space.
- **No props on the board.** The track already shows every time; a stopwatch or a mug that repeats a value is one
  more thing to read. Draw a prop only when it carries a value the board shows nowhere else.
- **Draw the mechanism, keep it on screen.** When a chapter is about time, draw one track in seconds with each clip
  at its real start and end and the pause shaded between them, keep it for the whole chapter, and move things on it
  for the what-if (stretch the gap, slide the clip). Point at the template's own parts when they prove a point: the
  speakers below ("↓ new guy, old guy ↓"), a value in the big word ("like the 3.57 below").
- **The quick check hides its answer, but has its own picture.** While the question's three-second pause runs, the
  board shows the change (the gap stretched to its new length, labelled "1000 ms", and our line as a dashed "?" after
  it), never an empty board and never the result; the result slides in on the sentence that says it, worked out as a
  sum.
- **A highlight follows what is heard, word by word.** A value, a cell, a lit code word or a quick-check answer
  appears at the spoken word that names it, not at the start of its sentence: place it at the engine's own estimate
  of when that word is said (`beat(n) + share × (line end − beat(n))`, the share being the letters before the word,
  as `lib/word-times.mts` does). When a sentence demonstrates per-word timing, end it with the example itself and
  light each word the same way. Show the numbers the rule uses (each word's letter count under its slice) so the rule
  can be checked from the board.
- **Code is a card, never a cut-away.** At most three real lines, with their line numbers, and a "⋮" row where lines
  are skipped, each one explained by the voice, or one whole block of up to six lines when the lines explained sit in
  it (a settings block); keep the block's own indentation, and narrow the card to the block so a dial or a sum can
  sit beside it; lines from two files get a short name each ("explainer",
  "old-and-new"). Reveal a line when the voice reaches it. The board never disappears behind code, and the card stays
  up while the step it proves is on the board.
- **No floating labels that repeat.** A label that says what the code card or the voice already says (a voice name
  over the clip, when the card shows it) is one more thing to read: leave it out.
- **A value the old guy quotes from the video itself** (a time from this video's own timing record) is said as such
  ("the new guy's question, the very start of this video, ends at 3.05 seconds").

At most about twelve things on the board at once: dim (to half, so dimmed text keeps 3:1 contrast) or remove what
the current step no longer needs. Things pile up: the rule's label and its code card stay while the board uses them;
remove them only when the next step needs the space. The template draws the speaker icons, the gameplay loop and the
big word; never draw them in the slot. The board is opaque: never make the slot's background transparent.

**Chapter breaks are longer than any pause.** Narrate ends each chapter on a 1.16 s tail, about the same as the
pause after a "So" line, so a full video that joins chapters holds each chapter's last full frame (its title, map
and hand-off still up) for one more second. The board fades out over a chapter's last 0.4 s, so hold the frame from
just before that fade, never the faded one (a held blank board reads as a broken video): a break of over two seconds the ear can tell from an ordinary point.

**Gate:** every sentence has a `speaker`, every claim is the old guy's, a setting is shown by changing it, each new-guy guess is a real misconception corrected in the next old-guy line or two with a cited fact, `oldguy lesson` prints `lesson ok`, and each chapter aims for 25 to 50 seconds.
