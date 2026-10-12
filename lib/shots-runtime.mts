// What a compiled shot scene draws and how it moves, as text the scene file carries: the chalk marks (burst, sight
// line, hanging strings, leader line, underline, circle) with their wobble filter, the code-drawn grounds, and the motion
// presets (pop in, chalk draw-on, camera push / pan, fade out, pose snap, blink, mouth flap) as GSAP tween calls.
//
// A design scene may not carry a script of its own: its timeline is tl.from / to / fromTo / set calls only (see
// scene-kit/design.mts). So the "runtime" runs here, when the scene is compiled, and what reaches the page is the
// finished list of tween calls, timed with beat(n). The chalk marks come from the first real-life-analogy kit.

// One point on the stage.
type Pt = { x: number; y: number };

// A number as the scene writes it: at most one decimal.
function f(n: number): string {
  return String(Math.round(n * 10) / 10);
}

// A number of seconds as the timeline writes it: at most three decimals.
function sec(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

// A seeded random generator (mulberry32 on a string), so every wobble and blink is the same on every compile.
function rng(seed: string): () => number {
  let a = 0;
  for (const ch of seed) a = Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A darker (amt > 0) or lighter (amt < 0) step of a #RRGGBB colour.
function shade(hex: string, amt: number): string {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = n.map((v) => Math.round(amt >= 0 ? v * (1 - amt) : v + (255 - v) * -amt));
  return `#${out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

// ---- chalk ----------------------------------------------------------------------------------------------------------

const CHALK = '#FFFFFF';

// A rough line: a slightly bowed curve between jittered ends, so no two strokes are ruler-straight.
function roughLine(a: Pt, b: Pt, R: () => number, amt = 2.5): string {
  const j = () => (R() - 0.5) * 2 * amt;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const bow = (R() - 0.5) * len * 0.05;
  const mx = (a.x + b.x) / 2 + nx * bow;
  const my = (a.y + b.y) / 2 + ny * bow;
  return `M${f(a.x + j())},${f(a.y + j())} Q${f(mx)},${f(my)} ${f(b.x + j())},${f(b.y + j())}`;
}

// One chalk stroke that draws itself on: path length 1, hidden by its dash offset until drawOn runs.
function stroke(d: string, w = 8): string {
  return `<path class="fa-d" d="${d}" pathLength="1" stroke-dasharray="1 2" stroke-dashoffset="1.02" fill="none" stroke="${CHALK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Short ticks all round a point: the burst that marks the focus.
function burst(seed: string, c: Pt, r: number, n = 16): string {
  const R = rng(seed);
  const len = Math.max(34, Math.min(60, r * 0.3));
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.12;
    const r0 = r + (R() - 0.5) * 14;
    const l = len * (0.75 + R() * 0.5);
    out += stroke(roughLine({ x: c.x + r0 * Math.cos(a), y: c.y + r0 * Math.sin(a) }, { x: c.x + (r0 + l) * Math.cos(a), y: c.y + (r0 + l) * Math.sin(a) }, R, 1.5), 9);
  }
  return out;
}

// A dashed double sight line from one point to another (what someone is looking at).
function sight(seed: string, a: Pt, b: Pt): string {
  const R = rng(seed);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = Math.max(3, Math.floor(len / 48));
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  let out = '';
  for (const row of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.15) / n;
      const t1 = (i + 0.62) / n;
      const off = row * 9;
      const p0 = { x: a.x + (b.x - a.x) * t0 + nx * off, y: a.y + (b.y - a.y) * t0 + ny * off };
      const p1 = { x: a.x + (b.x - a.x) * t1 + nx * off, y: a.y + (b.y - a.y) * t1 + ny * off };
      out += stroke(roughLine(p0, p1, R, 1.2), 6);
    }
  }
  return out;
}

// Strings hanging a card from a point: one stroke per pair, and a chalk dot where they meet the object.
function strings(seed: string, pairs: [Pt, Pt][]): string {
  const R = rng(seed);
  const lines = pairs.map(([a, b]) => stroke(roughLine(a, b, R, 1.5), 6)).join('');
  const ends = [...new Map(pairs.map(([, b]) => [`${f(b.x)},${f(b.y)}`, b])).values()];
  return lines + ends.map((b) => `<circle class="fa-dot" cx="${f(b.x)}" cy="${f(b.y)}" r="9" fill="${CHALK}"/>`).join('');
}

