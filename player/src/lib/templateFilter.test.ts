import { describe, expect, it } from 'vitest';
import type { TemplateCard } from '@/types';
import { allTags, emptyFilters, facetCounts, hasFilters, matches, tagLabel, voiceKind, voiceLabel } from './templateFilter';

const card = (over: Partial<TemplateCard>): TemplateCard => ({
  id: 'x', title: 'X', description: 'd', shapes: ['16:9'], tags: [], voices: [{ id: 'narrator', voice: 'af_heart' }],
  captions: 'none', chapter_seconds: [20, 40], sample: false, poster: false, ...over,
});
const explainer = card({ id: 'explainer', title: 'Explainer', shapes: ['16:9', '9:16', '1:1'], tags: ['narrator', 'calm'] });
const duo = card({ id: 'duo', title: 'Two voices', description: 'one asks', shapes: ['16:9', '9:16'], tags: ['reel', 'calm'],
  voices: [{ id: 'kid', voice: 'bm_george' }, { id: 'dad', voice: 'am_adam' }], captions: 'word' });
const tutor = card({ id: 'tutor', title: 'Tutor', tags: ['diagrams'], voices: [{ id: 'professor', voice: 'bm_george' }], captions: 'line' });
const ALL = [explainer, duo, tutor];

describe('template filters', () => {
  it('reads who speaks from the voices', () => {
    expect([explainer, duo, tutor].map(voiceKind)).toEqual(['narrator', 'many', 'one']);
  });

  it('searches name, description, styles and voices, every word', () => {
    const f = { ...emptyFilters(), query: 'two reel' };
    expect(ALL.filter((t) => matches(t, f)).map((t) => t.id)).toEqual(['duo']);
    expect(ALL.filter((t) => matches(t, { ...emptyFilters(), query: 'professor' })).map((t) => t.id)).toEqual(['tutor']);
  });

  it('combines shape, voices, captions and every chosen style', () => {
    const tall = { ...emptyFilters(), shape: '9:16' as const };
    expect(ALL.filter((t) => matches(t, tall)).map((t) => t.id)).toEqual(['explainer', 'duo']);
    const calmNarrator = { ...emptyFilters(), voices: new Set(['narrator' as const]), tags: new Set(['calm']) };
    expect(ALL.filter((t) => matches(t, calmNarrator)).map((t) => t.id)).toEqual(['explainer']);
    expect(ALL.filter((t) => matches(t, { ...emptyFilters(), captions: new Set(['word' as const, 'line' as const]) })).map((t) => t.id)).toEqual(['duo', 'tutor']);
  });

  it('counts each option against the other filters, not its own group', () => {
    const f = { ...emptyFilters(), voices: new Set(['many' as const]) };
    const c = facetCounts(ALL, f);
    expect(c.voices.get('narrator')).toBe(1);
    expect(c.voices.get('many')).toBe(1);
    expect(c.shape.get('1:1')).toBeUndefined();
    expect(c.shapeAll).toBe(1);
    expect(c.tags.get('calm')).toBe(1);
  });

  it('lists tags most used first, and says whether any filter is set', () => {
    expect(allTags(ALL)).toEqual(['calm', 'diagrams', 'narrator', 'reel']);
    expect(hasFilters(emptyFilters())).toBe(false);
    expect(hasFilters({ ...emptyFilters(), query: ' a ' })).toBe(true);
  });

  it('names tags and voices for people', () => {
    expect(tagLabel('two-voices')).toBe('Two voices');
    expect(voiceLabel('bm_george')).toBe('British male');
    expect(voiceLabel('af_heart')).toBe('American female');
    expect(voiceLabel('qq_x')).toBe('qq_x');
  });
});
