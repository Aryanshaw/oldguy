import * as k from "./shared.mts";
import type { Rendered } from "./shared.mts";

// Title card: a big heading with an optional smaller line under it.
function render(params: unknown, opts: unknown): Rendered {
  const p = k.requireParams(params, "title");
  const heading = k.requireText(p.heading, "heading", "title");
  const sub = k.optionalText(p.sub);
  const win = k.readWindow(opts, "title");
  const id = win.idPrefix;
  const t = k.plan(win);

  const html =
    `<div id="${id}-root" class="og-piece og-title">` +
    `<h1 id="${id}-heading" class="og-heading og-wrap">${k.esc(heading)}</h1>` +
    (sub ? `<p id="${id}-sub" class="og-sub og-wrap">${k.esc(sub)}</p>` : "") +
    `</div>`;

  // heading rises in first, the sub line follows half an entrance later
  const { durMs } = k.spread(1, t.bodySpan);
  const lines = k.frameTweens(id, win, t);
  lines.push(k.tween("from", `#${id}-heading`, k.vars("opacity: 0, yPercent: 30", durMs), t.bodyStart));
  if (sub) lines.push(k.tween("from", `#${id}-sub`, k.vars("opacity: 0, yPercent: 30", durMs), t.bodyStart + Math.floor(durMs / 2)));
  return { html, ...k.finish(lines, t.endMs) };
}

export { render };
