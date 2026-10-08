// The shot compiler for flat illustrated chapters. Claude writes shots/<id>.json, one shot per sentence, naming
// drawings from the art library (lib/catalog.mts) and where they go; this module checks it against the library and the
// numbered rules, lays every shot out on the 1920x1080 stage, and compiles the chapter into a design scene
// (scenes/<id>.html) that the existing design piece plays with beat(n). Claude never draws: placement, depth, motion
// and the chalk marks are all decided here.
import fs from 'node:fs';
import path from 'node:path';
import { findItem, closest, colourway, recolour, recolourMap, ART_DIR } from './catalog.mts';
import { f, rng, burst, sight, strings, leader, underline, circle, chalkFilter, ground, motion } from './shots-runtime.mts';
import type { Catalog, Item, Layers } from './catalog.mts';

const PLACES = ['left', 'center', 'right', 'left-third', 'right-third'] as const;
const GROUND_IDS = ['plain', 'room-corner', 'sky', 'starfield', 'floor'] as const;
const MOVES = ['hold', 'push', 'pan'] as const;
const CROPS = ['wide', 'mid', 'close'] as const;
const CHALK_KINDS = ['burst', 'sight', 'label', 'underline', 'circle'] as const;
const SHOT_FIELDS = ['beat', 'ground', 'cast', 'props', 'card', 'chalk', 'camera', 'keep', 'raw'];
const RAW_FIELDS = ['beat', 'raw', 'ground', 'camera'];
// A raw SVG may not hold anything that runs code, loads a file or links away (the design piece refuses them too).
const RAW_BANNED_TAGS = /<\s*\/?\s*(script|iframe|frame|object|embed|link|meta|base|form|input|button|textarea|select|template|audio|video|img|image|use|foreignobject|style)\b/i;
const RAW_BANNED_ATTRS = /\s(on[a-z]+|src|srcset|href|xlink:href|action|formaction|poster|data)\s*=/i;
// More raw shots than this in a chapter means the library is missing something.
const MAX_RAW = 2;

// The numbered rules every shot list follows; messages quote them as (rule NN). templates/real-life-analogy/rules.md
// says the same in prose.
const RULES: Record<string, string> = {
  '01': 'one shot per sentence: shot n is on beat n, every sentence once, in order',
  '02': 'at most one focus item per shot',
  '03': 'at most one new item per shot (an item is new when it was not on screen in the shot before)',
  '04': 'words only on a card, a chalk label or the title card',
  '05': 'every card has a src, a file:line inside one of the chapter\'s cited sources',
  '06': 'every reference (on, hang, sight, to, burst, underline, circle, camera.to, keep) names an item in this shot, and an anchor it has',
  '07': 'who is a host id or a cast body with a colourway (body-a/coral), in a pose the library has',
  '08': 'bookend: the last chapter\'s last shot reuses the first chapter\'s first ground and focus prop',
  '09': 'the chapter has a metaphor, an example and a title',
  '10': 'more than 2 raw shots in a chapter is a warning: the library is missing something',
};

// Where an item stands across the stage.
type Place = (typeof PLACES)[number];
// A ground layout drawn in code, in one palette colour.
type Ground = { id: (typeof GROUND_IDS)[number]; color: string };
// A person in a shot: a host id (oldguy) or a cast body with a colourway (body-a/coral), in a pose.
type CastEntry = { who: string; pose: string; at: Place; scale?: number; face?: 'left' | 'right'; talk?: boolean };
// A prop in a shot: on the floor at a place, or standing on another item's anchor ("shop-counter.top").
type PropEntry = { id: string; at?: Place; on?: string; focus?: boolean; scale?: number };
// The paper card: a hand-lettered title and/or one line of real code with one word lit, and where the code is from.
type Card = { title?: string; code?: string; lit?: string; src: string; hang?: string; at?: Place };
// One chalk mark.
type Chalk = { burst: string } | { sight: [string, string] } | { label: string; to: string } | { underline: string } | { circle: string };
// How the camera moves across the sentence.
type Camera = { move: (typeof MOVES)[number]; to?: string; crop?: (typeof CROPS)[number] };
// One shot: what is on screen while one sentence is spoken.
type Shot = {
  beat: number;
  ground?: Ground;
  cast?: CastEntry[];
  props?: PropEntry[];
  card?: Card;
  chalk?: Chalk[];
  camera?: Camera;
  keep?: string[];
  raw?: string;
};
// A chapter's shots/<id>.json.
type ChapterShots = { id: string; metaphor: string; example: string; ground: string; title: string; shots: Shot[] };
// One cited source of the chapter: a card's src must point inside one.
type SourceRange = { file: string; lines: [number, number] };
// What the checks need besides the shots: the chapter's sentence count and sources, the first chapter of the video
// (for the bookend) and whether this is the last chapter.
type ShotContext = { sentences: number; sources: SourceRange[]; first?: ChapterShots; last: boolean };
// One item on screen in a shot, resolved against the library. `ref` is the name other fields use for it (a prop's id,
// a host id, a cast body); `listed` is false for an item carried over by the shot before's keep.
type Thing = {
  ref: string;
  kind: Item['kind'];
  item: Item;
  colourway?: string;
  at?: Place;
  on?: string;
  scale: number;
  focus: boolean;
  face?: 'left' | 'right';
  talk: boolean;
  listed: boolean;
};
// A shot after resolving: what is on screen, which of it is new, and the ground it is drawn on.
type ResolvedShot = { shot: Shot; things: Map<string, Thing>; fresh: string[]; ground: Ground };

// True when the value is a plain object (not null, not a list).
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// True when the value is non-empty text.
function hasText(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

// True when the value is one of the listed strings.
function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v);
}

// The rule number a message ends with.
function rule(n: string): string {
  return ` (rule ${n})`;
}

// Splits a reference "bell.card" into the item name and the anchor ("bell", "card"); a bare "bell" has no anchor.
function splitRef(ref: string): { name: string; anchor?: string } {
  const dot = ref.indexOf('.');
  return dot === -1 ? { name: ref } : { name: ref.slice(0, dot), anchor: ref.slice(dot + 1) };
}

// The ground the shot is drawn on: its own, or the one before it, or the chapter's colour on a plain ground.
function groundOf(shot: Shot, before: Ground | undefined, ch: ChapterShots): Ground {
  return isObject(shot.ground) ? shot.ground : before ?? { id: 'plain', color: ch.ground };
}

