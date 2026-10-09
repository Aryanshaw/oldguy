import type { Shape, TemplateCard } from '@/types';

/** Who speaks in a template: a narrator only, one on-screen character, or two or more. */
export type VoiceKind = 'narrator' | 'one' | 'many';
export type CaptionKind = TemplateCard['captions'];

/** What the gallery filters on. Empty sets mean "any". */
export interface Filters {
  query: string;
  shape: Shape | 'all';
  voices: Set<VoiceKind>;
  captions: Set<CaptionKind>;
  tags: Set<string>;
}

export const emptyFilters = (): Filters => ({ query: '', shape: 'all', voices: new Set(), captions: new Set(), tags: new Set() });

export const VOICE_LABEL: Record<VoiceKind, string> = { narrator: 'Narrator', one: 'One character', many: 'Two voices' };
export const CAPTION_LABEL: Record<CaptionKind, string> = { none: 'None', line: 'One line', word: 'Word by word' };
export const SHAPE_LABEL: Record<Shape, string> = { '16:9': 'Wide', '9:16': 'Tall', '1:1': 'Square' };

/** A template with no speakers has one voice called narrator; otherwise its speakers are its voices. */
export function voiceKind(t: TemplateCard): VoiceKind {
  if (t.voices.length === 1 && t.voices[0].id === 'narrator') return 'narrator';
  return t.voices.length === 1 ? 'one' : 'many';
}

/** A tag slug as people read it: "two-voices" becomes "Two voices". */
export function tagLabel(tag: string): string {
  const words = tag.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a Kokoro voice id sounds like, from its prefix: "bm_george" is British male. */
export function voiceLabel(voice: string): string {
  const accent: Record<string, string> = { a: 'American', b: 'British', e: 'Spanish', f: 'French', j: 'Japanese', z: 'Chinese' };
  const gender: Record<string, string> = { f: 'female', m: 'male' };
  return [accent[voice[0]], gender[voice[1]]].filter(Boolean).join(' ') || voice;
}

/** True when the template's name, description, tags or voices contain every word of the query. */
function matchesQuery(t: TemplateCard, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [t.title, t.description, ...t.tags.map(tagLabel), ...t.voices.map((v) => v.id), VOICE_LABEL[voiceKind(t)]]
    .join(' ')
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** True when a template passes every filter, optionally ignoring one group (so that group can show its own counts). */
export function matches(t: TemplateCard, f: Filters, ignore?: 'shape' | 'voices' | 'captions' | 'tags'): boolean {
  if (!matchesQuery(t, f.query)) return false;
  if (ignore !== 'shape' && f.shape !== 'all' && !t.shapes.includes(f.shape)) return false;
  if (ignore !== 'voices' && f.voices.size && !f.voices.has(voiceKind(t))) return false;
  if (ignore !== 'captions' && f.captions.size && !f.captions.has(t.captions)) return false;
  if (ignore !== 'tags' && f.tags.size && ![...f.tags].every((tag) => t.tags.includes(tag))) return false;
  return true;
}

/** How many templates each option would show, given the other filters (the usual faceted-search count). */
export function facetCounts(all: TemplateCard[], f: Filters) {
  const count = <K extends string>(group: 'shape' | 'voices' | 'captions' | 'tags', keyOf: (t: TemplateCard) => K[]) => {
    const out = new Map<K, number>();
    for (const t of all) if (matches(t, f, group)) for (const k of keyOf(t)) out.set(k, (out.get(k) ?? 0) + 1);
    return out;
  };
  return {
    shapeAll: all.filter((t) => matches(t, f, 'shape')).length,
    shape: count<Shape>('shape', (t) => t.shapes),
    voices: count<VoiceKind>('voices', (t) => [voiceKind(t)]),
    captions: count<CaptionKind>('captions', (t) => [t.captions]),
    tags: count<string>('tags', (t) => t.tags),
  };
}

/** Every tag in the catalogue, most used first, then by name. */
export function allTags(all: TemplateCard[]): string[] {
  const n = new Map<string, number>();
  for (const t of all) for (const tag of t.tags) n.set(tag, (n.get(tag) ?? 0) + 1);
  return [...n.keys()].sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || a.localeCompare(b));
}

/** True when any filter is set. */
export const hasFilters = (f: Filters): boolean =>
  f.query.trim() !== '' || f.shape !== 'all' || f.voices.size > 0 || f.captions.size > 0 || f.tags.size > 0;
