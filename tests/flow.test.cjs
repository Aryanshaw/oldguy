"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const flow = require(path.join(__dirname, "..", "scene-kit", "flow.mts"));
const { checkScene } = require("../lib/chapter.mts");

// Sentences start at 0, 2, 4, 6 and 8 s; the piece runs 0..10 s.
const BEATS = [0, 2, 4, 6, 8];
const WIN = { startS: 0, durationS: 10, idPrefix: "p0", beatsS: BEATS };
const LANES = [{ id: "you", label: "You", note: "in Claude Code" }, { id: "cli", label: "oldguy command" }];
const STEPS = [
  { lane: "you", label: "Type /oldguy", at: 0 },
  { lane: "cli", label: "Audit", detail: "quotes vs real code", at: 2, kind: "ok" },
  { lane: "cli", label: "Wrong quote", at: 2, kind: "fail" },
  { lane: "you", label: "Watch", at: 4 },
];

// Renders the sample diagram with any params replaced.
function draw(over = {}, win = WIN) {
  return flow.render({ kicker: "01 · making a video", heading: "One request", lanes: LANES, steps: STEPS, ...over }, win);
}

// The start second of the first tween on a selector with the given method.
function tweenAt(timeline, method, selector) {
  const m = new RegExp(`tl\\.${method}\\(${JSON.stringify(selector).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, [^;]*?\\}, ([\\d.]+)\\);`).exec(timeline);
  return m ? Number(m[1]) : null;
}

test("flow draws the header, one column per lane in order, and the steps numbered in story order", () => {
  const { html } = draw();
  assert.match(html, /id="p0-root" class="og-piece og-flow"/);
  assert.match(html, /01 · making a video[\s\S]*One request/);
  assert.ok(html.indexOf('id="p0-lane-0"') < html.indexOf('id="p0-lane-1"'));
  assert.match(html, /class="og-lane og-lane-c1"[\s\S]*You[\s\S]*in Claude Code/);
  // step 3 (Wrong quote) sits in the second lane and keeps its story number
  assert.match(html, /id="p0-step-2" class="og-flow-step og-kind-fail"><span class="og-flow-num">3</);
  assert.match(html, /id="p0-step-1" class="og-flow-step og-kind-ok"/);
  assert.ok(html.indexOf('id="p0-step-1"') > html.indexOf('id="p0-lane-1"'));
});

test("flow escapes hostile text everywhere", () => {
  const evil = '</div><script>alert(1)</script>" onload="x';
  const { html } = draw({
    kicker: evil, heading: evil,
    lanes: [{ id: "a", label: evil, note: evil }, { id: "b", label: "B" }],
    steps: [{ lane: "a", label: evil, detail: evil, at: 0 }],
  });
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<[^>]*\son\w+\s*=/i);
  assert.match(html, /&lt;\/div&gt;&lt;script&gt;/);
});

test("each step appears with its sentence, steps on one sentence are spaced, and nothing runs past the window", () => {
  const { timeline, endS } = draw();
  // "at" is a sentence index: sentence 2 starts at 4 s and sentence 4 at 8 s
  assert.equal(tweenAt(timeline, "from", "#p0-step-1"), 4);
  assert.equal(tweenAt(timeline, "from", "#p0-step-2"), 4.25);
  assert.equal(tweenAt(timeline, "from", "#p0-step-3"), 8);
  // the first step waits for the lanes to come in rather than appearing on an empty stage
  assert.ok(tweenAt(timeline, "from", "#p0-step-0") > 0);
  assert.equal(endS, 10);
  for (const m of timeline.matchAll(/duration: ([\d.]+)[^;]*?\}, ([\d.]+)\);/g)) {
    assert.ok(Number(m[2]) + Number(m[1]) <= 10 + 1e-9, m[0]);
  }
});

test("the newest step glows until a later one appears, and its lane lights while the story is there", () => {
  const { timeline } = draw();
  assert.equal(tweenAt(timeline, "fromTo", "#p0-step-0-glow"), tweenAt(timeline, "from", "#p0-step-0"));
  assert.equal(tweenAt(timeline, "to", "#p0-step-0-glow"), 4);
  // steps 1 and 2 share a sentence: step 1 dims when step 2 arrives
  assert.equal(tweenAt(timeline, "to", "#p0-step-1-glow"), 4.25);
  assert.equal(tweenAt(timeline, "to", "#p0-step-3-glow"), null, "the last step keeps glowing");
  assert.equal(tweenAt(timeline, "fromTo", "#p0-lane-1-glow"), 4);
  assert.equal(tweenAt(timeline, "to", "#p0-lane-1-glow"), 8);
});

test("flow refuses diagrams it cannot draw well, naming the problem", () => {
  const lane = (id) => ({ id, label: id });
  const cases = [
    [{ lanes: [lane("a")] }, /2 to 5 lanes/],
    [{ lanes: ["a", "b", "c", "d", "e", "f"].map(lane) }, /2 to 5 lanes/],
    [{ lanes: [lane("a"), lane("a")], steps: [{ lane: "a", label: "x", at: 0 }] }, /unique/],
    [{ lanes: [{ id: "A b", label: "x" }, lane("b")] }, /lanes\[0\]\.id/],
    [{ steps: [] }, /steps/],
    [{ steps: [{ lane: "nope", label: "x", at: 0 }] }, /steps\[0\]\.lane/],
    [{ steps: [{ lane: "you", at: 0 }] }, /steps\[0\]\.label/],
    [{ steps: [{ lane: "you", label: "x", at: 1.5 }] }, /steps\[0\]\.at/],
    [{ steps: [{ lane: "you", label: "x", at: 0, kind: "warn" }] }, /kind/],
    [{ steps: [{ lane: "you", label: "x", at: 2 }, { lane: "you", label: "y", at: 0 }] }, /before the step above/],
    [{ steps: Array.from({ length: 7 }, () => ({ lane: "you", label: "x", at: 0 })) }, /at most 6 steps in lane "you"/],
    [{ steps: [{ lane: "you", label: "x", at: 9 }] }, /past the last sentence/],
  ];
  for (const [over, re] of cases) assert.throws(() => draw(over), re, String(re));
  assert.throws(() => draw({}, { startS: 0, durationS: 10 }), /beatsS/);
  // a step whose sentence belongs to a later piece would appear on that piece's screen
  assert.throws(() => draw({}, { ...WIN, durationS: 3 }), /outside this piece/);
});

test("checkScene: a flow step may only use sentences from its own beat to the next piece's beat", () => {
  const diagram = (at) => ({ lanes: LANES, steps: [{ lane: "you", label: "x", at }] });
  const scene = (at) => [
    { piece: "title", params: { heading: "H" }, beat: 0 },
    { piece: "flow", params: diagram(at), beat: 1 },
    { piece: "callout", params: { text: "T" }, beat: 4 },
  ];
  assert.doesNotThrow(() => checkScene(scene(1), 5));
  assert.doesNotThrow(() => checkScene(scene(3), 5));
  assert.throws(() => checkScene(scene(0), 5), /scene\[1\]: flow: steps\[0\]\.at is a sentence outside this piece/);
  assert.throws(() => checkScene(scene(4), 5), /outside this piece/);
  // as the last piece it may use every sentence to the end
  assert.doesNotThrow(() => checkScene([{ piece: "flow", params: diagram(4), beat: 0 }], 5));
});