// Lists the problems with one shot's fields that need no library: field names, places, chalk kinds, camera, card text.
function shapeErrors(shot: Record<string, unknown>, i: number, cat: Catalog): string[] {
  const errs: string[] = [];
  const at = (msg: string) => errs.push(`shot ${i}: ${msg}`);
  for (const k of Object.keys(shot)) if (!SHOT_FIELDS.includes(k)) at(`unknown field "${k}"`);
  if (shot.raw !== undefined) {
    if (Object.keys(shot).some((k) => !RAW_FIELDS.includes(k))) at(`a raw shot holds only ${RAW_FIELDS.slice(0, -1).join(', ')} and ${RAW_FIELDS.at(-1)}`);
    const raw = typeof shot.raw === 'string' ? shot.raw.trim() : '';
    if (!/^<svg\b[\s\S]*<\/svg>$/.test(raw)) at('raw must be one <svg>...</svg>');
    const tag = RAW_BANNED_TAGS.exec(raw);
    if (tag) at(`the raw SVG may not use <${tag[1].toLowerCase()}>`);
    const attr = RAW_BANNED_ATTRS.exec(raw);
    if (attr) at(`the raw SVG may not use ${attr[1].toLowerCase()}=`);
    const words = raw.replace(/<!--[\s\S]*?-->/g, '').split(/<[^>]*>/).some((t) => t.trim() !== '');
    if (/<text\b/i.test(raw) || words) at(`the raw SVG holds words; words go on a card, a label or the title${rule('04')}`);
  }
  if (shot.ground !== undefined) {
    const g = shot.ground;
    if (!isObject(g)) at('ground must be {id, color}');
    else {
      if (!oneOf(GROUND_IDS, g.id)) at(`ground.id must be one of ${GROUND_IDS.join(', ')}`);
      if (typeof g.color !== 'string' || !Object.hasOwn(cat.palette.tokens, g.color)) at(`ground.color "${String(g.color)}" is not a palette colour`);
    }
  }
  for (const list of ['cast', 'props', 'chalk', 'keep'] as const) {
    if (shot[list] !== undefined && !Array.isArray(shot[list])) at(`${list} must be a list`);
  }
  const cast: unknown[] = Array.isArray(shot.cast) ? shot.cast : [];
  cast.forEach((c, j) => {
    if (!isObject(c)) { at(`cast[${j}] must be an object`); return; }
    if (!oneOf(PLACES, c.at)) at(`cast[${j}].at must be one of ${PLACES.join(', ')}`);
    if (typeof c.who !== 'string' || typeof c.pose !== 'string') at(`cast[${j}] needs who and pose`);
    if (c.scale !== undefined && !(typeof c.scale === 'number' && c.scale >= 0.3 && c.scale <= 2)) at(`cast[${j}].scale must be a number from 0.3 to 2`);
    if (c.face !== undefined && c.face !== 'left' && c.face !== 'right') at(`cast[${j}].face must be left or right`);
  });
  const props: unknown[] = Array.isArray(shot.props) ? shot.props : [];
  props.forEach((p, j) => {
    if (!isObject(p) || typeof p.id !== 'string') { at(`props[${j}] needs an id`); return; }
    if (p.at !== undefined && !oneOf(PLACES, p.at)) at(`props[${j}].at must be one of ${PLACES.join(', ')}`);
    if (p.at !== undefined && p.on !== undefined) at(`props[${j}] has both at and on; give one`);
    if (p.on !== undefined && typeof p.on !== 'string') at(`props[${j}].on must be "item.anchor"`);
    if (p.scale !== undefined && !(typeof p.scale === 'number' && p.scale >= 0.3 && p.scale <= 2)) at(`props[${j}].scale must be a number from 0.3 to 2`);
  });
  const chalk: unknown[] = Array.isArray(shot.chalk) ? shot.chalk : [];
  chalk.forEach((m, j) => {
    const kinds = isObject(m) ? CHALK_KINDS.filter((k) => m[k] !== undefined) : [];
    if (kinds.length !== 1) { at(`chalk[${j}] must be one of ${CHALK_KINDS.join(', ')}`); return; }
    const mark = m as Record<string, unknown>;
    if (kinds[0] === 'sight' && !(Array.isArray(mark.sight) && mark.sight.length === 2 && mark.sight.every((s) => typeof s === 'string'))) at(`chalk[${j}].sight must be [from, to]`);
    else if (kinds[0] === 'label' && (!hasText(mark.label) || typeof mark.to !== 'string')) at(`chalk[${j}] needs label text and to`);
    else if (kinds[0] !== 'sight' && kinds[0] !== 'label' && typeof mark[kinds[0]] !== 'string') at(`chalk[${j}].${kinds[0]} must name an item`);
  });
  if (shot.camera !== undefined) {
    const c = shot.camera;
    if (!isObject(c) || !oneOf(MOVES, c.move)) at(`camera.move must be one of ${MOVES.join(', ')}`);
    else {
      if (c.crop !== undefined && !oneOf(CROPS, c.crop)) at(`camera.crop must be one of ${CROPS.join(', ')}`);
      if (c.to !== undefined && typeof c.to !== 'string') at('camera.to must name an item');
    }
  }
  if (shot.card !== undefined) {
    const c = shot.card;
    if (!isObject(c)) at('card must be an object');
    else {
      if (!hasText(c.title) && !hasText(c.code)) at('the card needs a title or code');
      if (c.lit !== undefined && !(typeof c.lit === 'string' && typeof c.code === 'string' && c.lit && c.code.includes(c.lit))) at(`card lit "${String(c.lit)}" is not in its code`);
      if (c.at !== undefined && !oneOf(PLACES, c.at)) at(`card.at must be one of ${PLACES.join(', ')}`);
      if (c.at !== undefined && c.hang !== undefined) at('the card has both at and hang; give one');
    }
  }
  return errs;
}

// The library item for a person: a host by id, or a cast body; reports rule 07 problems through `bad`.
function personItem(entry: CastEntry, cat: Catalog, bad: (msg: string) => void): { item: Item; ref: string; colourway?: string } | null {
  const hosts = [...new Set(cat.items.filter((it) => it.kind === 'host').map((it) => String(it.body)))];
  const bodies = [...new Set(cat.items.filter((it) => it.kind === 'cast').map((it) => String(it.body)))];
  const [body, way, extra] = entry.who.split('/');
  const isHost = hosts.includes(body) && way === undefined;
  const isCast = bodies.includes(body) && way !== undefined && extra === undefined;
  if (!isHost && !isCast) {
    const example = bodies.length ? `${bodies[0]}/${Object.keys(cat.palette.colourways)[0]}` : 'none in the library yet';
    bad(`who "${entry.who}" is not a host (${hosts.join(', ') || 'none in the library yet'}) or a cast body with a colourway (${example})${rule('07')}`);
    return null;
  }
  const kind = isHost ? 'host' : 'cast';
  const poses = cat.items.filter((it) => it.kind === kind && it.body === body);
  const item = poses.find((it) => it.pose === entry.pose);
  if (!item) {
    bad(`${body} has no pose "${entry.pose}"; it has ${poses.map((it) => it.pose).join(', ')}${rule('07')}`);
    return null;
  }
  if (isCast) {
    try {
      colourway(item, way, cat.palette);
    } catch (err) {
      // colourway throws an Error naming the colourways that exist
      bad(`${(err as Error).message}${rule('07')}`);
      return null;
    }
  }
  return { item, ref: body, colourway: isCast ? way : undefined };
}

