import type { Embedder } from '@monsters/vault';
import { describe, expect, it } from 'vitest';
import { externalActorId } from '../src/server/routes/vault-tools.ts';
import { startTestHub } from './hub-helpers.ts';

/*
 * Vault composition in the hub (semantic search) and the vault tools route used
 * by the MCP server (`monsters mcp`, tested end to end in packages/cli).
 */

/** Two-dimensional fake: "cucina" words on one axis, everything else on the other. */
const fakeEmbedder = (): Embedder => ({
  model: 'fake/2d',
  dim: 2,
  embed: (texts) =>
    Promise.resolve(
      texts.map((t) => {
        const food = /pasta|carbonara|cena|mangi|piatt/i.test(t) ? 1 : 0;
        const v = new Float32Array([food, 1 - food + 0.1]);
        const n = Math.hypot(v[0] ?? 0, v[1] ?? 0);
        return v.map((x) => x / n);
      }),
    ),
  close: () => Promise.resolve(),
});

describe('semantic search in the hub', () => {
  it('is off in tests unless an embedder is given (no model download)', async () => {
    const { core } = await startTestHub({});
    expect(core.hub.vault.semanticStatus().state).toBe('off');
  });

  it('uses the given embedder for hybrid search', async () => {
    const { core } = await startTestHub(
      {},
      { hub: { embedder: () => Promise.resolve(fakeEmbedder()) } },
    );
    const vault = core.hub.vault;
    await vault.write(
      { agentId: 'user' },
      { path: 'Risorse/Carbonara.md', content: '# Carbonara\n\nPasta.\n' },
    );
    await vault.semanticIdle();
    expect(vault.semanticStatus()).toMatchObject({ state: 'ready', model: 'fake/2d' });
    const hits = await vault.search({ agentId: 'user' }, { query: 'cosa mangio a cena', limit: 1 });
    expect(hits[0]?.path).toBe('Risorse/Carbonara.md');
  });

  it('logs a model that cannot be loaded once, and keeps searching full-text', async () => {
    const { core, events } = await startTestHub(
      {},
      {
        hub: { embedder: () => Promise.reject(new Error('getaddrinfo ENOTFOUND huggingface.co')) },
      },
    );
    await core.hub.vault.semanticIdle();
    const errors = events().filter(
      (e) => e.type === 'error' && e.data.code === 'semantic_unavailable',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data).toMatchObject({ message: 'getaddrinfo ENOTFOUND huggingface.co' });
    const hits = await core.hub.vault.search({ agentId: 'user' }, { query: 'leggimi' });
    expect(hits.map((h) => h.path)).toEqual(['LEGGIMI.md']);
  });

  it('without transformers.js (packaged app) logs one line and never shows the import error', async () => {
    const missing = Object.assign(
      new Error(
        "Cannot find package '@huggingface/transformers' imported from /opt/monsters-core/embed-worker.js",
      ),
      { code: 'ERR_MODULE_NOT_FOUND' },
    );
    const { core, events, json } = await startTestHub(
      {},
      { hub: { embedder: () => Promise.reject(missing) } },
    );
    await core.hub.vault.semanticIdle();
    const search = await json<{ ok: boolean; output: { path: string }[] }>(
      'POST',
      '/api/vault/tools/vault_search',
      { input: { query: 'leggimi', mode: 'semantic' }, client: 'Cursor' },
    );
    expect(search).toMatchObject({ ok: true, output: [{ path: 'LEGGIMI.md' }] });
    const overview = await json<{ semantic: string; semanticReason?: string }>(
      'GET',
      '/api/vault/notes',
    );
    expect(overview.semantic).toBe('unavailable');
    expect(overview.semanticReason).toMatch(/non è disponibile in questa installazione/);

    const off = events().filter((e) => e.type === 'error' && e.agent === 'system');
    expect(off.map((e) => e.data)).toEqual([
      {
        code: 'semantic_off',
        message: 'semantic search off: @huggingface/transformers is not installed',
      },
    ]);
    // Neither the log (tool results included) nor the API carry the raw error.
    expect(JSON.stringify(events())).not.toMatch(/Cannot find|imported from/);
    expect(JSON.stringify([search, overview])).not.toMatch(/Cannot find|imported from/);
  });
});

