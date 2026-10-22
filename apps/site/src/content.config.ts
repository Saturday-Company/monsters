/*
 * The two Markdown sources of the site, both read from the repository when the site is built:
 * the user guides of `docs/` and the changelogs. The loaders render the Markdown with Astro's own
 * pipeline (syntax highlighting, heading ids), so the site needs no Markdown dependency.
 */
import { defineCollection } from 'astro:content';
import type { Loader } from 'astro/loaders';
import { z } from 'astro/zod';
import { GUIDES, changelogFile, guideMarkdown, parseChangelog, readRepoFile } from './lib/docs.ts';

/** Every table goes inside a box that scrolls sideways (and takes focus), so it never widens the page. */
const wrapTables = (html: string): string =>
  html
    .replace(
      /<table\b/g,
      '<div class="table-scroll" tabindex="0" role="region" aria-label="Table"><table',
    )
    .replace(/<\/table>/g, '</table></div>');

const guides = defineCollection({
  loader: {
    name: 'repo-guides',
    load: async (ctx) => {
      const { store } = ctx;
      store.clear();
      for (const guide of GUIDES) {
        const { title, body } = guideMarkdown(guide);
        const rendered = await ctx.renderMarkdown(body);
        rendered.html = wrapTables(rendered.html);
        store.set({
          id: guide.slug,
          data: { file: guide.file, title, short: guide.title },
          body,
          rendered,
          digest: ctx.generateDigest(body),
        });
      }
    },
  } satisfies Loader,
  schema: z.object({ file: z.string(), title: z.string(), short: z.string() }),
});

const releases = defineCollection({
  loader: {
    name: 'repo-changelog',
    load: async (ctx) => {
      const { store } = ctx;
      store.clear();
      for (const lang of ['en', 'it'] as const) {
        const notes = parseChangelog(readRepoFile(changelogFile(lang)));
        for (const [order, note] of notes.entries()) {
          // Every release has the same headings ("What you'll see"): their ids get the version in
          // front, so the page has no duplicate id.
          const rendered = await ctx.renderMarkdown(note.body);
          rendered.html = wrapTables(rendered.html).replace(
            /<h([2-6]) id="([^"]+)"/g,
            (_m, level: string, id: string) => `<h${level} id="v${note.version}-${id}"`,
          );
          store.set({
            id: `${lang}/${note.version}`,
            data: {
              lang,
              version: note.version,
              dateText: note.dateText,
              date: note.date,
              order,
            },
            body: note.body,
            rendered,
            digest: ctx.generateDigest(note.body),
          });
        }
      }
    },
  } satisfies Loader,
  schema: z.object({
    lang: z.enum(['en', 'it']),
    version: z.string(),
    dateText: z.string(),
    date: z.string(),
    order: z.number(),
  }),
});

export const collections = { guides, releases };
