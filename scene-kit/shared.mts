import { esc } from "./escape.mts";

// Ids end up inside CSS selectors and attributes, so only plain lowercase words and dashes are allowed.
const SAFE_PREFIX = /^[a-z][a-z0-9-]*$/;

// Longest fade at the start and end of a piece, in milliseconds.
const MAX_FADE_MS = 400;

// Check the params object exists, so a missing one gives a clear message instead of a crash.
function requireParams(params: unknown, piece: string): Record<string, unknown> {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new Error(`${piece}: params must be an object`);
  }
  // a non-null, non-array object was just proved above; its keys are only known to be strings
  return params as Record<string, unknown>;
}

// Read a required text value (string or number) and fail by name when it is missing or empty.
function requireText(value: unknown, name: string, piece: string): string {
  if ((typeof value !== "string" && typeof value !== "number") || String(value) === "") {
    throw new Error(`${piece}: "${name}" is required and must be non-empty text`);
  }
  return String(value);
}

// Read an optional text value; empty and missing both mean "not given".
function optionalText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

// The window a caller hands in: when the piece starts and how long it lasts, in seconds, plus an optional id prefix.
type WindowOpts = { startS?: unknown; durationS?: unknown; idPrefix?: unknown };

// The checked window: the id prefix and the start and length in whole milliseconds.
type Win = { idPrefix: string; startMs: number; durMs: number };

// Check the timing window and the id prefix, and return them with times converted to whole milliseconds.
function readWindow(opts: unknown, piece: string): Win {
  if (opts === null || typeof opts !== "object") throw new Error(`${piece}: window {startS, durationS} is required`);
  // opts was just proved to be a non-null object; each field is still checked below
  const o = opts as WindowOpts;
  const { startS, durationS } = o;
  if (typeof startS !== "number" || !Number.isFinite(startS) || startS < 0) {
    throw new Error(`${piece}: startS must be a number >= 0`);
  }
  if (typeof durationS !== "number" || !Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`${piece}: durationS must be a number > 0`);
  }
  const idPrefix = o.idPrefix === undefined ? piece : o.idPrefix;
  if (typeof idPrefix !== "string" || !SAFE_PREFIX.test(idPrefix)) {
    throw new Error(`${piece}: idPrefix must match ${SAFE_PREFIX}`);
  }
  const startMs = Math.round(startS * 1000);
  const durMs = Math.round(durationS * 1000);
  if (durMs < 1) throw new Error(`${piece}: durationS is too small`);
  return { idPrefix, startMs, durMs };
}

// Write whole milliseconds as seconds for the timeline snippet.
function sec(ms: number): string {
  return String(ms / 1000);
}

// Build one GSAP call line; `vars` is already a JS object literal with its duration inside.
function tween(method: string, selector: string, vars: string, atMs: number): string {
  return `tl.${method}(${JSON.stringify(selector)}, ${vars}, ${sec(atMs)});`;
}

// Build a GSAP vars literal: plain props plus a duration, and a stagger when one is wanted.
function vars(props: string, durMs: number, staggerMs?: number): string {
  const stagger = staggerMs ? `, stagger: ${sec(staggerMs)}` : "";
  return `{${props}, duration: ${sec(durMs)}${stagger}, ease: "power2.out"}`;
}

// The shared timing of a piece, in milliseconds.
type Plan = { fadeMs: number; bodyStart: number; bodySpan: number; endMs: number };

// Plan the shared timing: fade in, a body span for entrances (first half), fade out at the very end.
function plan({ startMs, durMs }: { startMs: number; durMs: number }): Plan {
  const fadeMs = Math.min(MAX_FADE_MS, Math.floor(durMs / 10));
  const bodyStart = startMs + fadeMs;
  const bodySpan = Math.floor(durMs / 2);
  return { fadeMs, bodyStart, bodySpan, endMs: startMs + durMs };
}

// Spread n entrances over the body span: returns each one's duration and the gap between starts.
function spread(n: number, bodySpan: number): { durMs: number; staggerMs: number } {
  const durMs = Math.max(1, Math.floor(bodySpan / 2));
  const staggerMs = n > 1 ? Math.floor((bodySpan - durMs) / (n - 1)) : 0;
  return { durMs, staggerMs };
}

// The fade-in and fade-out tweens that show the piece only inside its window.
function frameTweens(prefix: string, win: Win, p: Plan): string[] {
  const root = `#${prefix}-root`;
  const fadeIn = tween("fromTo", root, `{opacity: 0}, ${vars("opacity: 1", p.fadeMs)}`, win.startMs);
  return [fadeIn, tween("to", root, vars("opacity: 0", p.fadeMs), p.endMs - p.fadeMs)];
}

// What a piece hands back for the timeline: its snippet and the second it ends.
type Finished = { timeline: string; endS: number };

// A finished piece: its HTML plus the timeline snippet and end second.
type Rendered = Finished & { html: string };

// Join the lines into the snippet and report the last moment any tween ends.
function finish(lines: string[], endMs: number): Finished {
  return { timeline: lines.join("\n"), endS: endMs / 1000 };
}

export { esc, requireParams, requireText, optionalText, readWindow, sec, tween, vars, plan, spread, frameTweens, finish };
export type { WindowOpts, Win, Plan, Finished, Rendered };
