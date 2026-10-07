import * as k from "./shared.mts";
import type { Rendered } from "./shared.mts";

// A scene Claude designs for one chapter: free markup, its own styles, and an animation timeline tied to sentences.
// The freedom is in what it draws; the guardrails below are checked in code, so a chapter page can still only animate
// its own text: no scripts, no event handlers, no loaded files or links, and a timeline made of GSAP tween calls only.

const MAX_BYTES = 100 * 1024;
const TIMELINE_OPEN = "<script data-oldguy-timeline>";
// Tags that could run code, load something or leave the page; markup may use any other HTML or inline SVG.
const BANNED_TAGS = /<\s*\/?\s*(script|iframe|frame|object|embed|link|meta|base|form|input|button|textarea|select|template|audio|video|img|image|use|foreignobject)\b/i;
// Attributes that run code or fetch something.
const BANNED_ATTRS = /\s(on[a-z]+|src|srcset|href|xlink:href|action|formaction|poster|data)\s*=/i;
// The only GSAP calls a timeline may make.
const TWEEN_CALL = /^tl\.(from|to|fromTo|set)\(/;
// Words a timeline may not contain: no functions, no globals, nothing that reads the clock or the network.
const BANNED_WORDS = /=>|\bfunction\b|\bnew\b|\beval\b|\bimport\b|\bfetch\b|\bwindow\b|\bdocument\b|\bglobalThis\b|\bthis\b|\bconstructor\b|\b__proto__\b|\bprototype\b|\bsetTimeout\b|\bsetInterval\b|\bMath\.random\b|\bDate\b|\brequire\b|`/;

// The three parts of a scene file: its styles, its markup and its timeline.
type Parts = { css: string; markup: string; timeline: string };

// Splits the scene into styles (every <style> block), the timeline (the one <script data-oldguy-timeline> block) and the
// markup (everything else), refusing a second timeline or one that is not closed.
function split(source: string): Parts {
  let css = "";
  let rest = source.replace(/<style>([\s\S]*?)<\/style>/gi, (_, body: string) => {
    css += `${body}\n`;
    return "";
  });
  const open = rest.indexOf(TIMELINE_OPEN);
  if (open === -1) throw new Error(`design: needs one ${TIMELINE_OPEN} block with the animation`);
  const close = rest.indexOf("</script>", open);
  if (close === -1) throw new Error("design: the timeline block is not closed with </script>");
  const timeline = rest.slice(open + TIMELINE_OPEN.length, close);
  rest = rest.slice(0, open) + rest.slice(close + "</script>".length);
  if (rest.includes(TIMELINE_OPEN)) throw new Error("design: only one timeline block is allowed");
  return { css, markup: rest, timeline };
}

// Refuses markup that could run code, load a file or link anywhere; repository text must be written escaped (&lt; &amp;).
function checkMarkup(markup: string): void {
  const tag = BANNED_TAGS.exec(markup);
  if (tag) throw new Error(`design: <${tag[1].toLowerCase()}> is not allowed in the markup`);
  const attr = BANNED_ATTRS.exec(markup);
  if (attr) throw new Error(`design: the ${attr[1].toLowerCase()}= attribute is not allowed`);
  if (/javascript:/i.test(markup)) throw new Error("design: javascript: is not allowed");
  if (!markup.trim()) throw new Error("design: the markup is empty");
}

// Refuses styles that load anything or could close the style block early.
function checkCss(css: string): void {
  if (/url\s*\(|@import|expression\s*\(|<\//i.test(css)) throw new Error("design: styles may not use url(), @import, expression() or </");
}

// Returns the timeline without comments, after proving it is only tl.from / to / fromTo / set calls, one after another.
function checkTimeline(timeline: string): string {
  // strings are kept whole while comments are dropped, so "//" inside a selector is not taken for a comment
  let code = "";
  for (let i = 0; i < timeline.length; i++) {
    const c = timeline[i];
    if (c === '"' || c === "'") {
      const end = timeline.indexOf(c, i + 1);
      if (end === -1) throw new Error("design: the timeline has an unclosed string");
      code += timeline.slice(i, end + 1);
      i = end;
    } else if (c === "/" && timeline[i + 1] === "/") {
      const nl = timeline.indexOf("\n", i);
      i = nl === -1 ? timeline.length : nl - 1;
    } else if (c === "/" && timeline[i + 1] === "*") {
      const end = timeline.indexOf("*/", i + 2);
      if (end === -1) throw new Error("design: the timeline has an unclosed comment");
      i = end + 1;
    } else {
      code += c;
    }
  }
  const words = BANNED_WORDS.exec(code.replace(/"[^"]*"|'[^']*'/g, '""'));
  if (words) throw new Error(`design: the timeline may only call tl.from, tl.to, tl.fromTo and tl.set (found "${words[0]}")`);
  // walk the calls: each starts with tl.<method>( and runs to its matching ), then an optional ;
  let i = 0;
  let calls = 0;
  while (i < code.length) {
    while (i < code.length && /[\s;]/.test(code[i])) i++;
    if (i >= code.length) break;
    if (!TWEEN_CALL.test(code.slice(i))) throw new Error(`design: timeline statement ${calls + 1} must start with tl.from, tl.to, tl.fromTo or tl.set`);
    let depth = 0;
    let j = code.indexOf("(", i);
    for (; j < code.length; j++) {
      const c = code[j];
      if (c === '"' || c === "'") j = code.indexOf(c, j + 1);
      else if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") depth--;
      if (depth === 0) break;
    }
    if (depth !== 0) throw new Error(`design: timeline statement ${calls + 1} is not closed`);
    calls++;
    i = j + 1;
    while (i < code.length && /[ \t]/.test(code[i])) i++;
    if (i < code.length && !/[;\n\r]/.test(code[i])) throw new Error(`design: timeline statement ${calls} must end before the next one starts`);
  }
  if (calls === 0) throw new Error("design: the timeline has no tl calls");
  return code;
}

// The sentence indexes the timeline uses through beat(n); each must start inside this piece's window.
function checkBeats(code: string, beats: number[], win: k.Win): void {
  const startS = win.startMs / 1000;
  const endS = (win.startMs + win.durMs) / 1000;
  for (const m of code.matchAll(/\bbeat\(\s*([^)]*?)\s*\)/g)) {
    if (!/^\d+$/.test(m[1])) throw new Error(`design: beat() takes a whole sentence index, not "${m[1]}"`);
    const n = Number(m[1]);
    if (n >= beats.length) throw new Error(`design: beat(${n}) is past the last sentence`);
    if (beats[n] < startS - 1e-6 || beats[n] >= endS) throw new Error(`design: beat(${n}) is a sentence outside this piece`);
  }
}

// Read the sentence start times the caller hands in with the window (seconds, one per sentence).
function readBeats(opts: unknown): number[] {
  const beats = opts && typeof opts === "object" ? (opts as { beatsS?: unknown }).beatsS : undefined;
  if (!Array.isArray(beats) || !beats.every((b) => typeof b === "number" && Number.isFinite(b) && b >= 0)) {
    throw new Error("design: the window needs beatsS, the start second of every sentence");
  }
  return beats;
}

// Renders a designed scene: the checked markup inside the piece root, its styles beside it, and its timeline run with
// beat(n) (when sentence n starts), startS and endS (this piece's window, seconds) in scope.
function render(params: unknown, opts: unknown): Rendered {
  const p = k.requireParams(params, "design");
  const source = k.requireText(p.html, "html", "design");
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) throw new Error(`design: the scene is over ${MAX_BYTES / 1024} KB`);
  const { css, markup, timeline } = split(source);
  checkMarkup(markup);
  checkCss(css);
  const code = checkTimeline(timeline);
  const win = k.readWindow(opts, "design");
  const beats = readBeats(opts);
  checkBeats(code, beats, win);
  const id = win.idPrefix;
  const t = k.plan(win);

  const html = (css.trim() ? `<style>\n${css}</style>\n` : "") + `<div id="${id}-root" class="yk-piece yk-design">${markup}</div>`;
  const lines = k.frameTweens(id, win, t);
  // a block keeps the helpers private to this piece; beat(n) reads a fixed list, so the page stays deterministic
  lines.push(
    "{",
    `const oldguyBeats = ${JSON.stringify(beats)};`,
    "const beat = (n) => oldguyBeats[n];",
    `const startS = ${k.sec(win.startMs)};`,
    `const endS = ${k.sec(t.endMs)};`,
    code.trim(),
    "}",
  );
  return { html, ...k.finish(lines, t.endMs) };
}

export { render };
