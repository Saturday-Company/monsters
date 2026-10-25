import { MCP_CATALOG, setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { matchesApp } from '../src/components/settings/mcp-search.ts';

/* The search box of the apps gallery (wave C, U2-7). */

const entry = (id: string) => MCP_CATALOG.find((e) => e.id === id)!;
const found = (query: string) => MCP_CATALOG.filter((e) => matchesApp(e, query)).map((e) => e.id);

describe('apps search', () => {
  afterEach(() => setAppLang('en'));

  it('an empty search matches everything', () => {
    expect(found('')).toHaveLength(MCP_CATALOG.length);
    expect(found('   ')).toHaveLength(MCP_CATALOG.length);
  });

  it('looks in the name and the id, without caring for case', () => {
    expect(found('GITHUB')).toEqual(['github']);
    expect(found('witdesk')).toEqual(['witdesk']);
    expect(found('anteiku')).toEqual(['anteiku']);
  });

  it('finds the apps that cannot be connected yet too', () => {
    expect(entry('slack').soon).toBeTruthy();
    expect(found('slack')).toEqual(['slack']);
  });

  it('every word must be there: the sentence and the category count', () => {
    expect(matchesApp(entry('github'), 'issues github')).toBe(true);
    expect(matchesApp(entry('github'), 'issues stripe')).toBe(false);
    expect(found('payments')).toContain('stripe');
    expect(found('zzzz')).toEqual([]);
  });

  it('follows the language and ignores accents', () => {
    setAppLang('it');
    expect(found('pagamenti')).toContain('stripe');
    expect(found('PAGAMENTÌ')).toContain('stripe');
  });
});