// A leader line from a label to the thing it names.
function leader(seed: string, a: Pt, b: Pt): string {
  return stroke(roughLine(a, b, rng(seed), 2), 6);
}

// A wavy underline under a span.
function underline(x: number, y: number, w: number): string {
  let d = `M${f(x)},${f(y)}`;
  for (let i = 1; i <= 6; i++) d += ` Q${f(x + (w * (i - 0.5)) / 6)},${f(y + (i % 2 ? -8 : 8))} ${f(x + (w * i) / 6)},${f(y)}`;
  return stroke(d, 8);
}

// A hand-drawn ring round a point, a little more than once round.
function circle(seed: string, c: Pt, rx: number, ry: number): string {
  const R = rng(seed);
  let d = '';
  for (let i = 0; i <= 26; i++) {
    const a = -0.5 + (i / 24) * Math.PI * 2;
    const k = 1 + (R() - 0.5) * 0.04;
    d += `${i ? ' L' : 'M'}${f(c.x + rx * k * Math.cos(a))},${f(c.y + ry * k * Math.sin(a))}`;
  }
  return stroke(d, 8);
}

// The wobble filter that makes chalk look drawn by hand.
function chalkFilter(id: string): string {
  return `<filter id="${id}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.5" xChannelSelector="R" yChannelSelector="G"/></filter>`;
}

// ---- grounds ----------------------------------------------------------------------------------------------------------

