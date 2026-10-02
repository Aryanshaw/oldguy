"use strict";
const k = require("./shared.cjs");

// Check one step and return its label and detail as plain text.
function readItem(item, i) {
  if (item === null || typeof item !== "object") throw new Error(`steps: items[${i}] must be an object`);
  return { label: k.requireText(item.label, `items[${i}].label`, "steps"), detail: k.optionalText(item.detail) };
}

// Numbered steps that appear one after another; no items gives an empty fragment.
function render(params, opts) {
  const p = k.requireParams(params, "steps");
  if (!Array.isArray(p.items)) throw new Error('steps: "items" is required and must be an array');
  const items = p.items.map(readItem);
  const win = k.readWindow(opts, "steps");
  const id = win.idPrefix;
  const t = k.plan(win);
  if (items.length === 0) return { html: "", timeline: "", endS: win.startMs / 1000 };

  const rows = items.map(
    (it, i) =>
      `<div id="${id}-step-${i}" class="yk-step">` +
      `<span class="yk-step-num">${i + 1}</span>` +
      `<div class="yk-step-text"><div class="yk-step-label yk-wrap">${k.esc(it.label)}</div>` +
      (it.detail ? `<div class="yk-step-detail yk-wrap">${k.esc(it.detail)}</div>` : "") +
      `</div></div>`
  );
  const html = `<div id="${id}-root" class="yk-piece yk-steps">${rows.join("")}</div>`;

  // each step slides in a beat after the one before it
  const { durMs, staggerMs } = k.spread(items.length, t.bodySpan);
  const lines = k.frameTweens(id, win, t);
  lines.push(k.tween("from", `#${id}-root .yk-step`, k.vars("opacity: 0, xPercent: -8", durMs, staggerMs), t.bodyStart));
  return { html, ...k.finish(lines, t.endMs) };
}

module.exports = { render };
