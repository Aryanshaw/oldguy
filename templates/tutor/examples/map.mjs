// The tutor's map scene: the same four lanes on top in every chapter, and a band under them that zooms into one lane
// (real code, a record's rows, two settings side by side, a what-if). Code never replaces the map: it sits in the band,
// under the lane it belongs to, so the viewer never loses where the example is. Writes a `design` scene file.
//
//   import { mapScene } from '<repo>/templates/tutor/examples/map.mjs';
//   fs.writeFileSync('scenes/the-timing.html', mapScene({ kicker, title, cards, panels, lights }));
//
// cards:  [{ id, lane, label, detail?, at, after?, done? }]   a card appears on sentence `at` (`after` seconds into
//         it, when the voice names it) and stays; `done` cards are the stops the example already passed (shown dimmed
//         from sentence 0). The newest card glows, older ones dim. Fill the lanes left to right, in the order the
//         example travels.
// lights: [{ at, cards: [id...], after? }]              light cards again later (the quick check's value, the recap),
//         `after` seconds into sentence `at`.
// panels: [{ id, lane?, at, until?, title (HTML, escaped), code?: [{ no, text, key?, mute? }], size?, lit?: [{ no, at }],
//         table?: { head, rows } }]
//         one at a time in the band; `lane` points the band at that lane (`colour` colours a panel with no lane). A code
//         line's `key` (a string, or a list of them: the 10 to 15 characters that matter) is drawn big and bright in a
//         zoom row over the lines, and bright inside the line, whose other characters are dimmed; a lit line gets its
//         bar and its big key on its sentence, the key lit before it dims. `mute` (a part of the line, or the whole line) is drawn
//         faint: the part nobody names aloud, kept so the line stays whole. `size` (px, default 40) is the code's size;
//         below 40 long lines wrap under themselves instead of running off the band. A table cell is a plain string (there from the start) or
//         { text, at, until?, then?: { text, at } } (`then` takes the cell's place on its sentence: a what-if's
//         answer); `table.first` is the first column's width in px.
//         A code panel may add `plain` (what the lines do, in plain words, under them) and `pic` (a small picture
//         beside the code: { items: [{ id, label }], steps: [{ at, lit: [id...], dark: [id...] }] }, one card lit,
//         another dark). Other panel bodies: `folder: { name, files: [{ name, note }] }` (what a folder holds) and
//         `bar: { span: [from, to], blocks: [{ id, label, from, to, tone, at }], marks: [{ id, t, label, at, low?, side? }] }`
//         (a timeline in seconds: blocks of sound and silence, and marked moments under them; tone is a lane id,
//         'gap' or 'ghost' (a dashed outline: where a block was before a what-if); side 'before' or 'after' puts a
//         mark's label on that side of it), a worked example in one picture. A block may add `row` (the record's
//         own row for it, in mono under it, shown on `rowAt`), `replay: { who, text, at }` (a small card on the block
//         replaying a line said earlier: where a number comes from), `until`, and `slide: { at, after?, from, to }`
//         (it moves or grows on that sentence: a what-if redrawn). A mark may add `tag` (where its value comes from,
//         small under its label), `then: { label, at, after? }` (the answer takes the label's place), `until` and
//         `slide: { at, after?, t }`. Blocks and marks take `after` like cards.
//         `chain: [{ id, label, detail?, at, after?, tone? }]`: a row of boxes joined by arrows (what goes in, what
//         comes out).
// tour:   a sentence index: each lane glows in turn while that sentence names the stops (`tourAfter`: when each lane's
//         name is said, in seconds into the sentence).
// hold:   true on the video's last scene: the board stays up on its last frame instead of fading out.
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
  for (const k of [key ?? []].flat()) if (!text.includes(k)) throw new Error(`${file}:${no} does not hold ${k}`);
  if (mute && !text.includes(mute)) throw new Error(`${file}:${no} does not hold ${mute}`);
  return { no, text: text.trimEnd(), ...(key ? { key } : {}), ...(mute ? { mute } : {}) };
}

