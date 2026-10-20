/*
 * Does Claude Code defer the tools of a big MCP server with its ToolSearch
 * (C.2, D-075)? Starts the fake Anteiku (124 tools, personal token), runs
 * `claude -p` with the same switches as a Monsters harness run (strict MCP
 * config, `--tools ''`, dontAsk, the server allowed), one turn on haiku, and
 * prints the tools of the init message and the input tokens of the turn; then
 * the same with no server, for the baseline. Two short haiku requests on the
 * user's own Claude login: run it by hand, never in CI.
 *
 *   node packages/core/test/fixtures/probe-claude-toolsearch.ts
 *
 * `PROBE_TOOLS` is the `--tools` value (default '', as before C.2; Monsters now
 * sends `ToolSearch`), `PROBE_ONLY_SERVER=1` skips the baseline, `PROBE_PROMPT`
 * asks something real (up to 5 turns).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { startFakeAnteiku } from './fake-anteiku-server.ts';

async function turn(withServer: boolean, url: string, token: string) {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-probe-'));
  const config = join(dir, 'mcp.json');
  writeFileSync(
    config,
    JSON.stringify({
      mcpServers: withServer
        ? { anteiku: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } }
        : {},
    }),
  );
  const child = spawn(
    'claude',
    [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--mcp-config',
      config,
      '--strict-mcp-config',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      'mcp__anteiku',
      '--tools',
      process.env['PROBE_TOOLS'] ?? '',
      '--setting-sources',
      'project,local',
      '--model',
      'haiku',
      '--max-turns',
      process.env['PROBE_PROMPT'] ? '5' : '1',
      '--no-session-persistence',
      process.env['PROBE_PROMPT'] ?? 'Rispondi solo: ok',
    ],
    { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env } },
  );
  const out: { tools?: string[]; usage?: unknown; text?: string; used: string[] } = { used: [] };
  for await (const line of createInterface({ input: child.stdout })) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (msg['type'] === 'system' && msg['subtype'] === 'init') out.tools = msg['tools'] as string[];
    if (msg['type'] === 'result') {
      out.usage = msg['usage'];
      out.text = msg['result'] as string;
    }
    if (msg['type'] === 'assistant') {
      const content = (msg['message'] as { content?: { type: string; name?: string }[] }).content;
      for (const c of content ?? []) if (c.type === 'tool_use') out.used.push(c.name ?? '');
    }
  }
  rmSync(dir, { recursive: true, force: true });
  return out;
}

const fa = await startFakeAnteiku();
try {
  for (const withServer of process.env['PROBE_ONLY_SERVER'] ? [true] : [true, false]) {
    const r = await turn(withServer, fa.mcpUrl, fa.personalToken);
    const mcp = (r.tools ?? []).filter((t) => t.startsWith('mcp__'));
    process.stdout.write(
      `${JSON.stringify(
        {
          server: withServer,
          tools: (r.tools ?? []).filter((t) => !t.startsWith('mcp__')),
          mcpTools: mcp.length,
          used: r.used,
          answer: r.text,
          input: (() => {
            const u = r.usage as Record<string, number> | undefined;
            return u
              ? (u['input_tokens'] ?? 0) +
                  (u['cache_creation_input_tokens'] ?? 0) +
                  (u['cache_read_input_tokens'] ?? 0)
              : null;
          })(),
        },
        null,
        1,
      )}\n`,
    );
  }
} finally {
  await fa.close();
}
