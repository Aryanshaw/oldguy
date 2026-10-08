# Real-Life Analogy

One calm narrator tells the flow through **one everyday analogy** that runs the whole video: a restaurant order, a
post office, a library, a theatre. The pictures are flat illustrated scenes in the TED-Ed manner, drawn with this
template's kit; the real code hangs off the analogy's objects on paper cards. The analogy is the running example's
costume, never a replacement: every claim still cites its file and line, and the real names and values are said and
shown. All of `references/teaching.md` holds.

- **Who says what:** every sentence is the narrator's. Sentences carry no `speaker`.
- **Tone:** calm, warm and sure, like a good teacher telling a story. Short sentences; plain words first, the code
  name second.
- **The slot:** the whole frame, one designed scene per chapter built with `kit/kit.js` (section 4). Never a ready
  piece: they do not share this look.

## 1. Pick the analogy

Pick it in the scope step, with the running example, and write both at the top of `script.md`:
`example: <the real thing the video follows>` and `analogy: <the everyday setting>`.

- **Match the flow's shape: who hands what to whom.** List the flow's parts and what passes between them, then find
  a place where people pass a thing the same way. A request through handlers is an order passing from waiter to
  kitchen to table. A queue of jobs is a ticket rail. A cache is the shelf behind the counter. A pipeline of stages
  that each add timing is a theatre: script, actor, cue book, stage.
- **One analogy for the whole video.** Never mix two (no restaurant in one chapter and a post office in the next).
  If a part has no place in it, it is the wrong analogy: pick another before writing anything.
- **Everyday, not technical.** Something a ten-year-old has seen. Not "a pipeline" or "a factory line of functions".
- **Each analogy piece maps to one real thing**, and the mapping is written down in `script.md` as a list:
  `- the order ticket = cart.checkout() (shop/cart.js:42)`. Every card in the video comes from this list.
- **One cast, one set.** Every chapter happens in the same place: move inside it (the wings, the front of the stage,
  behind the counter), never cut to a new room. Each role is one person for the whole video, and there are no
  extras: a person on screen stands for a real part of the flow, or for the viewer ("you: one script").
- **If the video is about looks or settings** (a template, a theme), the analogy must not be confused with the
  real look: name the real thing on the card ("this template: real-life-analogy") so the viewer knows which is which.

## 2. The script

- **Hook with a human problem** in the first sentence of the video: what hurts, said about people, and plainly a
  problem ("Without templates, every video would sound and look exactly the same."). Then the promise.
- **Then the turn:** a sentence that starts "For example," and names the running example in full, in the analogy's
  clothes and in its real name ("For example, take one spoken line: your todo is saved.").
