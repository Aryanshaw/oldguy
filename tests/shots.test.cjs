'use strict';
// The shot compiler: shots/<id>.json checked against the fixture art library and the numbered rules, laid out on the
// 1920x1080 stage, and compiled into a design scene.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadCatalog } = require('../lib/catalog.mts');
const { shotErrors, shotWarnings, RULES } = require('../lib/shots.mts');

const FIXTURE = path.join(__dirname, 'fixtures', 'flat-art');
const CAT = loadCatalog(FIXTURE);
const SOURCES = [{ file: 'shop.js', lines: [10, 14] }];
const CTX = { sentences: 4, sources: SOURCES, last: false };

// A good four-shot chapter: a counter, then a person, then the bell on the counter with its card, then a host reacts.
function good() {
  return {
    id: 'the-bell',
    metaphor: 'a shop bell',
    example: 'cart checkout',
    ground: 'indigo',
    title: 'The order',
    shots: [
      { beat: 0, ground: { id: 'room-corner', color: 'indigo' }, props: [{ id: 'shop-counter', at: 'center', focus: true }], keep: ['shop-counter'] },
      { beat: 1, cast: [{ who: 'body-a/coral', pose: 'stand', at: 'left' }], keep: ['shop-counter', 'body-a'] },
      {
        beat: 2,
        cast: [{ who: 'body-a/coral', pose: 'point', at: 'left' }],
        props: [{ id: 'bell', on: 'shop-counter.top', focus: true }],
        card: { title: 'THE ORDER', code: 'cart.checkout()', lit: 'checkout', src: 'shop.js:12', hang: 'bell.card' },
        chalk: [{ burst: 'bell' }, { sight: ['body-a.eye', 'bell'] }, { label: 'the bell = checkout', to: 'bell' }],
        camera: { move: 'push', to: 'bell', crop: 'mid' },
        keep: ['shop-counter', 'body-a', 'bell'],
      },
      { beat: 3, cast: [{ who: 'oldguy', pose: 'shock', at: 'right', talk: true }] },
    ],
  };
}

// The errors for the good chapter after `edit`, with the default context (or one given).
function errorsAfter(edit, ctx = CTX) {
  const ch = good();
  edit(ch);
  return shotErrors(ch, CAT, ctx);
}

test('a good chapter has no errors and no warnings', () => {
  assert.deepEqual(shotErrors(good(), CAT, CTX), []);
  assert.deepEqual(shotWarnings(good()), []);
});