// Walks the shots in order and works out what is on screen in each: the listed items, plus those the shot before kept.
// Library and reference problems go into errs.
function resolveShots(ch: ChapterShots, cat: Catalog, errs: string[]): ResolvedShot[] {
  const out: ResolvedShot[] = [];
  let before = new Map<string, Thing>();
  let carried = new Map<string, Thing>();
  let ground: Ground | undefined;
  ch.shots.forEach((shot, i) => {
    const bad = (msg: string) => errs.push(`shot ${i}: ${msg}`);
    ground = groundOf(shot, ground, ch);
    const things = new Map<string, Thing>(shot.raw !== undefined ? [] : carried);
    const listed: string[] = [];
    // adds a listed item, refusing a second item of the same name in one shot
    const add = (t: Thing) => {
      if (listed.includes(t.ref)) { bad(`two items are called "${t.ref}"; one of each per shot`); return; }
      listed.push(t.ref);
      things.set(t.ref, t);
    };
    for (const c of Array.isArray(shot.cast) ? shot.cast : []) {
      if (!isObject(c) || typeof c.who !== 'string' || typeof c.pose !== 'string') continue;
      const found = personItem(c, cat, bad);
      if (!found) continue;
      if (c.talk === true && found.item.kind !== 'host') bad(`cast[${shot.cast!.indexOf(c)}] talks, but only a host can talk`);
      add({ ref: found.ref, kind: found.item.kind, item: found.item, colourway: found.colourway, at: c.at, scale: c.scale ?? 1, focus: false, face: c.face, talk: c.talk === true, listed: true });
    }
    for (const p of Array.isArray(shot.props) ? shot.props : []) {
      if (!isObject(p) || typeof p.id !== 'string') continue;
      const item = findItem(cat, p.id);
      if (!item || item.kind !== 'prop') {
        bad(`prop "${p.id}" not in catalog; closest: ${closest(cat, p.id, 2, 'prop').map((x) => `"${x}"`).join(', ')}; or use a raw shot`);
        continue;
      }
      add({ ref: p.id, kind: 'prop', item, at: p.on === undefined ? p.at ?? 'center' : undefined, on: p.on, scale: p.scale ?? 1, focus: p.focus === true, talk: false, listed: true });
    }
    // an item carried over but not listed again is not the focus here, whatever it was before
    for (const t of things.values()) if (!t.listed) t.focus = false;
    const fresh = listed.filter((ref) => !before.has(ref));
    out.push({ shot, things, fresh, ground });
    before = things;
    carried = new Map();
    for (const ref of Array.isArray(shot.keep) ? shot.keep : []) {
      const t = typeof ref === 'string' ? things.get(ref) : undefined;
      if (t) carried.set(ref, { ...t, listed: false });
    }
  });
  return out;
}

// Checks one reference ("bell", or "bell.card" when an anchor is needed or allowed) against what is on screen.
function refErrors(ref: unknown, things: Map<string, Thing>, opts: { anchor: 'need' | 'may' | 'no'; card?: boolean }): string | null {
  if (typeof ref !== 'string' || !ref) return `a reference must name an item${rule('06')}`;
  const { name, anchor } = splitRef(ref);
  if (opts.card && name === 'card' && anchor === undefined) return null;
  const t = things.get(name);
  if (!t) return `"${name}" names no item in this shot${rule('06')}`;
  if (anchor === undefined) return opts.anchor === 'need' ? `${ref} needs an anchor, like ${ref}.top${rule('06')}` : null;
  if (opts.anchor === 'no') return `"${ref}" takes an item, not an anchor${rule('06')}`;
  if (!Object.hasOwn(t.item.anchors, anchor)) return `${name} has no anchor "${anchor}"; it has ${Object.keys(t.item.anchors).join(', ')}${rule('06')}`;
  return null;
}

// Lists the rule 06 problems of one resolved shot: every reference names an item on screen and an anchor it has.
function referenceErrors(r: ResolvedShot, i: number): string[] {
  const errs: string[] = [];
  const s = r.shot;
  const check = (ref: unknown, anchor: 'need' | 'may' | 'no', card = false) => {
    const e = refErrors(ref, r.things, { anchor, card });
    if (e) errs.push(`shot ${i}: ${e}`);
  };
  for (const p of Array.isArray(s.props) ? s.props : []) {
    if (!isObject(p) || typeof p.on !== 'string') continue;
    if (!p.on.includes('.')) errs.push(`shot ${i}: on "${p.on}" needs an anchor, like ${p.on}.top${rule('06')}`);
    else check(p.on, 'need');
  }
  if (isObject(s.card) && s.card.hang !== undefined) {
    if (typeof s.card.hang === 'string' && !s.card.hang.includes('.')) errs.push(`shot ${i}: hang "${s.card.hang}" needs an anchor, like ${s.card.hang}.card${rule('06')}`);
    else check(s.card.hang, 'need');
  }
  for (const m of Array.isArray(s.chalk) ? s.chalk : []) {
    if (!isObject(m)) continue;
    const mark = m as Record<string, unknown>;
    if (Array.isArray(mark.sight)) for (const end of mark.sight) check(end, 'may');
    if (typeof mark.burst === 'string') check(mark.burst, 'no');
    if (typeof mark.to === 'string') check(mark.to, 'may', true);
    if (typeof mark.underline === 'string') check(mark.underline, 'no', true);
    if (typeof mark.circle === 'string') check(mark.circle, 'no', true);
  }
  if (isObject(s.camera) && s.camera.to !== undefined) check(s.camera.to, 'no', true);
  for (const k of Array.isArray(s.keep) ? s.keep : []) check(k, 'no');
  return errs;
}

// The rule 05 problem with a card's src, or null: it must be file:line inside one of the chapter's cited ranges.
function srcError(src: unknown, sources: SourceRange[]): string | null {
  if (!hasText(src)) return `the card has no src; give the file:line it shows${rule('05')}`;
  const m = /^(.+):(\d+)$/.exec(src.trim());
  const inside = m && sources.some((s) => s.file === m[1] && Number(m[2]) >= s.lines[0] && Number(m[2]) <= s.lines[1]);
  if (inside) return null;
  const cited = sources.map((s) => `${s.file}:${s.lines[0]}-${s.lines[1]}`).join(', ') || 'none';
  return `card src "${src}" is not inside a cited source (${cited})${rule('05')}`;
}

// The focus prop of a resolved shot, if any.
function focusOf(r: ResolvedShot): string | undefined {
  return [...r.things.values()].find((t) => t.focus)?.ref;
}

