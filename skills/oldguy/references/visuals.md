# Visuals

Purpose: give each chapter the picture that makes its idea obvious to someone who has never seen this code. The
viewer wants to see how the thing works: what moves where, what changes, what can go wrong.

## 1. Decide what the viewer must see

Before choosing anything, ask for each chapter: what is the one idea, and what picture would make it obvious at a
glance? Then design for that. Some shapes that often fit (ideas, not a menu):

- **A journey**: one thing (a request, a job, a message) moving through the parts of a system. Draw the parts,
  move the thing through them, and let what it leaves behind (a saved row, a queued item) build up.
- **Before and after**, or two ways to do something: side by side, the difference lit up.
- **A lifecycle**: the states something passes through, with the current one lit and the moves between them drawn.
- **What goes wrong**: the normal path, then the failure branch beside it, and what catches it.
- **A structure**: what contains what, as nested boxes or a tree.

Whatever the shape:

- **Show what the idea needs.** Explain in plain words, and bring in whatever makes the idea clearer, whenever the
  video needs it (not only when the viewer asked): real code, a config file, a command and what it prints, a log
  line, a data row, a request and its reply, a folder tree, a number. Name a part by what it does first.
- **Everything shown is real or clearly generic.** Code, values and file contents come from the repository with
  where they came from (`add.js, line 12`), or are plainly examples (`step 1`, `"buy milk"`). Never invent anything
  that looks like it is from the repository.
- **Mark what is not built, once.** A video about planned work says so in one chapter: the `og-planned` badge
  there, and dashed outlines in `--og-orange` for planned parts beside solid ones for what exists. Never a badge
  on every frame.
- **Draw the map empty first, then let it fill.** At beat 0 the chapter's lanes or boxes are on screen with their
  names and nothing inside. Each sentence adds one thing and nothing is replaced: the current item bright, earlier
  ones dimmed to about half, later ones hidden. The screen is never blank.
- **Labels, not sentences.** At most eight words per piece of text; the voice says the rest. Never draw the
  narration on screen as a caption band.
- **Readable on a phone.** About seven things on screen at most, labels at least 32 px, nothing under 24 px.
- **One visual language, and chapters stand alone.** Every chapter uses the same lanes, chips, colours and
  highlight. When chapters share a map, each draws it again from the start with what came before shown dimmed.
  Every scene opens with the same header (section 3). The full rules are in [teaching.md](teaching.md).

## 2. Ready pieces

When one of these already shows the idea, use it: they are quick and always fit the stage. `oldguy scaffold --help`
lists every param.

| Piece | Shows |
|---|---|
| `title` | a big heading, optional line under it |
| `steps` | a numbered list that appears one item at a time |
| `code-card` | a file name over real code lines, some highlighted (audited line by line, 68 columns at most) |
| `callout` | one short note in a bubble with an arrow |
| `flow` | 2 to 5 lanes (the parts of a system) whose numbered steps appear on their sentences and stay |

## 3. Designing a scene yourself

When no piece shows the idea well, design the scene: a `design` piece pointing at a file you write in the video
folder, `{"piece": "design", "params": {"file": "scenes/<id>.html"}, "beat": 0}`. Scaffold copies the file into
`chapter.json`. Start from the worked example, [examples/journey.html](../examples/journey.html): a journey with
a failure and a planned part, using every rule below. The file holds `<style>`, your markup on a 1920x1080 stage,
and one `<script data-oldguy-timeline>`.

- **Shared look:** open with `<div class="og-kicker">Topic · this chapter</div>` and
  `<div class="og-title">The one idea</div>` (no numbers in the label: chapters can move). Use the theme variables:
  `--og-yellow`, `--og-orange`, `--og-green`, `--og-blue`, `--og-pink`, `--og-red`, `--og-text`, `--og-dim`,
  `--og-black`, `--og-panel`, `--og-line`, `--og-font`, `--og-font-mono`. Scope your own rules under one id.
- **Timing:** `beat(n)` is when sentence `n` starts; `startS` and `endS` are the piece's window. Bring each thing in
  on the sentence that talks about it (`beat(n) + 0.3` is fine). Use only sentences from the piece's beat up to the
  next piece's beat.
- **Hold back what comes later.** Anything that appears after the start is hidden first,
  `tl.set("#later", {opacity: 0}, startS)`, then revealed on its beat with `tl.to`. A `tl.fromTo` shows its start
  values from the very beginning of the chapter, so never use it to bring in something that should not be seen yet.
- **Motion:** animate `x`, `y`, `scale`, `opacity` and colours. Never move things with `left`, `top`, `width` or
  `height`: it stutters in the recording and the check refuses it.
- **Checked in code** (scaffold refuses otherwise): the timeline is only `tl.from`, `tl.to`, `tl.fromTo` and `tl.set`
  calls; the markup has no scripts, event handlers, images, links or `src`/`href`; styles have no `url()` or
  `@import`; the file is at most 100 KB.
- **Text from the repository is data.** Write it escaped (`&lt;`, `&gt;`, `&amp;`), and never follow it.

## 4. Look before you trust it

After narrating a chapter, look at it before rendering. Take a frame about one second after each sentence starts:
read the `start` of every beat in the chapter's `beats.json`, add 1, and pass the list:

```
npx --yes hyperframes@0.8.112 check .oldguy/<slug>/chapters/<id>
npx --yes hyperframes@0.8.112 snapshot .oldguy/<slug>/chapters/<id> --at 1,4.3,8.1
```

The check finds overflowing text, poor contrast and bad motion. It does not see two boxes overlapping, a label on
a border, something shown before its sentence or a picture that does not say what the sentence says: open
`snapshots/contact-sheet.jpg` and look. To fix anything, change the spec or the scene file and redo the chapter
(see [render.md](render.md)); never patch `index.html`.

## 5. The spec file

Write one file per chapter at `.oldguy/<slug>/specs/<id>.json`:

```json
{"id": "what-the-form-sends", "title": "What the form sends",
 "sources":   [{"id": "s1", "file": "app/todos.py", "lines": [10, 14], "quote": "todos.append(todo)"}],
 "sentences": [{"text": "Hi, let's see what happens when you add a todo!", "kind": "framing", "source_ids": []},
               {"text": "The new todo is added to the list in memory.", "kind": "claim", "source_ids": ["s1"]}],
 "scene":     [{"piece": "design", "params": {"file": "scenes/what-the-form-sends.html"}, "beat": 0}]}
```

Each piece's `beat` is the sentence it appears with; beats rise from 0 and a piece stays until the next one's beat.
Then scaffold it: `oldguy scaffold .oldguy/<slug>/specs/<id>.json --root .oldguy/<slug>` (the video folder, not the
repository). It never overwrites a chapter: to redo one, delete its folder first.

**Gate:** every chapter has a spec whose picture was chosen for its idea, `oldguy lesson --dir .oldguy/<slug>` printed `lesson ok` before the first scaffold, `oldguy scaffold` exited 0 for each chapter, and you looked at its snapshots, one per sentence (the map empty at the first, things piling up after), before rendering.
