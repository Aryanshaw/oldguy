# Real-Life Analogy: the hard rules

A scene is built only from the kit (`kit/kit.js`) and holds these rules. They are not advice: a scene that breaks
one is not finished. `RLA.scene().build()` returns the breaks it can read from the markup as `problems`; the rest are
answered by eye in `look.md`. Each rule says what it is, how to keep it with the kit, and what gets a scene rejected.

## 1. Flat: solid fills only

Every shape is one flat colour from the palette (`RLA.P`, `RLA.SKIN`, `RLA.HAIR`, or a `shade()` of one). No
outlines, gradients, shadows or glows. Depth comes from a darker or lighter step of the same colour on a second shape
(the side of a parcel, a fold of a curtain).

- **Keep it:** draw with the kit's props and rig; when a scene needs one more shape, give it a `fill` from the
  palette and no `stroke`. Strokes are allowed only for things that are lines in life (a lock's shackle, a cup's
  handle, glasses) and for chalk.
- **Rejected when:** `problems` names a colour not in the palette, a gradient, a shadow, or a filled shape with a
  stroke.

## 2. Warm on cool

The ground is cool (indigo, deep purple or saturated blue: `GROUNDS`); people and objects are warm (coral, peach,
yellow, orange) or light (cream, lilac). The focus object is the warmest, brightest thing in the frame.

- **Rejected when:** the focus is a cool colour on a cool ground, or a warm ground swallows the warm objects.

## 3. Words only on paper cards

A word, a number or a line of code appears only on a paper card (`RLA.card`), hand-lettered for words and in the
code font for code. Nothing in the SVG is text: a book has no title on its cover, a door has no sign. A card's title is
a label of at most eight words; its code is whole lines from the repository with their file and line.

- **Rejected when:** `problems` names words outside a card or a `<text>` element; a card holds a sentence of
  narration; code is cut short.

## 4. People only from the rig

Every person comes from `RLA.person` or `RLA.cast`: dot eyes, bar brows, a one-stroke nose, one big hair blob that
says who they are. Keep one look per role for the whole video (the actor is always `cast('actor')`), so the viewer
knows them in every chapter. Each person is named on a card on the sentence they enter, and nobody is an extra.

- **Rejected when:** a person is drawn by hand, a role changes face, hair or colours between chapters, or a person
  enters with no card saying who they are.

## 5. One new thing per sentence, and it is the focus

Each sentence brings in one thing: a person, a prop or a card. What goes with it rides along as `extra`: its strings,
a sight line, a spotlight's beam, and the card that names a thing arriving on the same sentence. That thing gets the burst, sits near the middle of the frame (move the camera to it), and older
cards dim. Nothing appears before its sentence; nothing moves between sentences except the slow push.

- **Rejected when:** `problems` names a sentence with two new things; two bursts are on screen at once; the focus is
  at the frame's edge; anything wiggles, bobs or loops while nobody is talking about it.

## 6. The map is drawn empty first

At beat 0 the analogy's place is on screen (`scene.set`): the stage, the counter, the shelves. People and props then
pile up in it and stay. Cards are labels, not things: two stay up (the newest bright, the one before dimmed) and
older ones are taken down with their strings, so a frame never holds a wall of text; pin the running example's card
when it should stay. The whole video happens in one place: a later chapter moves inside it (the wings, the front
of the stage) and keeps its look, never cuts to a different room or ground colour.

- **Rejected when:** the first frame is an empty ground, a later sentence wipes what came before, or a chapter is
  set somewhere the others are not.

## 7. The analogy is the costume, the code is the body

Every analogy object that stands for code has its card hanging off it by chalk strings, naming the real code and
its file and line. Exactly one sentence in the video says where the analogy breaks. One analogy for the whole video.

- **Rejected when:** an object stands for code with no card, or its card comes later than the sentence that names
  it; two analogies are mixed; the video never says where the picture breaks; an arrow for a hand-off points
  against the flow.

## 8. Reads small, passes the check

The thumbnail is 240 px wide: from it alone you can say what the focus object is and who is in the scene. Card text
is at least 28 px on the 1920 x 1080 stage. `npx hyperframes check` passes (contrast, overflow, motion).

- **Rejected when:** the 240 px picture is a blur of small parts; a card's text overflows; the check fails.