// Lists every problem with a chapter's shots: its fields, the library lookups and the numbered rules (an empty list
// when it can be compiled).
function shotErrors(ch: ChapterShots, cat: Catalog, ctx: ShotContext): string[] {
  if (!isObject(ch)) return ['shots file must hold an object'];
  const errs: string[] = [];
  for (const f of ['metaphor', 'example', 'title'] as const) if (!hasText(ch[f])) errs.push(`chapter needs "${f}"${rule('09')}`);
  if (typeof ch.ground !== 'string' || !Object.hasOwn(cat.palette.tokens, ch.ground)) errs.push(`chapter ground "${String(ch.ground)}" is not a palette colour`);
  if (!Array.isArray(ch.shots)) return [...errs, 'chapter needs "shots", a list with one shot per sentence'];
  if (ch.shots.length !== ctx.sentences) errs.push(`chapter has ${ch.shots.length} shots for ${ctx.sentences} sentences; one shot per sentence${rule('01')}`);
  const shapeOk = ch.shots.map((shot, i) => {
    if (!isObject(shot)) { errs.push(`shot ${i} must be an object`); return false; }
    if (shot.beat !== i) errs.push(`shot ${i}: beat must be ${i} (one shot per sentence, in order)${rule('01')}`);
    const found = shapeErrors(shot, i, cat);
    errs.push(...found);
    return found.length === 0;
  });
  if (!shapeOk.every(Boolean)) return errs;
  const resolved = resolveShots(ch, cat, errs);
  resolved.forEach((r, i) => {
    const s = r.shot;
    const focus = [...r.things.values()].filter((t) => t.focus).length;
    if (focus > 1) errs.push(`shot ${i}: ${focus} focus items; at most one${rule('02')}`);
    if (r.fresh.length > 1) errs.push(`shot ${i}: ${r.fresh.length} new items (${r.fresh.join(', ')}); bring in at most one per shot${rule('03')}`);
    if (s.card !== undefined) {
      const e = srcError(s.card.src, ctx.sources);
      if (e) errs.push(`shot ${i}: ${e}`);
    }
    errs.push(...referenceErrors(r, i));
  });
  if (ctx.last && ctx.first && Array.isArray(ctx.first.shots) && ctx.first.shots.length && resolved.length) {
    const firstShot = ctx.first.shots[0];
    const g = groundOf(firstShot, undefined, ctx.first);
    const firstFocus = (Array.isArray(firstShot.props) ? firstShot.props : []).find((p) => isObject(p) && p.focus === true)?.id;
    const lastR = resolved[resolved.length - 1];
    if (lastR.ground.id !== g.id || lastR.ground.color !== g.color || focusOf(lastR) !== firstFocus) {
      errs.push(`bookend: the last shot must reuse the first shot's ground (${g.id}, ${g.color}) and focus prop (${firstFocus ?? 'none'})${rule('08')}`);
    }
  }
  // the layout only means something once every reference holds
  if (errs.length === 0) errs.push(...layoutChapter(ch, cat).flatMap((l) => l.errors));
  return [...new Set(errs)];
}

// ---- layout ------------------------------------------------------------------------------------------------------

// The stage is 1920x1080; things stand on the floor line; the card keeps this far from the frame's edges.
const STAGE_W = 1920;
const STAGE_H = 1080;
const FLOOR_Y = 880;
const SAFE = 60;
// How tall each size class is drawn at scale 1, in stage pixels.
const SIZE_PX: Record<Item['size'], number> = { tiny: 70, small: 140, medium: 260, large: 420, person: 620, huge: 820 };
// Where each place puts an item's centre (its floor anchor) across the stage.
const PLACE_X: Record<Place, number> = { left: 480, 'left-third': 640, center: 960, 'right-third': 1280, right: 1440 };
// The paper card: its width, padding and line heights (title in the hand font, code in monospace, the src line).
const CARD_MIN_W = 300;
const CARD_MAX_W = 900;
const CARD_PAD = 26;
const CARD_TITLE_H = 58;
const CARD_CODE_H = 42;
const CARD_SRC_H = 40;
// How far above its hang point the card's bottom edge sits, and how far aside it moves to clear the focus item.
const CARD_DROP = 90;
const CARD_GAP = 40;
// Depth: ground 0, props on the floor 10+, people 20+, props standing on things 30+, the card 40, chalk 50.
const Z = { floor: 10, cast: 20, on: 30, card: 40, chalk: 50 };

// A box on the stage, in pixels.
type Box = { x: number; y: number; w: number; h: number };
// A point on the stage.
type Pt = { x: number; y: number };
// An item placed on the stage: its box, depth, whether it is mirrored, and how many stage pixels one viewBox unit is.
type Placed = { ref: string; item: Item; colourway?: string; box: Box; z: number; flip: boolean; s: number; talk: boolean };
// The card placed on the stage, with the strings that hang it (card bottom -> the hang point).
type CardBox = { box: Box; z: number; strings: [Pt, Pt][] };
// One shot laid out: what is where, the card, and anything that does not fit.
type ShotLayout = { placed: Placed[]; card?: CardBox; focus?: string; errors: string[] };

// Where one of an item's anchors lands on the stage (a mirrored item mirrors it inside its box). An item with no
// such anchor uses its box centre (floor: its bottom centre).
function anchorPoint(p: Placed, name: string): Pt {
  const [vx, vy] = p.item.viewBox;
  const a = Object.hasOwn(p.item.anchors, name) ? p.item.anchors[name] : undefined;
  if (!a) return name === 'floor' ? { x: p.box.x + p.box.w / 2, y: p.box.y + p.box.h } : { x: p.box.x + p.box.w / 2, y: p.box.y + p.box.h / 2 };
  const dx = (a.x - vx) * p.s;
  return { x: p.flip ? p.box.x + p.box.w - dx : p.box.x + dx, y: p.box.y + (a.y - vy) * p.s };
}

// The box an item gets when its floor anchor (or bottom centre) sits on point `at`, at its size class times scale.
function boxAt(item: Item, scale: number, at: Pt, flip: boolean): { box: Box; s: number } {
  const [vx, vy, vw, vh] = item.viewBox;
  const h = SIZE_PX[item.size] * scale;
  const s = h / vh;
  const w = vw * s;
  const f = Object.hasOwn(item.anchors, 'floor') ? item.anchors.floor : { x: vx + vw / 2, y: vy + vh };
  // mirrored, the floor anchor sits as far from the right edge as it sat from the left
  const fx = flip ? (vx + vw - f.x) * s : (f.x - vx) * s;
  return { box: { x: at.x - fx, y: at.y - (f.y - vy) * s, w, h }, s };
}

// True when two boxes overlap.
function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// The card's width for its longest line, within a minimum and a maximum.
function cardWidth(card: Card): number {
  // about 26 px a letter for the hand-lettered title, 18.2 for code and 13.5 for the src line
  const title = (hasText(card.title) ? card.title.length : 0) * 26;
  const code = (hasText(card.code) ? card.code.length : 0) * 18.2;
  const src = (hasText(card.src) ? card.src.length : 0) * 13.5;
  return Math.round(clamp(Math.max(title, code, src) + CARD_PAD * 2, CARD_MIN_W, CARD_MAX_W));
}

// The card's height for its content.
function cardHeight(card: Card): number {
  const title = hasText(card.title) ? CARD_TITLE_H : 0;
  const code = hasText(card.code) ? CARD_CODE_H : 0;
  return CARD_PAD * 2 + title + code + (title && code ? 8 : 0) + CARD_SRC_H;
}

