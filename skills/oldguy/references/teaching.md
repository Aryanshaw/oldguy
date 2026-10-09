# Teaching

Purpose: make the viewer understand the flow, not just hear its parts named. A video that lists parts is useless
even when every claim is true. These rules hold for every template; a template changes the look and the voices,
never these.

What teaches, from watching videos that worked and one that did not: one concrete thing followed through a map
that stays put, steps that pile up instead of swapping, a reason after each step, and labels on screen instead of a
second copy of the narration. Slowing the voice alone does not fix a video that has none of these.

## 1. The shape of the whole video

- **Open with the problem and the promise.** What hurts or what the viewer wants to know, then one sentence that
  says what the video follows: "We follow one todo from the Add button to the saved list."
- **One running example that travels.** Pick it in scope: a real request, job, row or value from the repository,
  or a plainly generic one ("the todo buy milk"). Write it in `script.md` as `example: <it>`. Name it in full in at
  least 70% of the chapters and show it on screen there. It moves from stop to stop along the map and changes form
  at each one (a form, then a request, then a row), leaving a trail; parked in one box it teaches nothing.
- **Real values.** Where the example becomes data, show the real value from the code or a real run (a status,
  an id, a time), never a made-up one.
- **Before and after**, when the code replaced something: show the old way next to the new one once, early.
- **Show a setting by changing it.** When the topic is something configurable (a template, a flag, a policy), run
  the same example through two settings, side by side, so the viewer sees what changes and what stays.
- **A quick check near the end** that tests understanding, not memory: a what-if the viewer can work out from the
  map ("If the pause were 1000 ms, when would our line start?"), as its own sentence ending in "?". Narrate holds
  at least three seconds after it; then answer it with the reason.
- **End on a recap line** of at most twelve words that the viewer could repeat: "One spec per job. One planner.
  One runner."

## 2. The shape of one chapter

- **One idea**, at most three new terms (the check counts code names), at most eight sentences, within the
  template's length.
- **Open on where the example is now**, in the first or second sentence. A chapter may be watched alone, so it
  starts by placing the example on the map. Never point at another chapter by position ("next chapter", "in part 2") or a time; name
  the thing instead ("The todo row from the form is still pending").
- **At least one "So" sentence** saying what the step means for the viewer: "So a forgotten job fails loudly at
  boot, not quietly in production." It starts with "So" so the check can find it.
- **Define a term the first time it appears**, in half a sentence, before using it again.
- **Close on the chapter's own point**, not on a detail.

## 3. Sentences

- One idea per sentence, about 14 words on average (the check refuses an average over 18), never more than 25.
- No sentence brings in more than three new names.
- Say the plain-words part first, then the code name: "a list that remembers every job, the registry".

## 4. The picture

- **Draw the map empty first.** At beat 0 the lanes, boxes or regions the chapter uses are on screen with their
  names and nothing inside. The viewer learns where to look before anything moves.
- **Things pile up and stay.** Each sentence adds one thing to the map; nothing is replaced. The current item is
  bright, what came before is dimmed (about half), what is still to come is not shown.
- **One change at a time**, on the sentence that talks about it.
- **One visual language for the whole video:** the same lanes, chips, colours and highlight in every chapter, so a
  new chapter is a new map the viewer already knows how to read. Reuse the same map when the flow allows.
- **Labels, not sentences.** On-screen text is at most eight words per label. Never put the narration on screen as
  a caption band; viewers who want captions turn them on while watching.
- **Hand-offs are arrows.** When the example moves from one part to the next, draw the arrow it travels along.
- **Never show a value before it is said.** A number or name appears on the sentence that says it.
- **Code with its important lines lit**, in at least half the chapters: two to six whole lines with their
  indentation, never cut, with the file and line, and the key word lit on the sentence that says it. The voice names
  what the code does ("each start is the samples so far, divided by the sample rate"); code nobody talks about is
  noise, so leave it out.
- **Derive a number, don't just state it.** When a value matters, show where it comes from (3.71 s plus a 0.70 s
  pause is 4.41 s), so a quick check about it can be answered from the screen.
- **Planned work is said once.** A video about something not built yet says so in one chapter (the planned badge
  there), not on every frame.

## 5. Pace

The template sets the voice speed and the silence after each sentence; the narrate step adds them. Write for them:
short sentences, one idea each, so each pause lands after a finished thought. Never cram two ideas into one
sentence to save time.

## 6. Check it

After the specs are written and before the first scaffold:

```
oldguy lesson --dir .oldguy/<slug>
```

It checks the running example (named in full, early in each chapter, and on screen), a "So" sentence in every
chapter, sentence and chapter length, pointing by position, on-screen text length (designed scenes and piece
labels), code on screen in half the chapters and never cut short, values shown only once said, new code names
per chapter, the recap length and the planned badge. Fix the specs until it prints `lesson ok`. It cannot
check that the map is drawn empty first or that things pile up: look at the snapshots for that
([visuals.md](visuals.md) section 4).

**Gate:** `oldguy lesson --dir .oldguy/<slug>` printed `lesson ok`, and the snapshots show the map drawn empty first and things piling up.
