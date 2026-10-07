"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const kitDir = path.join(__dirname, "..", "scene-kit");
const { esc } = require(path.join(kitDir, "escape.mts"));
const title = require(path.join(kitDir, "title.mts"));
const steps = require(path.join(kitDir, "steps.mts"));
const codeCard = require(path.join(kitDir, "code-card.mts"));
const callout = require(path.join(kitDir, "callout.mts"));

const EVIL1 = "</div><script>alert(1)</script>";
const EVIL2 = '" onload="x';
const WIN = { startS: 2, durationS: 6 };

// Pull every id="..." value out of a fragment.
function idsOf(html) {
  return [...html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]);
}

// Fail if the fragment could run script: a script tag or any on...= attribute.
function assertNoScript(html) {
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<[^>]*\son\w+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /https?:\/\//i);
}

// Read every tween in a snippet as {pos, dur, stagger}; n is the element count a stagger spreads over.
function tweens(snippet) {
  const out = [];
  for (const m of snippet.matchAll(/tl\.\w+\([^;]*?\}, ([\d.]+)\);/g)) {
    const body = m[0];
    const dur = Number(/duration: ([\d.]+)/.exec(body)[1]);
    const st = /stagger: ([\d.]+)/.exec(body);
    out.push({ pos: Number(m[1]), dur, stagger: st ? Number(st[1]) : 0 });
  }
  return out;
}

// Check every tween is absolute, inside the window, and that endS is the real last end.
function assertTimeline(res, win, n) {
  const ts = tweens(res.timeline);
  assert.ok(ts.length > 0);
  const eps = 1e-6;
  let last = 0;
  for (const t of ts) {
    const end = t.pos + t.dur + t.stagger * Math.max(n - 1, 0);
    assert.ok(t.pos >= 0 && t.pos >= win.startS - eps, `pos ${t.pos}`);
    assert.ok(end <= win.startS + win.durationS + eps, `end ${end}`);
    last = Math.max(last, end);
  }
  assert.ok(Math.abs(last - res.endS) < eps, `endS ${res.endS} vs ${last}`);
  assert.ok(res.endS <= win.startS + win.durationS + eps);
}

const pieces = {
  title: (o, w) => title.render({ heading: "H", sub: "S", ...o }, w),
  steps: (o, w) => steps.render({ items: [{ label: "L", detail: "D" }], ...o }, w),
  "code-card": (o, w) => codeCard.render({ file: "a.js", lines: [{ no: 1, text: "x" }], ...o }, w),
  callout: (o, w) => callout.render({ text: "T", pointTo: "left", ...o }, w),
};