// Keeps a value inside [lo, hi].
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Places the card: above its hang point (strings down to it) or at its place near the top, inside the safe frame,
// moved aside when it would cover the focus item. Returns nothing (and reports) when no place clears the focus item.
function placeCard(card: Card, placed: Placed[], focus: Placed | undefined, bad: (msg: string) => void): CardBox | undefined {
  const w = cardWidth(card);
  const h = cardHeight(card);
  let hangPt: Pt | undefined;
  let x: number;
  let y: number;
  if (typeof card.hang === 'string') {
    const { name, anchor } = splitRef(card.hang);
    const target = placed.find((p) => p.ref === name);
    if (!target || !anchor) return undefined;
    hangPt = anchorPoint(target, anchor);
    x = hangPt.x - w / 2;
    y = hangPt.y - CARD_DROP - h;
  } else {
    x = PLACE_X[card.at ?? 'right-third'] - w / 2;
    y = SAFE;
  }
  const inside = (bx: number, by: number): Box => ({ x: clamp(bx, SAFE, STAGE_W - SAFE - w), y: clamp(by, SAFE, STAGE_H - SAFE - h), w, h });
  let box = inside(x, y);
  if (focus && overlap(box, focus.box)) {
    // try beside the focus item, left and right, and take the one nearer where the card wanted to be
    const tries = [inside(focus.box.x - CARD_GAP - w, y), inside(focus.box.x + focus.box.w + CARD_GAP, y)]
      .filter((b) => !overlap(b, focus.box))
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
    if (!tries.length) {
      bad(`the card cannot sit clear of the focus item (${focus.ref}); make it smaller or hang the card elsewhere`);
      return undefined;
    }
    box = tries[0];
  }
  const bottom = (t: number): Pt => ({ x: box.x + box.w * t, y: box.y + box.h });
  const strings: [Pt, Pt][] = hangPt ? [[bottom(0.3), hangPt], [bottom(0.7), hangPt]] : [];
  return { box, z: Z.card, strings };
}

// Lays one resolved shot out: carried items keep their place from `before`, listed ones go to their place or onto
// the anchor they stand on; people face the focus item; then the card. Problems go to bad().
function placeShot(r: ResolvedShot, before: Map<string, Placed>, bad: (msg: string) => void): ShotLayout {
  const placed: Placed[] = [];
  const things = [...r.things.values()];
  const focus = things.find((t) => t.focus);
  const takenAt = new Set<string>();
  for (const t of things.filter((x) => x.kind !== 'prop' && x.listed)) {
    if (t.at && takenAt.has(t.at)) bad(`two people stand at "${t.at}"`);
    if (t.at) takenAt.add(t.at);
  }
  // the focus item's centre across the stage, for people to face: where it is, or where what it stands on is
  const focusX = (): number | undefined => {
    if (!focus) return undefined;
    const name = focus.on ? splitRef(focus.on).name : focus.ref;
    const p = placed.find((x) => x.ref === name);
    return p ? p.box.x + p.box.w / 2 : focus.at ? PLACE_X[focus.at] : undefined;
  };
  let floorN = 0;
  let castN = 0;
  let onN = 0;
  // props on the floor first, then people, then props standing on things (each after what it stands on)
  const rank = (t: Thing) => (t.kind === 'prop' && !t.on ? 0 : t.kind === 'prop' ? 2 : 1);
  const pending = [...things].sort((a, b) => rank(a) - rank(b));
  let guard = pending.length * pending.length + 1;
  while (pending.length && guard-- > 0) {
    const t = pending.shift()!;
    const kept = before.get(t.ref);
    if (!t.listed && kept) {
      placed.push({ ...kept, talk: false });
      continue;
    }
    if (t.on) {
      const { name, anchor } = splitRef(t.on);
      const target = placed.find((p) => p.ref === name);
      if (!target) {
        // what it stands on is not placed yet: try again after the others (a loop of "on" never places)
        if (pending.some((p) => p.ref === name)) pending.push(t);
        continue;
      }
      const { box, s } = boxAt(t.item, t.scale, anchorPoint(target, anchor ?? 'top'), false);
      placed.push({ ref: t.ref, item: t.item, box, s, z: Z.on + onN++, flip: false, talk: false });
      continue;
    }
    const cx = PLACE_X[t.at ?? 'center'];
    let flip = false;
    if (t.kind !== 'prop') {
      const native = t.item.faces ?? 'right';
      const fx = focusX();
      const want = t.face ?? (fx === undefined || Math.abs(fx - cx) < 1 ? native : fx > cx ? 'right' : 'left');
      flip = want !== native;
    }
    const { box, s } = boxAt(t.item, t.scale, { x: cx, y: FLOOR_Y }, flip);
    const z = t.kind === 'prop' ? Z.floor + floorN++ : Z.cast + castN++;
    placed.push({ ref: t.ref, item: t.item, colourway: t.colourway, box, s, z, flip, talk: t.talk });
  }
  for (const t of pending) bad(`${t.ref} stands on ${t.on}, which never gets placed`);
  for (const p of placed) {
    const b = p.box;
    if (b.x < -1 || b.y < -1 || b.x + b.w > STAGE_W + 1 || b.y + b.h > STAGE_H + 1) bad(`${p.ref} leaves the frame`);
  }
  placed.sort((a, b) => a.z - b.z);
  const focusPlaced = focus ? placed.find((p) => p.ref === focus.ref) : undefined;
  const card = isObject(r.shot.card) ? placeCard(r.shot.card, placed, focusPlaced, bad) : undefined;
  return { placed, card, focus: focusPlaced?.ref, errors: [] };
}

// Lays out every shot of a chapter in order, carrying kept items' places from shot to shot.
function layoutChapter(ch: ChapterShots, cat: Catalog): ShotLayout[] {
  const ignored: string[] = [];
  let before = new Map<string, Placed>();
  return resolveShots(ch, cat, ignored).map((r, i) => {
    const errors: string[] = [];
    const l = placeShot(r, before, (msg) => errors.push(`shot ${i}: ${msg}`));
    before = new Map(l.placed.map((p) => [p.ref, p]));
    return { ...l, errors };
  });
}

// Lays out one shot on its own (nothing carried in), naming problems as "shot <beat>: ...".
function layout(shot: Shot, cat: Catalog): ShotLayout {
  const errors: string[] = [];
  const [r] = resolveShots({ id: 'one', metaphor: '', example: '', ground: 'indigo', title: '', shots: [shot] }, cat, errors);
  const l = placeShot(r, new Map(), (msg) => errors.push(`shot ${shot.beat}: ${msg}`));
  return { ...l, errors };
}

// ---- compile ------------------------------------------------------------------------------------------------------

// A design scene may be at most this big (scene-kit/design.mts refuses a larger one).
const MAX_SCENE_BYTES = 100 * 1024;
// The title card is up for this long before the first shot's items come in.
const TITLE_S = 1.8;
// The hand-lettered font: the template's stage carries it as an @font-face (a scene may not load files), the scene
// names it with fallbacks.
const HAND_FONT = 'Oldguy Hand';
const HAND_STACK = `'${HAND_FONT}', 'Patrick Hand', 'Comic Sans MS', cursive`;

// A moment in the chapter: a sentence's start (or the piece's end) plus or minus seconds.
type When = { beat: number | 'end'; off: number };

