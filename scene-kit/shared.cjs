"use strict";
const { esc } = require("./escape.cjs");

// Ids end up inside CSS selectors and attributes, so only plain lowercase words and dashes are allowed.
const SAFE_PREFIX = /^[a-z][a-z0-9-]*$/;

// Longest fade at the start and end of a piece, in milliseconds.
const MAX_FADE_MS = 400;

// Check the params object exists, so a missing one gives a clear message instead of a crash.
function requireParams(params, piece) {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new Error(`${piece}: params must be an object`);
  }
  return params;
}

// Read a required text value (string or number) and fail by name when it is missing or empty.
function requireText(value, name, piece) {
  if ((typeof value !== "string" && typeof value !== "number") || String(value) === "") {
    throw new Error(`${piece}: "${name}" is required and must be non-empty text`);
  }
  return String(value);
}

// Read an optional text value; empty and missing both mean "not given".
function optionalText(value) {
  return value === undefined || value === null ? "" : String(value);
}

// Check the timing window and the id prefix, and return them with times converted to whole milliseconds.
function readWindow(opts, piece) {
  if (opts === null || typeof opts !== "object") throw new Error(`${piece}: window {startS, durationS} is required`);
  const { startS, durationS } = opts;
  if (typeof startS !== "number" || !Number.isFinite(startS) || startS < 0) {
    throw new Error(`${piece}: startS must be a number >= 0`);
  }
  if (typeof durationS !== "number" || !Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`${piece}: durationS must be a number > 0`);
  }
  const idPrefix = opts.idPrefix === undefined ? piece : opts.idPrefix;
  if (typeof idPrefix !== "string" || !SAFE_PREFIX.test(idPrefix)) {
    throw new Error(`${piece}: idPrefix must match ${SAFE_PREFIX}`);
  }
  const startMs = Math.round(startS * 1000);
  const durMs = Math.round(durationS * 1000);
  if (durMs < 1) throw new Error(`${piece}: durationS is too small`);
  return { idPrefix, startMs, durMs };
}

// Write whole milliseconds as seconds for the timeline snippet.
function sec(ms) {
  return String(ms / 1000);
}

// Build one GSAP call line; `vars` is already a JS object literal with its duration inside.
function tween(method, selector, vars, atMs) {
  return `tl.${method}(${JSON.stringify(selector)}, ${vars}, ${sec(atMs)});`;
}

// Build a GSAP vars literal: plain props plus a duration, and a stagger when one is wanted.
function vars(props, durMs, staggerMs) {
  const stagger = staggerMs ? `, stagger: ${sec(staggerMs)}` : "";
  return `{${props}, duration: ${sec(durMs)}${stagger}, ease: "power2.out"}`;
}

// Plan the shared timing: fade in, a body span for entrances (first half), fade out at the very end.
function plan({ startMs, durMs }) {
  const fadeMs = Math.min(MAX_FADE_MS, Math.floor(durMs / 10));
  const bodyStart = startMs + fadeMs;
  const bodySpan = Math.floor(durMs / 2);
  return { fadeMs, bodyStart, bodySpan, endMs: startMs + durMs };
}

// Spread n entrances over the body span: returns each one's duration and the gap between starts.
function spread(n, bodySpan) {
  const durMs = Math.max(1, Math.floor(bodySpan / 2));
  const staggerMs = n > 1 ? Math.floor((bodySpan - durMs) / (n - 1)) : 0;
  return { durMs, staggerMs };
}

// The fade-in and fade-out tweens that show the piece only inside its window.
function frameTweens(prefix, win, p) {
  const root = `#${prefix}-root`;
  const fadeIn = tween("fromTo", root, `{opacity: 0}, ${vars("opacity: 1", p.fadeMs)}`, win.startMs);
  return [fadeIn, tween("to", root, vars("opacity: 0", p.fadeMs), p.endMs - p.fadeMs)];
}

// Join the lines into the snippet and report the last moment any tween ends.
function finish(lines, endMs) {
  return { timeline: lines.join("\n"), endS: endMs / 1000 };
}

module.exports = { esc, requireParams, requireText, optionalText, readWindow, sec, tween, vars, plan, spread, frameTweens, finish };
