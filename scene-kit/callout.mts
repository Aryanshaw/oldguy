import * as k from "./shared.mts";
import type { Rendered } from "./shared.mts";

// The only arrow directions a callout may point; anything else is rejected. (typed unknown[] so the unchecked pointTo can be tested against it)
const DIRECTIONS: unknown[] = ["up", "down", "left", "right"];

// A short note in a bubble whose arrow points the given way (default: down).
function render(params: unknown, opts: unknown): Rendered {
  const p = k.requireParams(params, "callout");
  const text = k.requireText(p.text, "text", "callout");
  const pointTo = p.pointTo === undefined ? "down" : p.pointTo;
  if (!DIRECTIONS.includes(pointTo)) throw new Error(`callout: "pointTo" must be one of ${DIRECTIONS.join(", ")}`);
  const win = k.readWindow(opts, "callout");
  const id = win.idPrefix;
  const t = k.plan(win);

  const html =
    `<div id="${id}-root" class="yk-piece yk-callout">` +
    `<div id="${id}-bubble" class="yk-bubble yk-point-${pointTo} yk-wrap" data-point-to="${pointTo}">${k.esc(text)}</div></div>`;

  // the bubble pops in with a small scale-up
  const { durMs } = k.spread(1, t.bodySpan);
  const lines = k.frameTweens(id, win, t);
  lines.push(k.tween("from", `#${id}-bubble`, k.vars("opacity: 0, scale: 0.85", durMs), t.bodyStart));
  return { html, ...k.finish(lines, t.endMs) };
}

export { render };