// The timeline expression for a moment, e.g. "beat(2) + 0.15".
function at(w: When): string {
  const base = w.beat === 'end' ? 'endS' : `beat(${w.beat})`;
  const off = Math.round(w.off * 1000) / 1000;
  return off === 0 ? base : `${base} ${off > 0 ? '+' : '-'} ${Math.abs(off)}`;
}

// The same moment moved by n seconds.
function plus(w: When, n: number): When {
  return { beat: w.beat, off: w.off + n };
}

// Escapes text for HTML.
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The inside of an SVG file, ready to sit in the scene: no XML header, comments, titles or metadata, and every id
// (and every url(#id) pointing at one) prefixed so two drawings never share an id.
function innerSvg(text: string, prefix: string): { inner: string; viewBox?: string } {
  const s = text.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(title|desc|metadata)\b[\s\S]*?<\/\1>/gi, '');
  const open = /<svg\b[^>]*>/i.exec(s);
  const close = s.lastIndexOf('</svg>');
  if (!open || close < open.index) throw new Error('not an <svg> drawing');
  const viewBox = /\bviewBox="([^"]+)"/.exec(open[0])?.[1];
  const inner = s.slice(open.index + open[0].length, close).trim()
    .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${prefix}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${prefix}-${id})`);
  return { inner, viewBox };
}

// The @font-face rule for the hand-lettered font (Patrick Hand, SIL OFL 1.1, art/flat/fonts/OFL.txt), as a data URL.
// A template that uses shots puts it in its stage.html; a scene itself may not load anything.
function handFontCss(): string {
  const font = fs.readFileSync(path.join(ART_DIR, 'fonts', 'patrick-hand.woff2')).toString('base64');
  return `@font-face { font-family: '${HAND_FONT}'; font-style: normal; font-weight: 400; src: url(data:font/woff2;base64,${font}) format('woff2'); }`;
}

// The scene's styles, all under the scene's own id.
function sceneCss(sid: string, cat: Catalog): string {
  const t = cat.palette.tokens;
  const c = (name: string, fallback: string) => t[name] ?? fallback;
  return [
    `#${sid} { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: hidden; --fa-hand: ${HAND_STACK}; }`,
    `#${sid} .fa-layer { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; }`,
    `#${sid} .fa-ground, #${sid} .fa-svg { position: absolute; left: 0; top: 0; overflow: visible; }`,
    `#${sid} .fa-card { position: absolute; box-sizing: border-box; padding: ${CARD_PAD}px; background: ${c('paper', '#FFF8E7')}; color: ${c('ink', '#14110A')}; border-radius: 6px; }`,
    `#${sid} .fa-card-title { font: 400 44px/${CARD_TITLE_H}px var(--fa-hand); text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }`,
    `#${sid} .fa-card-code { margin: 8px 0 0; font: 600 30px/${CARD_CODE_H}px var(--og-font-mono, ui-monospace, monospace); font-variant-ligatures: none; white-space: pre; }`,
    `#${sid} .fa-lit { background: ${c('yellow', '#F6C945')}; border-radius: 6px; padding: 0 4px; margin: 0 -4px; }`,
    `#${sid} .fa-card-src { font: 400 28px/${CARD_SRC_H}px var(--fa-hand); letter-spacing: 0.03em; white-space: nowrap; color: ${c('coralDark', '#D9493A')}; }`,
    `#${sid} .fa-label { position: absolute; font: 400 46px/56px var(--fa-hand); color: ${c('chalk', '#FFFFFF')}; white-space: nowrap; }`,
    `#${sid} .fa-title-wrap { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; display: flex; align-items: center; justify-content: center; }`,
    `#${sid} .fa-title { padding: 40px 72px; background: ${c('paper', '#FFF8E7')}; color: ${c('ink', '#14110A')}; border-radius: 8px; font: 400 104px/1.1 var(--fa-hand); text-transform: uppercase; letter-spacing: 0.05em; transform: rotate(-6deg); max-width: 1400px; text-align: center; }`,
  ].join('\n');
}

// One pose of an item at one place: a nested <svg> in the instance's group.
type Variant = { id: string; key: string; p: Placed };
// One stay of an item on screen: from the shot it comes in to the last shot it is on screen, with each pose it takes.
type Instance = { id: string; ref: string; first: number; last: number; z: number; variants: Variant[]; shown: Map<number, Variant> };

// Where a chalk reference points: an anchor, or the middle of an item or of the card.
function refPoint(ref: string, placed: Placed[], card: CardBox | undefined): Pt {
  const { name, anchor } = splitRef(ref);
  if (name === 'card' && card) return { x: card.box.x + card.box.w / 2, y: card.box.y + card.box.h / 2 };
  const p = placed.find((x) => x.ref === name)!;
  return anchor ? anchorPoint(p, anchor) : { x: p.box.x + p.box.w / 2, y: p.box.y + p.box.h / 2 };
}

// The box a reference names: an item's, or the card's.
function refBox(ref: string, placed: Placed[], card: CardBox | undefined): Box {
  const { name } = splitRef(ref);
  if (name === 'card' && card) return card.box;
  return placed.find((x) => x.ref === name)!.box;
}

