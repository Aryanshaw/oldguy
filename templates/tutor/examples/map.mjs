// The tutor's map scene: the same four lanes on top in every chapter, and a band under them that zooms into one lane
// (real code, a record's rows, two settings side by side, a what-if). Code never replaces the map: it sits in the band,
// under the lane it belongs to, so the viewer never loses where the example is. Writes a `design` scene file.
//
//   import { mapScene } from '<repo>/templates/tutor/examples/map.mjs';
//   fs.writeFileSync('scenes/the-timing.html', mapScene({ kicker, title, cards, panels, lights }));
//
// cards:  [{ id, lane, label, detail?, at, done? }]   a card appears on sentence `at` and stays; `done` cards are the
//         stops the example already passed (shown dimmed from sentence 0). The newest card glows, older ones dim.
// lights: [{ at, cards: [id...], after? }]              light cards again later (the quick check's value, the recap),
//         `after` seconds into sentence `at`.
// panels: [{ id, lane?, at, until?, title (HTML, escaped), code?: [{ no, text, key?, mute? }], size?, lit?: [{ no, at }],
//         table?: { head, rows } }]
//         one at a time in the band; `lane` points the band at that lane. A code line lights on its sentence (the key
//         part bold), the line lit before it goes back to plain. `mute` (a part of the line, or the whole line) is drawn
//         faint: the part nobody names aloud, kept so the line stays whole. `size` (px, default 40) is the code's size;
//         below 40 long lines wrap under themselves instead of running off the band. A table cell is a plain string (there from the start) or
//         { text, at, until?, then?: { text, at } } (`then` takes the cell's place on its sentence: a what-if's
//         answer); `table.first` is the first column's width in px.
// Code lines must be whole repository lines: pass them through lineAt() so they are read, never typed.
import fs from 'node:fs';
import path from 'node:path';

const LANES = [
  { id: 'script', label: 'Script', colour: 'var(--og-yellow)' },
  { id: 'voice', label: 'Voice', colour: 'var(--og-green)' },
  { id: 'timing', label: 'Timing', colour: 'var(--og-orange)' },
  { id: 'page', label: 'Page', colour: 'var(--og-blue)' },
];
// 1920x1080 stage: header, then four lanes, then the band
const X0 = 64;
const WIDTH = 1792;
const GAP = 40;
const LANE_W = (WIDTH - GAP * (LANES.length - 1)) / LANES.length;
const LANE_TOP = 188;
const LANE_H = 488;
const BAND_TOP = LANE_TOP + LANE_H + 22;
const BAND_H = 1048 - BAND_TOP;
const DIM = 0.6;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const laneX = (i) => X0 + i * (LANE_W + GAP);
const t = (at, plus = 0) => `beat(${at}) + ${plus.toFixed(2)}`;

// One whole line of a repository file, by its 1-based number, as a code line for a panel.
// `mute` is a part of the line (or the whole line) to draw faint because the voice does not name it.
function lineAt(repo, file, no, key, mute) {
  const text = fs.readFileSync(path.join(repo, file), 'utf8').split('\n')[no - 1];
  if (text === undefined) throw new Error(`${file} has no line ${no}`);
  if (key && !text.includes(key)) throw new Error(`${file}:${no} does not hold ${key}`);
  if (mute && !text.includes(mute)) throw new Error(`${file}:${no} does not hold ${mute}`);
  return { no, text: text.trimEnd(), ...(key ? { key } : {}), ...(mute ? { mute } : {}) };
}

function codeHtml(p) {
  // the common indent is dropped so short lines sit left; the rest of each line is kept as it is
  const indent = Math.min(...p.code.map((l) => l.text.match(/^ */)[0].length));
  const rows = p.code.map((l) => {
    const body = l.text.slice(indent);
    let inner = l.key ? esc(body).replace(esc(l.key), `<b>${esc(l.key)}</b>`) : esc(body);
    if (l.mute) {
      const m = esc(l.mute.trim());
      if (l.key && l.mute.includes(l.key)) throw new Error(`line ${l.no}: the key part cannot be muted`);
      inner = inner.replace(m, `<i class="mute">${m}</i>`);
    }
    return `<div class="cl"><div id="${p.id}-l${l.no}" class="hl"></div><code id="${p.id}-l${l.no}-n" class="no">${l.no}</code><pre id="${p.id}-l${l.no}-t">${inner}</pre></div>`;
  });
  const size = p.size ?? 40;
  return `<div class="code${size < 40 ? ' wrap' : ''}" style="--cs: ${size}px">${rows.join('')}</div>`;
}

