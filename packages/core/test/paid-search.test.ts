import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyWithoutCredit, PaidSearch, searchRegion } from '../src/team/paid-search.ts';
import { tempHome } from './helpers.ts';

/* When the paid web search is in use (D-071), and why not. */

function make(
  over: {
    mode?: 'auto' | 'on' | 'off';
    freeOnly?: boolean;
    key?: string | null;
    info?: { isFreeTier?: boolean; limit?: number | null; usage?: number } | null;
    cap?: string | null;
  } = {},
) {
  const home = tempHome();
  mkdirSync(home, { recursive: true });
  const settings = {
    paidSearch: { mode: over.mode ?? 'auto', engine: 'parallel' as const },
    openrouter: { freeOnly: over.freeOnly ?? true },
  };
  let reads = 0;
  const paid = new PaidSearch({
    home,
    settings,
    readKey: () => {
      reads++;
      return over.key === undefined ? 'sk-or-k' : over.key;
    },
    keyInfo: () => over.info ?? null,
    spendCap: () => over.cap ?? null,
  });
  return { paid, home, settings, reads: () => reads };
}

describe('paid web search (D-071)', () => {
  it('auto follows the paid models: off with free models only, on with paid ones', () => {
    expect(make().paid.status()).toMatchObject({ active: false, reason: 'free_only' });
    expect(make({ freeOnly: false }).paid.status()).toMatchObject({ active: true });
    expect(make({ freeOnly: false }).paid.backend()?.id).toBe('openrouter-parallel');
    expect(make().paid.backend()).toBeNull();
  });

  it('on and off are the user choice, on also with free models', () => {
    expect(make({ mode: 'on' }).paid.status().active).toBe(true);
    expect(make({ mode: 'off', freeOnly: false }).paid.status()).toMatchObject({ reason: 'off' });
  });

  it('needs a key with credit, and stops at the spending cap', () => {
    expect(make({ mode: 'on', key: null }).paid.status().reason).toBe('no_key');
    expect(make({ mode: 'on', info: { isFreeTier: true } }).paid.status().reason).toBe('no_credit');
    expect(make({ mode: 'on', info: { limit: 5, usage: 5 } }).paid.status().reason).toBe(
      'no_credit',
    );
    expect(keyWithoutCredit({ isFreeTier: false, limit: null, usage: 3 })).toBe(false);
    expect(keyWithoutCredit({ limit: 0, usage: 0 })).toBe(true);
    const capped = make({ mode: 'on', cap: 'raggiunto il tetto di spesa della squadra' });
    expect(capped.paid.status().reason).toBe('spend_cap');
    expect(capped.paid.backend('rhea')).toBeNull();
  });

  it('saves the choice in settings.json, applies it at once, and reads the key rarely', () => {
    const m = make();
    expect(m.paid.set({ mode: 'on', engine: 'exa' })).toMatchObject({
      mode: 'on',
      engine: 'exa',
      active: true,
      usdPer1000: { parallel: 1.09, exa: 7.09 },
    });
    expect(JSON.parse(readFileSync(join(m.home, 'settings.json'), 'utf8'))).toMatchObject({
      paidSearch: { mode: 'on', engine: 'exa' },
    });
    expect(m.settings.paidSearch.engine).toBe('exa');
    m.paid.status();
    m.paid.status();
    expect(m.reads()).toBe(1);
    m.paid.refresh();
    m.paid.status();
    expect(m.reads()).toBe(2);
  });
});

describe('paid search paused (review 18/10, item 30)', () => {
  const makeWith = (status: number) =>
    new PaidSearch({
      home: tempHome(),
      settings: { paidSearch: { mode: 'on', engine: 'parallel' }, openrouter: { freeOnly: false } },
      readKey: () => 'sk-or-k',
      keyInfo: () => null,
      fetch: () => Promise.resolve(new Response('{}', { status })),
      persist: false,
    });
  const search = (p: PaidSearch) =>
    p.backend()!.search('rea', { limit: 3, signal: new AbortController().signal });

  it('a refused key is key_rejected, not no_credit', async () => {
    const paid = makeWith(401);
    await expect(search(paid)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(paid.status()).toMatchObject({ active: false, reason: 'key_rejected' });
  });

  it('no credit stays no_credit; a rejected request is paused', async () => {
    const credit = makeWith(402);
    await expect(search(credit)).rejects.toBeDefined();
    expect(credit.status().reason).toBe('no_credit');
    const bad = makeWith(404);
    await expect(search(bad)).rejects.toBeDefined();
    expect(bad.status().reason).toBe('paused');
  });

  it('the search region follows the profile language', () => {
    expect(searchRegion('it')).toBe('it-it');
    expect(searchRegion('en')).toBe('us-en');
    expect(searchRegion('xx')).toBeUndefined();
    expect(searchRegion(undefined)).toBeUndefined();
  });
});