// esc: one row per dangerous or odd input.
test("esc table", () => {
  const rows = [
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&#39;"],
    ["`", "&#96;"],
    ["héllo ✓ 日本 😀", "héllo ✓ 日本 😀"],
    [null, ""],
    [undefined, ""],
    [42, "42"],
    [0, "0"],
    [true, "true"],
    ["a&lt;b", "a&amp;lt;b"],
  ];
  for (const [input, want] of rows) assert.equal(esc(input), want, String(input));
  assert.doesNotMatch(esc(EVIL1 + EVIL2), /[<>"]/);
});

test("each piece puts its params in the html", () => {
  assert.match(pieces.title({ heading: "Hello", sub: "World" }, WIN).html, /Hello[\s\S]*World/);
  const s = pieces.steps({ items: [{ label: "First", detail: "Does A" }] }, WIN).html;
  assert.match(s, /First/);
  assert.match(s, /Does A/);
  const c = pieces["code-card"]({ file: "src/app.js", lines: [{ no: 7, text: "run()" }] }, WIN).html;
  assert.match(c, /src\/app\.js/);
  assert.match(c, /run\(\)/);
  assert.match(c, />7</);
  const k = pieces.callout({ text: "Look here" }, WIN).html;
  assert.match(k, /Look here/);
});

test("hostile text in every text param is escaped, no script or handlers", () => {
  for (const evil of [EVIL1, EVIL2, EVIL1 + EVIL2]) {
    const outs = [
      pieces.title({ heading: evil, sub: evil }, WIN).html,
      pieces.steps({ items: [{ label: evil, detail: evil }] }, WIN).html,
      pieces["code-card"]({ file: evil, lines: [{ no: evil, text: evil, highlight: true }] }, WIN).html,
      pieces.callout({ text: evil }, WIN).html,
    ];
    for (const html of outs) {
      assertNoScript(html);
      assert.match(html, /&lt;\/div&gt;&lt;script&gt;|&quot; onload=&quot;x/);
    }
  }
});

test("hostile idPrefix and enum values are rejected", () => {
  for (const bad of ['a" onload="x', "a b", "<s>", "", "9x"]) {
    assert.throws(() => title.render({ heading: "H" }, { ...WIN, idPrefix: bad }), /idPrefix/);
  }
  assert.throws(() => callout.render({ text: "T", pointTo: '"><script>' }, WIN), /pointTo/);
});

test("missing or bad params throw an Error naming the param", () => {
  const cases = [
    [() => title.render({}, WIN), /heading/],
    [() => title.render({ heading: "" }, WIN), /heading/],
    [() => title.render({ heading: null }, WIN), /heading/],
    [() => title.render(undefined, WIN), /params/],
    [() => steps.render({}, WIN), /items/],
    [() => steps.render({ items: "x" }, WIN), /items/],
    [() => steps.render({ items: [{ detail: "d" }] }, WIN), /label/],
    [() => steps.render({ items: [null] }, WIN), /items\[0\]/],
    [() => codeCard.render({ lines: [] }, WIN), /file/],
    [() => codeCard.render({ file: "f" }, WIN), /lines/],
    [() => codeCard.render({ file: "f", lines: [{ no: 1 }] }, WIN), /text/],
    [() => callout.render({}, WIN), /text/],
    [() => title.render({ heading: "H" }), /startS|durationS|window/],
    [() => title.render({ heading: "H" }, { startS: -1, durationS: 5 }), /startS/],
    [() => title.render({ heading: "H" }, { startS: 0, durationS: 0 }), /durationS/],
    [() => title.render({ heading: "H" }, { startS: 0, durationS: NaN }), /durationS/],
  ];
  for (const [fn, re] of cases) {
    assert.throws(fn, (e) => e instanceof Error && !(e instanceof TypeError) && re.test(e.message), String(re));
  }
});

test("steps with 0 items returns an empty fragment", () => {
  const r = steps.render({ items: [] }, WIN);
  assert.equal(r.html, "");
  assert.equal(r.timeline, "");
  assert.equal(r.endS, WIN.startS);
});

test("steps wraps long labels instead of overflowing", () => {
  const long = "x".repeat(500);
  const html = pieces.steps({ items: [{ label: long, detail: long }] }, WIN).html;
  assert.match(html, /class="[^"]*og-wrap/);
  const css = fs.readFileSync(path.join(kitDir, "theme.css"), "utf8");
  assert.match(css, /\.og-wrap\s*\{[^}]*max-width:[^}]*overflow-wrap:\s*anywhere/);
});

test("code-card marks exactly the highlighted lines, by data attribute and class", () => {
  const lines = [1, 2, 3, 4, 5].map((n) => ({ no: n, text: "l" + n, highlight: n === 2 || n === 4 }));
  const html = pieces["code-card"]({ lines }, WIN).html;
  const rows = html.match(/<div class="og-line[^>]*>/g);
  assert.equal(rows.length, 5);
  const hl = rows.filter((r) => /data-highlight="true"/.test(r));
  assert.equal(hl.length, 2);
  assert.equal(rows.filter((r) => /og-hl/.test(r)).length, 2);
  assert.ok(hl.every((r) => /og-hl/.test(r)));
});

test("code-card emits exactly the lines given, no extras, even for 200", () => {
  const lines = Array.from({ length: 200 }, (_, i) => ({ no: i + 1, text: "row" + i }));
  const html = pieces["code-card"]({ lines }, WIN).html;
  assert.equal((html.match(/<div class="og-line[ "]/g) || []).length, 200);
  const empty = pieces["code-card"]({ lines: [] }, WIN).html;
  assert.equal((empty.match(/<div class="og-line[ "]/g) || []).length, 0);
});

