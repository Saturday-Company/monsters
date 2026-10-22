// A fake `codex app-server` for the tests: JSON-RPC lines without the
// `jsonrpc` field, as documented. Fake options come first:
//   node codex.mjs --fake-record=<file> --fake-scenario=<tool|loop|hang|noinit|usage_limit|longcmd> app-server …
// `--fake-answer=<text>`: the last message of the `tool` scenario (default «Fatto: <prompt>»).
// `--fake-limits=off` leaves out the plan limits notification (D-111).
// `longcmd`: a command that runs silent for `--fake-cmd-ms` (default 600), then prints a line.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { callMcpTool } from './mcp-call.js';

const raw = process.argv.slice(2);
const fake = Object.fromEntries(
  raw.filter((a) => a.startsWith('--fake-')).map((a) => a.slice(7).split('=')),
);
const args = raw.filter((a) => !a.startsWith('--fake-'));
const record = (entry) => {
  if (fake.record) appendFileSync(fake.record, `${JSON.stringify(entry)}\n`);
};
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const notify = (method, params) => send({ method, params });
const scenario = fake.scenario ?? 'tool';
record({ kind: 'start', pid: process.pid, argv: args, env: process.env, cwd: process.cwd() });

/** `-c key=value` overrides, values parsed as TOML scalars (strings are JSON-quoted). */
const config = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '-c') continue;
  const [key, ...rest] = args[i + 1].split('=');
  const value = rest.join('=');
  config[key] = value.startsWith('"')
    ? JSON.parse(value)
    : value === 'true'
      ? true
      : value === 'false'
        ? false
        : value;
}

const thread = 'thr_123';
const turn = 'turn_456';
/** Token totals of the thread (a resumed thread starts with its earlier turns). */
const totals = { input: 0, output: 0 };
function tokenUsage(input, output) {
  totals.input += input;
  totals.output += output;
  const breakdown = (i, o) => ({
    totalTokens: i + o,
    inputTokens: i,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: o,
    reasoningOutputTokens: 0,
  });
  notify('thread/tokenUsage/updated', {
    threadId: thread,
    turnId: turn,
    tokenUsage: {
      total: breakdown(totals.input, totals.output),
      last: breakdown(input, output),
      modelContextWindow: 200000,
    },
  });
}
/** The same update again, as app-server may send it. */
function tokenUsageAgain() {
  const breakdown = (i, o) => ({
    totalTokens: i + o,
    inputTokens: i,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: o,
    reasoningOutputTokens: 0,
  });
  notify('thread/tokenUsage/updated', {
    threadId: thread,
    turnId: turn,
    tokenUsage: {
      total: breakdown(totals.input, totals.output),
      last: breakdown(200, 100),
      modelContextWindow: 200000,
    },
  });
}
/** The fields of the real `RateLimitSnapshot` besides the windows. */
function rateLimitSnapshot() {
  return {
    limitId: 'codex',
    limitName: null,
    normalModelSlug: null,
    credits: null,
    individualLimit: null,
    spendControlReached: null,
    planType: null,
    rateLimitReachedType: null,
  };
}
if (scenario === 'hang') {
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
}

