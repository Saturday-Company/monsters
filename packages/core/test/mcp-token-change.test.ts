import type { McpServersResponse, McpTestResponse } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { startFakeHttpServer } from './fixtures/fake-mcp-server.ts';
import { startTestHub } from './hub-helpers.ts';

/*
 * "Cambia il token" (D-072): a PUT with only the new value of the secret (the
 * other headers sent empty, "keep") replaces it without touching address,
 * who uses it, tools or gallery entry, and the next connection uses it.
 */

describe('changing the token of a connection', () => {
  it('replaces only the secret, keeps the rest, connects again with the new one', async () => {
    const good = 'ghp-NUOVO-7d1e5b20aa';
    const server = await startFakeHttpServer(good);
    try {
      const t = await startTestHub({});
      await t.json('PUT', '/api/mcp-servers/github', {
        transport: 'http',
        url: server.url,
        label: 'GitHub',
        catalog: 'github',
        headers: { Authorization: `Bearer ${good}`, 'X-Extra': 'resta-uguale-1234' },
        agents: ['titan', 'rhea'],
        tools: ['echo'],
      });
      expect((await t.json<McpTestResponse>('POST', '/api/mcp-servers/github/test')).ok).toBe(true);

      // A token that the service refuses: the change takes effect at once (no stale connection).
      const old = 'ghp-VECCHIO-0000aaaa';
      const changed = await t.json<McpServersResponse>('PUT', '/api/mcp-servers/github', {
        headers: { Authorization: `Bearer ${old}`, 'X-Extra': '' },
      });
      const view = changed.servers.find((s) => s.name === 'github')!;
      expect(view).toMatchObject({
        label: 'GitHub',
        catalog: 'github',
        url: server.url,
        agents: ['titan', 'rhea'],
        tools: ['echo'],
        headerKeys: ['Authorization', 'X-Extra'],
        enabled: true,
      });
      const refused = await t.json<McpTestResponse>('POST', '/api/mcp-servers/github/test');
      expect(refused.ok).toBe(false);

      await t.json('PUT', '/api/mcp-servers/github', {
        headers: { Authorization: `Bearer ${good}`, 'X-Extra': '' },
      });
      const ok = await t.json<McpTestResponse>('POST', '/api/mcp-servers/github/test');
      expect(ok.ok).toBe(true);
      // Never in the API or in the log.
      const api = JSON.stringify(await t.json('GET', '/api/mcp-servers'));
      for (const secret of [good, old, 'resta-uguale-1234']) {
        expect(api).not.toContain(secret);
        expect(JSON.stringify(t.events())).not.toContain(secret);
      }
    } finally {
      await server.close();
    }
  });
});
