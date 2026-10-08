# Storyboard

Purpose: cut the verified script into chapters a beginner can follow, each short enough to render fast and
complete enough to watch on its own.

## 1. Chapters

- Each chapter aims for the template's length (`oldguy templates <id> --show` prints it). For explainer that is 20 to
  40 seconds of speech: about 50 to 100 words. Count them. Going over is not an error; split a chapter that runs long.
- As many chapters as the flow needs. One idea per chapter: "what the form sends", "where the todo is
  saved", "what if saving fails".
- Each chapter has a stable id with no number in it: `what-the-form-sends`, never `chapter-2` or `part-b`. The id
  becomes the folder name (lower-case letters, digits and single hyphens, no leading digit, at most 60 characters).
- Each chapter has a short title for its title card.

## 2. Chapters connect through the example

The chapters tell one story: the running example moves through them ([teaching.md](teaching.md)). A viewer may
still watch any chapter first, so each one opens by placing the example ("The todo row is saved and still
pending") and connects by naming things, never by position or time. Banned: "next chapter", "in part 2", "coming
up", "at 1:30". Every chapter has at least one sentence starting with "So" and ends on its own point.

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

## 5. Plan the picture

For each chapter, write down the one picture that makes its idea obvious and what changes on which sentence
(`beat`, starting at 0): ready pieces in order, or a scene you will design. The first thing shows at beat 0 so the
screen is never empty. See [visuals.md](visuals.md) for how to choose. If a code card is used, its lines are at
most 68 columns: pick lines that fit, or cut a long one and end it with `…` (never wrap, never reword), and do not
narrate the part that is cut off.

## 6. Write it into script.md

Under the top section, one block per chapter:

```
## what-the-form-sends — What the form sends
sources: s1 app/todos.py 10-14 "todos.append(todo)"
0 framing  You type buy milk and press Add.
1 claim s1 The new todo is added to the list in memory.
2 claim s1 So it is gone again when the server restarts.
picture: design: empty lanes browser, server, list at 0; the todo moves to the server on 1; the list gains a row on 2
words: 61
```

**Gate:** Every chapter in `script.md` has a number-free id, a title, a word count near the template's length, one sentence per entry with a kind, a "So" sentence, no pointing at another chapter by position, the running example where it is, and a picture plan that draws the empty map at beat 0.
