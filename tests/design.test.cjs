"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const design = require(path.join(__dirname, "..", "scene-kit", "design.mts"));
const { checkScene, scaffoldChapter } = require("../lib/chapter.mts");

// Sentences start at 0, 2, 4, 6 and 8 s; the piece runs 0..10 s.
const WIN = { startS: 0, durationS: 10, idPrefix: "p0", beatsS: [0, 2, 4, 6, 8] };
const TIMELINE = '<script data-yap-timeline>\n// comment with tl.call("x") in it\ntl.from("#a", {opacity: 0, duration: 0.4}, beat(1));\ntl.to("#b", {x: 20, duration: 0.3, ease: "power2.out"}, beat(2) + 0.5)\n</script>';
const SCENE = `<style>#a { color: var(--yk-yellow); }</style>\n<div id="a">A &lt;b&gt;</div><svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg><div id="b">B</div>\n${TIMELINE}`;

// Renders a scene with the sample window, or with the given one.
function draw(html, win = WIN) {
  return design.render({ html }, win);
}

test("design puts the styles beside the piece root, the markup inside it, and runs the timeline with beat()", () => {
  const { html, timeline, endS } = draw(SCENE);
  assert.match(html, /^<style>\n#a \{ color: var\(--yk-yellow\); \}\n<\/style>\n<div id="p0-root" class="yk-piece yk-design">/);
  assert.match(html, /<div id="a">A &lt;b&gt;<\/div><svg/);
  assert.doesNotMatch(html, /<script/);
  assert.match(timeline, /const yapBeats = \[0,2,4,6,8\];\nconst beat = \(n\) => yapBeats\[n\];\nconst startS = 0;\nconst endS = 10;/);
  assert.match(timeline, /tl\.from\("#a", \{opacity: 0, duration: 0\.4\}, beat\(1\)\);/);
  assert.doesNotMatch(timeline, /comment/, "comments are dropped");
  // the piece still fades in and out over its window like every other piece
  assert.match(timeline, /^tl\.fromTo\("#p0-root"/);
  assert.equal(endS, 10);
});

test("design refuses markup that could run code, load files or link anywhere", () => {
  const cases = [
    ['<div><script>alert(1)</script></div>', /timeline|script/],
    ['<img src="x.png">', /<img>/],
    ['<iframe></iframe>', /<iframe>/],
    ['<link rel="stylesheet">', /<link>/],
    ['<svg><use href="#x"/></svg>', /<use>/],
    ['<div onclick="x()">a</div>', /onclick=/],
    ['<a href="https://example.com">a</a>', /href=/],
    ['<div style="x">javascript:alert(1)</div>', /javascript:/],
    ['<form></form>', /<form>/],
  ];
  for (const [markup, re] of cases) assert.throws(() => draw(`${markup}\n${TIMELINE}`), re, markup);
  assert.throws(() => draw(`<style>#a { background: url(x.png) }</style><div id="a"></div>\n${TIMELINE}`), /url\(\)/);
  assert.throws(() => draw(`<style>@import "x.css";</style><div id="a"></div>\n${TIMELINE}`), /@import/);
  assert.throws(() => draw(`\n${TIMELINE}`), /markup is empty/);
});

test("design timelines may only be tl.from / to / fromTo / set calls", () => {
  const scene = (code) => `<div id="a">a</div><script data-yap-timeline>${code}</script>`;
  assert.doesNotThrow(() => draw(scene('tl.set("#a", {opacity: 0}, 0); tl.fromTo("#a", {x: 0}, {x: 9, duration: 1}, startS + 1);')));
  // a selector with // in a string is not a comment
  assert.doesNotThrow(() => draw(scene('tl.set("#a[data-u=\'//x\']", {opacity: 0}, 0);')));
  const cases = [
    ["", /no tl calls/],
    ['tl.call(() => fetch("x"), [], 0);', /tl\.from|=>/],
    ['tl.to("#a", {onComplete: function () {}}, 0);', /function/],
    ['document.body.innerHTML = "";', /document/],
    ['tl.to("#a", {x: Math.random()}, 0);', /Math\.random/],
    ['tl.to("#a", {x: 1}, Date.now());', /Date/],
    ['window.x = 1;', /window/],
    ['tl.to("#a", {x: 1}, 0); alert(1);', /statement 2/],
    ['tl.to("#a", {x: 1}, 0) tl.to("#a", {x: 2}, 1);', /must end before the next/],
    ['tl.to("#a", {x: `1`}, 0);', /`/],
    ['tl.to("#a", {x: 1}, 0', /not closed/],
    ['tl.to("#a", {x: 1}, 0); /* open', /unclosed comment/],
  ];
  for (const [code, re] of cases) assert.throws(() => draw(scene(code)), re, code);
  assert.throws(() => draw('<div id="a">a</div>'), /needs one <script data-yap-timeline>/);
  assert.throws(() => draw(`<div id="a">a</div>${TIMELINE}${TIMELINE}`), /only one timeline/);
});

test("design beat() must name a sentence inside the piece's own window", () => {
  const scene = (b) => `<div id="a">a</div><script data-yap-timeline>tl.from("#a", {opacity: 0, duration: 0.4}, beat(${b}));</script>`;
  assert.doesNotThrow(() => draw(scene(4)));
  assert.throws(() => draw(scene(9)), /past the last sentence/);
  assert.throws(() => draw(scene("n")), /whole sentence index/);
  assert.throws(() => draw(scene(3), { ...WIN, durationS: 5 }), /beat\(3\) is a sentence outside this piece/);
  assert.throws(() => design.render({ html: scene(0) }, { startS: 0, durationS: 10 }), /beatsS/);
  assert.throws(() => draw("x".repeat(101 * 1024)), /over 100 KB/);
  // checkScene gives design the same sentence range as flow: its beat to the next piece's beat
  const entry = (b, beat) => ({ piece: "design", params: { html: scene(b) }, beat });
  assert.doesNotThrow(() => checkScene([entry(1, 1), { piece: "callout", params: { text: "T" }, beat: 3 }], 5));
  assert.throws(() => checkScene([entry(3, 1), { piece: "callout", params: { text: "T" }, beat: 3 }], 5), /scene\[0\]: design: beat\(3\)/);
});

test("scaffold copies a design scene file into chapter.json and refuses files outside the video folder", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yap-design-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scenes"));
  fs.writeFileSync(path.join(root, "scenes", "a.html"), SCENE);
  const spec = (file, id) => ({
    root, id, title: "T", sources: [],
    sentences: [{ text: "One.", kind: "framing", source_ids: [] }, { text: "Two.", kind: "framing", source_ids: [] }, { text: "Three.", kind: "framing", source_ids: [] }],
    scene: [{ piece: "design", params: { file }, beat: 0 }],
  });
  const dir = scaffoldChapter(spec("scenes/a.html", "made"));
  const chapter = JSON.parse(fs.readFileSync(path.join(dir, "chapter.json"), "utf8"));
  assert.deepEqual(chapter.scene[0].params, { html: SCENE });
  assert.throws(() => scaffoldChapter(spec("../outside.html", "out")), /outside/);
  assert.throws(() => scaffoldChapter(spec("scenes/missing.html", "missing")), /cannot read design file/);
  assert.equal(fs.existsSync(path.join(root, "chapters", "out")), false);
});