const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  record({ kind: 'rpc', msg });
  if (msg.method === 'initialize' && scenario === 'noinit') {
    continue; // never answers: a hung app-server
  }
  if (msg.method === 'initialize') {
    send({
      id: msg.id,
      result: { userAgent: 'fake-codex/0.159.2', platformFamily: 'unix', platformOs: 'linux' },
    });
  } else if (msg.method === 'thread/start' || msg.method === 'thread/resume') {
    if (msg.method === 'thread/resume') {
      totals.input = 5000;
      totals.output = 900;
    }
    send({
      id: msg.id,
      result: {
        thread: { id: msg.params.threadId ?? thread },
        model: msg.params.model ?? 'gpt-test',
        modelProvider: config.model_provider,
      },
    });
    notify('thread/started', { thread: { id: thread } });
  } else if (msg.method === 'turn/interrupt') {
    if (scenario !== 'hang') {
      send({ id: msg.id, result: {} });
      notify('turn/completed', {
        threadId: thread,
        turn: { id: turn, status: 'interrupted', items: [], error: null },
      });
    }
  } else if (msg.method === 'turn/start') {
    send({
      id: msg.id,
      result: { turn: { id: turn, status: 'inProgress', items: [], error: null } },
    });
    notify('turn/started', { threadId: thread, turn: { id: turn } });
    const prompt = msg.params.input[0].text;
    // The plan's limits (D-111), as the app-server announces them: usedPercent,
    // windowDurationMins and resetsAt (unix seconds), in the shape of codex 0.163.0 (captured from
    // the real binary). `--fake-limits=off` sends none; `--fake-limits=empty` sends what the real
    // one sends when the backend's response had no `x-codex-*` headers: both windows null.
    if (fake.limits === 'empty') {
      notify('account/rateLimits/updated', {
        rateLimits: { ...rateLimitSnapshot(), primary: null, secondary: null },
      });
    } else if (fake.limits !== 'off') {
      const nowSec = Math.floor(Date.now() / 1000);
      notify('account/rateLimits/updated', {
        rateLimits: {
          ...rateLimitSnapshot(),
          primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: nowSec + 75 * 60 },
          secondary: { usedPercent: 81, windowDurationMins: 10080, resetsAt: nowSec + 4 * 86_400 },
          planType: 'plus',
        },
      });
    }
    if (scenario === 'hang') {
      notify('item/agentMessage/delta', {
        threadId: thread,
        turnId: turn,
        itemId: 'a0',
        delta: 'Lavoro…',
      });
      continue;
    }
    if (scenario === 'loop') {
      // A model that keeps calling tools until it is interrupted.
      for (let i = 1; i <= 5; i++) {
        notify('item/started', {
          threadId: thread,
          turnId: turn,
          item: {
            type: 'mcpToolCall',
            id: `l${i}`,
            server: 'monsters',
            tool: 'vault_search',
            arguments: { query: String(i) },
            status: 'inProgress',
            result: null,
            error: null,
          },
        });
        tokenUsage(10, 5);
      }
      continue;
    }
    if (scenario === 'longcmd') {
      const item = {
        type: 'commandExecution',
        id: 'c1',
        command: 'pnpm test',
        status: 'inProgress',
      };
      notify('item/started', { threadId: thread, turnId: turn, item });
      await new Promise((r) => setTimeout(r, Number(fake['cmd-ms'] ?? 600)));
      notify('item/commandExecution/outputDelta', {
        threadId: thread,
        turnId: turn,
        itemId: 'c1',
        delta: 'ok\n',
      });
      notify('item/completed', {
        threadId: thread,
        turnId: turn,
        item: { ...item, status: 'completed', aggregatedOutput: 'ok\n', exitCode: 0 },
      });
      notify('item/completed', {
        threadId: thread,
        turnId: turn,
        item: { type: 'agentMessage', id: 'a2', text: 'Test verdi.' },
      });
      notify('turn/completed', {
        threadId: thread,
        turn: { id: turn, status: 'completed', items: [], error: null },
      });
      continue;
    }
    if (scenario === 'usage_limit') {
      notify('error', {
        threadId: thread,
        turnId: turn,
        willRetry: false,
        error: { message: 'You have hit your usage limit.', codexErrorInfo: 'usageLimitExceeded' },
      });
      notify('turn/completed', {
        threadId: thread,
        turn: {
          id: turn,
          status: 'failed',
          items: [],
          error: {
            message: 'You have hit your usage limit.',
            codexErrorInfo: 'usageLimitExceeded',
            additionalDetails: null,
          },
        },
      });
      continue;
    }
    notify('item/started', {
      threadId: thread,
      turnId: turn,
      item: { type: 'agentMessage', id: 'a1', text: '' },
    });
    notify('item/agentMessage/delta', {
      threadId: thread,
      turnId: turn,
      itemId: 'a1',
      delta: 'Cerco.',
    });
    notify('item/completed', {
      threadId: thread,
      turnId: turn,
      item: { type: 'agentMessage', id: 'a1', text: 'Cerco.' },
    });
    const mcpName = Object.keys(config)
      .find((k) => k.startsWith('mcp_servers.') && k.endsWith('.url'))
      .split('.')[1];
    const item = {
      type: 'mcpToolCall',
      id: 'm1',
      server: mcpName,
      tool: 'vault_search',
      arguments: { query: 'ricette' },
      status: 'inProgress',
      result: null,
      error: null,
    };
    notify('item/started', { threadId: thread, turnId: turn, item });
    const called = await callMcpTool(
      config[`mcp_servers.${mcpName}.url`],
      process.env[config[`mcp_servers.${mcpName}.bearer_token_env_var`]],
      'vault_search',
      { query: 'ricette' },
    );
    record({ kind: 'mcp', ...called });
    notify('item/completed', {
      threadId: thread,
      turnId: turn,
      item: {
        ...item,
        status: called.error ? 'failed' : 'completed',
        result: called.result
          ? { content: called.result.content, structuredContent: null, _meta: null }
          : null,
        error: called.error ? { message: String(called.error) } : null,
      },
    });
    tokenUsage(200, 100);
    notify('item/completed', {
      threadId: thread,
      turnId: turn,
      item: { type: 'agentMessage', id: 'a2', text: fake.answer ?? `Fatto: ${prompt}` },
    });
    tokenUsageAgain();
    notify('turn/completed', {
      threadId: thread,
      turn: { id: turn, status: 'completed', items: [], error: null },
    });
  }
}
