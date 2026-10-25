import { MCP_CATEGORY_LABEL, type McpCatalogEntry } from '@monsters/shared';

/*
 * The search box of the apps gallery (wave C, U2-7): the first six cards are what most people want;
 * the rest is one word away. It looks in the name, the id, the sentence and the category, in the
 * language in use, without caring for case or accents.
 */

const fold = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** True when every word typed is somewhere in the app's name, id, sentence or category. */
export function matchesApp(entry: McpCatalogEntry, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fold(
    `${entry.name} ${entry.id} ${entry.description} ${MCP_CATEGORY_LABEL[entry.category]}`,
  );
  return words.every((word) => text.includes(word));
}