describe('vault tools for external clients', () => {
  it('names the actor after the client', () => {
    expect(externalActorId('Claude Desktop')).toBe('mcp-claude-desktop');
    expect(externalActorId('claude-ai')).toBe('mcp-claude-ai');
    expect(externalActorId('Çursor IDE!!')).toBe('mcp-cursor-ide');
    expect(externalActorId(undefined)).toBe('mcp-client');
    expect(externalActorId('!!!')).toBe('mcp-client');
    expect(externalActorId('x'.repeat(100))).toHaveLength(44);
  });

  it('runs a tool as mcp-<client>, logs it and refuses while halted', async () => {
    const { json, api, events } = await startTestHub({});
    const ok = await json<{ ok: boolean; output: { path: string; commit: string } }>(
      'POST',
      '/api/vault/tools/vault_write',
      { input: { path: 'Inbox/Esterna', content: '# Esterna\n\nDa fuori.\n' }, client: 'Cursor' },
    );
    expect(ok).toMatchObject({ ok: true, output: { path: 'Inbox/Esterna.md' } });
    const mine = events().filter((e) => e.agent === 'mcp-cursor');
    expect(mine.map((e) => e.type)).toEqual(['tool_call', 'vault_change', 'tool_result']);
    expect(mine[1]?.parentId).toBe(mine[0]?.id);
    expect(mine[1]?.data).toMatchObject({ commit: ok.output.commit });

    const denied = await json<{ ok: boolean; error: { code: string } }>(
      'POST',
      '/api/vault/tools/vault_delete',
      { input: { path: 'LEGGIMI', reason: 'prova' }, client: 'Cursor' },
    );
    expect(denied).toMatchObject({ ok: false, error: { code: 'SETTING_OFF' } });
    const invalid = await json<{ ok: boolean; error: { code: string } }>(
      'POST',
      '/api/vault/tools/vault_read',
      { input: {} },
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

    expect((await api('POST', '/api/vault/tools/vault_apply_proposal', { input: {} })).status).toBe(
      404,
    );
    expect((await api('POST', '/api/vault/tools/nope', { input: {} })).status).toBe(404);

    // A long input is truncated in the log, like the output of every tool.
    const long = 'parola '.repeat(3000);
    await json('POST', '/api/vault/tools/vault_write', {
      input: { path: 'Inbox/Lunga', content: `# Lunga\n\n${long}\n` },
      client: 'Cursor',
    });
    const logged = events().filter(
      (e) => e.agent === 'mcp-cursor' && e.type === 'tool_call' && e.data.tool === 'vault_write',
    );
    const input = (logged.at(-1)?.data as { input?: unknown } | undefined)?.input;
    expect(JSON.stringify(input).length).toBeLessThan(4500);
    expect(input).toMatchObject({ truncated: true });

    // Note contents are flagged as external data for the MCP envelope (D-021).
    const read = await json<{ ok: boolean; source?: string }>(
      'POST',
      '/api/vault/tools/vault_read',
      {
        input: { path: 'Inbox/Esterna' },
      },
    );
    expect(read.source).toBe('vault Inbox/Esterna.md');
    const search = await json<{ source?: string }>('POST', '/api/vault/tools/vault_search', {
      input: { query: 'esterna' },
    });
    expect(search.source).toBe('vault_search esterna');
    expect(ok).not.toHaveProperty('source');

    await json('POST', '/api/kill', { reason: 'test' });
    const halted = await api('POST', '/api/vault/tools/vault_search', { input: { query: 'x' } });
    expect(halted.status).toBe(409);
    expect(await halted.json()).toMatchObject({ error: 'halted' });
  });

  it('logs refused calls too, with the error code', async () => {
    const { json, api, events } = await startTestHub({});
    expect(
      (await api('POST', '/api/vault/tools/nope', { input: { a: 1 }, client: 'Cursor' })).status,
    ).toBe(404);
    await json('POST', '/api/kill', { reason: 'test' });
    const halted = await api('POST', '/api/vault/tools/vault_write', {
      input: { path: 'Inbox/Ferma', content: '# Ferma\n' },
      client: 'Cursor',
    });
    expect(halted.status).toBe(409);

    const mine = events().filter((e) => e.agent === 'mcp-cursor');
    const data = (i: number) => (mine[i]?.data ?? {}) as Record<string, unknown>;
    expect(mine.map((e, i) => [e.type, data(i)['tool']])).toEqual([
      ['tool_call', 'nope'],
      ['tool_result', 'nope'],
      ['tool_call', 'vault_write'],
      ['tool_result', 'vault_write'],
    ]);
    expect(mine[1]).toMatchObject({ parentId: mine[0]?.id, data: { ok: false } });
    expect(String(data(1)['error'])).toMatch(/^UNKNOWN_TOOL/);
    expect(data(2)).toMatchObject({ input: { path: 'Inbox/Ferma' } });
    expect(mine[3]).toMatchObject({ parentId: mine[2]?.id, data: { ok: false } });
    expect(String(data(3)['error'])).toMatch(/^HALTED: /);
    // Nothing was written.
    expect(events().some((e) => e.type === 'vault_change' && e.agent === 'mcp-cursor')).toBe(false);
  });
});