function codeHtml(p) {
  // the common indent is dropped so short lines sit left; the rest of each line is kept as it is
  const indent = Math.min(...p.code.map((l) => l.text.match(/^ */)[0].length));
  const rows = p.code.map((l) => {
    const body = l.text.slice(indent);
    let inner = esc(body);
    for (const k of keysOf(l)) inner = inner.replace(esc(k), `<b>${esc(k)}</b>`);
    if (l.mute) {
      const m = esc(l.mute.trim());
      if (keysOf(l).some((k) => l.mute.includes(k))) throw new Error(`line ${l.no}: the key part cannot be muted`);
      inner = inner.replace(m, `<i class="mute">${m}</i>`);
    }
    return `<div class="cl"><div id="${p.id}-l${l.no}" class="hl"></div><code id="${p.id}-l${l.no}-n" class="no">${l.no}</code><pre id="${p.id}-l${l.no}-t">${inner}</pre></div>`;
  });
  const size = p.size ?? 40;
  return `<div class="cw">${bigHtml(p)}<div class="code${size < 40 ? ' wrap' : ''}" style="--cs: ${size}px">${rows.join('')}</div></div>`;
}

// A code line's key parts, as a list.
const keysOf = (l) => [l.key ?? []].flat();

// The zoom row: every key of the shown lines, big and bright, in line order, so the eye lands on the few characters
// that matter; the whole lines under it stay for context, dimmed.
function bigHtml(p) {
  const keyed = p.code.filter((l) => keysOf(l).length);
  if (!keyed.length) return '';
  return `<div class="big">${keyed.map((l) => `<span id="${p.id}-k${l.no}" class="kb">${keysOf(l).map((k) => `<code>${esc(k)}</code>`).join('<i>·</i>')}</span>`).join('')}</div>`;
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

// A code panel's picture: a few cards beside the code (the speaker cards, one lit and one dark).
function picHtml(p) {
  return `<div class="pic">${p.pic.items.map((c) => `<div id="${p.id}-p-${c.id}" class="pcard"><div class="phead"></div>${esc(c.label)}</div>`).join('')}</div>`;
}

// What a folder holds: its name on a tab, one row per file with what it is for.
function folderHtml(p) {
  const f = p.folder;
  return `<div class="folder"><div class="ftab">${esc(f.name)}</div><div class="files">` +
    f.files.map((x, i) => `<div id="${p.id}-f${i}" class="file"><code>${esc(x.name)}</code><span>${esc(x.note)}</span></div>`).join('') + '</div></div>';
}

// A row of boxes joined by arrows: what goes in, what comes out.
function chainHtml(p) {
  return `<div class="chain">${p.chain.map((c, i) => (i ? `<div id="${p.id}-c-${c.id}-a" class="carrow"></div>` : '') +
    `<div id="${p.id}-c-${c.id}" class="cbox" style="--tone:${LANES.find((l) => l.id === c.tone)?.colour ?? c.tone ?? 'var(--og-text)'}">` +
    `<div class="clab">${esc(c.label)}</div>${c.detail ? `<div class="cdet">${esc(c.detail)}</div>` : ''}</div>`).join('')}</div>`;
}

// A timeline in seconds, as wide as the band: blocks of sound and silence, and marked moments under them.
const BAR_W = 1720;
const barX = (p) => (sec) => ((sec - p.bar.span[0]) / (p.bar.span[1] - p.bar.span[0])) * BAR_W;
const MARK_W = 640;
const markLeft = (m, at) => (m.side === 'before' ? at - MARK_W - 12 : m.side === 'after' ? at + 12 : at - MARK_W / 2);
function barHtml(p) {
  const x = barX(p);
  const tone = (t) => (t === 'gap' || t === 'ghost' ? '' : `--tone:${LANES.find((l) => l.id === t)?.colour ?? t}`);
  const blocks = p.bar.blocks.map((k) => {
    // a block that grows in a what-if draws its colour on a fill of its own, stretched from its left edge
    const grows = k.slide && (k.slide.to ?? k.to) - (k.slide.from ?? k.from) !== k.to - k.from;
    const cls = (k.tone === 'gap' ? ' gap' : k.tone === 'ghost' ? ' ghost' : '') + (grows ? ' grow' : '');
    const fill = grows ? `<div id="${p.id}-b-${k.id}-f" class="fill"></div>` : '';
    const label = `<span id="${p.id}-b-${k.id}-l">${esc(k.label)}</span>`;
    const replay = k.replay ? `<div id="${p.id}-b-${k.id}-r" class="replay"><span class="rwho">${esc(k.replay.who)}</span><span class="rtext">${esc(k.replay.text)}</span></div>` : '';
    const row = k.row ? `<code id="${p.id}-b-${k.id}-w" class="brow" style="left:${(x(k.from) + 10).toFixed(0)}px">${esc(k.row)}</code>` : '';
    return `<div id="${p.id}-b-${k.id}" class="blk${cls}" style="left:${x(k.from).toFixed(0)}px; width:${(x(k.to) - x(k.from)).toFixed(0)}px; ${tone(k.tone)}">${fill}${label}${replay}</div>${row}`;
  });
  // a mark is a tick under the blocks and its label, a box of its own beside the tick (before, after or centred on it);
  // its tag says where the value comes from, small under the label
  const marks = (p.bar.marks ?? []).map((m) => {
    const at = x(m.t);
    const align = m.side === 'before' ? 'right' : m.side === 'after' ? 'left' : 'center';
    const then = m.then ? `<span id="${p.id}-m-${m.id}-b" class="then">${esc(m.then.label)}</span>` : '';
    const tag = m.tag ? `<code class="mtag">${esc(m.tag)}</code>` : '';
    return `<div id="${p.id}-m-${m.id}" class="mk${m.low ? ' low' : ''}"><div class="tick" style="left:${at.toFixed(0)}px"></div>` +
      `<div class="mlab" style="left:${markLeft(m, at).toFixed(0)}px; width:${MARK_W}px; text-align:${align}"><span id="${p.id}-m-${m.id}-a">${esc(m.label)}</span>${then}${tag}</div></div>`;
  });
  return `<div class="bar">${blocks.join('')}${marks.join('')}</div>`;
}

function panelBody(p) {
  if (p.code) {
    const code = codeHtml(p);
    const plain = p.plain ? `<div class="plain"><span>in plain words:</span> ${esc(p.plain)}</div>` : '';
    return p.pic ? `<div class="split">${code}${picHtml(p)}</div>${plain}` : `${code}${plain}`;
  }
  if (p.folder) return folderHtml(p);
  if (p.bar) return barHtml(p);
  if (p.chain) return chainHtml(p);
  return tableHtml(p);
}

// The scene file: styles, markup and a timeline of tl.set / tl.to calls only.
function mapScene({ kicker, title, cards, panels = [], lights = [], tour, tourAfter, hold = false, scope = 'tm' }) {
  const S = `#${scope}`;
  const byLane = (id) => cards.filter((c) => c.lane === id);
  for (const c of cards) if (!LANES.some((l) => l.id === c.lane)) throw new Error(`card ${c.id}: no lane ${c.lane}`);
  // cards and panels share one id space in the page
  const ids = [...cards, ...panels].map((x) => x.id);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) throw new Error(`a card and a panel are both called ${twice}; give each its own id`);
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
${S} .hl { position: absolute; left: 0; top: 0; bottom: 0; width: 8px; background: var(--og-yellow); opacity: 0; }
${S} .cl .no, ${S} .cl pre { position: relative; margin: 0; font: 400 var(--cs, 40px)/1.25 var(--og-font-mono); font-variant-ligatures: none; white-space: pre; color: #8C8573; }
${S} .cl .no { flex: none; width: 80px; text-align: right; color: #8C8573; }
${S} .big { display: flex; gap: 48px; align-items: baseline; margin-top: 10px; }
${S} .kb { display: flex; gap: 24px; align-items: baseline; }
${S} .kb code { font: 700 76px/1.1 var(--og-font-mono); font-variant-ligatures: none; color: var(--og-yellow); background: #2E2712; padding: 2px 18px; border: 3px solid var(--og-yellow); }
${S} .kb i { font: 800 60px var(--og-font); font-style: normal; color: var(--og-dim); }
${S} .code.wrap { margin-top: 10px; gap: 2px; }
${S} .code.wrap .cl { padding: 3px 16px; }
${S} .code.wrap pre { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; padding-left: 2ch; text-indent: -2ch; }
${S} .cl pre i.mute { font-style: normal; opacity: 0.45; }
${S} .cl pre b { font-weight: 800; color: var(--og-yellow); }
${S} .tbl { margin-top: 12px; display: grid; column-gap: 24px; row-gap: 10px; }
${S} .th { font: 700 26px var(--og-font); letter-spacing: 0.06em; text-transform: uppercase; color: var(--og-dim); }
${S} .td { font: 800 34px/1.2 var(--og-font); color: var(--og-text); }
${S} .td { position: relative; }
${S} .then { position: absolute; left: 0; top: 0; white-space: nowrap; color: var(--og-green); }
${S} .td.rh { font-weight: 400; color: var(--og-dim); }
${S} .lane-tour { position: absolute; inset: -3px; border: 6px solid var(--lane); background: color-mix(in srgb, var(--lane) 14%, transparent); opacity: 0; }
${S} .split { display: flex; gap: 32px; align-items: flex-start; }
${S} .split > .cw { flex: 1; min-width: 0; }
${S} .plain { margin-top: 14px; padding-left: 16px; font: 800 32px var(--og-font); color: var(--og-text); }
${S} .plain span { color: var(--lane); }
${S} .pic { flex: none; display: flex; gap: 20px; margin-top: 18px; }
${S} .pcard { width: 200px; height: 200px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 10px; padding: 12px; border: 4px solid var(--og-line); background: var(--og-step-bg); font: 800 30px var(--og-font); color: var(--og-text); opacity: 0.6; }
${S} .phead { width: 92px; height: 92px; border-radius: 50%; background: var(--og-text); }
${S} .folder { margin-top: 18px; display: flex; align-items: stretch; gap: 0; }
${S} .ftab { font: 700 34px var(--og-font-mono); color: var(--og-black); background: var(--lane); padding: 14px 24px; display: flex; align-items: center; }
${S} .files { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 16px 24px; border: 4px solid var(--lane); }
${S} .file { display: flex; gap: 32px; align-items: baseline; }
${S} .file code { width: 420px; flex: none; font: 700 38px var(--og-font-mono); color: var(--og-text); }
${S} .file span { font: 600 32px var(--og-font); color: var(--og-dim); }
${S} .bar { position: relative; margin-top: 12px; height: 262px; }
${S} .blk { position: absolute; top: 0; height: 84px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font: 800 30px var(--og-font); color: var(--og-black); background: var(--tone); white-space: nowrap; overflow: hidden; }
${S} .blk > span { position: absolute; }
${S} .blk.grow { background: transparent; overflow: visible; }
${S} .blk .fill { position: absolute; inset: 0; background: var(--tone); transform-origin: left center; }
${S} .blk.gap { background: repeating-linear-gradient(45deg, #3a3426 0 10px, #2a251b 10px 20px); color: var(--og-text); border: 3px dashed var(--og-dim); }
${S} .blk.ghost { background: transparent; color: var(--og-text); border: 4px dashed var(--og-text); }
${S} .replay { position: absolute; inset: 6px; display: flex; align-items: center; gap: 16px; padding: 0 16px; background: var(--og-black); border: 3px solid var(--og-text); }
${S} .rwho { font: 800 22px var(--og-font); letter-spacing: 0.06em; text-transform: uppercase; color: var(--tone); }
${S} .rtext { font: 800 30px var(--og-font); color: var(--og-text); }
${S} .brow { position: absolute; top: 90px; font: 600 25px var(--og-font-mono); color: var(--og-text); white-space: nowrap; }
${S} .mk { position: absolute; inset: 0; }
${S} .tick { position: absolute; top: 0; width: 0; height: 136px; border-left: 4px solid var(--og-text); }
${S} .mlab { position: absolute; top: 136px; font: 800 30px/1.15 var(--og-font); color: var(--og-text); }
${S} .mlab .then { position: absolute; left: 0; right: 0; top: 0; color: var(--og-green); }
${S} .mtag { display: block; font: 600 22px var(--og-font-mono); color: var(--og-dim); }
${S} .mk.low .tick { height: 198px; }
${S} .mk.low .mlab { top: 198px; color: var(--og-green); }
${S} .chain { margin-top: 26px; display: flex; align-items: center; gap: 20px; }
${S} .cbox { flex: 1; min-height: 150px; box-sizing: border-box; padding: 16px 24px; display: flex; flex-direction: column; justify-content: center; border: 4px solid var(--tone); background: var(--og-step-bg); }
${S} .clab { font: 800 40px/1.15 var(--og-font); color: var(--og-text); }
${S} .cdet { margin-top: 6px; font: 600 30px var(--og-font); color: var(--og-dim); }
${S} .carrow { flex: none; width: 0; height: 0; border-style: solid; border-width: 26px 0 26px 38px; border-color: transparent transparent transparent var(--og-orange); }
</style>`;

  const lanes = LANES.map((l, i) => {
    const cs = byLane(l.id).map((c) => `<div id="${scope}-${c.id}" class="card"><span class="num">${num.get(c.id)}</span>` +
      `<div><div class="lab">${esc(c.label)}</div>${c.detail ? `<div class="det">${esc(c.detail)}</div>` : ''}</div>` +
      `<div id="${scope}-${c.id}-g" class="glow"></div></div>`).join('');
    return `<div id="${scope}-lane-${l.id}" class="lane" style="left:${laneX(i)}px; --lane:${l.colour}">` +
      `<div id="${scope}-lane-${l.id}-g" class="lane-glow"></div><div id="${scope}-lane-${l.id}-t" class="lane-tour"></div>` +
      `<div class="head"><span class="dot"></span><span>${esc(l.label)}</span></div><div class="cards">${cs}</div></div>` +
      (i > 0 ? `<div class="arrow" style="left:${laneX(i) - GAP + 8}px"></div>` : '');
  }).join('');
  const panelHtml = panels.map((p) => {
    const li = LANES.findIndex((l) => l.id === p.lane);
    const colour = p.colour ?? (li >= 0 ? LANES[li].colour : 'var(--og-dim)');
    const tip = li >= 0 ? `<div class="tip" style="left:${laneX(li) - X0 + LANE_W / 2 - 22}px"></div>` : '';
    return `<div id="${scope}-${p.id}" class="panel" style="--lane:${colour}">${tip}<div class="ptitle">${p.title}</div>` +
      panelBody({ ...p, id: `${scope}-${p.id}` }) + '</div>';
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
    ...panels.filter((p) => p.bar).flatMap((p) => [...p.bar.blocks.map((k) => `${S}-${p.id}-b-${k.id}`), ...(p.bar.marks ?? []).map((m) => `${S}-${p.id}-m-${m.id}`)]),
    ...panels.filter((p) => p.folder).flatMap((p) => p.folder.files.map((_, i) => `${S}-${p.id}-f${i}`)),
    ...panels.filter((p) => p.chain).flatMap((p) => p.chain.flatMap((c, i) => [`${S}-${p.id}-c-${c.id}`, ...(i ? [`${S}-${p.id}-c-${c.id}-a`] : [])])),
    ...panels.filter((p) => p.bar).flatMap((p) => [
      ...p.bar.blocks.filter((k) => k.row).map((k) => `${S}-${p.id}-b-${k.id}-w`),
      ...p.bar.blocks.filter((k) => k.replay).map((k) => `${S}-${p.id}-b-${k.id}-r`),
      ...(p.bar.marks ?? []).filter((m) => m.then).map((m) => `${S}-${p.id}-m-${m.id}-b`),
    ]),
    ...panels.filter((p) => p.code).flatMap((p) => (p.lit ?? []).filter((l) => p.code.some((c) => c.no === l.no && keysOf(c).length)).map((l) => `${S}-${p.id}-k${l.no}`)),
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
    when.set(c.id, { at, plus: c.after ?? (c.done ? 0.4 : 0.3) + k * 0.25 });
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
      // the lit line's number brightens; its key comes up big in the zoom row, the key before it dims
      tl.push(`tl.to("${S}-${p.id}-l${l.no}-n", {color: "#F6C945", duration: 0.25}, ${t(l.at, 0.3)});`);
      if (prev) tl.push(`tl.to("${S}-${p.id}-l${prev}-n", {color: "#8C8573", duration: 0.25}, ${t(l.at, 0.3)});`);
      const keyed = (no) => p.code.some((c) => c.no === no && keysOf(c).length);
      if (keyed(l.no)) tl.push(`tl.to("${S}-${p.id}-k${l.no}", {opacity: 1, duration: 0.3}, ${t(l.at, l.after ?? 0.4)});`);
      if (prev && keyed(prev)) tl.push(`tl.to("${S}-${p.id}-k${prev}", {opacity: 0.35, duration: 0.25}, ${t(l.at, l.after ?? 0.4)});`);
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
  // the tour: each empty lane glows in turn while the voice says the lanes are the map
  if (tour !== undefined) {
    LANES.forEach((l, i) => {
      // each lane as the voice names it (tourAfter), or one after another
      const on = tourAfter?.[i] ?? 0.3 + i * 0.8;
      tl.push(`tl.to("${S}-lane-${l.id}-t", {opacity: 1, duration: 0.3}, ${t(tour, on)});`);
      tl.push(`tl.to("${S}-lane-${l.id}-t", {opacity: 0, duration: 0.3}, ${t(tour, on + 0.7)});`);
    });
  }
  for (const p of panels) {
    // a folder's files come in one after another, with the panel
    if (p.folder) p.folder.files.forEach((_, i) => tl.push(`tl.to("${S}-${p.id}-f${i}", {opacity: 1, duration: 0.3}, ${t(p.at, 0.6 + i * 0.6)});`));
    // a timeline's blocks and marks come in on their sentences, spaced when they share one
    if (p.bar) {
      const n = new Map();
      const x = barX(p);
      for (const k of [...p.bar.blocks.map((v) => ({ ...v, sel: `b-${v.id}` })), ...(p.bar.marks ?? []).map((v) => ({ ...v, sel: `m-${v.id}` }))]) {
        const k2 = n.get(k.at) ?? 0;
        if (k.after === undefined) n.set(k.at, k2 + 1);
        const sel = `${S}-${p.id}-${k.sel}`;
        tl.push(`tl.to("${sel}", {opacity: 1, duration: 0.3}, ${t(k.at, k.after ?? 0.5 + k2 * 0.5)});`);
        if (k.until !== undefined) tl.push(`tl.to("${sel}", {opacity: 0, duration: 0.3}, ${t(k.until, k.untilAfter ?? 0.3)});`);
        if (k.row) tl.push(`tl.to("${sel}-w", {opacity: 1, duration: 0.3}, ${t(k.rowAt ?? k.at, k.rowAfter ?? 0.6)});`);
        if (k.replay) {
          tl.push(`tl.to("${sel}-r", {opacity: 1, duration: 0.35}, ${t(k.replay.at, k.replay.after ?? 0.4)});`);
          tl.push(`tl.to("${sel}-l", {opacity: 0, duration: 0.2}, ${t(k.replay.at, k.replay.after ?? 0.4)});`);
        }
        if (k.then) {
          tl.push(`tl.to("${sel}-a", {opacity: 0, duration: 0.2}, ${t(k.then.at, k.then.after ?? 0.5)});`);
          tl.push(`tl.to("${sel}-b", {opacity: 1, duration: 0.3}, ${t(k.then.at, k.then.after ?? 0.5)});`);
        }
        // a what-if redrawn: a block moves (x) or grows (its fill stretches), a mark moves, over most of a second;
        // transforms only, so the motion never snaps to whole pixels
        if (k.slide && k.sel.startsWith('b-')) {
          const from = k.slide.from ?? k.from;
          const to = k.slide.to ?? k.to;
          const when = t(k.slide.at, k.slide.after ?? 0.5);
          const dx = (x(from) - x(k.from)).toFixed(0);
          if (dx !== '0') tl.push(`tl.to("${sel}", {x: ${dx}, duration: 0.9, ease: "power2.inOut"}, ${when});`);
          if (dx !== '0' && k.row) tl.push(`tl.to("${sel}-w", {x: ${dx}, duration: 0.9, ease: "power2.inOut"}, ${when});`);
          const sx = (x(to) - x(from)) / (x(k.to) - x(k.from));
          if (Math.abs(sx - 1) > 0.001) tl.push(`tl.to("${sel}-f", {scaleX: ${sx.toFixed(3)}, duration: 0.9, ease: "power2.inOut"}, ${when});`);
        }
        if (k.slide && k.sel.startsWith('m-')) {
          tl.push(`tl.to("${sel}", {x: ${(x(k.slide.t) - x(k.t)).toFixed(0)}, duration: 0.9, ease: "power2.inOut"}, ${t(k.slide.at, k.slide.after ?? 0.5)});`);
        }
      }
    }
    // a chain's boxes come in one after another, each arrow just before the box it points at
    for (const [i, c] of (p.chain ?? []).entries()) {
      const at = t(c.at ?? p.at, c.after ?? 0.6 + i * 0.6);
      if (i) tl.push(`tl.to("${S}-${p.id}-c-${c.id}-a", {opacity: 1, duration: 0.25}, ${at});`);
      tl.push(`tl.to("${S}-${p.id}-c-${c.id}", {opacity: 1, duration: 0.3}, ${at});`);
    }
    // the picture beside the code: a card lights (full, its lane's border) or goes dark on its sentence
    for (const st of p.pic?.steps ?? []) {
      for (const id of st.lit ?? []) tl.push(`tl.to("${S}-${p.id}-p-${id}", {opacity: 1, borderColor: "#F6C945", backgroundColor: "#3A2F12", duration: 0.3}, ${t(st.at, 0.5)});`);
      for (const id of st.dark ?? []) tl.push(`tl.to("${S}-${p.id}-p-${id}", {opacity: 0.18, duration: 0.3}, ${t(st.at, 0.5)});`);
    }
  }
  // the last scene holds its last frame. The piece fades out over its last 0.4 s; two tweens over that span keep the
  // opacity at about 1 on every frame of it: one starting just after the fade (it renders after it when the timeline
  // plays forward) and one just before it (it renders after it when the timeline is seeked backward). GSAP skips a
  // tween whose from and to are equal, so each runs from 0.999 to 1.
  if (hold) {
    tl.push('tl.fromTo(".og-design", {opacity: 0.999}, {opacity: 1, duration: 0.42, ease: "none", immediateRender: false}, endS - 0.42);');
    tl.push('tl.fromTo(".og-design", {opacity: 0.999}, {opacity: 1, duration: 0.39, ease: "none", immediateRender: false}, endS - 0.39);');
  }
  return `${css}\n${markup}\n<script data-oldguy-timeline>\n${tl.join('\n')}\n</script>\n`;
}

export { mapScene, lineAt, LANES };
