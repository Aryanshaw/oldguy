/* real-life-analogy kit, version 1 */
/*
 * RLA: everything a real-life-analogy scene may call. Read this index; the code under it should not need reading.
 *
 * The kit is a string builder. It runs where the scene is written (node, from the video folder's make script) or in
 * a browser (kit/gallery.html), and it returns markup and timeline text that pass oldguy's design-piece checks: inline
 * SVG and HTML only, no <use>, no href, no url() in styles, and a timeline of tl.set / tl.to / tl.fromTo calls. Every
 * scene is drawn on the 1920 x 1080 stage. The method (a fixed kit, hard rules, a look check) follows hairline by
 * Lucas Marques (MIT, github.com/lucasmarkes/hairline); no hairline code is copied here.
 *
 * Load it
 *   node:     const RLA = require('<plugin>/templates/real-life-analogy/kit/kit.js')
 *   browser:  <script src="kit.js"></script>  then window.RLA
 *
 * Palette (flat colours only; lint refuses any other fill)
 *   P                       named colours: indigo night floor violet purple lilac periwinkle blue sky yellow orange
 *                           coral red peach cream paper chalk ink inkBlue tan grey white
 *   SKIN                    pale peach tan brown deep
 *   HAIR                    ink indigo blue coral yellow white brown orange
 *   GROUNDS                 indigo blue purple: the scene's ground colour (cool), always under warm shapes
 *   shade(hex, amt)         a darker (amt > 0) or lighter (amt < 0) step of a palette colour; lint allows it
 *
 * People: the character rig (the only way a person gets into a scene)
 *   person(o)               -> {svg, anchors, box}. o: id, x, y (feet, or bottom of the bust), s (scale), flip,
 *                           pose: stand | hold | point | think | bust | bust-hold
 *                           head: oval | round | long | square | heart
 *                           hair: bob | long | curly | bun | swoop | afro | crop | bald | ponytail
 *                           hairColor (HAIR key or hex), skin (SKIN key or hex),
 *                           face: neutral | curious | worried | pleased | thinking | focused
 *                           glasses (bool), beard (false | HAIR key), outfit: shirt | dress | coat,
 *                           shirt, pants (palette keys), holding: {prop: name (or svg: local markup), dx, dy, s, rot} in the hand
 *                           anchors (stage px): head, eye, hand, top, chin; box: [x0, y0, x1, y1]
 *   PRESETS                 named people: actor, writer, manager, professor, kid, clerk, courier, coder
 *   cast(name, o)           person(PRESETS[name] merged with o)
 *   HEADS HAIRS FACES POSES the option lists, for galleries and checks
 *
 * Props (solid fills, drawn about 200 px tall at s 1, centred on 0,0 before placing)
 *   prop(name, o)           -> {svg, r, box}. o: id, x, y, s, rot, colour (palette key) and the prop's own options
 *   group(id, parts, focus) several built things that enter together as one thing
 *   PROPS                   book apple parcel envelope door conveyor counter ticket phone laptop server key lock
 *                           clock bell cup curtain spotlight microphone clipboard paper platform waveform screen
 *                           (clock: {h, m}; door: {open}; spotlight: {beam}; conveyor: {w}; counter: {w};
 *                           waveform: {w, bars}: a sound over its sample ticks; screen: {w}: a built page, a small
 *                           theatre in its slot, w x w*9/16 inside a frame, no words)
 *
 * Paper cards: the only place words go
 *   card(o)                 -> {html, box, bottom(n)}. o: id, x, y (top-left, stage px), w (auto), rot (deg),
 *                           title (hand-lettered capitals; a list gives one line each), lines (real code, whole lines), file ("lib/a.mts · line 3"),
 *                           hl: {line, word} lights one word, size: 'big' | 'normal';
 *                           returns bottom(n) / top(n): n points along an edge, where strings start
 *
 * Chalk: white hand-drawn overlays; each stroke draws itself on
 *   burst(o)                ticks round a focus: {id, x, y, r (inner radius), len, n}
 *   sight(o)                a dashed sight line: {id, from: [x, y], to: [x, y]}
 *   strings(o)              strings hanging a card on an object: {id, from: [[x, y]...], to: [x, y] | [[x, y]...]}
 *   arrow(o)                {id, from, to, bend}
 *   underline(o)            {id, x, y, w}
 *   ring(o)                 {id, x, y, rx, ry}
 *   frame(o)                a dashed box (a slot): {id, x, y (top-left), w, h}
 *
 * Motion: timeline text, times as strings such as "beat(2) + 0.3"; nothing moves between beats except the slow push
 *   motion.hide(sel)        motion.pop(sel, at)     motion.rise(sel, at)     motion.fade(sel, at)
 *   motion.draw(sel, at, dur, stagger)            motion.dim(sel, at)        motion.out(sel, at)
 *   motion.camera(sel, at, {x, y, zoom, dur}) (clamped so the frame never shows past the world's edge)    motion.push(sel, amount)   motion.crossfade(outSel, inSel, at)
 *
 * Scenes: one per chapter, built up one thing per sentence
 *   scene(o)                -> builder. o: id (the chapter id), ground (GROUNDS key), floor (y of the floor band or
 *                           false), push (slow push amount, default 0.035), cards (how many cards stay up,
 *                           default 2: the newest bright, the one before dimmed; older ones are taken down)
 *   .set(svg)               the setting, on screen at beat 0 (stage, counter, curtains): the map drawn empty first
 *   .add(beat, built, o)    one new thing on sentence `beat`. built is what person / prop / card / a chalk call
 *                           returned. o: enter (pop | rise | fade | draw | none), delay (s after the beat, default
 *                           0.3), focus (true, or {x, y, r}) moves the burst to it, dim (dims it when the next focus
 *                           comes; cards default true), extra (true: a chalk mark that goes with this beat's thing),
 *                           pin (a card that stays up: the running example's card)
 *   .camera(beat, {x, y, zoom, delay, dur})  pans and pushes the world so (x, y) sits in the centre
 *   .build()                -> {html, problems}: the scene file text (style + markup + timeline) and the rule
 *                           breaks found (an empty list means it passes rules.md's checks)
 *   lint(html)              the markup checks on their own: palette, no gradients, no outlines, no text outside
 *                           cards, no <text> in SVG
 */
