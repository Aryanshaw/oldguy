# Scene kit

Purpose: build each chapter's picture from ready-made pieces, so every chapter looks the same and nothing is
designed from scratch.

## The rule: do not invent layout

Use only the four pieces below with only the params listed. Do not write HTML, CSS or animation yourself, do not add
params the kit does not know, and never edit the `index.html` the pipeline builds. If an idea does not fit a piece,
say it in the narration and show the nearest piece. `yap scaffold --help` prints the same list.

## The pieces

| Piece | Shows | Use it for |
|---|---|---|
| `title` | a big heading, optional line under it | the chapter's opening card |
| `steps` | a numbered list that appears one item at a time | the order things happen in |
| `code-card` | a file name over code lines, some highlighted | the exact lines a claim is about |
| `callout` | a short note in a bubble with an arrow | one thing to notice, a warning, a result |

### Params

```
title      {"heading": text, "sub": text (optional)}
steps      {"items": [{"label": text, "detail": text (optional)}]}
code-card  {"file": text, "lines": [{"no": number (optional), "text": text, "highlight": true (optional)}]}
callout    {"text": text, "pointTo": "up" | "down" | "left" | "right" (optional, default "down")}
```

- Every text is plain text. The kit escapes it, so code with `<` or quotes is safe to show.
- `code-card` lines: copy the real lines from the file, keep `no` as the real line number, and highlight only the
  lines the sentence talks about. Six to twelve lines fit; a card is a window, not the whole file.
- `steps`: three to five items, each label a few words.
- `callout`: one short sentence. `pointTo` must be one of the four words or the piece is rejected.

## Beats

Each piece has a `beat`: the 0-based index of the sentence it appears with. A piece stays on screen until the next
piece's beat starts; the last one stays until the chapter ends. Beats must rise (0, 2, 4), never repeat, and must be
less than the number of sentences. Start at 0.

## The spec file

Write one file per chapter at `.yap/<slug>/specs/<id>.json`:

```json
{"id": "what-the-form-sends", "title": "What the form sends",
 "sources":   [{"id": "s1", "file": "app/todos.py", "lines": [10, 14], "quote": "todos.append(todo)"}],
 "sentences": [{"text": "Hi, let's see what happens when you add a todo!", "kind": "framing", "source_ids": []},
               {"text": "The new todo is added to the list in memory.", "kind": "claim", "source_ids": ["s1"]}],
 "scene":     [{"piece": "title", "params": {"heading": "What the form sends"}, "beat": 0},
               {"piece": "code-card", "params": {"file": "app/todos.py", "lines": [
                  {"no": 10, "text": "def add(todo):"}, {"no": 11, "text": "    todos.append(todo)", "highlight": true}]}, "beat": 1}]}
```

## Scaffold

```
yap scaffold .yap/<slug>/specs/<id>.json --root .yap/<slug>
```

`--root` here is the video folder, not the repository. It creates `.yap/<slug>/chapters/<id>/` with `chapter.json`
and `narration.txt` (the sentences joined with spaces) and prints the folder. It refuses a spec whose sentences do
not split one-to-one, whose beats do not rise, or whose params the kit rejects, and it never overwrites an existing
chapter: to redo one, delete its folder first.

**Gate:** `yap scaffold` exited 0 and printed a folder for every chapter, using only the four pieces and their listed params.
