"use strict";
const k = require("./shared.cjs");

// Check one code line; its text keeps every space and tab but can never add a second line.
function readLine(line, i) {
  if (line === null || typeof line !== "object") throw new Error(`code-card: lines[${i}] must be an object`);
  const text = k.requireText(line.text === "" ? " " : line.text, `lines[${i}].text`, "code-card");
  return { no: k.optionalText(line.no), text: text.replace(/\r\n|\r|\n/g, " "), highlight: line.highlight === true };
}

// Write one line row; highlighted rows carry both a class and a data attribute.
function lineHtml(l) {
  const mark = l.highlight ? ' yk-hl" data-highlight="true' : "";
  return `<div class="yk-line${mark}"><span class="yk-no">${k.esc(l.no)}</span><span class="yk-code">${k.esc(l.text)}</span></div>`;
}

// A file name header over code lines that appear in order, then the highlighted ones pop.
function render(params, opts) {
  const p = k.requireParams(params, "code-card");
  const file = k.requireText(p.file, "file", "code-card");
  if (!Array.isArray(p.lines)) throw new Error('code-card: "lines" is required and must be an array');
  const lines = p.lines.map(readLine);
  const win = k.readWindow(opts, "code-card");
  const id = win.idPrefix;
  const t = k.plan(win);

  const html =
    `<div id="${id}-root" class="yk-piece yk-code-card"><div class="yk-card">` +
    `<div class="yk-file yk-wrap">${k.esc(file)}</div>` +
    `<div id="${id}-lines" class="yk-lines">${lines.map(lineHtml).join("")}</div></div></div>`;

  const { durMs, staggerMs } = k.spread(Math.max(lines.length, 1), t.bodySpan);
  const tl = k.frameTweens(id, win, t);
  tl.push(k.tween("from", `#${id}-root .yk-line`, k.vars("opacity: 0, xPercent: -4", durMs, staggerMs), t.bodyStart));
  // highlighted lines pop once every line is in, as a single tween (no stagger, so the end is fixed)
  if (lines.some((l) => l.highlight)) {
    const popAt = t.bodyStart + t.bodySpan;
    tl.push(k.tween("from", `#${id}-root .yk-hl .yk-code`, k.vars("opacity: 0.35, scale: 1.02", Math.floor(win.durMs / 10)), popAt));
  }
  return { html, ...k.finish(tl, t.endMs) };
}

module.exports = { render };
