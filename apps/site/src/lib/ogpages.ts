/*
 * The social card of each guide and comparison: its own title on the home's card. One list for
 * the images (`/og/<slug>.png`) and for the pages that point at them.
 */
import { COMPARE, COMPETITORS } from '../i18n/compare.ts';
import { GUIDES } from './docs.ts';

export interface OgPage {
  slug: string;
  kicker: string;
  title: string;
}

/** The cards, with the title as it is drawn: letters, digits and `. , : ? -` only. */
export function ogPages(): OgPage[] {
  return [
    { slug: 'docs-getting-started', kicker: 'Docs', title: 'Getting started' },
    ...GUIDES.map((g) => ({ slug: `docs-${g.slug}`, kicker: 'Docs', title: g.title })),
    ...COMPETITORS.map((c) => ({
      slug: `compare-${c}`,
      kicker: 'Compare',
      title: COMPARE.en.pages[c].title,
    })),
    { slug: 'compare-frameworks', kicker: 'Compare', title: 'Monsters vs frameworks' },
  ];
}

export const ogImagePath = (slug: string): string => `/og/${slug}.png`;
