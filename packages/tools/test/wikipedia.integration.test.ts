import { describe, expect, it } from 'vitest';
import { WikipediaBackend } from '../src/index.ts';

/** Real request to it.wikipedia.org. Skipped unless MONSTERS_TEST_NETWORK=1. */
describe.skipIf(process.env.MONSTERS_TEST_NETWORK !== '1')('Wikipedia (network)', () => {
  it('finds the moons of Saturn', async () => {
    const results = await new WikipediaBackend().search('lune di Saturno', {
      limit: 3,
      signal: AbortSignal.timeout(20_000),
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.url).toMatch(/^https:\/\/(it|en)\.wikipedia\.org\/wiki\//);
    expect(results[0]!.snippet).not.toMatch(/<span/);
  }, 30_000);
});
