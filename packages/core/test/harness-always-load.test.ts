import { createMcpHandler } from '@modelcontextprotocol/server';
import { defineTool } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ALWAYS_LOAD_META_KEY,
  ALWAYS_LOADED_TOOLS,
  HarnessToolSessions,
  harnessMcpServer,
} from '../src/agents/harness-tools.ts';
import { ControlScope } from '../src/kill/control-scope.ts';
import { EventLog, coreMigrations, migrate, openDb } from '../src/index.ts';

/*
 * Claude Code defers the schemas of MCP tools (names only until ToolSearch loads them). The core
 * tools of a monster are marked `anthropic/alwaysLoad` so they arrive loaded (D-169); the rest
 * of the tools stay deferred.
 */

const tool = (name: string) =>
  defineTool({
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({}),
    execute: () => Promise.resolve('ok'),
  });

interface Listed {
  name: string;
  _meta?: Record<string, unknown>;
}

async function listTools(names: string[]): Promise<Listed[]> {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  const log = new EventLog(db);
  const scope = new ControlScope('run', 'r1', null, 100);
  const { session } = new HarnessToolSessions(log).open(names.map(tool), {
    log,
    agentId: 'rhea',
    runId: 'r1',
    signal: scope.signal,
    scope,
  });
  const handler = createMcpHandler(() => harnessMcpServer(session, 'test'), {
    legacy: 'stateless',
  });
  const res = await handler.fetch(
    new Request('http://127.0.0.1/api/harness/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
  const text = await res.text();
  const data = res.headers.get('content-type')?.includes('text/event-stream')
    ? (text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .at(-1) ?? '{}')
    : text;
  return (JSON.parse(data) as { result: { tools: Listed[] } }).result.tools;
}

describe('core tools are loaded up front in Claude Code (D-169)', () => {
  it('marks the core tools of the run with anthropic/alwaysLoad and no other', async () => {
    const all = [...ALWAYS_LOADED_TOOLS, 'vault_history', 'web_search', 'mcp__crm__invoice_list'];
    const tools = await listTools(all);
    expect(tools.map((t) => t.name).sort()).toEqual([...all].sort());
    for (const t of tools) {
      if (ALWAYS_LOADED_TOOLS.has(t.name)) expect(t._meta?.[ALWAYS_LOAD_META_KEY]).toBe(true);
      else expect(t._meta?.[ALWAYS_LOAD_META_KEY]).toBeUndefined();
    }
    expect([...ALWAYS_LOADED_TOOLS].sort()).toEqual([
      'ask_teammate',
      'ask_user',
      'delegate',
      'vault_edit',
      'vault_read',
      'vault_search',
      'vault_write',
    ]);
  });

  it('marks only the tools that exist for the agent', async () => {
    const tools = await listTools(['vault_read', 'vault_search', 'web_fetch']);
    expect(tools.map((t) => [t.name, t._meta?.[ALWAYS_LOAD_META_KEY] === true])).toEqual([
      ['vault_read', true],
      ['vault_search', true],
      ['web_fetch', false],
    ]);
  });
});