// The ground layouts, drawn in one palette colour (and darker / lighter steps of it). Every ground reaches far past
// the frame so a tall or square stage, or a camera move, never shows an edge. floorY is the floor line.
function ground(layout: string, hex: string, seed: string, floorY: number): string {
  const big = (fill: string, y = -1200, h = 3480) => `<rect x="-1200" y="${y}" width="4320" height="${h}" fill="${fill}"/>`;
  const floor = big(shade(hex, 0.18), floorY - 20, 2400);
  if (layout === 'floor') return big(hex) + floor;
  if (layout === 'room-corner') {
    // a back wall, a side wall turning in on the left, and the floor
    return big(hex) + `<polygon points="-1200,-1200 260,-1200 260,${floorY - 20} -1200,${floorY + 260}" fill="${shade(hex, -0.08)}"/>` + floor;
  }
  if (layout === 'sky') {
    // flat bands lighter towards the horizon, and a few flat clouds
    const R = rng(seed);
    let clouds = '';
    for (let i = 0; i < 3; i++) {
      const cx = 200 + i * 600 + R() * 200;
      const cy = 140 + R() * 200;
      const cloud = shade(hex, -0.55);
      clouds += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="120" ry="44" fill="${cloud}"/><ellipse cx="${f(cx + 60)}" cy="${f(cy - 30)}" rx="80" ry="50" fill="${cloud}"/>`;
    }
    return big(hex) + big(shade(hex, -0.12), 520, 2000) + big(shade(hex, -0.24), 760, 2000) + clouds;
  }
  if (layout === 'starfield') {
    const R = rng(seed);
    let stars = '';
    for (let i = 0; i < 40; i++) stars += `<circle cx="${f(R() * 1920)}" cy="${f(R() * 1080)}" r="${f(1.5 + R() * 3)}" fill="${CHALK}" opacity="${f(0.3 + R() * 0.5)}"/>`;
    return big(hex) + stars;
  }
  return big(hex);
}

// ---- motion -----------------------------------------------------------------------------------------------------------

// A selector (or a list of them) as a timeline string.
function q(sel: string | string[]): string {
  return JSON.stringify(Array.isArray(sel) ? sel.join(', ') : sel);
}

// The motion presets, each returning timeline lines. `at` is a time expression such as "beat(2) + 0.15".
const motion = {
  // hidden from the start of the piece
  hide: (sel: string | string[]): string => `tl.set(${q(sel)}, {opacity: 0}, startS);`,
  // a new item: in with a small overshoot, growing from its base
  popIn: (sel: string, at: string): string[] => [
    `tl.set(${q(sel)}, {opacity: 0, scale: 0.86, transformOrigin: "50% 100%"}, startS);`,
    `tl.to(${q(sel)}, {opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.7)"}, ${at});`,
  ],
  // the card: up from a little below
  rise: (sel: string, at: string): string[] => [
    `tl.set(${q(sel)}, {opacity: 0, y: 30}, startS);`,
    `tl.to(${q(sel)}, {opacity: 1, y: 0, duration: 0.5, ease: "power3.out"}, ${at});`,
  ],
  // a chalk label or the title: fades in
  fadeIn: (sel: string, at: string): string[] => [`tl.set(${q(sel)}, {opacity: 0}, startS);`, `tl.to(${q(sel)}, {opacity: 1, duration: 0.4}, ${at});`],
  // chalk strokes draw themselves on, one after another
  drawOn: (sel: string, at: string): string => `tl.to(${q(`${sel} .fa-d`)}, {strokeDashoffset: 0, duration: 0.6, stagger: 0.02, ease: "power1.inOut"}, ${at});`,
  // the chalk dots where strings meet an object
  dots: (sel: string, at: string): string[] => [`tl.set(${q(`${sel} .fa-dot`)}, {opacity: 0}, startS);`, `tl.to(${q(`${sel} .fa-dot`)}, {opacity: 1, duration: 0.2}, ${at});`],
  // leaves before the next sentence
  fadeOut: (sel: string | string[], at: string): string => `tl.to(${q(sel)}, {opacity: 0, duration: 0.3}, ${at});`,
  // a pose change or a ground change: snaps on the beat
  snap: (from: string, to: string, at: string): string[] => [`tl.set(${q(from)}, {opacity: 0}, ${at});`, `tl.set(${q(to)}, {opacity: 1}, ${at});`],
  // the camera: moves the world so (x, y) comes to the centre at zoom z, over `dur` seconds (an expression)
  camera: (sel: string, c: Pt, z: number, at: string, dur: string): string => {
    const p = cameraXY(c, z);
    return `tl.to(${q(sel)}, {x: ${f(p.x)}, y: ${f(p.y)}, scale: ${z}, duration: ${dur}, ease: "sine.inOut"}, ${at});`;
  },
  // the camera jumps to a start framing (the first half of a pan)
  cameraSet: (sel: string, c: Pt, z: number, at: string): string => {
    const p = cameraXY(c, z);
    return `tl.set(${q(sel)}, {x: ${f(p.x)}, y: ${f(p.y)}, scale: ${z}}, ${at});`;
  },
  // the camera back to the whole frame
  cameraReset: (sel: string, at: string): string => `tl.to(${q(sel)}, {x: 0, y: 0, scale: 1, duration: 0.45, ease: "power2.inOut"}, ${at});`,
  // a blink: eyes shut at `at`, open again at `open` (0.12 s later)
  blink: (eyes: string[], shut: string[], at: string, open: string): string[] => [
    `tl.set(${q(eyes)}, {opacity: 0}, ${at});`,
    `tl.set(${q(shut)}, {opacity: 1}, ${at});`,
    `tl.set(${q(eyes)}, {opacity: 1}, ${open});`,
    `tl.set(${q(shut)}, {opacity: 0}, ${open});`,
  ],
  // the mouth flaps open and shut every 0.11 s while the line plays, from `at` until `until` - 0.3 (expressions);
  // an odd number of yoyo repeats ends with the mouth shut
  flap: (closed: string, open: string, at: string, until: string): string[] => {
    const repeat = `Math.max(1, Math.floor((${until} - (${at}) - 0.3) / 0.22)) * 2 - 1`;
    return [
      `tl.to(${q(open)}, {opacity: 1, duration: 0.11, ease: "steps(1)", yoyo: true, repeat: ${repeat}}, ${at});`,
      `tl.to(${q(closed)}, {opacity: 0, duration: 0.11, ease: "steps(1)", yoyo: true, repeat: ${repeat}}, ${at});`,
    ];
  },
};

// Where the world layer moves so stage point c sits in the centre at zoom z, never showing past the world's edge.
function cameraXY(c: Pt, z: number): Pt {
  const cx = Math.max(960 / z, Math.min(1920 - 960 / z, c.x));
  const cy = Math.max(540 / z, Math.min(1080 - 540 / z, c.y));
  return { x: 960 - z * cx, y: 540 - z * cy };
}

export { f, sec, rng, shade, burst, sight, strings, leader, underline, circle, chalkFilter, ground, motion, cameraXY, CHALK };
export type { Pt };
