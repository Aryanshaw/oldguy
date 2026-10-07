import * as k from "./shared.mts";
import type { Rendered } from "./shared.mts";

// Check one step and return its label and detail as plain text.
function readItem(item: unknown, i: number): { label: string; detail: string } {
  if (item === null || typeof item !== "object") throw new Error(`steps: items[${i}] must be an object`);
  // item was just proved to be a non-null object; each field is checked by requireText or optionalText
  const it = item as { label?: unknown; detail?: unknown };
  return { label: k.requireText(it.label, `items[${i}].label`, "steps"), detail: k.optionalText(it.detail) };
}

// Numbered steps that appear one after another; no items gives an empty fragment.
function render(params: unknown, opts: unknown): Rendered {
  const p = k.requireParams(params, "steps");
  if (!Array.isArray(p.items)) throw new Error('steps: "items" is required and must be an array');
  const items = p.items.map(readItem);
  const win = k.readWindow(opts, "steps");
  const id = win.idPrefix;
  const t = k.plan(win);
  if (items.length === 0) return { html: "", timeline: "", endS: win.startMs / 1000 };

  const rows = items.map(
    (it, i) =>
      `<div id="${id}-step-${i}" class="og-step">` +
      `<span class="og-step-num">${i + 1}</span>` +
      `<div class="og-step-text"><div class="og-step-label og-wrap">${k.esc(it.label)}</div>` +
      (it.detail ? `<div class="og-step-detail og-wrap">${k.esc(it.detail)}</div>` : "") +
      `</div></div>`
  );
  const html = `<div id="${id}-root" class="og-piece og-steps">${rows.join("")}</div>`;

  // each step slides in a beat after the one before it
  const { durMs, staggerMs } = k.spread(items.length, t.bodySpan);
  const lines = k.frameTweens(id, win, t);
  lines.push(k.tween("from", `#${id}-root .og-step`, k.vars("opacity: 0, xPercent: -8", durMs, staggerMs), t.bodyStart));
  return { html, ...k.finish(lines, t.endMs) };
}

export { render };