test('every numbered rule has its text', () => {
  assert.deepEqual(Object.keys(RULES).sort(), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
});

test('each rule fails with its number and an exact message', () => {
  const cases = [
    // 01 one shot per sentence, in order
    [(ch) => { ch.shots.pop(); }, 'chapter has 3 shots for 4 sentences; one shot per sentence (rule 01)'],
    [(ch) => { ch.shots[2].beat = 3; }, 'shot 2: beat must be 2 (one shot per sentence, in order) (rule 01)'],
    // 02 one focus
    [(ch) => { ch.shots[2].props.push({ id: 'kettle', at: 'right', focus: true }); ch.shots[2].props[0].focus = true; }, 'shot 2: 2 focus items; at most one (rule 02)'],
    // 03 one new item per shot
    [(ch) => { ch.shots[0].props.push({ id: 'oven', at: 'left' }); }, 'shot 0: 2 new items (shop-counter, oven); bring in at most one per shot (rule 03)'],
    [(ch) => { ch.shots[1].keep = ['body-a']; ch.shots[2].keep = []; ch.shots[3].props = [{ id: 'shop-counter', at: 'left-third' }]; }, 'shot 3: 2 new items (oldguy, shop-counter); bring in at most one per shot (rule 03)'],
    // 04 words only on a card, a label or the title
    [(ch) => { ch.shots[3] = { beat: 3, raw: '<svg viewBox="0 0 10 10"><text>hi</text></svg>' }; }, 'shot 3: the raw SVG holds words; words go on a card, a label or the title (rule 04)'],
    // 05 cards cite a source
    [(ch) => { delete ch.shots[2].card.src; }, 'shot 2: the card has no src; give the file:line it shows (rule 05)'],
    [(ch) => { ch.shots[2].card.src = 'shop.js:40'; }, 'shot 2: card src "shop.js:40" is not inside a cited source (shop.js:10-14) (rule 05)'],
    // 06 references name an item in this shot and an anchor it has
    [(ch) => { ch.shots[2].chalk[0] = { burst: 'kettle' }; }, 'shot 2: "kettle" names no item in this shot (rule 06)'],
    [(ch) => { ch.shots[2].card.hang = 'bell.handle'; }, 'shot 2: bell has no anchor "handle"; it has top, card, floor (rule 06)'],
    [(ch) => { ch.shots[2].props[0].on = 'shop-counter'; }, 'shot 2: on "shop-counter" needs an anchor, like shop-counter.top (rule 06)'],
    [(ch) => { ch.shots[2].keep = ['oven']; }, 'shot 2: "oven" names no item in this shot (rule 06)'],
    // 07 who is a host or a cast body with a colourway, in a pose it has
    [(ch) => { ch.shots[1].cast[0].who = 'body-a'; }, 'shot 1: who "body-a" is not a host (oldguy) or a cast body with a colourway (body-a/coral) (rule 07)'],
    [(ch) => { ch.shots[1].cast[0].who = 'body-a/teal'; }, 'shot 1: colourway "teal" is unknown; use one of coral, peach, yellow, lilac, orange, sky (rule 07)'],
    [(ch) => { ch.shots[3].cast[0].pose = 'dance'; }, 'shot 3: oldguy has no pose "dance"; it has stand, shock (rule 07)'],
    // 09 the chapter frame
    [(ch) => { delete ch.metaphor; }, 'chapter needs "metaphor" (rule 09)'],
    [(ch) => { ch.title = ' '; }, 'chapter needs "title" (rule 09)'],
  ];
  for (const [edit, message] of cases) {
    const found = errorsAfter(edit);
    assert.ok(found.includes(message), `${message}\n  got: ${found.join('\n       ')}`);
  }
});

test('an unknown prop names the closest ones and the raw escape hatch', () => {
  const found = errorsAfter((ch) => { ch.shots[0].props[0].id = 'toaster'; });
  assert.ok(found.includes('shot 0: prop "toaster" not in catalog; closest: "oven", "shop-counter"; or use a raw shot'), found.join('\n'));
});

test('schema problems are named by field', () => {
  const cases = [
    [(ch) => { ch.shots[1].cast[0].at = 'middle'; }, 'shot 1: cast[0].at must be one of left, center, right, left-third, right-third'],
    [(ch) => { ch.shots[1].wobble = true; }, 'shot 1: unknown field "wobble"'],
    [(ch) => { ch.shots[2].chalk.push({ zigzag: 'bell' }); }, 'shot 2: chalk[3] must be one of burst, sight, label, underline, circle'],
    [(ch) => { ch.shots[2].camera.move = 'zoom'; }, 'shot 2: camera.move must be one of hold, push, pan'],
    [(ch) => { ch.shots[0].ground.id = 'beach'; }, 'shot 0: ground.id must be one of plain, room-corner, sky, starfield, floor'],
    [(ch) => { ch.shots[0].ground.color = 'teal'; }, 'shot 0: ground.color "teal" is not a palette colour'],
    [(ch) => { ch.ground = 'teal'; }, 'chapter ground "teal" is not a palette colour'],
    [(ch) => { ch.shots[2].card.lit = 'pay'; }, 'shot 2: card lit "pay" is not in its code'],
    [(ch) => { ch.shots[1].cast[0].talk = true; }, 'shot 1: cast[0] talks, but only a host can talk'],
    [(ch) => { ch.shots[3].raw = '<svg></svg>'; }, 'shot 3: a raw shot holds only beat, raw, ground and camera'],
    [(ch) => { ch.shots[3] = { beat: 3, raw: '<svg><script>x()</script></svg>' }; }, 'shot 3: the raw SVG may not use <script>'],
  ];
  for (const [edit, message] of cases) {
    const found = errorsAfter(edit);
    assert.ok(found.includes(message), `${message}\n  got: ${found.join('\n       ')}`);
  }
});

test('keep carries an item into the next shot so it is not new there', () => {
  // without keep on shot 0 the counter leaves after it, so shot 1 brings in nothing it can stand on: fine; but shot 2
  // then puts the bell on a counter that is gone
  const found = errorsAfter((ch) => { delete ch.shots[0].keep; ch.shots[1].keep = ['body-a']; });
  assert.ok(found.includes('shot 2: "shop-counter" names no item in this shot (rule 06)'), found.join('\n'));
  // an item listed again in the next shot stays without keep, and is not new there
  assert.deepEqual(errorsAfter((ch) => { delete ch.shots[0].keep; ch.shots[1].props = [{ id: 'shop-counter', at: 'center' }]; }).filter((e) => /rule 03/.test(e)), []);
});

test('the bookend is checked only on the last chapter, against the first chapter', () => {
  const first = good();
  // shot 3 neither reuses the first shot's ground nor its focus prop
  const message = 'bookend: the last shot must reuse the first shot\'s ground (room-corner, indigo) and focus prop (shop-counter) (rule 08)';
  assert.ok(!errorsAfter(() => {}, { ...CTX, first, last: false }).includes(message));
  assert.ok(!errorsAfter(() => {}, { ...CTX, last: true }).includes(message), 'no first chapter given');
  assert.ok(errorsAfter(() => {}, { ...CTX, first, last: true }).includes(message));
  const echoed = errorsAfter((ch) => {
    ch.shots[3] = { beat: 3, ground: { id: 'room-corner', color: 'indigo' }, props: [{ id: 'shop-counter', at: 'center', focus: true }] };
  }, { ...CTX, first, last: true });
  assert.deepEqual(echoed, []);
});

test('more than two raw shots is a warning, not an error', () => {
  const ch = good();
  ch.shots = [0, 1, 2, 3].map((beat) => ({ beat, raw: '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#FF6B57"/></svg>' }));
  assert.deepEqual(shotErrors(ch, CAT, CTX), []);
  assert.deepEqual(shotWarnings(ch), ['4 raw shots; more than 2 means the library is missing something (rule 10)']);
});

// ---- layout ----
const { layout, layoutChapter, anchorPoint } = require('../lib/shots.mts');

// The placed item called ref in a layout.
function placed(l, ref) {
  return l.placed.find((p) => p.ref === ref);
}

// True when two boxes overlap.
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test('a bell on a counter lands with its base on the counter top', () => {
  const l = layout({ beat: 0, props: [{ id: 'shop-counter', at: 'center' }, { id: 'bell', on: 'shop-counter.top', focus: true }] }, CAT);
  assert.deepEqual(l.errors, []);
  const top = anchorPoint(placed(l, 'shop-counter'), 'top');
  const base = anchorPoint(placed(l, 'bell'), 'floor');
  assert.ok(Math.abs(top.x - base.x) <= 1 && Math.abs(top.y - base.y) <= 1, JSON.stringify({ top, base }));
  // the counter stands on the floor line
  assert.equal(Math.round(anchorPoint(placed(l, 'shop-counter'), 'floor').y), 880);
});

test('a small prop is never taller than a person at scale 1', () => {
  const l = layout({ beat: 0, cast: [{ who: 'body-a/coral', pose: 'stand', at: 'left' }], props: [{ id: 'kettle', at: 'right' }] }, CAT);
  assert.ok(placed(l, 'kettle').box.h < placed(l, 'body-a').box.h);
  assert.equal(Math.round(placed(l, 'body-a').box.h), 620);
});

test('the card hangs clear of the focus item, or the layout says it cannot', () => {
  // hung from the counter, the card would sit right on the bell above it, so it moves aside
  const l = layout({
    beat: 0,
    props: [{ id: 'shop-counter', at: 'center' }, { id: 'bell', on: 'shop-counter.top', focus: true }],
    card: { title: 'THE ORDER', code: 'cart.checkout()', src: 'shop.js:12', hang: 'shop-counter.card' },
  }, CAT);
  assert.deepEqual(l.errors, []);
  assert.ok(!overlaps(l.card.box, placed(l, 'bell').box), JSON.stringify(l.card.box));
  assert.ok(l.card.box.x >= 60 && l.card.box.x + l.card.box.w <= 1860 && l.card.box.y >= 60);
  assert.equal(l.card.strings.length, 2);
  // a counter twice the size fills the frame: there is nowhere for the card
  const full = layout({
    beat: 0,
    props: [{ id: 'shop-counter', at: 'center', scale: 2, focus: true }],
    card: { title: 'THE ORDER', src: 'shop.js:12', hang: 'shop-counter.card' },
  }, CAT);
  assert.deepEqual(full.errors, ['shot 0: the card cannot sit clear of the focus item (shop-counter); make it smaller or hang the card elsewhere']);
});

test('depth: floor props, then people, then props standing on things, then the card', () => {
  const l = layout({
    beat: 0,
    cast: [{ who: 'body-a/coral', pose: 'point', at: 'left' }],
    props: [{ id: 'shop-counter', at: 'center' }, { id: 'bell', on: 'shop-counter.top', focus: true }],
    card: { title: 'BELL', src: 'shop.js:12', hang: 'bell.card' },
  }, CAT);
  assert.deepEqual(l.placed.map((p) => [p.ref, p.z]), [['shop-counter', 10], ['body-a', 20], ['bell', 30]]);
  assert.equal(l.card.z, 40);
});

test('people face the focus item unless face says otherwise', () => {
  const at = (where, face) => placed(layout({ beat: 0, cast: [{ who: 'body-a/coral', pose: 'point', at: where, face }], props: [{ id: 'bell', at: 'center', focus: true }] }, CAT), 'body-a');
  assert.equal(at('left').flip, false, 'drawn facing right, the bell is to the right');
  assert.equal(at('right').flip, true);
  assert.equal(at('right', 'right').flip, false);
  // a flipped drawing mirrors its anchors: the pointing hand is on the bell's side
  const p = at('right');
  assert.ok(anchorPoint(p, 'hand').x < anchorPoint(p, 'floor').x);
});

test('items that leave the frame and people who share a place are errors', () => {
  assert.deepEqual(layout({ beat: 0, cast: [{ who: 'body-a/coral', pose: 'stand', at: 'left' }, { who: 'oldguy', pose: 'stand', at: 'left' }] }, CAT).errors,
    ['shot 0: two people stand at "left"']);
  assert.deepEqual(layout({ beat: 0, props: [{ id: 'shop-counter', at: 'right', scale: 2 }] }, CAT).errors, ['shot 0: shop-counter leaves the frame']);
});

test('a carried item keeps its place in the next shot, and layout problems count as shot errors', () => {
  const shots = layoutChapter(good(), CAT);
  assert.deepEqual(shots.flatMap((s) => s.errors), []);
  assert.deepEqual(placed(shots[1], 'shop-counter').box, placed(shots[0], 'shop-counter').box);
  assert.deepEqual(shots[3].placed.map((p) => p.ref).sort(), ['bell', 'body-a', 'oldguy', 'shop-counter']);
  assert.ok(errorsAfter((ch) => { ch.shots[0].props[0].scale = 2; ch.shots[0].props[0].at = 'right'; }).includes('shot 0: shop-counter leaves the frame'));
});
