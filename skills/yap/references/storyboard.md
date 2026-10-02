# Storyboard

Purpose: cut the verified script into chapters a beginner can follow, each short enough to render fast and
complete enough to watch on its own.

## 1. Chapters

- Each chapter is 20 to 40 seconds of speech: about 50 to 100 words. Count them.
- 4 to 8 chapters for a 2 to 3 minute video. One idea per chapter: "what the form sends", "where the todo is
  saved", "what if saving fails".
- Each chapter has a stable id with no number in it: `what-the-form-sends`, never `chapter-2` or `part-b`. The id
  becomes the folder name (lower-case letters, digits and single hyphens, no leading digit, at most 60 characters).
- Each chapter has a short title for its title card.

## 2. Chapters stand alone

A viewer may watch any chapter first, so never point at another chapter. Banned: "as we saw", "last chapter",
"next, we will", "earlier", "later on", "at 1:30". Start each chapter so it makes sense cold, and end it on its
own idea.

## 3. One sentence per entry

Every entry in `sentences` must be exactly one sentence, and the entries joined with spaces must split back into
the same sentences. The splitter looks for `.`, `!` or `?` followed by a space and then a capital letter, a digit,
a quote or a bracket. So:

- End every entry with `.`, `!` or `?`. Start every entry with a capital letter or a digit.
- No abbreviations with dots (`Dr.`, `approx.`, `no.`, `e.g.`, `i.e.`). Write the words out: "for example"
  reads better aloud anyway.
- File names and numbers inside a sentence are fine (`todos.py`, `3.5 seconds`) because no space follows the dot.
- Wrap code names in backticks when they contain dots or marks: `` `app.run()` ``.
- No semicolons chaining two thoughts: make two entries.

## 4. Mark the kinds

Each sentence is `claim` (about the code, with sources) or `framing` (greeting, transition, no sources). See
[verify.md](verify.md). Most sentences are claims. A chapter usually opens with one framing sentence and may close
with one.

## 5. Plan the pieces

For each chapter, list the scene-kit pieces in order and the sentence index (`beat`, starting at 0) each appears
with. Beats must go up; the first piece should start at beat 0 so the screen is never empty. Two to four pieces
per chapter is plenty. See [scene-kit.md](scene-kit.md) for what each piece can show. Code card lines are at
most 68 columns: pick lines that fit, or quote a shorter part of a long one, never wrap.

## 6. Write it into script.md

Under the top section, one block per chapter:

```
## what-the-form-sends — What the form sends
sources: s1 app/todos.py 10-14 "todos.append(todo)"
0 framing  Hi, let's see what happens when you add a todo!
1 claim s1 The new todo is added to the list in memory.
pieces: title@0 "What the form sends"; code-card@1 app/todos.py lines 10-14 highlight 12
words: 61
```

**Gate:** Every chapter in `script.md` has a number-free id, a title, 50 to 100 words, one sentence per entry with a kind, no reference to another chapter, and pieces with rising beats from 0.