(function (root, factory) {
  const RLA = factory();
  if (typeof module === 'object' && module.exports) module.exports = RLA;
  else root.RLA = RLA;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- palette -------------------------------------------------------------------------------------------------
  const P = {
    indigo: '#221C55', night: '#1A1545', floor: '#2D2668', violet: '#463BA6', purple: '#5B3E9E', lilac: '#9A8FE6',
    periwinkle: '#6F7FE0', blue: '#1F6FB8', sky: '#8CCBEB', yellow: '#F6C945', orange: '#FF8A1F', coral: '#FF6B57',
    red: '#E8505B', peach: '#F6A57C', cream: '#FFF1CC', paper: '#FFFDF6', chalk: '#FFFFFF', ink: '#14110A',
    inkBlue: '#1B1640', tan: '#C99A62', grey: '#B9B4D6', white: '#F4F1FA',
  };
  const SKIN = { pale: '#F9CFB0', peach: '#F4A986', tan: '#D88E62', brown: '#A9643F', deep: '#6B3D25' };
  const HAIR = { ink: '#1B1640', indigo: '#3A2FA0', blue: '#2F86D6', coral: '#F2545B', yellow: '#F6C945', white: '#ECEAF4', brown: '#5A3420', orange: '#FF8A1F' };
  const GROUNDS = { indigo: { ground: P.indigo, floor: P.floor }, blue: { ground: P.blue, floor: '#1A5E9E' }, purple: { ground: '#3A2A7A', floor: '#30226A' } };
  const allowed = new Set([...Object.values(P), ...Object.values(SKIN), ...Object.values(HAIR), ...Object.values(GROUNDS).flatMap((g) => [g.ground, g.floor])].map((c) => c.toUpperCase()));

  // A colour from a palette key or a hex.
  function col(c, fallback) {
    if (!c) return fallback;
    return P[c] || SKIN[c] || HAIR[c] || c;
  }
  // A darker (amt > 0) or lighter (amt < 0) step of a colour; the result joins the allowed palette.
  function shade(hex, amt) {
    const h = col(hex).replace('#', '');
    const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const out = n.map((v) => Math.round(amt >= 0 ? v * (1 - amt) : v + (255 - v) * -amt));
    const res = '#' + out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('').toUpperCase();
    allowed.add(res);
    return res;
  }

  // ---- small helpers -------------------------------------------------------------------------------------------
  const f = (n) => String(Math.round(n * 10) / 10);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // A seeded random generator (mulberry32), so every wobble is the same on every render.
  function rng(seed) {
    let a = 0;
    for (const ch of String(seed)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0);
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Places local markup: translate, rotate, scale, optional mirror.
  function place(inner, o) {
    const s = o.s == null ? 1 : o.s;
    const t = `translate(${f(o.x || 0)} ${f(o.y || 0)})${o.rot ? ` rotate(${f(o.rot)})` : ''} scale(${o.flip ? -s : s} ${s})`;
    return `<g transform="${t}">${inner}</g>`;
  }
  // A local point moved the way place() moves it.
  function tp(pt, o) {
    const s = o.s == null ? 1 : o.s;
    let x = pt[0] * (o.flip ? -s : s);
    let y = pt[1] * s;
    if (o.rot) {
      const a = (o.rot * Math.PI) / 180;
      [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    }
    return [(o.x || 0) + x, (o.y || 0) + y];
  }
  // The animated wrapper every built thing gets: an id GSAP can move without fighting a transform attribute.
  const wrap = (id, inner, cls) => `<g id="${id}" class="${cls || 'rla-thing'}">${inner}</g>`;

  // ---- people --------------------------------------------------------------------------------------------------
  const HEADS = ['oval', 'round', 'long', 'square', 'heart'];
  const HAIRS = ['bob', 'long', 'curly', 'bun', 'swoop', 'afro', 'crop', 'bald', 'ponytail'];
  const FACES = ['neutral', 'curious', 'worried', 'pleased', 'thinking', 'focused'];
  const POSES = ['stand', 'hold', 'point', 'think', 'bust', 'bust-hold'];

  // Head shapes, head-local (centre 0,0; about 150 wide and 180 tall).
  function headShape(kind, fill) {
    if (kind === 'round') return `<ellipse cx="0" cy="0" rx="78" ry="82" fill="${fill}"/>`;
    if (kind === 'long') return `<ellipse cx="0" cy="4" rx="62" ry="96" fill="${fill}"/>`;
    if (kind === 'square') return `<rect x="-74" y="-88" width="148" height="178" rx="52" fill="${fill}"/>`;
    if (kind === 'heart') return `<path d="M-72,-20 C-74,-104 74,-104 72,-20 C70,42 32,90 0,94 C-32,90 -70,42 -72,-20 Z" fill="${fill}"/>`;
    return `<ellipse cx="0" cy="0" rx="70" ry="88" fill="${fill}"/>`;
  }
  // The hair: a back blob (behind the head) and a front blob (over the forehead). One big shape gives identity.
  function hairParts(kind, c) {
    const back = [];
    const front = [];
    if (kind === 'bob') {
      back.push(`<path d="M-94,-30 C-102,-124 -55,-134 0,-134 C55,-134 102,-124 94,-30 L98,72 Q60,84 40,70 L-40,70 Q-60,84 -98,72 Z" fill="${c}"/>`);
      front.push(`<path d="M-80,-18 C-88,-98 -46,-122 0,-122 C46,-122 88,-98 80,-18 L72,-48 L-72,-48 Z" fill="${c}"/>`);
    } else if (kind === 'long') {
      back.push(`<path d="M-96,-20 C-102,-128 -45,-140 5,-138 C72,-134 106,-96 98,-20 L112,206 Q60,222 30,200 L-30,200 Q-60,222 -112,206 Z" fill="${c}"/>`);
      front.push(`<path d="M-78,-26 C-86,-104 -40,-128 10,-126 C62,-124 92,-90 82,-14 C66,-66 14,-90 -36,-72 C-58,-62 -70,-46 -78,-26 Z" fill="${c}"/>`);
    } else if (kind === 'curly') {
      const R = rng('curly');
      for (let i = 0; i <= 15; i++) {
        const a = ((-36 + (i * 252) / 15) * Math.PI) / 180;
        back.push(`<circle cx="${f(98 * Math.cos(a))}" cy="${f(-18 - 112 * Math.sin(a))}" r="${f(34 + R() * 8)}" fill="${c}"/>`);
      }
      back.push(`<ellipse cx="0" cy="-30" rx="96" ry="104" fill="${c}"/>`);
      [-52, -18, 18, 52].forEach((x, i) => front.push(`<circle cx="${x}" cy="${-86 + (i % 2) * 8}" r="30" fill="${c}"/>`));
    } else if (kind === 'bun') {
      back.push(`<circle cx="0" cy="-138" r="44" fill="${c}"/>`);
      back.push(`<path d="M-78,-10 C-84,-112 -40,-126 0,-126 C40,-126 84,-112 78,-10 Z" fill="${c}"/>`);
      front.push(`<path d="M-76,-20 C-80,-104 -40,-122 0,-122 C40,-122 80,-104 76,-20 C66,-62 30,-78 2,-80 C-30,-78 -66,-62 -76,-20 Z" fill="${c}"/>`);
    } else if (kind === 'swoop') {
      back.push(`<path d="M-78,-8 C-90,-112 -40,-130 10,-128 C72,-126 92,-90 80,-8 Z" fill="${c}"/>`);
      front.push(`<path d="M-78,-18 C-96,-124 -10,-156 54,-132 C96,-116 100,-62 80,-16 C72,-64 40,-82 0,-76 C-32,-72 -60,-52 -78,-18 Z" fill="${c}"/>`);
    } else if (kind === 'afro') {
      back.push(`<circle cx="0" cy="-58" r="142" fill="${c}"/>`);
      front.push(`<path d="M-72,-38 C-68,-96 68,-96 72,-38 C52,-70 -52,-70 -72,-38 Z" fill="${c}"/>`);
    } else if (kind === 'crop') {
      back.push(`<path d="M-76,-20 C-84,-112 -40,-126 0,-126 C40,-126 84,-112 76,-20 Z" fill="${c}"/>`);
      front.push(`<path d="M-76,-28 C-82,-112 -40,-126 0,-126 C40,-126 82,-112 76,-28 L62,-58 L48,-48 L34,-64 L18,-52 L0,-66 L-18,-52 L-34,-64 L-48,-48 L-62,-58 Z" fill="${c}"/>`);
    } else if (kind === 'bald') {
      back.push(`<ellipse cx="-74" cy="-22" rx="24" ry="44" fill="${c}"/><ellipse cx="74" cy="-22" rx="24" ry="44" fill="${c}"/>`);
    } else if (kind === 'ponytail') {
      back.push(`<path d="M52,-86 C150,-100 166,40 116,140 C122,40 104,-24 46,-48 Z" fill="${c}"/>`);
      back.push(`<path d="M-78,-10 C-84,-112 -40,-128 0,-128 C40,-128 84,-112 78,-10 Z" fill="${c}"/>`);
      front.push(`<path d="M-76,-22 C-80,-106 -40,-124 4,-124 C46,-124 80,-104 76,-22 C60,-70 30,-84 -6,-82 C-40,-78 -64,-56 -76,-22 Z" fill="${c}"/>`);
    }
    return { back: back.join(''), front: front.join('') };
  }
  // Brows, eyes and mouth for each expression. Brows are bars; eyes are dots; the nose is one stroke.
  const FACE_SET = {
    neutral: { brows: [[0, 0], [0, 0]], mouth: 'flat' },
    curious: { brows: [[-9, -4], [0, 2]], mouth: 'o' },
    worried: { brows: [[-2, -14], [-2, 14]], mouth: 'down' },
    pleased: { brows: [[-6, 6], [-6, -6]], mouth: 'smile' },
    thinking: { brows: [[2, 12], [-10, -4]], mouth: 'side' },
    focused: { brows: [[3, 12], [3, -12]], mouth: 'flat' },
  };
  function faceParts(kind, skin) {
    const fs = FACE_SET[kind] || FACE_SET.neutral;
    const ink = HAIR.ink;
    const out = [];
    [-1, 1].forEach((side, i) => {
      const [dy, rot] = fs.brows[i];
      out.push(`<rect x="-19" y="-5" width="38" height="11" rx="5.5" fill="${ink}" transform="translate(${side * 28} ${-34 + dy}) rotate(${rot})"/>`);
      out.push(`<circle cx="${side * 28}" cy="-4" r="${kind === 'curious' ? 10.5 : 9}" fill="${ink}"/>`);
    });
    out.push(`<path d="M6,-12 L-9,24 L7,27" fill="none" stroke="${shade(skin, 0.22)}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
    const lip = P.red;
    const m = fs.mouth;
    if (m === 'smile') out.push(`<path d="M-28,44 Q0,76 28,44 Q0,58 -28,44 Z" fill="${lip}"/>`);
    else if (m === 'down') out.push(`<path d="M-20,60 Q0,44 20,60 Q0,52 -20,60 Z" fill="${lip}"/>`);
    else if (m === 'o') out.push(`<ellipse cx="0" cy="54" rx="8" ry="10" fill="${shade(lip, 0.35)}"/>`);
    else if (m === 'side') out.push(`<path d="M-2,52 Q14,47 28,50 Q14,56 -2,52 Z" fill="${lip}"/>`);
    else out.push(`<path d="M-20,50 Q0,44 20,50 Q0,58 -20,50 Z" fill="${lip}"/>`);
    return out.join('');
  }
  // The arms of each pose: [shoulder, elbow, hand] for left and right, in body units (feet at 0,0, head centre at 0,-700).
  const ARMS = {
    stand: { L: [[-96, -566], [-122, -452], [-116, -350]], R: [[96, -566], [122, -452], [116, -350]], hand: [116, -350] },
    hold: { L: [[-96, -566], [-122, -452], [-116, -350]], R: [[96, -566], [150, -448], [214, -488]], hand: [222, -494] },
    point: { L: [[-96, -566], [-122, -452], [-116, -350]], R: [[96, -566], [196, -600], [292, -640]], hand: [300, -644], finger: true },
    think: { L: [[-96, -566], [-70, -440], [52, -452]], R: [[96, -566], [92, -446], [26, -598]], hand: [26, -604], chin: true },
    bust: { L: null, R: null, hand: [0, -560] },
    'bust-hold': { L: null, R: [[110, -560], [230, -420], [210, -610]], hand: [212, -628] },
  };
  // Builds one person from options. Feet (or the bottom of a bust) sit on (x, y).
  function person(o) {
    o = Object.assign({ id: 'person', x: 960, y: 1000, s: 1, pose: 'stand', head: 'oval', hair: 'bob', hairColor: 'ink', skin: 'peach', face: 'neutral', glasses: false, beard: false, outfit: 'shirt', shirt: 'lilac', pants: 'violet' }, o);
    const skin = SKIN[o.skin] || col(o.skin);
    const hairC = HAIR[o.hairColor] || col(o.hairColor);
    const shirt = col(o.shirt);
    const pants = col(o.pants);
    const arms = ARMS[o.pose] || ARMS.stand;
    const bust = o.pose === 'bust' || o.pose === 'bust-hold';
    const parts = [];
    const hair = hairParts(o.hair, hairC);
    // legs and shoes
    if (!bust) {
      if (o.outfit === 'dress') {
        parts.push(`<rect x="-62" y="-260" width="40" height="240" rx="18" fill="${shade(skin, 0.08)}"/><rect x="22" y="-260" width="40" height="240" rx="18" fill="${shade(skin, 0.08)}"/>`);
      } else {
        parts.push(`<path d="M-92,-350 L-8,-350 L-14,-36 Q-14,-22 -28,-22 L-72,-22 Q-86,-22 -86,-36 Z" fill="${pants}"/>`);
        parts.push(`<path d="M8,-350 L92,-350 L86,-36 Q86,-22 72,-22 L28,-22 Q14,-22 14,-36 Z" fill="${pants}"/>`);
      }
      parts.push(`<ellipse cx="-52" cy="-16" rx="52" ry="20" fill="${HAIR.ink}"/><ellipse cx="52" cy="-16" rx="52" ry="20" fill="${HAIR.ink}"/>`);
    }
    // hair behind the head, the neck and the torso
    parts.push(`<g transform="translate(0 -700)">${hair.back}</g>`);
    parts.push(`<rect x="-24" y="-640" width="48" height="70" rx="12" fill="${shade(skin, 0.1)}"/>`);
    if (bust) {
      parts.push(`<path d="M-230,0 L-226,-470 Q-220,-596 -90,-600 L90,-600 Q220,-596 226,-470 L230,0 Z" fill="${shirt}"/>`);
    } else if (o.outfit === 'dress') {
      parts.push(`<path d="M-104,-556 Q-108,-596 -60,-598 L60,-598 Q108,-596 104,-556 L96,-420 L150,-230 Q0,-206 -150,-230 L-96,-420 Z" fill="${shirt}"/>`);
    } else if (o.outfit === 'coat') {
      parts.push(`<path d="M-108,-556 Q-112,-598 -60,-600 L60,-600 Q112,-598 108,-556 L120,-220 L-120,-220 Z" fill="${shirt}"/>`);
      parts.push(`<path d="M0,-560 L0,-220" stroke="${shade(shirt, 0.18)}" stroke-width="8" fill="none"/>`);
    } else {
      parts.push(`<path d="M-104,-556 Q-108,-596 -60,-598 L60,-598 Q108,-596 104,-556 L94,-330 L-94,-330 Z" fill="${shirt}"/>`);
    }
    parts.push(`<path d="M-26,-598 L0,-556 L26,-598 Z" fill="${shade(skin, 0.1)}"/>`);
    // the head
    const face = `<g transform="translate(0 -700)">` +
      `<ellipse cx="-70" cy="6" rx="14" ry="22" fill="${skin}"/><ellipse cx="70" cy="6" rx="14" ry="22" fill="${skin}"/>` +
      headShape(o.head, skin) + faceParts(o.face, skin) +
      (o.beard ? `<path d="M-72,0 Q-74,112 0,124 Q74,112 72,0 Q56,66 22,64 Q0,40 -22,64 Q-56,66 -72,0 Z" fill="${HAIR[o.beard] || col(o.beard)}"/>` + `<path d="M-20,50 Q0,44 20,50 Q0,58 -20,50 Z" fill="${P.red}"/>` : '') +
      hair.front +
      (o.glasses ? `<g fill="none" stroke="${HAIR.ink}" stroke-width="5"><circle cx="-28" cy="-4" r="24"/><circle cx="28" cy="-4" r="24"/><path d="M-4,-6 Q0,-12 4,-6 M-52,-8 L-70,-12 M52,-8 L70,-12"/></g>` : '') +
      `</g>`;
    parts.push(face);
    // arms, the held thing, then the hand over it
    const sleeve = shade(shirt, 0.12);
    const arm = (pts) => `<path d="M${pts[0][0]},${pts[0][1]} Q${pts[1][0]},${pts[1][1]} ${pts[2][0]},${pts[2][1]}" fill="none" stroke="${sleeve}" stroke-width="44" stroke-linecap="round"/>`;
    if (arms.L) parts.push(arm(arms.L), `<circle cx="${arms.L[2][0]}" cy="${arms.L[2][1]}" r="23" fill="${skin}"/>`);
    if (arms.R) {
      parts.push(arm(arms.R));
      if (o.holding) {
        const h = o.holding;
        const inner = h.prop ? PROP[h.prop](h).svg : h.svg;
        parts.push(`<g transform="translate(${f(arms.hand[0] + (h.dx || 0))} ${f(arms.hand[1] + (h.dy || 0))}) rotate(${f(h.rot || 0)}) scale(${f(h.s || 0.8)})">${inner}</g>`);
      }
      const [hx, hy] = arms.hand;
      parts.push(`<circle cx="${hx}" cy="${hy}" r="24" fill="${skin}"/>`);
      if (arms.finger) parts.push(`<rect x="${hx}" y="${hy - 8}" width="40" height="15" rx="7.5" fill="${skin}" transform="rotate(-22 ${hx} ${hy})"/>`);
      if (arms.chin) parts.push(`<rect x="${hx - 7}" y="${hy - 40}" width="15" height="40" rx="7.5" fill="${skin}"/>`);
    }
    const anchorsLocal = { head: [0, -700], eye: [28, -704], chin: [0, -610], top: [0, -860], hand: arms.hand, waist: [0, -340] };
    const anchors = {};
    for (const k of Object.keys(anchorsLocal)) anchors[k] = tp(anchorsLocal[k], o);
    const tl = tp([-240, -860], o);
    const br = tp([240, 0], o);
    return {
      id: o.id,
      kind: 'person',
      svg: wrap(o.id, place(`<g data-rla="person">${parts.join('')}</g>`, o)),
      anchors,
      box: [Math.min(tl[0], br[0]), Math.min(tl[1], br[1]), Math.max(tl[0], br[0]), Math.max(tl[1], br[1])],
      focus: { x: anchors.head[0], y: anchors.head[1] - 20 * (o.s || 1), r: 185 * (o.s || 1) },
    };
  }
  const PRESETS = {
    actor: { head: 'heart', hair: 'long', hairColor: 'coral', skin: 'peach', glasses: true, outfit: 'dress', shirt: 'sky' },
    writer: { head: 'oval', hair: 'swoop', hairColor: 'indigo', skin: 'tan', shirt: 'yellow', pants: 'violet' },
    manager: { head: 'round', hair: 'bob', hairColor: 'ink', skin: 'pale', glasses: true, shirt: 'coral', pants: 'violet' },
    professor: { head: 'long', hair: 'bald', hairColor: 'white', beard: 'white', skin: 'brown', outfit: 'coat', shirt: 'purple' },
    kid: { head: 'round', hair: 'curly', hairColor: 'blue', skin: 'peach', shirt: 'orange', pants: 'violet' },
    clerk: { head: 'square', hair: 'crop', hairColor: 'brown', skin: 'deep', shirt: 'lilac', pants: 'violet' },
    courier: { head: 'oval', hair: 'ponytail', hairColor: 'yellow', skin: 'tan', shirt: 'blue', pants: 'violet' },
    coder: { head: 'oval', hair: 'afro', hairColor: 'ink', skin: 'deep', glasses: true, shirt: 'peach', pants: 'violet' },
  };
  const cast = (name, o) => person(Object.assign({}, PRESETS[name], o));

  // ---- props ---------------------------------------------------------------------------------------------------
  // Each returns local markup centred on 0,0 and its radius (for the burst).
  const PROP = {
    book: (o) => {
      const c = col(o.colour, P.purple);
      return { r: 170, svg: `<rect x="-96" y="-126" width="206" height="266" rx="8" fill="${P.paper}"/><rect x="-110" y="-140" width="206" height="266" rx="10" fill="${c}"/><rect x="-110" y="-140" width="26" height="266" rx="8" fill="${shade(c, 0.25)}"/><rect x="-60" y="-80" width="110" height="10" rx="5" fill="${shade(c, -0.25)}"/>` };
    },
    apple: (o) => ({ r: 140, svg: `<path d="M0,-60 C40,-96 106,-82 106,-10 C106,60 60,106 25,100 C12,98 6,92 0,92 C-6,92 -12,98 -25,100 C-60,106 -106,60 -106,-10 C-106,-82 -40,-96 0,-60 Z" fill="${col(o.colour, P.coral)}"/><path d="M0,-58 Q2,-90 14,-112" fill="none" stroke="${P.tan}" stroke-width="13" stroke-linecap="round"/>` }),
    parcel: (o) => {
      const c = col(o.colour, P.orange);
      return { r: 160, svg: `<path d="M60,-40 L112,-82 L112,70 L60,110 Z" fill="${shade(c, 0.2)}"/><path d="M-112,-40 L-60,-82 L112,-82 L60,-40 Z" fill="${shade(c, -0.25)}"/><rect x="-112" y="-40" width="172" height="150" fill="${c}"/><rect x="-40" y="-40" width="28" height="150" fill="${P.cream}"/><path d="M-40,-40 L12,-82 L40,-82 L-12,-40 Z" fill="${P.cream}"/>` };
    },
    envelope: (o) => {
      const c = col(o.colour, P.cream);
      return { r: 150, svg: `<rect x="-124" y="-82" width="248" height="164" rx="8" fill="${c}"/><path d="M-124,82 L0,-2 L124,82 Z" fill="${shade(c, 0.07)}"/><path d="M-124,-82 L0,16 L124,-82 Z" fill="${shade(c, 0.14)}"/><circle cx="0" cy="12" r="17" fill="${P.coral}"/>` };
    },
    door: (o) => {
      const c = col(o.colour, P.coral);
      const frame = `<rect x="-112" y="-200" width="224" height="390" rx="10" fill="${shade(c, 0.35)}"/>`;
      if (o.open) return { r: 220, svg: `${frame}<rect x="-94" y="-182" width="188" height="372" fill="${P.night}"/><path d="M-94,-182 L-30,-160 L-30,212 L-94,190 Z" fill="${c}"/><circle cx="-44" cy="20" r="10" fill="${P.yellow}"/>` };
      return { r: 220, svg: `${frame}<rect x="-94" y="-182" width="188" height="372" fill="${c}"/><rect x="-68" y="-150" width="136" height="130" rx="8" fill="${shade(c, 0.1)}"/><rect x="-68" y="10" width="136" height="150" rx="8" fill="${shade(c, 0.1)}"/><circle cx="66" cy="0" r="13" fill="${P.yellow}"/>` };
    },
    conveyor: (o) => {
      const w = o.w || 700;
      let rollers = '';
      for (let x = -w / 2 + 40; x <= w / 2 - 40; x += 80) rollers += `<circle cx="${f(x)}" cy="0" r="14" fill="${P.lilac}"/>`;
      return { r: w / 2, svg: `<rect x="${-w / 2 + 40}" y="20" width="22" height="130" fill="${P.violet}"/><rect x="${w / 2 - 62}" y="20" width="22" height="130" fill="${P.violet}"/><rect x="${-w / 2}" y="-32" width="${w}" height="64" rx="32" fill="${P.inkBlue}"/>${rollers}<rect x="${-w / 2 + 20}" y="-32" width="${w - 40}" height="12" rx="6" fill="${P.grey}"/>` };
    },
    counter: (o) => {
      const w = o.w || 620;
      const c = col(o.colour, P.orange);
      let planks = '';
      for (let x = -w / 2 + 70; x < w / 2 - 20; x += 90) planks += `<rect x="${f(x)}" y="-96" width="10" height="226" fill="${shade(c, 0.12)}"/>`;
      return { r: w / 2, svg: `<rect x="${-w / 2 + 20}" y="-100" width="${w - 40}" height="230" fill="${c}"/>${planks}<rect x="${-w / 2}" y="-134" width="${w}" height="40" rx="8" fill="${P.peach}"/>` };
    },
    ticket: (o) => {
      const c = col(o.colour, P.yellow);
      let dash = '';
      for (let y = -50; y < 50; y += 20) dash += `<rect x="62" y="${y}" width="6" height="11" rx="3" fill="${shade(c, 0.22)}"/>`;
      return { r: 150, svg: `<path d="M-130,-62 H130 V-16 A16,16 0 0 0 130,16 V62 H-130 V16 A16,16 0 0 0 -130,-16 Z" fill="${c}"/>${dash}<rect x="-100" y="-30" width="130" height="14" rx="7" fill="${shade(c, 0.22)}"/><rect x="-100" y="4" width="90" height="14" rx="7" fill="${shade(c, 0.22)}"/>` };
    },
    phone: (o) => ({ r: 140, svg: `<rect x="-62" y="-118" width="124" height="236" rx="24" fill="${P.inkBlue}"/><rect x="-50" y="-100" width="100" height="196" rx="12" fill="${col(o.colour, P.periwinkle)}"/><rect x="-16" y="-112" width="32" height="7" rx="3.5" fill="${P.grey}"/>` }),
    laptop: (o) => ({ r: 200, svg: `<rect x="-150" y="-196" width="300" height="196" rx="14" fill="${P.inkBlue}"/><rect x="-134" y="-180" width="268" height="164" rx="6" fill="${col(o.colour, P.lilac)}"/><path d="M-182,0 L182,0 L204,26 L-204,26 Z" fill="${P.grey}"/>` }),
    server: (o) => {
      let units = '';
      for (let i = 0; i < 5; i++) {
        const y = -160 + i * 66;
        units += `<rect x="-80" y="${y}" width="160" height="52" rx="8" fill="${P.violet}"/><circle cx="-56" cy="${y + 26}" r="7" fill="${i === (o.lit == null ? 2 : o.lit) ? P.yellow : P.coral}"/><rect x="-30" y="${y + 20}" width="90" height="12" rx="6" fill="${P.purple}"/>`;
      }
      return { r: 220, svg: `<rect x="-100" y="-180" width="200" height="360" rx="16" fill="${P.inkBlue}"/>${units}` };
    },
    key: (o) => {
      const c = col(o.colour, P.yellow);
      return { r: 150, svg: `<path fill-rule="evenodd" d="M-136,0 A46,46 0 1 0 -44,0 A46,46 0 1 0 -136,0 Z M-108,0 A18,18 0 1 0 -72,0 A18,18 0 1 0 -108,0 Z" fill="${c}"/><rect x="-50" y="-12" width="176" height="24" rx="8" fill="${c}"/><rect x="72" y="8" width="16" height="34" rx="4" fill="${c}"/><rect x="102" y="8" width="16" height="26" rx="4" fill="${c}"/>` };
    },
    lock: (o) => {
      const c = col(o.colour, P.yellow);
      return { r: 150, svg: `<path d="M-50,-10 V-62 A50,50 0 0 1 50,-62 V-10" fill="none" stroke="${P.grey}" stroke-width="24"/><rect x="-82" y="-24" width="164" height="138" rx="22" fill="${c}"/><circle cx="0" cy="30" r="15" fill="${P.inkBlue}"/><rect x="-6" y="34" width="12" height="38" rx="5" fill="${P.inkBlue}"/>` };
    },
    clock: (o) => {
      const h = o.h == null ? 10 : o.h;
      const m = o.m == null ? 10 : o.m;
      let dots = '';
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        dots += `<circle cx="${f(74 * Math.sin(a))}" cy="${f(-74 * Math.cos(a))}" r="${i % 3 === 0 ? 7 : 4.5}" fill="${P.inkBlue}"/>`;
      }
      const ha = ((h % 12) + m / 60) * 30;
      const ma = m * 6;
      return { r: 150, svg: `<circle r="112" fill="${col(o.colour, P.coral)}"/><circle r="94" fill="${P.cream}"/>${dots}<rect x="-6" y="-52" width="12" height="58" rx="6" fill="${P.inkBlue}" transform="rotate(${f(ha)})"/><rect x="-4" y="-76" width="8" height="82" rx="4" fill="${P.inkBlue}" transform="rotate(${f(ma)})"/><circle r="10" fill="${P.coral}"/>` };
    },
    bell: (o) => {
      const c = col(o.colour, P.yellow);
      return { r: 150, svg: `<rect x="-112" y="40" width="224" height="32" rx="12" fill="${P.inkBlue}"/><path d="M-92,42 C-92,-64 92,-64 92,42 Z" fill="${c}"/><path d="M-62,10 C-58,-24 -34,-40 -10,-44 C-30,-30 -44,-10 -46,14 Z" fill="${shade(c, -0.45)}"/><rect x="-8" y="-82" width="16" height="30" rx="5" fill="${shade(c, 0.25)}"/><circle cx="0" cy="-86" r="15" fill="${shade(c, 0.25)}"/>` };
    },
    cup: (o) => {
      const c = col(o.colour, P.coral);
      return { r: 130, svg: `<path d="M70,-30 C130,-30 130,50 66,50" fill="none" stroke="${shade(c, 0.15)}" stroke-width="20"/><path d="M-82,-70 L82,-70 L66,74 Q64,88 50,88 L-50,88 Q-64,88 -66,74 Z" fill="${c}"/><ellipse cx="0" cy="-70" rx="82" ry="14" fill="${HAIR.brown}"/>` };
    },
    curtain: (o) => {
      const w = o.w || 1920;
      const h = o.h || 1080;
      const c = col(o.colour, P.coral);
      const d = shade(c, 0.18);
      let scallop = '';
      for (let x = -w / 2; x < w / 2; x += 120) scallop += `<circle cx="${x + 60}" cy="${-h / 2 + 110}" r="60" fill="${d}"/>`;
      const drape = (side) => {
        const x0 = side * (w / 2);
        const x1 = side * (w / 2 - 230);
        return `<path d="M${x0},${-h / 2} L${x1},${-h / 2} C${x1 + side * -30},${-h / 2 + 300} ${side * (w / 2 - 120)},${h / 2 - 420} ${side * (w / 2 - 150)},${h / 2 - 330} C${side * (w / 2 - 200)},${h / 2 - 200} ${side * (w / 2 - 240)},${h / 2 - 80} ${side * (w / 2 - 250)},${h / 2} L${x0},${h / 2} Z" fill="${c}"/>` +
          `<path d="M${side * (w / 2 - 70)},${-h / 2 + 120} C${side * (w / 2 - 80)},${-h / 2 + 400} ${side * (w / 2 - 90)},${h / 2 - 380} ${side * (w / 2 - 110)},${h / 2 - 330} L${side * (w / 2 - 92)},${h / 2 - 320} C${side * (w / 2 - 70)},${h / 2 - 400} ${side * (w / 2 - 56)},${-h / 2 + 400} ${side * (w / 2 - 50)},${-h / 2 + 120} Z" fill="${d}"/>` +
          `<rect x="${side > 0 ? w / 2 - 172 : -w / 2 + 132}" y="${h / 2 - 352}" width="40" height="36" rx="10" fill="${P.yellow}"/>`;
      };
      return { r: w / 2, svg: `${drape(-1)}${drape(1)}<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="110" fill="${d}"/>${scallop}` };
    },
    spotlight: (o) => {
      const beam = o.beam ? `<path d="M30,-118 L${o.beam[0]},${o.beam[1]} L${o.beam[0] + 340},${o.beam[1]} L70,-150 Z" fill="${P.cream}" opacity="0.16"/>` : '';
      return { r: 160, svg: `${beam}<rect x="-8" y="-60" width="16" height="180" fill="${P.inkBlue}"/><path d="M-70,128 L70,128 L40,110 L-40,110 Z" fill="${P.inkBlue}"/><g transform="rotate(-35 0 -90)"><rect x="-50" y="-140" width="100" height="90" rx="18" fill="${P.violet}"/><rect x="40" y="-136" width="20" height="82" rx="8" fill="${P.yellow}"/></g>` };
    },
    microphone: () => ({ r: 160, svg: `<rect x="-6" y="-60" width="12" height="190" fill="${P.inkBlue}"/><ellipse cx="0" cy="134" rx="70" ry="16" fill="${P.inkBlue}"/><rect x="-26" y="-140" width="52" height="96" rx="26" fill="${P.grey}"/><rect x="-30" y="-74" width="60" height="16" rx="8" fill="${P.violet}"/>` }),
    clipboard: (o) => {
      let lines = '';
      for (let i = 0; i < 5; i++) lines += `<rect x="-70" y="${-70 + i * 40}" width="${[140, 110, 130, 90, 120][i]}" height="10" rx="5" fill="${P.grey}"/>`;
      return { r: 180, svg: `<rect x="-110" y="-150" width="220" height="300" rx="16" fill="${col(o.colour, P.tan)}"/><rect x="-92" y="-118" width="184" height="252" rx="6" fill="${P.paper}"/>${lines}<rect x="-46" y="-166" width="92" height="40" rx="10" fill="${P.inkBlue}"/>` };
    },
    paper: () => {
      let lines = '';
      for (let i = 0; i < 6; i++) lines += `<rect x="-70" y="${-90 + i * 34}" width="${[140, 120, 136, 100, 130, 70][i]}" height="10" rx="5" fill="${P.grey}"/>`;
      return { r: 170, svg: `<path d="M-104,-140 L64,-140 L104,-100 L104,140 L-104,140 Z" fill="${P.paper}"/><path d="M64,-140 L64,-100 L104,-100 Z" fill="${P.grey}"/>${lines}` };
    },
    // a sound: bars of the wave over a row of sample ticks (the samples a start is counted in). o: w, bars
    waveform: (o) => {
      const w = o.w || 420;
      const n = o.bars || 21;
      const c = col(o.colour, P.yellow);
      let bars = '';
      let ticks = '';
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / n;
        const h = 26 + 84 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6));
        bars += `<rect x="${f(x - 6)}" y="${f(-h / 2 - 20)}" width="12" height="${f(h)}" rx="6" fill="${c}"/>`;
      }
      for (let i = 0; i <= n * 2; i++) ticks += `<rect x="${f(-w / 2 + (w * i) / (n * 2) - 2)}" y="${i % 4 === 0 ? 62 : 70}" width="4" height="${i % 4 === 0 ? 30 : 16}" rx="2" fill="${P.lilac}"/>`;
      return { r: w / 2 + 20, svg: `<rect x="${f(-w / 2 - 24)}" y="-96" width="${f(w + 48)}" height="${f(150)}" rx="20" fill="${P.violet}"/>${bars}<rect x="${f(-w / 2)}" y="78" width="${f(w)}" height="6" rx="3" fill="${P.lilac}"/>${ticks}` };
    },
    // the built page: a screen holding a small theatre in its slot (no words; a card goes on top). o: w
    screen: (o) => {
      const w = o.w || 640;
      const h = (w * 9) / 16;
      const x0 = -w / 2;
      const y0 = -h / 2;
      const red = P.coral;
      const dark = shade(red, 0.18);
      let scallop = '';
      for (let x = x0; x < -x0 - 1; x += w / 12) scallop += `<circle cx="${f(x + w / 24)}" cy="${f(y0 + h * 0.1)}" r="${f(w / 24)}" fill="${dark}"/>`;
      return { r: w / 2 + 20, svg: `<rect x="${f(x0 - 22)}" y="${f(y0 - 22)}" width="${f(w + 44)}" height="${f(h + 44)}" rx="18" fill="${P.inkBlue}"/>` +
        `<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" fill="${P.indigo}"/>` +
        `<rect x="${f(x0)}" y="${f(y0 + h * 0.78)}" width="${f(w)}" height="${f(h * 0.22)}" fill="${P.purple}"/>` +
        `<path d="M${f(x0)},${f(y0)} L${f(x0 + w * 0.13)},${f(y0)} C${f(x0 + w * 0.1)},${f(y0 + h * 0.5)} ${f(x0 + w * 0.12)},${f(y0 + h * 0.8)} ${f(x0 + w * 0.15)},${f(y0 + h)} L${f(x0)},${f(y0 + h)} Z" fill="${red}"/>` +
        `<path d="M${f(-x0)},${f(y0)} L${f(-x0 - w * 0.13)},${f(y0)} C${f(-x0 - w * 0.1)},${f(y0 + h * 0.5)} ${f(-x0 - w * 0.12)},${f(y0 + h * 0.8)} ${f(-x0 - w * 0.15)},${f(y0 + h)} L${f(-x0)},${f(y0 + h)} Z" fill="${red}"/>` +
        `<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h * 0.1)}" fill="${dark}"/>${scallop}` +
        `<rect x="-60" y="${f(-y0 + 22)}" width="120" height="60" fill="${P.inkBlue}"/><rect x="-150" y="${f(-y0 + 76)}" width="300" height="22" rx="8" fill="${P.inkBlue}"/>` };
    },
    platform: (o) => {
      const w = o.w || 1500;
      const c = col(o.colour, P.purple);
      return { r: w / 2, svg: `<rect x="${-w / 2}" y="-30" width="${w}" height="40" rx="6" fill="${shade(c, -0.2)}"/><rect x="${-w / 2 + 20}" y="10" width="${w - 40}" height="150" fill="${c}"/>` };
    },
  };
  const PROPS = Object.keys(PROP);
  // Builds one prop, placed.
  function prop(name, o) {
    o = Object.assign({ id: name, x: 960, y: 540, s: 1, rot: 0 }, o);
    if (!PROP[name]) throw new Error(`RLA.prop: no prop "${name}"; there are ${PROPS.join(', ')}`);
    const p = PROP[name](o);
    const s = o.s;
    return {
      id: o.id,
      kind: 'prop',
      svg: wrap(o.id, place(`<g data-rla="prop-${name}">${p.svg}</g>`, o)),
      local: p.svg,
      r: p.r * s,
      focus: { x: o.x, y: o.y, r: p.r * s },
      box: [o.x - p.r * s, o.y - p.r * s, o.x + p.r * s, o.y + p.r * s],
    };
  }

  // Several built things that enter together as one (a row of tickets, a stack of books).
  function group(id, parts, focus) {
    const svg = parts.map((p) => p.svg).join('');
    const boxes = parts.map((p) => p.box).filter(Boolean);
    const box = boxes.length ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))] : [0, 0, 0, 0];
    return { id, kind: 'prop', svg: wrap(id, svg), box, focus: focus || { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2, r: Math.max(box[2] - box[0], box[3] - box[1]) / 2 } };
  }

  // ---- paper cards ---------------------------------------------------------------------------------------------
  const CARD_PAD = 26;
  // Builds a paper card in HTML: a hand-lettered title, real code lines, and where the code is from.
  function card(o) {
    o = Object.assign({ id: 'card', x: 760, y: 120, rot: 0, title: '', lines: [], file: '', size: 'normal' }, o);
    const big = o.size === 'big';
    const titles = (Array.isArray(o.title) ? o.title : [o.title]).filter(Boolean);
    const titleH = titles.length * (big ? 74 : 58);
    const lineH = 42;
    const fileH = o.file ? 46 : 0;
    const chars = Math.max(...o.lines.map((l) => l.length), 0);
    const titleW = Math.max(0, ...titles.map((t) => t.length)) * (big ? 33 : 26);
    const w = o.w || Math.max(titleW, chars * 18.2, o.file.length * 15.6, 220) + CARD_PAD * 2;
    const h = CARD_PAD * 2 + titleH + o.lines.length * lineH + fileH + (o.lines.length && titles.length ? 8 : 0);
    const code = o.lines.map((l, i) => {
      let t = esc(l);
      if (o.hl && o.hl.line === i && o.hl.word) t = t.replace(esc(o.hl.word), `<span class="rla-hl">${esc(o.hl.word)}</span>`);
      return t;
    }).join('\n');
    const html = `<div id="${o.id}" class="rla-card${big ? ' rla-card-big' : ''}" style="left: ${f(o.x)}px; top: ${f(o.y)}px; width: ${f(w)}px; height: ${f(h)}px; transform: rotate(${f(o.rot)}deg);">` +
      titles.map((t) => `<div class="rla-card-title">${esc(t)}</div>`).join('') +
      (o.lines.length ? `<pre class="rla-card-code">${code}</pre>` : '') +
      (o.file ? `<div class="rla-card-file">${esc(o.file)}</div>` : '') +
      `</div><!--/rla-card-->`;
    const cx = o.x + w / 2;
    const cy = o.y + h / 2;
    const rot = (pt) => {
      const a = (o.rot * Math.PI) / 180;
      const dx = pt[0] - cx;
      const dy = pt[1] - cy;
      return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
    };
    return {
      id: o.id,
      kind: 'card',
      html,
      box: [o.x, o.y, o.x + w, o.y + h],
      w, h,
      // n points spread along the top edge, for a card hanging under its object
      top: (n) => Array.from({ length: n }, (_, i) => rot([o.x + w * (n === 1 ? 0.5 : 0.18 + (0.64 * i) / (n - 1)), o.y])),
      // n points spread along the bottom edge, where strings hang from
      bottom: (n) => Array.from({ length: n }, (_, i) => rot([o.x + w * (n === 1 ? 0.5 : 0.18 + (0.64 * i) / (n - 1)), o.y + h])),
      focus: { x: cx, y: cy, r: Math.max(w, h) / 2 + 30 },
    };
  }

  // ---- chalk ---------------------------------------------------------------------------------------------------
  // A rough line: a slightly bowed quadratic between jittered ends, so no two strokes are ruler-straight.
  function roughLine(a, b, R, amt) {
    const j = () => (R() - 0.5) * 2 * (amt || 2.5);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / (len || 1);
    const ny = (b[0] - a[0]) / (len || 1);
    const bow = (R() - 0.5) * len * 0.05;
    const mx = (a[0] + b[0]) / 2 + nx * bow;
    const my = (a[1] + b[1]) / 2 + ny * bow;
    return `M${f(a[0] + j())},${f(a[1] + j())} Q${f(mx)},${f(my)} ${f(b[0] + j())},${f(b[1] + j())}`;
  }
  // One chalk stroke that draws itself on (pathLength 1, hidden by its dash offset until motion.draw runs).
  const stroke = (d, w) => `<path class="rla-d" d="${d}" pathLength="1" stroke-dasharray="1 2" stroke-dashoffset="1.02" fill="none" stroke="${P.chalk}" stroke-width="${w || 8}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const chalkGroup = (id, inner) => `<g id="${id}" class="rla-chalk">${inner}</g>`;

  function burst(o) {
    o = Object.assign({ id: 'burst', x: 960, y: 540, r: 160, len: 46, n: 16 }, o);
    const R = rng(o.id);
    let d = '';
    for (let i = 0; i < o.n; i++) {
      const a = (i / o.n) * Math.PI * 2 + (R() - 0.5) * 0.12;
      const r0 = o.r + (R() - 0.5) * 14;
      const l = o.len * (0.75 + R() * 0.5);
      d += stroke(roughLine([o.x + r0 * Math.cos(a), o.y + r0 * Math.sin(a)], [o.x + (r0 + l) * Math.cos(a), o.y + (r0 + l) * Math.sin(a)], R, 1.5), 9);
    }
    return { id: o.id, kind: 'chalk', svg: chalkGroup(o.id, d) };
  }
  function sight(o) {
    o = Object.assign({ id: 'sight' }, o);
    const R = rng(o.id);
    const [a, b] = [o.from, o.to];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(3, Math.floor(len / 48));
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    let d = '';
    for (let row = -1; row <= 1; row += 2) {
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.15) / n;
        const t1 = (i + 0.62) / n;
        const off = row * 9;
        const p0 = [a[0] + (b[0] - a[0]) * t0 + nx * off, a[1] + (b[1] - a[1]) * t0 + ny * off];
        const p1 = [a[0] + (b[0] - a[0]) * t1 + nx * off, a[1] + (b[1] - a[1]) * t1 + ny * off];
        d += stroke(roughLine(p0, p1, R, 1.2), 6);
      }
    }
    return { id: o.id, kind: 'chalk', svg: chalkGroup(o.id, d) };
  }
  function strings(o) {
    o = Object.assign({ id: 'strings' }, o);
    const R = rng(o.id);
    const to = Array.isArray(o.to[0]) ? o.to : o.from.map(() => o.to);
    let d = '';
    o.from.forEach((p, i) => {
      d += stroke(roughLine(p, to[i], R, 1.5), 6);
    });
    const dots = to.map((p, i) => `<circle class="rla-dot" cx="${f(p[0])}" cy="${f(p[1])}" r="9" fill="${P.chalk}"/>`).join('');
    return { id: o.id, kind: 'chalk', svg: chalkGroup(o.id, d + dots) };
  }
  function arrow(o) {
    o = Object.assign({ id: 'arrow', bend: 0.18 }, o);
    const R = rng(o.id);
    const [a, b] = [o.from, o.to];
    const mx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * o.bend;
    const my = (a[1] + b[1]) / 2 + (b[0] - a[0]) * o.bend;
    const ang = Math.atan2(b[1] - my, b[0] - mx);
    const head = (s) => [b[0] - 34 * Math.cos(ang + s * 0.5), b[1] - 34 * Math.sin(ang + s * 0.5)];
    const d = stroke(`M${f(a[0])},${f(a[1])} Q${f(mx)},${f(my)} ${f(b[0])},${f(b[1])}`, 8) + stroke(roughLine(head(1), b, R, 1), 8) + stroke(roughLine(head(-1), b, R, 1), 8);
    return { id: o.id, kind: 'chalk', svg: chalkGroup(o.id, d) };
  }
  function underline(o) {
    o = Object.assign({ id: 'underline', x: 800, y: 600, w: 300 }, o);
    let d = `M${f(o.x)},${f(o.y)}`;
    for (let i = 1; i <= 6; i++) d += ` Q${f(o.x + (o.w * (i - 0.5)) / 6)},${f(o.y + (i % 2 ? -8 : 8))} ${f(o.x + (o.w * i) / 6)},${f(o.y)}`;
    return { id: o.id, kind: 'chalk', svg: chalkGroup(o.id, stroke(d, 8)) };
  }
  // a dashed box: a slot or frame drawn in chalk. o: id, x, y (top-left), w, h
  function frame(o) {
    o = Object.assign({ id: 'frame', x: 760, y: 340, w: 400, h: 225 }, o);
    const c = [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]];
    const R = rng(o.id);
    let d = '';
    for (let k = 0; k < 4; k++) {
      const a = c[k];
      const b = c[(k + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(3, Math.round(len / 46));
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.12) / n;
        const t1 = (i + 0.66) / n;
        d += stroke(roughLine([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1], R, 1.2), 7);
      }
    }
    return { id: o.id, kind: 'chalk', svg: chalkGroup(o.id, d) };
  }
  function ring(o) {
    o = Object.assign({ id: 'ring', x: 960, y: 540, rx: 200, ry: 120 }, o);
    const R = rng(o.id);
    let d = '';
    for (let i = 0; i <= 26; i++) {
      const a = -0.5 + (i / 24) * Math.PI * 2;
      const k = 1 + (R() - 0.5) * 0.04;
      d += `${i ? ' L' : 'M'}${f(o.x + o.rx * k * Math.cos(a))},${f(o.y + o.ry * k * Math.sin(a))}`;
    }
    return { id: o.id, kind: 'chalk', svg: chalkGroup(o.id, stroke(d, 8)) };
  }

  // ---- motion --------------------------------------------------------------------------------------------------
  const q = JSON.stringify;
  const motion = {
    hide: (sel) => `tl.set(${q(sel)}, {opacity: 0}, startS);`,
    pop: (sel, at) => `tl.set(${q(sel)}, {opacity: 0, scale: 0.72, transformOrigin: "50% 50%"}, startS);\ntl.to(${q(sel)}, {opacity: 1, scale: 1, duration: 0.55, ease: "back.out(1.6)"}, ${at});`,
    rise: (sel, at) => `tl.set(${q(sel)}, {opacity: 0, y: 46}, startS);\ntl.to(${q(sel)}, {opacity: 1, y: 0, duration: 0.6, ease: "power3.out"}, ${at});`,
    fade: (sel, at) => `tl.set(${q(sel)}, {opacity: 0}, startS);\ntl.to(${q(sel)}, {opacity: 1, duration: 0.5, ease: "power1.out"}, ${at});`,
    draw: (sel, at, dur, stagger) => `tl.to(${q(sel + ' .rla-d')}, {strokeDashoffset: 0, duration: ${dur || 0.35}, stagger: ${stagger == null ? 0.03 : stagger}, ease: "power1.inOut"}, ${at});`,
    dots: (sel, at) => `tl.set(${q(sel + ' .rla-dot')}, {opacity: 0}, startS);\ntl.to(${q(sel + ' .rla-dot')}, {opacity: 1, duration: 0.2, stagger: 0.05}, ${at});`,
    dim: (sel, at) => `tl.to(${q(sel)}, {opacity: 0.42, duration: 0.4, ease: "power1.out"}, ${at});`,
    out: (sel, at) => `tl.to(${q(sel)}, {opacity: 0, duration: 0.3, ease: "power1.out"}, ${at});`,
    camera: (sel, at, c) => {
      const z = c.zoom || 1;
      // the visible window never leaves the 1920 x 1080 world, so a pan never shows the frame's edge
      c = Object.assign({}, c, { x: Math.max(960 / z, Math.min(1920 - 960 / z, c.x)), y: Math.max(540 / z, Math.min(1080 - 540 / z, c.y)) });
      const x = 960 - z * c.x;
      const y = 540 - z * c.y;
      return `tl.to(${q(sel)}, {x: ${f(x)}, y: ${f(y)}, scale: ${z}, duration: ${c.dur || 1.4}, ease: "power2.inOut"}, ${at});`;
    },
    push: (sel, amount) => `tl.set(${q(sel)}, {transformOrigin: "50% 50%"}, startS);\ntl.fromTo(${q(sel)}, {scale: 1}, {scale: ${f2(1 + (amount == null ? 0.035 : amount))}, duration: endS - startS, ease: "sine.inOut"}, startS);`,
    crossfade: (outSel, inSel, at) => `tl.to(${q(outSel)}, {opacity: 0, duration: 0.6, ease: "power1.inOut"}, ${at});\ntl.set(${q(inSel)}, {opacity: 0}, startS);\ntl.to(${q(inSel)}, {opacity: 1, duration: 0.6, ease: "power1.inOut"}, ${at});`,
  };
  function f2(n) { return String(Math.round(n * 1000) / 1000); }
  const atBeat = (beat, delay) => (beat === 0 && !delay ? 'startS' : `beat(${beat}) + ${f2(delay == null ? 0.3 : delay)}`);

  // ---- lint ----------------------------------------------------------------------------------------------------
  // The markup checks of rules.md that can be read from text.
  function lint(html) {
    const out = [];
    const svgPart = html.replace(/<div[^>]*class="rla-card[\s\S]*?<!--\/rla-card-->/g, '').replace(/<!--[\s\S]*?-->/g, '');
    if (/Gradient\b/i.test(html)) out.push('gradient: fills are flat (rules 1)');
    if (/<text\b/i.test(html)) out.push('<text> in SVG: words go on paper cards (rules 3)');
    if (/box-shadow|drop-shadow|feDropShadow/i.test(html)) out.push('shadow: no shadows (rules 1)');
    for (const m of html.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)) {
      if (!allowed.has(m[1].toUpperCase())) out.push(`colour ${m[1]} is not in the palette (rules 1)`);
    }
    for (const m of html.matchAll(/<(path|rect|circle|ellipse|polygon)\b[^>]*>/g)) {
      const tag = m[0];
      const fill = /fill="([^"]+)"/.exec(tag);
      if (/stroke="#/.test(tag) && fill && fill[1] !== 'none') out.push(`outline: a filled ${m[1]} with a stroke (rules 1)`);
    }
    // words outside cards: any text node in the scene markup that is not inside a card
    const bare = svgPart.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '');
    const words = bare.split(/<[^>]*>/).map((t) => t.trim()).filter(Boolean);
    if (words.length) out.push(`words outside a paper card: "${words[0].slice(0, 40)}" (rules 3)`);
    return [...new Set(out)];
  }

  // ---- scenes --------------------------------------------------------------------------------------------------
  function scene(o) {
    o = Object.assign({ id: 'scene', ground: 'indigo', floor: 820, push: 0.035, specks: true, cards: 2 }, o);
    const g = GROUNDS[o.ground] || GROUNDS.indigo;
    const sid = `rla-${o.id}`;
    const setting = [];
    const items = [];
    const cams = [];
    const api = {
      set(svg) { setting.push(typeof svg === 'string' ? svg : svg.svg); return api; },
      add(beat, built, opt) {
        opt = Object.assign({}, opt);
        const kind = built.kind;
        const enter = opt.enter || (kind === 'chalk' ? 'draw' : kind === 'card' ? 'rise' : 'pop');
        const dim = opt.dim == null ? kind === 'card' : opt.dim;
        let focus = opt.focus === true ? built.focus : opt.focus || null;
        items.push({ beat, built, enter, delay: opt.delay, dim, focus, pin: !!opt.pin, extra: !!opt.extra || kind === 'chalk' });
        return api;
      },
      camera(beat, c) { cams.push(Object.assign({ beat }, c)); return api; },
      build() {
        const problems = [];
        // one new thing per sentence
        const per = {};
        for (const it of items) if (!it.extra) per[it.beat] = (per[it.beat] || 0) + 1;
        for (const [b, n] of Object.entries(per)) if (n > 1) problems.push(`sentence ${b} brings in ${n} new things; one per sentence (rules 5)`);
        // the focus gets the burst: every focus builds one
        const svg = [];
        const html = [];
        const tl = [];
        let lastBurst = null;
        let lastDims = [];
        const upCards = [];
        const sorted = items.map((it, i) => Object.assign({ i }, it)).sort((a, b) => a.beat - b.beat || (a.delay || 0.3) - (b.delay || 0.3) || a.i - b.i);
        let k = 0;
        for (const it of sorted) {
          const b = it.built;
          const sel = `#${b.id}`;
          const at = atBeat(it.beat, it.delay);
          if (b.html) html.push(b.html); else svg.push(b.svg);
          // only the newest o.cards cards stay up; an older one (unless pinned) is taken down as this one comes in.
          // Their strings go with them (a strings mark whose id starts with the card's id).
          if (b.kind === 'card') {
            upCards.push({ id: b.id, pin: !!it.pin });
            const loose = upCards.filter((c) => !c.pin);
            while (loose.length > o.cards) {
              const old = loose.shift();
              upCards.splice(upCards.indexOf(old), 1);
              tl.push(motion.out(`#${old.id}, [id^="${old.id}-str"]`, at));
            }
          }
          if (it.enter === 'draw') {
            tl.push(motion.draw(sel, at, b.kind === 'chalk' && /strings|sight/.test(b.id) ? 0.3 : 0.35, 0.03));
            if (/rla-dot/.test(b.svg || '')) tl.push(motion.dots(sel, `${at} + 0.3`));
          } else if (it.enter !== 'none' && !(it.beat === 0 && !it.delay)) {
            tl.push(motion[it.enter](sel, at));
          }
          if (it.focus) {
            const fc = it.focus;
            const bid = `${sid}-burst-${k++}`;
            const bu = burst({ id: bid, x: fc.x, y: fc.y, r: fc.r, len: Math.max(34, fc.r * 0.28), n: 16 });
            svg.push(bu.svg);
            tl.push(motion.draw(`#${bid}`, `${at} + 0.25`, 0.18, 0.025));
            if (lastBurst) tl.push(motion.out(lastBurst, at));
            for (const d of lastDims) tl.push(motion.dim(d, at));
            lastBurst = `#${bid}`;
            lastDims = [];
          }
          // a card keeps its paper opaque and dims its ink, so nothing behind shows through it
          if (it.dim) lastDims.push(b.kind === 'card' ? `${sel} > *` : sel);
        }
        for (const c of cams) tl.push(motion.camera(`#${sid}-world`, atBeat(c.beat, c.delay == null ? 0.1 : c.delay), c));
        if (o.push) tl.unshift(motion.push(`#${sid}-push`, o.push));
        tl.unshift(`tl.set(${q(`#${sid}-world`)}, {transformOrigin: "0 0", x: 0, y: 0, scale: 1}, startS);`);
        // the ground: never moves, and reaches past the frame so a tall or square stage is ground all the way
        const R = rng(o.id);
        let specks = '';
        if (o.specks) for (let i = 0; i < 14; i++) specks += `<circle cx="${f(R() * 1920)}" cy="${f(R() * (o.floor || 1080) * 0.9)}" r="${f(2 + R() * 2.5)}" fill="${P.lilac}" opacity="0.5"/>`;
        const ground = `<svg class="rla-ground" width="1920" height="1080" viewBox="0 0 1920 1080"><rect x="-1200" y="-1200" width="4320" height="3480" fill="${g.ground}"/>${o.floor ? `<rect x="-1200" y="${o.floor}" width="4320" height="2400" fill="${g.floor}"/>` : ''}${specks}</svg>`;
        const filter = `<defs><filter id="${sid}-chalk" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.5" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`;
        const chalkSvg = svg.filter((s) => /class="rla-chalk"/.test(s));
        const thingSvg = svg.filter((s) => !/class="rla-chalk"/.test(s));
        const markup = `<div id="${sid}" class="rla-scene">${ground}<div id="${sid}-push" class="rla-layer"><div id="${sid}-world" class="rla-layer">` +
          `<svg class="rla-svg" width="1920" height="1080" viewBox="0 0 1920 1080">${filter}${setting.join('')}${thingSvg.join('')}<g filter="url(#${sid}-chalk)">${chalkSvg.join('')}</g></svg>` +
          html.join('') + `</div></div></div>`;
        problems.push(...lint(markup));
        const style = `<style>\n#${sid} { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }\n#${sid} .rla-ground { position: absolute; left: 0; top: 0; overflow: visible; }\n#${sid} .rla-layer { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }\n#${sid} .rla-svg { position: absolute; left: 0; top: 0; overflow: visible; }\n</style>`;
        const text = `${style}\n${markup}\n<script data-oldguy-timeline>\n${tl.join('\n')}\n</script>\n`;
        if (text.length > 100 * 1024) problems.push(`scene is ${Math.round(text.length / 1024)} KB; at most 100 KB`);
        return { html: text, problems };
      },
    };
    return api;
  }

  // ---- the shared styles: palette tokens and paper cards (stage.html carries them; the gallery injects them) -------
  const CSS = [
    `:root { ${Object.entries(P).map(([k, v]) => `--rla-${k}: ${v};`).join(' ')} --rla-hand: 'RLA Hand', 'Patrick Hand', 'Comic Sans MS', cursive; --rla-mono: 'DejaVu Sans Mono', 'Liberation Mono', Menlo, Consolas, 'Courier New', monospace; }`,
    '.rla-card { position: absolute; box-sizing: border-box; padding: 26px; background: var(--rla-paper); color: var(--rla-ink); border-radius: 5px; transform-origin: 50% 50%; }',
    '.rla-card-title { font: 400 44px/58px var(--rla-hand); text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; color: var(--rla-ink); }',
    '.rla-card-big .rla-card-title { font-size: 58px; line-height: 74px; }',
    '.rla-card-code { margin: 8px 0 0; font: 600 30px/42px var(--rla-mono); font-variant-ligatures: none; white-space: pre; color: var(--rla-ink); }',
    '.rla-hl { background: var(--rla-yellow); border-radius: 6px; padding: 0 4px; margin: 0 -4px; }',
    '.rla-card-file { margin-top: 2px; font: 400 33px/44px var(--rla-hand); letter-spacing: 0.03em; white-space: nowrap; color: #6E1E18; }',
  ].join('\n');

  return { CSS, P, SKIN, HAIR, GROUNDS, shade, person, cast, PRESETS, HEADS, HAIRS, FACES, POSES, prop, PROPS, group, card, burst, sight, strings, arrow, underline, ring, frame, motion, scene, lint, esc };
});
