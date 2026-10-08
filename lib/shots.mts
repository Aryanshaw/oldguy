// The shot compiler for flat illustrated chapters. Claude writes shots/<id>.json, one shot per sentence, naming
// drawings from the art library (lib/catalog.mts) and where they go; this module checks it against the library and the
// numbered rules, lays every shot out on the 1920x1080 stage, and compiles the chapter into a design scene
// (scenes/<id>.html) that the existing design piece plays with beat(n). Claude never draws: placement, depth, motion
// and the chalk marks are all decided here.
import { findItem, closest, colourway } from './catalog.mts';
import type { Catalog, Item } from './catalog.mts';

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
  return [...new Set(errs)];
}

// The warnings for a chapter that still compiles: too many raw shots (rule 10).
function shotWarnings(ch: ChapterShots): string[] {
  const raw = Array.isArray(ch.shots) ? ch.shots.filter((s) => isObject(s) && s.raw !== undefined).length : 0;
  return raw > MAX_RAW ? [`${raw} raw shots; more than ${MAX_RAW} means the library is missing something${rule('10')}`] : [];
}

export { RULES, PLACES, GROUND_IDS, shotErrors, shotWarnings, resolveShots, splitRef };
export type { Place, Ground, CastEntry, PropEntry, Card, Chalk, Camera, Shot, ChapterShots, SourceRange, ShotContext, Thing, ResolvedShot };