// Moves point a towards b by d pixels (or stops at b).
function towards(a: Pt, b: Pt, d: number): Pt {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = Math.min(1, d / len);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// The card's HTML: a hand-lettered title, the code line with its lit word, and the src line.
function cardHtml(id: string, card: Card, box: Box, rot: number): string {
  const title = hasText(card.title) ? `<div class="fa-card-title">${esc(card.title)}</div>` : '';
  let code = '';
  if (hasText(card.code)) {
    // the lit word is marked where it first appears in the line
    const i = card.lit ? card.code.indexOf(card.lit) : -1;
    const text = card.lit && i !== -1
      ? `${esc(card.code.slice(0, i))}<span class="fa-lit">${esc(card.lit)}</span>${esc(card.code.slice(i + card.lit.length))}`
      : esc(card.code);
    code = `<pre class="fa-card-code">${text}</pre>`;
  }
  return `<div id="${id}" class="fa-card" style="left: ${f(box.x)}px; top: ${f(box.y)}px; width: ${f(box.w)}px; height: ${f(box.h)}px; transform: rotate(${rot}deg);">${title}${code}<div class="fa-card-src">${esc(card.src)}</div></div>`;
}

// Compiles a checked chapter into its design scene (scenes/<id>.html): the grounds, every item drawn once per stay,
// the cards, chalk and title card, and a timeline of tween calls timed with beat(n). Throws on a layout problem or a
// scene over the design piece's size limit.
function compileChapter(ch: ChapterShots, cat: Catalog): string {
  const sid = `fa-${ch.id}`;
  const layouts = layoutChapter(ch, cat);
  const problems = layouts.flatMap((l) => l.errors);
  if (problems.length) throw new Error(`chapter ${ch.id}: ${problems.join('; ')}`);
  const resolved = resolveShots(ch, cat, []);
  const n = ch.shots.length;
  // shot k starts on its sentence (the first one after the title card) and ends where the next sentence starts
  const S = (k: number): When => (k === 0 ? { beat: 0, off: TITLE_S } : { beat: k, off: 0 });
  const E = (k: number): When => (k + 1 < n ? { beat: k + 1, off: 0 } : { beat: 'end', off: 0 });
  const R = rng(ch.id);
  const files = new Map<string, string>();
  const read = (item: Item) => {
    if (!files.has(item.file)) files.set(item.file, fs.readFileSync(path.join(cat.dir, item.file), 'utf8'));
    return files.get(item.file)!;
  };

  // ---- who is on screen when: one instance per stay, one variant per pose and place ----
  const instances: Instance[] = [];
  const open = new Map<string, Instance>();
  layouts.forEach((l, k) => {
    const still = new Map<string, Instance>();
    for (const p of l.placed) {
      let inst = open.get(p.ref);
      if (!inst) {
        inst = { id: `${sid}-${p.ref}-${k}`, ref: p.ref, first: k, last: k, z: p.z, variants: [], shown: new Map() };
        instances.push(inst);
      }
      inst.last = k;
      const key = `${p.item.id}|${p.colourway ?? ''}|${f(p.box.x)},${f(p.box.y)},${f(p.box.w)}|${p.flip}`;
      let v = inst.variants.find((x) => x.key === key);
      if (!v) {
        v = { id: `${inst.id}-v${inst.variants.length}`, key, p };
        inst.variants.push(v);
      }
      inst.shown.set(k, v);
      still.set(p.ref, inst);
    }
    open.clear();
    for (const [ref, inst] of still) open.set(ref, inst);
  });
  instances.sort((a, b) => a.z - b.z || a.first - b.first);

  // ---- markup ----
  const svgItems: string[] = [];
  const chalkSvg: string[] = [];
  const html: string[] = [];
  const lines: string[] = [];
  const hosts: Variant[] = [];
  for (const inst of instances) {
    const parts = inst.variants.map((v, m) => {
      const it = v.p.item;
      let text = read(it);
      if (it.kind === 'cast' && v.p.colourway) text = recolour(text, recolourMap(it, v.p.colourway, cat.palette));
      const { inner } = innerSvg(text, v.id);
      const [vx, vy, vw, vh] = it.viewBox;
      const body = v.p.flip ? `<g transform="translate(${f(2 * vx + vw)} 0) scale(-1 1)">${inner}</g>` : inner;
      if (it.kind === 'host') hosts.push(v);
      const hidden = m === 0 ? '' : ' style="opacity: 0"';
      return `<svg id="${v.id}" data-item="${it.id}" x="${f(v.p.box.x)}" y="${f(v.p.box.y)}" width="${f(v.p.box.w)}" height="${f(v.p.box.h)}" viewBox="${vx} ${vy} ${vw} ${vh}" overflow="visible"${hidden}>${body}</svg>`;
    });
    svgItems.push(`<g id="${inst.id}" class="fa-item">${parts.join('')}</g>`);
  }

  // ---- grounds: one group per run of shots on the same ground ----
  const grounds: { id: string; key: string; g: Ground; first: number }[] = [];
  resolved.forEach((r, k) => {
    const key = `${r.ground.id}|${r.ground.color}`;
    if (grounds.length && grounds[grounds.length - 1].key === key) return;
    grounds.push({ id: `${sid}-ground-${grounds.length}`, key, g: r.ground, first: k });
  });
  const groundSvg = grounds.map((g, i) => `<g id="${g.id}"${i ? ' style="opacity: 0"' : ''}>${ground(g.g.id, cat.palette.tokens[g.g.color], `${sid}-${i}`, FLOOR_Y)}</g>`).join('');

  // ---- the title card, up first ----
  const title = `${sid}-title`;
  lines.push(...motion.fadeIn(`#${title}`, 'startS'), motion.fadeOut(`#${title}`, at({ beat: 0, off: TITLE_S - 0.3 })));

  // ---- each shot on its beat ----
  const world = `${sid}-world`;
  let moved = false;
  // the hosts' closed-eye and open-mouth layers start hidden
  const hostLayer = (v: Variant, layer: keyof Layers) => `#${v.id}-${v.p.item.layers![layer]}`;
  if (hosts.length) lines.push(motion.hide(hosts.flatMap((v) => [hostLayer(v, 'eyesShut'), hostLayer(v, 'mouthOpen')])));
  layouts.forEach((l, k) => {
    const shot = ch.shots[k];
    const s = S(k);
    const leaving: string[] = [];
    // a new ground snaps in on the beat
    const g = grounds.findIndex((x) => x.first === k);
    if (g > 0) lines.push(...motion.snap(`#${grounds[g - 1].id}`, `#${grounds[g].id}`, at({ beat: k, off: 0 })));
    // items: new ones pop in, a pose change snaps, the ones that leave fade before the next beat
    let entering = 0;
    for (const inst of instances) {
      const v = inst.shown.get(k);
      if (!v) continue;
      if (inst.first === k) lines.push(...motion.popIn(`#${inst.id}`, at(plus(s, 0.15 + 0.12 * entering++))));
      const before = inst.shown.get(k - 1);
      if (before && before !== v) lines.push(...motion.snap(`#${before.id}`, `#${v.id}`, at({ beat: k, off: 0 })));
      if (inst.last === k && k + 1 < n) leaving.push(`#${inst.id}`);
    }
    // a raw shot: its own drawing over the whole stage
    if (typeof shot.raw === 'string') {
      const id = `${sid}-raw-${k}`;
      const { inner, viewBox } = innerSvg(shot.raw, id);
      svgItems.push(`<g id="${id}" class="fa-raw"><svg x="0" y="0" width="1920" height="1080" viewBox="${viewBox ?? '0 0 1920 1080'}">${inner}</svg></g>`);
      lines.push(...motion.popIn(`#${id}`, at(plus(s, 0.15))));
      if (k + 1 < n) leaving.push(`#${id}`);
    }
    // the shot's card, strings, chalk and labels all leave with it
    const shotLeaving: string[] = [];
    const labels: string[] = [];
    // the card, and the strings it hangs by
    if (l.card && shot.card) {
      const id = `${sid}-card-${k}`;
      html.push(cardHtml(id, shot.card, l.card.box, Math.round((R() - 0.5) * 30) / 10));
      lines.push(...motion.rise(`#${id}`, at(plus(s, 0.45))));
      shotLeaving.push(`#${id}`);
      if (l.card.strings.length) {
        const sidStr = `${sid}-str-${k}`;
        chalkSvg.push(`<g id="${sidStr}">${strings(sidStr, l.card.strings)}</g>`);
        lines.push(motion.drawOn(`#${sidStr}`, at(plus(s, 0.75))), ...motion.dots(`#${sidStr}`, at(plus(s, 1.05))));
        shotLeaving.push(`#${sidStr}`);
      }
    }
    // chalk marks, one after another
    (shot.chalk ?? []).forEach((mark, j) => {
      const id = `${sid}-chalk-${k}-${j}`;
      const when = plus(s, 0.85 + 0.3 * j);
      let marks = '';
      if ('burst' in mark) {
        const b = refBox(mark.burst, l.placed, l.card);
        marks = burst(id, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, Math.max(b.w, b.h) / 2 + 16);
      } else if ('sight' in mark) {
        const a = refPoint(mark.sight[0], l.placed, l.card);
        const b = refPoint(mark.sight[1], l.placed, l.card);
        // a line to an item's middle stops at its edge (where a burst would be), one to an anchor just short of it
        const tb = refBox(mark.sight[1], l.placed, l.card);
        const stop = splitRef(mark.sight[1]).anchor ? 30 : Math.max(tb.w, tb.h) / 2 + 40;
        marks = sight(id, towards(a, b, 24), towards(b, a, stop));
      } else if ('label' in mark) {
        const b = refBox(mark.to, l.placed, l.card);
        const w = mark.label.length * 22;
        const h = 56;
        // beside the thing, level with its middle and clear of a burst round it: on the right when it fits
        const gap = Math.max(b.w, b.h) / 2 - b.w / 2 + 130;
        const right = b.x + b.w + gap + w <= STAGE_W - SAFE;
        const lx = clamp(right ? b.x + b.w + gap : b.x - gap - w, SAFE, STAGE_W - SAFE - w);
        let ly = clamp(b.y + b.h / 2 - h / 2, SAFE, STAGE_H - SAFE - h);
        // a label never sits on the card: it goes below the thing instead
        if (l.card && overlap({ x: lx, y: ly, w, h }, l.card.box)) ly = Math.min(STAGE_H - SAFE - h, b.y + b.h + 30);
        const labelId = `${sid}-label-${k}-${j}`;
        html.push(`<div id="${labelId}" class="fa-label" style="left: ${f(lx)}px; top: ${f(ly)}px;">${esc(mark.label)}</div>`);
        const from = { x: right ? lx - 14 : lx + w + 14, y: ly + h / 2 + 4 };
        const to = { x: right ? b.x + b.w : b.x, y: b.y + b.h / 2 };
        marks = leader(id, from, towards(to, from, 20));
        lines.push(...motion.fadeIn(`#${labelId}`, at(when)));
        labels.push(`#${labelId}`);
      } else if ('underline' in mark) {
        const b = refBox(mark.underline, l.placed, l.card);
        marks = underline(b.x, b.y + b.h + 16, b.w);
      } else {
        const b = refBox(mark.circle, l.placed, l.card);
        marks = circle(id, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, b.w / 2 + 30, b.h / 2 + 30);
      }
      chalkSvg.push(`<g id="${id}">${marks}</g>`);
      lines.push(motion.drawOn(`#${id}`, at(when)));
      shotLeaving.push(`#${id}`);
    });
    // the camera: back to the whole frame if the shot before moved it, then this shot's move across the sentence
    const cam = shot.camera;
    let camAt = plus(s, 0.2);
    if (moved) {
      lines.push(motion.cameraReset(`#${world}`, at(s)));
      camAt = plus(s, 0.45);
      moved = false;
    }
    if (cam && cam.move !== 'hold') {
      const target = cam.to ? refPoint(cam.to, l.placed, l.card) : l.focus ? refPoint(l.focus, l.placed, l.card) : { x: 960, y: 540 };
      const zoom = cam.crop === 'close' ? 1.35 : cam.crop === 'mid' ? 1.15 : cam.crop === 'wide' ? 1.04 : 1.08;
      const end = E(k);
      const dur = `Math.max(0.6, ${at(end)} - (${at(camAt)}) - 0.35)`;
      if (cam.move === 'pan') lines.push(motion.cameraSet(`#${world}`, { x: 1920 - target.x, y: target.y }, zoom, at(camAt)));
      lines.push(motion.camera(`#${world}`, target, zoom, at(camAt), dur));
      moved = true;
    }
    // hosts: one blink a sentence, and the mouth flaps on their line
    const shown = hosts.filter((v) => instances.some((inst) => inst.shown.get(k) === v));
    if (shown.length) {
      const blinkAt = plus(s, 1 + Math.round(R() * 12) / 10);
      lines.push(...motion.blink(shown.map((v) => hostLayer(v, 'eyes')), shown.map((v) => hostLayer(v, 'eyesShut')), at(blinkAt), at(plus(blinkAt, 0.12))));
    }
    for (const v of shown.filter((x) => l.placed.some((p) => p.ref === x.p.ref && p.talk))) {
      lines.push(...motion.flap(hostLayer(v, 'mouth'), hostLayer(v, 'mouthOpen'), at(plus(s, 0.1)), at(E(k))));
    }
    // everything that leaves goes just before the next sentence
    if (k + 1 < n) {
      const out = plus(E(k), -0.3);
      for (const sel of leaving) lines.push(motion.fadeOut(sel, at(out)));
      if (shotLeaving.length || labels.length) lines.push(motion.fadeOut([...shotLeaving, ...labels], at(out)));
    }
  });

  const markup = [
    `<div id="${sid}" class="fa-scene">`,
    `<svg class="fa-ground" width="1920" height="1080" viewBox="0 0 1920 1080">${groundSvg}</svg>`,
    // the camera moves this layer past the frame on purpose
    `<div id="${world}" class="fa-layer" data-layout-allow-overflow>`,
    `<svg class="fa-svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs>${chalkFilter(`${sid}-wobble`)}</defs>${svgItems.join('')}<g filter="url(#${sid}-wobble)">${chalkSvg.join('')}</g></svg>`,
    ...html,
    '</div>',
    `<div id="${title}" class="fa-title-wrap"><div class="fa-title">${esc(ch.title)}</div></div>`,
    '</div>',
  ].join('\n');
  // the camera's world layer starts at the whole frame (every item hides itself until it pops in)
  const start = [`tl.set("#${world}", {x: 0, y: 0, scale: 1, transformOrigin: "0 0"}, startS);`];
  const scene = `<style>\n${sceneCss(sid, cat)}\n</style>\n${markup}\n<script data-oldguy-timeline>\n${[...start, ...lines].join('\n')}\n</script>\n`;
  const bytes = Buffer.byteLength(scene, 'utf8');
  if (bytes > MAX_SCENE_BYTES) throw new Error(`chapter ${ch.id}: the scene is ${Math.ceil(bytes / 1024)} KB; a design scene holds at most ${MAX_SCENE_BYTES / 1024} KB (use fewer different drawings, or smaller ones)`);
  return scene;
}

// The warnings for a chapter that still compiles: too many raw shots (rule 10).
function shotWarnings(ch: ChapterShots): string[] {
  const raw = Array.isArray(ch.shots) ? ch.shots.filter((s) => isObject(s) && s.raw !== undefined).length : 0;
  return raw > MAX_RAW ? [`${raw} raw shots; more than ${MAX_RAW} means the library is missing something${rule('10')}`] : [];
}

export { RULES, PLACES, GROUND_IDS, shotErrors, shotWarnings, resolveShots, splitRef, layout, layoutChapter, anchorPoint, compileChapter, handFontCss };
export type { Place, Ground, CastEntry, PropEntry, Card, Chalk, Camera, Shot, ChapterShots, SourceRange, ShotContext, Thing, ResolvedShot, Box, Pt, Placed, CardBox, ShotLayout };