function tableHtml(p) {
  const { head, rows } = p.table;
  const cols = head.length;
  const cell = (c, r, i) => {
    const txt = typeof c === 'string' ? { text: c } : c;
    const then = txt.then ? `<span id="${p.id}-r${r}c${i}-b" class="then">${esc(txt.then.text)}</span>` : '';
    return `<div id="${p.id}-r${r}c${i}" class="td${i === 0 ? ' rh' : ''}"><span id="${p.id}-r${r}c${i}-a">${esc(txt.text)}</span>${then}</div>`;
  };
  return `<div class="tbl" style="grid-template-columns: ${p.table.first ?? 300}px repeat(${cols - 1}, 1fr)">` +
    head.map((h) => `<div class="th">${esc(h)}</div>`).join('') +
    rows.map((row, r) => row.map((c, i) => cell(c, r, i)).join('')).join('') + '</div>';
}

// The scene file: styles, markup and a timeline of tl.set / tl.to calls only.
function mapScene({ kicker, title, cards, panels = [], lights = [], scope = 'tm' }) {
  const S = `#${scope}`;
  const byLane = (id) => cards.filter((c) => c.lane === id);
  for (const c of cards) if (!LANES.some((l) => l.id === c.lane)) throw new Error(`card ${c.id}: no lane ${c.lane}`);
  const num = new Map(cards.map((c, i) => [c.id, i + 1]));

  const css = `<style>
${S} .og-kicker, ${S} .og-title { left: ${X0}px; }
${S} .lane { position: absolute; top: ${LANE_TOP}px; width: ${LANE_W}px; height: ${LANE_H}px; box-sizing: border-box; padding: 14px 12px; background: var(--og-panel); border: 3px solid var(--og-line); }
${S} .lane-glow { position: absolute; inset: -3px; border: 4px solid var(--lane); opacity: 0; }
${S} .head { display: flex; align-items: center; gap: 12px; font: 900 38px var(--og-font); letter-spacing: 0.06em; text-transform: uppercase; color: var(--lane); }
${S} .dot { width: 16px; height: 16px; border-radius: 50%; background: var(--lane); }
${S} .arrow { position: absolute; top: ${LANE_TOP + 22}px; width: 0; height: 0; border-style: solid; border-width: 18px 0 18px 26px; border-color: transparent transparent transparent var(--og-orange); }
${S} .cards { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
${S} .card { position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 6px 10px; background: var(--og-step-bg); border: 2px solid var(--og-line); }
${S} .num { flex: none; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: 900 24px var(--og-font); background: var(--lane); color: var(--og-black); }
${S} .lab { font: 800 32px/1.15 var(--og-font); color: var(--og-text); }
${S} .det { margin-top: 2px; font: 600 30px/1.2 var(--og-font); color: var(--og-dim); }
${S} .glow { position: absolute; inset: -2px; border: 4px solid var(--lane); opacity: 0; }
${S} .band { position: absolute; left: ${X0}px; top: ${BAND_TOP}px; width: ${WIDTH}px; height: ${BAND_H}px; box-sizing: border-box; background: var(--og-panel); border: 3px solid var(--og-line); }
${S} .panel { position: absolute; left: ${X0}px; top: ${BAND_TOP}px; width: ${WIDTH}px; height: ${BAND_H}px; box-sizing: border-box; padding: 18px 32px; border: 4px solid var(--lane); background: var(--og-panel); }
${S} .tip { position: absolute; top: -30px; width: 0; height: 0; border-style: solid; border-width: 0 22px 26px 22px; border-color: transparent transparent var(--lane) transparent; }
${S} .ptitle { font: 800 28px var(--og-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--lane); }
${S} .ptitle code { font: 700 28px var(--og-font-mono); letter-spacing: 0; text-transform: none; }
${S} .code { margin-top: 18px; display: flex; flex-direction: column; gap: 10px; }
${S} .cl { position: relative; display: flex; gap: 28px; padding: 8px 16px; }
${S} .hl { position: absolute; inset: 0; background: var(--og-yellow); opacity: 0; }
${S} .cl .no, ${S} .cl pre { position: relative; margin: 0; font: 400 var(--cs, 40px)/1.25 var(--og-font-mono); font-variant-ligatures: none; white-space: pre; color: var(--og-text); }
${S} .cl .no { flex: none; width: 80px; text-align: right; color: var(--og-yellow); }
${S} .code.wrap { margin-top: 10px; gap: 2px; }
${S} .code.wrap .cl { padding: 3px 16px; }
${S} .code.wrap pre { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; padding-left: 2ch; text-indent: -2ch; }
${S} .cl pre i.mute { font-style: normal; opacity: 0.45; }
${S} .cl pre b { font-weight: 800; text-decoration: underline; text-decoration-thickness: 4px; text-underline-offset: 8px; }
${S} .tbl { margin-top: 12px; display: grid; column-gap: 24px; row-gap: 10px; }
${S} .th { font: 700 26px var(--og-font); letter-spacing: 0.06em; text-transform: uppercase; color: var(--og-dim); }
${S} .td { font: 800 34px/1.2 var(--og-font); color: var(--og-text); }
${S} .td { position: relative; }
${S} .then { position: absolute; left: 0; top: 0; white-space: nowrap; color: var(--og-green); }
${S} .td.rh { font-weight: 400; color: var(--og-dim); }
</style>`;

  const lanes = LANES.map((l, i) => {
    const cs = byLane(l.id).map((c) => `<div id="${scope}-${c.id}" class="card"><span class="num">${num.get(c.id)}</span>` +
      `<div><div class="lab">${esc(c.label)}</div>${c.detail ? `<div class="det">${esc(c.detail)}</div>` : ''}</div>` +
      `<div id="${scope}-${c.id}-g" class="glow"></div></div>`).join('');
    return `<div id="${scope}-lane-${l.id}" class="lane" style="left:${laneX(i)}px; --lane:${l.colour}">` +
      `<div id="${scope}-lane-${l.id}-g" class="lane-glow"></div>` +
      `<div class="head"><span class="dot"></span><span>${esc(l.label)}</span></div><div class="cards">${cs}</div></div>` +
      (i > 0 ? `<div class="arrow" style="left:${laneX(i) - GAP + 8}px"></div>` : '');
  }).join('');
  const panelHtml = panels.map((p) => {
    const li = LANES.findIndex((l) => l.id === p.lane);
    const colour = li >= 0 ? LANES[li].colour : 'var(--og-dim)';
    const tip = li >= 0 ? `<div class="tip" style="left:${laneX(li) - X0 + LANE_W / 2 - 22}px"></div>` : '';
    return `<div id="${scope}-${p.id}" class="panel" style="--lane:${colour}">${tip}<div class="ptitle">${p.title}</div>` +
      (p.code ? codeHtml({ ...p, id: `${scope}-${p.id}` }) : tableHtml({ ...p, id: `${scope}-${p.id}` })) + '</div>';
  }).join('');
  const markup = `<div id="${scope}">\n<div class="og-kicker">${esc(kicker)}</div>\n<div class="og-title">${esc(title)}</div>\n` +
    `<div class="band"></div>\n${lanes}\n${panelHtml}\n</div>`;

  // ---- timeline ----
  const tl = [];
  const hidden = [
    ...cards.map((c) => `${S}-${c.id}`),
    ...panels.map((p) => `${S}-${p.id}`),
    ...panels.filter((p) => p.table).flatMap((p) => p.table.rows.flatMap((row, r) => row.map((c, i) => (typeof c === 'object' ? `${S}-${p.id}-r${r}c${i}` : null)).filter(Boolean))),
    ...panels.filter((p) => p.table).flatMap((p) => p.table.rows.flatMap((row, r) => row.map((c, i) => (typeof c === 'object' && c.then ? `${S}-${p.id}-r${r}c${i}-b` : null)).filter(Boolean))),
  ];
  tl.push('// hold back: everything that comes later starts hidden, so nothing shows before its sentence');
  tl.push(`tl.set(${JSON.stringify(hidden.join(', '))}, {opacity: 0}, startS);`);
  tl.push('// the header, the empty lanes and the empty band come first');
  tl.push(`tl.from("${S} .og-kicker, ${S} .og-title", {opacity: 0, y: -16, duration: 0.4, stagger: 0.1}, startS + 0.1);`);
  tl.push(`tl.from("${S} .lane, ${S} .arrow, ${S} .band", {opacity: 0, y: 20, duration: 0.3, stagger: 0.06}, startS + 0.3);`);

  // when each card comes in: done cards on sentence 0, the rest on their sentence, spaced when they share one
  const when = new Map();
  const seen = new Map();
  for (const c of cards) {
    const at = c.done ? 0 : c.at;
    const k = seen.get(at) ?? 0;
    seen.set(at, k + 1);
    when.set(c.id, { at, plus: (c.done ? 0.4 : 0.3) + k * 0.25 });
  }
  // light events in time order: each new card lights itself; later lights relight older cards
  const events = [];
  for (const c of cards) {
    const w = when.get(c.id);
    tl.push(`tl.to("${S}-${c.id}", {opacity: ${c.done ? DIM : 1}, duration: 0.35}, ${t(w.at, w.plus)});`);
    if (!c.done) events.push({ at: w.at, plus: w.plus, cards: [c.id] });
  }
  for (const l of lights) events.push({ at: l.at, plus: l.after ?? 0.3, cards: l.cards });
  events.sort((a, b) => a.at - b.at || a.plus - b.plus);
  let lit = [];
  let litLane = null;
  for (const e of events) {
    const when2 = t(e.at, e.plus);
    for (const id of lit.filter((x) => !e.cards.includes(x))) {
      tl.push(`tl.to("${S}-${id}-g", {opacity: 0, duration: 0.25}, ${when2});`);
      tl.push(`tl.to("${S}-${id}", {opacity: ${DIM}, duration: 0.25}, ${when2});`);
    }
    for (const id of e.cards.filter((x) => !lit.includes(x))) {
      tl.push(`tl.to("${S}-${id}-g", {opacity: 1, duration: 0.25}, ${when2});`);
      tl.push(`tl.to("${S}-${id}", {opacity: 1, duration: 0.25}, ${when2});`);
    }
    const lane = cards.find((c) => c.id === e.cards[e.cards.length - 1]).lane;
    if (lane !== litLane) {
      if (litLane) tl.push(`tl.to("${S}-lane-${litLane}-g", {opacity: 0, duration: 0.25}, ${when2});`);
      tl.push(`tl.to("${S}-lane-${lane}-g", {opacity: 1, duration: 0.25}, ${when2});`);
      litLane = lane;
    }
    lit = e.cards;
  }

  // the band: one panel at a time
  for (const p of panels) {
    tl.push(`tl.to("${S}-${p.id}", {opacity: 1, duration: 0.35}, ${t(p.at, 0.3)});`);
    if (p.until !== undefined) tl.push(`tl.to("${S}-${p.id}", {opacity: 0, duration: 0.3}, ${t(p.until, 0)});`);
    let prev = null;
    for (const l of p.lit ?? []) {
      if (prev) tl.push(`tl.to("${S}-${p.id}-l${prev}", {opacity: 0, duration: 0.25}, ${t(l.at, 0.3)});`);
      tl.push(`tl.to("${S}-${p.id}-l${l.no}", {opacity: 1, duration: 0.25}, ${t(l.at, 0.3)});`);
      // a lit line reads near-black on yellow
      tl.push(`tl.to("${S}-${p.id}-l${l.no}-t, ${S}-${p.id}-l${l.no}-n", {color: "#14110A", duration: 0.25}, ${t(l.at, 0.3)});`);
      if (prev) tl.push(`tl.to("${S}-${p.id}-l${prev}-t", {color: "#FFF6DC", duration: 0.25}, ${t(l.at, 0.3)});`);
      if (prev) tl.push(`tl.to("${S}-${p.id}-l${prev}-n", {color: "#F6C945", duration: 0.25}, ${t(l.at, 0.3)});`);
      prev = l.no;
    }
    if (p.table) {
      p.table.rows.forEach((row, r) => row.forEach((c, i) => {
        if (typeof c !== 'object') return;
        const n = (row.slice(0, i).filter((x) => typeof x === 'object' && x.at === c.at).length) * 0.25;
        tl.push(`tl.to("${S}-${p.id}-r${r}c${i}", {opacity: 1, duration: 0.3}, ${t(c.at, 0.5 + n)});`);
        if (c.until !== undefined) tl.push(`tl.to("${S}-${p.id}-r${r}c${i}", {opacity: 0, duration: 0.2}, ${t(c.until, 0.3)});`);
        if (c.then) {
          tl.push(`tl.to("${S}-${p.id}-r${r}c${i}-a", {opacity: 0, duration: 0.2}, ${t(c.then.at, 0.5)});`);
          tl.push(`tl.to("${S}-${p.id}-r${r}c${i}-b", {opacity: 1, duration: 0.3}, ${t(c.then.at, 0.5)});`);
        }
      }));
    }
  }
  return `${css}\n${markup}\n<script data-oldguy-timeline>\n${tl.join('\n')}\n</script>\n`;
}

export { mapScene, lineAt, LANES };