- **Each chapter is one stop in the analogy.** Its first or second sentence places the example there ("Our line,
  your todo is saved, reaches the actor."). Then what happens there, in the analogy's words, and the real code name
  and value on the same sentence or the next ("The actor here is the voice af_heart, at a speed of 0.95.").
- **Real values, said.** Every value on a card is said aloud on or before the sentence that shows it.
- **Show a setting by changing it.** When a sentence says a thing is set somewhere, put a second real setting next to
  it and show what changes (the sample sets this template, 0.95 and 650 ms, beside the explainer's 0.9 and 700 ms),
  so "many looks" is seen, not only said.
- **Every number has a visible source.** When a number comes from an earlier one, show the earlier one first, on
  the object it belongs to (the ticket of the sentence before, with its `"end": 4.115` from `beats.json`), then the
  sum. Round half up and keep the sum true on screen (4.12 + 0.65 = 4.77).
- **End on the real thing.** When the flow ends in something the viewer could see (a page, a file, a reply), draw
  it (the `screen` prop for a page) and put the real code or value on it: the page's own timeline line, the card
  that rises at that time. A ring around an actor is not a page.
- **Where the analogy breaks: one line per video**, in the chapter where it matters, starting "Where the picture
  breaks:" and saying what is different in the real code. It is a claim like any other and cites its source.
- **A "So" line in every chapter**, the quick check near the end (a what-if ending in "?"), and a recap of at most
  twelve words that names the analogy's pieces ("One script, one actor, one cue book, one stage.").
- Claims cite sources whoever and whatever they talk about. An analogy sentence that also states a fact about the
  code ("the actor reads every line at 0.95") is a claim.

## 3. The look

Read `rules.md` in this folder before the first scene: its rules are hard, and `RLA.scene().build()` returns the
ones it can check as `problems`. In short: solid flat fills from the kit's palette, no outlines, no gradients; one
focus object per sentence, centred and lit by the chalk burst; words only on paper cards; people only from the rig;
warm shapes on a cool ground.

## 4. Composing a chapter's scene

Read the index at the top of `kit/kit.js` (the comment down to the first line of code). It lists every call.

1. Write a make script in the video folder (`.oldguy/<slug>/make.mjs`) that loads the kit by its path in the plugin
   (`createRequire(import.meta.url)('<plugin>/templates/real-life-analogy/kit/kit.js')`; the template folder is
   printed by `oldguy templates real-life-analogy --show`), builds each chapter's scene, writes
   `scenes/<id>.html` and the spec with one `design` piece at beat 0, and stops on any `problems`.
2. **Set the map empty first** with `.set(...)`: the analogy's place (a stage and its curtains, a counter, a
   sorting desk), on screen from beat 0, nothing in it yet.
3. **One new thing per sentence** with `.add(beat, thing, {focus: true})`: a person from `cast` or `person`, a prop,
   or a card. The focus gets the burst; the burst leaves the old focus. Only two cards stay up (the newest bright,
   the one before dimmed); older ones are taken down with their strings, while people and props stay on the map.
   Pin the running example's card (`{pin: true}`) when it should stay up the whole chapter. A crowded scene takes
   `scene({cards: 1})`: only the newest card stays.
   **Name every person and every object that stands for code on the sentence it enters**: its card rides along
   with `{extra: true}` ("the stage manager: joins the sounds", "sounds, one per sentence"). An unnamed person or
   prop is a question the viewer cannot ask.
4. **Cards hang off the object they name**: `card({...})` placed above the object, then
   `strings({from: card.bottom(3), to: [object x, object top]})` added on the same beat with `{extra: true}`.
   A card holds a hand-lettered title (at most eight words), and either the real code (whole lines, with `file`
   and `hl` lighting the word the voice says) or a real value.
5. **The camera follows the focus**: `.camera(beat, {x, y, zoom})` pans the world so the new focus sits in the
   middle (zoom 1 to 1.35). A slow push runs under the whole chapter on its own. Nothing else moves between beats.
   Do not pan while a card that is still up would leave the frame; lay the scene out so it fits at zoom 1 instead.
   **Hand-offs are arrows that point forward along the flow** (from the cue book to the stage, never back to the
   belt).
6. Run the script, read `problems`, then `oldguy lesson`, scaffold, audit, narrate, and look (section 5).

Layout habits that keep a frame clean: a card sits *above* the thing it hangs from with clear air under it, never
over a face; strings run down to the object without crossing a person; keep cards inside x 40 to 1880; give each
chapter two or three card spots and let later cards reuse a spot once its card is taken down. The sample's make
script, `examples/theatre-make.mjs` in this folder, is a full worked video (four chapters, one theatre).

### Worked scenes

**A theatre, the voice stop** (example: the line "your todo is saved"; the actor is the voice):
```js
const sc = RLA.scene({ id: 'the-voice', ground: 'indigo', floor: 800 });
sc.set(RLA.prop('curtain', { id: 'v-curtain', x: 960, y: 540 }).svg);
sc.set(RLA.prop('platform', { id: 'v-stage', x: 960, y: 830, s: 1.2 }).svg);
const actor = RLA.cast('actor', { id: 'v-actor', x: 700, y: 834, s: 0.75, pose: 'hold', face: 'pleased',
  holding: { prop: 'paper', s: 0.42, dy: -30 } });
sc.set(actor.svg);                                                    // the actor is part of the place
const page = [actor.anchors.hand[0], actor.anchors.hand[1] - 30];
const line = RLA.card({ id: 'v-line', x: 900, y: 140, title: ['our line:', 'your todo is saved'] });
sc.add(0, line, { focus: { x: page[0], y: page[1], r: 110 }, delay: 0.4, pin: true });   // where the example is
sc.add(0, RLA.strings({ id: 'v-line-str', from: line.bottom(2), to: [page[0], page[1] - 52] }), { extra: true, delay: 1 });
const voice = RLA.card({ id: 'v-voice', x: 110, y: 30, title: 'the actor: af_heart at 0.95',
  lines: ['"voice_speed": 0.95,'], file: 'real-life-analogy/template.json · line 21', hl: { line: 0, word: '0.95' } });
sc.add(1, voice, { focus: actor.focus });                             // the card hangs above her head
sc.add(1, RLA.strings({ id: 'v-voice-str', from: [[560, voice.box[3]], [760, voice.box[3]]],
  to: [[650, actor.anchors.top[1] + 40], [740, actor.anchors.top[1] + 40]] }), { extra: true, delay: 0.7 });
sc.camera(3, { x: 1250, y: 640, zoom: 1.08 });                        // follow the next focus
```

**A restaurant, an order reaching the kitchen** (example: the order for one pizza; the ticket is the request):
the counter is set at beat 0; the waiter (`cast('clerk', {pose: 'hold'})` holding a `ticket`) on sentence 1; the
ticket on the `conveyor` with its card `POST /orders` hanging from it on sentence 2; the cook (`cast('manager',
{face: 'focused'})`) behind the counter on sentence 3, with a `sight` line from her eye to the ticket.

**A post office, a message waiting in a queue** (example: the welcome email for ana@example.com): a row of three
`envelope`s on the `counter` (set), the clerk pointing at the first (`pose: 'point'`), a `clock` on the wall when the
sentence says how long it waits, and the card `queue.add(job)` hanging off the first envelope.

## 5. Look before you trust it

After narrating, do the usual snapshot check, then the look check in `look.md`: it builds a contact sheet of the
rendered chapter (`node <plugin>/templates/real-life-analogy/kit/look.mjs .oldguy/<slug>/chapters/<id>`) and asks
eight yes/no questions. Fix every no in the make script and redo the chapter.

**Gate:** no sentence has a `speaker`; `script.md` names one `example:` and one `analogy:` with its mapping list; the first sentence is a human problem and a "For example," sentence names the example; every scene was built with the kit and its `problems` list was empty; exactly one "Where the picture breaks:" line in the video; and every question in `look.md` was answered yes from the contact sheet.
