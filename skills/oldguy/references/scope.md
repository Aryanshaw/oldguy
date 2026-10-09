# Scope

Purpose: turn "/oldguy how adding a todo works" into one flow that really exists in the code, sized for a short video,
before any reading in depth begins.

## 1. Find the flow

A flow is one path through the code with a clear start and a clear end. "Adding a todo" starts where the user's
action enters the code (a form handler, a route, a CLI command) and ends where the result lands (a saved row, a
response, a redrawn screen).

- Search the repository for the feature's words (names of routes, handlers, functions, files). Read only what you
  need to confirm the path exists.
- Prefer the smallest complete flow. "How a todo is added" is one video; "how the whole app works" is not.
- If the request names more than one flow, pick the one it names first and say which one you picked.

## 2. The one question

You may ask at most one clarifying question, here and nowhere else. Ask it only when you cannot pick a flow
without it (two very different things share the name, or the request is just "/oldguy"). Make the question
self-contained: say what you found and what the choices are.

## 3. If the feature is not in the code

Say so plainly in one or two sentences, for example: "I could not find a dark mode in this project; there is no
theme switch, setting, or style for it." Then ask one question ("Did you mean the colour settings in
`settings.js`, or something else?") and stop. Write nothing under `.oldguy/`. Never describe how the feature
"would probably" work.

## 4. Set the shape

- Audience: a beginner who has never seen this code. Assume no knowledge of the framework. They want to see how
  it works (what happens, in what order, what can go wrong); code and other real material appear when they help.
- Length: as long as the flow needs; there is no limit on the whole video. Each chapter aims for the template's
  length (explainer: 20 to 40 seconds), so a small flow is about 4 to 8 chapters. Honour a length the user asks
  for by changing the chapter count, not the chapter length.
- Slug: a short lower-case name for the folder, from the request (`add-todo`). The video lives in `.oldguy/<slug>/`.

## 5. Write it down

Create `.oldguy/<slug>/script.md` with a top section: the request, the flow in one sentence, the file where it
starts, the file where it ends, the planned chapter count, and the running example the video follows on its own
line, `example: the todo "buy milk"` (a real request, job or value from the code, or a plainly generic one; see
[teaching.md](teaching.md)). The chapters themselves come in the storyboard step.

**Gate:** `script.md` names one flow, its start file, its end file, a planned chapter count and an `example:` line; or you stopped with one question and wrote nothing.
