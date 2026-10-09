# Real-Life Analogy: the look check

`problems` and `hyperframes check` read text. This is what only eyes can check. Do it for every chapter after it is
rendered, and again after any change.

## One command

```
node <plugin>/templates/real-life-analogy/kit/look.mjs .oldguy/<slug>/chapters/<id>
```

It reads the chapter's `beats.json`, takes one frame from `chapter.mp4` 1.2 seconds after each sentence starts (the
newest thing has landed and its burst has drawn), and writes `look.jpg` in the chapter folder: the frames in a row of
tiles at full width, then the same frames at 240 px, the thumbnail size. Read the sheet, then answer each question
below with yes or no. A no is fixed in the make script and the chapter is redone; nothing ships with a no.

## What to see

1. **The silhouette reads small.** In the 240 px row you can say what the focus object is and who is in the scene,
   from shape and colour alone.
2. **One focus.** In each frame one thing is clearly the subject: near the middle, the warmest and brightest.
3. **The burst is on the focus.** The chalk ticks surround the newest thing, and only it; the old burst is gone.
4. **Card text is readable.** Every card's words can be read in the full-size row, nothing overflows the paper, and
   the lit word is the one the sentence says.
5. **No outlines, no gradients.** Every shape is a flat fill; the only lines are chalk and things that are lines in
   life.
6. **People come from the rig.** Dot eyes, bar brows, one-stroke nose, one hair blob; the same role looks the same
   in every chapter.
7. **Warm on cool.** The ground is indigo, purple or blue, and the people and objects on it are warm or light, with
   enough contrast that nothing sinks into the ground.
8. **Everyone and everything is named.** Each person has a card saying who they are from the frame they enter; each
   object that stands for code has its card from the sentence that names it; the set is the same place in every
   chapter; hand-off arrows point forward along the flow.

Also, from the teaching rules: the first frame shows the analogy's place with nothing in it yet, and each later frame
has one more thing than the one before.
