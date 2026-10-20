/*
 * An MCP server written with the official SDK (`@modelcontextprotocol/server`):
 * checks that the client speaks to real servers too, not only to the
 * hand-written fake. `node sdk-mcp-server.ts` serves stdio; `sdkHttpHandler`
 * is the same server over Streamable HTTP.
 */
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

export function sdkServer(): McpServer {
  const server = new McpServer(
    { name: 'sdk-fake', version: '2.0.0' },
    { capabilities: { tools: {} } },
  );
  server.registerTool(
    'add',
    {
      description: 'Adds two numbers.',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      annotations: { readOnlyHint: true },
    },
    ({ a, b }: { a: number; b: number }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
  );
  return server;
}

export const sdkHttpHandler = () => createMcpHandler(() => sdkServer());

if (import.meta.main) {
  const handle = serveStdio(() => sdkServer());
  process.stdin.once('end', () => void handle.close().finally(() => process.exit(0)));
}
