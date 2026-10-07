import * as k from "./shared.mts";
import type { Rendered } from "./shared.mts";

// Lane ids end up in element ids, so they are plain lowercase words and dashes.
const LANE_ID = /^[a-z][a-z0-9-]*$/;
const MIN_LANES = 2;
const MAX_LANES = 5;
const MAX_STEPS = 14;
const MAX_STEPS_PER_LANE = 6;
// The only step kinds besides the plain one: a good outcome and a failure path.
const KINDS: unknown[] = ["ok", "fail"];
// How long a step takes to slide in, how far apart steps on the same sentence start, and how long a glow fades.
const ENTER_MS = 400;
const SAME_BEAT_GAP_MS = 250;
const GLOW_MS = 250;

// One column of the diagram: an id steps refer to, the name shown on top and an optional dim note under it.
type Lane = { id: string; label: string; note: string };
// One step: the lane it sits in, its text, the sentence it appears with and its kind ("" for plain).
type Step = { lane: string; label: string; detail: string; at: number; kind: string };

// Check one lane and return it as plain text.
function readLane(item: unknown, i: number): Lane {
  if (item === null || typeof item !== "object") throw new Error(`flow: lanes[${i}] must be an object`);
  // item was just proved to be a non-null object; each field is checked below
  const it = item as { id?: unknown; label?: unknown; note?: unknown };
  if (typeof it.id !== "string" || !LANE_ID.test(it.id)) throw new Error(`flow: lanes[${i}].id must match ${LANE_ID}`);
  return { id: it.id, label: k.requireText(it.label, `lanes[${i}].label`, "flow"), note: k.optionalText(it.note) };
}

// Check one step against the lanes and the sentence count it may point at.
function readStep(item: unknown, i: number, laneIds: string[]): Step {
  if (item === null || typeof item !== "object") throw new Error(`flow: steps[${i}] must be an object`);
  // item was just proved to be a non-null object; each field is checked below
  const it = item as { lane?: unknown; label?: unknown; detail?: unknown; at?: unknown; kind?: unknown };
  if (typeof it.lane !== "string" || !laneIds.includes(it.lane)) {
    throw new Error(`flow: steps[${i}].lane must be one of ${laneIds.join(", ")}`);
  }
  if (!Number.isInteger(it.at) || (it.at as number) < 0) throw new Error(`flow: steps[${i}].at must be a whole sentence index`);
  const kind = it.kind === undefined ? "" : it.kind;
  if (kind !== "" && !KINDS.includes(kind)) throw new Error(`flow: steps[${i}].kind must be one of ${KINDS.join(", ")}`);
  return {
    lane: it.lane,
    label: k.requireText(it.label, `steps[${i}].label`, "flow"),
    detail: k.optionalText(it.detail),
    at: it.at as number,
    kind: String(kind),
  };
}

// Read the sentence start times the caller hands in with the window (seconds, one per sentence).
function readBeats(opts: unknown): number[] {
  const beats = opts && typeof opts === "object" ? (opts as { beatsS?: unknown }).beatsS : undefined;
  if (!Array.isArray(beats) || !beats.every((b) => typeof b === "number" && Number.isFinite(b) && b >= 0)) {
    throw new Error("flow: the window needs beatsS, the start second of every sentence");
  }
  return beats;
}

// Check the whole diagram: lane count, unique ids, step count, steps per lane and sentence order.
function readDiagram(p: Record<string, unknown>): { lanes: Lane[]; steps: Step[] } {
  if (!Array.isArray(p.lanes)) throw new Error('flow: "lanes" is required and must be an array');
  if (p.lanes.length < MIN_LANES || p.lanes.length > MAX_LANES) throw new Error(`flow: use ${MIN_LANES} to ${MAX_LANES} lanes`);
  const lanes = p.lanes.map(readLane);
  const laneIds = lanes.map((l) => l.id);
  if (new Set(laneIds).size !== laneIds.length) throw new Error("flow: lane ids must be unique");
  if (!Array.isArray(p.steps) || p.steps.length === 0) throw new Error('flow: "steps" is required and must be a non-empty array');
  if (p.steps.length > MAX_STEPS) throw new Error(`flow: at most ${MAX_STEPS} steps`);
  const steps = p.steps.map((s, i) => readStep(s, i, laneIds));
  steps.forEach((s, i) => {
    if (i > 0 && s.at < steps[i - 1].at) throw new Error(`flow: steps[${i}].at must not be before the step above it`);
  });
  for (const id of laneIds) {
    if (steps.filter((s) => s.lane === id).length > MAX_STEPS_PER_LANE) throw new Error(`flow: at most ${MAX_STEPS_PER_LANE} steps in lane "${id}"`);
  }
  return { lanes, steps };
}