test("code-card keeps leading spaces via white-space: pre, not nbsp", () => {
  const html = pieces["code-card"]({ lines: [{ no: 1, text: "    if (x) {\t}" }] }, WIN).html;
  assert.match(html, /<span class="og-code">    if \(x\) \{\t\}<\/span>/);
  assert.doesNotMatch(html, /&nbsp;| |&#160;/);
  const css = fs.readFileSync(path.join(kitDir, "theme.css"), "utf8");
  assert.match(css, /\.og-code\s*\{[^}]*white-space:\s*pre\b/);
});

test("timelines are absolute, non-negative and end inside the window", () => {
  const wins = [WIN, { startS: 0, durationS: 1 }, { startS: 37.123, durationS: 0.4 }, { startS: 100, durationS: 90 }];
  for (const w of wins) {
    assertTimeline(pieces.title({}, w), w, 1);
    assertTimeline(pieces.steps({ items: [1, 2, 3, 4, 5].map((n) => ({ label: "s" + n, detail: "d" })) }, w), w, 5);
    assertTimeline(pieces["code-card"]({ lines: Array.from({ length: 200 }, (_, i) => ({ no: i, text: "t", highlight: i === 3 })) }, w), w, 200);
    assertTimeline(pieces["code-card"]({ lines: [{ no: 1, text: "t" }] }, w), w, 1);
    assertTimeline(pieces.callout({}, w), w, 1);
  }
});

test("timeline references only this piece's ids and contains no unsafe code", () => {
  const r = pieces.title({}, { ...WIN, idPrefix: "t-one" });
  assert.match(r.timeline, /#t-one-root/);
  assert.doesNotMatch(r.timeline, /<|document\.|eval|Function|fetch|import/);
});

test("two pieces with different idPrefix values have disjoint ids", () => {
  for (const name of Object.keys(pieces)) {
    const a = idsOf(pieces[name]({}, { ...WIN, idPrefix: name + "-a" }).html);
    const b = idsOf(pieces[name]({}, { ...WIN, idPrefix: name + "-b" }).html);
    assert.ok(a.length > 0, name);
    assert.equal(new Set(a).size, a.length, "unique within piece");
    assert.deepEqual(a.filter((x) => b.includes(x)), [], name);
  }
});

test("pieces are deterministic and default the prefix to the piece name", () => {
  const a = pieces.title({}, WIN);
  assert.deepEqual(a, pieces.title({}, WIN));
  assert.ok(idsOf(a.html).every((i) => i.startsWith("title")));
});

test("theme.css has the tokens, no external urls, and states contrast ratios", () => {
  const css = fs.readFileSync(path.join(kitDir, "theme.css"), "utf8");
  for (const t of ["--og-yellow", "--og-orange", "--og-black", "--og-text", "--og-size-title", "--og-size-body", "--og-size-code"]) {
    assert.ok(css.includes(t + ":"), t);
  }
  assert.doesNotMatch(css, /url\(|@import|https?:/);
  assert.match(css, /contrast/i);
});

test("pieces use no raw pixel sizes in markup", () => {
  for (const name of Object.keys(pieces)) {
    assert.doesNotMatch(pieces[name]({}, WIN).html, /\d\s*px/);
  }
});

// A code line of n plain characters.
const codeLine = (n) => ({ no: 1, text: "x".repeat(n) });

test("code-card fits 68 columns and refuses 69, naming the line index and its length", () => {
  assert.equal(codeCard.MAX_CODE_COLUMNS, 68);
  assert.doesNotThrow(() => codeCard.render({ file: "a.js", lines: [codeLine(68)] }, WIN));
  assert.throws(() => codeCard.render({ file: "a.js", lines: [codeLine(3), codeLine(69)] }, WIN),
    /code-card: lines\[1\] is 69 columns wide, over the 68 that fit/);
});

test("code-card counts a tab as 4 columns", () => {
  assert.doesNotThrow(() => codeCard.render({ file: "a.js", lines: [{ text: `\t${"x".repeat(64)}` }] }, WIN));
  assert.throws(() => codeCard.render({ file: "a.js", lines: [{ text: `\t${"x".repeat(65)}` }] }, WIN), /lines\[0\] is 69 columns/);
});

test("code-card refuses a 200-character line and says to quote a shorter part, never wrap", () => {
  assert.throws(() => codeCard.render({ file: "a.js", lines: [codeLine(200)] }, WIN),
    /lines\[0\] is 200 columns wide.*quote a shorter part of the line or pick other lines/);
});

test("code-card keeps tabs 4 columns wide on screen, matching the count", () => {
  const css = fs.readFileSync(path.join(kitDir, "theme.css"), "utf8");
  assert.match(css, /\.og-code \{[^}]*tab-size: 4;/);
});
