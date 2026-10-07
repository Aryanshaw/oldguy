import * as k from "./shared.mts";
import type { Rendered } from "./shared.mts";

// The widest code line the card shows on one row at 1080p; a longer line would wrap or be cut off on screen.
const MAX_CODE_COLUMNS = 68;
const TAB_COLUMNS = 4;

// How many columns a line takes on the card: one per character, four per tab.
function columns(text: string): number {
  return [...text].reduce((n, ch) => n + (ch === "\t" ? TAB_COLUMNS : 1), 0);
}

// One checked code line: its number label, its text and whether it is highlighted.
type CodeLine = { no: string; text: string; highlight: boolean };

// Check one code line; its text keeps every space and tab but can never add a second line or run past the card.
function readLine(line: unknown, i: number): CodeLine {
  if (line === null || typeof line !== "object") throw new Error(`code-card: lines[${i}] must be an object`);
  // line was just proved to be a non-null object; each field is checked by requireText or compared below
  const l = line as { text?: unknown; no?: unknown; highlight?: unknown };
  const text = k.requireText(l.text === "" ? " " : l.text, `lines[${i}].text`, "code-card").replace(/\r\n|\r|\n/g, " ");
  const width = columns(text);
  if (width > MAX_CODE_COLUMNS) {
    throw new Error(`code-card: lines[${i}] is ${width} columns wide, over the ${MAX_CODE_COLUMNS} that fit (a tab counts as ${TAB_COLUMNS}); `
      + "quote a shorter part of the line or pick other lines, never wrap");
  }
  return { no: k.optionalText(l.no), text, highlight: l.highlight === true };
}

// Write one line row; highlighted rows carry both a class and a data attribute.
function lineHtml(l: CodeLine): string {
  const mark = l.highlight ? ' og-hl" data-highlight="true' : "";
  return `<div class="og-line${mark}"><span class="og-no">${k.esc(l.no)}</span><span class="og-code">${k.esc(l.text)}</span></div>`;
}

// A file name header over code lines that appear in order, then the highlighted ones pop.
function render(params: unknown, opts: unknown): Rendered {
  const p = k.requireParams(params, "code-card");
  const file = k.requireText(p.file, "file", "code-card");
  if (!Array.isArray(p.lines)) throw new Error('code-card: "lines" is required and must be an array');
  const lines = p.lines.map(readLine);
  const win = k.readWindow(opts, "code-card");
  const id = win.idPrefix;
  const t = k.plan(win);

  const html =
    `<div id="${id}-root" class="og-piece og-code-card"><div class="og-card">` +
    `<div class="og-file og-wrap">${k.esc(file)}</div>` +
    `<div id="${id}-lines" class="og-lines">${lines.map(lineHtml).join("")}</div></div></div>`;

  const { durMs, staggerMs } = k.spread(Math.max(lines.length, 1), t.bodySpan);
  const tl = k.frameTweens(id, win, t);
  tl.push(k.tween("from", `#${id}-root .og-line`, k.vars("opacity: 0, xPercent: -4", durMs, staggerMs), t.bodyStart));
  // highlighted lines pop once every line is in, as a single tween (no stagger, so the end is fixed)
  if (lines.some((l) => l.highlight)) {
    const popAt = t.bodyStart + t.bodySpan;
    tl.push(k.tween("from", `#${id}-root .og-hl .og-code`, k.vars("opacity: 0.35, scale: 1.02", Math.floor(win.durMs / 10)), popAt));
  }
  return { html, ...k.finish(tl, t.endMs) };
}

export { render, MAX_CODE_COLUMNS };
