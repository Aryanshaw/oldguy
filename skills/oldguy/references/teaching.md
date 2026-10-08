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
- **One running example.** Pick it in scope: a real request, job, row or value from the repository, or a plainly
  generic one ("the todo buy milk"). Write it in `script.md` as `example: <it>`. Name it in at least 70% of the
  chapters, so the viewer always knows where it is.
- **Before and after**, when the code replaced something: show the old way next to the new one once, early.
- **End on a recap line** of at most twelve words that the viewer could repeat: "One spec per job. One planner.
  One runner."

## 2. The shape of one chapter

- **One idea**, at most three new terms, at most eight sentences, within the template's length.
- **First sentence: where the example is now.** A chapter may be watched alone, so it starts by placing the
  example on the map. Never point at another chapter by position ("next chapter", "in part 2") or a time; name
  the thing instead ("The todo row from the form is still pending").
- **At least one "So" sentence** saying what the step means for the viewer: "So a forgotten job fails loudly at
  boot, not quietly in production." It starts with "So" so the check can find it.
- **Define a term the first time it appears**, in half a sentence, before using it again.
- **Close on the chapter's own point**, not on a detail.

## 3. Sentences

- One idea per sentence, about 14 words on average, never more than 25.
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
- **Code with its important lines lit.** Show the few real lines that matter, the rest dimmed or cut.
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

It checks the running example, a "So" sentence in every chapter, sentence and chapter length, pointing by
position, on-screen text length and the planned badge. Fix the specs until it prints `lesson ok`. It cannot
check that the map is drawn empty first or that things pile up: look at the snapshots for that
([visuals.md](visuals.md) section 4).

**Gate:** `oldguy lesson --dir .oldguy/<slug>` printed `lesson ok`, and the snapshots show the map drawn empty first and things piling up.