// When each step appears, in ms: its sentence's start, nudged after the entrance of the lanes, spaced when they share a
// sentence, and early enough to finish sliding in before the piece fades out.
function stepTimes(steps: Step[], beats: number[], win: k.Win, t: k.Plan): number[] {
  const endS = (win.startMs + win.durMs) / 1000;
  const earliest = t.bodyStart + ENTER_MS;
  const latest = t.endMs - t.fadeMs - ENTER_MS;
  return steps.map((s, i) => {
    if (s.at >= beats.length) throw new Error(`flow: steps[${i}].at is past the last sentence`);
    const beatS = beats[s.at];
    // a step's sentence must fall inside this piece's window, or it would appear on another piece's screen
    if (beatS < win.startMs / 1000 - 1e-6 || beatS >= endS) throw new Error(`flow: steps[${i}].at is a sentence outside this piece`);
    const sameBefore = steps.slice(0, i).filter((o) => o.at === s.at).length;
    const want = Math.round(beatS * 1000) + sameBefore * SAME_BEAT_GAP_MS;
    return Math.max(earliest, Math.min(want, latest));
  });
}

// The diagram's HTML: an optional header, then one column per lane holding its step cards (numbered in story order).
function html(id: string, kicker: string, heading: string, lanes: Lane[], steps: Step[]): string {
  const head = kicker || heading
    ? `<div id="${id}-head" class="yk-flow-head">` +
      (kicker ? `<div class="yk-flow-kicker yk-wrap">${k.esc(kicker)}</div>` : "") +
      (heading ? `<div class="yk-flow-title yk-wrap">${k.esc(heading)}</div>` : "") +
      `</div>`
    : "";
  const columns = lanes.map((lane, li) => {
    const cards = steps.map((s, si) => ({ s, si })).filter(({ s }) => s.lane === lane.id).map(({ s, si }) =>
      `<div id="${id}-step-${si}" class="yk-flow-step${s.kind ? ` yk-kind-${s.kind}` : ""}">` +
      `<span class="yk-flow-num">${si + 1}</span>` +
      `<div class="yk-flow-text"><div class="yk-flow-label yk-wrap">${k.esc(s.label)}</div>` +
      (s.detail ? `<div class="yk-flow-detail yk-wrap">${k.esc(s.detail)}</div>` : "") +
      `</div><div id="${id}-step-${si}-glow" class="yk-flow-glow"></div></div>`
    );
    return `<div id="${id}-lane-${li}" class="yk-lane yk-lane-c${li + 1}">` +
      `<div id="${id}-lane-${li}-glow" class="yk-lane-glow"></div>` +
      `<div class="yk-lane-head"><span class="yk-lane-dot"></span><span class="yk-lane-label yk-wrap">${k.esc(lane.label)}</span></div>` +
      (lane.note ? `<div class="yk-lane-note yk-wrap">${k.esc(lane.note)}</div>` : "") +
      `<div class="yk-lane-steps">${cards.join("")}</div></div>`;
  });
  return `<div id="${id}-root" class="yk-piece yk-flow">${head}<div class="yk-flow-lanes">${columns.join("")}</div></div>`;
}

// A diagram that stays on screen: lanes for the parts of a system, and numbered steps that appear in them sentence by
// sentence, the newest one and its lane lit up, so the viewer watches the state build instead of slides swapping.
function render(params: unknown, opts: unknown): Rendered {
  const p = k.requireParams(params, "flow");
  const kicker = k.optionalText(p.kicker);
  const heading = k.optionalText(p.heading);
  const { lanes, steps } = readDiagram(p);
  const win = k.readWindow(opts, "flow");
  const beats = readBeats(opts);
  const id = win.idPrefix;
  const t = k.plan(win);
  const times = stepTimes(steps, beats, win, t);
  const laneIndex = (laneId: string) => lanes.findIndex((l) => l.id === laneId);

  const lines = k.frameTweens(id, win, t);
  // the header and the empty lanes come in first, so the stage is never blank
  if (kicker || heading) lines.push(k.tween("from", `#${id}-head`, k.vars("opacity: 0, y: -16", ENTER_MS), t.bodyStart));
  lines.push(k.tween("from", `#${id}-root .yk-lane`, k.vars("opacity: 0, y: 24", ENTER_MS / 2, ENTER_MS / (2 * lanes.length)), t.bodyStart));
  steps.forEach((s, i) => {
    const at = times[i];
    const next = times.findIndex((tm, j) => j > i && tm > at);
    lines.push(k.tween("from", `#${id}-step-${i}`, k.vars("opacity: 0, y: 24", ENTER_MS), at));
    // the newest step glows until a later one appears
    lines.push(k.tween("fromTo", `#${id}-step-${i}-glow`, `{opacity: 0}, ${k.vars("opacity: 1", GLOW_MS)}`, at));
    if (next !== -1) lines.push(k.tween("to", `#${id}-step-${i}-glow`, k.vars("opacity: 0", GLOW_MS), times[next]));
    // its lane lights up while the story is in that lane
    const lane = laneIndex(s.lane);
    if (i === 0 || steps[i - 1].lane !== s.lane) {
      lines.push(k.tween("fromTo", `#${id}-lane-${lane}-glow`, `{opacity: 0}, ${k.vars("opacity: 1", GLOW_MS)}`, at));
    }
    if (next !== -1 && steps[next].lane !== s.lane) {
      lines.push(k.tween("to", `#${id}-lane-${lane}-glow`, k.vars("opacity: 0", GLOW_MS), times[next]));
    }
  });
  return { html: html(id, kicker, heading, lanes, steps), ...k.finish(lines, t.endMs) };
}

export { render };
